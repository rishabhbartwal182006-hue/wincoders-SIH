/**
 * Cross-Verification Discrepancy Engine
 * Analyzes multi-modal input payloads from Task 1 (Voice), Task 2 (OCR), Task 3 (Vitals), and Task 4 (Triage)
 * to detect conflicting data across source channels.
 */

function analyzeDiscrepancies(payload) {
  const flags = [];
  const { vitals, history, chiefComplaints, ocrDocuments } = payload;

  // 1. Check OCR vs Spoken Allergy / Medication Discrepancies
  if (ocrDocuments && Array.isArray(ocrDocuments)) {
    ocrDocuments.forEach((doc, idx) => {
      if (doc.extractedMedications && Array.isArray(doc.extractedMedications)) {
        doc.extractedMedications.forEach((ocrMed) => {
          const medName = ocrMed.name ? ocrMed.name.toLowerCase() : '';
          const spokenMeds = history?.currentMedications || [];
          
          // Check if OCR medication is missing from spoken medication list
          const matchSpoken = spokenMeds.some(m => m.medicationName && m.medicationName.toLowerCase().includes(medName));
          if (medName && !matchSpoken && spokenMeds.length > 0) {
            flags.push({
              flagId: `DISC_MED_${idx}_${Date.now()}`,
              category: "MEDICATION_MISMATCH",
              field: "history.currentMedications",
              message: `OCR document '${doc.documentType}' extracted medication '${ocrMed.name}' which was not reported in patient spoken history.`,
              valueSourceA: ocrMed.name,
              sourceA: "scanned-document",
              valueSourceB: spokenMeds.map(m => m.medicationName).join(', ') || "None reported",
              sourceB: "patient-spoken",
              severity: "MEDIUM"
            });
          }
        });
      }
    });
  }

  // 2. Check Device Vitals vs Spoken Symptoms Discrepancies
  if (vitals && vitals.bloodPressure) {
    const sys = Number(vitals.bloodPressure.systolic?.value);
    const dia = Number(vitals.bloodPressure.diastolic?.value);
    const hasDizzinessOrHeadache = chiefComplaints?.some(c => 
      c.symptom && (c.symptom.toLowerCase().includes('dizziness') || c.symptom.toLowerCase().includes('headache'))
    );

    // Elevated BP without reported symptoms or normal BP with reported severe hypertension symptoms
    if ((sys >= 160 || dia >= 100) && !hasDizzinessOrHeadache) {
      flags.push({
        flagId: `DISC_BP_ASYMPTOMATIC_${Date.now()}`,
        category: "VITAL_SYMPTOM_MISMATCH",
        field: "vitals.bloodPressure",
        message: `Device captured Stage 2 Hypertension (${sys}/${dia} mmHg), but patient voice intake did not report acute headache or dizziness.`,
        valueSourceA: `${sys}/${dia} mmHg`,
        sourceA: "device-captured",
        valueSourceB: "No hypertension symptoms reported",
        sourceB: "patient-spoken",
        severity: "HIGH"
      });
    }
  }

  // 3. SpO2 Hypoxia Discrepancy
  if (vitals && vitals.spo2) {
    const spo2Val = Number(vitals.spo2.value);
    const hasBreathlessness = chiefComplaints?.some(c => 
      c.symptom && (c.symptom.toLowerCase().includes('breath') || c.symptom.toLowerCase().includes('shortness') || c.symptom.toLowerCase().includes('dyspnea'))
    );

    if (spo2Val < 92 && !hasBreathlessness) {
      flags.push({
        flagId: `DISC_SPO2_ASYMPTOMATIC_${Date.now()}`,
        category: "VITAL_SYMPTOM_MISMATCH",
        field: "vitals.spo2",
        message: `Device captured low SpO2 saturation (${spo2Val}%), but patient did not report dyspnea or breathlessness.`,
        valueSourceA: `${spo2Val}%`,
        sourceA: "device-captured",
        valueSourceB: "No respiratory complaints",
        sourceB: "patient-spoken",
        severity: "CRITICAL"
      });
    }
  }

  // 4. Past Diagnosis vs Voice Complaint Discrepancy (e.g. Diabetes in OCR vs denied in Voice)
  if (history?.pastDiagnoses && Array.isArray(history.pastDiagnoses)) {
    const hasDiabeticRecord = history.pastDiagnoses.some(d => d.condition && d.condition.toLowerCase().includes('diab'));
    if (hasDiabeticRecord && vitals?.bloodGlucose) {
      const glucose = Number(vitals.bloodGlucose.value);
      if (glucose > 250) {
        flags.push({
          flagId: `DISC_GLUCOSE_ELEVATED_${Date.now()}`,
          category: "CLINICAL_ALERT",
          field: "vitals.bloodGlucose",
          message: `Elevated Blood Glucose (${glucose} mg/dL) correlates with past diagnosis of Diabetes mellitus. Urgent physician review recommended.`,
          valueSourceA: `${glucose} mg/dL`,
          sourceA: "device-captured",
          valueSourceB: "Diabetic History Recorded",
          sourceB: "scanned-document",
          severity: "HIGH"
        });
      }
    }
  }

  return flags;
}

module.exports = {
  analyzeDiscrepancies
};
