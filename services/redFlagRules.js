/**
 * redFlagRules.js
 *
 * Small, self-contained rule set that flags a spec-shaped Session in real
 * time as intake/vitals data comes in — enough to demo the
 * `/sessions/{id}/red-flags` contract end-to-end.
 *
 * NOTE: the repo already has a much more thorough TypeScript triage engine
 * at triage-engine/src/rules/{cardiac,respiratory,neurological,general,vitals}
 * with a full SOCRATES questionnaire flow. That engine runs as its own
 * service (triage-engine/src/server) and is the right place for serious
 * clinical rule authoring — these rules here are intentionally minimal,
 * just to make the spec's red-flag lifecycle (detect -> alert -> acknowledge
 * /resolve) functional without standing up a second service.
 */

const { getAltitudeProfile, ALGORITHM_VERSION } = require('./altitudeAdjustmentService');

const DANGER_SYMPTOMS = [
  'chest pain',
  'chest tightness',
  'chest pressure',
  'chest discomfort',
  'breathlessness at rest',
  'shortness of breath at rest',
  'shortness of breath',
  'confusion',
  'altered mental status',
  'cyanosis',
  'blue lips',
  'inability to walk',
  'ataxia',
  'fainting',
  'syncope'
];

function latestVital(vitals, type) {
  return [...(vitals || [])].reverse().find(v => v.type === type);
}

function detectRedFlags(session) {
  const flags = [];
  const now = new Date();
  let symptomList = [];
  if (typeof session.intake?.chief_complaint?.value === 'string') symptomList.push(session.intake.chief_complaint.value);
  else if (typeof session.intake?.chief_complaint === 'string') symptomList.push(session.intake.chief_complaint);
  if (Array.isArray(session.intake?.symptoms)) {
    session.intake.symptoms.forEach(s => symptomList.push(typeof s === 'string' ? s : (s.symptom || s.name || '')));
  }
  if (Array.isArray(session.chiefComplaints)) {
    session.chiefComplaints.forEach(s => symptomList.push(typeof s === 'string' ? s : (s.symptom || s.name || '')));
  }
  if (Array.isArray(session.symptoms?.list)) {
    session.symptoms.list.forEach(s => symptomList.push(s.symptomName || s.symptom || ''));
  }
  if (Array.isArray(session.intake?.hpi?.associated_symptoms)) {
    session.intake.hpi.associated_symptoms.forEach(v => symptomList.push(v.value || v || ''));
  }
  const chiefComplaint = (session.intake?.chief_complaint?.value || session.intake?.chief_complaint || symptomList[0] || '').toLowerCase();
  const associated = (session.intake?.hpi?.associated_symptoms || []).map(v => (v.value || v || '').toLowerCase());
  const allSymptomsText = symptomList.join(' ').toLowerCase();

  // Danger symptoms detection
  const hasDanger = DANGER_SYMPTOMS.some(d => allSymptomsText.includes(d));

  // Altitude context
  const altitudeMeters = Number(session.environment?.altitudeMeters ?? 2438);
  const profile = getAltitudeProfile(altitudeMeters);
  const criticalThreshold = profile.spo2Expected[0]; // e.g. 92 for high band, 95 for sea level

  // Chest pain + diaphoresis (Cardiac rule)
  if (/chest (pain|discomfort|pressure|tightness)/.test(chiefComplaint) && associated.some(s => s.includes('sweat'))) {
    flags.push({
      flag_id: `FLAG-${session.session_id}-CARDIAC-${now.getTime()}`,
      flag_type: 'chest_pain_with_diaphoresis',
      triggered_by_refs: ['intake.chief_complaint', 'intake.hpi.associated_symptoms'],
      urgency_tier: 'urgent',
      detected_at: now,
      alert_sent_to: ['TRIAGE-DASH-01'],
      status: 'active',
      reason: 'Chest pain associated with diaphoresis (sweating), acute coronary syndrome risk.',
      altitude_context: { altitudeMeters, adjustedForAltitude: false }
    });
  }

  // Blood Pressure - Hypertensive Crisis (>=180 systolic or >=120 diastolic, regardless of altitude)
  const sys = latestVital(session.vitals, 'bp_systolic')?.value;
  const dia = latestVital(session.vitals, 'bp_diastolic')?.value;
  if (sys >= 180 || dia >= 120) {
    flags.push({
      flag_id: `FLAG-${session.session_id}-HTN-CRISIS-${now.getTime()}`,
      flag_type: 'hypertensive_crisis',
      triggered_by_refs: ['vitals.bp_systolic', 'vitals.bp_diastolic'],
      urgency_tier: 'critical',
      detected_at: now,
      alert_sent_to: ['TRIAGE-DASH-01'],
      status: 'active',
      reason: `Hypertensive crisis (${sys ?? '—'}/${dia ?? '—'} mmHg). BP critical thresholds are NOT shifted upward for altitude.`,
      altitude_context: { altitudeMeters, adjustedForAltitude: false, algorithmVersion: ALGORITHM_VERSION }
    });
  } else if (sys >= 160 || dia >= 100) {
    flags.push({
      flag_id: `FLAG-${session.session_id}-HTN-STAGE2-${now.getTime()}`,
      flag_type: 'stage2_hypertension',
      triggered_by_refs: ['vitals.bp_systolic', 'vitals.bp_diastolic'],
      urgency_tier: 'urgent',
      detected_at: now,
      alert_sent_to: ['TRIAGE-DASH-01'],
      status: 'active',
      reason: `Stage 2 Hypertension (${sys ?? '—'}/${dia ?? '—'} mmHg).`,
      altitude_context: { altitudeMeters, adjustedForAltitude: false, algorithmVersion: ALGORITHM_VERSION }
    });
  }

  // Altitude SpO2 Evaluation
  const spo2 = latestVital(session.vitals, 'spo2')?.value;
  if (spo2 != null) {
    // 1. SpO2 >5% below expected range for altitude -> RED_FLAG: Severe hypoxemia
    if (spo2 < (criticalThreshold - 5)) {
      flags.push({
        flag_id: `FLAG-${session.session_id}-SEVERE-HYPOXIA-${now.getTime()}`,
        flag_type: 'severe_hypoxemia_at_altitude',
        triggered_by_refs: ['vitals.spo2', 'environment.altitudeMeters'],
        urgency_tier: 'critical',
        detected_at: now,
        alert_sent_to: ['TRIAGE-DASH-01'],
        status: 'active',
        reason: `Severe hypoxemia at altitude: SpO2 (${spo2}%) is >5% below expected minimum threshold (${criticalThreshold}%) for ${altitudeMeters}m elevation.`,
        altitude_context: {
          altitudeMeters,
          expectedRange: profile.spo2Expected,
          adjustedForAltitude: true,
          algorithmVersion: ALGORITHM_VERSION
        }
      });
    }
    // 2. SpO2 below expected range AND danger symptoms -> RED_FLAG
    else if (spo2 < criticalThreshold && hasDanger) {
      flags.push({
        flag_id: `FLAG-${session.session_id}-DANGER-HYPOXIA-${now.getTime()}`,
        flag_type: 'hypoxemia_at_altitude_with_danger_symptoms',
        triggered_by_refs: ['vitals.spo2', 'intake.chief_complaint', 'environment.altitudeMeters'],
        urgency_tier: 'critical',
        detected_at: now,
        alert_sent_to: ['TRIAGE-DASH-01'],
        status: 'active',
        reason: `Hypoxemia at altitude with danger symptoms: SpO2 (${spo2}%) is below expected range (${profile.spo2Expected[0]}–${profile.spo2Expected[1]}%) with acute red-flag symptoms present.`,
        altitude_context: {
          altitudeMeters,
          expectedRange: profile.spo2Expected,
          hasDangerSymptoms: true,
          adjustedForAltitude: true,
          algorithmVersion: ALGORITHM_VERSION
        }
      });
    }
    // 3. SpO2 below expected range WITHOUT danger symptoms -> Borderline (urgent review, not ignored)
    else if (spo2 < criticalThreshold) {
      flags.push({
        flag_id: `FLAG-${session.session_id}-BORDERLINE-HYPOXIA-${now.getTime()}`,
        flag_type: 'borderline_hypoxemia_at_altitude',
        triggered_by_refs: ['vitals.spo2', 'environment.altitudeMeters'],
        urgency_tier: 'urgent',
        detected_at: now,
        alert_sent_to: ['TRIAGE-DASH-01'],
        status: 'active',
        reason: `Borderline hypoxemia at altitude: SpO2 (${spo2}%) below expected band (${profile.spo2Expected[0]}–${profile.spo2Expected[1]}%) at ${altitudeMeters}m. Review for subacute AMS or acclimatization delay.`,
        altitude_context: {
          altitudeMeters,
          expectedRange: profile.spo2Expected,
          adjustedForAltitude: true,
          algorithmVersion: ALGORITHM_VERSION
        }
      });
    }
  }

  // Acute Mountain Sickness (AMS): headache && (nausea || dizziness || poor sleep) && altitude > 2500m
  if (altitudeMeters > 2500) {
    const hasHeadache = allSymptomsText.includes('headache') || allSymptomsText.includes('head pain');
    const hasNausea = allSymptomsText.includes('nausea') || allSymptomsText.includes('vomit');
    const hasDizziness = allSymptomsText.includes('dizz') || allSymptomsText.includes('lighthead') || allSymptomsText.includes('vertigo');
    const hasPoorSleep = allSymptomsText.includes('poor sleep') || allSymptomsText.includes('insomnia') || allSymptomsText.includes('sleep');

    if (hasHeadache && (hasNausea || hasDizziness || hasPoorSleep)) {
      flags.push({
        flag_id: `FLAG-${session.session_id}-AMS-${now.getTime()}`,
        flag_type: 'possible_acute_mountain_sickness',
        triggered_by_refs: ['environment.altitudeMeters', 'intake.chief_complaint', 'intake.hpi.associated_symptoms'],
        urgency_tier: 'urgent',
        detected_at: now,
        alert_sent_to: ['TRIAGE-DASH-01'],
        status: 'active',
        reason: `Possible acute mountain sickness (AMS): Headache combined with nausea, dizziness, or sleep disturbance at elevation ${altitudeMeters}m (>2,500m).`,
        altitude_context: {
          altitudeMeters,
          expectedRange: profile.spo2Expected,
          adjustedForAltitude: true,
          algorithmVersion: ALGORITHM_VERSION
        }
      });
    }
  }

  return flags;
}

/** Merge newly-detected flags into the session's existing red_flags, keyed by
 * flag_type, WITHOUT clobbering a flag a physician already acknowledged/resolved. */
function mergeRedFlags(existingFlags = [], newFlags = []) {
  const byType = new Map(existingFlags.map(f => [f.flag_type, f]));
  for (const nf of newFlags) {
    const existing = byType.get(nf.flag_type);
    if (!existing || existing.status === 'resolved') {
      byType.set(nf.flag_type, nf); // fresh occurrence, or a resolved one re-triggering
    }
    // if it's already 'active' or 'acknowledged', leave the existing record alone
  }
  return Array.from(byType.values());
}

module.exports = { detectRedFlags, mergeRedFlags };
