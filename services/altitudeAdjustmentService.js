const altitudeProfiles = require('../config/altitudeProfiles.json');

const ALGORITHM_VERSION = 'altitude-mvp-v1';
const DISCLAIMER = altitudeProfiles._disclaimer || 'Decision-support MVP. Illustrative altitude profiles. Raw values preserved. Clinician sign-off required. Pilot validation needed.';

const DANGER_SYMPTOMS = [
  'chest pain',
  'breathlessness at rest',
  'shortness of breath at rest',
  'shortness of breath',
  'dyspnea at rest',
  'confusion',
  'altered mental status',
  'cyanosis',
  'blue lips',
  'inability to walk',
  'ataxia',
  'fainting',
  'syncope',
  'loss of consciousness'
];

/**
 * Get matching altitude band profile for given altitude in meters
 * @param {number} altitudeMeters 
 * @returns {object} Matching band profile
 */
function getAltitudeProfile(altitudeMeters = 2438) {
  const meters = typeof altitudeMeters === 'number' && !isNaN(altitudeMeters) ? altitudeMeters : 2438;
  const bands = altitudeProfiles.bands;

  if (meters < 500) return { ...bands.sea_level };
  if (meters < 1500) return { ...bands.moderate };
  if (meters < 2500) return { ...bands.high };
  if (meters < 3500) return { ...bands.very_high };
  return { ...bands.extreme };
}

/**
 * Check if patient reports acute high-altitude danger symptoms
 * @param {Array|string} symptoms 
 * @returns {boolean}
 */
function hasDangerSymptoms(symptoms) {
  if (!symptoms) return false;

  const symptomList = [];
  if (typeof symptoms === 'string') {
    symptomList.push(symptoms.toLowerCase());
  } else if (Array.isArray(symptoms)) {
    for (const item of symptoms) {
      if (typeof item === 'string') {
        symptomList.push(item.toLowerCase());
      } else if (item && typeof item === 'object') {
        if (item.symptom) symptomList.push(String(item.symptom).toLowerCase());
        if (item.name) symptomList.push(String(item.name).toLowerCase());
        if (item.chief_complaint) symptomList.push(String(item.chief_complaint).toLowerCase());
        if (item.description) symptomList.push(String(item.description).toLowerCase());
      }
    }
  }

  return symptomList.some(text => 
    DANGER_SYMPTOMS.some(danger => text.includes(danger))
  );
}

/**
 * Check if patient reports any symptoms (for escalation)
 * @param {Array|string} symptoms 
 * @returns {boolean}
 */
function hasAnySymptoms(symptoms) {
  if (!symptoms) return false;
  if (typeof symptoms === 'string') return symptoms.trim().length > 0;
  if (Array.isArray(symptoms)) {
    return symptoms.some(s => {
      if (typeof s === 'string') return s.trim().length > 0;
      if (s && typeof s === 'object') return !!(s.symptom || s.name || s.chief_complaint);
      return false;
    });
  }
  return false;
}

/**
 * Normalize vitals input into flat array of { type, value, unit }
 * @param {Array|object} vitalsInput 
 * @returns {Array<{ type: string, value: number, unit: string }>}
 */
function normalizeVitals(vitalsInput) {
  if (!vitalsInput) return [];

  if (Array.isArray(vitalsInput)) {
    return vitalsInput.map(v => ({
      type: v.type,
      value: typeof v.value === 'object' && v.value !== null && 'value' in v.value ? Number(v.value.value) : Number(v.value),
      unit: v.unit || (v.type === 'spo2' ? '%' : v.type === 'heart_rate' ? 'bpm' : 'mmHg'),
      _original: v
    })).filter(v => v.type && !isNaN(v.value));
  }

  const normalized = [];

  // Handle nested object structure (e.g. ProvisionalIntake or frontend state)
  if (vitalsInput.bloodPressure) {
    if (vitalsInput.bloodPressure.systolic !== undefined) {
      const sysVal = typeof vitalsInput.bloodPressure.systolic === 'object' ? vitalsInput.bloodPressure.systolic.value : vitalsInput.bloodPressure.systolic;
      normalized.push({ type: 'bp_systolic', value: Number(sysVal), unit: 'mmHg' });
    }
    if (vitalsInput.bloodPressure.diastolic !== undefined) {
      const diaVal = typeof vitalsInput.bloodPressure.diastolic === 'object' ? vitalsInput.bloodPressure.diastolic.value : vitalsInput.bloodPressure.diastolic;
      normalized.push({ type: 'bp_diastolic', value: Number(diaVal), unit: 'mmHg' });
    }
  } else {
    if (vitalsInput.systolic !== undefined || vitalsInput.bp_systolic !== undefined) {
      normalized.push({ type: 'bp_systolic', value: Number(vitalsInput.systolic ?? vitalsInput.bp_systolic), unit: 'mmHg' });
    }
    if (vitalsInput.diastolic !== undefined || vitalsInput.bp_diastolic !== undefined) {
      normalized.push({ type: 'bp_diastolic', value: Number(vitalsInput.diastolic ?? vitalsInput.bp_diastolic), unit: 'mmHg' });
    }
  }

  if (vitalsInput.spo2 !== undefined) {
    const spo2Val = typeof vitalsInput.spo2 === 'object' ? vitalsInput.spo2.value : vitalsInput.spo2;
    normalized.push({ type: 'spo2', value: Number(spo2Val), unit: '%' });
  }

  if (vitalsInput.heartRate !== undefined || vitalsInput.heart_rate !== undefined) {
    const hrVal = typeof vitalsInput.heartRate === 'object' 
      ? vitalsInput.heartRate.value 
      : (vitalsInput.heartRate ?? vitalsInput.heart_rate);
    normalized.push({ type: 'heart_rate', value: Number(hrVal), unit: 'bpm' });
  }

  if (vitalsInput.bloodGlucose !== undefined || vitalsInput.blood_glucose !== undefined) {
    const glucVal = typeof vitalsInput.bloodGlucose === 'object' 
      ? vitalsInput.bloodGlucose.value 
      : (vitalsInput.bloodGlucose ?? vitalsInput.blood_glucose);
    normalized.push({ type: 'blood_glucose', value: Number(glucVal), unit: 'mg/dL' });
  }

  if (vitalsInput.temperature !== undefined) {
    const tempVal = typeof vitalsInput.temperature === 'object' ? vitalsInput.temperature.value : vitalsInput.temperature;
    normalized.push({ type: 'temperature', value: Number(tempVal), unit: '°F' });
  }

  if (vitalsInput.respiratoryRate !== undefined || vitalsInput.respiratory_rate !== undefined) {
    const rrVal = typeof vitalsInput.respiratoryRate === 'object' 
      ? vitalsInput.respiratoryRate.value 
      : (vitalsInput.respiratoryRate ?? vitalsInput.respiratory_rate);
    normalized.push({ type: 'respiratory_rate', value: Number(rrVal), unit: 'breaths/min' });
  }

  return normalized.filter(v => v.type && !isNaN(v.value));
}

/**
 * Interpret vitals with altitude context applied while strictly preserving raw values
 * @param {Array|object} vitals Input vitals
 * @param {object} environment Environment context { altitudeMeters, ... }
 * @param {Array|string} symptoms Reported patient symptoms
 * @returns {Array<object>} Array of interpreted vital objects
 */
function interpretVitals(vitals, environment = {}, symptoms = []) {
  const altitudeMeters = typeof environment?.altitudeMeters === 'number' && !isNaN(environment.altitudeMeters)
    ? environment.altitudeMeters
    : 2438; // Default facility altitude

  const profile = getAltitudeProfile(altitudeMeters);
  const isDangerSymptomatic = hasDangerSymptoms(symptoms);
  const isSymptomatic = isDangerSymptomatic || hasAnySymptoms(symptoms);

  const flatVitals = normalizeVitals(vitals);

  return flatVitals.map(item => {
    const rawValue = item.value;
    const type = item.type;
    const unit = item.unit;

    let expectedRange;
    let status = 'normal';
    let reason = '';
    let adjustedForAltitude = false;

    switch (type) {
      case 'spo2': {
        expectedRange = profile.spo2Expected; // e.g. [92, 97] at high altitude
        adjustedForAltitude = true;

        const expectedMin = expectedRange[0];
        const expectedMax = expectedRange[1];

        // Rule: SpO2 more than 5% below expected range -> status "critical" even without symptoms
        if (rawValue < expectedMin - 5) {
          status = 'critical';
          reason = `SpO2 (${rawValue}%) is more than 5% below expected range for altitude (${expectedMin}-${expectedMax}%). Severe hypoxemia risk.`;
        }
        // Rule: SpO2 below expected range AND danger symptoms -> status "critical"
        else if (rawValue < expectedMin && isDangerSymptomatic) {
          status = 'critical';
          reason = `SpO2 (${rawValue}%) is below expected range for altitude (${expectedMin}-${expectedMax}%) with high-risk danger symptoms present.`;
        }
        // Rule: SpO2 below expected range -> status "borderline"
        else if (rawValue < expectedMin) {
          status = 'borderline';
          reason = `SpO2 (${rawValue}%) is below expected range for altitude (${expectedMin}-${expectedMax}%). Moderate altitude-related desaturation.`;
        }
        else if (rawValue > 100) {
          status = 'above-expected';
          reason = `SpO2 (${rawValue}%) exceeds physiological maximum of 100%. Check sensor placement.`;
        }
        else {
          status = 'normal';
          reason = `SpO2 (${rawValue}%) is within expected altitude band range (${expectedMin}-${expectedMax}%).`;
        }
        break;
      }

      case 'bp_systolic': {
        expectedRange = [90, 120];
        adjustedForAltitude = false; // Do NOT altitude-adjust BP normal range upward

        // Rule: BP systolic >=180 -> status "critical" regardless of altitude
        if (rawValue >= 180) {
          status = 'critical';
          reason = `Hypertensive crisis: Systolic BP >= 180 mmHg regardless of altitude (${altitudeMeters}m). Immediate clinical review required.`;
        } else if (rawValue >= 140) {
          status = 'borderline';
          reason = `Stage 1/2 Hypertension: Systolic BP >= 140 mmHg. Unchanged by altitude.`;
        } else if (rawValue >= 121) {
          status = 'borderline';
          reason = `Elevated / Pre-hypertensive systolic BP (121-139 mmHg).`;
        } else if (rawValue < 90) {
          status = 'below-expected';
          reason = `Hypotension: Systolic BP < 90 mmHg.`;
        } else {
          status = 'normal';
          reason = `Systolic BP (${rawValue} mmHg) is normal (standard range 90-120 mmHg, not altitude adjusted).`;
        }
        break;
      }

      case 'bp_diastolic': {
        expectedRange = [60, 80];
        adjustedForAltitude = false; // Do NOT altitude-adjust BP normal range upward

        // Rule: BP diastolic >=120 -> status "critical" regardless of altitude
        if (rawValue >= 120) {
          status = 'critical';
          reason = `Hypertensive crisis: Diastolic BP >= 120 mmHg regardless of altitude (${altitudeMeters}m). Immediate clinical review required.`;
        } else if (rawValue >= 90) {
          status = 'borderline';
          reason = `Stage 1/2 Hypertension: Diastolic BP >= 90 mmHg. Unchanged by altitude.`;
        } else if (rawValue >= 81) {
          status = 'borderline';
          reason = `Pre-hypertensive diastolic BP (81-89 mmHg).`;
        } else if (rawValue < 60) {
          status = 'below-expected';
          reason = `Hypotension: Diastolic BP < 60 mmHg.`;
        } else {
          status = 'normal';
          reason = `Diastolic BP (${rawValue} mmHg) is normal (standard range 60-80 mmHg, not altitude adjusted).`;
        }
        break;
      }

      case 'heart_rate': {
        const delta = profile.hrDelta; // e.g. [5, 15]
        expectedRange = [60 + delta[0], 100 + delta[1]];
        adjustedForAltitude = true;

        const expectedMax = expectedRange[1];
        const expectedMin = expectedRange[0];

        // Rule: HR above expected max for altitude + 20 -> status "borderline", escalate if symptomatic
        if (rawValue > expectedMax + 20) {
          if (isSymptomatic) {
            status = 'critical';
            reason = `Heart rate (${rawValue} bpm) is >20 bpm above expected altitude maximum (${expectedMax} bpm) with active symptoms. Escalate immediately.`;
          } else {
            status = 'borderline';
            reason = `Heart rate (${rawValue} bpm) is >20 bpm above expected altitude maximum (${expectedMax} bpm). Monitor closely.`;
          }
        } else if (rawValue > expectedMax) {
          status = 'above-expected';
          reason = `Heart rate (${rawValue} bpm) is slightly above expected altitude range (${expectedMin}-${expectedMax} bpm).`;
        } else if (rawValue < expectedMin) {
          status = 'below-expected';
          reason = `Heart rate (${rawValue} bpm) is below expected altitude range (${expectedMin}-${expectedMax} bpm).`;
        } else {
          status = 'normal';
          reason = `Heart rate (${rawValue} bpm) is within expected altitude-adjusted range (${expectedMin}-${expectedMax} bpm).`;
        }
        break;
      }

      case 'blood_glucose': {
        expectedRange = [70, 140];
        adjustedForAltitude = false;

        if (rawValue > 300) {
          status = 'critical';
          reason = `Severe hyperglycemia (>300 mg/dL). Risk of diabetic crisis.`;
        } else if (rawValue < 54) {
          status = 'critical';
          reason = `Severe hypoglycemia (<54 mg/dL). Immediate glucose administration needed.`;
        } else if (rawValue > 180 || rawValue < 70) {
          status = 'borderline';
          reason = `Blood glucose (${rawValue} mg/dL) outside normal parameters.`;
        } else {
          status = 'normal';
          reason = `Blood glucose (${rawValue} mg/dL) within normal parameters.`;
        }
        break;
      }

      case 'temperature': {
        expectedRange = [97.0, 99.5];
        adjustedForAltitude = false;

        if (rawValue >= 103.0 || rawValue < 95.0) {
          status = 'critical';
          reason = `Critical temperature (${rawValue} °F): severe fever or hypothermia.`;
        } else if (rawValue >= 100.4) {
          status = 'borderline';
          reason = `Fever: temperature (${rawValue} °F) elevated.`;
        } else {
          status = 'normal';
          reason = `Body temperature (${rawValue} °F) normal.`;
        }
        break;
      }

      case 'respiratory_rate': {
        expectedRange = [12, 20];
        adjustedForAltitude = false;

        if (rawValue > 30 || rawValue < 8) {
          status = 'critical';
          reason = `Critical respiratory rate (${rawValue} breaths/min).`;
        } else if (rawValue > 22) {
          status = 'borderline';
          reason = `Tachypnea (${rawValue} breaths/min), may indicate mild altitude compensation or respiratory distress.`;
        } else {
          status = 'normal';
          reason = `Respiratory rate (${rawValue} breaths/min) within normal limits.`;
        }
        break;
      }

      default: {
        expectedRange = [0, 0];
        adjustedForAltitude = false;
        status = 'normal';
        reason = `Reading recorded.`;
      }
    }

    return {
      rawValue,
      unit,
      type,
      altitudeMeters,
      expectedRange,
      status,
      reason,
      adjustedForAltitude,
      algorithmVersion: ALGORITHM_VERSION
    };
  });
}

module.exports = {
  ALGORITHM_VERSION,
  DISCLAIMER,
  getAltitudeProfile,
  hasDangerSymptoms,
  interpretVitals
};
