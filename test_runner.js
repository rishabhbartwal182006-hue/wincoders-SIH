/**
 * MediKiosk Task 5 Integration & Pipeline Test Runner
 * Validates:
 * 1. Health Check (GET /health on PORT 4000)
 * 2. Demo Seed Endpoint (POST /api/events/demo/seed)
 * 3. Kiosk Intake Submission (POST /api/v1/kiosk/intake)
 * 4. Doctor Dashboard Summary (GET /api/v1/clinical/patient/:id/summary)
 * 5. Live Queue Overview (GET /api/events/sessions)
 * 6. Encounter Session Details (GET /api/events/session/:sessionId)
 * 7. HPR Write-Lock Security Middleware (401 Unauthorized check)
 * 8. HPR Token Provisioning (POST /api/v1/hpr/login)
 * 9. HPR Authorized Commit (POST /api/v1/clinical/commit)
 * 10. HL7 FHIR (R4) Bundle Export (GET /api/v1/clinical/fhir/bundle/:intakeId)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('./server');

const PORT = process.env.PORT || 4000;
let server = null;

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

    req.on('error', (err) => reject(err));

    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runTests() {
  console.log(`=======================================================`);
  console.log(`  MEDIKIOSK UNIFIED PIPELINE & HEALTH TEST SUITE       `);
  console.log(`=======================================================\n`);

  server = app.listen(PORT);
  await new Promise(r => setTimeout(r, 800));

  let passed = 0;
  let failed = 0;

  function logPass(msg) {
    passed++;
    console.log(`[PASS] ✓ ${msg}`);
  }

  function logFail(msg, err) {
    failed++;
    console.error(`[FAIL] ✗ ${msg}:`, err);
  }

  try {
    // TEST 1: Health Check Endpoint (GET /health)
    const healthRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/health',
      method: 'GET'
    });

    if (healthRes.status === 200 && healthRes.body?.status === 'UP') {
      logPass(`System Health Check Endpoint (GET /health) on PORT ${PORT}`);
    } else {
      logFail('System Health Check Endpoint', healthRes);
    }

    // TEST 2: Demo Seed Route (POST /api/events/demo/seed)
    const seedDemoRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/events/demo/seed',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (seedDemoRes.status === 200 && seedDemoRes.body?.success) {
      logPass(`Demo Seed Route (POST /api/events/demo/seed) - Seeded ${seedDemoRes.body.count} patient encounters.`);
    } else {
      logFail('Demo Seed Route Endpoint', seedDemoRes);
    }

    // TEST 3: Kiosk Ingestion (POST /api/v1/kiosk/intake)
    const seedPayload = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed_data.json'), 'utf8'));
    const intakeRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/kiosk/intake',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, seedPayload);

    if (intakeRes.status === 201 && intakeRes.body?.data?.status === 'PROVISIONAL') {
      logPass(`Kiosk Ingestion (POST /api/v1/kiosk/intake) - Intake ID: ${intakeRes.body.data.intakeId}, Status: PROVISIONAL`);
    } else {
      logFail('Kiosk Ingestion Endpoint', intakeRes);
    }

    // TEST 4: Doctor Dashboard Summary (GET /api/v1/clinical/patient/:id/summary)
    const abhaId = seedPayload.abhaId;
    const summaryRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/clinical/patient/${abhaId}/summary`,
      method: 'GET'
    });

    if (summaryRes.status === 200 && summaryRes.body?.data?.preConsultationSummary) {
      const order = summaryRes.body.data.preConsultationSummary.order;
      const expectedOrder = ["Vitals", "Chief Complaint", "HPI", "History", "AYUSH parameters"];
      const isOrderValid = JSON.stringify(order) === JSON.stringify(expectedOrder);
      
      if (isOrderValid) {
        logPass(`Doctor Dashboard Summary Order Validated: ${order.join(' -> ')}`);
      } else {
        logFail('Doctor Dashboard Summary Order Mismatch', order);
      }

      if (summaryRes.body.data.discrepancyFlags && summaryRes.body.data.discrepancyFlags.length > 0) {
        logPass(`Cross-Verification Discrepancy Engine detected ${summaryRes.body.data.discrepancyFlags.length} discrepancy warnings.`);
      } else {
        logFail('Discrepancy Flags Detection', summaryRes.body.data);
      }
    } else {
      logFail('Doctor Dashboard Summary Endpoint', summaryRes);
    }

    // TEST 5: Frontend Live Sessions Queue API (GET /api/events/sessions)
    const sessionsRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/events/sessions',
      method: 'GET'
    });

    if (sessionsRes.status === 200 && Array.isArray(sessionsRes.body?.sessions)) {
      logPass(`Frontend Queue API (GET /api/events/sessions) - Returned ${sessionsRes.body.sessions.length} encounters for UI rendering.`);
    } else {
      logFail('Frontend Sessions Queue API', sessionsRes);
    }

    // TEST 6: Frontend Session Details API (GET /api/events/session/:sessionId)
    const sessionDetailsRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/events/session/${seedPayload.intakeId}`,
      method: 'GET'
    });

    if (sessionDetailsRes.status === 200 && sessionDetailsRes.body?.session?.sessionId === seedPayload.intakeId) {
      logPass(`Frontend Session API (GET /api/events/session/:id) - Successfully retrieved encounter session details.`);
    } else {
      logFail('Frontend Session API', sessionDetailsRes);
    }

    // TEST 7: HPR Write-Lock Protection (UNAUTHORIZED COMMIT)
    const unauthCommitRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/clinical/commit',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { intakeId: seedPayload.intakeId });

    if (unauthCommitRes.status === 401 && unauthCommitRes.body?.error === 'HPR_TOKEN_MISSING') {
      logPass('HPR Biometric Write-Lock Security Middleware successfully blocked unauthorized commit (401 Unauthorized)');
    } else {
      logFail('HPR Write-Lock Middleware Unauthorized Protection Failed', unauthCommitRes);
    }

    // TEST 8: HPR Doctor Login & Token Provisioning (POST /api/v1/hpr/login)
    const hprLoginRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/hpr/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      hprId: "HPR-IN-9876543210",
      doctorName: "Dr. Ananya Roy, MD",
      registrationNumber: "KMC-2016-99381",
      role: "DOCTOR"
    });

    let hprToken = null;
    if (hprLoginRes.status === 200 && hprLoginRes.body?.data?.hprToken) {
      hprToken = hprLoginRes.body.data.hprToken;
      logPass(`HPR Token Issued for ${hprLoginRes.body.data.doctorName} (HPR ID: ${hprLoginRes.body.data.hprId})`);
    } else {
      logFail('HPR Doctor Token Login', hprLoginRes);
    }

    // TEST 9: HPR Authenticated Clinical Commit & Write-Lock Transition
    if (hprToken) {
      const commitRes = await request({
        hostname: '127.0.0.1',
        port: PORT,
        path: '/api/v1/clinical/commit',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${hprToken}`
        }
      }, {
        intakeId: seedPayload.intakeId,
        doctorNotes: "Verified patient vitals and chief complaints. Confirmed Stage 2 Hypertension and hyperglycemia. Committing to permanent EHR."
      });

      if (commitRes.status === 200 && commitRes.body?.data?.status === 'VERIFIED_COMMITTED') {
        logPass(`Clinical Commit Success - Status transitioned to VERIFIED_COMMITTED`);
        logPass(`Immutable Signature Block Attached: ${commitRes.body.data.hprSignatureBlock.digitalSignature}`);
        logPass(`ABDM M1/M2/M3 Sync Broadcast Completed - Transaction ID: ${commitRes.body.data.abdmSync.transactionId}`);
      } else {
        logFail('HPR Authenticated Clinical Commit', commitRes);
      }
    }

    // TEST 10: HL7 FHIR (R4) Bundle Export (GET /api/v1/clinical/fhir/bundle/:intakeId)
    const fhirRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/clinical/fhir/bundle/${seedPayload.intakeId}`,
      method: 'GET'
    });

    if (fhirRes.status === 200 && fhirRes.body?.resourceType === 'Bundle' && fhirRes.body?.type === 'document') {
      logPass(`HL7 FHIR (R4) Bundle Export Validated: ResourceType = Bundle, Type = document, Entries = ${fhirRes.body.entry?.length}`);
    } else {
      logFail('HL7 FHIR R4 Bundle Export', fhirRes);
    }

  } catch (err) {
    logFail('Test Suite Execution Error', err);
  } finally {
    if (server) server.close();
    console.log(`\n=======================================================`);
    console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
    console.log(`=======================================================\n`);
    process.exit(failed > 0 ? 1 : 0);
  }
}

runTests();
