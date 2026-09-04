(() => {
  const socket = (typeof io !== 'undefined') ? io() : null;

  const $ = (id) => document.getElementById(id);

  // Vitals State
  const vitalsState = {
    systolic: 165,
    diastolic: 102,
    spo2: 97,
    heartRate: 88,
    bloodGlucose: 245
  };

  // Clinical Mode Switcher
  const btnAllopathy = $('btnAllopathyMode');
  const btnAyush = $('btnAyushMode');
  const allopathySec = $('allopathySection');
  const ayushSec = $('ayushSection');

  let activeMode = 'ALLOPATHY';

  btnAllopathy.addEventListener('click', () => {
    activeMode = 'ALLOPATHY';
    btnAllopathy.classList.add('active');
    btnAyush.classList.remove('active');
    allopathySec.style.display = 'block';
    ayushSec.style.display = 'none';
  });

  btnAyush.addEventListener('click', () => {
    activeMode = 'AYUSH';
    btnAyush.classList.add('active');
    btnAllopathy.classList.remove('active');
    ayushSec.style.display = 'block';
    allopathySec.style.display = 'none';
  });

  // Simulated Hardware Controls
  $('btnMeasureBP').addEventListener('click', () => {
    const sysList = [120, 135, 145, 165, 170];
    const diaList = [80, 88, 92, 102, 108];
    const idx = Math.floor(Math.random() * sysList.length);
    vitalsState.systolic = sysList[idx];
    vitalsState.diastolic = diaList[idx];
    $('dispBP').textContent = `${vitalsState.systolic} / ${vitalsState.diastolic}`;
    alert(`[Module 3 Hardware Sensor]: BP Cuff measurement completed -> ${vitalsState.systolic}/${vitalsState.diastolic} mmHg`);
  });

  $('btnCaptureSpO2').addEventListener('click', () => {
    const spo2List = [98, 97, 95, 92, 99];
    const hrList = [72, 84, 88, 96, 110];
    const idx = Math.floor(Math.random() * spo2List.length);
    vitalsState.spo2 = spo2List[idx];
    vitalsState.heartRate = hrList[idx];
    $('dispSpO2').textContent = `${vitalsState.spo2}%`;
    $('dispHR').textContent = `${vitalsState.heartRate}`;
    alert(`[Module 3 Hardware Sensor]: Pulse Oximeter captured -> SpO₂: ${vitalsState.spo2}%, HR: ${vitalsState.heartRate} bpm`);
  });

  $('btnReadGlucose').addEventListener('click', () => {
    const glucList = [110, 145, 185, 245, 280];
    const idx = Math.floor(Math.random() * glucList.length);
    vitalsState.bloodGlucose = glucList[idx];
    $('dispGlucose').textContent = `${vitalsState.bloodGlucose}`;
    alert(`[Module 3 Hardware Sensor]: Glucometer reading captured -> ${vitalsState.bloodGlucose} mg/dL`);
  });

  // Submit Handler
  $('btnSubmitIntake').addEventListener('click', async () => {
    const fullName = $('fullName').value.trim() || 'Anonymous Patient';
    const age = parseInt($('age').value, 10) || 45;
    const gender = $('gender').value || 'M';
    const abhaId = $('abhaId').value.trim() || `ABHA-${Date.now()}`;
    const intakeId = `INTAKE-${Date.now()}`;

    const timestamp = new Date().toISOString();
    const isStaff = $('staffModeToggle').checked;
    const provenanceType = isStaff ? 'touch-selected' : 'patient-spoken';

    const payload = {
      intakeId: intakeId,
      sessionId: intakeId,
      abhaId: abhaId,
      patientId: abhaId,
      patientDemographics: {
        fullName: fullName,
        gender: gender,
        age: age,
        provenanceMeta: {
          provenance: 'touch-selected',
          confidence: 1.0,
          timestamp: timestamp
        }
      },
      vitals: {
        bloodPressure: {
          systolic: { value: vitalsState.systolic, unit: 'mmHg', provenanceMeta: { provenance: 'device-captured', confidence: 0.99, timestamp } },
          diastolic: { value: vitalsState.diastolic, unit: 'mmHg', provenanceMeta: { provenance: 'device-captured', confidence: 0.99, timestamp } }
        },
        spo2: { value: vitalsState.spo2, unit: '%', provenanceMeta: { provenance: 'device-captured', confidence: 0.98, timestamp } },
        heartRate: { value: vitalsState.heartRate, unit: 'bpm', provenanceMeta: { provenance: 'device-captured', confidence: 0.99, timestamp } },
        bloodGlucose: { value: vitalsState.bloodGlucose, unit: 'mg/dL', provenanceMeta: { provenance: 'device-captured', confidence: 0.96, timestamp } }
      },
      chiefComplaints: [
        {
          symptom: $('chiefComplaint').value || 'General Consultation',
          duration: $('duration').value || '3 days',
          severity: $('severity').value || 'Moderate',
          provenanceMeta: { provenance: provenanceType, confidence: 0.95, timestamp }
        }
      ],
      hpi: {
        narrative: $('hpiNarrative').value || 'Self-service intake recorded via MediKiosk.',
        provenanceMeta: { provenance: provenanceType, confidence: 0.90, timestamp }
      },
      ayushParameters: {
        agni: $('ayushAgni').value,
        koshtha: $('ayushKoshtha').value,
        mutra: $('ayushMutra').value,
        aharaVihara: $('ayushAhara').value,
        advisory: "Prakriti and Sattva require direct examination by Vaidya.",
        provenanceMeta: { provenance: 'touch-selected', confidence: 1.0, timestamp }
      },
      triage: {
        triageLevel: vitalsState.systolic >= 160 || vitalsState.bloodGlucose >= 240 ? 'PRIORITY' : 'ROUTINE',
        urgencyScore: vitalsState.systolic >= 160 ? 7 : 4,
        recommendedDepartment: activeMode === 'AYUSH' ? 'AYUSH OPD / Kayachikitsa' : 'General Medicine'
      },
      status: 'PROVISIONAL'
    };

    try {
      const response = await fetch('/api/v1/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const resData = await response.json();

      if (response.ok && resData.success) {
        // Emit Socket Event for real-time dashboard update
        if (socket) {
          socket.emit('PATIENT_EVENT_RECEIVED', {
            sessionId: intakeId,
            patientId: abhaId,
            payload: payload
          });
        }

        alert(`✓ Patient Intake Successfully Submitted!\n\nIntake ID: ${resData.data.intakeId}\nABHA ID: ${resData.data.abhaId}\nStatus: PROVISIONAL\n\nReal-time alert sent to Doctor Command Center Dashboard.`);
      } else {
        alert(`Intake submission failed: ${resData.message || 'Server error'}`);
      }
    } catch (err) {
      alert(`Network error during submission: ${err.message}`);
    }
  });

})();
