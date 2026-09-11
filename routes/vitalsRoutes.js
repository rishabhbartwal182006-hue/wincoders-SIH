// ============================================================
//  routes/vitalsRoutes.js
//  MediKiosk — Vital Scanner Integration
//
//  Endpoints:
//    POST /api/v1/vitals/scan    → trigger ESP32 scan + save to session
//    GET  /api/v1/vitals/status  → health check (FastAPI + ESP32)
// ============================================================

const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const Session = require('../models/Session');
const { isMongoConnected, memoryStore } = require('../config/db');
const { analyzeDiscrepancies } = require('../services/discrepancyEngine');
const { detectRedFlags, mergeRedFlags } = require('../services/redFlagRules');
const specAdapter = require('../services/specAdapter');

// ── Config from .env ─────────────────────────────────────────
const SCANNER_URL = process.env.VITALS_SCANNER_URL || 'http://localhost:8000';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// ── Persistence helpers (same pattern as sessionRoutes.js) ───
async function findSession(sessionId) {
  if (isMongoConnected()) return Session.findOne({ session_id: sessionId });
  return memoryStore.findOne('Session', { session_id: sessionId });
}

async function saveSession(sessionDoc) {
  if (isMongoConnected()) return sessionDoc.save();
  return memoryStore.updateOne(
    'Session',
    { session_id: sessionDoc.session_id },
    sessionDoc.toObject ? sessionDoc.toObject() : sessionDoc
  );
}

// ── Clinical checks (same as sessionRoutes.js) ───────────────
function recomputeClinicalChecks(sessionDoc) {
  const internalPayload = specAdapter.sessionToInternalIntake(sessionDoc);
  const autoFlags = analyzeDiscrepancies(internalPayload);
  const specFlags = specAdapter.internalDiscrepanciesToSpec(autoFlags);

  const existingByRef = new Map(
    (sessionDoc.cross_check_discrepancies || []).map(d => [d.discrepancy_id, d])
  );
  for (const f of specFlags) {
    if (!existingByRef.has(f.discrepancy_id)) existingByRef.set(f.discrepancy_id, f);
  }
  sessionDoc.cross_check_discrepancies = Array.from(existingByRef.values());

  const newRedFlags = detectRedFlags(sessionDoc);
  sessionDoc.red_flags = mergeRedFlags(sessionDoc.red_flags || [], newRedFlags);

  const hasActiveUrgent = sessionDoc.red_flags.some(
    f => f.status === 'active' && (f.urgency_tier === 'critical' || f.urgency_tier === 'urgent')
  );
  if (hasActiveUrgent && ['draft', 'in_progress'].includes(sessionDoc.status)) {
    sessionDoc.status = 'red_flagged';
  }
}

// ══════════════════════════════════════════════════════════════
//  POST /api/v1/vitals/scan
//  Body: { session_id: "abc123" }
//
//  1. Calls FastAPI /api/scan-internal
//  2. Gets glucose reading from Groq (qwen/qwen3.8-27b)
//  3. Pushes VitalReading into session.vitals[]
//  4. Returns { success, reading, session_id }
// ══════════════════════════════════════════════════════════════
router.post('/scan', async (req, res) => {
  const { session_id } = req.body;

  if (!session_id) {
    return res.status(400).json({ success: false, error: 'session_id is required' });
  }

  // 1. Find or auto-create session
  let sessionDoc;
  try {
    sessionDoc = await findSession(session_id);
    if (!sessionDoc) {
      // Auto-create provisional session doc so scan succeeds even before intake is fully committed
      sessionDoc = new Session({
        session_id: session_id,
        kiosk_id: 'KIOSK-01',
        status: 'draft',
        vitals: []
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: `DB error: ${err.message}` });
  }

  // 2. Call FastAPI scanner microservice
  let scanResult;
  try {
    const response = await axios.post(
      `${SCANNER_URL}/api/scan-internal`,
      {
        api_key: GROQ_API_KEY,
        model: 'qwen/qwen3.8-27b',
        provider: 'groq'
      },
      { timeout: 45000 }
    );
    scanResult = response.data;
  } catch (err) {
    const detail = err.response?.data?.detail || err.message;
    return res.status(502).json({
      success: false,
      error: `Vitals scanner error: ${detail}`,
      hint: 'Make sure FastAPI is running at ' + SCANNER_URL
    });
  }

  if (!scanResult.success || !scanResult.vital) {
    return res.status(422).json({
      success: false,
      error: scanResult.error || 'AI could not extract a reading from the image',
      raw: scanResult
    });
  }

  const vital = scanResult.vital;

  // 3. Build VitalReading document matching Session.js VitalReadingSchema
  const vitalEntry = {
    type: vital.vital_type === 'blood_glucose' ? 'blood_glucose'
        : vital.vital_type === 'spo2'          ? 'spo2'
        : vital.vital_type === 'heart_rate'    ? 'heart_rate'
        : vital.vital_type === 'blood_pressure'? 'blood_pressure'
        : vital.vital_type === 'temperature'   ? 'temperature'
        : 'blood_glucose',                       // safe default
    value: vital.value,
    unit: vital.unit || 'mg/dL',
    source: 'device_reading',
    confidence: vital.confidence || null,
    recorded_at: new Date(),
    // store extra context in notes if available
    notes: vital.reading_status === 'memory_recall'
      ? `Memory recall reading. ${vital.clinical_notes || ''}`
      : vital.clinical_notes || ''
  };

  // 4. Push into session + recompute clinical flags
  if (!sessionDoc.vitals) sessionDoc.vitals = [];
  sessionDoc.vitals.push(vitalEntry);

  try {
    recomputeClinicalChecks(sessionDoc);
  } catch (_) {
    // Non-fatal — don't block saving if clinical check fails
  }

  try {
    await saveSession(sessionDoc);
  } catch (err) {
    return res.status(500).json({ success: false, error: `Failed to save session: ${err.message}` });
  }

  // 5. Return clean response to frontend
  return res.json({
    success: true,
    session_id,
    reading: {
      type: vitalEntry.type,
      value: vital.value,
      unit: vital.unit,
      confidence: vital.confidence,
      reading_status: vital.reading_status,
      device: `${vital.device_brand || ''} ${vital.device_model || ''}`.trim(),
      clinical_notes: vital.clinical_notes,
      is_memory: vital.reading_status === 'memory_recall'
    },
    timing: scanResult.timing
  });
});

// ══════════════════════════════════════════════════════════════
//  GET /api/v1/vitals/status
//  Returns health of FastAPI scanner + ESP32-CAM
// ══════════════════════════════════════════════════════════════
router.get('/status', async (req, res) => {
  let scannerOnline = false;
  let esp32Online   = false;
  let esp32Ip       = process.env.ESP32_URL || 'http://vitals-cam.local';

  // Check FastAPI
  try {
    const r = await axios.get(`${SCANNER_URL}/health`, { timeout: 3000 });
    scannerOnline = r.status === 200;
  } catch (_) {
    scannerOnline = false;
  }

  // Check ESP32 via FastAPI proxy (avoids mDNS issues in browser)
  if (scannerOnline) {
    try {
      const r = await axios.get(`${SCANNER_URL}/api/esp32-status`, { timeout: 5000 });
      esp32Online = r.data?.online === true;
    } catch (_) {
      esp32Online = false;
    }
  }

  return res.json({
    success: true,
    scanner_online: scannerOnline,
    esp32_online: esp32Online,
    esp32_url: esp32Ip,
    scanner_url: SCANNER_URL
  });
});

module.exports = router;
