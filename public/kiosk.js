(() => {
  const socket = (typeof io !== 'undefined') ? io() : null;

  const $ = (id) => document.getElementById(id);

  // OCR Documents State
const ocrDocuments = [];

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
    const sysList = [120, 135, 145, 165, 185];
    const diaList = [80, 88, 92, 102, 112];
    const idx = Math.floor(Math.random() * sysList.length);
    vitalsState.systolic = sysList[idx];
    vitalsState.diastolic = diaList[idx];
    $('dispBP').textContent = `${vitalsState.systolic} / ${vitalsState.diastolic}`;
    alert(`[Module 3 Hardware Sensor]: BP Cuff measurement completed -> ${vitalsState.systolic}/${vitalsState.diastolic} mmHg`);
  });

  $('btnCaptureSpO2').addEventListener('click', () => {
    const spo2List = [98, 97, 94, 88, 99];
    const hrList = [72, 84, 88, 96, 110];
    const idx = Math.floor(Math.random() * spo2List.length);
    vitalsState.spo2 = spo2List[idx];
    vitalsState.heartRate = hrList[idx];
    $('dispSpO2').textContent = `${vitalsState.spo2}%`;
    $('dispHR').textContent = `${vitalsState.heartRate}`;
    alert(`[Module 3 Hardware Sensor]: Pulse Oximeter captured -> SpO₂: ${vitalsState.spo2}%, HR: ${vitalsState.heartRate} bpm`);
  });

  $('btnReadGlucose').addEventListener('click', () => {
    const glucList = [110, 145, 185, 245, 310];
    const idx = Math.floor(Math.random() * glucList.length);
    vitalsState.bloodGlucose = glucList[idx];
    $('dispGlucose').textContent = `${vitalsState.bloodGlucose}`;
    alert(`[Module 3 Hardware Sensor]: Glucometer reading captured -> ${vitalsState.bloodGlucose} mg/dL`);
  });

  /**
   * Prompt 1: Dynamic Triage Threshold Evaluator
   * Evaluates BP, SpO2, Glucose, and Severity against clinical thresholds
   */
  function calculateClinicalTriageLevel(vitals, severity) {
    const sys = Number(vitals.systolic);
    const dia = Number(vitals.diastolic);
    const spo2 = Number(vitals.spo2);
    const glucose = Number(vitals.bloodGlucose);

    // EMERGENCY Thresholds: BP > 180 (or Dia > 110), SpO2 < 90%, Glucose > 300 mg/dL
    if (sys > 180 || dia > 110 || spo2 < 90 || glucose > 300 || (severity === 'Severe' && (sys >= 160 || spo2 < 92))) {
      return {
        triageLevel: 'EMERGENCY',
        urgencyScore: 10,
        action: 'IMMEDIATE_DOCTOR_ALERT',
        reason: 'Critical physiological threshold exceeded (Stage 3 Crisis BP / Severe Hypoxemia / Hyperglycemia).'
      };
    }

    // URGENT Thresholds: BP > 140, SpO2 < 95%, Glucose > 200 mg/dL, or Severe symptoms
    if (sys > 140 || dia > 90 || spo2 < 95 || glucose > 200 || severity === 'Severe') {
      return {
        triageLevel: 'URGENT',
        urgencyScore: 7,
        action: 'PRIORITY_REVIEW',
        reason: 'Elevated clinical risk parameters (Stage 1/2 Hypertension / Moderate Hypoxemia / Elevated Glucose).'
      };
    }

    // ROUTINE
    return {
      triageLevel: 'ROUTINE',
      urgencyScore: 3,
      action: 'STANDARD_QUEUE',
      reason: 'Stable physiological vitals within normal parameters.'
    };
  }

  // ==========================================
// DOCUMENT OCR
// ==========================================

$('btnUploadOCR').addEventListener(
  'click',
  async () => {

    const fileInput = $('ocrDocument');

    const file = fileInput.files[0];

    if (!file) {

      alert(
        'Please select a prescription or lab report first.'
      );

      return;
    }


    // Show loading
    $('ocrLoading').style.display = 'block';

    $('ocrResult').style.display = 'none';

    $('ocrStatus').textContent =
      '[PROCESSING DOCUMENT...]';


    try {

      const formData = new FormData();

      formData.append(
        'document',
        file
      );


      const response = await fetch(
        '/api/v1/ocr',
        {
          method: 'POST',
          body: formData
        }
      );


      const result =
        await response.json();


      if (
        !response.ok ||
        !result.success
      ) {

        throw new Error(
          result.message ||
          'OCR processing failed.'
        );

      }


      // OCR document returned by backend
      const ocrDocument =
        result.data;


      // Store document for final intake
      ocrDocuments.push(
        ocrDocument
      );


      // Structured OCR data
      const structuredData =
        ocrDocument.structuredData;


      // ======================================
      // DISPLAY OCR RESULT
      // ======================================

      $('ocrDocumentType')
        .textContent =
        structuredData.documentType ||
        'UNKNOWN';


      $('ocrPatientName')
        .textContent =
        structuredData.patientName ||
        'Not detected';


      $('ocrAge')
        .textContent =
        structuredData.age ??
        'Not detected';


      $('ocrGender')
        .textContent =
        structuredData.gender ||
        'Not detected';


      $('ocrDate')
        .textContent =
        structuredData.date ||
        'Not detected';


      $('ocrConfidence')
        .textContent =
        `${Math.round(
          ocrDocument.confidence * 100
        )}%`;


      // ======================================
      // DISPLAY MEDICATIONS
      // ======================================

      const medicationContainer =
        $('ocrMedicationsContainer');


      medicationContainer.innerHTML = '';


      if (
        structuredData.medications &&
        structuredData.medications.length > 0
      ) {

        const heading =
          document.createElement('h4');

        heading.textContent =
          'Detected Medications';

        medicationContainer.appendChild(
          heading
        );


        structuredData.medications.forEach(
          (medicine) => {

            const div =
              document.createElement('div');

            div.style.marginBottom =
              '8px';

            div.textContent =
              `${medicine.name}` +
              `${medicine.dosage ? ' - ' + medicine.dosage : ''}` +
              `${medicine.frequency ? ' - ' + medicine.frequency : ''}`;

            medicationContainer.appendChild(
              div
            );

          }
        );

      } else {

        medicationContainer.textContent =
          'No medications detected.';

      }


      // Show result
      $('ocrResult').style.display =
        'block';


      $('ocrStatus').textContent =
        `[${ocrDocuments.length} DOCUMENT(S) SCANNED]`;


    } catch (error) {

      console.error(
        '[OCR ERROR]',
        error
      );


      $('ocrStatus').textContent =
        '[OCR FAILED]';


      alert(
        `OCR processing failed: ${error.message}`
      );


    } finally {

      $('ocrLoading').style.display =
        'none';

    }

  }
);

  // Submit Handler
  $('btnSubmitIntake').addEventListener('click', async () => {
    const fullName = $('fullName').value.trim() || 'Anonymous Patient';
    const age = parseInt($('age').value, 10) || 45;
    const gender = $('gender').value || 'M';
    const abhaId = $('abhaId').value.trim() || `ABHA-${Date.now()}`;
    const intakeId = `INTAKE-${Date.now()}`;
    const severity = $('severity').value || 'Moderate';

    const timestamp = new Date().toISOString();
    const isStaff = $('staffModeToggle').checked;
    const provenanceType = isStaff ? 'touch-selected' : 'patient-spoken';

    // Calculate Triage Level dynamically via Threshold Engine
    const triageEval = calculateClinicalTriageLevel(vitalsState, severity);

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

      ocrDocuments: ocrDocuments,
      
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
          severity: severity,
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
        triageLevel: triageEval.triageLevel,
        urgencyScore: triageEval.urgencyScore,
        recommendedDepartment: activeMode === 'AYUSH' ? 'AYUSH OPD / Kayachikitsa' : 'General Medicine',
        protocolNotes: triageEval.reason
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
        // Emit Prompt 1 Socket Event: kiosk:intake_submitted
        if (socket) {
          socket.emit('kiosk:intake_submitted', {
            sessionId: intakeId,
            intakeId: intakeId,
            patientId: abhaId,
            patientName: fullName,
            triageLevel: triageEval.triageLevel,
            urgencyScore: triageEval.urgencyScore,
            timestamp: timestamp,
            vitals: payload.vitals,
            symptoms: payload.chiefComplaints,
            payload: payload
          });

          // Also emit legacy event for backward compatibility
          socket.emit('PATIENT_EVENT_RECEIVED', { sessionId: intakeId, patientId: abhaId, payload });
        }

        alert(`✓ Patient Intake Submitted!\n\nIntake ID: ${resData.data.intakeId}\nABHA ID: ${resData.data.abhaId}\nTriage Status: ${triageEval.triageLevel}\nStatus: PROVISIONAL\n\nSocket.IO event 'kiosk:intake_submitted' sent to Doctor Command Center.`);
      } else {
        alert(`Intake submission failed: ${resData.message || 'Server error'}`);
      }
    } catch (err) {
      alert(`Network error during submission: ${err.message}`);
    }
  });

})();
