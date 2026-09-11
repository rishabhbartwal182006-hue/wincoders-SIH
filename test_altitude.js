const assert = require('assert');
const http = require('http');
const app = require('./server');
const { getAltitudeProfile, interpretVitals, ALGORITHM_VERSION, DISCLAIMER } = require('./services/altitudeAdjustmentService');
const altitudeProfiles = require('./config/altitudeProfiles.json');

const PORT = 4001;
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

async function runAltitudeTests() {
  console.log('=======================================================');
  console.log('  ALTITUDE-AWARE MVP PHASE 1 TEST SUITE               ');
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

  // --- UNIT TESTS: Config & Service ---
  test('1. Altitude profiles JSON bands and disclaimer exist', () => {
    assert.ok(altitudeProfiles._disclaimer, 'Missing _disclaimer');
    assert.ok(altitudeProfiles.bands.sea_level, 'Missing sea_level band');
    assert.ok(altitudeProfiles.bands.moderate, 'Missing moderate band');
    assert.ok(altitudeProfiles.bands.high, 'Missing high band');
    assert.ok(altitudeProfiles.bands.very_high, 'Missing very_high band');
    assert.ok(altitudeProfiles.bands.extreme, 'Missing extreme band');
  });

  test('2. getAltitudeProfile maps bands correctly across elevations', () => {
    assert.strictEqual(getAltitudeProfile(200).key, 'sea_level');
    assert.strictEqual(getAltitudeProfile(1000).key, 'moderate');
    assert.strictEqual(getAltitudeProfile(2438).key, 'high');
    assert.strictEqual(getAltitudeProfile(3000).key, 'very_high');
    assert.strictEqual(getAltitudeProfile(4500).key, 'extreme');
  });

  test('3. SpO2 below expected range -> status "borderline"', () => {
    const res = interpretVitals([{ type: 'spo2', value: 88 }], { altitudeMeters: 2438 });
    assert.strictEqual(res[0].status, 'borderline');
    assert.strictEqual(res[0].rawValue, 88);
    assert.strictEqual(res[0].adjustedForAltitude, true);
    assert.deepStrictEqual(res[0].expectedRange, [92, 97]);
  });

  test('4. SpO2 below expected range AND danger symptoms -> status "critical"', () => {
    const resChestPain = interpretVitals([{ type: 'spo2', value: 88 }], { altitudeMeters: 2438 }, ['severe chest pain']);
    assert.strictEqual(resChestPain[0].status, 'critical');

    const resBreathless = interpretVitals([{ type: 'spo2', value: 88 }], { altitudeMeters: 2438 }, [{ symptom: 'breathlessness at rest' }]);
    assert.strictEqual(resBreathless[0].status, 'critical');

    const resConfusion = interpretVitals([{ type: 'spo2', value: 88 }], { altitudeMeters: 2438 }, 'patient has confusion and cyanosis');
    assert.strictEqual(resConfusion[0].status, 'critical');
  });

  test('5. SpO2 >5% below expected range -> status "critical" even without symptoms', () => {
    // high band expectedRange is [92, 97]; 92 - 5 = 87; value 85 is >5% below
    const res = interpretVitals([{ type: 'spo2', value: 85 }], { altitudeMeters: 2438 }, []);
    assert.strictEqual(res[0].status, 'critical');
  });

  test('6. BP 120/80 at 8000 ft -> status "normal" and not altitude adjusted', () => {
    const res = interpretVitals([
      { type: 'bp_systolic', value: 120 },
      { type: 'bp_diastolic', value: 80 }
    ], { altitudeMeters: 2438 });

    assert.strictEqual(res[0].status, 'normal');
    assert.strictEqual(res[0].adjustedForAltitude, false);
    assert.strictEqual(res[1].status, 'normal');
    assert.strictEqual(res[1].adjustedForAltitude, false);
  });

  test('7. BP systolic >=180 or diastolic >=120 -> status "critical" regardless of altitude', () => {
    const res1 = interpretVitals([{ type: 'bp_systolic', value: 185 }], { altitudeMeters: 2438 });
    assert.strictEqual(res1[0].status, 'critical');

    const res2 = interpretVitals([{ type: 'bp_diastolic', value: 122 }], { altitudeMeters: 0 });
    assert.strictEqual(res2[0].status, 'critical');
  });

  test('8. HR above expected max for altitude + 20 -> status "borderline", escalate if symptomatic', () => {
    // High altitude [1500, 2500m] hrDelta is [5, 15] -> expectedRange [65, 115]
    // Max + 20 = 135
    // HR 138 is > 135
    const resAsymptomatic = interpretVitals([{ type: 'heart_rate', value: 138 }], { altitudeMeters: 2438 }, []);
    assert.strictEqual(resAsymptomatic[0].status, 'borderline');

    const resSymptomatic = interpretVitals([{ type: 'heart_rate', value: 138 }], { altitudeMeters: 2438 }, ['palpitations and dizziness']);
    assert.strictEqual(resSymptomatic[0].status, 'critical');
  });

  test('9. interpretVitals always preserves rawValue and includes algorithmVersion', () => {
    const res = interpretVitals([{ type: 'spo2', value: 94 }], { altitudeMeters: 2438 });
    assert.strictEqual(res[0].rawValue, 94);
    assert.strictEqual(res[0].algorithmVersion, ALGORITHM_VERSION);
  });

  // --- INTEGRATION TESTS: HTTP Endpoints ---
  server = app.listen(PORT);
  await new Promise(r => setTimeout(r, 600));

  const testSessionId = `TEST-SESS-${Date.now()}`;

  await testAsync('10. POST /api/v1/sessions/:id/environment sets altitude and environment subdocument', async () => {
    const res = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/sessions/${testSessionId}/environment`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      altitudeMeters: 2438,
      altitudeSource: 'facility_config',
      timeAtAltitudeHours: 4,
      residenceAltitudeMeters: 500,
      acclimatizationStatus: 'partial'
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.environment.altitudeMeters, 2438);
    assert.strictEqual(res.body.environment.altitudeFeet, 8000);
    assert.strictEqual(res.body.environment.acclimatizationStatus, 'partial');
    assert.ok(res.body.disclaimer.includes('Decision-support MVP'));
  });

  await testAsync('11. POST /api/v1/sessions/:id/vitals accepts mock vitals and applies altitudeContext', async () => {
    const res = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/sessions/${testSessionId}/vitals`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      entryMode: 'mock',
      vitals: [
        { type: 'bp_systolic', value: 120, unit: 'mmHg' },
        { type: 'bp_diastolic', value: 80, unit: 'mmHg' },
        { type: 'spo2', value: 88, unit: '%' },
        { type: 'heart_rate', value: 110, unit: 'bpm' }
      ]
    });

    assert.strictEqual(res.status, 201);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.vitals.length, 4);

    const spo2Reading = res.body.vitals.find(v => v.type === 'spo2');
    assert.ok(spo2Reading, 'spo2 reading missing');
    assert.strictEqual(spo2Reading.value, 88);
    assert.strictEqual(spo2Reading.altitudeContext.status, 'borderline');
    assert.strictEqual(spo2Reading.altitudeContext.altitudeMeters, 2438);
    assert.strictEqual(spo2Reading.altitudeContext.algorithmVersion, 'altitude-mvp-v1');
    assert.ok(res.body.disclaimer.includes('Decision-support MVP'));
  });

  await testAsync('12. GET /api/v1/sessions/:id/vitals/interpreted returns interpreted vitals and disclaimer', async () => {
    const res = await request({
      hostname: '127.0.0.1',
      port: PORT,
      path: `/api/v1/sessions/${testSessionId}/vitals/interpreted`,
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.strictEqual(res.body.rawValuesPreserved, true);
    assert.strictEqual(res.body.altitudeMeters, 2438);
    assert.ok(Array.isArray(res.body.interpretedVitals));

    const spo2Interp = res.body.interpretedVitals.find(v => v.type === 'spo2');
    assert.strictEqual(spo2Interp.rawValue, 88);
    assert.strictEqual(spo2Interp.status, 'borderline');
    assert.ok(spo2Interp.reason.includes('below expected'));
    assert.ok(res.body.disclaimer.includes('Decision-support MVP'));
  });

  if (server) server.close();

  console.log('\n=======================================================');
  console.log(`  ALTITUDE TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('=======================================================\n');

  if (failed > 0) process.exit(1);
}

runAltitudeTests().catch(err => {
  console.error('Test runner execution error:', err);
  if (server) server.close();
  process.exit(1);
});
