(() => {
  const socket = (typeof io !== 'undefined') ? io() : null;

  const $ = (id) => document.getElementById(id);

  // OCR Documents State
const ocrDocuments = [];

  // Vitals State - null until captured by hardware or entered manually
  const vitalsState = {
    systolic: null,
    diastolic: null,
    spo2: null,
    heartRate: null,
    bloodGlucose: null,
    provenance: {
      bp: 'unmeasured',
      spo2: 'unmeasured',
      glucose: 'unmeasured'
    }
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

  // Real-time manual vitals auto-harvest & input listeners
  function syncBPInputs() {
    const s = parseInt($('inSys')?.value, 10);
    const d = parseInt($('inDia')?.value, 10);
    if (!isNaN(s) && !isNaN(d)) {
      vitalsState.systolic = s;
      vitalsState.diastolic = d;
      vitalsState.provenance.bp = 'manual-entry';
      if ($('dispBP')) $('dispBP').textContent = `${s} / ${d}`;
      const badge = $('srcBP');
      if (badge) badge.textContent = 'manual input';
      updateVitalsModeBadge();
    }
  }

  function syncSpO2Inputs() {
    const sp = parseInt($('inSpO2')?.value, 10);
    const hr = parseInt($('inHR')?.value, 10);
    if (!isNaN(sp)) {
      vitalsState.spo2 = sp;
      vitalsState.provenance.spo2 = 'manual-entry';
      if ($('dispSpO2')) $('dispSpO2').textContent = `${sp}%`;
      const badge = $('srcSpO2');
      if (badge) badge.textContent = 'manual input';
    }
    if (!isNaN(hr)) {
      vitalsState.heartRate = hr;
      if ($('dispHR')) $('dispHR').textContent = `${hr}`;
    }
    updateVitalsModeBadge();
  }

  function syncGlucoseInput() {
    const g = parseFloat($('inGlucose')?.value);
    if (!isNaN(g)) {
      vitalsState.bloodGlucose = g;
      vitalsState.provenance.glucose = 'manual-entry';
      if ($('dispGlucose')) $('dispGlucose').textContent = `${g}`;
      const badge = $('srcGlucose');
      if (badge) badge.textContent = 'manual input';
      updateVitalsModeBadge();
    }
  }

  function updateVitalsModeBadge() {
    const hasAny = vitalsState.systolic !== null || vitalsState.spo2 !== null || vitalsState.bloodGlucose !== null;
    const badge = $('vitalsModeBadge');
    if (badge) {
      badge.textContent = hasAny ? '[VITALS CAPTURED]' : '[NO VITALS CAPTURED]';
      badge.style.color = hasAny ? '#0f766e' : '#b45309';
    }
  }

  $('inSys')?.addEventListener('input', syncBPInputs);
  $('inDia')?.addEventListener('input', syncBPInputs);
  $('inSpO2')?.addEventListener('input', syncSpO2Inputs);
  $('inHR')?.addEventListener('input', syncSpO2Inputs);
  $('inGlucose')?.addEventListener('input', syncGlucoseInput);

  $('btnSaveBP')?.addEventListener('click', syncBPInputs);
  $('btnSaveSpO2')?.addEventListener('click', syncSpO2Inputs);
  $('btnSaveGlucose')?.addEventListener('click', syncGlucoseInput);

  // Hardware Scanner Trigger (Calls FastAPI/ESP32 via Backend)
  async function triggerHardwareVitalScan(expectedType) {
    const activeSessionId = $('kioskSessionId')?.value || `KIOSK-${Date.now()}`;
    try {
      const resp = await fetch('/api/v1/vitals/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: activeSessionId })
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) {
        throw new Error(data.error || 'Hardware scanner communication failed.');
      }
      const reading = data.reading;
      if (reading.type === 'spo2') {
        vitalsState.spo2 = Number(reading.value);
        vitalsState.provenance.spo2 = 'device-captured';
        $('dispSpO2').textContent = `${reading.value}%`;
        const badge = $('srcSpO2');
        if (badge) badge.textContent = 'device-captured';
      } else if (reading.type === 'blood_pressure') {
        const parts = String(reading.value).split('/');
        vitalsState.systolic = Number(parts[0]) || null;
        vitalsState.diastolic = Number(parts[1]) || null;
        vitalsState.provenance.bp = 'device-captured';
        $('dispBP').textContent = `${reading.value}`;
        const badge = $('srcBP');
        if (badge) badge.textContent = 'device-captured';
      } else {
        vitalsState.bloodGlucose = Number(reading.value);
        vitalsState.provenance.glucose = 'device-captured';
        $('dispGlucose').textContent = `${reading.value}`;
        const badge = $('srcGlucose');
        if (badge) badge.textContent = 'device-captured';
      }
      alert(`[Hardware Sensor]: Captured ${reading.type} reading: ${reading.value} ${reading.unit || ''}`);
    } catch (err) {
      alert(`Hardware Scanner: ${err.message}\nPlease enter measurement manually if device is offline.`);
    }
  }

  $('btnMeasureBP')?.addEventListener('click', () => triggerHardwareVitalScan('blood_pressure'));
  $('btnCaptureSpO2')?.addEventListener('click', () => triggerHardwareVitalScan('spo2'));
  $('btnReadGlucose')?.addEventListener('click', () => triggerHardwareVitalScan('blood_glucose'));

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

    // Automatically harvest any entered manual vitals before submit
    syncBPInputs();
    syncSpO2Inputs();
    syncGlucoseInput();

    // Calculate Triage Level dynamically via Multi-System Engine
    const chiefComplaintText = `${$('chiefComplaint').value} ${$('hpiNarrative').value}`;
    const triageEval = calculateClinicalTriageLevel(vitalsState, severity, chiefComplaintText);

    const bpString = (vitalsState.systolic !== null && vitalsState.diastolic !== null)
      ? `${vitalsState.systolic}/${vitalsState.diastolic}`
      : undefined;

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
        bloodPressure: (vitalsState.systolic !== null && vitalsState.diastolic !== null) ? {
          systolic: { value: vitalsState.systolic, unit: 'mmHg', provenanceMeta: { provenance: vitalsState.provenance.bp, confidence: vitalsState.provenance.bp === 'device-captured' ? 0.99 : 0.95, timestamp } },
          diastolic: { value: vitalsState.diastolic, unit: 'mmHg', provenanceMeta: { provenance: vitalsState.provenance.bp, confidence: vitalsState.provenance.bp === 'device-captured' ? 0.99 : 0.95, timestamp } }
        } : undefined,
        spo2: vitalsState.spo2 !== null ? { value: vitalsState.spo2, unit: '%', provenanceMeta: { provenance: vitalsState.provenance.spo2, confidence: vitalsState.provenance.spo2 === 'device-captured' ? 0.98 : 0.95, timestamp } } : undefined,
        heartRate: vitalsState.heartRate !== null ? { value: vitalsState.heartRate, unit: 'bpm', provenanceMeta: { provenance: vitalsState.provenance.spo2, confidence: vitalsState.provenance.spo2 === 'device-captured' ? 0.99 : 0.95, timestamp } } : undefined,
        bloodGlucose: vitalsState.bloodGlucose !== null ? { value: vitalsState.bloodGlucose, unit: 'mg/dL', provenanceMeta: { provenance: vitalsState.provenance.glucose, confidence: vitalsState.provenance.glucose === 'device-captured' ? 0.96 : 0.95, timestamp } } : undefined,
        // Flat aliases to guarantee compatibility across all consumers
        bp: bpString,
        systolic: vitalsState.systolic !== null ? vitalsState.systolic : undefined,
        diastolic: vitalsState.diastolic !== null ? vitalsState.diastolic : undefined,
        hr: vitalsState.heartRate !== null ? vitalsState.heartRate : undefined,
        glucose: vitalsState.bloodGlucose !== null ? vitalsState.bloodGlucose : undefined,
        bloodSugar: vitalsState.bloodGlucose !== null ? `${vitalsState.bloodGlucose} mg/dL` : undefined
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
