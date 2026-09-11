/**
 * MediKiosk Altitude-Aware MVP Phase 3 Automated Test Suite
 * 
 * Verifies:
 * 1. FHIR R4 Bundle Observation extensions (altitude-context, algorithm-version), notes, and raw preservation
 * 2. Append-only, tamper-evident cryptographic SHA-256 hash chaining on AuditLog
 * 3. AuditLog event types (ALTITUDE_CONTEXT_APPLIED, ALTITUDE_RED_FLAG_TRIGGERED, ALTITUDE_INTERPRETATION_OVERRIDDEN)
 * 4. Demo Scenarios A & B data and execution
 * 5. Judge Pitch script line verification
 * 6. Pilot validation metrics documentation coverage
 * 7. Standardized safety and regulatory disclaimers
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { convertToFhirR4Bundle } = require('./services/fhirMapper');
const AuditLog = require('./models/AuditLog');
const { isMongoConnected, memoryStore } = require('./config/db');
const { interpretVitals, DISCLAIMER, ALGORITHM_VERSION } = require('./services/altitudeAdjustmentService');
const { runScenarioStandalone } = require('./demo/load_scenario');

let passedTests = 0;
let totalTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ✓ ${totalTests}. ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ✗ ${totalTests}. ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`[PASS] ✓ ${totalTests}. ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`[FAIL] ✗ ${totalTests}. ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function runAllPhase3Tests() {
  console.log('=======================================================');
  console.log('  ALTITUDE-AWARE MVP PHASE 3 TEST SUITE                ');
  console.log('  FHIR R4, Tamper-Evident Audit Chain, Scenarios, Docs ');
  console.log('=======================================================\n');

  // 1. FHIR Observation Extensions & Notes
  test('1. FHIR R4 Bundle embeds altitude-context extension, algorithm-version, and notes on Observations', () => {
    const mockSession = {
      session_id: 'SESS-FHIR-TEST-001',
      patient: {
        name: 'Tsering Dorje',
        abha_id: '91-1234-5678-9012',
        gender: 'male',
        age: 38
      },
      environment: {
        altitudeMeters: 2438,
        altitudeFeet: 8000,
        altitudeSource: 'facility_config',
        acclimatizationStatus: 'unacclimatized'
      },
      vitals: [
        {
          type: 'spo2',
          value: 88,
          unit: '%',
          source: 'device',
          altitudeContext: {
            altitudeMeters: 2438,
            expectedRange: [92, 97],
            status: 'critical',
            adjustedForAltitude: true,
            algorithmVersion: 'altitude-mvp-v1'
          }
        },
        {
          type: 'bp_systolic',
          value: 120,
          unit: 'mmHg',
          source: 'device',
          altitudeContext: {
            altitudeMeters: 2438,
            expectedRange: [90, 120],
            status: 'normal',
            adjustedForAltitude: false,
            algorithmVersion: 'altitude-mvp-v1'
          }
        },
        {
          type: 'bp_diastolic',
          value: 80,
          unit: 'mmHg',
          source: 'device'
        },
        {
          type: 'heart_rate',
          value: 86,
          unit: 'bpm',
          source: 'device',
          altitudeContext: {
            altitudeMeters: 2438,
            expectedRange: [65, 115],
            status: 'normal',
            adjustedForAltitude: true,
            algorithmVersion: 'altitude-mvp-v1'
          }
        }
      ]
    };

    const bundle = convertToFhirR4Bundle(mockSession);
    assert.strictEqual(bundle.resourceType, 'Bundle');
    assert.ok(bundle.type === 'document' || bundle.type === 'collection', 'Bundle type should be document or collection');

    const observations = bundle.entry
      .filter(e => e.resource && e.resource.resourceType === 'Observation')
      .map(e => e.resource);

    assert.ok(observations.length >= 2, 'Should generate Observation resources for vitals');

    // Check SpO2 Observation
    const spo2Obs = observations.find(o => o.code?.coding?.some(c => c.code === '2708-6' || c.display?.includes('SpO2')));
    assert.ok(spo2Obs, 'SpO2 Observation must be present');
    assert.strictEqual(spo2Obs.valueQuantity.value, 88, 'Raw value 88 must be strictly preserved in valueQuantity');

    const altExt = spo2Obs.extension?.find(e => e.url === 'https://medikiosk.example/fhir/StructureDefinition/altitude-context');
    assert.ok(altExt, 'altitude-context extension must be present on SpO2 observation');
    assert.ok(altExt.valueString.includes('2438 m'), 'altitude-context must include elevation in meters');
    assert.ok(altExt.valueString.includes('source=facility_config'), 'altitude-context must include source');
    assert.ok(altExt.valueString.includes('acclimatization=unacclimatized'), 'altitude-context must include acclimatization');

    const algoExt = spo2Obs.extension?.find(e => e.url === 'https://medikiosk.example/fhir/StructureDefinition/algorithm-version');
    assert.ok(algoExt, 'algorithm-version extension must be present');
    assert.strictEqual(algoExt.valueString, 'altitude-mvp-v1');

    assert.ok(spo2Obs.note && spo2Obs.note.length > 0, 'SpO2 observation must have clinical notes');
    assert.ok(spo2Obs.note[0].text.includes('Altitude-adjusted interpretation'), 'Note must contain altitude interpretation');
    assert.ok(spo2Obs.note[0].text.includes('2438 m'), 'Note must reference current altitude');

    // Check Blood Pressure Observation
    const bpObs = observations.find(o => o.code?.coding?.some(c => c.code === '85354-9' || c.display?.includes('Blood pressure')));
    assert.ok(bpObs, 'BP Observation must be present');
    const bpAltExt = bpObs.extension?.find(e => e.url === 'https://medikiosk.example/fhir/StructureDefinition/altitude-context');
    assert.ok(bpAltExt, 'altitude-context extension must also be present on BP Observation');
    assert.ok(bpObs.note && bpObs.note.length > 0, 'BP Observation must have clinical notes preserving normotensive threshold');
  });

  // 2. AuditLog Schema & Actions
  await testAsync('2. AuditLog supports ALTITUDE_CONTEXT_APPLIED, ALTITUDE_RED_FLAG_TRIGGERED, and ALTITUDE_INTERPRETATION_OVERRIDDEN', async () => {
    const testSessionId = `SESS-AUDIT-${Date.now()}`;

    // A. Context Applied
    const log1 = await AuditLog.recordAuditLog({
      action: 'ALTITUDE_CONTEXT_APPLIED',
      sessionId: testSessionId,
      altitudeMeters: 2438,
      altitudeSource: 'facility_config',
      algorithmVersion: 'altitude-mvp-v1',
      userId: 'KIOSK-NURSE-01',
      details: { acclimatizationStatus: 'unacclimatized' }
    });

    assert.ok(log1, 'Audit log 1 must be created');
    assert.strictEqual(log1.action, 'ALTITUDE_CONTEXT_APPLIED');
    assert.strictEqual(log1.sessionId, testSessionId);
    assert.strictEqual(log1.altitudeMeters, 2438);
    assert.strictEqual(log1.algorithmVersion, 'altitude-mvp-v1');
    assert.ok(log1.hash, 'Hash must be generated');

    // B. Red Flag Triggered
    const log2 = await AuditLog.recordAuditLog({
      action: 'ALTITUDE_RED_FLAG_TRIGGERED',
      sessionId: testSessionId,
      altitudeMeters: 2438,
      altitudeSource: 'facility_config',
      algorithmVersion: 'altitude-mvp-v1',
      userId: 'TRIAGE_ENGINE',
      details: { flagReason: 'Hypoxemia with danger symptoms', urgencyTier: 'critical' }
    });

    assert.ok(log2, 'Audit log 2 must be created');
    assert.strictEqual(log2.action, 'ALTITUDE_RED_FLAG_TRIGGERED');
    assert.strictEqual(log2.prevHash, log1.hash, 'Log 2 prevHash must link to Log 1 hash');

    // C. Interpretation Overridden
    const log3 = await AuditLog.recordAuditLog({
      action: 'ALTITUDE_INTERPRETATION_OVERRIDDEN',
      sessionId: testSessionId,
      altitudeMeters: 2438,
      altitudeSource: 'facility_config',
      algorithmVersion: 'altitude-mvp-v1',
      userId: 'DOC-12345',
      performedBy: 'Dr. Sharma',
      hprId: 'HPR-DOC-987',
      details: { overrideReason: 'Known chronic COPD', overrideStatus: 'normal' }
    });

    assert.ok(log3, 'Audit log 3 must be created');
    assert.strictEqual(log3.action, 'ALTITUDE_INTERPRETATION_OVERRIDDEN');
    assert.strictEqual(log3.prevHash, log2.hash, 'Log 3 prevHash must link to Log 2 hash');
  });

  // 3. Cryptographic Hash Chaining & Tamper-Evidence Verification
  test('3. AuditLog cryptographic hash chaining detects tampering and verifies chain integrity', () => {
    const chain = [];
    let prev = 'GENESIS';

    const events = [
      { action: 'ALTITUDE_CONTEXT_APPLIED', payload: { altitudeMeters: 2438 } },
      { action: 'ALTITUDE_RED_FLAG_TRIGGERED', payload: { flag: 'Hypoxemia' } },
      { action: 'ALTITUDE_INTERPRETATION_OVERRIDDEN', payload: { reason: 'Clinician sign-off' } }
    ];

    events.forEach((ev, i) => {
      const ts = new Date(Date.now() + i * 1000);
      const hash = AuditLog.computeEntryHash(prev, ts, ev.action, ev.payload);
      chain.push({
        logId: `AUDIT-TEST-${i}`,
        action: ev.action,
        timestamp: ts,
        prevHash: prev,
        hash: hash,
        payload: ev.payload
      });
      prev = hash;
    });

    // Verify pristine chain
    const verifyResult = AuditLog.verifyAuditChain(chain);
    assert.strictEqual(verifyResult.valid, true, 'Pristine chain must verify as valid');
    assert.strictEqual(verifyResult.count, 3, 'Pristine chain should contain 3 entries');

    // Tamper with second entry's payload
    const tamperedChain = JSON.parse(JSON.stringify(chain));
    tamperedChain[1].payload.flag = 'TAMPERED_CONTENT_MALICIOUS_EDIT';
    const tamperedResult = AuditLog.verifyAuditChain(tamperedChain);
    assert.strictEqual(tamperedResult.valid, false, 'Tampered chain must be detected as invalid');
    assert.strictEqual(tamperedResult.brokenIndex, 1, 'Tampered index must be 1');
  });

  // 4. Scenario A: Sea Level Severe Hypoxemia Simulation
  await testAsync('4. Scenario A execution: Sea level 0m, SpO2 88%, no symptoms -> Critical Red Flag', async () => {
    const resA = await runScenarioStandalone('scenario_a');
    assert.strictEqual(resA.scenario.environment.altitudeMeters, 0);
    assert.ok(resA.redFlags.length > 0, 'Scenario A must trigger red flag');
    
    const flag = resA.redFlags[0];
    assert.ok(
      (flag.flag_type && flag.flag_type.includes('hypoxemia')) || 
      (flag.reason && flag.reason.includes('hypoxemia')),
      'Red flag must indicate hypoxemia'
    );
    assert.strictEqual(flag.urgency_tier || flag.urgencyTier, 'critical');

    // SpO2 reading interpretation
    const spo2 = resA.interpretedVitals.find(v => v.type === 'spo2');
    assert.strictEqual(spo2.status, 'critical');
    assert.strictEqual(spo2.rawValue, 88);
  });

  // 5. Scenario B: High Altitude (8,000 ft) Hypoxemia with Danger Symptoms Simulation
  await testAsync('5. Scenario B execution: 8,000 ft (2,438 m), SpO2 88%, BP 120/80, chest tightness -> BP normal, SpO2 Red Flag', async () => {
    const resB = await runScenarioStandalone('scenario_b');
    assert.strictEqual(resB.scenario.environment.altitudeMeters, 2438);

    // Blood Pressure must be NORMAL and not altitude-adjusted
    const bpSys = resB.interpretedVitals.find(v => v.type === 'bp_systolic');
    const bpDia = resB.interpretedVitals.find(v => v.type === 'bp_diastolic');
    assert.strictEqual(bpSys.status, 'normal', 'Systolic 120 mmHg at 8,000 ft must be normal');
    assert.strictEqual(bpSys.adjustedForAltitude, false, 'BP systolic must NOT be adjusted upward for altitude');
    assert.strictEqual(bpDia.status, 'normal', 'Diastolic 80 mmHg at 8,000 ft must be normal');
    assert.strictEqual(bpDia.adjustedForAltitude, false, 'BP diastolic must NOT be adjusted upward for altitude');

    // SpO2 88% + danger symptom (chest tightness) -> Critical Red Flag
    assert.ok(resB.redFlags.length > 0, 'Scenario B must trigger red flag due to danger symptom');
    const dangerFlag = resB.redFlags.find(rf => (rf.reason || rf.flag_type || '').includes('danger'));
    assert.ok(dangerFlag, 'Red flag must identify hypoxemia with danger symptoms');
  });

  // 6. Judge Pitch Script Line Exact Match
  test('6. Judge pitch script exists and contains the exact required pitch quote', () => {
    const scriptPath = path.resolve(__dirname, 'demo/judge_pitch_demo_script.txt');
    assert.ok(fs.existsSync(scriptPath), 'demo/judge_pitch_demo_script.txt must exist');

    const content = fs.readFileSync(scriptPath, 'utf-8');
    const expectedLine = 'We don’t need altitude hardware. We need altitude context. The kiosk already captures symptoms and vitals. Our MVP adds a configurable altitude profile and rule engine that interprets readings in context, while preserving raw data and keeping the clinician in control.';
    
    // Normalize curly quotes and spaces for strict verification
    const normalizedContent = content.replace(/['']/g, "'").replace(/\s+/g, ' ');
    const normalizedExpected = expectedLine.replace(/['']/g, "'").replace(/\s+/g, ' ');

    assert.ok(
      normalizedContent.includes(normalizedExpected),
      'Judge pitch script must contain the exact pitch quote'
    );
  });

  // 7. Pilot Validation Metrics Documentation
  test('7. docs/pilot_validation_metrics.md documents all 7 clinical validation metrics', () => {
    const docPath = path.resolve(__dirname, 'docs/pilot_validation_metrics.md');
    assert.ok(fs.existsSync(docPath), 'docs/pilot_validation_metrics.md must exist');

    const content = fs.readFileSync(docPath, 'utf-8');
    const requiredMetrics = [
      'SpO2 Accuracy vs Clinical Assessment',
      'BP Device Accuracy',
      'Red-Flag Sensitivity',
      'False-Alert Rate',
      'Doctor Override Rate',
      'Time to Escalation',
      'Patient Comprehension'
    ];

    for (const metric of requiredMetrics) {
      assert.ok(
        content.toLowerCase().includes(metric.toLowerCase()),
        `Documentation must include metric: ${metric}`
      );
    }
  });

  // 8. Standardized Safety & Regulatory Disclaimer
  test('8. Standardized disclaimer text is present and consistent across system artifacts', () => {
    const expectedDisclaimer = 'Decision-support MVP. Illustrative altitude profiles. Raw values preserved. Clinician sign-off required. Pilot validation needed.';
    assert.strictEqual(
      DISCLAIMER,
      expectedDisclaimer,
      'services/altitudeAdjustmentService.js must expose the standardized disclaimer'
    );

    const profilesPath = path.resolve(__dirname, 'config/altitudeProfiles.json');
    const profiles = JSON.parse(fs.readFileSync(profilesPath, 'utf-8'));
    assert.strictEqual(
      profiles._disclaimer,
      expectedDisclaimer,
      'config/altitudeProfiles.json must contain the standardized disclaimer'
    );
  });

  console.log('\n=======================================================');
  console.log(`  PHASE 3 TESTS FINISHED: ${passedTests} PASSED, ${totalTests - passedTests} FAILED`);
  console.log('=======================================================\n');
}

runAllPhase3Tests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
