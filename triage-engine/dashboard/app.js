(() => {
  const API = '';
  const state = { sessions: [], selected: null, filter: 'ALL', socket: null };
  const $ = (s) => document.querySelector(s);
  const esc = (v='') => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const level = (s) => (s?.triageResult?.triageLevel || 'ROUTINE').toUpperCase();
  const formatTime = (iso) => iso ? new Date(iso).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—';
  const formatDate = (iso) => iso ? new Date(iso).toLocaleString([], {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—';

  function toast(message){ const el=document.createElement('div'); el.className='toast'; el.textContent=message; $('#toast-root').appendChild(el); setTimeout(()=>el.remove(),3500); }

  async function api(path, options){
    const res = await fetch(API + path, options);
    const data = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  async function loadSessions(){
    try {
      const data = await api('/api/events/sessions');
      state.sessions = data.sessions || [];
      renderStats(); renderQueue();
      if(state.selected){
        const exists = state.sessions.find(s => s.sessionId === state.selected.sessionId);
        if(exists) await selectSession(exists.sessionId, false);
      }
    } catch(err){ toast(`Unable to load queue: ${err.message}`); }
  }

  function renderStats(){
    const counts={EMERGENCY:0,URGENT:0,ROUTINE:0}; state.sessions.forEach(s=>counts[level(s)]++);
    $('#stat-total').textContent=state.sessions.length; $('#stat-emergency').textContent=counts.EMERGENCY; $('#stat-urgent').textContent=counts.URGENT; $('#stat-routine').textContent=counts.ROUTINE;
  }

  function renderQueue(){
    const list=state.sessions.filter(s=>state.filter==='ALL'||level(s)===state.filter).sort((a,b)=>{
      const rank={EMERGENCY:0,URGENT:1,ROUTINE:2}; return rank[level(a)]-rank[level(b)] || new Date(b.lastUpdated)-new Date(a.lastUpdated);
    });
    $('#queue-meta').textContent=`${list.length} patient${list.length===1?'':'s'}`;
    if(!list.length){ $('#queue').innerHTML='<div class="empty-queue">No encounters match this filter.</div>'; return; }
    $('#queue').innerHTML=list.map(s=>{
      const l=level(s), symptom=s.symptoms?.primary?.symptomName?.replaceAll('_',' ') || 'Clinical intake in progress';
      const selected=state.selected?.sessionId===s.sessionId?' selected':'';
      return `<button class="queue-card${selected}" data-session="${esc(s.sessionId)}">
        <i class="priority-bar ${l.toLowerCase()}"></i>
        <div><div class="patient-name">${esc(s.patientId || 'Anonymous patient')}</div><div class="patient-id">${esc(s.sessionId)}</div><div class="symptom-line">${esc(symptom)}${s.symptoms?.primary?.severity!=null?` · ${s.symptoms.primary.severity}/10`:''}</div></div>
        <div><span class="badge ${l.toLowerCase()}">${l}</span><div class="queue-time">${formatTime(s.lastUpdated)}</div></div>
      </button>`;
    }).join('');
    document.querySelectorAll('.queue-card').forEach(el=>el.addEventListener('click',()=>selectSession(el.dataset.session)));
  }

  async function selectSession(sessionId, rerender=true){
    try{
      const data=await api(`/api/events/session/${encodeURIComponent(sessionId)}`);
      state.selected=data.session; renderPatient(); if(rerender) renderQueue();
    }catch(err){toast(`Unable to open encounter: ${err.message}`)}
  }

  function renderPatient(){
    const s=state.selected; if(!s){ return; }
    const l=level(s), tri=s.triageResult || {}, v=s.vitals||{}, symptoms=s.symptoms?.list||[];
    const vitals=[['HR','HEART_RATE','bpm'],['SpO₂','SPO2','%'],['BP','BLOOD_PRESSURE','mmHg'],['Temp','TEMPERATURE','°'],['Resp','RESPIRATORY_RATE','/min'],['Glucose','BLOOD_GLUCOSE','mg/dL']];
    const vitalHtml=vitals.map(([label,key,unit])=>{const x=v[key]?.value; let val=x; if(x&&typeof x==='object') val=`${x.systolic}/${x.diastolic}`; return `<div class="vital"><span>${label}</span><strong>${val!=null?esc(val):'—'}</strong><em>${x!=null?unit:''}</em></div>`}).join('');
    const symptomsHtml=symptoms.length?symptoms.map(x=>`<div class="symptom"><strong>${esc((x.symptomName||'').replaceAll('_',' '))}</strong><span>${esc(x.site||'')} · ${x.severity ?? '—'}/10</span></div>`).join(''):'<p>No structured symptoms recorded.</p>';
    const rules=tri.triggeredRules||[];
    $('#patient-panel').innerHTML=`
      <div class="patient-header"><div class="patient-title"><div><h2>${esc(s.patientId||'Anonymous patient')}</h2><div class="patient-sub">Session ${esc(s.sessionId)} · Last updated ${formatDate(s.lastUpdated)}</div></div><span class="badge ${l.toLowerCase()}">${l}</span></div></div>
      <div class="section"><div class="section-label">LATEST VITALS</div><div class="vitals">${vitalHtml}</div></div>
      <div class="section"><div class="section-label">SYMPTOMS</div>${symptomsHtml}</div>
      <div class="section"><div class="section-label">CLINICAL DECISION</div><div class="reason">${esc(tri.reason||'No triage rationale available.')}</div></div>
      <div class="section"><div class="section-label">TRIGGERED RULES</div><div class="rules">${rules.length?rules.map(r=>`<span class="rule-chip ${l==='EMERGENCY'?'danger':''}">${esc(r)}</span>`).join(''):'<span class="rule-chip">No active rules</span>'}</div></div>
      <div class="section"><div class="section-label">RECOMMENDED ACTION</div><strong style="font-size:12px">${esc(tri.action||'—')}</strong></div>
      <div class="section"><div class="section-label">AUDIT TRAIL</div><div id="audit-list"><p>Loading audit trail…</p></div></div>`;
    loadAudit(s.sessionId);
  }

  async function loadAudit(sessionId){
    try{ const data=await api(`/api/events/session/${encodeURIComponent(sessionId)}/audit`); const entries=(data.auditTrail||[]).slice().reverse(); const el=$('#audit-list'); el.innerHTML=entries.length?entries.map(x=>`<div class="audit-entry"><div class="audit-time">${formatTime(x.timestamp)}</div><div class="audit-body"><strong>${esc(x.eventType)} · ${esc(x.currentLevel)}</strong><p>${esc(x.reason)}</p></div></div>`).join(''):'<p>No audit records found.</p>'; }catch(err){ if($('#audit-list')) $('#audit-list').innerHTML='<p>Audit trail unavailable.</p>'; }
  }

  function upsertSessionFromTriage(payload){
    const i=state.sessions.findIndex(s=>s.sessionId===payload.sessionId); const existing=i>=0?state.sessions[i]:{sessionId:payload.sessionId,patientId:payload.triageResult.patientId};
    existing.triageResult=payload.triageResult; existing.lastUpdated=payload.triageResult.timestamp; existing.status=level(payload)==='EMERGENCY'?'ESCALATED':'TRIAGED';
    if(i>=0) state.sessions[i]=existing; else state.sessions.unshift(existing); renderStats(); renderQueue();
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
    state.socket.on('connect',()=>{dot.classList.add('online');$('#connection-text').textContent='Live connection';state.socket.emit('JOIN_DASHBOARD',{},()=>{});toast('Live triage stream connected.');});
    state.socket.on('disconnect',()=>{dot.classList.remove('online');$('#connection-text').textContent='Disconnected';});
    state.socket.on('connect_error',()=>{dot.classList.remove('online');$('#connection-text').textContent='Connection retrying…';});
    state.socket.on('TRIAGE_UPDATED',payload=>upsertSessionFromTriage(payload));
    state.socket.on('ESCALATION_REQUIRED',payload=>{upsertSessionFromTriage({sessionId:payload.sessionId,triageResult:{...payload,triageLevel:'EMERGENCY',patientId:payload.patientId,triggeredRules:payload.triggeredRules,action:payload.action,reason:payload.reason,timestamp:payload.timestamp}});showEmergency(payload);});
    state.socket.on('RED_FLAG_DETECTED',payload=>{ if(payload.currentLevel==='URGENT') toast(`Urgent red flag: ${payload.sessionId}`); });
    state.socket.on('RULE_TRIGGERED',payload=>{ if(payload.newlyTriggeredRules?.length) toast(`Rule triggered: ${payload.newlyTriggeredRules.join(', ')}`); });
  }

  document.querySelectorAll('.filter').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));btn.classList.add('active');state.filter=btn.dataset.filter;renderQueue()}));
  $('#refresh-btn').addEventListener('click',loadSessions);
  $('#modal-close').addEventListener('click',()=>$('#alert-modal').classList.add('hidden'));
  $('#alert-modal').addEventListener('click',e=>{if(e.target.id==='alert-modal') $('#alert-modal').classList.add('hidden')});
  $('#seed-btn').addEventListener('click',async()=>{
    try{ await api('/api/events/demo/seed',{method:'POST'}); await loadSessions(); toast('Demo encounters loaded.'); }catch(err){toast(`Demo seed failed: ${err.message}`)}
  });
  document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));btn.classList.add('active');
    if(btn.dataset.view==='alerts'){state.filter='EMERGENCY';document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x.dataset.filter==='EMERGENCY'));renderQueue()}
    if(btn.dataset.view==='queue'){state.filter='ALL';document.querySelectorAll('.filter').forEach(x=>x.classList.toggle('active',x.dataset.filter==='ALL'));renderQueue()}
    if(btn.dataset.view==='audit' && state.selected) loadAudit(state.selected.sessionId);
  }));

  connectSocket(); loadSessions();
})();
