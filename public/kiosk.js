(() => {
  const socket = (typeof io !== 'undefined') ? io() : null;

  const $ = (id) => document.getElementById(id);

  // OCR Documents State
const ocrDocuments = [];

  // Vitals State - default healthy physiological baseline
  const vitalsState = {
    systolic: 120,
    diastolic: 80,
    spo2: 98,
    heartRate: 72,
    bloodGlucose: 95
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

  // Manual Vitals Input Handlers
  $('btnSaveBP')?.addEventListener('click', () => {
    const s = parseInt($('inSys').value, 10);
    const d = parseInt($('inDia').value, 10);
    if (!isNaN(s) && !isNaN(d)) {
      vitalsState.systolic = s;
      vitalsState.diastolic = d;
      $('dispBP').textContent = `${s} / ${d}`;
      const badge = $('srcBP');
      if (badge) badge.textContent = 'manual input';
      alert(`Manual BP saved: ${s}/${d} mmHg`);
    } else {
      alert('Please enter valid systolic and diastolic numbers.');
    }
  });

  $('btnSaveSpO2')?.addEventListener('click', () => {
    const sp = parseInt($('inSpO2').value, 10);
    const hr = parseInt($('inHR').value, 10);
    if (!isNaN(sp)) {
      vitalsState.spo2 = sp;
      $('dispSpO2').textContent = `${sp}%`;
      const badge = $('srcSpO2');
      if (badge) badge.textContent = 'manual input';
    }
    if (!isNaN(hr)) {
      vitalsState.heartRate = hr;
      $('dispHR').textContent = `${hr}`;
    }
    alert(`Manual Pulse/SpO2 saved: SpO2 ${vitalsState.spo2}%, HR ${vitalsState.heartRate} bpm`);
  });

  $('btnSaveGlucose')?.addEventListener('click', () => {
    const g = parseInt($('inGlucose').value, 10);
    if (!isNaN(g)) {
      vitalsState.bloodGlucose = g;
      $('dispGlucose').textContent = `${g}`;
      const badge = $('srcGlucose');
      if (badge) badge.textContent = 'manual input';
      alert(`Manual Blood Glucose saved: ${g} mg/dL`);
    } else {
      alert('Please enter a valid glucose number.');
    }
  });

  // Simulated Hardware Controls
  $('btnMeasureBP')?.addEventListener('click', () => {
    const sysList = [118, 120, 125, 130, 140];
    const diaList = [78, 80, 82, 85, 88];
    const idx = Math.floor(Math.random() * sysList.length);
    vitalsState.systolic = sysList[idx];
    vitalsState.diastolic = diaList[idx];
    $('dispBP').textContent = `${vitalsState.systolic} / ${vitalsState.diastolic}`;
    const badge = $('srcBP');
    if (badge) badge.textContent = 'device-captured';
    alert(`[Module 3 Hardware Sensor]: BP Cuff measurement completed -> ${vitalsState.systolic}/${vitalsState.diastolic} mmHg`);
  });

  $('btnCaptureSpO2')?.addEventListener('click', () => {
    const spo2List = [98, 97, 99, 96, 98];
    const hrList = [72, 76, 80, 74, 68];
    const idx = Math.floor(Math.random() * spo2List.length);
    vitalsState.spo2 = spo2List[idx];
    vitalsState.heartRate = hrList[idx];
    $('dispSpO2').textContent = `${vitalsState.spo2}%`;
    $('dispHR').textContent = `${vitalsState.heartRate}`;
    const badge = $('srcSpO2');
    if (badge) badge.textContent = 'device-captured';
    alert(`[Module 3 Hardware Sensor]: Pulse Oximeter captured -> SpO₂: ${vitalsState.spo2}%, HR: ${vitalsState.heartRate} bpm`);
  });

  $('btnReadGlucose')?.addEventListener('click', () => {
    const glucList = [92, 105, 110, 115, 120];
    const idx = Math.floor(Math.random() * glucList.length);
    vitalsState.bloodGlucose = glucList[idx];
    $('dispGlucose').textContent = `${vitalsState.bloodGlucose}`;
    const badge = $('srcGlucose');
    if (badge) badge.textContent = 'device-captured';
    alert(`[Module 3 Hardware Sensor]: Glucometer reading captured -> ${vitalsState.bloodGlucose} mg/dL`);
  });

  /**
   * Dynamic Multi-System Triage Evaluator
   * Evaluates BP, SpO2, Glucose, Severity, and Chief Complaints against clinical thresholds
   */
  function calculateClinicalTriageLevel(vitals, severity, complaintsText = '') {
    const sys = Number(vitals.systolic);
    const dia = Number(vitals.diastolic);
    const spo2 = Number(vitals.spo2);
    const glucose = Number(vitals.bloodGlucose);
    const text = String(complaintsText).toLowerCase();

    // Red flag keyword checks across specialties
    const isCardiacEmergency = /(heart\s*attack|myocardial|cardiac|chest\s*(pain|tightness|pressure)|angina)/i.test(text);
    const isStrokeEmergency = /(stroke|facial\s*droop|arm\s*weakness|slurred\s*speech|paralysis)/i.test(text);
    const isAirwayEmergency = /(stridor|choking|gasping|severe\s*asthma)/i.test(text);
    const isUnconscious = /(unconscious|faint|syncope|seizure|bleeding)/i.test(text);

    // Tightened Glycemic rules:
    // DKA/HHS Crisis: glucose >= 250 with nausea/vomiting/abdominal pain/tachypnea
    const hasDkaSymptoms = /(vomit|nausea|abdominal\s*pain|breath)/i.test(text);
    const isDkaCrisis = glucose >= 250 && hasDkaSymptoms;
    const isSevereHypoglycemia = glucose > 0 && glucose < 60;

    // EMERGENCY Thresholds (Level 1)
    if (
      isCardiacEmergency ||
      isStrokeEmergency ||
      isAirwayEmergency ||
      isUnconscious ||
      isDkaCrisis ||
      isSevereHypoglycemia ||
      sys >= 180 ||
      dia >= 120 ||
      (sys > 0 && sys < 90) ||
      (spo2 > 0 && spo2 < 90)
    ) {
      return {
        triageLevel: 'EMERGENCY',
        urgencyScore: 10,
        action: 'IMMEDIATE_DOCTOR_ALERT',
        reason: isCardiacEmergency
          ? 'Acute Cardiac Red Flag Presentation (Heart Attack / ACS Suspected).'
          : isStrokeEmergency
          ? 'Acute Neurological Red Flag (FAST Stroke Criteria).'
          : isDkaCrisis
          ? 'Hyperglycemic Crisis (Suspected DKA/HHS).'
          : isSevereHypoglycemia
          ? 'Severe Hypoglycemia (< 60 mg/dL).'
          : 'Critical physiological threshold exceeded (Hypertensive Crisis / Severe Hypoxemia / Shock).'
      };
    }

    // URGENT Thresholds (Level 2)
    const isAcuteAbdomen = /(acute\s*abdomen|appendicitis|pancreatitis|peritonitis|severe\s*abdominal\s*pain|severe\s*stomach\s*pain)/i.test(text);
    const isGiBleed = /(vomit(ing)?\s*blood|hematemesis|black\s*stool|melena)/i.test(text);
    const isHemoptysis = /(cough(ing)?\s*blood|hemoptysis)/i.test(text);
    const isAms = /(mountain\s*sickness|altitude\s*sickness)/i.test(text);

    const hasUrgentVitals = (sys >= 160 || dia >= 100) ||
      (spo2 > 0 && spo2 < 94) ||
      glucose >= 200 ||
      (vitals.heartRate > 150 || (vitals.heartRate > 0 && vitals.heartRate < 40));

    if (isAcuteAbdomen || isGiBleed || isHemoptysis || isAms || hasUrgentVitals) {
      return {
        triageLevel: 'URGENT',
        urgencyScore: 7,
        action: 'PRIORITY_REVIEW',
        reason: isAcuteAbdomen
          ? 'Acute Abdomen: Severe abdominal distress requiring expedited surgical/physician review.'
          : isGiBleed
          ? 'Gastrointestinal Bleeding Alert: Expedited endoscopic evaluation required.'
          : glucose >= 300
          ? 'Isolated Severe Hyperglycemia (>= 300 mg/dL): Priority clinical evaluation and ketone check required.'
          : hasUrgentVitals
          ? 'Elevated physiological risk parameters (Stage 2 Hypertension / Moderate Hypoxemia / Glycemic Elevation).'
          : 'Priority clinical review required.'
      };
    }

    // ROUTINE (Level 3)
    const isRoutineIllness = /(cold|common\s*cold|coryza|rhinitis|runny\s*nose|stuffy\s*nose|sneezing|cough|sore\s*throat|pharyngitis|mild\s*fever|indigestion|acidity|gas|sprain|strain|checkup|routine|consultation)/i.test(text);
    return {
      triageLevel: 'ROUTINE',
      urgencyScore: 3,
      action: 'STANDARD_QUEUE',
      reason: isRoutineIllness
        ? 'Common viral or routine condition with stable vitals. Assigned to standard outpatient queue.'
        : 'Stable physiological vitals within normal parameters. Assigned to standard queue.'
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

    // Calculate Triage Level dynamically via Multi-System Engine
    const chiefComplaintText = `${$('chiefComplaint').value} ${$('hpiNarrative').value}`;
    const triageEval = calculateClinicalTriageLevel(vitalsState, severity, chiefComplaintText);

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
