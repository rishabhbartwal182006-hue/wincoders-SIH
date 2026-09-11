import fs from 'node:fs';
import path from 'node:path';
import { Rule } from '../types.js';

let altitudeProfiles: any;
try {
  const profilePath = path.resolve(process.cwd(), 'config/altitudeProfiles.json');
  altitudeProfiles = JSON.parse(fs.readFileSync(profilePath, 'utf-8'));
} catch {
  try {
    const fallbackPath = path.resolve(__dirname, '../../../../config/altitudeProfiles.json');
    altitudeProfiles = JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'));
  } catch {
    altitudeProfiles = { bands: {}, _disclaimer: '' };
  }
}

export interface AltitudeBandProfile {
  key: string;
  minMeters: number;
  maxMeters: number;
  label: string;
  spo2Expected: [number, number];
  hrDelta: [number, number];
}

export interface AltitudeRuleResult {
  flagId: string;
  flagType: string;
  severity: 'RED_FLAG' | 'YELLOW_FLAG' | 'NORMAL';
  urgencyTier: 'critical' | 'urgent' | 'monitor' | 'routine';
  priority: 'EMERGENCY' | 'URGENT' | 'ROUTINE';
  name: string;
  reason: string;
  action: string;
  altitudeMeters: number;
  expectedSpO2Range: [number, number];
  rawVitals: {
    spo2?: number;
    systolic?: number;
    diastolic?: number;
    heartRate?: number;
  };
  detectedAt: Date;
  triggeredByRefs: string[];
  isFastTrack: boolean;
}

export interface AltitudeEvaluationOutput extends Array<AltitudeRuleResult> {
  hasRedFlag: boolean;
  hasYellowFlag: boolean;
  isFastTrack: boolean;
  redFlags: AltitudeRuleResult[];
  yellowFlags: AltitudeRuleResult[];
}

export const DANGER_SYMPTOMS = [
  'chest pain',
  'chest tightness',
  'chest pressure',
  'chest discomfort',
  'breathlessness at rest',
  'shortness of breath at rest',
  'shortness of breath',
  'dyspnea at rest',
  'confusion',
  'altered mental status',
  'cyanosis',
  'blue lips',
  'blue fingertips',
  'inability to walk',
  'ataxia',
  'fainting',
  'syncope',
  'loss of consciousness'
];

/**
 * Retrieve altitude band profile from config/altitudeProfiles.json
 */
export function getAltitudeBand(altitudeMeters = 2438): AltitudeBandProfile {
  const meters = typeof altitudeMeters === 'number' && !isNaN(altitudeMeters) ? altitudeMeters : 2438;
  const bands = altitudeProfiles.bands;

  if (meters < 500) return bands.sea_level;
  if (meters < 1500) return bands.moderate;
  if (meters < 2500) return bands.high;
  if (meters < 3500) return bands.very_high;
  return bands.extreme;
}

/**
 * Normalizes symptoms input into searchable lower-case string array
 */
export function extractSymptoms(symptoms: unknown): string[] {
  if (!symptoms) return [];
  if (typeof symptoms === 'string') return [symptoms.toLowerCase()];
  if (Array.isArray(symptoms)) {
    return symptoms.map(s => {
      if (typeof s === 'string') return s.toLowerCase();
      if (s && typeof s === 'object') {
        const obj = s as Record<string, unknown>;
        return String(obj.symptom || obj.name || obj.chief_complaint || obj.description || '').toLowerCase();
      }
      return '';
    }).filter(Boolean);
  }
  if (typeof symptoms === 'object' && symptoms !== null) {
    const obj = symptoms as Record<string, unknown>;
    const extracted: string[] = [];
    for (const [key, val] of Object.entries(obj)) {
      if (val === true || val === 'true' || val === 'yes') {
        extracted.push(key.toLowerCase());
      } else if (typeof val === 'string') {
        extracted.push(val.toLowerCase());
      }
    }
    return extracted;
  }
  return [];
}

/**
 * Check if reported symptoms contain acute altitude danger symptoms
 */
export function hasDangerSymptoms(symptoms: unknown): boolean {
  const list = extractSymptoms(symptoms);
  return list.some(text => DANGER_SYMPTOMS.some(d => text.includes(d)));
}

/**
 * Check if patient reports acute mountain sickness (AMS) symptom constellation:
 * headache && nausea && dizziness && poorSleep
 */
export function hasAmsSymptoms(symptoms: unknown): boolean {
  const list = extractSymptoms(symptoms);
  const textBlob = list.join(' ');

  const hasHeadache = textBlob.includes('headache') || textBlob.includes('head pain');
  const hasNausea = textBlob.includes('nausea') || textBlob.includes('vomit') || textBlob.includes('queasy');
  const hasDizziness = textBlob.includes('dizz') || textBlob.includes('lighthead') || textBlob.includes('vertigo');
  const hasPoorSleep = textBlob.includes('poor sleep') || textBlob.includes('insomnia') || textBlob.includes('sleep');

  return hasHeadache && (hasNausea || hasDizziness || hasPoorSleep);
}

/**
 * Core Altitude Triage Rule Evaluator
 * 
 * Rules:
 * 1. if (spo2 < criticalThresholdForAltitude && hasDangerSymptoms) -> RED_FLAG("Hypoxemia at altitude with danger symptoms")
 * 2. if (spo2 < criticalThresholdForAltitude - 5) -> RED_FLAG("Severe hypoxemia at altitude")
 * 3. if (systolicBP >= 180 || diastolicBP >= 120) -> RED_FLAG("Hypertensive crisis")
 * 4. if (headache && nausea && dizziness && poorSleep && altitude > 2500) -> YELLOW_FLAG("Possible acute mountain sickness")
 * 5. if (spo2 < criticalThresholdForAltitude without danger symptoms) -> YELLOW_FLAG("Borderline hypoxemia at altitude")
 */
export function evaluateAltitudeRules(
  vitals: any,
  environment: any = {},
  symptoms: any = []
): AltitudeEvaluationOutput {
  const altitudeMeters = typeof environment?.altitudeMeters === 'number'
    ? environment.altitudeMeters
    : (typeof environment === 'number' ? environment : 2438);

  const band = getAltitudeBand(altitudeMeters);
  const criticalThresholdForAltitude = band.spo2Expected[0]; // e.g. 92 for high band (2438m)
  const now = new Date();

  // Normalize vitals
  let spo2: number | undefined;
  let systolic: number | undefined;
  let diastolic: number | undefined;
  let heartRate: number | undefined;

  if (Array.isArray(vitals)) {
    for (const v of vitals) {
      const type = v.type || v.name;
      const val = Number(typeof v.value === 'object' && v.value !== null && 'value' in v.value ? v.value.value : v.value);
      if (type === 'spo2' && !isNaN(val)) spo2 = val;
      if ((type === 'bp_systolic' || type === 'systolic') && !isNaN(val)) systolic = val;
      if ((type === 'bp_diastolic' || type === 'diastolic') && !isNaN(val)) diastolic = val;
      if ((type === 'heart_rate' || type === 'heartRate') && !isNaN(val)) heartRate = val;
    }
  } else if (vitals && typeof vitals === 'object') {
    if (vitals.spo2 !== undefined) {
      spo2 = Number(typeof vitals.spo2 === 'object' ? vitals.spo2.value : vitals.spo2);
    } else if (vitals.SPO2 !== undefined) {
      spo2 = Number(typeof vitals.SPO2 === 'object' ? vitals.SPO2.value : vitals.SPO2);
    }

    if (vitals.bloodPressure?.systolic !== undefined) {
      systolic = Number(typeof vitals.bloodPressure.systolic === 'object' ? vitals.bloodPressure.systolic.value : vitals.bloodPressure.systolic);
    } else if (vitals.systolic !== undefined || vitals.bp_systolic !== undefined) {
      systolic = Number(vitals.systolic ?? vitals.bp_systolic);
    } else if (vitals.BLOOD_PRESSURE?.value) {
      const parts = String(vitals.BLOOD_PRESSURE.value).split('/');
      if (parts[0]) systolic = Number(parts[0]);
    }

    if (vitals.bloodPressure?.diastolic !== undefined) {
      diastolic = Number(typeof vitals.bloodPressure.diastolic === 'object' ? vitals.bloodPressure.diastolic.value : vitals.bloodPressure.diastolic);
    } else if (vitals.diastolic !== undefined || vitals.bp_diastolic !== undefined) {
      diastolic = Number(vitals.diastolic ?? vitals.bp_diastolic);
    } else if (vitals.BLOOD_PRESSURE?.value) {
      const parts = String(vitals.BLOOD_PRESSURE.value).split('/');
      if (parts[1]) diastolic = Number(parts[1]);
    }

    if (vitals.heartRate !== undefined || vitals.heart_rate !== undefined) {
      heartRate = Number(vitals.heartRate ?? vitals.heart_rate);
    } else if (vitals.HEART_RATE?.value) {
      heartRate = Number(vitals.HEART_RATE.value);
    }
  }

  const dangerPresent = hasDangerSymptoms(symptoms);
  const rawSnapshot = { spo2, systolic, diastolic, heartRate };
  const results: AltitudeRuleResult[] = [];

  // RULE 1: Severe hypoxemia at altitude (>5% below expected min)
  if (spo2 !== undefined && spo2 < (criticalThresholdForAltitude - 5)) {
    results.push({
      flagId: `FLAG_ALT_SEVERE_HYPOXIA_${now.getTime()}`,
      flagType: 'severe_hypoxemia_at_altitude',
      severity: 'RED_FLAG',
      urgencyTier: 'critical',
      priority: 'EMERGENCY',
      name: 'Severe hypoxemia at altitude',
      reason: `Severe hypoxemia: SpO2 (${spo2}%) is >5% below expected altitude threshold (${criticalThresholdForAltitude}% for ${altitudeMeters}m). Immediate oxygen therapy & stabilization indicated.`,
      action: 'IMMEDIATE_DOCTOR_ALERT',
      altitudeMeters,
      expectedSpO2Range: band.spo2Expected,
      rawVitals: rawSnapshot,
      detectedAt: now,
      triggeredByRefs: ['vitals.spo2', 'environment.altitudeMeters'],
      isFastTrack: true
    });
  }
  // RULE 2: Hypoxemia at altitude with danger symptoms
  else if (spo2 !== undefined && spo2 < criticalThresholdForAltitude && dangerPresent) {
    results.push({
      flagId: `FLAG_ALT_DANGER_HYPOXIA_${now.getTime()}`,
      flagType: 'hypoxemia_at_altitude_with_danger_symptoms',
      severity: 'RED_FLAG',
      urgencyTier: 'critical',
      priority: 'EMERGENCY',
      name: 'Hypoxemia at altitude with danger symptoms',
      reason: `Hypoxemia at altitude with danger symptoms: SpO2 (${spo2}%) below expected minimum (${criticalThresholdForAltitude}%) accompanied by red-flag danger symptoms (chest pain/tightness, breathlessness at rest, confusion, or syncope).`,
      action: 'IMMEDIATE_DOCTOR_ALERT',
      altitudeMeters,
      expectedSpO2Range: band.spo2Expected,
      rawVitals: rawSnapshot,
      detectedAt: now,
      triggeredByRefs: ['vitals.spo2', 'environment.altitudeMeters', 'intake.symptoms'],
      isFastTrack: true
    });
  }
  // RULE 3: Borderline hypoxemia at altitude without acute danger symptoms (Needs review)
  else if (spo2 !== undefined && spo2 < criticalThresholdForAltitude) {
    results.push({
      flagId: `FLAG_ALT_BORDERLINE_HYPOXIA_${now.getTime()}`,
      flagType: 'borderline_hypoxemia_at_altitude',
      severity: 'YELLOW_FLAG',
      urgencyTier: 'urgent',
      priority: 'URGENT',
      name: 'Borderline hypoxemia at altitude - clinical review required',
      reason: `Borderline altitude desaturation: SpO2 (${spo2}%) is below expected range (${band.spo2Expected[0]}–${band.spo2Expected[1]}% at ${altitudeMeters}m), but no acute danger symptoms detected. Review for subacute acclimatization difficulty.`,
      action: 'PRIORITY_REVIEW',
      altitudeMeters,
      expectedSpO2Range: band.spo2Expected,
      rawVitals: rawSnapshot,
      detectedAt: now,
      triggeredByRefs: ['vitals.spo2', 'environment.altitudeMeters'],
      isFastTrack: false
    });
  }

  // RULE 4: Hypertensive crisis (>=180 systolic or >=120 diastolic, regardless of altitude)
  if ((systolic !== undefined && systolic >= 180) || (diastolic !== undefined && diastolic >= 120)) {
    results.push({
      flagId: `FLAG_ALT_HTN_CRISIS_${now.getTime()}`,
      flagType: 'hypertensive_crisis',
      severity: 'RED_FLAG',
      urgencyTier: 'critical',
      priority: 'EMERGENCY',
      name: 'Hypertensive crisis',
      reason: `Hypertensive crisis: Blood pressure ${systolic ?? '—'}/${diastolic ?? '—'} mmHg exceeds critical threshold (>=180/120 mmHg) regardless of altitude (${altitudeMeters}m). BP thresholds are NOT adjusted upward for altitude.`,
      action: 'IMMEDIATE_DOCTOR_ALERT',
      altitudeMeters,
      expectedSpO2Range: band.spo2Expected,
      rawVitals: rawSnapshot,
      detectedAt: now,
      triggeredByRefs: ['vitals.bloodPressure.systolic', 'vitals.bloodPressure.diastolic'],
      isFastTrack: true
    });
  }

  // RULE 5: Possible acute mountain sickness (AMS)
  // headache && (nausea || dizziness || poorSleep) && altitude > 2500m
  if (altitudeMeters > 2500 && hasAmsSymptoms(symptoms)) {
    results.push({
      flagId: `FLAG_ALT_AMS_${now.getTime()}`,
      flagType: 'possible_acute_mountain_sickness',
      severity: 'YELLOW_FLAG',
      urgencyTier: 'urgent',
      priority: 'URGENT',
      name: 'Possible acute mountain sickness',
      reason: `Lake Louise AMS criteria met: Headache combined with nausea, dizziness, or sleep disturbance at elevation >2,500 m (${altitudeMeters}m). Acclimatization rest or descent assessment required.`,
      action: 'PRIORITY_REVIEW',
      altitudeMeters,
      expectedSpO2Range: band.spo2Expected,
      rawVitals: rawSnapshot,
      detectedAt: now,
      triggeredByRefs: ['environment.altitudeMeters', 'intake.symptoms'],
      isFastTrack: false
    });
  }

  // Compose output array with helper accessors
  const redFlags = results.filter(r => r.severity === 'RED_FLAG');
  const yellowFlags = results.filter(r => r.severity === 'YELLOW_FLAG');

  const output = results as AltitudeEvaluationOutput;
  output.hasRedFlag = redFlags.length > 0;
  output.hasYellowFlag = yellowFlags.length > 0;
  output.isFastTrack = redFlags.some(r => r.isFastTrack);
  output.redFlags = redFlags;
  output.yellowFlags = yellowFlags;

  return output;
}

/**
 * Declarative rule objects registered in Master Registry (ALL_RULES)
 */
export const ALTITUDE_RULES: Rule[] = [
  {
    id: 'RULE_ALTITUDE_HYPOXIA_DANGER',
    name: 'Hypoxemia at altitude with danger symptoms',
    category: 'environment',
    priority: 'EMERGENCY',
    conditions: [
      { field: 'vitals.spo2.value', operator: 'lessThan', value: 92 },
      { field: 'environment.altitudeMeters', operator: 'greaterThanOrEqual', value: 1500 }
    ],
    action: 'IMMEDIATE_DOCTOR_ALERT',
    reason: 'Oxygen saturation below expected altitude band with active danger symptoms present.',
    metadata: { guidelineSource: 'High Altitude Medical Society / MediKiosk MVP-v1', isDemoPlaceholder: false }
  },
  {
    id: 'RULE_ALTITUDE_SEVERE_HYPOXIA',
    name: 'Severe hypoxemia at altitude',
    category: 'environment',
    priority: 'EMERGENCY',
    conditions: [
      { field: 'vitals.spo2.value', operator: 'lessThan', value: 87 }
    ],
    action: 'IMMEDIATE_DOCTOR_ALERT',
    reason: 'Severe altitude hypoxemia (>5% below expected altitude threshold).',
    metadata: { guidelineSource: 'High Altitude Medical Society / MediKiosk MVP-v1', isDemoPlaceholder: false }
  },
  {
    id: 'RULE_ALTITUDE_HTN_CRISIS',
    name: 'Hypertensive crisis',
    category: 'environment',
    priority: 'EMERGENCY',
    conditions: [
      { field: 'vitals.bloodPressure.systolic.value', operator: 'greaterThanOrEqual', value: 180 }
    ],
    action: 'IMMEDIATE_DOCTOR_ALERT',
    reason: 'Hypertensive crisis. BP thresholds are strictly maintained regardless of altitude.',
    metadata: { guidelineSource: 'AHA / ACC Guidelines', isDemoPlaceholder: false }
  }
];
