const assert = require('assert');
const http = require('http');
const app = require('./server');
const { getAltitudeProfile, interpretVitals } = require('./services/altitudeAdjustmentService');
const { detectRedFlags } = require('./services/redFlagRules');
const ProvisionalIntake = require('./models/ProvisionalIntake');
const AuditLog = require('./models/AuditLog');
const { isMongoConnected, memoryStore } = require('./config/db');

const PORT = 4002;
let server;

function request(options, postData) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, rawBody: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runPhase2Tests() {
  console.log('=======================================================');
  console.log('  ALTITUDE-AWARE MVP PHASE 2 TEST SUITE               ');
  console.log('  Triage Rules, Red Flags, Override & HPR Security     ');
  console.log('=======================================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      passed++;
      console.log(`[PASS] ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] ✗ ${name}:`, err.message);
    }
  }

  async function testAsync(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`[PASS] ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] ✗ ${name}:`, err.message);
    }
  }

  // --- UNIT TESTS: Altitude Triage Engine Logic & Red Flag Rules ---

  test('1. Scenario A: Sea Level SpO2 88% triggers RED FLAG (severe hypoxemia)', () => {
    const session = {
      session_id: 'test-sea-level-88',
      environment: { altitudeMeters: 0, altitudeFeet: 0 },
      vitals: [{ type: 'spo2', value: 88, unit: '%' }],
      intake: { symptoms: [] }
    };
    const flags = detectRedFlags(session);
    const hypoxemiaFlag = flags.find(f => f.flag_type.includes('hypoxemia'));
    assert.ok(hypoxemiaFlag, 'Should generate a hypoxemia red flag at sea level for SpO2 88%');
    assert.strictEqual(hypoxemiaFlag.urgency_tier, 'critical');
    assert.strictEqual(hypoxemiaFlag.altitude_context?.altitudeMeters, 0);
  });

  test('2. Scenario B: 8,000 ft (2,438 m) SpO2 88% with chest tightness triggers RED FLAG', () => {
    const session = {
      session_id: 'test-high-alt-chest-pain',
      environment: { altitudeMeters: 2438, altitudeFeet: 8000 },
      vitals: [{ type: 'spo2', value: 88, unit: '%' }],
      intake: { symptoms: [{ symptom: 'chest tightness / discomfort' }] }
    };
    const flags = detectRedFlags(session);
    const dangerFlag = flags.find(f => f.flag_type === 'hypoxemia_at_altitude_with_danger_symptoms');
    assert.ok(dangerFlag, 'Should trigger hypoxemia_at_altitude_with_danger_symptoms red flag');
    assert.strictEqual(dangerFlag.urgency_tier, 'critical');
    assert.strictEqual(dangerFlag.altitude_context?.hasDangerSymptoms, true);
  });

  test('3. Scenario C: 8,000 ft (2,438 m) SpO2 88% without danger symptoms is BORDERLINE (NOT red flag)', () => {
    const session = {
      session_id: 'test-high-alt-asymptomatic',
      environment: { altitudeMeters: 2438, altitudeFeet: 8000 },
      vitals: [{ type: 'spo2', value: 88, unit: '%' }],
      intake: { symptoms: [] }
    };
    const flags = detectRedFlags(session);
    const activeCriticalFlags = flags.filter(f => f.urgency_tier === 'critical');
    assert.strictEqual(activeCriticalFlags.length, 0, 'SpO2 88% without danger symptoms at 8,000 ft must NOT trigger critical red flag');

    // But interpretation service correctly flags it as borderline (not ignored)
    const interp = interpretVitals(session.vitals, session.environment);
    assert.strictEqual(interp[0].status, 'borderline', 'Must be flagged as borderline for clinical review');
  });

  test('4. Scenario D: 8,000 ft BP 120/80 mmHg is normal (no upward adjustment of BP normal range)', () => {
    const session = {
      session_id: 'test-high-alt-bp-normal',
      environment: { altitudeMeters: 2438, altitudeFeet: 8000 },
      vitals: [
        { type: 'bp_systolic', value: 120, unit: 'mmHg' },
        { type: 'bp_diastolic', value: 80, unit: 'mmHg' }
      ],
      intake: { symptoms: [] }
    };
    const flags = detectRedFlags(session);
    const bpFlags = flags.filter(f => f.flag_type?.includes('hypertens') || f.flag_type?.includes('blood_pressure'));
    assert.strictEqual(bpFlags.length, 0, 'Normal BP 120/80 at altitude must not trigger flags');

    const interp = interpretVitals(session.vitals, session.environment);
    assert.strictEqual(interp[0].status, 'normal');
    assert.strictEqual(interp[1].status, 'normal');
    assert.strictEqual(interp[0].adjustedForAltitude, false, 'BP systolic must NOT be adjusted upward for altitude');
    assert.strictEqual(interp[1].adjustedForAltitude, false, 'BP diastolic must NOT be adjusted upward for altitude');
  });

  test('5. Hypertensive Crisis (>=180 systolic or >=120 diastolic) triggers CRITICAL RED FLAG regardless of altitude', () => {
    const session = {
      session_id: 'test-hypertensive-crisis',
      environment: { altitudeMeters: 3000, altitudeFeet: 9842 },
      vitals: [
        { type: 'bp_systolic', value: 185, unit: 'mmHg' },
        { type: 'bp_diastolic', value: 122, unit: 'mmHg' }
      ],
      intake: { symptoms: [] }
    };
    const flags = detectRedFlags(session);
    const crisisFlag = flags.find(f => f.flag_type === 'hypertensive_crisis');
    assert.ok(crisisFlag, 'Should trigger hypertensive_crisis red flag');
    assert.strictEqual(crisisFlag.urgency_tier, 'critical');
  });

  test('6. Scenario E: Acute Mountain Sickness (AMS) criteria (>2500m + headache + nausea/dizziness/poor sleep)', () => {
    const sessionAms = {
      session_id: 'test-ams-patient',
      environment: { altitudeMeters: 2800, altitudeFeet: 9186 },
      vitals: [{ type: 'spo2', value: 92, unit: '%' }],
      intake: {
        symptoms: [
          { symptom: 'severe headache' },
          { symptom: 'nausea and vomiting' },
          { symptom: 'dizziness / lightheadedness' },
          { symptom: 'poor sleep / insomnia' }
        ]
      }
    };
    const flags = detectRedFlags(sessionAms);
    const amsFlag = flags.find(f => f.flag_type?.includes('mountain_sickness'));
    assert.ok(amsFlag, 'Should trigger acute mountain sickness flag');
    assert.strictEqual(amsFlag.urgency_tier, 'urgent');
    assert.strictEqual(amsFlag.altitude_context?.altitudeMeters, 2800);
  });

  // --- INTEGRATION TESTS: HTTP API, Override & HPR Security ---

  let createdSessionId = null;

  await testAsync('7. Create session with 8,000 ft altitude context via /api/v1/sessions', async () => {
    const createRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/sessions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer HPR_STAFF_DEV_TOKEN'
      }
    }, {
      kiosk_id: 'KIOSK-PHASE2-TEST',
      facility_id: 'FAC-MANALI-HP',
      language: 'en',
      patient: { name: 'Tsering Dorje', age: 34, heightCm: 172 }
    });

    assert.strictEqual(createRes.status, 201);
    createdSessionId = createRes.body.session_id;
    assert.ok(createdSessionId);

    // Set altitude to 8,000 ft
    const envRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/sessions/${createdSessionId}/environment`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer HPR_STAFF_DEV_TOKEN'
      }
    }, {
      altitudeMeters: 2438,
      altitudeSource: 'facility_config',
      acclimatizationStatus: 'unacclimatized'
    });

    assert.strictEqual(envRes.status, 200);
    assert.strictEqual(envRes.body.environment?.altitudeMeters || envRes.body.altitudeMeters, 2438);
    assert.strictEqual(envRes.body.environment?.altitudeFeet || envRes.body.altitudeFeet, 8000);
  });

  await testAsync('8. Post SpO2 88% with chest pain -> status escalates to red_flagged', async () => {
    // Add symptom: chest tightness via PUT
    await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/sessions/${createdSessionId}/intake`,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer HPR_STAFF_DEV_TOKEN'
      }
    }, {
      chief_complaint: { value: 'chest tightness and breathlessness at rest' },
      symptoms: [{ symptom: 'chest tightness and breathlessness at rest', severity: 8 }]
    });

    // Post vitals: SpO2 88%
    const vitalsRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/sessions/${createdSessionId}/vitals`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer HPR_STAFF_DEV_TOKEN'
      }
    }, {
      vitals: [
        { type: 'spo2', value: 88, unit: '%' },
        { type: 'bp_systolic', value: 120, unit: 'mmHg' },
        { type: 'bp_diastolic', value: 80, unit: 'mmHg' }
      ]
    });

    assert.strictEqual(vitalsRes.status, 201);

    // Verify GET /api/v1/sessions/:id/red-flags returns altitude red flag
    const flagsRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/sessions/${createdSessionId}/red-flags`,
      method: 'GET',
      headers: { 'Authorization': 'Bearer HPR_STAFF_DEV_TOKEN' }
    });

    assert.strictEqual(flagsRes.status, 200);
    const dangerFlag = flagsRes.body.find(f => f.flag_type === 'hypoxemia_at_altitude_with_danger_symptoms');
    assert.ok(dangerFlag, 'Red flag list must include altitude danger symptoms flag');
    assert.strictEqual(dangerFlag.status, 'active');
  });

  await testAsync('9. Doctor Altitude Interpretation Override updates status and creates AuditLog', async () => {
    const overrideRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/sessions/${createdSessionId}/altitude-override`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer HPR_STAFF_DEV_TOKEN'
      }
    }, {
      doctorHprId: 'HPR-DOC-DR-SHARMA-01',
      doctorName: 'Dr. Rajesh Sharma, MD',
      vitalType: 'spo2',
      overrideStatus: 'normal',
      overrideReason: 'Patient is chronic high-altitude resident, asymptomatic on clinical exam',
      clearedFastTrack: true
    });

    assert.strictEqual(overrideRes.status, 200);
    assert.strictEqual(overrideRes.body.success, true);
    assert.strictEqual(overrideRes.body.status, 'in_progress', 'Status must be de-escalated from red_flagged');

    // Check that an AuditLog was recorded
    let auditLog;
    if (isMongoConnected()) {
      auditLog = await AuditLog.findOne({ intakeId: createdSessionId, action: 'ALTITUDE_INTERPRETATION_OVERRIDE' });
    } else {
      auditLog = await memoryStore.findOne('AuditLog', { intakeId: createdSessionId, action: 'ALTITUDE_INTERPRETATION_OVERRIDE' });
    }

    assert.ok(auditLog, 'AuditLog entry must be created for altitude override');
    assert.strictEqual(auditLog.performedBy, 'Dr. Rajesh Sharma, MD');
    assert.strictEqual(auditLog.hprId, 'HPR-DOC-DR-SHARMA-01');
  });

  await testAsync('10. Clinical Dashboard Patient Summary endpoint exposes altitude data', async () => {
    // Save a provisional intake with altitude context
    const provRecord = {
      intakeId: 'PROV-PHASE2-TEST',
      abhaId: 'ABHA-PHASE2-TEST',
      patientDemographics: { fullName: 'Padma Wangchuk', gender: 'M', age: 42, heightCm: 168 },
      environment: {
        altitudeMeters: 2438,
        altitudeFeet: 8000,
        altitudeSource: 'facility_config',
        altitudeConfidence: 1.0,
        acclimatizationStatus: 'unacclimatized'
      },
      vitals: {
        spo2: { value: 94, unit: '%', provenanceMeta: { provenance: 'device-captured', confidence: 1.0 } },
        bloodPressure: {
          systolic: { value: 120, unit: 'mmHg', provenanceMeta: { provenance: 'device-captured', confidence: 1.0 } },
          diastolic: { value: 80, unit: 'mmHg', provenanceMeta: { provenance: 'device-captured', confidence: 1.0 } }
        },
        heartRate: { value: 78, unit: 'bpm', provenanceMeta: { provenance: 'device-captured', confidence: 1.0 } }
      },
      chiefComplaints: [{ symptom: 'Routine health checkup', severity: 'Mild' }],
      status: 'PROVISIONAL'
    };

    if (isMongoConnected()) {
      await ProvisionalIntake.findOneAndUpdate({ intakeId: 'PROV-PHASE2-TEST' }, provRecord, { upsert: true });
    } else {
      await memoryStore.save('ProvisionalIntake', provRecord);
    }

    const intakeRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/clinical/patient/PROV-PHASE2-TEST/summary',
      method: 'GET'
    });

    assert.strictEqual(intakeRes.status, 200);
    assert.strictEqual(intakeRes.body.data.environment.altitudeMeters, 2438);
    assert.ok(intakeRes.body.data.preConsultationSummary.section1_vitals.spo2.altitudeContext);
    assert.strictEqual(intakeRes.body.data.preConsultationSummary.section1_vitals.spo2.altitudeContext.status, 'normal');
    assert.strictEqual(intakeRes.body.data.preConsultationSummary.section1_vitals.bloodPressure.altitudeContext.systolic.adjustedForAltitude, false);
  });

  await testAsync('11. HPR Biometric Commit Write-Lock is strictly required and cannot be bypassed', async () => {
    // Unauthorized attempt to verify/lock without HPR token must be rejected with 401
    const unauthCommit = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/doctor/verify',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      intakeId: createdSessionId,
      doctorNotes: 'Attempting commit without token'
    });

    assert.strictEqual(unauthCommit.status, 401, 'Unauthenticated commit must return 401');

    // Attempting commit with invalid token must also be rejected
    const invalidCommit = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/doctor/verify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer INVALID_HPR_TOKEN_999'
      }
    }, {
      intakeId: createdSessionId,
      doctorNotes: 'Attempting commit with invalid token'
    });

    assert.strictEqual(invalidCommit.status, 401, 'Invalid HPR token must return 401');
  });

  console.log('\n=======================================================');
  console.log(`  PHASE 2 TESTS FINISHED: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

server = app.listen(PORT, () => {
  console.log(`Test server running on port ${PORT}`);
  runPhase2Tests()
    .then(() => {
      server.close(() => process.exit(0));
    })
    .catch((err) => {
      console.error('Fatal test runner error:', err);
      server.close(() => process.exit(1));
    });
});
