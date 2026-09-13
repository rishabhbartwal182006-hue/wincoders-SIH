const express = require('express');
const router = express.Router();
const ProvisionalIntake = require('../models/ProvisionalIntake');
const AuditLog = require('../models/AuditLog');
const { isMongoConnected, memoryStore } = require('../config/db');
const { analyzeDiscrepancies } = require('../services/discrepancyEngine');
const { evaluateMultiSystemTriage } = require('../services/redFlagRules');

/**
 * Kiosk Ingestion Handler (supports both Task 5 & Frontend Event contracts)
 */
async function handleKioskIngestion(req, res) {
  try {
    const payload = req.body || {};

    // Normalize IDs (support intakeId/sessionId and abhaId/patientId)
    const intakeId = payload.intakeId || payload.sessionId || `INTAKE-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
    const abhaId = payload.abhaId || payload.patientId || `ABHA-${Date.now()}`;

    if (!payload.abhaId && !payload.patientId && !payload.patientDemographics?.fullName) {
      payload.abhaId = abhaId;
    }

    // Default patient demographics if missing
    if (!payload.patientDemographics) {
      payload.patientDemographics = {
        fullName: payload.patientId || payload.fullName || "Anonymous Patient",
        gender: payload.gender || "M",
        age: payload.age || 45,
        provenanceMeta: {
          provenance: 'touch-selected',
          confidence: 1.0,
          timestamp: new Date()
        }
      };
    } else if (!payload.patientDemographics.provenanceMeta) {
      payload.patientDemographics.provenanceMeta = {
        provenance: 'touch-selected',
        confidence: 1.0,
        timestamp: new Date()
      };
    }

    // Provenance Tagging Defaults for Vitals
    if (payload.vitals) {
      ['bloodPressure', 'spo2', 'heartRate', 'temperature', 'bloodGlucose'].forEach(vKey => {
        if (payload.vitals[vKey] && typeof payload.vitals[vKey] === 'object' && !payload.vitals[vKey].provenanceMeta) {
          payload.vitals[vKey].provenanceMeta = {
            provenance: 'device-captured',
            confidence: 0.99,
            timestamp: new Date()
          };
        }
      });
    }

    // Run Cross-Verification Discrepancy Engine
    const autoDiscrepancies = analyzeDiscrepancies(payload);
    const combinedDiscrepancies = [
      ...(payload.discrepancyFlags || []),
      ...autoDiscrepancies
    ];

    const uniqueDiscrepancies = Array.from(
      new Map(combinedDiscrepancies.map(item => [item.flagId || item.message, item])).values()
    );

    // Evaluate multi-system red flags and clinical triage level via clinical rules engine
    const triageEval = evaluateMultiSystemTriage(payload);
    const computedTriageLevel = triageEval.triageLevel || 'ROUTINE';

    const provisionalRecord = {
      ...payload,
      intakeId: intakeId,
      abhaId: abhaId,
      status: payload.status || 'PROVISIONAL',
      triage: {
        ...(payload.triage || {}),
        triageLevel: computedTriageLevel,
        urgencyScore: triageEval.urgencyScore || 3,
        recommendedDepartment: payload.triage?.recommendedDepartment || (computedTriageLevel === 'EMERGENCY' ? 'Emergency Department' : computedTriageLevel === 'URGENT' ? 'Urgent Care Clinic' : 'General Medicine'),
        protocolNotes: triageEval.reason || 'Standard Clinical Queue'
      },
      redFlags: triageEval.redFlags || [],
      discrepancyFlags: uniqueDiscrepancies,
      createdAt: payload.createdAt || new Date(),
      updatedAt: new Date()
    };

    // Database Persistence
    let savedRecord = null;
    if (isMongoConnected()) {
      savedRecord = await ProvisionalIntake.findOneAndUpdate(
        { intakeId: intakeId },
        provisionalRecord,
        { upsert: true, new: true }
      );
    } else {
      savedRecord = await memoryStore.save('ProvisionalIntake', provisionalRecord);
    }

    // Audit Logging
    const auditData = {
      logId: `AUDIT-INTAKE-${Date.now()}`,
      action: 'KIOSK_INTAKE_RECEIVED',
      intakeId: intakeId,
      abhaId: abhaId,
      performedBy: 'KIOSK_SELF_SERVICE_TERMINAL',
      ipAddress: req.ip || '127.0.0.1',
      details: {
        vitalsCaptured: !!payload.vitals,
        ocrDocsCount: payload.ocrDocuments ? payload.ocrDocuments.length : 0,
        chiefComplaintsCount: payload.chiefComplaints ? payload.chiefComplaints.length : 0,
        discrepanciesDetected: uniqueDiscrepancies.length,
        triageLevel: computedTriageLevel,
        redFlagsCount: triageEval.redFlags?.length || 0
      },
      timestamp: new Date()
    };

    if (isMongoConnected()) {
      await AuditLog.create(auditData);
    } else {
      await memoryStore.save('AuditLog', auditData);
    }

    // Broadcast Socket.io Event to update Doctor Dashboard UI in real time
    const io = req.app.get('io');
    if (io) {
      io.emit('PATIENT_EVENT_RECEIVED', {
        sessionId: savedRecord.intakeId,
        patientId: savedRecord.abhaId,
        status: savedRecord.status,
        timestamp: new Date().toISOString()
      });
      io.emit('TRIAGE_UPDATED', {
        sessionId: savedRecord.intakeId,
        status: savedRecord.status,
        triageResult: {
          patientId: savedRecord.abhaId,
          triageLevel: savedRecord.triage?.triageLevel || 'ROUTINE',
          reason: savedRecord.triage?.protocolNotes || savedRecord.hpi?.narrative || 'Kiosk intake processed.',
          action: savedRecord.triage?.protocolNotes || 'Standard Clinical Queue',
          triggeredRules: [
            ...uniqueDiscrepancies.map(d => d.message),
            ...(triageEval.redFlags || []).map(r => r.reason)
          ],
          timestamp: new Date().toISOString()
        }
      });
      io.emit('kiosk:intake_submitted', {
        sessionId: savedRecord.intakeId,
        intakeId: savedRecord.intakeId,
        patientId: savedRecord.abhaId,
        patientName: savedRecord.patientDemographics?.fullName,
        triageLevel: savedRecord.triage?.triageLevel || 'ROUTINE',
        urgencyScore: savedRecord.triage?.urgencyScore || 3,
        redFlags: triageEval.redFlags || [],
        status: savedRecord.status,
        timestamp: new Date().toISOString(),
        vitals: savedRecord.vitals,
        symptoms: savedRecord.chiefComplaints
      });

      if (computedTriageLevel === 'EMERGENCY') {
        io.emit('ESCALATION_REQUIRED', {
          sessionId: savedRecord.intakeId,
          patientId: savedRecord.abhaId,
          session: { sessionId: savedRecord.intakeId, patientId: savedRecord.abhaId },
          triageLevel: 'EMERGENCY',
          urgencyScore: 10,
          redFlags: triageEval.redFlags,
          reason: triageEval.reason,
          timestamp: new Date().toISOString()
        });
      }
    }

    return res.status(201).json({
      success: true,
      message: "Kiosk intake successfully ingested and persisted in PROVISIONAL state.",
      data: {
        intakeId: savedRecord.intakeId,
        sessionId: savedRecord.intakeId,
        abhaId: savedRecord.abhaId,
        patientId: savedRecord.abhaId,
        status: savedRecord.status,
        patientName: savedRecord.patientDemographics?.fullName,
        discrepanciesDetected: uniqueDiscrepancies.length,
        discrepancyFlags: uniqueDiscrepancies,
        clinicalSummaryUrl: `/api/v1/clinical/patient/${savedRecord.abhaId}/summary`
      }
    });

  } catch (err) {
    console.error(`[Kiosk Ingestion Error]: ${err.message}`, err);
    return res.status(500).json({
      success: false,
      error: "INGESTION_FAILED",
      message: `Failed to process kiosk intake: ${err.message}`
    });
  }
}

// Ingestion Routes & Aliases
router.post('/intake', handleKioskIngestion);
router.post('/submit', handleKioskIngestion);

module.exports = router;
module.exports.handleKioskIngestion = handleKioskIngestion;
