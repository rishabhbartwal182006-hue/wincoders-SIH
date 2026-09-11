/**
 * redFlagRules.js
 *
 * Clinical red-flag detection rules including altitude-adjusted interpretation.
 * Illustrative hackathon decision-support rules. Clinician sign-off required.
 */

const { interpretVitals, getAltitudeProfile, hasDangerSymptoms } = require('./altitudeAdjustmentService');

function latestVital(vitals, type) {
  return [...(vitals || [])].reverse().find(v => v.type === type);
}

function detectRedFlags(session) {
  const flags = [];
  const now = new Date();
  const chiefComplaint = (session.intake?.chief_complaint?.value || '').toLowerCase();
  const associated = (session.intake?.hpi?.associated_symptoms || []).map(v => (v.value || '').toLowerCase());
  const allSymptoms = [chiefComplaint, ...associated];

  const altitudeMeters = session.environment?.altitudeMeters ?? 2438;
  const profile = getAltitudeProfile(altitudeMeters);
  const expectedMinSpO2 = profile.spo2Expected[0];
  const isDangerSymptomatic = hasDangerSymptoms(allSymptoms);

  // 1. Chest pain + diaphoresis (Cardiac red flag)
  if (/chest (pain|discomfort|pressure|tightness)/.test(chiefComplaint) && associated.some(s => s.includes('sweat'))) {
    flags.push({
      flag_id: `FLAG-${session.session_id}-CARDIAC-${now.getTime()}`,
      flag_type: 'chest_pain_with_diaphoresis',
      triggered_by_refs: ['intake.chief_complaint', 'intake.hpi.associated_symptoms'],
      urgency_tier: 'urgent',
      detected_at: now,
      alert_sent_to: ['TRIAGE-DASH-01'],
      status: 'active',
      reason: 'Chest discomfort accompanied by sweating indicates high risk of acute cardiac event.'
    });
  }

  // 2. Hypertensive crisis (invariant across altitudes)
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
      reason: `Hypertensive crisis: BP ${sys || '—'}/${dia || '—'} mmHg regardless of altitude (${altitudeMeters}m).`,
      altitude_context: {
        altitudeMeters,
        expectedRange: [90, 120],
        adjustedForAltitude: false,
        note: 'BP threshold not altered by altitude'
      }
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
      reason: `Stage 2 hypertension: BP ${sys || '—'}/${dia || '—'} mmHg.`
    });
  }

  // 3. SpO2 evaluation with altitude adjustment
  const spo2Vital = latestVital(session.vitals, 'spo2');
  const spo2 = spo2Vital?.value;

  if (typeof spo2 === 'number') {
    // Severe hypoxemia: > 5% below expected altitude minimum
    if (spo2 < expectedMinSpO2 - 5) {
      flags.push({
        flag_id: `FLAG-${session.session_id}-SEVERE-HYPOXIA-${now.getTime()}`,
        flag_type: 'severe_hypoxia',
        triggered_by_refs: ['vitals.spo2'],
        urgency_tier: 'critical',
        detected_at: now,
        alert_sent_to: ['TRIAGE-DASH-01'],
        status: 'active',
        reason: `Severe hypoxemia at altitude: SpO2 (${spo2}%) is more than 5% below expected minimum (${expectedMinSpO2}%) for ${altitudeMeters}m.`,
        altitude_context: {
          altitudeMeters,
          expectedRange: profile.spo2Expected,
          status: 'critical',
          adjustedForAltitude: true,
          algorithmVersion: 'altitude-mvp-v1'
        }
      });
    }
    // Hypoxemia below expected range AND danger symptoms
    else if (spo2 < expectedMinSpO2 && isDangerSymptomatic) {
      flags.push({
        flag_id: `FLAG-${session.session_id}-ALTITUDE-HYPOXIA-DANGER-${now.getTime()}`,
        flag_type: 'altitude_hypoxemia_danger_symptoms',
        triggered_by_refs: ['vitals.spo2', 'intake.chief_complaint'],
        urgency_tier: 'critical',
        detected_at: now,
        alert_sent_to: ['TRIAGE-DASH-01'],
        status: 'active',
        reason: `Hypoxemia at altitude with danger symptoms: SpO2 (${spo2}%) is below expected range (${expectedMinSpO2}-${profile.spo2Expected[1]}%) with active high-risk symptoms.`,
        altitude_context: {
          altitudeMeters,
          expectedRange: profile.spo2Expected,
          status: 'critical',
          adjustedForAltitude: true,
          algorithmVersion: 'altitude-mvp-v1'
        }
      });
    }
    // Below expected range without danger symptoms -> borderline monitoring
    else if (spo2 < expectedMinSpO2) {
      flags.push({
        flag_id: `FLAG-${session.session_id}-LOW-SPO2-${now.getTime()}`,
        flag_type: 'low_spo2',
        triggered_by_refs: ['vitals.spo2'],
        urgency_tier: 'monitor',
        detected_at: now,
        alert_sent_to: ['TRIAGE-DASH-01'],
        status: 'active',
        reason: `SpO2 (${spo2}%) is below expected baseline range (${expectedMinSpO2}-${profile.spo2Expected[1]}%) for ${altitudeMeters}m. Monitor for escalation.`,
        altitude_context: {
          altitudeMeters,
          expectedRange: profile.spo2Expected,
          status: 'borderline',
          adjustedForAltitude: true,
          algorithmVersion: 'altitude-mvp-v1'
        }
      });
    }
  }

  // 4. Yellow flag: Acute Mountain Sickness (AMS) suspected (>2500m + headache + nausea/dizziness/insomnia)
  if (altitudeMeters > 2500) {
    const hasHeadache = allSymptoms.some(s => s.includes('headache'));
    const hasNausea = allSymptoms.some(s => s.includes('nausea') || s.includes('vomit'));
    const hasDizziness = allSymptoms.some(s => s.includes('dizzy') || s.includes('giddiness'));
    const hasSleepIssue = allSymptoms.some(s => s.includes('sleep') || s.includes('insomnia'));

    if (hasHeadache && (hasNausea || hasDizziness || hasSleepIssue)) {
      flags.push({
        flag_id: `FLAG-${session.session_id}-AMS-${now.getTime()}`,
        flag_type: 'possible_acute_mountain_sickness',
        triggered_by_refs: ['intake.chief_complaint', 'environment.altitudeMeters'],
        urgency_tier: 'urgent',
        detected_at: now,
        alert_sent_to: ['TRIAGE-DASH-01'],
        status: 'active',
        reason: `Possible Acute Mountain Sickness (AMS) at ${altitudeMeters}m based on headache and systemic symptoms.`,
        altitude_context: {
          altitudeMeters,
          status: 'urgent',
          adjustedForAltitude: true,
          algorithmVersion: 'altitude-mvp-v1'
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
      byType.set(nf.flag_type, nf);
    }
  }
  return Array.from(byType.values());
}

module.exports = { detectRedFlags, mergeRedFlags };
