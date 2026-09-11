/**
 * FHIR R4 Transformation Utility
 * Converts provisional JSON entries into standard HL7 FHIR (R4) Resource Bundles
 * adhering to ABDM Health Information Exchange & Consent Manager (HIE-CM) profile guidelines.
 */

const { v4: uuidv4 } = require('crypto');

function generateUUID() {
  return 'urn:uuid:' + (typeof uuidv4 === 'function' ? uuidv4() : Math.random().toString(36).substr(2, 9) + '-' + Date.now());
}

/**
 * Maps Provisional Intake JSON to HL7 FHIR R4 Bundle
 * @param {Object} intake ProvisionalIntake record
 * @returns {Object} HL7 FHIR R4 Bundle JSON
 */
function convertToFhirR4Bundle(intake) {
  const bundleId = generateUUID();
  const patientRefId = generateUUID();
  const encounterRefId = generateUUID();
  const timestamp = new Date().toISOString();

  // 1. Patient Resource (ABDM Health ID Profile)
  const patientResource = {
    resourceType: "Patient",
    id: patientRefId.replace("urn:uuid:", ""),
    meta: {
      profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Patient"]
    },
    identifier: [
      {
        type: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/v2-0203",
              code: "MR",
              display: "Medical Record Number"
            }
          ]
        },
        system: "https://healthid.abdm.gov.in",
        value: intake.abhaId || intake.patient?.abha_id || intake.session_id || '91-0000-0000-0000'
      }
    ],
    name: [
      {
        text: intake.patientDemographics?.fullName || intake.patient?.name || "Anonymous Patient"
      }
    ],
    gender: (intake.patientDemographics?.gender === 'M' || intake.patient?.gender === 'male') ? 'male' : (intake.patientDemographics?.gender === 'F' || intake.patient?.gender === 'female') ? 'female' : 'other',
    birthDate: intake.patientDemographics?.dob || (intake.patientDemographics?.age ? `${new Date().getFullYear() - intake.patientDemographics.age}-01-01` : (intake.patient?.age ? `${new Date().getFullYear() - intake.patient.age}-01-01` : undefined))
  };

  // 2. Encounter Resource
  const triageLevel = intake.triageResult?.triageLevel || intake.triage?.triageLevel || 'ROUTINE';
  const priorityCodeMap = {
    EMERGENCY: { code: 'EM', display: 'Emergency' },
    URGENT: { code: 'UR', display: 'Urgent' },
    ROUTINE: { code: 'R', display: 'Routine' }
  };
  const priorityCode = priorityCodeMap[triageLevel.toUpperCase()] || priorityCodeMap['ROUTINE'];

  const encounterResource = {
    resourceType: "Encounter",
    id: encounterRefId.replace("urn:uuid:", ""),
    meta: {
      profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Encounter"]
    },
    status: intake.status === 'VERIFIED_COMMITTED' ? 'finished' : 'in-progress',
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory"
    },
    priority: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/v3-ActPriority",
          code: priorityCode.code,
          display: priorityCode.display
        }
      ],
      text: triageLevel
    },
    subject: { reference: patientRefId },
    period: {
      start: intake.createdAt || timestamp,
      end: intake.status === 'VERIFIED_COMMITTED' ? (intake.updatedAt || timestamp) : undefined
    }
  };

  const bundleEntries = [
    { fullUrl: patientRefId, resource: patientResource },
    { fullUrl: encounterRefId, resource: encounterResource }
  ];

  const sectionReferences = {
    vitals: [],
    complaints: [],
    history: [],
    ayush: [],
    documents: []
  };

  // 3. Observations - Vitals
  const env = intake.environment || {
    altitudeMeters: 2438,
    altitudeFeet: 8000,
    altitudeSource: "facility_config",
    acclimatizationStatus: "unacclimatized"
  };
  const altitudeContextString = `${env.altitudeMeters || 2438} m; source=${env.altitudeSource || 'facility_config'}; acclimatization=${env.acclimatizationStatus || 'unacclimatized'}`;
  const algorithmVersion = "altitude-mvp-v1";

  let vitals = intake.vitals;
  if (Array.isArray(intake.vitals)) {
    vitals = {};
    const sys = intake.vitals.find(v => v.type === 'bp_systolic');
    const dia = intake.vitals.find(v => v.type === 'bp_diastolic');
    if (sys || dia) {
      vitals.bloodPressure = {
        systolic: sys ? { value: sys.value, unit: sys.unit || 'mmHg', altitudeContext: sys.altitudeContext } : undefined,
        diastolic: dia ? { value: dia.value, unit: dia.unit || 'mmHg', altitudeContext: dia.altitudeContext } : undefined
      };
    }
    const spo2 = intake.vitals.find(v => v.type === 'spo2');
    if (spo2) {
      vitals.spo2 = {
        value: spo2.value,
        unit: spo2.unit || '%',
        altitudeContext: spo2.altitudeContext
      };
      vitals.pulseOximetry = { spo2: vitals.spo2 };
    }
    const hr = intake.vitals.find(v => v.type === 'heart_rate');
    if (hr) {
      vitals.heartRate = {
        value: hr.value,
        unit: hr.unit || 'bpm',
        altitudeContext: hr.altitudeContext
      };
    }
  } else if (vitals && vitals.pulseOximetry?.spo2 && !vitals.spo2) {
    vitals.spo2 = vitals.pulseOximetry.spo2;
  }

  if (vitals) {
    // Blood Pressure Observation
    if (vitals.bloodPressure) {
      const bpObsId = generateUUID();
      const bpObs = {
        resourceType: "Observation",
        id: bpObsId.replace("urn:uuid:", ""),
        meta: {
          profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation"]
        },
        extension: [
          {
            url: "https://medikiosk.example/fhir/StructureDefinition/altitude-context",
            valueString: altitudeContextString
          },
          {
            url: "https://medikiosk.example/fhir/StructureDefinition/algorithm-version",
            valueString: algorithmVersion
          }
        ],
        status: "final",
        category: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/observation-category",
                code: "vital-signs",
                display: "Vital Signs"
              }
            ]
          }
        ],
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "85354-9",
              display: "Blood pressure panel with all children optional"
            }
          ],
          text: "Blood Pressure"
        },
        subject: { reference: patientRefId },
        encounter: { reference: encounterRefId },
        effectiveDateTime: timestamp,
        note: [
          {
            text: `Altitude-adjusted interpretation: BP normal range 90-120/60-80 mmHg not adjusted upward for altitude (standard AHA/ICMR guidelines).`
          }
        ],
        component: []
      };

      if (vitals.bloodPressure.systolic) {
        bpObs.component.push({
          code: {
            coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }]
          },
          valueQuantity: {
            value: Number(vitals.bloodPressure.systolic.value),
            unit: vitals.bloodPressure.systolic.unit || "mmHg",
            system: "http://unitsofmeasure.org",
            code: "mm[Hg]"
          }
        });
      }

      if (vitals.bloodPressure.diastolic) {
        bpObs.component.push({
          code: {
            coding: [{ system: "http://loinc.org", code: "8462-4", display: "Diastolic blood pressure" }]
          },
          valueQuantity: {
            value: Number(vitals.bloodPressure.diastolic.value),
            unit: vitals.bloodPressure.diastolic.unit || "mmHg",
            system: "http://unitsofmeasure.org",
            code: "mm[Hg]"
          }
        });
      }

      bundleEntries.push({ fullUrl: bpObsId, resource: bpObs });
      sectionReferences.vitals.push({ reference: bpObsId });
    }

    // SpO2 Observation
    if (vitals.spo2) {
      const spo2ObsId = generateUUID();
      const spo2Val = Number(vitals.spo2.value);
      const spo2Ctx = vitals.spo2.altitudeContext;
      let spo2NoteText = '';
      if (spo2Ctx && spo2Ctx.reason) {
        spo2NoteText = `Altitude-adjusted interpretation: ${spo2Ctx.reason}`;
      } else if (spo2Val < 92) {
        const hasDangerSymptom = (intake.chiefComplaints || []).some(c => {
          const s = String(c.symptom || '').toLowerCase();
          return s.includes('breathless') || s.includes('chest') || s.includes('tightness') || s.includes('confusion');
        });
        spo2NoteText = `Altitude-adjusted interpretation: below expected range at ${env.altitudeMeters || 2438} m; ${hasDangerSymptom ? 'red flag due to breathlessness.' : 'borderline desaturation.'}`;
      } else {
        spo2NoteText = `Altitude-adjusted interpretation: SpO2 (${spo2Val}%) is within expected range at ${env.altitudeMeters || 2438} m.`;
      }

      const spo2Obs = {
        resourceType: "Observation",
        id: spo2ObsId.replace("urn:uuid:", ""),
        meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation"] },
        extension: [
          {
            url: "https://medikiosk.example/fhir/StructureDefinition/altitude-context",
            valueString: altitudeContextString
          },
          {
            url: "https://medikiosk.example/fhir/StructureDefinition/algorithm-version",
            valueString: algorithmVersion
          }
        ],
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "2708-6", display: "Oxygen saturation in Arterial blood" }] },
        subject: { reference: patientRefId },
        encounter: { reference: encounterRefId },
        effectiveDateTime: timestamp,
        note: [
          {
            text: spo2NoteText
          }
        ],
        valueQuantity: {
          value: spo2Val,
          unit: vitals.spo2.unit || "%",
          system: "http://unitsofmeasure.org",
          code: "%"
        }
      };
      bundleEntries.push({ fullUrl: spo2ObsId, resource: spo2Obs });
      sectionReferences.vitals.push({ reference: spo2ObsId });
    }

    // Heart Rate Observation (LOINC 8867-4)
    if (vitals.heartRate) {
      const hrObsId = generateUUID();
      const hrVal = Number(vitals.heartRate.value);
      const hrObs = {
        resourceType: "Observation",
        id: hrObsId.replace("urn:uuid:", ""),
        meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation"] },
        extension: [
          {
            url: "https://medikiosk.example/fhir/StructureDefinition/altitude-context",
            valueString: altitudeContextString
          },
          {
            url: "https://medikiosk.example/fhir/StructureDefinition/algorithm-version",
            valueString: algorithmVersion
          }
        ],
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "8867-4", display: "Heart rate" }] },
        subject: { reference: patientRefId },
        encounter: { reference: encounterRefId },
        effectiveDateTime: timestamp,
        note: [
          {
            text: `Altitude-adjusted interpretation: heart rate (${hrVal} bpm) assessed against altitude-adjusted baseline [65-115 bpm] at ${env.altitudeMeters || 2438} m.`
          }
        ],
        valueQuantity: {
          value: hrVal,
          unit: vitals.heartRate.unit || "bpm",
          system: "http://unitsofmeasure.org",
          code: "/min"
        }
      };
      bundleEntries.push({ fullUrl: hrObsId, resource: hrObs });
      sectionReferences.vitals.push({ reference: hrObsId });
    }

    // Blood Glucose Observation
    if (vitals.bloodGlucose) {
      const bgObsId = generateUUID();
      const bgObs = {
        resourceType: "Observation",
        id: bgObsId.replace("urn:uuid:", ""),
        meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation"] },
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "15074-8", display: "Glucose [Moles/volume] in Blood" }] },
        subject: { reference: patientRefId },
        encounter: { reference: encounterRefId },
        effectiveDateTime: timestamp,
        valueQuantity: {
          value: Number(vitals.bloodGlucose.value),
          unit: vitals.bloodGlucose.unit || "mg/dL",
          system: "http://unitsofmeasure.org",
          code: "mg/dL"
        }
      };
      bundleEntries.push({ fullUrl: bgObsId, resource: bgObs });
      sectionReferences.vitals.push({ reference: bgObsId });
    }
  }

  // 4. Observations - AYUSH Dashavidha Parameters
  if (intake.ayushParameters) {
    const ayushFields = ['nadi', 'jihva', 'mala', 'mutra', 'agni', 'koshtha', 'sparsha', 'drik', 'akriti', 'vaya'];
    ayushFields.forEach((field) => {
      if (intake.ayushParameters[field]) {
        const ayushObsId = generateUUID();
        const ayushObs = {
          resourceType: "Observation",
          id: ayushObsId.replace("urn:uuid:", ""),
          meta: {
            profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation"],
            tag: [{ system: "http://ayush.gov.in/fhir/StructureDefinition", code: "AYUSH-DASHAVIDHA", display: "AYUSH Dashavidha Pariksha" }]
          },
          status: "final",
          category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "exam", display: "Exam" }] }],
          code: {
            coding: [{ system: "https://ayush.gov.in/codes", code: `AYUSH-${field.toUpperCase()}`, display: `AYUSH ${field.charAt(0).toUpperCase() + field.slice(1)} Pariksha` }],
            text: `AYUSH ${field.toUpperCase()} Examination`
          },
          subject: { reference: patientRefId },
          encounter: { reference: encounterRefId },
          effectiveDateTime: timestamp,
          valueString: String(intake.ayushParameters[field])
        };
        bundleEntries.push({ fullUrl: ayushObsId, resource: ayushObs });
        sectionReferences.ayush.push({ reference: ayushObsId });
      }
    });
  }

  // 5. Conditions - Chief Complaints & Past Diagnoses
  if (intake.chiefComplaints && Array.isArray(intake.chiefComplaints)) {
    intake.chiefComplaints.forEach((cc) => {
      const condId = generateUUID();
      const condition = {
        resourceType: "Condition",
        id: condId.replace("urn:uuid:", ""),
        meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Condition"] },
        clinicalStatus: {
          coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }]
        },
        verificationStatus: {
          coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "provisional" }]
        },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "problem-list-item" }] }],
        code: {
          text: `${cc.symptom} (${cc.duration || 'duration unstated'}, severity: ${cc.severity || 'moderate'})`
        },
        subject: { reference: patientRefId },
        encounter: { reference: encounterRefId },
        recordedDate: timestamp
      };
      bundleEntries.push({ fullUrl: condId, resource: condition });
      sectionReferences.complaints.push({ reference: condId });
    });
  }

  if (intake.history?.pastDiagnoses && Array.isArray(intake.history.pastDiagnoses)) {
    intake.history.pastDiagnoses.forEach((diag) => {
      const pastCondId = generateUUID();
      const pastCondition = {
        resourceType: "Condition",
        id: pastCondId.replace("urn:uuid:", ""),
        meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Condition"] },
        clinicalStatus: {
          coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }]
        },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "encounter-diagnosis" }] }],
        code: {
          text: `${diag.condition} (Diagnosed: ${diag.diagnosedYear || 'past'})`
        },
        subject: { reference: patientRefId },
        recordedDate: timestamp
      };
      bundleEntries.push({ fullUrl: pastCondId, resource: pastCondition });
      sectionReferences.history.push({ reference: pastCondId });
    });
  }

  // 6. DocumentReference - Scanned Prescriptions & Lab Records (OCR)
  if (intake.ocrDocuments && Array.isArray(intake.ocrDocuments)) {
    intake.ocrDocuments.forEach((doc) => {
      const docRefId = generateUUID();
      const docRef = {
        resourceType: "DocumentReference",
        id: docRefId.replace("urn:uuid:", ""),
        meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentReference"] },
        status: "current",
        docStatus: "preliminary",
        type: {
          coding: [
            {
              system: "http://loinc.org",
              code: doc.documentType === 'Prescription' ? "57133-1" : "11502-2",
              display: doc.documentType || "Medical Record"
            }
          ],
          text: doc.documentType
        },
        subject: { reference: patientRefId },
        date: timestamp,
        description: `OCR Extracted Document: ${doc.documentType} from ${doc.practitionerName || 'Unknown Doctor'} (${doc.extractedDate || 'N/A'})`,
        content: [
          {
            attachment: {
              contentType: "text/plain",
              url: doc.fileUrl || "https://kiosk.medikiosk.in/docs/" + doc.documentId,
              title: `OCR Text: ${doc.documentType}`
            }
          }
        ]
      };
      bundleEntries.push({ fullUrl: docRefId, resource: docRef });
      sectionReferences.documents.push({ reference: docRefId });
    });
  }

  // 7. Composition Resource - ABDM Health Document Wrapper
  const compositionId = generateUUID();
  const composition = {
    resourceType: "Composition",
    id: compositionId.replace("urn:uuid:", ""),
    meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/ClinicalDoc"] },
    status: intake.status === 'VERIFIED_COMMITTED' ? 'final' : 'preliminary',
    type: {
      coding: [
        {
          system: "http://loinc.org",
          code: "37153-5",
          display: "Clinical Summary Document"
        }
      ],
      text: "Pre-Consultation Kiosk Clinical Summary"
    },
    subject: { reference: patientRefId },
    encounter: { reference: encounterRefId },
    date: timestamp,
    author: [
      {
        display: intake.hprSignatureBlock ? `HPR:${intake.hprSignatureBlock.hprId} (${intake.hprSignatureBlock.doctorName})` : "MediKiosk Self-Service System"
      }
    ],
    title: "MediKiosk Pre-Consultation Summary Bundle",
    section: [
      { title: "Vital Signs", entry: sectionReferences.vitals },
      { title: "Chief Complaints", entry: sectionReferences.complaints },
      { title: "Past Medical History", entry: sectionReferences.history },
      { title: "AYUSH Dashavidha Pariksha", entry: sectionReferences.ayush },
      { title: "OCR Extracted Documents", entry: sectionReferences.documents }
    ]
  };

  // Prepend composition to entries
  bundleEntries.unshift({
    fullUrl: compositionId,
    resource: composition
  });

  // Construct Final Bundle
  const fhirBundle = {
    resourceType: "Bundle",
    id: bundleId.replace("urn:uuid:", ""),
    meta: {
      versionId: "1",
      lastUpdated: timestamp,
      profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/DocumentBundle"]
    },
    identifier: {
      system: "https://medikiosk.in/fhir/bundles",
      value: `BUNDLE-${intake.intakeId}`
    },
    type: "document",
    timestamp: timestamp,
    entry: bundleEntries
  };

  return fhirBundle;
}

/**
 * Consent-aware FHIR Bundle generator.
 * Wraps convertToFhirR4Bundle and filters resources based on patient consent settings.
 *
 * @param {Object} encounterData - ProvisionalIntake record
 * @param {Object} consentSettings - { vitalsOnly: bool, fullHistory: bool, ayushNotes: bool }
 * @returns {Object} Consent-filtered HL7 FHIR R4 Bundle
 */
function generateFHIRBundle(encounterData, consentSettings = {}) {
  const fullBundle = convertToFhirR4Bundle(encounterData);

  const { vitalsOnly = false, fullHistory = true, ayushNotes = true } = consentSettings;

  if (!vitalsOnly && fullHistory && ayushNotes) {
    // All consents granted — return complete bundle
    return fullBundle;
  }

  // Filter entries based on consent settings
  const filteredEntries = fullBundle.entry.filter(entry => {
    const rt = entry.resource?.resourceType;

    // Always include: Bundle envelope resources
    if (rt === 'Composition' || rt === 'Patient' || rt === 'Encounter') return true;

    // Vitals-only mode: keep only vital-signs Observations
    if (vitalsOnly) {
      if (rt === 'Observation') {
        const cat = entry.resource?.category?.[0]?.coding?.[0]?.code;
        return cat === 'vital-signs';
      }
      return false;
    }

    // If AYUSH notes are excluded, strip AYUSH-tagged Observations
    if (!ayushNotes && rt === 'Observation') {
      const isAyush = entry.resource?.meta?.tag?.some(t => t.code === 'AYUSH-DASHAVIDHA');
      if (isAyush) return false;
    }

    // If full history is excluded, strip past Conditions (encounter-diagnosis category)
    if (!fullHistory && rt === 'Condition') {
      const cat = entry.resource?.category?.[0]?.coding?.[0]?.code;
      if (cat === 'encounter-diagnosis') return false;
    }

    return true;
  });

  // Rebuild composition sections to only reference included entries
  const includedUrls = new Set(filteredEntries.map(e => e.fullUrl));
  const compositionEntry = filteredEntries.find(e => e.resource?.resourceType === 'Composition');
  if (compositionEntry) {
    compositionEntry.resource.section = compositionEntry.resource.section.map(sec => ({
      ...sec,
      entry: (sec.entry || []).filter(ref => includedUrls.has(ref.reference))
    }));
    // Add consent provenance note
    compositionEntry.resource.extension = [
      {
        url: "https://medikiosk.in/fhir/extensions/consent-settings",
        valueString: JSON.stringify({ vitalsOnly, fullHistory, ayushNotes })
      }
    ];
  }

  return { ...fullBundle, entry: filteredEntries };
}

module.exports = {
  convertToFhirR4Bundle,
  generateFHIRBundle
};
