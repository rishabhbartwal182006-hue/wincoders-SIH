/**
 * MediKiosk Task 5, Module 6 & 7 Full Integration Test Runner
 * Validates:
 * 1. Health Check & Kiosk Terminal UI Endpoint (GET /kiosk.html)
 * 2. Demo Seed Endpoint (POST /api/events/demo/seed)
 * 3. Kiosk Intake Submission API (POST /api/v1/intake)
 * 4. Doctor Dashboard Summary (GET /api/v1/clinical/patient/:id/summary)
 * 5. Frontend Queue Overview (GET /api/events/sessions)
 * 6. HPR Write-Lock Security Protection (401 Unauthorized check)
 * 7. HPR Doctor Verification Sign-Off (POST /api/v1/doctor/verify)
 * 8. ABDM FHIR R4 Bundle Export (GET /api/v1/export/fhir/:intakeId)
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
  console.log(`  MEDIKIOSK KIOSK, HPR & FHIR PIPELINE TEST SUITE      `);
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
    console.error(`[FAIL] xhtml ${msg}:`, err);
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

    // TEST 2: Patient Intake Kiosk UI Static Route (GET /kiosk.html)
    const kioskUiRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/kiosk.html',
      method: 'GET'
    });

    if (kioskUiRes.status === 200 && kioskUiRes.rawBody?.includes('MediKiosk Self-Service Terminal')) {
      logPass(`Patient Intake Kiosk Terminal UI Served Successfully (GET /kiosk.html)`);
    } else {
      logFail('Patient Intake Kiosk UI Route', kioskUiRes);
    }

    // TEST 3: Demo Seed Route (POST /api/events/demo/seed)
    const seedDemoRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/events/demo/seed',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (seedDemoRes.status === 200 && seedDemoRes.body?.success) {
      logPass(`Demo Seed Route (POST /api/events/demo/seed) - Seeded ${seedDemoRes.body.count} encounters.`);
    } else {
      logFail('Demo Seed Route Endpoint', seedDemoRes);
    }

    // TEST 4: Kiosk Intake Submission API (POST /api/v1/intake)
    const seedPayload = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed_data.json'), 'utf8'));
    const intakeRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/intake',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, seedPayload);

    if (intakeRes.status === 201 && intakeRes.body?.data?.status === 'PROVISIONAL') {
      logPass(`Kiosk Intake Submission API (POST /api/v1/intake) - Intake ID: ${intakeRes.body.data.intakeId}, Status: PROVISIONAL`);
    } else {
      logFail('Kiosk Intake Submission Endpoint', intakeRes);
    }

    // TEST 5: Doctor Dashboard Summary (GET /api/v1/clinical/patient/:id/summary)
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
    } else {
      logFail('Doctor Dashboard Summary Endpoint', summaryRes);
    }

    // TEST 6: HPR Write-Lock Protection (UNAUTHORIZED COMMIT)
    const unauthCommitRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/api/v1/doctor/verify',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { intakeId: seedPayload.intakeId });

    if (unauthCommitRes.status === 401 && unauthCommitRes.body?.error === 'HPR_TOKEN_MISSING') {
      logPass('Module 6 HPR Security Middleware successfully blocked unauthorized sign-off (401 Unauthorized)');
    } else {
      logFail('Module 6 HPR Write-Lock Protection Failed', unauthCommitRes);
    }

    // TEST 7: HPR Token Provisioning (POST /api/v1/hpr/login)
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
      logPass(`HPR Doctor Token Issued for ${hprLoginRes.body.data.doctorName} (${hprLoginRes.body.data.hprId})`);
    } else {
      logFail('HPR Doctor Token Login', hprLoginRes);
    }

    // TEST 8: Module 6 Doctor Verification Sign-Off (POST /api/v1/doctor/verify)
    if (hprToken) {
      const commitRes = await request({
        hostname: '127.0.0.1',
        port: PORT,
        path: '/api/v1/doctor/verify',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${hprToken}`
        }
      }, {
        intakeId: seedPayload.intakeId,
        doctorNotes: "Verified patient intake, vitals, and AYUSH parameters. Record locked and committed to EHR."
      });

      if (commitRes.status === 200 && commitRes.body?.data?.status === 'VERIFIED_COMMITTED') {
        logPass(`Module 6 Clinical Commit Success - Status transitioned to VERIFIED_COMMITTED`);
        logPass(`Immutable Digital Signature Attached: ${commitRes.body.data.hprSignatureBlock.digitalSignature}`);
      } else {
        logFail('Module 6 Doctor Verification Sign-Off', commitRes);
      }
    }

    // TEST 9: Module 7 ABDM FHIR (R4) Bundle Export (GET /api/v1/export/fhir/:intakeId)
    const fhirRes = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/export/fhir/${seedPayload.intakeId}`,
      method: 'GET'
    });

    if (fhirRes.status === 200 && fhirRes.body?.resourceType === 'Bundle' && fhirRes.body?.type === 'document') {
      logPass(`Module 7 HL7 FHIR (R4) Bundle Export Validated (GET /api/v1/export/fhir/:intakeId): ResourceType = Bundle, Type = document, Entries = ${fhirRes.body.entry?.length}`);
    } else {
      logFail('Module 7 HL7 FHIR R4 Bundle Export', fhirRes);
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
