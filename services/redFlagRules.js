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

function latestVital(vitals, type) {
  return [...(vitals || [])].reverse().find(v => v.type === type);
}

function detectRedFlags(session) {
  const flags = [];
  const now = new Date();
  const chiefComplaint = (session.intake?.chief_complaint?.value || '').toLowerCase();
  const associated = (session.intake?.hpi?.associated_symptoms || []).map(v => (v.value || '').toLowerCase());

  // Chest pain + diaphoresis
  if (/chest (pain|discomfort|pressure|tightness)/.test(chiefComplaint) && associated.some(s => s.includes('sweat'))) {
    flags.push({
      flag_id: `FLAG-${session.session_id}-CARDIAC-${now.getTime()}`,
      flag_type: 'chest_pain_with_diaphoresis',
      triggered_by_refs: ['intake.chief_complaint', 'intake.hpi.associated_symptoms'],
      urgency_tier: 'urgent',
      detected_at: now,
      alert_sent_to: ['TRIAGE-DASH-01'],
      status: 'active'
    });
  }

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
      status: 'active'
    });
  } else if (sys >= 160 || dia >= 100) {
    flags.push({
      flag_id: `FLAG-${session.session_id}-HTN-STAGE2-${now.getTime()}`,
      flag_type: 'stage2_hypertension',
      triggered_by_refs: ['vitals.bp_systolic', 'vitals.bp_diastolic'],
      urgency_tier: 'urgent',
      detected_at: now,
      alert_sent_to: ['TRIAGE-DASH-01'],
      status: 'active'
    });
  }

  const spo2 = latestVital(session.vitals, 'spo2')?.value;
  if (spo2 != null && spo2 < 90) {
    flags.push({
      flag_id: `FLAG-${session.session_id}-HYPOXIA-${now.getTime()}`,
      flag_type: 'severe_hypoxia',
      triggered_by_refs: ['vitals.spo2'],
      urgency_tier: 'critical',
      detected_at: now,
      alert_sent_to: ['TRIAGE-DASH-01'],
      status: 'active'
    });
  } else if (spo2 != null && spo2 < 95) {
    flags.push({
      flag_id: `FLAG-${session.session_id}-LOW-SPO2-${now.getTime()}`,
      flag_type: 'low_spo2',
      triggered_by_refs: ['vitals.spo2'],
      urgency_tier: 'monitor',
      detected_at: now,
      alert_sent_to: ['TRIAGE-DASH-01'],
      status: 'active'
    });
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
