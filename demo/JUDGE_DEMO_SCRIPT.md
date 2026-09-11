# MediKiosk Altitude-Aware Intake: Judge Pitch & Demo Guide

> **Standard Safety & Regulatory Disclaimer**:
> *“Decision-support MVP. Illustrative altitude profiles. Raw values preserved. Clinician sign-off required. Pilot validation needed.”*

---

## The Pitch Line
> **“We don’t need altitude hardware. We need altitude context. The kiosk already captures symptoms and vitals. Our MVP adds a configurable altitude profile and rule engine that interprets readings in context, while preserving raw data and keeping the clinician in control.”**

---

## Quick Demo Flow

| Step | Action | Command / Location | Expected Result |
| :--- | :--- | :--- | :--- |
| **1** | Run Scenario A (Sea Level) | `node demo/load_scenario.js --scenario=a` | SpO2 88% at 0m triggers **Immediate Critical Red Flag** (`severe_hypoxemia_at_altitude`). BP 120/80 is normal. |
| **2** | Run Scenario B (8,000 ft) | `node demo/load_scenario.js --scenario=b` | SpO2 88% at 2,438m with chest tightness triggers **Critical Red Flag** (`hypoxemia_at_altitude_with_danger_symptoms`). BP 120/80 is normal. |
| **3** | View Both Scenarios | `node demo/load_scenario.js --all` | Displays complete side-by-side matrices and SHA-256 chained audit logs. |
| **4** | Inspect Doctor Dashboard | `http://localhost:4000/doctor` | Real-time Altitude Vitals Card, elevation badge, and HPR-authenticated Physician Override Modal. |
| **5** | Run Full Test Suite | `node test_altitude_phase3.js` | Automated end-to-end verification of FHIR R4 extensions, AuditLog hash chaining, triage rules, and safety disclaimers. |

---

## Architectural Pillars

### 1. Data Model & Raw Preservation
- Patient sensor readings remain pristine in `vitals[].value` and FHIR `valueQuantity`.
- Altitude context is segregated into `environment` (`altitudeMeters`, `altitudeSource`, `acclimatizationStatus`).
- Never conflates barometric altitude with patient height (`patient.heightCm`).

### 2. Clinical Precision Rules
- Normal Blood Pressure (120/80 mmHg) is **never adjusted upward** for altitude.
- Hypertensive crisis ($\ge$180 systolic or $\ge$120 diastolic) is a hard emergency regardless of altitude.
- SpO2 interpretation incorporates symptom danger signals (chest tightness, rest dyspnea, cyanosis, confusion).

### 3. ABDM & FHIR R4 Interoperability
- NRCeS India / ABDM compliant `Observation` resources.
- Extensions:
  * `https://medikiosk.example/fhir/StructureDefinition/altitude-context`
  * `https://medikiosk.example/fhir/StructureDefinition/algorithm-version`
- Contextual annotations in `Observation.note[].text`.

### 4. Tamper-Evident Cryptographic Audit Logging
- SHA-256 hash chaining: `currentHash = sha256(prevHash + timestamp + eventType + payload)`.
- Append-only immutability enforced at schema and database layers.
- Mandatory HPR biometric write-lock prevents unauthorized clinical record modifications.
