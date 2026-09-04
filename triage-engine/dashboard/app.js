(() => {
  const API = '';
  const state = { sessions: [], selected: null, filter: 'ALL', socket: null };
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
    const counts={EMERGENCY:0,URGENT:0,ROUTINE:0};
    state.sessions.forEach(s=>counts[level(s)]++);
    $('#stat-total').textContent=state.sessions.length;
    $('#stat-emergency').textContent=counts.EMERGENCY;
    $('#stat-urgent').textContent=counts.URGENT;
    $('#stat-routine').textContent=counts.ROUTINE;
  }

  function renderQueue(){
    const list=state.sessions.filter(s=>state.filter==='ALL'||level(s)===state.filter).sort((a,b)=>{
      const rank={EMERGENCY:0,URGENT:1,ROUTINE:2};
      return rank[level(a)]-rank[level(b)] || new Date(b.lastUpdated)-new Date(a.lastUpdated);
    });
    $('#queue-meta').textContent=`${list.length} patient${list.length===1?'':'s'}`;
    if(!list.length){ $('#queue').innerHTML='<div class="empty-queue">No encounters match this filter.</div>'; return; }
    $('#queue').innerHTML=list.map(s=>{
      const l=level(s), symptom=s.symptoms?.primary?.symptomName?.replaceAll('_',' ') || 'Clinical intake in progress';
      const selected=state.selected?.sessionId===s.sessionId?' selected':'';
      const isVerified = s.status === 'VERIFIED_COMMITTED';
      const statusBadge = isVerified ? '<span class="badge-verified">VERIFIED</span>' : '<span class="badge-provisional">PROVISIONAL</span>';

      return `<button class="queue-card${selected}" data-session="${esc(s.sessionId)}">
        <i class="priority-bar ${l.toLowerCase()}"></i>
        <div>
          <div class="patient-name">${esc(s.patientName || s.patientId || 'Anonymous patient')} ${statusBadge}</div>
          <div class="patient-id">${esc(s.sessionId)} · ABHA: ${esc(s.patientId || 'N/A')}</div>
          <div class="symptom-line">${esc(symptom)}</div>
        </div>
        <div><span class="badge ${l.toLowerCase()}">${l}</span><div class="queue-time">${formatTime(s.lastUpdated)}</div></div>
      </button>`;
    }).join('');
    document.querySelectorAll('.queue-card').forEach(el=>el.addEventListener('click',()=>selectSession(el.dataset.session)));
  }

  async function selectSession(sessionId, rerender=true){
    try{
      const data=await api(`/api/events/session/${encodeURIComponent(sessionId)}`);
      state.selected=data.session || data.data?.session;
      state.selectedRawData = data.data; // Store full Task 5 clinical object
      renderPatient();
      if(rerender) renderQueue();
    }catch(err){toast(`Unable to open encounter: ${err.message}`)}
  }

  function renderPatient(){
    const s = state.selected;
    if(!s) return;

    const raw = state.selectedRawData || {};
    const l = level(s);
    const tri = s.triageResult || {};
    const v = s.vitals || {};
    const symptoms = s.symptoms?.list || [];
    const isVerified = s.status === 'VERIFIED_COMMITTED' || raw.status === 'VERIFIED_COMMITTED';

    const vitals=[['HR','HEART_RATE','bpm'],['SpO₂','SPO2','%'],['BP','BLOOD_PRESSURE','mmHg'],['Temp','TEMPERATURE','°F'],['Glucose','BLOOD_GLUCOSE','mg/dL']];
    const vitalHtml=vitals.map(([label,key,unit])=>{
      const x=v[key]?.value;
      let val=x;
      if(x&&typeof x==='object') val=`${x.systolic}/${x.diastolic}`;
      return `<div class="vital"><span>${label} <small style="color:#16a34a">[device-captured]</small></span><strong>${val!=null?esc(val):'—'}</strong><em>${x!=null?unit:''}</em></div>`
    }).join('');

    const symptomsHtml=symptoms.length?symptoms.map(x=>`<div class="symptom"><strong>${esc((x.symptomName||'').replaceAll('_',' '))}</strong> <span>${x.severity ?? '—'}/10 <small style="color:#38bdf8">[patient-spoken]</small></span></div>`).join(''):'<p>No structured symptoms recorded.</p>';
    const rules=tri.triggeredRules||[];

    // Module 6 HPR Write-Lock & Sign-Off Section
    let hprSectionHtml = '';
    if (isVerified) {
      const sig = raw.hprSignatureBlock || {};
      hprSectionHtml = `
        <div class="signature-block">
          🔒 <strong>EHR RECORD LOCKED & VERIFIED WITH HPR BIOMETRIC SIGNATURE</strong><br />
          • Doctor: ${esc(sig.doctorName || 'Dr. Rajesh Sharma, MD')}<br />
          • HPR ID: ${esc(sig.hprId || 'HPR-IN-9876543210')}<br />
          • Timestamp: ${formatDate(sig.committedAt || raw.updatedAt)}<br />
          • Digital Signature: ${esc(sig.digitalSignature || 'SHA256:AUTHENTICATED_LOCKED')}<br />
          • Notes: ${esc(sig.doctorNotes || 'Verified and approved.')}
        </div>
      `;
    } else {
      hprSectionHtml = `
        <div class="hpr-panel">
          <div style="font-size:13px; font-weight:700; color:#38bdf8; margin-bottom:8px;">
            🔒 HPR Biometric Write-Lock Gatekeeper (Staff Sign-Off)
          </div>
          <div style="font-size:11px; color:#94a3b8; margin-bottom:10px;">
            This intake record is currently <strong>PROVISIONAL</strong>. Authenticate with Healthcare Professional Registry (HPR) credentials to lock and verify EHR.
          </div>
          <div class="hpr-grid">
            <input type="text" id="hprIdInput" class="hpr-input" value="HPR-IN-9876543210" placeholder="HPR ID" />
            <input type="text" id="docNameInput" class="hpr-input" value="Dr. Rajesh Sharma, MD" placeholder="Doctor Name" />
            <input type="text" id="docRegInput" class="hpr-input" value="MCI-2018-883921" placeholder="Registration No" />
            <input type="text" id="hprTokenInput" class="hpr-input" value="HPR_BEARER_DEMO_TOKEN" placeholder="HPR Token" />
          </div>
          <textarea id="doctorNotesInput" class="hpr-input" style="width:100%; box-sizing:border-box; margin-bottom:10px;" rows="2" placeholder="Enter clinical verification notes...">Verified patient vitals and symptoms. Approved for permanent EHR commit.</textarea>
          <button type="button" class="btn-commit" id="btnCommitRecord">🔒 Approve & Lock EHR Record (HPR Commit)</button>
        </div>
      `;
    }

    // Module 7 ABDM FHIR R4 Export Button
    const fhirExportHtml = `
      <button type="button" class="btn-fhir" id="btnExportFhir">
        📄 Export HL7 FHIR (R4) Bundle (.json)
      </button>
    `;

    $('#patient-panel').innerHTML=`
      <div class="patient-header">
        <div class="patient-title">
          <div>
            <h2>${esc(s.patientName || s.patientId || 'Anonymous patient')}</h2>
            <div class="patient-sub">Intake ${esc(s.sessionId)} · ABHA ${esc(s.patientId)} · Status: <strong>${isVerified?'VERIFIED_COMMITTED':'PROVISIONAL'}</strong></div>
          </div>
          <span class="badge ${l.toLowerCase()}">${l}</span>
        </div>
      </div>
      <div class="section"><div class="section-label">LATEST VITALS (PROVISIONAL / HARDWARE)</div><div class="vitals">${vitalHtml}</div></div>
      <div class="section"><div class="section-label">CHIEF COMPLAINTS & SYMPTOMS</div>${symptomsHtml}</div>
      <div class="section"><div class="section-label">CLINICAL DECISION & DISCREPANCIES</div><div class="reason">${esc(tri.reason||'No triage rationale available.')}</div></div>
      <div class="section"><div class="section-label">TRIGGERED RULES</div><div class="rules">${rules.length?rules.map(r=>`<span class="rule-chip ${l==='EMERGENCY'?'danger':''}">${esc(r)}</span>`).join(''):'<span class="rule-chip">No active rules</span>'}</div></div>
      <div class="section"><div class="section-label">HPR WRITE-LOCK VERIFICATION</div>${hprSectionHtml}</div>
      <div class="section"><div class="section-label">ABDM INTEROPERABILITY</div>${fhirExportHtml}</div>
      <div class="section"><div class="section-label">AUDIT TRAIL</div><div id="audit-list"><p>Loading audit trail…</p></div></div>`;

    loadAudit(s.sessionId);

    // Event Listener for HPR Commit Button
    if ($('#btnCommitRecord')) {
      $('#btnCommitRecord').addEventListener('click', async () => {
        const hprId = $('#hprIdInput').value.trim();
        const docName = $('#docNameInput').value.trim();
        const docReg = $('#docRegInput').value.trim();
        const hprToken = $('#hprTokenInput').value.trim();
        const doctorNotes = $('#doctorNotesInput').value.trim();

        try {
          // First provision token helper if demo
          await fetch('/api/v1/hpr/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hprId, doctorName: docName, registrationNumber: docReg })
          });

          // Perform Protected Commit
          const commitRes = await fetch('/api/v1/clinical/commit', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${hprToken}`
            },
            body: JSON.stringify({
              intakeId: s.sessionId,
              doctorNotes: doctorNotes
            })
          });

          const commitData = await commitRes.json();
          if (commitRes.ok && commitData.success) {
            toast('✓ Record successfully verified and write-locked with HPR digital signature!');
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

    // Event Listener for Export FHIR R4 Bundle Button
    if ($('#btnExportFhir')) {
      $('#btnExportFhir').addEventListener('click', async () => {
        try {
          const fhirRes = await fetch(`/api/v1/clinical/fhir/bundle/${encodeURIComponent(s.sessionId)}`);
          if (!fhirRes.ok) throw new Error(`HTTP error ${fhirRes.status}`);
          const fhirBundle = await fhirRes.json();

          // Trigger File Download in Browser
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
  }

  async function loadAudit(sessionId){
    try{
      const data=await api(`/api/events/session/${encodeURIComponent(sessionId)}/audit`);
      const entries=(data.auditTrail||[]).slice().reverse();
      const el=$('#audit-list');
      el.innerHTML=entries.length?entries.map(x=>`<div class="audit-entry"><div class="audit-time">${formatTime(x.timestamp)}</div><div class="audit-body"><strong>${esc(x.eventType)}</strong><p>${esc(x.reason)}</p></div></div>`).join(''):'<p>No audit records found.</p>';
    }catch(err){ if($('#audit-list')) $('#audit-list').innerHTML='<p>Audit trail unavailable.</p>'; }
  }

  function upsertSessionFromTriage(payload){
    const i=state.sessions.findIndex(s=>s.sessionId===payload.sessionId);
    const existing=i>=0?state.sessions[i]:{sessionId:payload.sessionId,patientId:payload.patientId || payload.triageResult?.patientId};
    if (payload.triageResult) existing.triageResult=payload.triageResult;
    existing.lastUpdated=payload.timestamp || new Date().toISOString();
    existing.status=payload.status || existing.status || 'PROVISIONAL';
    if(i>=0) state.sessions[i]=existing; else state.sessions.unshift(existing);
    renderStats();
    renderQueue();
    if(state.selected?.sessionId===payload.sessionId) selectSession(payload.sessionId,false);
  }

  function showEmergency(payload){
    $('#modal-title').textContent=`Emergency escalation · ${payload.patientId || payload.sessionId}`;
    $('#modal-reason').textContent=payload.reason||'An emergency triage condition has been detected.';
    $('#modal-rules').innerHTML=(payload.triggeredRules||[]).map(r=>`<span class="rule-chip danger">${esc(r)}</span>`).join('');
    $('#modal-meta').textContent=`Action: ${payload.action || 'IMMEDIATE_DOCTOR_ALERT'} · ${formatDate(payload.timestamp)}`;
    $('#alert-modal').classList.remove('hidden');
    toast('Emergency escalation received from triage engine.');
  }

  function connectSocket(){
    if(typeof io==='undefined'){ $('#connection-text').textContent='Socket client unavailable'; return; }
    state.socket=io({transports:['websocket','polling']});
    const dot=$('#connection-dot').parentElement;
    state.socket.on('connect',()=>{
      dot.classList.add('online');
      $('#connection-text').textContent='Live connection';
      state.socket.emit('JOIN_DASHBOARD',{},()=>{});
      toast('Live triage stream connected.');
    });
    state.socket.on('disconnect',()=>{dot.classList.remove('online');$('#connection-text').textContent='Disconnected';});
    state.socket.on('connect_error',()=>{dot.classList.remove('online');$('#connection-text').textContent='Connection retrying…';});
    state.socket.on('TRIAGE_UPDATED',payload=>upsertSessionFromTriage(payload));
    state.socket.on('PATIENT_EVENT_RECEIVED',payload=>{
      toast(`New intake received: ${payload.sessionId}`);
      loadSessions();
    });
    state.socket.on('ESCALATION_REQUIRED',payload=>{
      upsertSessionFromTriage({sessionId:payload.sessionId,triageResult:{...payload,triageLevel:'EMERGENCY'}});
      showEmergency(payload);
    });
    state.socket.on('RED_FLAG_DETECTED',payload=>{ if(payload.currentLevel==='URGENT') toast(`Urgent red flag: ${payload.sessionId}`); });
  }

  document.querySelectorAll('.filter').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));btn.classList.add('active');state.filter=btn.dataset.filter;renderQueue()}));
  $('#refresh-btn').addEventListener('click',loadSessions);
  $('#modal-close').addEventListener('click',()=>$('#alert-modal').classList.add('hidden'));
  $('#alert-modal').addEventListener('click',e=>{if(e.target.id==='alert-modal') $('#alert-modal').classList.add('hidden')});
  $('#seed-btn').addEventListener('click',async()=>{
    try{ await api('/api/events/demo/seed',{method:'POST'}); await loadSessions(); toast('Demo encounters loaded.'); }catch(err){toast(`Demo seed failed: ${err.message}`)}
  });

  connectSocket();
  loadSessions();
})();
