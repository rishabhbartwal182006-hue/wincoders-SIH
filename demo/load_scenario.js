#!/usr/bin/env node
/**
 * MediKiosk Altitude-Aware Demo Scenario Loader
 * 
 * Injects Scenario A (Sea level severe hypoxemia) or Scenario B (8,000 ft hypoxemia with chest tightness)
 * into a MediKiosk session and prints verified clinical triage and interpretation results.
 * 
 * Usage:
 *   node demo/load_scenario.js --scenario=a
 *   node demo/load_scenario.js --scenario=b
 *   node demo/load_scenario.js --all
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const scenariosData = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'altitude_scenarios.json'), 'utf-8')
);

// Fallback / standalone services for in-process execution if HTTP server is offline
const { interpretVitals, DISCLAIMER } = require('../services/altitudeAdjustmentService');
const { detectRedFlags } = require('../services/redFlagRules');
const { convertToFhirR4Bundle } = require('../services/fhirMapper');
const AuditLog = require('../models/AuditLog');

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || 'localhost';

function makeRequest(method, endpoint, data = null) {
  return new Promise((resolve, reject) => {
    const payload = data ? JSON.stringify(data) : null;
    const options = {
      hostname: HOST,
      port: PORT,
      path: endpoint,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer mock-kiosk-token-12345',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch {
          resolve({ statusCode: res.statusCode, body });
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

async function runScenarioViaApi(scenarioKey) {
  const sc = scenariosData.scenarios[scenarioKey];
  if (!sc) throw new Error(`Scenario "${scenarioKey}" not found`);

  const sessionId = `DEMO-${Date.now()}-${scenarioKey}`;

  // 1. Create session
  await makeRequest('POST', '/api/v1/sessions', {
    kiosk_id: 'KIOSK-DEMO-01',
    facility_id: 'FACILITY-HIGH-ALT',
    language: 'en',
    input_mode: 'touch',
    patient: sc.patient
  });

  // 2. Set environment
  const envRes = await makeRequest('POST', `/api/v1/sessions/${sessionId}/environment`, sc.environment);

  // 3. Set intake
  await makeRequest('PUT', `/api/v1/sessions/${sessionId}/intake`, sc.intake);

  // 4. Submit vitals
  const vitalsRes = await makeRequest('POST', `/api/v1/sessions/${sessionId}/vitals`, {
    vitals: sc.vitals,
    entryMode: 'device',
    symptoms: [
      sc.intake.chief_complaint?.value,
      ...(sc.intake.hpi?.associated_symptoms || []).map(s => s.value)
    ]
  });

  // 5. Get interpreted vitals
  const interpRes = await makeRequest('GET', `/api/v1/sessions/${sessionId}/vitals/interpreted`);

  // 6. Get red flags
  const redFlagsRes = await makeRequest('GET', `/api/v1/sessions/${sessionId}/red-flags`);

  return {
    mode: 'api',
    sessionId,
    scenario: sc,
    environment: envRes.body.environment,
    interpretedVitals: interpRes.body.interpretedVitals || vitalsRes.body.interpretedVitals,
    redFlags: redFlagsRes.body || []
  };
}

async function runScenarioStandalone(scenarioKey) {
  const sc = scenariosData.scenarios[scenarioKey];
  if (!sc) throw new Error(`Scenario "${scenarioKey}" not found`);

  const symptoms = [
    sc.intake.chief_complaint?.value,
    ...(sc.intake.hpi?.associated_symptoms || []).map(s => s.value)
  ].filter(Boolean);

  const interpreted = interpretVitals(sc.vitals, sc.environment, symptoms);

  const mockSession = {
    session_id: `DEMO-STANDALONE-${Date.now()}`,
    environment: sc.environment,
    patient: sc.patient,
    intake: sc.intake,
    vitals: sc.vitals.map(v => {
      const match = interpreted.find(iv => iv.type === v.type);
      return {
        ...v,
        altitudeContext: match ? {
          altitudeMeters: match.altitudeMeters,
          expectedRange: match.expectedRange,
          status: match.status,
          adjustedForAltitude: match.adjustedForAltitude,
          algorithmVersion: match.algorithmVersion
        } : null,
        flagged_abnormal: match ? (match.status === 'critical' || match.status === 'borderline') : false
      };
    })
  };

  const detectedFlags = detectRedFlags(mockSession);
  const fhirBundle = convertToFhirR4Bundle(mockSession);
  const auditEntry = await AuditLog.recordAuditLog({
    action: detectedFlags.length > 0 ? 'ALTITUDE_RED_FLAG_TRIGGERED' : 'ALTITUDE_CONTEXT_APPLIED',
    sessionId: mockSession.session_id,
    altitudeMeters: sc.environment.altitudeMeters,
    altitudeSource: sc.environment.altitudeSource,
    algorithmVersion: 'altitude-mvp-v1',
    userId: 'DEMO_LOADER',
    details: {
      scenarioId: sc.id,
      hasRedFlag: detectedFlags.length > 0,
      redFlags: detectedFlags.map(rf => rf.reason || rf.flag_type)
    }
  });

  return {
    mode: 'standalone_simulation',
    sessionId: mockSession.session_id,
    scenario: sc,
    environment: sc.environment,
    interpretedVitals: interpreted,
    redFlags: detectedFlags,
    fhirBundle,
    auditEntry
  };
}

function printScenarioReport(result) {
  const sc = result.scenario;
  const env = result.environment;
  const vitals = result.interpretedVitals || [];
  const redFlags = result.redFlags || [];

  console.log('\n======================================================================');
  console.log(` 🏔️  MEDIKIOSK CLINICAL SCENARIO REPORT: ${sc.title.toUpperCase()}`);
  console.log('======================================================================');
  console.log(`Session ID     : ${result.sessionId} (${result.mode})`);
  console.log(`Patient        : ${sc.patient.name} (${sc.patient.gender}, ${sc.patient.age}y) | ABHA: ${sc.patient.abha_id}`);
  console.log(`Elevation      : ${env.altitudeMeters} m (${env.altitudeFeet || Math.round(env.altitudeMeters * 3.28084)} ft) [${env.altitudeSource}]`);
  console.log(`Acclimatization: ${env.acclimatizationStatus} (Confidence: ${env.altitudeConfidence})`);
  console.log(`Chief Complaint: "${sc.intake.chief_complaint?.value}"`);
  console.log('----------------------------------------------------------------------');
  console.log(' VITALS INTERPRETATION MATRIX (RAW PRESERVED vs ALTITUDE PROFILE):');
  console.log('----------------------------------------------------------------------');
  
  vitals.forEach(v => {
    const range = v.expectedRange ? `[${v.expectedRange[0]} - ${v.expectedRange[1]} ${v.unit}]` : 'N/A';
    const flagStr = v.status === 'critical' ? '🔴 CRITICAL' : v.status === 'borderline' ? '🟡 BORDERLINE' : '🟢 NORMAL';
    const adjStr = v.adjustedForAltitude ? '(Altitude-Adjusted Range)' : '(Standard Clinical Baseline)';
    console.log(` • ${v.type.padEnd(14)} : Raw = ${String(v.rawValue).padEnd(4)} ${v.unit.padEnd(6)} | Expected = ${range.padEnd(16)} | Status = ${flagStr} ${adjStr}`);
    if (v.clinicalReason) {
      console.log(`   └─ Clinical Rationale: ${v.clinicalReason}`);
    }
  });

  console.log('----------------------------------------------------------------------');
  console.log(' CLINICAL TRIAGE & RED FLAG ESCALATION:');
  console.log('----------------------------------------------------------------------');
  if (redFlags.length > 0) {
    console.log(` ⚠️  RED FLAGS ACTIVE: ${redFlags.length}`);
    redFlags.forEach((rf, i) => {
      console.log(`   ${i + 1}. [${rf.urgency_tier || rf.severity || 'CRITICAL'}] ${rf.name || rf.flag_type || rf.reason}`);
      console.log(`      Action   : ${rf.action || 'Physician Review Required'}`);
      console.log(`      FastTrack: ${rf.isFastTrack !== false ? 'YES (Immediate Doctor Alert & Tele-escalation)' : 'NO'}`);
    });
  } else {
    console.log(' 🟢 No critical red flags triggered. Standard triage queue.');
  }

  if (result.auditEntry) {
    console.log('----------------------------------------------------------------------');
    console.log(' TAMPER-EVIDENT CRYPTOGRAPHIC AUDIT LOG:');
    console.log('----------------------------------------------------------------------');
    console.log(` Log ID    : ${result.auditEntry.logId}`);
    console.log(` Action    : ${result.auditEntry.action}`);
    console.log(` Prev Hash : ${result.auditEntry.prevHash.substring(0, 16)}...`);
    console.log(` SHA-256   : ${result.auditEntry.hash}`);
  }

  console.log('----------------------------------------------------------------------');
  console.log(` DISCLAIMER: ${DISCLAIMER}`);
  console.log('======================================================================\n');
}

async function main() {
  const args = process.argv.slice(2);
  const scenarioArg = args.find(a => a.startsWith('--scenario='));
  const runAll = args.includes('--all') || !scenarioArg;
  const requested = scenarioArg ? scenarioArg.split('=')[1].toLowerCase() : null;

  const toRun = [];
  if (runAll) {
    toRun.push('scenario_a', 'scenario_b');
  } else if (requested === 'a' || requested === 'scenario_a') {
    toRun.push('scenario_a');
  } else if (requested === 'b' || requested === 'scenario_b') {
    toRun.push('scenario_b');
  } else {
    console.error(`Unknown scenario: ${requested}. Options: --scenario=a, --scenario=b, --all`);
    process.exit(1);
  }

  for (const scKey of toRun) {
    let result;
    try {
      // Attempt live API injection first
      result = await runScenarioViaApi(scKey);
    } catch (apiErr) {
      // Fallback to standalone execution engine
      result = await runScenarioStandalone(scKey);
    }
    printScenarioReport(result);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error running scenario:', err);
    process.exit(1);
  });
}

module.exports = { runScenarioViaApi, runScenarioStandalone, printScenarioReport };
