const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const Session = require('../models/Session');
const HprAuthToken = require('../models/HprAuthToken');
const ProvisionalIntake = require('../models/ProvisionalIntake');
const AuditLog = require('../models/AuditLog');
const { isMongoConnected, memoryStore } = require('../config/db');
const { requireBearerToken, optionalBearerToken } = require('../middleware/specAuth');
const { analyzeDiscrepancies } = require('../services/discrepancyEngine');
const { convertToFhirR4Bundle } = require('../services/fhirMapper');
const specAdapter = require('../services/specAdapter');
const { detectRedFlags, mergeRedFlags } = require('../services/redFlagRules');
const { interpretVitals, DISCLAIMER } = require('../services/altitudeAdjustmentService');

// ---- persistence helpers (mirrors the Mongo/in-memory fallback pattern already used elsewhere in this repo) ----

async function findSession(sessionId) {
  if (!sessionId) return null;
  if (isMongoConnected()) {
    return Session.findOne({
      $or: [
        { session_id: sessionId },
        { _id: sessionId.match(/^[0-9a-fA-F]{24}$/) ? sessionId : null }
      ]
    });
  }
  const bySessionId = await memoryStore.findOne('Session', { session_id: sessionId });
  if (bySessionId) return bySessionId;
  const col = memoryStore.getCollection('Session');
  for (const item of col.values()) {
    if (item.session_id === sessionId || item._id === sessionId) {
      return item;
    }
  }
  return null;
}

async function saveSession(sessionDoc) {
  if (isMongoConnected()) return sessionDoc.save();
  return memoryStore.updateOne('Session', { session_id: sessionDoc.session_id }, sessionDoc.toObject ? sessionDoc.toObject() : sessionDoc);
}

function asPlain(sessionDoc) {
  return sessionDoc.toObject ? sessionDoc.toObject() : sessionDoc;
}

/** Recompute cross_check_discrepancies + red_flags from current intake/vitals/documents,
 * and bump session.status to red_flagged if something urgent/critical just fired. */
function recomputeClinicalChecks(sessionDoc, io) {
  const internalPayload = specAdapter.sessionToInternalIntake(sessionDoc);

  const autoFlags = analyzeDiscrepancies(internalPayload);
  const specFlags = specAdapter.internalDiscrepanciesToSpec(autoFlags);
  const existingByRef = new Map((sessionDoc.cross_check_discrepancies || []).map(d => [d.discrepancy_id, d]));
  for (const f of specFlags) {
    if (!existingByRef.has(f.discrepancy_id)) existingByRef.set(f.discrepancy_id, f);
  }
  sessionDoc.cross_check_discrepancies = Array.from(existingByRef.values());

  const newRedFlags = detectRedFlags(sessionDoc);
  sessionDoc.red_flags = mergeRedFlags(sessionDoc.red_flags || [], newRedFlags);

  const hasActiveUrgentOrCritical = sessionDoc.red_flags.some(
    f => f.status === 'active' && (f.urgency_tier === 'critical' || f.urgency_tier === 'urgent')
  );
  if (hasActiveUrgentOrCritical && ['draft', 'in_progress'].includes(sessionDoc.status)) {
    sessionDoc.status = 'red_flagged';
  }

  if (io && newRedFlags.length) {
    io.emit('TRIAGE_UPDATED', {
      sessionId: sessionDoc.session_id,
      status: sessionDoc.status,
      redFlags: newRedFlags
    });

    const altRedFlag = newRedFlags.find(f =>
      (f.flag_type?.includes('hypoxemia') || f.flag_type?.includes('altitude') || f.flag_type === 'hypertensive_crisis') &&
      f.urgency_tier === 'critical'
    );

    if (altRedFlag) {
      const alertPayload = {
        sessionId: sessionDoc.session_id,
        patientId: sessionDoc.patient?.abha_id || sessionDoc.patient?.name || sessionDoc.session_id,
        patientName: sessionDoc.patient?.name || 'Patient',
        reason: altRedFlag.reason || altRedFlag.flag_type,
        flagReason: altRedFlag.reason || altRedFlag.flag_type,
        altitude: {
          meters: sessionDoc.environment?.altitudeMeters ?? 2438,
          feet: sessionDoc.environment?.altitudeFeet ?? 8000
        },
        altitudeMeters: sessionDoc.environment?.altitudeMeters ?? 2438,
        vitals: {
          spo2: sessionDoc.vitals?.find(v => v.type === 'spo2')?.value,
          systolic: sessionDoc.vitals?.find(v => v.type === 'bp_systolic')?.value,
          diastolic: sessionDoc.vitals?.find(v => v.type === 'bp_diastolic')?.value,
          heartRate: sessionDoc.vitals?.find(v => v.type === 'heart_rate')?.value
        },
        vitalsSnapshot: {
          spo2: sessionDoc.vitals?.find(v => v.type === 'spo2')?.value,
          systolic: sessionDoc.vitals?.find(v => v.type === 'bp_systolic')?.value,
          diastolic: sessionDoc.vitals?.find(v => v.type === 'bp_diastolic')?.value,
          heartRate: sessionDoc.vitals?.find(v => v.type === 'heart_rate')?.value
        },
        urgencyTier: 'critical',
        isFastTrack: true,
        timestamp: new Date().toISOString()
      };

      AuditLog.recordAuditLog({
        action: 'ALTITUDE_RED_FLAG_TRIGGERED',
        sessionId: sessionDoc.session_id,
        intakeId: sessionDoc.session_id,
        altitudeMeters: sessionDoc.environment?.altitudeMeters ?? 2438,
        altitudeSource: sessionDoc.environment?.altitudeSource ?? 'facility_config',
        algorithmVersion: 'altitude-mvp-v1',
        userId: 'TRIAGE_ENGINE',
        details: {
          flagReason: altRedFlag.reason || altRedFlag.flag_type,
          flagType: altRedFlag.flag_type,
          urgencyTier: altRedFlag.urgency_tier,
          vitalsSnapshot: alertPayload.vitalsSnapshot,
          timestamp: alertPayload.timestamp
        }
      }).catch(err => console.error('Error logging ALTITUDE_RED_FLAG_TRIGGERED:', err));

      io.to('dashboard').emit('ALTITUDE_RED_FLAG', alertPayload);
      io.emit('ALTITUDE_RED_FLAG', alertPayload);
      io.to('dashboard').emit('SERVER.ESCALATION_REQUIRED', alertPayload);
      io.emit('SERVER.ESCALATION_REQUIRED', alertPayload);
    }
  }
}

function notFound(res, message = 'Session not found') {
  return res.status(404).json({ code: 'NOT_FOUND', message });
}

// ============================= Sessions =============================

// POST /sessions
router.post('/sessions', requireBearerToken, async (req, res) => {
  try {
    const { kiosk_id, facility_id, language, input_mode, patient } = req.body || {};
    if (!kiosk_id || !facility_id || !language) {
      return res.status(400).json({ code: 'BAD_REQUEST', message: 'kiosk_id, facility_id and language are required.' });
    }

    const sessionData = {
      schema_version: '1.0.0',
      session_id: crypto.randomUUID(),
      kiosk_id,
      facility_id,
      language,
      input_mode: input_mode || 'touch',
      patient: patient || {},
      status: 'draft'
    };

    let saved;
    if (isMongoConnected()) {
      saved = await Session.create(sessionData);
    } else {
      saved = await memoryStore.save('Session', new Session(sessionData).toObject());
    }

    return res.status(201).json(asPlain(saved));
  } catch (err) {
    return res.status(400).json({ code: 'BAD_REQUEST', message: err.message });
  }
});

// GET /sessions/:sessionId
router.get('/sessions/:sessionId', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);
  return res.status(200).json(asPlain(session));
});

// PATCH /sessions/:sessionId
router.patch('/sessions/:sessionId', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);

  if (req.body?.status) session.status = req.body.status;
  if (req.body?.consent) session.consent = req.body.consent;

  const saved = await saveSession(session);
  return res.status(200).json(asPlain(saved));
});

// ============================= Intake =============================

router.get('/sessions/:sessionId/intake', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);
  return res.status(200).json(asPlain(session).intake || {});
});

router.put('/sessions/:sessionId/intake', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);

  session.intake = req.body || {};
  if (session.status === 'draft') session.status = 'in_progress';
  recomputeClinicalChecks(session, req.app.get('io'));

  const saved = await saveSession(session);
  return res.status(200).json(asPlain(saved).intake);
});

// ============================= Environment Context =============================

// POST /sessions/:id/environment (and /sessions/:sessionId/environment)
router.post(['/sessions/:id/environment', '/sessions/:sessionId/environment'], optionalBearerToken, async (req, res) => {
  const sessionId = req.params.id || req.params.sessionId;
  let session = await findSession(sessionId);
  if (!session) {
    const newSessionData = {
      schema_version: '1.0.0',
      session_id: sessionId,
      kiosk_id: req.body?.kiosk_id || 'KIOSK-ALT-01',
      facility_id: req.body?.facility_id || 'FACILITY-ALT-01',
      language: req.body?.language || 'en',
      input_mode: 'touch',
      status: 'draft'
    };
    if (isMongoConnected()) {
      session = await Session.create(newSessionData);
    } else {
      session = await memoryStore.save('Session', new Session(newSessionData).toObject());
    }
  }

  const {
    altitudeMeters = 2438,
    altitudeSource = 'facility_config',
    altitudeConfidence = 1.0,
    timeAtAltitudeHours = null,
    residenceAltitudeMeters = null,
    acclimatizationStatus = 'unacclimatized'
  } = req.body || {};

  const numMeters = Number(altitudeMeters);
  const altitudeFeet = req.body?.altitudeFeet !== undefined
    ? Number(req.body.altitudeFeet)
    : (numMeters === 2438 ? 8000 : Math.round(numMeters * 3.28084));

  const envData = {
    altitudeMeters: isNaN(numMeters) ? 2438 : numMeters,
    altitudeFeet,
    altitudeSource,
    altitudeConfidence: Number(altitudeConfidence) || 1.0,
    timeAtAltitudeHours: timeAtAltitudeHours !== null ? Number(timeAtAltitudeHours) : null,
    residenceAltitudeMeters: residenceAltitudeMeters !== null ? Number(residenceAltitudeMeters) : null,
    acclimatizationStatus
  };

  session.environment = envData;

  // Re-calculate altitude context for existing vitals if present
  if (session.vitals && session.vitals.length > 0) {
    const symptoms = [
      session.intake?.chief_complaint?.value,
      ...(session.intake?.hpi?.associated_symptoms || []).map(s => s.value)
    ].filter(Boolean);

    const interpreted = interpretVitals(session.vitals, session.environment, symptoms);
    session.vitals = session.vitals.map(v => {
      const match = interpreted.find(iv => iv.type === v.type);
      if (match) {
        v.altitudeContext = {
          altitudeMeters: match.altitudeMeters,
          expectedRange: match.expectedRange,
          status: match.status,
          adjustedForAltitude: match.adjustedForAltitude,
          algorithmVersion: match.algorithmVersion
        };
        v.flagged_abnormal = match.status === 'critical' || match.status === 'borderline';
      }
      return v;
    });
    recomputeClinicalChecks(session, req.app.get('io'));
  }

  await AuditLog.recordAuditLog({
    action: 'ALTITUDE_CONTEXT_APPLIED',
    sessionId: session.session_id,
    intakeId: session.session_id,
    altitudeMeters: envData.altitudeMeters,
    altitudeSource: envData.altitudeSource,
    algorithmVersion: 'altitude-mvp-v1',
    userId: req.user?.hpr_id || req.body?.captured_by_staff_id || 'SYSTEM_KIOSK',
    details: {
      ...envData,
      vitalsRecomputed: (session.vitals && session.vitals.length > 0)
    }
  }).catch(err => console.error('Error logging ALTITUDE_CONTEXT_APPLIED:', err));

  const saved = await saveSession(session);
  return res.status(200).json({
    success: true,
    sessionId: session.session_id,
    environment: asPlain(saved).environment,
    disclaimer: DISCLAIMER
  });
});

// GET /sessions/:id/environment (and /sessions/:sessionId/environment)
router.get(['/sessions/:id/environment', '/sessions/:sessionId/environment'], optionalBearerToken, async (req, res) => {
  const sessionId = req.params.id || req.params.sessionId;
  const session = await findSession(sessionId);
  if (!session) return notFound(res);
  return res.status(200).json({
    success: true,
    sessionId: session.session_id,
    environment: asPlain(session).environment || {
      altitudeMeters: 2438,
      altitudeFeet: 8000,
      altitudeSource: 'facility_config',
      altitudeConfidence: 1.0,
      acclimatizationStatus: 'unacclimatized'
    },
    disclaimer: DISCLAIMER
  });
});

// ============================= Vitals =============================

router.get(['/sessions/:id/vitals', '/sessions/:sessionId/vitals'], optionalBearerToken, async (req, res) => {
  const sessionId = req.params.id || req.params.sessionId;
  const session = await findSession(sessionId);
  if (!session) return notFound(res);
  return res.status(200).json(asPlain(session).vitals || []);
});

// GET /sessions/:id/vitals/interpreted
router.get(['/sessions/:id/vitals/interpreted', '/sessions/:sessionId/vitals/interpreted'], optionalBearerToken, async (req, res) => {
  const sessionId = req.params.id || req.params.sessionId;
  const session = await findSession(sessionId);
  if (!session) return notFound(res);

  const env = asPlain(session).environment || { altitudeMeters: 2438, altitudeFeet: 8000 };
  const symptoms = [
    session.intake?.chief_complaint?.value,
    ...(session.intake?.hpi?.associated_symptoms || []).map(s => s.value)
  ].filter(Boolean);

  const rawVitals = asPlain(session).vitals || [];
  const interpreted = interpretVitals(rawVitals, env, symptoms);

  return res.status(200).json({
    success: true,
    sessionId: session.session_id,
    altitudeMeters: env.altitudeMeters,
    environment: env,
    rawValuesPreserved: true,
    rawVitals: rawVitals,
    interpretedVitals: interpreted,
    disclaimer: DISCLAIMER
  });
});

// POST /sessions/:id/vitals (and /sessions/:sessionId/vitals)
router.post(['/sessions/:id/vitals', '/sessions/:sessionId/vitals'], optionalBearerToken, async (req, res) => {
  const sessionId = req.params.id || req.params.sessionId;
  let session = await findSession(sessionId);
  if (!session) {
    const newSessionData = {
      schema_version: '1.0.0',
      session_id: sessionId,
      kiosk_id: 'KIOSK-ALT-01',
      facility_id: 'FACILITY-ALT-01',
      language: 'en',
      input_mode: 'touch',
      status: 'draft'
    };
    if (isMongoConnected()) {
      session = await Session.create(newSessionData);
    } else {
      session = await memoryStore.save('Session', new Session(newSessionData).toObject());
    }
  }

  const { vitals, entryMode } = req.body || {};
  const isMock = entryMode === 'mock';
  const defaultSource = isMock ? 'device' : 'staff_manual_entry';

  // Gather symptoms for altitude-based escalation logic
  const symptoms = [
    session.intake?.chief_complaint?.value,
    ...(session.intake?.hpi?.associated_symptoms || []).map(s => s.value),
    ...(req.body?.symptoms || [])
  ].filter(Boolean);

  const env = session.environment || { altitudeMeters: 2438, altitudeFeet: 8000 };

  let incomingList = [];
  if (Array.isArray(vitals)) {
    incomingList = vitals;
  } else if (vitals && typeof vitals === 'object') {
    incomingList = [vitals];
  } else if (req.body?.type && req.body?.value !== undefined) {
    // Legacy single vital format
    incomingList = [req.body];
  }

  // Interpret incoming readings using altitude Adjustment Service
  const interpreted = interpretVitals(incomingList, env, symptoms);

  const formattedReadings = incomingList.map(item => {
    const interpMatch = interpreted.find(iv => iv.type === item.type);
    return {
      type: item.type,
      value: Number(item.value),
      unit: item.unit || (item.type === 'spo2' ? '%' : item.type === 'heart_rate' ? 'bpm' : 'mmHg'),
      source: item.source || defaultSource,
      device_id: item.device_id || (isMock ? 'MOCK-SENSOR-01' : null),
      device_model: item.device_model || (isMock ? 'MediKiosk-Altitude-Mock-v1' : null),
      captured_by_staff_id: item.captured_by_staff_id || null,
      captured_at: item.captured_at || new Date(),
      confidence: item.confidence ?? (isMock ? 0.99 : 1.0),
      flagged_abnormal: interpMatch ? (interpMatch.status === 'critical' || interpMatch.status === 'borderline') : false,
      altitudeContext: interpMatch ? {
        altitudeMeters: interpMatch.altitudeMeters,
        expectedRange: interpMatch.expectedRange,
        status: interpMatch.status,
        adjustedForAltitude: interpMatch.adjustedForAltitude,
        algorithmVersion: interpMatch.algorithmVersion
      } : null
    };
  });

  session.vitals = [...(session.vitals || []), ...formattedReadings];
  if (session.status === 'draft') session.status = 'in_progress';
  recomputeClinicalChecks(session, req.app.get('io'));

  const saved = await saveSession(session);
  const plainSaved = asPlain(saved);

  // If a single vital was submitted via legacy call, return it as single object for backward compatibility
  if (!vitals && req.body?.type) {
    return res.status(201).json(plainSaved.vitals.slice(-1)[0]);
  }

  return res.status(201).json({
    success: true,
    sessionId: session.session_id,
    rawValuesPreserved: true,
    vitals: plainSaved.vitals,
    newVitals: formattedReadings,
    interpretedVitals: interpreted,
    disclaimer: DISCLAIMER
  });
});

// ============================= Documents =============================
// NOTE: real OCR isn't part of this backend (that's Task 2's workstream).
// This accepts a JSON body with document metadata + already-extracted
// fields (matching example-session.json's shape) rather than true
// multipart file upload — see README addendum for details.

router.get('/sessions/:sessionId/documents', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);
  return res.status(200).json(asPlain(session).documents || []);
});

router.post('/sessions/:sessionId/documents', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);

  const { document_type, scan_method, raw_image_ref, ocr_engine, document_date, extracted_fields } = req.body || {};
  if (!document_type || !scan_method) {
    return res.status(400).json({ code: 'BAD_REQUEST', message: 'document_type and scan_method are required.' });
  }

  const doc = {
    document_id: `DOC-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`,
    document_type,
    scan_method,
    uploaded_at: new Date(),
    document_date: document_date || null,
    raw_image_ref: raw_image_ref || null,
    ocr_engine: ocr_engine || null,
    extracted_fields: extracted_fields || [],
    fhir_resource_ref: null
  };

  session.documents = [...(session.documents || []), doc];
  recomputeClinicalChecks(session, req.app.get('io'));

  const saved = await saveSession(session);
  return res.status(202).json(asPlain(saved).documents.slice(-1)[0]);
});

router.get('/sessions/:sessionId/documents/:documentId', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);
  const doc = (asPlain(session).documents || []).find(d => d.document_id === req.params.documentId);
  if (!doc) return notFound(res, 'Document not found');
  return res.status(200).json(doc);
});

// ============================= Discrepancies =============================

router.get('/sessions/:sessionId/discrepancies', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);
  return res.status(200).json(asPlain(session).cross_check_discrepancies || []);
});

// ============================= Red flags =============================

router.get(['/sessions/:id/red-flags', '/sessions/:sessionId/red-flags'], optionalBearerToken, async (req, res) => {
  const sessionId = req.params.id || req.params.sessionId;
  const session = await findSession(sessionId);
  if (!session) return notFound(res);

  const plainSession = asPlain(session);
  const altitudeMeters = plainSession.environment?.altitudeMeters ?? 2438;
  const flags = (plainSession.red_flags || []).map(f => ({
    ...f,
    altitude_context: f.altitude_context || {
      altitudeMeters,
      adjustedForAltitude: f.flag_type?.includes('altitude') || f.flag_type?.includes('hypoxemia'),
      algorithmVersion: 'altitude-mvp-v1'
    }
  }));

  if (req.query.format === 'object') {
    return res.status(200).json({
      success: true,
      sessionId: session.session_id,
      altitudeMeters,
      redFlags: flags
    });
  }

  return res.status(200).json(flags);
});

// POST /sessions/:id/altitude-override (Physician override of altitude interpretation with Audit Log)
router.post(['/sessions/:id/altitude-override', '/sessions/:sessionId/altitude-override'], optionalBearerToken, async (req, res) => {
  const sessionId = req.params.id || req.params.sessionId;
  const session = await findSession(sessionId);
  if (!session) return notFound(res);

  const {
    doctorHprId = req.staff?.hprId || 'HPR-DOC-OVERRIDE',
    doctorName = req.staff?.doctorName || 'Attending Physician',
    vitalType = 'spo2',
    overrideStatus = 'normal',
    overrideReason = 'Physician evaluated patient as stable with known chronic adaptation',
    clearedFastTrack = true
  } = req.body || {};

  // Update session vitals
  session.vitals = (session.vitals || []).map(v => {
    if (vitalType === 'all' || v.type === vitalType) {
      if (!v.altitudeContext) {
        v.altitudeContext = {
          altitudeMeters: session.environment?.altitudeMeters ?? 2438,
          status: overrideStatus,
          algorithmVersion: 'altitude-mvp-v1'
        };
      }
      v.altitudeContext.status = overrideStatus;
      v.altitudeContext.overriddenByDoctor = true;
      v.altitudeContext.doctorHprId = doctorHprId;
      v.altitudeContext.doctorName = doctorName;
      v.altitudeContext.overrideReason = overrideReason;
      v.altitudeContext.overriddenAt = new Date();
      if (overrideStatus === 'normal') {
        v.flagged_abnormal = false;
      }
    }
    return v;
  });

  // Acknowledge relevant red flags
  if (session.red_flags && session.red_flags.length > 0) {
    session.red_flags = session.red_flags.map(f => {
      if (f.flag_type?.includes('hypoxemia') || f.flag_type?.includes('altitude') || f.flag_type === 'hypertensive_crisis') {
        f.status = 'physician_acknowledged';
      }
      return f;
    });
  }

  if (clearedFastTrack && session.status === 'red_flagged') {
    session.status = 'in_progress';
  }

  // Create Audit Log record with append-only tamper-evident hash chaining
  const auditEntry = await AuditLog.recordAuditLog({
    action: 'ALTITUDE_INTERPRETATION_OVERRIDDEN',
    sessionId: session.session_id,
    intakeId: session.session_id,
    abhaId: session.patient?.abha_id || session.session_id,
    performedBy: doctorName,
    userId: doctorHprId || doctorName,
    hprId: doctorHprId,
    altitudeMeters: session.environment?.altitudeMeters ?? 2438,
    altitudeSource: session.environment?.altitudeSource ?? 'facility_config',
    algorithmVersion: 'altitude-mvp-v1',
    details: {
      sessionId: session.session_id,
      vitalType,
      overrideStatus,
      overrideReason,
      clearedFastTrack,
      timestamp: new Date().toISOString()
    }
  });

  const saved = await saveSession(session);

  const io = req.app.get('io');
  if (io) {
    io.emit('ALTITUDE_OVERRIDE_RECORDED', {
      sessionId: session.session_id,
      auditEntry,
      session: asPlain(saved)
    });
  }

  return res.status(200).json({
    success: true,
    sessionId: session.session_id,
    status: saved.status,
    vitals: asPlain(saved).vitals,
    redFlags: asPlain(saved).red_flags,
    auditLog: auditEntry,
    message: 'Altitude interpretation successfully overridden and logged.'
  });
});

router.post(['/sessions/:id/red-flags/:flagId/acknowledge', '/sessions/:sessionId/red-flags/:flagId/acknowledge'], requireBearerToken, async (req, res) => {
  const sessionId = req.params.id || req.params.sessionId;
  const session = await findSession(sessionId);
  if (!session) return notFound(res);

  const { status } = req.body || {};
  if (!['acknowledged', 'resolved'].includes(status)) {
    return res.status(400).json({ code: 'BAD_REQUEST', message: 'status must be acknowledged or resolved.' });
  }

  const flags = asPlain(session).red_flags || [];
  const flag = flags.find(f => f.flag_id === req.params.flagId);
  if (!flag) return notFound(res, 'Red flag not found');
  flag.status = status;
  session.red_flags = flags;

  const stillActiveUrgent = flags.some(f => f.status === 'active' && (f.urgency_tier === 'critical' || f.urgency_tier === 'urgent'));
  if (!stillActiveUrgent && session.status === 'red_flagged') {
    session.status = 'in_progress';
  }

  const saved = await saveSession(session);
  return res.status(200).json(asPlain(saved).red_flags.find(f => f.flag_id === req.params.flagId));
});

// ============================= Staff auth & write-lock =============================

// POST /auth/staff-login — public per spec (security: [])
router.post('/auth/staff-login', async (req, res) => {
  try {
    const { method, hpr_id, webauthn_assertion } = req.body || {};
    if (!method) return res.status(400).json({ code: 'BAD_REQUEST', message: 'method is required.' });
    if (method === 'biometric' && !webauthn_assertion) {
      return res.status(401).json({ message: 'webauthn_assertion is required for biometric login.' });
    }

    const staffHprId = hpr_id || `HPR-TEMP-${crypto.randomBytes(4).toString('hex')}`;
    const token = `SESS_BEARER_${crypto.randomBytes(24).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);

    const tokenDoc = {
      hprId: staffHprId,
      doctorName: staffHprId,
      registrationNumber: staffHprId,
      role: 'CLINICIAN',
      token,
      biometricVerified: method === 'biometric',
      status: 'ACTIVE',
      expiresAt
    };

    if (isMongoConnected()) {
      await HprAuthToken.findOneAndUpdate({ hprId: staffHprId }, tokenDoc, { upsert: true, new: true });
    } else {
      await memoryStore.save('HprAuthToken', tokenDoc);
    }

    return res.status(200).json({
      access_token: token,
      staff_hpr_id: staffHprId,
      expires_in: 12 * 60 * 60
    });
  } catch (err) {
    return res.status(401).json({ message: err.message });
  }
});

// POST /sessions/:sessionId/staff-verification
router.post('/sessions/:sessionId/staff-verification', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);

  if (session.staff_verification?.verified) {
    return res.status(409).json({ code: 'ALREADY_VERIFIED', message: 'Session already verified.' });
  }

  const { staff_hpr_id, verification_method } = req.body || {};
  session.staff_verification = {
    verified: true,
    staff_hpr_id: staff_hpr_id || req.staff?.hprId || null,
    verification_method: verification_method || 'hpr_credential_login',
    verified_at: new Date()
  };
  if (session.status !== 'red_flagged') session.status = 'staff_verified';

  const saved = await saveSession(session);
  return res.status(200).json(asPlain(saved).staff_verification);
});

// ============================= Clinical summary =============================

router.get('/sessions/:sessionId/clinical-summary', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);
  return res.status(200).json(asPlain(session).clinical_summary || {});
});

router.put('/sessions/:sessionId/clinical-summary', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);

  if (!session.staff_verification?.verified) {
    return res.status(412).json({ code: 'NOT_STAFF_VERIFIED', message: 'Session not yet staff-verified; cannot open for physician review.' });
  }

  session.clinical_summary = { ...asPlain(session).clinical_summary, ...req.body };
  if (session.clinical_summary.signed_by_hpr_id && session.clinical_summary.signed_at) {
    session.status = 'physician_reviewed';
  }

  const saved = await saveSession(session);
  return res.status(200).json(asPlain(saved).clinical_summary);
});

// ============================= FHIR / ABDM sync =============================

router.post('/sessions/:sessionId/fhir-sync', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);

  const summary = asPlain(session).clinical_summary || {};
  if (!summary.signed_by_hpr_id || !summary.signed_at) {
    return res.status(412).json({ code: 'NOT_SIGNED', message: 'Summary not yet physician-signed.' });
  }

  const internalPayload = specAdapter.sessionToInternalIntake(session);
  const fhirBundle = convertToFhirR4Bundle(internalPayload);

  // Reuse the existing legacy storage so /api/v1/clinical/fhir/bundle/:intakeId
  // and /api/v1/clinical/patient/:id/summary also work for spec-based sessions.
  const legacyRecord = { ...internalPayload, status: 'VERIFIED_COMMITTED', fhirBundle };
  if (isMongoConnected()) {
    await ProvisionalIntake.findOneAndUpdate({ intakeId: session.session_id }, legacyRecord, { upsert: true, new: true });
  } else {
    await memoryStore.save('ProvisionalIntake', legacyRecord);
  }

  session.fhir_sync = specAdapter.fhirBundleToSpecSync(fhirBundle);
  session.status = 'synced_to_abdm';
  const saved = await saveSession(session);

  const io = req.app.get('io');
  if (io) io.emit('EHR_RECORD_COMMITTED', { sessionId: session.session_id, fhirBundleId: fhirBundle.id });

  return res.status(202).json(asPlain(saved).fhir_sync);
});

router.get('/sessions/:sessionId/fhir-sync', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);
  return res.status(200).json(asPlain(session).fhir_sync || { sync_status: 'not_applicable', synced_to_his: false, synced_to_abha: false });
});

// ============================= Post-consultation =============================

router.get('/sessions/:sessionId/post-consultation', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);
  return res.status(200).json(asPlain(session).post_consultation || {});
});

router.put('/sessions/:sessionId/post-consultation', requireBearerToken, async (req, res) => {
  const session = await findSession(req.params.sessionId);
  if (!session) return notFound(res);

  session.post_consultation = { ...(asPlain(session).post_consultation || {}), ...req.body };
  const saved = await saveSession(session);
  return res.status(200).json(asPlain(saved).post_consultation);
});

module.exports = router;
