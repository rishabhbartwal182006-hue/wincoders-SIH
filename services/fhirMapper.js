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
        value: intake.abhaId
      }
    ],
    name: [
      {
        text: intake.patientDemographics?.fullName || "Anonymous Patient"
      }
    ],
    gender: intake.patientDemographics?.gender === 'M' ? 'male' : intake.patientDemographics?.gender === 'F' ? 'female' : 'other',
    birthDate: intake.patientDemographics?.dob || (intake.patientDemographics?.age ? `${new Date().getFullYear() - intake.patientDemographics.age}-01-01` : undefined)
  };

  const bundleEntries = [
    {
      fullUrl: patientRefId,
      resource: patientResource
    }
  ];

  const sectionReferences = {
    vitals: [],
    complaints: [],
    history: [],
    ayush: [],
    documents: []
  };

  // 2. Observations - Vitals
  if (intake.vitals) {
    // Blood Pressure Observation
    if (intake.vitals.bloodPressure) {
      const bpObsId = generateUUID();
      const bpObs = {
        resourceType: "Observation",
        id: bpObsId.replace("urn:uuid:", ""),
        meta: {
          profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation"]
        },
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
        effectiveDateTime: timestamp,
        component: []
      };

      if (intake.vitals.bloodPressure.systolic) {
        bpObs.component.push({
          code: {
            coding: [{ system: "http://loinc.org", code: "8480-6", display: "Systolic blood pressure" }]
          },
          valueQuantity: {
            value: Number(intake.vitals.bloodPressure.systolic.value),
            unit: intake.vitals.bloodPressure.systolic.unit || "mmHg",
            system: "http://unitsofmeasure.org",
            code: "mm[Hg]"
          }
        });
      }

      if (intake.vitals.bloodPressure.diastolic) {
        bpObs.component.push({
          code: {
            coding: [{ system: "http://loinc.org", code: "8462-4", display: "Diastolic blood pressure" }]
          },
          valueQuantity: {
            value: Number(intake.vitals.bloodPressure.diastolic.value),
            unit: intake.vitals.bloodPressure.diastolic.unit || "mmHg",
            system: "http://unitsofmeasure.org",
            code: "mm[Hg]"
          }
        });
      }

      bundleEntries.push({ fullUrl: bpObsId, resource: bpObs });
      sectionReferences.vitals.push({ reference: bpObsId });
    }

    // SpO2 Observation
    if (intake.vitals.spo2) {
      const spo2ObsId = generateUUID();
      const spo2Obs = {
        resourceType: "Observation",
        id: spo2ObsId.replace("urn:uuid:", ""),
        meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation"] },
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "2708-6", display: "Oxygen saturation in Arterial blood" }] },
        subject: { reference: patientRefId },
        effectiveDateTime: timestamp,
        valueQuantity: {
          value: Number(intake.vitals.spo2.value),
          unit: intake.vitals.spo2.unit || "%",
          system: "http://unitsofmeasure.org",
          code: "%"
        }
      };
      bundleEntries.push({ fullUrl: spo2ObsId, resource: spo2Obs });
      sectionReferences.vitals.push({ reference: spo2ObsId });
    }

    // Blood Glucose Observation
    if (intake.vitals.bloodGlucose) {
      const bgObsId = generateUUID();
      const bgObs = {
        resourceType: "Observation",
        id: bgObsId.replace("urn:uuid:", ""),
        meta: { profile: ["https://nrces.in/ndhm/fhir/r4/StructureDefinition/Observation"] },
        status: "final",
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "laboratory" }] }],
        code: { coding: [{ system: "http://loinc.org", code: "15074-8", display: "Glucose [Moles/volume] in Blood" }] },
        subject: { reference: patientRefId },
        effectiveDateTime: timestamp,
        valueQuantity: {
          value: Number(intake.vitals.bloodGlucose.value),
          unit: intake.vitals.bloodGlucose.unit || "mg/dL",
          system: "http://unitsofmeasure.org",
          code: "mg/dL"
        }
      };
      bundleEntries.push({ fullUrl: bgObsId, resource: bgObs });
      sectionReferences.vitals.push({ reference: bgObsId });
    }
  }

  // 3. Observations - AYUSH Dashavidha Parameters
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
          effectiveDateTime: timestamp,
          valueString: String(intake.ayushParameters[field])
        };
        bundleEntries.push({ fullUrl: ayushObsId, resource: ayushObs });
        sectionReferences.ayush.push({ reference: ayushObsId });
      }
    });
  }

  // 4. Conditions - Chief Complaints & Past Diagnoses
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

  // 5. DocumentReference - Scanned Prescriptions & Lab Records (Task 2 OCR)
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

  // 6. Composition Resource - ABDM Health Document Wrapper
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

module.exports = {
  convertToFhirR4Bundle
};
