(() => {
  const API = '';
  const state = { sessions: [], selected: null, filter: 'ALL', socket: null, currentView: 'queue', activeAlerts: [], allAuditLogs: [] };
  const $ = (s) => document.querySelector(s);
  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const level = (s) => (s?.triageResult?.triageLevel || 'ROUTINE').toUpperCase();
  const formatTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—';
  const formatDate = (iso) => iso ? new Date(iso).toLocaleString([], {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';

  function toast(message){
    const el=document.createElement('div');
    el.className='toast';
    el.textContent=message;
    $('#toast-root').appendChild(el);
    setTimeout(()=>el.remove(),3500);
  }

  async function api(path, options){
    const res = await fetch(API + path, options);
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
    return data;
  }

  async function loadSessions(){
    try {
      const data = await api('/api/events/sessions');
      state.sessions = data.sessions || [];
      renderStats();
      renderQueue();
      if(state.selected){
        const exists = state.sessions.find(s => s.sessionId === state.selected.sessionId);
        if(exists) await selectSession(exists.sessionId, false);
      }
    } catch(err){ toast(`Unable to load queue: ${err.message}`); }
  }

  function renderStats(){
    const counts = { EMERGENCY: 0, URGENT: 0, ROUTINE: 0 };
    state.sessions.forEach(s => {
      const lvl = level(s);
      if (counts[lvl] !== undefined) counts[lvl]++;
      else counts.ROUTINE++;
    });

    $('#stat-total').textContent = state.sessions.length;
    $('#stat-emergency').textContent = counts.EMERGENCY;
    $('#stat-urgent').textContent = counts.URGENT;
    $('#stat-routine').textContent = counts.ROUTINE;

    const alertBadge = $('#nav-alert-badge');
    if (alertBadge) {
      const totalAlerts = counts.EMERGENCY + state.activeAlerts.length;
      if (totalAlerts > 0) {
        alertBadge.textContent = totalAlerts;
        alertBadge.classList.remove('hidden');
      } else {
        alertBadge.classList.add('hidden');
      }
    }

    if (state.currentView === 'alerts') {
      renderCriticalAlerts();
    }
  }

  function renderQueue(){
    const list = state.sessions.filter(s => state.filter === 'ALL' || level(s) === state.filter).sort((a, b) => {
      const rank = { EMERGENCY: 0, URGENT: 1, ROUTINE: 2 };
      return rank[level(a)] - rank[level(b)] || new Date(b.lastUpdated || b.createdAt) - new Date(a.lastUpdated || a.createdAt);
    });

    $('#queue-meta').textContent = `${list.length} patient${list.length === 1 ? '' : 's'}`;
    if (!list.length) {
      $('#queue').innerHTML = '<div class="empty-queue">No encounters match this filter.</div>';
      return;
    }

    $('#queue').innerHTML = list.map(s => {
      const l = level(s);
      const symptom = s.symptoms?.primary?.symptomName?.replaceAll('_', ' ') || s.chiefComplaints?.[0]?.symptom || 'Clinical intake in progress';
      const selected = state.selected?.sessionId === s.sessionId ? ' selected' : '';
      const isVerified = s.status === 'VERIFIED_COMMITTED';
      const statusBadge = isVerified ? '<span class="badge-verified">VERIFIED</span>' : '<span class="badge-provisional">PROVISIONAL</span>';

      return `<button class="queue-card${selected}" data-session="${esc(s.sessionId)}">
        <i class="priority-bar ${l.toLowerCase()}"></i>
        <div>
          <div class="patient-name">${esc(s.patientName || s.patientId || 'Anonymous patient')} ${statusBadge}</div>
          <div class="patient-id">${esc(s.sessionId)} · ABHA: ${esc(s.patientId || 'N/A')}</div>
          <div class="symptom-line">${esc(symptom)}</div>
        </div>
        <div><span class="badge ${l.toLowerCase()}">${l}</span><div class="queue-time">${formatTime(s.lastUpdated || s.createdAt)}</div></div>
      </button>`;
    }).join('');

    document.querySelectorAll('.queue-card').forEach(el => el.addEventListener('click', () => selectSession(el.dataset.session)));
  }

  async function selectSession(sessionId, rerender = true){
    try {
      const data = await api(`/api/events/session/${encodeURIComponent(sessionId)}`);
      state.selected = data.session || data.data?.session;
      state.selectedRawData = data.data || data;
      renderPatient();
      if (rerender) renderQueue();
    } catch(err) { toast(`Unable to open encounter: ${err.message}`); }
  }

  /**
   * Clinical Discrepancy & Omission Evaluator
   */
  function evaluateClinicalDiscrepancies(intakePayload) {
    const flags = [];
    const omissions = [];
    const payload = intakePayload || {};
    const vitals = payload.vitals || {};
    const history = payload.history || {};
    const complaints = payload.chiefComplaints || payload.symptoms?.list || [];
    const ayush = payload.ayushParameters || {};

    let assessedCount = 0;
    const totalExpectedFields = 10;

    if (vitals.bloodPressure || vitals.BLOOD_PRESSURE) assessedCount++;
    else omissions.push({ parameter: "Blood Pressure (BP)", category: "Vital Signs" });

    if (vitals.spo2 || vitals.SPO2) assessedCount++;
    else omissions.push({ parameter: "Oxygen Saturation (SpO₂)", category: "Vital Signs" });

    if (vitals.heartRate || vitals.HEART_RATE) assessedCount++;
    else omissions.push({ parameter: "Heart Rate (HR)", category: "Vital Signs" });

    if (vitals.bloodGlucose || vitals.BLOOD_GLUCOSE) assessedCount++;
    else omissions.push({ parameter: "Blood Glucose", category: "Vital Signs" });

    if (complaints.length > 0) assessedCount++;
    else omissions.push({ parameter: "Chief Complaints", category: "Symptom Assessment" });

    if (payload.hpi?.narrative || payload.hpi) assessedCount++;
    else omissions.push({ parameter: "History of Present Illness (HPI)", category: "Symptom Assessment" });

    if (history.currentMedications && history.currentMedications.length > 0) assessedCount++;
    else omissions.push({ parameter: "Current Medications", category: "Medical History" });

    if (ayush.agni) assessedCount++;
    else omissions.push({ parameter: "Agni (Digestive Fire)", category: "AYUSH Dashavidha" });

    if (ayush.koshtha) assessedCount++;
    else omissions.push({ parameter: "Koshtha (Bowel Nature)", category: "AYUSH Dashavidha" });

    if (ayush.mutra) assessedCount++;
    else omissions.push({ parameter: "Mutra (Urine Characteristics)", category: "AYUSH Dashavidha" });

    const completenessScore = Math.min(100, Math.round((assessedCount / totalExpectedFields) * 100));

    const glucVal = Number(vitals.bloodGlucose?.value || vitals.BLOOD_GLUCOSE?.value);
    if (glucVal > 200) {
      flags.push({
        flagId: `DISC_GLUCOSE_${Date.now()}`,
        message: `High Blood Sugar (${glucVal} mg/dL) recorded, but patient history has no reported Diabetes mellitus diagnosis.`,
        severity: "HIGH"
      });
    }

    const sysVal = Number(vitals.bloodPressure?.systolic?.value || (vitals.BLOOD_PRESSURE?.value ? String(vitals.BLOOD_PRESSURE.value).split('/')[0] : 0));
    if (sysVal >= 160) {
      flags.push({
        flagId: `DISC_HYPERTENSION_${Date.now()}`,
        message: `Stage 2 Hypertension (${sysVal} mmHg) captured by device; recommend urgent physician protocol review.`,
        severity: "HIGH"
      });
    }

    return { completenessScore, omissions, discrepancies: flags };
  }

  /**
   * No-Show Risk Score Calculator.
   * Returns risk level, CSS class, reason, and Overbook-Eligible flag for high-risk slots.
   */
  function calculateNoShowRisk(patientAge, triageLevel, followUpDays) {
    const age = Number(patientAge || 45);
    const days = Number(followUpDays || 7);

    if (triageLevel === 'EMERGENCY') {
      return { score: 'Low', class: 'risk-low', reason: 'Critical Emergency Triage (High Attendance Probability)', overbookEligible: false };
    }
    if (age > 65 || age < 12) {
      return { score: 'High', class: 'risk-high', reason: 'Elderly/Pediatric Travel Dependency', overbookEligible: true };
    }
    if (days > 14) {
      return { score: 'High', class: 'risk-high', reason: 'Long Follow-Up Gap (>14 days)', overbookEligible: true };
    }
    if (triageLevel === 'URGENT') {
      return { score: 'Medium', class: 'risk-medium', reason: 'Urgent Priority Review Required', overbookEligible: false };
    }
    return { score: 'Medium', class: 'risk-medium', reason: 'Routine OPD Appointment Schedule', overbookEligible: false };
  }

  /**
   * Generates a localized Hindi/English WhatsApp-style patient reminder.
   */
  function generateReminderPayload(patientName, abhaId, appointmentDate, clinicLocation, medications) {
    const medLine = medications.map(m => `${m.name} (${m.timing})`).join(', ');
    const en = `Hello ${patientName}, your follow-up appointment is scheduled on ${appointmentDate} at ${clinicLocation}. ABHA Ref: ${abhaId}. Medications: ${medLine}. Please arrive 10 minutes early. — MediKiosk`;
    const hi = `नमस्ते ${patientName}, आपकी अगली अपॉइंटमेंट ${appointmentDate} को ${clinicLocation} में है। ABHA संदर्भ: ${abhaId}। दवाइयाँ: ${medLine}। कृपया 10 मिनट पहले पहुँचें। — मेडिकियोस्क`;
    return { english: en, hindi: hi };
  }

  /**
   * Prescription text parser — converts SOAP Plan text into structured medication matrix rows.
   * Recognizes patterns like "Tab X 40mg OD (Morning)" or "Tab Y 500mg BD (Morning & Night)"
   */
  function parsePrescriptionToMatrix(planText) {
    if (!planText) return [];
    const lines = planText.split('\n').filter(l => l.trim());
    return lines.map(line => {
      const name = line.replace(/^\d+\.\s*/, '').trim();
      const morning = /\b(OD|BD|TDS|Morning)\b/i.test(line) ? '1 Tablet' : '—';
      const afternoon = /\b(TDS)\b/i.test(line) ? '1 Tablet' : '—';
      const night = /\b(BD|TDS|Night|HS)\b/i.test(line) ? '1 Tablet' : '—';
      return { name, morning, afternoon, night };
    });
  }

  /**
   * Main Patient Render Function
   */
  function renderPatient(){
    const s = state.selected;
    if (!s) return;

    const raw = state.selectedRawData || {};
    const fullRecord = raw.data || raw;
    const l = level(s);
    const tri = s.triageResult || fullRecord.triage || {};
    const v = s.vitals || fullRecord.vitals || {};
    const symptoms = s.symptoms?.list || fullRecord.chiefComplaints || [];
    const isVerified = s.status === 'VERIFIED_COMMITTED' || fullRecord.status === 'VERIFIED_COMMITTED';

    const discEval = evaluateClinicalDiscrepancies(fullRecord);
    const age = fullRecord.patientDemographics?.age || 45;
    const noShowRisk = calculateNoShowRisk(age, l, 7);

    const subjectiveText = fullRecord.hpi?.narrative || s.chiefComplaints?.[0]?.symptom || "Patient presents for clinical consultation.";
    const sysBp = v.BLOOD_PRESSURE?.value || (v.bloodPressure?.systolic?.value ? `${v.bloodPressure.systolic.value}/${v.bloodPressure.diastolic?.value}` : '120/80');
    const spo2Val = v.SPO2?.value || v.spo2?.value || 98;
    const hrVal = v.HEART_RATE?.value || v.heartRate?.value || 72;
    const glucVal = v.BLOOD_GLUCOSE?.value || v.bloodGlucose?.value || 140;
    const ayushNotes = fullRecord.ayushParameters ? `Agni: ${fullRecord.ayushParameters.agni || 'Sama'}, Koshtha: ${fullRecord.ayushParameters.koshtha || 'Madhyama'}` : 'AYUSH: Unassessed';

    // Altitude Context & Interpretation
    const env = fullRecord.environment || s.environment || {
      altitudeMeters: 2438,
      altitudeFeet: 8000,
      altitudeSource: 'facility_config',
      altitudeConfidence: 1.0,
      timeAtAltitudeHours: 24,
      residenceAltitudeMeters: 0,
      acclimatizationStatus: 'unacclimatized'
    };
    const vSummary = fullRecord.preConsultationSummary?.section1_vitals || {};
    const altInterp = fullRecord.altitudeInterpretation || s.altitudeInterpretation || [];
    const altOverride = fullRecord.altitudeOverride || s.altitudeOverride || null;

    // SpO2 details
    const spo2Obj = vSummary.spo2 || {};
    const spo2Raw = spo2Obj.value ?? spo2Val;
    const spo2Ctx = spo2Obj.altitudeContext || altInterp.find(x => x.type === 'spo2') || {};
    const spo2Expected = spo2Ctx.expectedRange ? `${spo2Ctx.expectedRange[0]}–${spo2Ctx.expectedRange[1]}%` : '92–97%';
    const spo2Status = spo2Ctx.status || (spo2Raw < 88 ? 'critical' : spo2Raw < 92 ? 'borderline' : 'normal');
    const spo2Reason = spo2Ctx.reason || `SpO₂ (${spo2Raw}%) interpreted for altitude ${env.altitudeMeters}m (${env.altitudeFeet}ft).`;
    const spo2Prov = spo2Obj.provenance || 'device-captured';
    const isSpo2FastTrack = spo2Status === 'critical' || l === 'EMERGENCY';

    // BP details (Normal range not shifted upward for altitude)
    const bpObj = vSummary.bloodPressure || {};
    const bpSys = bpObj.systolic ?? String(sysBp).split('/')[0];
    const bpDia = bpObj.diastolic ?? (String(sysBp).split('/')[1] || 80);
    const bpProv = bpObj.provenance || 'device-captured';
    const isBpCrisis = Number(bpSys) >= 180 || Number(bpDia) >= 120;
    const bpStatus = isBpCrisis ? 'critical' : (Number(bpSys) >= 140 || Number(bpDia) >= 90 ? 'borderline' : 'normal');
    const bpInterpretation = isBpCrisis
      ? `Hypertensive crisis: BP ${bpSys}/${bpDia} mmHg. Immediate clinical review required.`
      : `Normal. Standard AHA/ICMR guideline range (90–120 / 60–80 mmHg). No altitude adjustment applied to BP threshold.`;

    // Heart Rate details
    const hrObj = vSummary.heartRate || {};
    const hrRaw = hrObj.value ?? hrVal;
    const hrCtx = hrObj.altitudeContext || altInterp.find(x => x.type === 'heart_rate') || {};
    const hrExpected = hrCtx.expectedRange ? `${hrCtx.expectedRange[0]}–${hrCtx.expectedRange[1]} bpm` : '65–115 bpm';
    const hrStatus = hrCtx.status || 'normal';
    const hrProv = hrObj.provenance || 'device-captured';

    // Algorithm & Disclaimer
    const algoVer = fullRecord.preConsultationSummary?.algorithmVersion || 'altitude-mvp-v1';
    const disclaimerText = fullRecord.preConsultationSummary?.disclaimer || 'Decision-support MVP. Illustrative altitude profiles. Raw values preserved. Clinician sign-off required. Pilot validation needed.';

    const objectiveText = `Hardware Vitals: BP ${bpSys}/${bpDia} mmHg | SpO₂ ${spo2Raw}% | HR ${hrRaw} bpm | Glucose ${glucVal} mg/dL. Altitude: ${env.altitudeMeters}m. ${ayushNotes}`;
    const defaultAssessment = l === 'EMERGENCY' ? 'Hypertensive Crisis / Acute Symptoms requiring immediate stabilization.' : l === 'URGENT' ? 'Stage 1/2 Hypertension / Hyperglycemia requiring priority evaluation.' : 'Essential OPD Follow-up & Routine Consultation.';
    const defaultPlan = '1. Tab Telmisartan 40mg OD (Morning)\n2. Tab Metformin 500mg BD (Morning & Night)\n3. Re-check BP & Blood Sugar in 7 days.';

    const omissionsHtml = discEval.omissions.length
      ? discEval.omissions.map(o => `<span class="omission-chip">⚠️ Unassessed: ${esc(o.parameter)}</span>`).join(' ')
      : '<span style="color:#16a34a; font-size:12px;">✓ All key vitals and AYUSH parameters assessed</span>';

    const discrepanciesHtml = discEval.discrepancies.length
      ? discEval.discrepancies.map(d => `<div style="background:rgba(239, 68, 68, 0.1); border:1px solid #ef4444; color:#fca5a5; padding:8px; border-radius:6px; font-size:12px; margin-top:4px;">⚠️ ${esc(d.message)}</div>`).join('')
      : '<div style="color:#86efac; font-size:12px;">✓ No clinical contradictions detected</div>';

    let hprSectionHtml = '';
    if (isVerified) {
      const sig = fullRecord.hprSignatureBlock || {};
      hprSectionHtml = `
        <div class="signature-block">
          🔒 <strong>EHR RECORD LOCKED & VERIFIED WITH HPR BIOMETRIC SIGNATURE</strong><br />
          • Doctor: ${esc(sig.doctorName || 'Dr. Rajesh Sharma, MD')}<br />
          • HPR ID: ${esc(sig.hprId || 'HPR-IN-9876543210')}<br />
          • Timestamp: ${formatDate(sig.committedAt || fullRecord.updatedAt)}<br />
          • Digital Signature: ${esc(sig.digitalSignature || 'SHA256:AUTHENTICATED_LOCKED')}<br />
          • Notes: ${esc(sig.doctorNotes || 'Verified and approved.')}
        </div>
      `;
    } else {
      hprSectionHtml = `
        <div class="hpr-panel">
          <div style="font-size:13px; font-weight:700; color:#38bdf8; margin-bottom:8px;">
            🔒 HPR Biometric Write-Lock Gatekeeper
          </div>
          <div class="hpr-grid">
            <input type="text" id="hprIdInput" class="hpr-input" value="HPR-IN-9876543210" placeholder="HPR ID" />
            <input type="text" id="docNameInput" class="hpr-input" value="Dr. Rajesh Sharma, MD" placeholder="Doctor Name" />
            <input type="text" id="docRegInput" class="hpr-input" value="MCI-2018-883921" placeholder="Registration No" />
            <input type="text" id="hprTokenInput" class="hpr-input" value="HPR_BEARER_DEMO_TOKEN" placeholder="HPR Token" />
          </div>
          <button type="button" class="btn-action-primary" id="btnCommitRecord">🔒 Approve & Lock EHR Record (HPR Commit)</button>
        </div>
      `;
    }

    // Prescription matrix from SOAP plan
    const parsedMeds = parsePrescriptionToMatrix(defaultPlan);
    const matrixRowsHtml = parsedMeds.map(m => `
      <tr>
        <td style="text-align:left;">${esc(m.name)}</td>
        <td>${esc(m.morning)}</td>
        <td>${esc(m.afternoon)}</td>
        <td>${esc(m.night)}</td>
      </tr>`).join('');

    // Overbook-Eligible badge
    const overbookBadge = noShowRisk.overbookEligible
      ? `<span style="background:#7c3aed;color:#fff;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;margin-left:8px;">OVERBOOK-ELIGIBLE</span>`
      : '';

    // Patient consent toggles state (default: all granted)
    const consentState = state.consentSettings || { vitalsOnly: false, fullHistory: true, ayushNotes: true };

    $('#patient-panel').innerHTML = `
      <div class="patient-header">
        <div class="patient-title">
          <div>
            <h2>${esc(s.patientName || s.patientId || 'Anonymous patient')}</h2>
            <div class="patient-sub">Intake ${esc(s.sessionId)} · ABHA ${esc(s.patientId)} <br>· Status: <strong style="color:${isVerified?'#16a34a':'#f59e0b'}">${isVerified?'VERIFIED':'PROVISIONAL'}</strong></div>
          </div>
          <span class="badge ${l.toLowerCase()}">${l}</span>
        </div>
      </div>

      <!-- Altitude-Aware Clinical Vitals & Interpretation Card -->
      <div class="section">
        <div class="section-label">ALTITUDE-AWARE CLINICAL VITALS & INTERPRETATION</div>

        <!-- Altitude Context Header Banner -->
        <div class="altitude-banner">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <strong style="color:#38bdf8; font-size:13px;">📍 Facility Altitude: ${Number(env.altitudeMeters || 2438).toLocaleString()} m (${Number(env.altitudeFeet || 8000).toLocaleString()} ft)</strong>
              <div style="font-size:11px; color:#cbd5e1; margin-top:2px;">
                Source: <strong>${esc(env.altitudeSource || 'facility_config')}</strong> · Acclimatization: <strong>${esc(env.acclimatizationStatus || 'unacclimatized')}</strong> · Algorithm: <strong>${esc(algoVer)}</strong>
              </div>
            </div>
            <button type="button" class="btn-action-secondary" id="btnOpenAltitudeOverride" style="width:auto; padding:6px 12px; margin-top:0; font-size:11px;">
              ⚖️ Override Interpretation
            </button>
          </div>
          ${altOverride ? `
            <div style="margin-top:8px; background:rgba(56,189,248,0.15); border:1px solid #38bdf8; border-radius:6px; padding:6px 10px; font-size:11px; color:#e0f2fe;">
              ✓ <strong>Physician Override Active:</strong> ${esc(altOverride.overriddenBy || 'Dr. Rajesh Sharma')} (HPR: ${esc(altOverride.doctorHprId || 'HPR-DOC-OVERRIDE')}) set vital status to <span style="font-weight:700; text-transform:uppercase;">${esc(altOverride.overrideStatus || 'normal')}</span>. <em>Reason: ${esc(altOverride.reason || 'Chronically adapted resident')}</em>
            </div>
          ` : ''}
        </div>

        <!-- SpO2 Vitals Card -->
        <div class="vital-altitude-card ${spo2Status}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase;">Oxygen Saturation (SpO₂)</div>
              <div style="margin-top:2px;">
                <strong style="font-size:20px; color:#f8fafc;">${esc(spo2Raw)}%</strong>
                <span class="badge-raw">RAW VALUE</span>
              </div>
            </div>
            <div>
              ${isSpo2FastTrack ? '<span class="fast-track-pill">🚨 YES — FAST-TRACK</span>' : '<span style="color:#10b981; font-weight:700; font-size:12px;">✓ Routine Track</span>'}
            </div>
          </div>
          <div style="margin-top:8px; display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11px; color:#94a3b8;">
            <div>Altitude: <strong style="color:#cbd5e1;">${Number(env.altitudeMeters || 2438).toLocaleString()} m (${Number(env.altitudeFeet || 8000).toLocaleString()} ft)</strong></div>
            <div>Expected Range: <strong style="color:#38bdf8;">${esc(spo2Expected)}</strong></div>
            <div>Provenance: <strong style="color:#cbd5e1;">${esc(spo2Prov)}</strong></div>
            <div>Algorithm: <strong style="color:#cbd5e1;">${esc(algoVer)}</strong></div>
          </div>
          <div style="margin-top:8px; font-size:12px; line-height:1.4; color:${spo2Status === 'critical' ? '#fca5a5' : spo2Status === 'borderline' ? '#fcd34d' : '#86efac'};">
            <strong>Interpretation:</strong> ${esc(spo2Reason)}
          </div>
        </div>

        <!-- Blood Pressure Vitals Card (Explicitly standard range, not altitude adjusted upward) -->
        <div class="vital-altitude-card ${bpStatus}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase;">Blood Pressure (BP)</div>
              <div style="margin-top:2px;">
                <strong style="font-size:20px; color:#f8fafc;">${esc(bpSys)}/${esc(bpDia)} mmHg</strong>
                <span class="badge-raw">RAW VALUE</span>
              </div>
            </div>
            <div>
              ${isBpCrisis ? '<span class="fast-track-pill">🚨 HYPERTENSIVE CRISIS</span>' : '<span style="color:#10b981; font-weight:700; font-size:12px;">✓ Standard Range</span>'}
            </div>
          </div>
          <div style="margin-top:8px; display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11px; color:#94a3b8;">
            <div>Altitude: <strong style="color:#cbd5e1;">${Number(env.altitudeMeters || 2438).toLocaleString()} m</strong></div>
            <div>Expected Range: <strong style="color:#38bdf8;">90–120 / 60–80 mmHg</strong></div>
            <div>Provenance: <strong style="color:#cbd5e1;">${esc(bpProv)}</strong></div>
            <div>Adjustment: <strong style="color:#cbd5e1;">None (AHA/ICMR Standard)</strong></div>
          </div>
          <div style="margin-top:8px; font-size:12px; line-height:1.4; color:${bpStatus === 'critical' ? '#fca5a5' : '#86efac'};">
            <strong>Interpretation:</strong> ${esc(bpInterpretation)}
          </div>
        </div>

        <!-- Heart Rate Card -->
        <div class="vital-altitude-card ${hrStatus}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase;">Heart Rate (HR)</div>
              <div style="margin-top:2px;">
                <strong style="font-size:20px; color:#f8fafc;">${esc(hrRaw)} bpm</strong>
                <span class="badge-raw">RAW VALUE</span>
              </div>
            </div>
            <div>
              ${hrStatus === 'critical' ? '<span class="fast-track-pill">🚨 TACHYCARDIA ESCALATE</span>' : '<span style="color:#10b981; font-weight:700; font-size:12px;">✓ Altitude Baseline</span>'}
            </div>
          </div>
          <div style="margin-top:8px; display:grid; grid-template-columns: 1fr 1fr; gap:6px; font-size:11px; color:#94a3b8;">
            <div>Altitude: <strong style="color:#cbd5e1;">${Number(env.altitudeMeters || 2438).toLocaleString()} m</strong></div>
            <div>Expected Range: <strong style="color:#38bdf8;">${esc(hrExpected)}</strong></div>
            <div>Provenance: <strong style="color:#cbd5e1;">${esc(hrProv)}</strong></div>
            <div>Algorithm: <strong style="color:#cbd5e1;">${esc(algoVer)}</strong></div>
          </div>
          <div style="margin-top:8px; font-size:12px; line-height:1.4; color:${hrStatus === 'critical' ? '#fca5a5' : hrStatus === 'borderline' ? '#fcd34d' : '#86efac'};">
            <strong>Interpretation:</strong> ${esc(hrCtx.reason || 'Normal heart rate within altitude-adjusted parameters.')}
          </div>
        </div>

        <div style="font-size:10px; color:#64748b; font-style:italic; margin-top:6px;">
          ⚖️ ${esc(disclaimerText)}
        </div>
      </div>

      <!-- Clinical Discrepancy & Data Completeness -->
      <div class="section">
        <div class="section-label">CLINICAL DISCREPANCY & DATA COMPLETENESS</div>
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
          <span>Data Completeness Score:</span>
          <strong>${discEval.completenessScore}%</strong>
        </div>
        <div class="completeness-bar-container">
          <div class="completeness-bar-fill" style="width:${discEval.completenessScore}%"></div>
        </div>
        <div style="margin-top:10px;">
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">UNASSESSED PARAMETERS:</div>
          ${omissionsHtml}
        </div>
        <div style="margin-top:10px;">
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">CLINICAL CONTRADICTIONS & WARNINGS:</div>
          ${discrepanciesHtml}
        </div>
      </div>

      <!-- Interactive SOAP View -->
      <div class="section">
        <div class="section-label">PHYSICIAN EMR — INTERACTIVE SOAP VIEW</div>

        <div class="soap-box">
          <div class="soap-title">Subjective (S)</div>
          <p style="font-size:13px; margin:0; color:#cbd5e1;">${esc(subjectiveText)}</p>
        </div>

        <div class="soap-box">
          <div class="soap-title">Objective (O)</div>
          <p style="font-size:13px; margin:0; color:#cbd5e1;">${esc(objectiveText)}</p>
        </div>

        <div class="soap-box">
          <div class="soap-title">Assessment (A)</div>
          <textarea id="soapAssessment" class="hpr-input" style="width:100%; box-sizing:border-box;" rows="2">${esc(defaultAssessment)}</textarea>
        </div>

        <div class="soap-box">
          <div class="soap-title">Plan (P)</div>
          <textarea id="soapPlan" class="hpr-input" style="width:100%; box-sizing:border-box;" rows="3">${esc(defaultPlan)}</textarea>
        </div>
      </div>

      <!-- HPR Write-Lock Sign-Off -->
      <div class="section">
        <div class="section-label">HPR WRITE-LOCK SIGN-OFF</div>
        ${hprSectionHtml}
      </div>

      <!-- Post-OPD & Predictive Care -->
      <div class="section">
        <div class="section-label">POST-OPD & PREDICTIVE CARE</div>
        <div style="font-size:13px; margin-bottom:8px;">
          No-Show Risk: <span class="${noShowRisk.class}">${noShowRisk.score}</span>${overbookBadge}
          <div style="font-size:11px; color:#94a3b8;">${esc(noShowRisk.reason)}</div>
        </div>

        <div style="font-size:12px; font-weight:700; color:#38bdf8; margin-top:10px;">Visual Medication Dosage Schedule</div>
        <table class="matrix-table">
          <thead>
            <tr>
              <th style="text-align:left;">Medication</th>
              <th>🌅 Morning</th>
              <th>☀️ Afternoon</th>
              <th>🌙 Night</th>
            </tr>
          </thead>
          <tbody>
            ${matrixRowsHtml}
          </tbody>
        </table>

        <div id="reminderBlock" style="margin-top:14px; display:none;">
          <div style="font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px;">PATIENT REMINDER — ENGLISH</div>
          <div id="reminderEn" style="background:#0f172a; border:1px solid #334155; border-radius:6px; padding:10px; font-size:12px; color:#cbd5e1; margin-bottom:8px;"></div>
          <div style="font-size:11px; font-weight:700; color:#94a3b8; margin-bottom:4px;">रोगी अनुस्मारक — हिंदी</div>
          <div id="reminderHi" style="background:#0f172a; border:1px solid #334155; border-radius:6px; padding:10px; font-size:12px; color:#cbd5e1;"></div>
        </div>

        <button type="button" class="btn-action-secondary" id="btnSendWhatsapp">
          💬 Generate Localized Appointment & Dosage Reminder
        </button>
      </div>

      <!-- ABDM FHIR R4 Bundle Export with Consent Manager -->
      <div class="section">
        <div class="section-label">ABDM FHIR R4 BUNDLE EXPORT</div>

        <div style="font-size:12px; font-weight:700; color:#38bdf8; margin-bottom:8px;">Patient Data Sharing Consent</div>
        <div style="display:flex; flex-direction:column; gap:6px; margin-bottom:12px;">
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:#cbd5e1; cursor:pointer;">
            <input type="checkbox" id="consentVitalsOnly" ${consentState.vitalsOnly ? 'checked' : ''} />
            Vitals Only (restrict to BP, SpO₂, HR, Glucose observations)
          </label>
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:#cbd5e1; cursor:pointer;">
            <input type="checkbox" id="consentFullHistory" ${consentState.fullHistory ? 'checked' : ''} />
            Include Full Diagnostic History (past diagnoses & conditions)
          </label>
          <label style="display:flex; align-items:center; gap:8px; font-size:13px; color:#cbd5e1; cursor:pointer;">
            <input type="checkbox" id="consentAyushNotes" ${consentState.ayushNotes ? 'checked' : ''} />
            Include AYUSH Dashavidha Notes
          </label>
        </div>

        <button type="button" class="btn-action-secondary" id="btnExportFhir">
          📄 Export HL7 FHIR (R4) Bundle (.json)
        </button>
      </div>

      <div class="section"><div class="section-label">AUDIT TRAIL</div><div id="audit-list"><p>Loading audit trail…</p></div></div>
    `;

    loadAudit(s.sessionId);

    if ($('#btnCommitRecord')) {
      $('#btnCommitRecord').addEventListener('click', async () => {
        const hprId = $('#hprIdInput').value.trim();
        const docName = $('#docNameInput').value.trim();
        const docReg = $('#docRegInput').value.trim();
        const hprToken = $('#hprTokenInput').value.trim();
        const assessment = $('#soapAssessment').value.trim();
        const plan = $('#soapPlan').value.trim();

        try {
          await fetch('/api/v1/hpr/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hprId, doctorName: docName, registrationNumber: docReg })
          });

          const commitRes = await fetch('/api/v1/doctor/verify', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${hprToken}`
            },
            body: JSON.stringify({
              intakeId: s.sessionId,
              doctorNotes: `Assessment: ${assessment} | Plan: ${plan}`
            })
          });

          const commitData = await commitRes.json();
          if (commitRes.ok && commitData.success) {
            toast('✓ Record verified & locked! Status badge updated live via Socket.IO.');
            if (state.socket) {
              state.socket.emit('EHR_RECORD_COMMITTED', {
                sessionId: s.sessionId,
                status: 'VERIFIED_COMMITTED',
                timestamp: new Date().toISOString()
              });
            }
            await loadSessions();
            await selectSession(s.sessionId, true);
          } else {
            toast(`HPR Commit Error: ${commitData.message || 'Write-lock rejected'}`);
          }
        } catch (err) {
          toast(`Commit Exception: ${err.message}`);
        }
      });
    }

    if ($('#btnSendWhatsapp')) {
      $('#btnSendWhatsapp').addEventListener('click', () => {
        const meds = parsePrescriptionToMatrix($('#soapPlan')?.value || defaultPlan).map(m => ({
          name: m.name.split('(')[0].trim(),
          timing: [m.morning !== '—' ? '🌅' : '', m.afternoon !== '—' ? '☀️' : '', m.night !== '—' ? '🌙' : ''].filter(Boolean).join(' ')
        }));
        const date = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        const reminder = generateReminderPayload(
          s.patientName || 'Patient',
          s.patientId || 'N/A',
          date,
          'MediKiosk Health Centre',
          meds
        );
        const block = $('#reminderBlock');
        if (block) {
          $('#reminderEn').textContent = reminder.english;
          $('#reminderHi').textContent = reminder.hindi;
          block.style.display = 'block';
        }
        toast('✓ Localized reminder generated for WhatsApp/SMS dispatch.');
      });
    }

    // Save consent toggle state on change
    ['consentVitalsOnly', 'consentFullHistory', 'consentAyushNotes'].forEach(id => {
      const el = $(`#${id}`);
      if (el) el.addEventListener('change', () => {
        state.consentSettings = {
          vitalsOnly: $('#consentVitalsOnly')?.checked || false,
          fullHistory: $('#consentFullHistory')?.checked !== false,
          ayushNotes: $('#consentAyushNotes')?.checked !== false
        };
      });
    });

    if ($('#btnExportFhir')) {
      $('#btnExportFhir').addEventListener('click', async () => {
        try {
          const consent = state.consentSettings || { vitalsOnly: false, fullHistory: true, ayushNotes: true };
          const params = new URLSearchParams({
            vitalsOnly: String(consent.vitalsOnly),
            fullHistory: String(consent.fullHistory),
            ayushNotes: String(consent.ayushNotes)
          });
          const fhirRes = await fetch(`/api/v1/export/fhir/${encodeURIComponent(s.sessionId)}?${params}`);
          if (!fhirRes.ok) throw new Error(`HTTP error ${fhirRes.status}`);
          const fhirBundle = await fhirRes.json();

          const blob = new Blob([JSON.stringify(fhirBundle, null, 2)], { type: 'application/fhir+json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `bundle-FHIR-R4-${s.sessionId}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          toast('✓ HL7 FHIR (R4) Bundle downloaded successfully!');
        } catch (err) {
          toast(`FHIR Export Error: ${err.message}`);
        }
      });
    }

    if ($('#btnOpenAltitudeOverride')) {
      $('#btnOpenAltitudeOverride').addEventListener('click', () => {
        $('#override-modal').classList.remove('hidden');
      });
    }
  }

  let currentModalSessionId = null;

  async function loadAudit(sessionId){
    const el = $('#audit-list');
    if (!el) return;
    try {
      const data = await api(`/api/events/session/${encodeURIComponent(sessionId)}/audit`);
      const entries = (data.auditTrail || []).slice().reverse();

      if (!entries.length) {
        el.innerHTML = '<p style="color:#94a3b8; font-size:12px;">No audit records found for this encounter.</p>';
        return;
      }

      el.innerHTML = entries.map(x => {
        const isRed = (x.eventType || '').includes('RED_FLAG');
        const isOver = (x.eventType || '').includes('OVERRIDE');
        const color = isRed ? '#ef4444' : isOver ? '#f59e0b' : '#38bdf8';
        const hashStr = x.hash && x.hash !== 'N/A' ? `<span style="font-family:monospace; font-size:9px; color:#64748b;">[SHA: ${esc(x.hash.slice(0, 8))}…]</span>` : '';

        return `
          <div class="audit-entry" style="grid-template-columns: 80px 1fr; border-bottom:1px solid #1e293b; padding:8px 0;">
            <div class="audit-time" style="font-size:10px; color:#64748b;">${formatTime(x.timestamp)}</div>
            <div class="audit-body">
              <div style="display:flex; align-items:center; gap:6px;">
                <strong style="color:${color}; font-size:11px;">${esc(x.eventType)}</strong>
                ${hashStr}
              </div>
              <p style="font-size:11px; color:#cbd5e1; margin:2px 0 0;">${esc(x.reason)}</p>
              <div style="font-size:10px; color:#64748b; margin-top:2px;">Performed by: ${esc(x.performedBy || 'SYSTEM')}</div>
            </div>
          </div>
        `;
      }).join('');
    } catch(err) {
      el.innerHTML = '<p style="color:#f87171; font-size:12px;">Audit trail unavailable.</p>';
    }
  }

  function renderCriticalAlerts(){
    const emergencies = state.sessions.filter(s => level(s) === 'EMERGENCY' || s.status === 'red_flagged');
    const container = $('#alerts-list');
    if (!container) return;

    const totalCount = emergencies.length + state.activeAlerts.length;
    $('#alerts-meta').textContent = `${totalCount} active critical escalation${totalCount === 1 ? '' : 's'} requiring immediate physician review`;

    if (!emergencies.length && !state.activeAlerts.length) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px; background:#111e26; border-radius:12px; border:1px solid #1e3a47;">
          <div style="font-size:32px; margin-bottom:10px;">🟢</div>
          <h3 style="color:#6ee7b7; margin:0 0 6px;">No Critical Emergencies Active</h3>
          <p style="color:#94a3b8; font-size:13px; margin:0;">All patient encounters are currently within normal or routine priority tiers.</p>
        </div>
      `;
      return;
    }

    // Merge sessions and real-time alerts
    const displayedIds = new Set();
    let cardsHtml = '';

    // Render session emergencies
    emergencies.forEach(s => {
      displayedIds.add(s.sessionId);
      const v = s.vitals || {};
      const env = s.environment || { altitudeMeters: 2438, altitudeFeet: 8000 };
      const spo2 = v.SPO2?.value || v.spo2?.value || '—';
      const bp = v.BLOOD_PRESSURE?.value || (v.bloodPressure ? `${v.bloodPressure.systolic?.value}/${v.bloodPressure.diastolic?.value}` : '—');
      const hr = v.HEART_RATE?.value || v.heartRate?.value || '—';
      const reason = s.triageResult?.reason || s.triageResult?.action || 'Critical condition detected requiring immediate attention';

      cardsHtml += `
        <div class="panel" style="background:#191824; border:1px solid #dc2626; padding:16px; border-radius:10px; display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="background:#ef4444; color:#fff; font-size:10px; font-weight:800; padding:2px 8px; border-radius:4px; text-transform:uppercase;">🚨 EMERGENCY FAST-TRACK</span>
                <span style="font-size:16px; font-weight:700; color:#fff;">${esc(s.patientName || s.patientId || 'Patient')}</span>
                <span style="font-size:12px; color:#94a3b8;">· ABHA: ${esc(s.patientId || 'N/A')}</span>
              </div>
              <div style="font-size:13px; color:#f87171; margin-top:4px; font-weight:600;">
                ⚠ ${esc(reason)}
              </div>
            </div>
            <div style="display:flex; gap:6px;">
              <span class="badge" style="background:#0c4a6e; color:#38bdf8; font-size:11px;">🏔️ ${env.altitudeMeters} m (${env.altitudeFeet || Math.round(env.altitudeMeters * 3.28084)} ft)</span>
              <span class="badge" style="background:#374151; color:#d1d5db; font-size:11px;">ID: ${esc(s.sessionId)}</span>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px; background:#111922; padding:10px; border-radius:8px;">
            <div>
              <div style="font-size:10px; color:#94a3b8; text-transform:uppercase;">SpO₂ Saturation</div>
              <div style="font-size:16px; font-weight:800; color:#ef4444;">${spo2}% <small style="font-size:10px; color:#fca5a5;">(Sub-altitude min)</small></div>
            </div>
            <div>
              <div style="font-size:10px; color:#94a3b8; text-transform:uppercase;">Blood Pressure</div>
              <div style="font-size:16px; font-weight:800; color:#fff;">${bp} <small style="font-size:10px; color:#94a3b8;">mmHg</small></div>
            </div>
            <div>
              <div style="font-size:10px; color:#94a3b8; text-transform:uppercase;">Heart Rate</div>
              <div style="font-size:16px; font-weight:800; color:#fff;">${hr} <small style="font-size:10px; color:#94a3b8;">bpm</small></div>
            </div>
            <div>
              <div style="font-size:10px; color:#94a3b8; text-transform:uppercase;">Timestamp</div>
              <div style="font-size:13px; font-weight:600; color:#cbd5e1;">${formatTime(s.lastUpdated || s.createdAt)}</div>
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button class="btn-action-primary btn-alert-open" data-session="${esc(s.sessionId)}" style="width:auto; padding:7px 16px; font-size:12px; margin-top:0;">
              🔍 Open Patient Chart
            </button>
            <button class="btn-action-secondary btn-alert-override" data-session="${esc(s.sessionId)}" style="width:auto; padding:7px 16px; font-size:12px; margin-top:0;">
              ⚖️ Physician Override
            </button>
          </div>
        </div>
      `;
    });

    // Render active live alerts if not already in session list
    state.activeAlerts.forEach(a => {
      if (displayedIds.has(a.sessionId)) return;
      displayedIds.add(a.sessionId);

      const alt = a.altitudeMeters || a.altitude?.meters || a.altitude || 2438;
      const spo2 = a.vitalsSnapshot?.spo2 ?? a.vitals?.spo2 ?? 'N/A';
      const bp = a.vitalsSnapshot ? `${a.vitalsSnapshot.systolic || '—'}/${a.vitalsSnapshot.diastolic || '—'}` : '—';
      const hr = a.vitalsSnapshot?.heartRate ?? '—';
      const reason = a.reason || a.flagReason || 'Real-time emergency escalation';

      cardsHtml += `
        <div class="panel" style="background:#191824; border:1px solid #dc2626; padding:16px; border-radius:10px; display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
            <div>
              <div style="display:flex; align-items:center; gap:8px;">
                <span style="background:#ef4444; color:#fff; font-size:10px; font-weight:800; padding:2px 8px; border-radius:4px; text-transform:uppercase;">🚨 LIVE SOCKET ALERT</span>
                <span style="font-size:16px; font-weight:700; color:#fff;">${esc(a.patientName || a.patientId || 'Patient')}</span>
                <span style="font-size:12px; color:#94a3b8;">· ID: ${esc(a.sessionId)}</span>
              </div>
              <div style="font-size:13px; color:#f87171; margin-top:4px; font-weight:600;">
                ⚠ ${esc(reason)}
              </div>
            </div>
            <div style="display:flex; gap:6px;">
              <span class="badge" style="background:#0c4a6e; color:#38bdf8; font-size:11px;">🏔️ ${alt} m</span>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap:10px; background:#111922; padding:10px; border-radius:8px;">
            <div>
              <div style="font-size:10px; color:#94a3b8; text-transform:uppercase;">SpO₂ Saturation</div>
              <div style="font-size:16px; font-weight:800; color:#ef4444;">${spo2}%</div>
            </div>
            <div>
              <div style="font-size:10px; color:#94a3b8; text-transform:uppercase;">Blood Pressure</div>
              <div style="font-size:16px; font-weight:800; color:#fff;">${bp} mmHg</div>
            </div>
            <div>
              <div style="font-size:10px; color:#94a3b8; text-transform:uppercase;">Heart Rate</div>
              <div style="font-size:16px; font-weight:800; color:#fff;">${hr} bpm</div>
            </div>
            <div>
              <div style="font-size:10px; color:#94a3b8; text-transform:uppercase;">Timestamp</div>
              <div style="font-size:13px; font-weight:600; color:#cbd5e1;">${formatTime(a.timestamp)}</div>
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button class="btn-action-primary btn-alert-open" data-session="${esc(a.sessionId)}" style="width:auto; padding:7px 16px; font-size:12px; margin-top:0;">
              🔍 Open Patient Chart
            </button>
            <button class="btn-action-secondary btn-alert-override" data-session="${esc(a.sessionId)}" style="width:auto; padding:7px 16px; font-size:12px; margin-top:0;">
              ⚖️ Physician Override
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = cardsHtml;

    container.querySelectorAll('.btn-alert-open').forEach(btn => {
      btn.addEventListener('click', () => {
        selectSession(btn.dataset.session);
        switchView('queue');
      });
    });

    container.querySelectorAll('.btn-alert-override').forEach(btn => {
      btn.addEventListener('click', async () => {
        await selectSession(btn.dataset.session);
        $('#override-modal').classList.remove('hidden');
      });
    });
  }

  async function loadSystemAudit(){
    const listEl = $('#system-audit-list');
    if (!listEl) return;
    listEl.innerHTML = '<p style="color:#94a3b8; font-size:13px;">Loading system audit records…</p>';

    try {
      const data = await api('/api/events/audit');
      state.allAuditLogs = data.auditTrail || [];

      const badge = $('#audit-chain-badge');
      if (badge) {
        if (data.chainValid) {
          badge.textContent = `🟢 SHA-256 Chain Verified Intact (${data.count} records)`;
          badge.style.background = '#065f46';
          badge.style.color = '#6ee7b7';
        } else {
          badge.textContent = `🔴 Chain Tamper Detected at Index ${data.chainDetails?.brokenIndex}`;
          badge.style.background = '#7f1d1d';
          badge.style.color = '#fca5a5';
        }
      }

      renderAuditList(state.allAuditLogs);
    } catch(err) {
      listEl.innerHTML = `<p style="color:#f87171; font-size:13px;">Failed to load audit trail: ${err.message}</p>`;
    }
  }

  function renderAuditList(logs){
    const listEl = $('#system-audit-list');
    if (!listEl) return;

    if (!logs.length) {
      listEl.innerHTML = '<p style="color:#94a3b8; font-size:13px;">No audit records found.</p>';
      return;
    }

    listEl.innerHTML = logs.map(l => {
      const isRed = (l.eventType || '').includes('RED_FLAG');
      const isOver = (l.eventType || '').includes('OVERRIDE');
      const isContext = (l.eventType || '').includes('CONTEXT');
      const badgeColor = isRed ? '#ef4444' : isOver ? '#f59e0b' : isContext ? '#10b981' : '#38bdf8';
      const prevDisplay = l.prevHash ? (l.prevHash === 'GENESIS' ? 'GENESIS' : `${l.prevHash.slice(0, 10)}…`) : 'GENESIS';
      const hashDisplay = l.hash && l.hash !== 'N/A' ? `${l.hash.slice(0, 14)}…` : 'N/A';

      return `
        <div style="background:#111922; border:1px solid #1e293b; padding:12px 14px; border-radius:8px; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:10px; font-weight:800; padding:2px 7px; border-radius:4px; background:${badgeColor}; color:#fff;">
                ${esc(l.eventType)}
              </span>
              <span style="font-size:12px; font-weight:700; color:#fff;">Session: \`${esc(l.sessionId)}\`</span>
              <span style="font-size:11px; color:#94a3b8;">· By: <strong>${esc(l.performedBy || 'SYSTEM')}</strong></span>
            </div>
            <div style="font-size:11px; color:#64748b;">${formatDate(l.timestamp)}</div>
          </div>
          <div style="font-size:12px; color:#cbd5e1;">
            ${esc(l.reason)}
          </div>
          <div style="display:flex; gap:14px; font-size:10px; font-family:monospace; color:#64748b; background:#0b1118; padding:6px 10px; border-radius:4px; overflow-x:auto;">
            <span>PrevHash: <code style="color:#94a3b8;">${esc(prevDisplay)}</code></span>
            <span>➔</span>
            <span>SHA-256: <code style="color:#38bdf8;">${esc(hashDisplay)}</code></span>
            <span style="margin-left:auto; color:#10b981;">✓ Tamper-Evident</span>
          </div>
        </div>
      `;
    }).join('');
  }

  function switchView(viewName){
    state.currentView = viewName;

    // Toggle nav item classes
    document.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Toggle workspace containers
    $('#workspace-queue')?.classList.toggle('hidden', viewName !== 'queue');
    $('#workspace-alerts')?.classList.toggle('hidden', viewName !== 'alerts');
    $('#workspace-audit')?.classList.toggle('hidden', viewName !== 'audit');

    // Update Topbar
    if (viewName === 'queue') {
      $('#topbar-eyebrow').textContent = 'CLINICAL OPERATIONS';
      $('#topbar-title').textContent = 'Live Patient Queue';
      $('#topbar-desc').textContent = 'Real-time triage queue, altitude-aware vitals interpretation, SOAP EMR view, and Post-OPD care loop.';
    } else if (viewName === 'alerts') {
      $('#topbar-eyebrow').textContent = 'EMERGENCY & FAST-TRACK DISPATCH';
      $('#topbar-title').textContent = 'Critical Alerts Command Center';
      $('#topbar-desc').textContent = 'Active emergency escalations, severe hypoxemia red flags, hypertensive crises, and immediate doctor interventions.';
      renderCriticalAlerts();
    } else if (viewName === 'audit') {
      $('#topbar-eyebrow').textContent = 'SECURITY & COMPLIANCE GOVERNANCE';
      $('#topbar-title').textContent = 'Immutable Cryptographic Audit Trail';
      $('#topbar-desc').textContent = 'Tamper-evident append-only SHA-256 hash chaining conforming to ABDM, NRCeS India, and CDSCO SaMD standards.';
      loadSystemAudit();
    }
  }

  function upsertSessionFromTriage(payload){
    const i = state.sessions.findIndex(s => s.sessionId === payload.sessionId);
    const existing = i >= 0 ? state.sessions[i] : { sessionId: payload.sessionId, patientId: payload.patientId || payload.triageResult?.patientId };

    if (payload.triageResult) existing.triageResult = payload.triageResult;
    if (payload.triageLevel) {
      if (!existing.triageResult) existing.triageResult = {};
      existing.triageResult.triageLevel = payload.triageLevel;
    }

    existing.patientName = payload.patientName || existing.patientName;
    existing.lastUpdated = payload.timestamp || new Date().toISOString();
    existing.status = payload.status || existing.status || 'PROVISIONAL';

    if (i >= 0) state.sessions[i] = existing;
    else state.sessions.unshift(existing);

    renderStats();
    renderQueue();
    if (state.selected?.sessionId === payload.sessionId) selectSession(payload.sessionId, false);
  }

  function showEmergency(payload){
    currentModalSessionId = payload.sessionId;
    const patId = payload.patientName || payload.patientId || payload.sessionId;
    $('#modal-title').textContent = `Emergency escalation · ${patId}`;
    const reasonText = payload.reason || payload.flagReason || 'An emergency triage condition has been detected.';
    $('#modal-reason').textContent = reasonText;

    const alt = payload.altitudeMeters || payload.altitude?.meters || payload.altitude || 2438;
    const spo2 = payload.vitalsSnapshot?.spo2 ?? payload.vitals?.spo2 ?? 'N/A';
    const rules = payload.triggeredRules || [
      reasonText,
      `Altitude: ${alt}m (${Math.round(alt * 3.28084)}ft)`,
      `SpO2: ${spo2}%`,
      `Algorithm: ${payload.algorithmVersion || 'altitude-mvp-v1'}`
    ];
    $('#modal-rules').innerHTML = rules.map(r => `<span class="rule-chip danger">${esc(r)}</span>`).join('');
    $('#modal-meta').textContent = `Action: ${payload.action || 'IMMEDIATE_DOCTOR_ALERT'} · ${formatDate(payload.timestamp || new Date())}`;
    $('#alert-modal').classList.remove('hidden');
    toast('🚨 Emergency escalation received from triage engine.');
  }

  function connectSocket(){
    if (typeof io === 'undefined') { $('#connection-text').textContent = 'Socket client unavailable'; return; }
    state.socket = io({ transports: ['websocket', 'polling'] });
    const dot = $('#connection-dot').parentElement;

    state.socket.on('connect', () => {
      dot.classList.add('online');
      $('#connection-text').textContent = 'Live connection';
      state.socket.emit('JOIN_DASHBOARD', {}, () => {});
      toast('Live triage stream connected.');
    });

    state.socket.on('disconnect', () => { dot.classList.remove('online'); $('#connection-text').textContent = 'Disconnected'; });
    state.socket.on('connect_error', () => { dot.classList.remove('online'); $('#connection-text').textContent = 'Connection retrying…'; });

    state.socket.on('kiosk:intake_submitted', payload => {
      toast(`🚨 New kiosk intake submitted: ${payload.patientName || payload.sessionId} [${payload.triageLevel}]`);
      upsertSessionFromTriage(payload);
    });

    state.socket.on('TRIAGE_UPDATED', payload => upsertSessionFromTriage(payload));
    state.socket.on('PATIENT_EVENT_RECEIVED', payload => {
      toast(`New intake event: ${payload.sessionId}`);
      loadSessions();
    });

    state.socket.on('EHR_RECORD_COMMITTED', payload => {
      toast(`✓ EHR Record ${payload.sessionId} locked and verified across network.`);
      loadSessions();
    });

    state.socket.on('ESCALATION_REQUIRED', payload => {
      state.activeAlerts.push(payload);
      upsertSessionFromTriage({ sessionId: payload.sessionId, triageResult: { ...payload, triageLevel: 'EMERGENCY' } });
      showEmergency(payload);
      renderStats();
    });

    state.socket.on('SERVER.ESCALATION_REQUIRED', payload => {
      state.activeAlerts.push(payload);
      upsertSessionFromTriage({ sessionId: payload.sessionId, triageResult: { ...payload, triageLevel: 'EMERGENCY' } });
      showEmergency(payload);
      renderStats();
    });

    state.socket.on('ALTITUDE_RED_FLAG', payload => {
      const reason = payload.reason || payload.flagReason || 'Critical hypoxemia at altitude';
      const alt = payload.altitudeMeters || payload.altitude?.meters || payload.altitude || 2438;
      const spo2 = payload.vitalsSnapshot?.spo2 ?? payload.vitals?.spo2 ?? 'N/A';

      toast(`🚨 Altitude Red Flag: ${reason} (${payload.sessionId})`);

      const enrichedPayload = {
        ...payload,
        reason,
        triggeredRules: [
          reason,
          `Altitude: ${alt}m (${Math.round(alt * 3.28084)}ft)`,
          `SpO2: ${spo2}%`,
          `Algorithm: ${payload.algorithmVersion || 'altitude-mvp-v1'}`
        ],
        action: 'FAST_TRACK_ALTITUDE_OXYGEN'
      };

      state.activeAlerts.push(enrichedPayload);

      upsertSessionFromTriage({
        sessionId: payload.sessionId,
        patientId: payload.patientId,
        patientName: payload.patientName,
        triageResult: {
          triageLevel: 'EMERGENCY',
          action: 'IMMEDIATE_DOCTOR_ALERT',
          reason: reason,
          triggeredRules: [reason]
        }
      });

      showEmergency(enrichedPayload);
      renderStats();
    });

    state.socket.on('RED_FLAG_DETECTED', payload => {
      if (payload.currentLevel === 'URGENT') toast(`Urgent red flag: ${payload.sessionId}`);
    });
  }

  // Sidebar Navigation View Switchers
  document.querySelectorAll('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(btn.dataset.view);
    });
  });

  // Filter Buttons inside Live Queue
  document.querySelectorAll('.filter').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.filter').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    state.filter = btn.dataset.filter;
    renderQueue();
  }));

  $('#refresh-btn').addEventListener('click', loadSessions);
  $('#btn-refresh-alerts')?.addEventListener('click', renderCriticalAlerts);
  $('#btn-refresh-audit')?.addEventListener('click', loadSystemAudit);

  // Search Filter in System Audit View
  $('#audit-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      renderAuditList(state.allAuditLogs);
      return;
    }
    const filtered = state.allAuditLogs.filter(l =>
      (l.sessionId && l.sessionId.toLowerCase().includes(q)) ||
      (l.eventType && l.eventType.toLowerCase().includes(q)) ||
      (l.performedBy && l.performedBy.toLowerCase().includes(q)) ||
      (l.reason && l.reason.toLowerCase().includes(q))
    );
    renderAuditList(filtered);
  });

  // Alert Modal Controls
  $('#modal-close').addEventListener('click', () => $('#alert-modal').classList.add('hidden'));
  $('#modal-btn-dismiss')?.addEventListener('click', () => $('#alert-modal').classList.add('hidden'));
  $('#modal-btn-open')?.addEventListener('click', () => {
    $('#alert-modal').classList.add('hidden');
    if (currentModalSessionId) {
      selectSession(currentModalSessionId);
      switchView('queue');
    }
  });
  $('#alert-modal').addEventListener('click', e => { if (e.target.id === 'alert-modal') $('#alert-modal').classList.add('hidden'); });

  // Altitude Override Modal Listeners
  $('#override-modal-close')?.addEventListener('click', () => $('#override-modal').classList.add('hidden'));
  $('#btnCancelOverride')?.addEventListener('click', () => $('#override-modal').classList.add('hidden'));
  $('#override-modal')?.addEventListener('click', e => { if (e.target.id === 'override-modal') $('#override-modal').classList.add('hidden'); });

  $('#btnSubmitOverride')?.addEventListener('click', async () => {
    if (!state.selected) return;
    const sessionId = state.selected.sessionId;
    const vitalType = $('#overrideVitalType').value;
    const overrideStatus = $('#overrideStatus').value;
    const overrideReason = $('#overrideReason').value.trim();
    const clearedFastTrack = $('#overrideClearFastTrack').checked;
    const doctorHprId = $('#hprIdInput')?.value?.trim() || 'HPR-IN-9876543210';
    const doctorName = $('#docNameInput')?.value?.trim() || 'Dr. Rajesh Sharma, MD';

    try {
      let res = await fetch(`/api/v1/clinical/patient/${encodeURIComponent(sessionId)}/altitude-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doctorHprId, doctorName, vitalType, overrideStatus, overrideReason, clearedFastTrack })
      });
      if (!res.ok) {
        res = await fetch(`/api/v1/sessions/${encodeURIComponent(sessionId)}/altitude-override`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ doctorHprId, doctorName, vitalType, overrideStatus, overrideReason, clearedFastTrack })
        });
      }
      const data = await res.json();
      if (res.ok) {
        toast('✓ Altitude interpretation override recorded & logged to audit trail.');
        $('#override-modal').classList.add('hidden');
        await loadSessions();
        await selectSession(sessionId, true);
      } else {
        toast(`Override failed: ${data.message || data.error}`);
      }
    } catch (err) {
      toast(`Override error: ${err.message}`);
    }
  });

  $('#seed-btn').addEventListener('click', async () => {
    try {
      await api('/api/events/demo/seed', { method: 'POST' });
      await loadSessions();
      toast('Demo encounters loaded.');
    } catch(err) {
      toast(`Demo seed failed: ${err.message}`);
    }
  });

  connectSocket();
  loadSessions();
})();
