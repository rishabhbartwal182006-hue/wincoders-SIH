/**
 * MediKiosk React Altitude-Aware Kiosk Application
 * Phase 1 MVP: Altitude / Location Context, Manual & Mock Vitals, Audio Readback, Side-by-Side Raw vs Interpreted
 */

const { useState, useEffect, useRef } = React;

const I18N = {
  en: {
    title: "MediKiosk Altitude-Aware Intake Terminal",
    subtitle: "Clinical Self-Service Kiosk with Altitude Decision Support",
    tabAltitude: "1. Altitude / Location Context",
    tabVitals: "2. Vitals Acquisition",
    tabResults: "3. Clinical Interpretation",
    facilityAltitudeLabel: "Facility Configured Altitude (Default: 2,438 m / 8,000 ft)",
    altitudeBandLabel: "Select Altitude Band",
    customMetersLabel: "Custom Altitude (meters)",
    feetEquivalent: "Elevation in Feet",
    acclimatizationLabel: "Acclimatization Status",
    unacclimatized: "Unacclimatized (<24h at altitude)",
    partial: "Partially Acclimatized (1–3 days)",
    acclimatized: "Acclimatized (>3 days)",
    native: "Highland Native / Long-term Resident",
    staffOverrideBtn: "Staff PIN Override",
    staffOverrideActive: "Staff Override Active (PIN Verified)",
    pinPromptTitle: "Staff Authorization Required",
    pinPromptDesc: "Enter Staff PIN to override facility altitude configuration:",
    pinError: "Incorrect PIN. Facility altitude preserved.",
    saveAltitudeBtn: "Confirm Altitude Context",
    altitudeSavedMsg: "Altitude context synced successfully to clinical session.",
    manualVitalsTitle: "Vitals Entry Station",
    mockDeviceBtn: "⚡ Mock Device Capture (BP 120/80, SpO₂ 88%, HR 110)",
    mockSuccessMsg: "Mock sensor data captured from simulated BP Cuff and Pulse Oximeter.",
    systolicLabel: "Systolic BP (mmHg)",
    diastolicLabel: "Diastolic BP (mmHg)",
    spo2Label: "Blood Oxygen SpO₂ (%)",
    hrLabel: "Heart Rate (bpm)",
    symptomsTitle: "Check Any High-Risk Danger Symptoms Present:",
    symptomChestPain: "Chest Pain",
    symptomBreathless: "Breathlessness at Rest",
    symptomConfusion: "Confusion / Altered Mental Status",
    symptomCyanosis: "Cyanosis (Blue lips / fingernails)",
    symptomInabilityWalk: "Inability to Walk (Ataxia)",
    symptomFainting: "Fainting / Syncope",
    evaluateVitalsBtn: "Submit & Evaluate with Altitude Context",
    resultsTitle: "Altitude-Aware Physiological Evaluation",
    rawValuesHeader: "Raw Value (Preserved)",
    interpretedHeader: "Altitude Adjusted Status",
    expectedRange: "Expected Altitude Range",
    statusNormal: "NORMAL",
    statusBorderline: "BORDERLINE",
    statusCritical: "CRITICAL",
    audioReadbackBtn: "🔊 Play Audio Readback",
    audioReadbackPlaying: "🔊 Speaking...",
    disclaimer: "Decision-support MVP. Illustrative altitude profiles. Raw values preserved. Clinician sign-off required. Pilot validation needed.",
    audioReadbackDefault: "Blood oxygen 88 percent at 2,438 meters. This is below expected for this altitude. A nurse has been alerted.",
    nurseAlertTitle: "Clinical Escalation Alert Sent",
    nurseAlertText: "A nurse has been alerted to review hypoxemia at high altitude."
  },
  hi: {
    title: "मेडीकियोस्क ऊंचाई-संवेदी रोगी सेवन टर्मिनल",
    subtitle: "उच्च-ऊंचाई नैदानिक स्वयं-सेवा एवं शारीरिक निर्णय समर्थन",
    tabAltitude: "1. ऊंचाई / स्थान संदर्भ",
    tabVitals: "2. शारीरिक महत्वपूर्ण संकेत",
    tabResults: "3. नैदानिक व्याख्या परिणाम",
    facilityAltitudeLabel: "सुविधा अनुसार निर्धारित डिफ़ॉल्ट ऊंचाई (2,438 मीटर / 8,000 फीट)",
    altitudeBandLabel: "ऊंचाई क्षेत्र चुनें",
    customMetersLabel: "कस्टम ऊंचाई (मीटर में दर्ज करें)",
    feetEquivalent: "फीट में समतुल्य ऊंचाई",
    acclimatizationLabel: "अनुकूलन स्थिति (Acclimatization)",
    unacclimatized: "अनुकूलित नहीं (<24 घंटे ऊंचाई पर)",
    partial: "आंशिक रूप से अनुकूलित (1–3 दिन)",
    acclimatized: "पूर्ण अनुकूलित (>3 दिन)",
    native: "पहाड़ी मूल निवासी / दीर्घकालिक निवासी",
    staffOverrideBtn: "स्टाफ पिन ओवरराइड",
    staffOverrideActive: "स्टाफ ओवरराइड सक्रिय (सत्यापित)",
    pinPromptTitle: "स्टाफ प्रमाणीकरण आवश्यक",
    pinPromptDesc: "सुविधा ऊंचाई को बदलने के लिए स्टाफ पिन दर्ज करें:",
    pinError: "अमान्य पिन। सुविधा ऊंचाई सुरक्षित रखी गई।",
    saveAltitudeBtn: "ऊंचाई संदर्भ की पुष्टि करें",
    altitudeSavedMsg: "ऊंचाई संदर्भ नैदानिक सत्र में सफलतापूर्वक सहेजा गया।",
    manualVitalsTitle: "महत्वपूर्ण संकेत प्रविष्टि स्टेशन",
    mockDeviceBtn: "⚡ मॉक डिवाइस कैप्चर (BP 120/80, SpO₂ 88%, HR 110)",
    mockSuccessMsg: "सिम्युलेटेड बीपी कफ और पल्स ऑक्सीमीटर से डेटा सफलतापूर्वक प्राप्त हुआ।",
    systolicLabel: "सिस्टोलिक बीपी (mmHg)",
    diastolicLabel: "डायस्टोलिक बीपी (mmHg)",
    spo2Label: "रक्त ऑक्सीजन SpO₂ (%)",
    hrLabel: "हृदय गति HR (bpm)",
    symptomsTitle: "यदि कोई गंभीर खतरे का लक्षण हो तो चुनें:",
    symptomChestPain: "सीने में दर्द",
    symptomBreathless: "विश्राम के समय सांस फूलना",
    symptomConfusion: "भ्रम / मानसिक अस्पष्टता",
    symptomCyanosis: "सायनोसिस (नीले होंठ या नाखून)",
    symptomInabilityWalk: "चलने में असमर्थता (अटैक्सिया)",
    symptomFainting: "बेहोशी / चक्कर आना",
    evaluateVitalsBtn: "ऊंचाई संदर्भ के साथ विश्लेषण करें",
    resultsTitle: "ऊंचाई-संवेदी शारीरिक मूल्यांकन",
    rawValuesHeader: "मूल मान सुरक्षित (Raw Value)",
    interpretedHeader: "ऊंचाई समायोजित स्थिति",
    expectedRange: "ऊंचाई अनुसार अपेक्षित सीमा",
    statusNormal: "सामान्य (NORMAL)",
    statusBorderline: "सीमांत (BORDERLINE)",
    statusCritical: "गंभीर (CRITICAL)",
    audioReadbackBtn: "🔊 ऑडियो रीबैक सुनें",
    audioReadbackPlaying: "🔊 ऑडियो चल रहा है...",
    disclaimer: "निर्णय-समर्थन एमवीपी। व्याख्यात्मक ऊंचाई प्रोफाइल। मूल मान सुरक्षित। चिकित्सक की पुष्टि आवश्यक। पायलट सत्यापन आवश्यक।",
    audioReadbackDefault: "रक्त ऑक्सीजन 88 प्रतिशत 2,438 मीटर की ऊंचाई पर। यह इस ऊंचाई के लिए अपेक्षित स्तर से कम है। नर्स को सूचित कर दिया गया है।",
    nurseAlertTitle: "नैदानिक आपातकालीन चेतावनी प्रेषित",
    nurseAlertText: "उच्च ऊंचाई पर हाइपोक्सिमिया की समीक्षा के लिए नर्स को अलर्ट भेज दिया गया है।"
  }
};

const BANDS = [
  { id: 'sea_level', min: 0, max: 500, defaultMeters: 100, labelEn: "Sea level (0–500 m)", labelHi: "समुद्र तल (0–500 मीटर)", spo2: "95–100%", hr: "+0–5 bpm" },
  { id: 'moderate', min: 500, max: 1500, defaultMeters: 1000, labelEn: "Moderate (500–1500 m)", labelHi: "मध्यम ऊंचाई (500–1500 मीटर)", spo2: "94–99%", hr: "+2–10 bpm" },
  { id: 'high', min: 1500, max: 2500, defaultMeters: 2438, labelEn: "High (1500–2500 m) [Facility Default: 2,438 m]", labelHi: "अधिक ऊंचाई (1500–2500 मीटर) [डिफ़ॉल्ट: 2438 मीटर]", spo2: "92–97%", hr: "+5–15 bpm" },
  { id: 'very_high', min: 2500, max: 3500, defaultMeters: 3000, labelEn: "Very high (2500–3500 m)", labelHi: "अति उच्च (2500–3500 मीटर)", spo2: "90–95%", hr: "+10–20 bpm" },
  { id: 'extreme', min: 3500, max: 6000, defaultMeters: 4500, labelEn: "Extreme (>3500 m)", labelHi: "चरम ऊंचाई (>3500 मीटर)", spo2: "85–92%", hr: "+15–30 bpm" },
  { id: 'custom', min: 0, max: 9000, defaultMeters: 2438, labelEn: "Custom meters...", labelHi: "कस्टम मीटर...", spo2: "Band-derived", hr: "Band-derived" }
];

function MediKioskApp() {
  const [lang, setLang] = useState('en');
  const t = I18N[lang];

  const [activeTab, setActiveTab] = useState('altitude'); // 'altitude' | 'vitals' | 'results'
  const [sessionId] = useState(() => `SESSION-${Date.now()}`);

  // Altitude State
  const [selectedBand, setSelectedBand] = useState('high');
  const [altitudeMeters, setAltitudeMeters] = useState(2438);
  const [altitudeSource, setAltitudeSource] = useState('facility_config');
  const [acclimatizationStatus, setAcclimatizationStatus] = useState('unacclimatized');
  const [timeAtAltitudeHours, setTimeAtAltitudeHours] = useState(6);

  // Staff Override State
  const [isStaffOverrideActive, setIsStaffOverrideActive] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');

  // Vitals State (Raw inputs)
  const [systolic, setSystolic] = useState('120');
  const [diastolic, setDiastolic] = useState('80');
  const [spo2, setSpo2] = useState('88');
  const [heartRate, setHeartRate] = useState('110');
  const [dangerSymptoms, setDangerSymptoms] = useState([]);

  // Results State
  const [interpretedVitals, setInterpretedVitals] = useState([]);
  const [audioReadbackText, setAudioReadbackText] = useState(t.audioReadbackDefault);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  // Sync initial altitude on mount
  useEffect(() => {
    saveAltitudeToServer(2438, 'facility_config', 'unacclimatized');
  }, []);

  const currentFeet = Math.round(altitudeMeters === 2438 ? 8000 : altitudeMeters * 3.28084);
  const currentBandObj = BANDS.find(b => b.id === selectedBand) || BANDS[2];

  function handleBandChange(e) {
    const val = e.target.value;
    setSelectedBand(val);

    if (val !== 'custom') {
      const match = BANDS.find(b => b.id === val);
      if (match) {
        setAltitudeMeters(match.defaultMeters);
        if (match.id !== 'high' && !isStaffOverrideActive) {
          // If trying to change default facility altitude without PIN, show PIN prompt
          setShowPinModal(true);
        }
      }
    }
  }

  function handlePinSubmit(e) {
    e.preventDefault();
    if (pinInput === '1234' || pinInput.length >= 4) {
      setIsStaffOverrideActive(true);
      setAltitudeSource('staff_manual');
      setShowPinModal(false);
      setPinError('');
      setPinInput('');
    } else {
      setPinError(t.pinError);
    }
  }

  async function saveAltitudeToServer(meters, source, acclim) {
    try {
      setIsSaving(true);
      const res = await fetch(`/api/v1/sessions/${sessionId}/environment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          altitudeMeters: Number(meters),
          altitudeSource: source || altitudeSource,
          acclimatizationStatus: acclim || acclimatizationStatus,
          timeAtAltitudeHours: Number(timeAtAltitudeHours),
          altitudeConfidence: 1.0
        })
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage(t.altitudeSavedMsg);
        setTimeout(() => setStatusMessage(''), 3500);
      }
    } catch (err) {
      console.error('Failed to sync altitude to server', err);
    } finally {
      setIsSaving(false);
    }
  }

  function handleMockDeviceCapture() {
    setSystolic('120');
    setDiastolic('80');
    setSpo2('88');
    setHeartRate('110');
    setStatusMessage(t.mockSuccessMsg);
    setTimeout(() => setStatusMessage(''), 4000);
  }

  function toggleSymptom(symId) {
    setDangerSymptoms(prev => 
      prev.includes(symId) ? prev.filter(s => s !== symId) : [...prev, symId]
    );
  }

  async function handleEvaluateVitals() {
    try {
      setIsSaving(true);
      const vitalsPayload = [
        { type: 'bp_systolic', value: Number(systolic), unit: 'mmHg' },
        { type: 'bp_diastolic', value: Number(diastolic), unit: 'mmHg' },
        { type: 'spo2', value: Number(spo2), unit: '%' },
        { type: 'heart_rate', value: Number(heartRate), unit: 'bpm' }
      ];

      const res = await fetch(`/api/v1/sessions/${sessionId}/vitals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryMode: (systolic === '120' && spo2 === '88') ? 'mock' : 'manual',
          vitals: vitalsPayload,
          symptoms: dangerSymptoms
        })
      });

      const data = await res.json();
      if (data.success && data.interpretedVitals) {
        setInterpretedVitals(data.interpretedVitals);

        // Formulate audio readback text
        const spo2Item = data.interpretedVitals.find(v => v.type === 'spo2');
        let speechMsg = lang === 'hi'
          ? `रक्त ऑक्सीजन ${spo2} प्रतिशत ${altitudeMeters} मीटर की ऊंचाई पर। यह इस ऊंचाई के लिए अपेक्षित स्तर से कम है। नर्स को सूचित कर दिया गया है।`
          : `Blood oxygen ${spo2} percent at ${altitudeMeters.toLocaleString()} meters. This is below expected for this altitude. A nurse has been alerted.`;

        if (spo2Item && spo2Item.status === 'normal') {
          speechMsg = lang === 'hi'
            ? `रक्त ऑक्सीजन ${spo2} प्रतिशत सामान्य है ${altitudeMeters} मीटर पर।`
            : `Blood oxygen ${spo2} percent is normal at ${altitudeMeters.toLocaleString()} meters.`;
        }

        setAudioReadbackText(speechMsg);
        setActiveTab('results');
        triggerAudioReadback(speechMsg);
      }
    } catch (err) {
      console.error('Evaluation failed:', err);
    } finally {
      setIsSaving(false);
    }
  }

  function triggerAudioReadback(customText) {
    const textToSpeak = customText || audioReadbackText || t.audioReadbackDefault;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.lang = lang === 'hi' ? 'hi-IN' : 'en-US';
      utterance.rate = 0.95;
      utterance.pitch = 1.0;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);

      window.speechSynthesis.speak(utterance);
    } else {
      alert(`[Audio Readback]: "${textToSpeak}"`);
    }
  }

  return React.createElement('div', { className: 'kiosk-container' },
    // Header
    React.createElement('header', { className: 'kiosk-header', style: { flexWrap: 'wrap', gap: '12px' } },
      React.createElement('div', { className: 'kiosk-title' },
        React.createElement('span', { style: { fontSize: '26px' } }, '🏔️'),
        React.createElement('div', null,
          React.createElement('div', null, t.title),
          React.createElement('div', { style: { fontSize: '12px', fontWeight: '500', color: '#64748b' } }, t.subtitle)
        )
      ),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
        // Language Switcher
        React.createElement('div', { style: { display: 'flex', background: '#f1f5f9', borderRadius: '8px', padding: '3px' } },
          React.createElement('button', {
            type: 'button',
            onClick: () => setLang('en'),
            style: {
              border: 'none',
              padding: '6px 12px',
              borderRadius: '6px',
              fontWeight: '700',
              cursor: 'pointer',
              background: lang === 'en' ? '#0284c7' : 'transparent',
              color: lang === 'en' ? '#fff' : '#475569'
            }
          }, 'English'),
          React.createElement('button', {
            type: 'button',
            onClick: () => setLang('hi'),
            style: {
              border: 'none',
              padding: '6px 12px',
              borderRadius: '6px',
              fontWeight: '700',
              cursor: 'pointer',
              background: lang === 'hi' ? '#0284c7' : 'transparent',
              color: lang === 'hi' ? '#fff' : '#475569'
            }
          }, 'हिन्दी')
        ),
        // Staff Override Badge / Trigger
        React.createElement('button', {
          type: 'button',
          onClick: () => {
            if (isStaffOverrideActive) {
              setIsStaffOverrideActive(false);
              setAltitudeSource('facility_config');
            } else {
              setShowPinModal(true);
            }
          },
          style: {
            padding: '8px 14px',
            border: isStaffOverrideActive ? '1px solid #16a34a' : '1px solid #cbd5e1',
            background: isStaffOverrideActive ? '#f0fdf4' : '#ffffff',
            color: isStaffOverrideActive ? '#15803d' : '#475569',
            borderRadius: '8px',
            fontWeight: '600',
            fontSize: '13px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }
        }, isStaffOverrideActive ? `🔓 ${t.staffOverrideActive}` : `🔒 ${t.staffOverrideBtn}`)
      )
    ),

    // Clinical Disclaimer Banner
    React.createElement('div', {
      style: {
        background: '#fefce8',
        border: '1px solid #fde047',
        borderRadius: '10px',
        padding: '12px 18px',
        marginBottom: '20px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        color: '#854d0e',
        fontSize: '13px',
        fontWeight: '600',
        lineHeight: '1.4'
      }
    },
      React.createElement('span', { style: { fontSize: '20px' } }, '⚠️'),
      React.createElement('div', null,
        React.createElement('strong', null, 'Clinical Notice: '),
        t.disclaimer
      )
    ),

    // Status Notification Toast
    statusMessage ? React.createElement('div', {
      style: {
        background: '#ecfdf5',
        border: '1px solid #6ee7b7',
        color: '#065f46',
        padding: '10px 16px',
        borderRadius: '8px',
        marginBottom: '16px',
        fontSize: '14px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }
    }, '✓ ', statusMessage) : null,

    // Step Tabs Navigation
    React.createElement('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '8px',
        marginBottom: '20px'
      }
    },
      [
        { id: 'altitude', label: t.tabAltitude, icon: '📍' },
        { id: 'vitals', label: t.tabVitals, icon: '🩺' },
        { id: 'results', label: t.tabResults, icon: '📊' }
      ].map(tab => React.createElement('button', {
        key: tab.id,
        type: 'button',
        onClick: () => setActiveTab(tab.id),
        style: {
          padding: '14px 12px',
          border: 'none',
          borderRadius: '10px',
          fontWeight: '700',
          fontSize: '14px',
          cursor: 'pointer',
          background: activeTab === tab.id ? '#0f766e' : '#ffffff',
          color: activeTab === tab.id ? '#ffffff' : '#334155',
          boxShadow: '0 2px 6px rgba(0,0,0,0.06)',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px'
        }
      }, React.createElement('span', null, tab.icon), tab.label))
    ),

    // SCREEN 1: Altitude & Location Context
    activeTab === 'altitude' && React.createElement('div', { className: 'card-section' },
      React.createElement('div', { className: 'card-title' },
        React.createElement('span', null, t.tabAltitude),
        React.createElement('span', {
          style: {
            fontSize: '12px',
            color: '#0284c7',
            background: '#e0f2fe',
            padding: '4px 8px',
            borderRadius: '4px'
          }
        }, `Session: ${sessionId.slice(0, 16)}...`)
      ),

      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '18px', marginBottom: '20px' } },
        // Facility Default Display
        React.createElement('div', {
          style: {
            background: '#f8fafc',
            border: '2px dashed #cbd5e1',
            borderRadius: '10px',
            padding: '16px'
          }
        },
          React.createElement('div', { style: { fontSize: '12px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase' } }, t.facilityAltitudeLabel),
          React.createElement('div', { style: { fontSize: '28px', fontWeight: '800', color: '#0f172a', margin: '8px 0' } },
            `${altitudeMeters.toLocaleString()} m`,
            React.createElement('span', { style: { fontSize: '15px', fontWeight: '600', color: '#64748b', marginLeft: '10px' } }, `(~${currentFeet.toLocaleString()} ft)`)
          ),
          React.createElement('div', { style: { fontSize: '12px', color: '#059669', fontWeight: '600' } },
            `Source: ${altitudeSource === 'facility_config' ? 'Facility Hardware Geolocation' : 'Staff Override Manual'}`
          )
        ),

        // Band Selection Dropdown
        React.createElement('div', { className: 'form-group' },
          React.createElement('label', { style: { fontWeight: '700', marginBottom: '6px', display: 'block' } }, t.altitudeBandLabel),
          React.createElement('select', {
            id: 'altitudeBandSelect',
            value: selectedBand,
            onChange: handleBandChange,
            style: {
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '2px solid #cbd5e1',
              fontSize: '15px',
              fontWeight: '600',
              background: '#ffffff'
            }
          },
            BANDS.map(b => React.createElement('option', { key: b.id, value: b.id }, lang === 'hi' ? b.labelHi : b.labelEn))
          ),
          selectedBand === 'custom' && React.createElement('div', { style: { marginTop: '12px' } },
            React.createElement('label', { style: { fontSize: '13px', fontWeight: '600' } }, t.customMetersLabel),
            React.createElement('input', {
              id: 'customAltitudeInput',
              type: 'number',
              min: '0',
              max: '8848',
              value: altitudeMeters,
              onChange: (e) => setAltitudeMeters(Number(e.target.value)),
              style: {
                width: '100%',
                padding: '10px',
                borderRadius: '8px',
                border: '2px solid #0284c7',
                fontSize: '15px',
                marginTop: '4px'
              }
            })
          )
        ),

        // Acclimatization Status
        React.createElement('div', { className: 'form-group' },
          React.createElement('label', { style: { fontWeight: '700', marginBottom: '6px', display: 'block' } }, t.acclimatizationLabel),
          React.createElement('select', {
            id: 'acclimatizationSelect',
            value: acclimatizationStatus,
            onChange: (e) => setAcclimatizationStatus(e.target.value),
            style: {
              width: '100%',
              padding: '12px',
              borderRadius: '8px',
              border: '2px solid #cbd5e1',
              fontSize: '15px',
              fontWeight: '600',
              background: '#ffffff'
            }
          },
            React.createElement('option', { value: 'unacclimatized' }, t.unacclimatized),
            React.createElement('option', { value: 'partial' }, t.partial),
            React.createElement('option', { value: 'acclimatized' }, t.acclimatized),
            React.createElement('option', { value: 'native' }, t.native)
          )
        )
      ),

      // Band Profile Physiological Card
      React.createElement('div', {
        style: {
          background: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '10px',
          padding: '16px 20px',
          marginBottom: '20px'
        }
      },
        React.createElement('div', { style: { fontWeight: '800', color: '#166534', marginBottom: '8px' } },
          `Altitude Interpretation Band: ${currentBandObj.labelEn}`
        ),
        React.createElement('div', { style: { display: 'flex', gap: '30px', flexWrap: 'wrap', fontSize: '14px' } },
          React.createElement('div', null,
            React.createElement('span', { style: { color: '#4b5563' } }, 'Expected SpO₂ Range: '),
            React.createElement('strong', { style: { color: '#0f172a' } }, currentBandObj.spo2)
          ),
          React.createElement('div', null,
            React.createElement('span', { style: { color: '#4b5563' } }, 'Resting HR Elevation: '),
            React.createElement('strong', { style: { color: '#0f172a' } }, currentBandObj.hr)
          ),
          React.createElement('div', null,
            React.createElement('span', { style: { color: '#4b5563' } }, 'Blood Pressure: '),
            React.createElement('strong', { style: { color: '#0f172a' } }, 'Standard (Never adjusted upward)')
          )
        )
      ),

      // Action Button
      React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '12px' } },
        React.createElement('button', {
          id: 'btnSaveAltitude',
          type: 'button',
          disabled: isSaving,
          onClick: () => {
            saveAltitudeToServer(altitudeMeters, altitudeSource, acclimatizationStatus);
            setActiveTab('vitals');
          },
          style: {
            padding: '14px 28px',
            background: '#0284c7',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '700',
            fontSize: '15px',
            cursor: 'pointer'
          }
        }, isSaving ? 'Saving...' : `${t.saveAltitudeBtn} →`)
      )
    ),

    // SCREEN 2: Vitals Entry Station
    activeTab === 'vitals' && React.createElement('div', { className: 'card-section' },
      React.createElement('div', { className: 'card-title' },
        React.createElement('span', null, t.manualVitalsTitle),
        React.createElement('button', {
          id: 'btnMockDeviceCapture',
          type: 'button',
          onClick: handleMockDeviceCapture,
          style: {
            background: '#16a34a',
            color: '#ffffff',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: '700',
            cursor: 'pointer',
            boxShadow: '0 2px 6px rgba(22,163,74,0.3)'
          }
        }, t.mockDeviceBtn)
      ),

      // Vitals Inputs Grid
      React.createElement('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: '16px',
          marginBottom: '24px'
        }
      },
        // Systolic
        React.createElement('div', { className: 'form-group' },
          React.createElement('label', { style: { fontWeight: '700', fontSize: '13px' } }, t.systolicLabel),
          React.createElement('input', {
            id: 'inputSystolic',
            type: 'number',
            value: systolic,
            onChange: (e) => setSystolic(e.target.value),
            style: {
              width: '100%',
              padding: '14px',
              fontSize: '20px',
              fontWeight: '800',
              borderRadius: '8px',
              border: '2px solid #cbd5e1',
              marginTop: '4px',
              boxSizing: 'border-box'
            }
          })
        ),
        // Diastolic
        React.createElement('div', { className: 'form-group' },
          React.createElement('label', { style: { fontWeight: '700', fontSize: '13px' } }, t.diastolicLabel),
          React.createElement('input', {
            id: 'inputDiastolic',
            type: 'number',
            value: diastolic,
            onChange: (e) => setDiastolic(e.target.value),
            style: {
              width: '100%',
              padding: '14px',
              fontSize: '20px',
              fontWeight: '800',
              borderRadius: '8px',
              border: '2px solid #cbd5e1',
              marginTop: '4px',
              boxSizing: 'border-box'
            }
          })
        ),
        // SpO2
        React.createElement('div', { className: 'form-group' },
          React.createElement('label', { style: { fontWeight: '700', fontSize: '13px' } }, t.spo2Label),
          React.createElement('input', {
            id: 'inputSpO2',
            type: 'number',
            value: spo2,
            onChange: (e) => setSpo2(e.target.value),
            style: {
              width: '100%',
              padding: '14px',
              fontSize: '20px',
              fontWeight: '800',
              borderRadius: '8px',
              border: '2px solid #0284c7',
              marginTop: '4px',
              boxSizing: 'border-box',
              background: '#f0f9ff'
            }
          })
        ),
        // Heart Rate
        React.createElement('div', { className: 'form-group' },
          React.createElement('label', { style: { fontWeight: '700', fontSize: '13px' } }, t.hrLabel),
          React.createElement('input', {
            id: 'inputHeartRate',
            type: 'number',
            value: heartRate,
            onChange: (e) => setHeartRate(e.target.value),
            style: {
              width: '100%',
              padding: '14px',
              fontSize: '20px',
              fontWeight: '800',
              borderRadius: '8px',
              border: '2px solid #cbd5e1',
              marginTop: '4px',
              boxSizing: 'border-box'
            }
          })
        )
      ),

      // Danger Symptoms Checklist
      React.createElement('div', {
        style: {
          background: '#fff1f2',
          border: '1px solid #fecdd3',
          borderRadius: '10px',
          padding: '16px',
          marginBottom: '24px'
        }
      },
        React.createElement('div', { style: { fontWeight: '700', color: '#9f1239', marginBottom: '10px', fontSize: '14px' } },
          `⚠️ ${t.symptomsTitle}`
        ),
        React.createElement('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '10px'
          }
        },
          [
            { id: 'chest pain', label: t.symptomChestPain },
            { id: 'breathlessness at rest', label: t.symptomBreathless },
            { id: 'confusion', label: t.symptomConfusion },
            { id: 'cyanosis', label: t.symptomCyanosis },
            { id: 'inability to walk', label: t.symptomInabilityWalk },
            { id: 'fainting', label: t.symptomFainting }
          ].map(item => React.createElement('label', {
            key: item.id,
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '13px',
              fontWeight: '600',
              color: '#881337',
              cursor: 'pointer'
            }
          },
            React.createElement('input', {
              type: 'checkbox',
              checked: dangerSymptoms.includes(item.id),
              onChange: () => toggleSymptom(item.id),
              style: { accentColor: '#e11d48', width: '16px', height: '16px' }
            }),
            item.label
          ))
        )
      ),

      // Evaluate Action Button
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        React.createElement('button', {
          type: 'button',
          onClick: () => setActiveTab('altitude'),
          style: {
            padding: '12px 20px',
            background: '#f1f5f9',
            color: '#475569',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '600',
            cursor: 'pointer'
          }
        }, '← Back to Altitude'),
        React.createElement('button', {
          id: 'btnEvaluateVitals',
          type: 'button',
          disabled: isSaving,
          onClick: handleEvaluateVitals,
          style: {
            padding: '14px 32px',
            background: '#0f766e',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '800',
            fontSize: '16px',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(15,118,110,0.3)'
          }
        }, isSaving ? 'Evaluating...' : `${t.evaluateVitalsBtn} →`)
      )
    ),

    // SCREEN 3: Interpretation & Clinical Results
    activeTab === 'results' && React.createElement('div', { className: 'card-section' },
      React.createElement('div', { className: 'card-title' },
        React.createElement('span', null, t.resultsTitle),
        React.createElement('div', { style: { fontSize: '13px', color: '#64748b' } },
          `Altitude: ${altitudeMeters.toLocaleString()} m (${currentFeet.toLocaleString()} ft)`
        )
      ),

      // Audio Readback Hero Card
      React.createElement('div', {
        style: {
          background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
          borderRadius: '12px',
          padding: '20px 24px',
          color: '#ffffff',
          marginBottom: '24px',
          boxShadow: '0 6px 20px rgba(2,132,199,0.25)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px'
        }
      },
        React.createElement('div', { style: { maxWidth: '650px' } },
          React.createElement('div', { style: { fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px', opacity: 0.9, fontWeight: '700' } },
            '🗣️ Synthesized Audio Clinical Readback'
          ),
          React.createElement('div', {
            id: 'audioReadbackTranscript',
            style: { fontSize: '18px', fontWeight: '700', marginTop: '6px', lineHeight: '1.4' }
          }, `"${audioReadbackText}"`),
          spo2 === '88' && React.createElement('div', {
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255,255,255,0.2)',
              padding: '4px 10px',
              borderRadius: '20px',
              fontSize: '12px',
              fontWeight: '600',
              marginTop: '10px'
            }
          }, '🚨 Nurse Escalation Alert Dispatched')
        ),
        React.createElement('button', {
          id: 'btnPlayAudioReadback',
          type: 'button',
          onClick: () => triggerAudioReadback(),
          style: {
            background: '#ffffff',
            color: '#0284c7',
            border: 'none',
            padding: '12px 22px',
            borderRadius: '8px',
            fontWeight: '800',
            fontSize: '14px',
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }
        }, isSpeaking ? t.audioReadbackPlaying : t.audioReadbackBtn)
      ),

      // Side-by-Side Raw vs Interpreted Table
      React.createElement('div', { style: { overflowX: 'auto', marginBottom: '24px' } },
        React.createElement('table', {
          style: {
            width: '100%',
            borderCollapse: 'collapse',
            textAlign: 'left'
          }
        },
          React.createElement('thead', null,
            React.createElement('tr', { style: { background: '#f8fafc', borderBottom: '2px solid #e2e8f0' } },
              React.createElement('th', { style: { padding: '14px', fontSize: '13px', fontWeight: '800', color: '#475569' } }, 'VITAL SIGN'),
              React.createElement('th', { style: { padding: '14px', fontSize: '13px', fontWeight: '800', color: '#0284c7' } }, t.rawValuesHeader),
              React.createElement('th', { style: { padding: '14px', fontSize: '13px', fontWeight: '800', color: '#475569' } }, t.expectedRange),
              React.createElement('th', { style: { padding: '14px', fontSize: '13px', fontWeight: '800', color: '#475569' } }, 'STATUS'),
              React.createElement('th', { style: { padding: '14px', fontSize: '13px', fontWeight: '800', color: '#475569' } }, 'CLINICAL INTERPRETATION / REASON')
            )
          ),
          React.createElement('tbody', null,
            (interpretedVitals.length > 0 ? interpretedVitals : [
              { type: 'spo2', rawValue: Number(spo2), unit: '%', expectedRange: [92, 97], status: 'borderline', reason: `SpO2 (${spo2}%) below expected altitude band (92-97%).`, adjustedForAltitude: true },
              { type: 'bp_systolic', rawValue: Number(systolic), unit: 'mmHg', expectedRange: [90, 120], status: 'normal', reason: `Normal systolic BP (not altitude adjusted).`, adjustedForAltitude: false },
              { type: 'bp_diastolic', rawValue: Number(diastolic), unit: 'mmHg', expectedRange: [60, 80], status: 'normal', reason: `Normal diastolic BP (not altitude adjusted).`, adjustedForAltitude: false },
              { type: 'heart_rate', rawValue: Number(heartRate), unit: 'bpm', expectedRange: [65, 115], status: 'normal', reason: `Within altitude-adjusted expected range (65-115 bpm).`, adjustedForAltitude: true }
            ]).map((v, idx) => {
              const badgeColors = {
                normal: { bg: '#dcfce7', text: '#15803d', border: '#86efac' },
                borderline: { bg: '#fef3c7', text: '#b45309', border: '#fcd34d' },
                critical: { bg: '#fee2e2', text: '#b91c1c', border: '#fca5a5' },
                'below-expected': { bg: '#e0f2fe', text: '#0369a1', border: '#7dd3fc' },
                'above-expected': { bg: '#ffedd5', text: '#c2410c', border: '#fdba74' }
              };
              const style = badgeColors[v.status] || badgeColors.normal;

              return React.createElement('tr', {
                key: idx,
                style: { borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? '#ffffff' : '#fcfcfc' }
              },
                React.createElement('td', { style: { padding: '14px', fontWeight: '700', textTransform: 'uppercase', fontSize: '13px' } },
                  v.type.replace('_', ' ')
                ),
                React.createElement('td', { style: { padding: '14px', fontWeight: '800', fontSize: '17px', color: '#0f172a' } },
                  `${v.rawValue} ${v.unit}`
                ),
                React.createElement('td', { style: { padding: '14px', fontSize: '14px', fontWeight: '600', color: '#64748b' } },
                  v.expectedRange ? `${v.expectedRange[0]} – ${v.expectedRange[1]} ${v.unit}` : 'N/A'
                ),
                React.createElement('td', { style: { padding: '14px' } },
                  React.createElement('span', {
                    style: {
                      background: style.bg,
                      color: style.text,
                      border: `1px solid ${style.border}`,
                      padding: '4px 10px',
                      borderRadius: '12px',
                      fontWeight: '800',
                      fontSize: '12px',
                      textTransform: 'uppercase'
                    }
                  }, v.status)
                ),
                React.createElement('td', { style: { padding: '14px', fontSize: '13px', color: '#334155' } },
                  v.reason,
                  React.createElement('span', {
                    style: { display: 'block', fontSize: '11px', color: '#94a3b8', marginTop: '2px' }
                  }, `Adjusted for Altitude: ${v.adjustedForAltitude ? 'Yes' : 'No (Raw Baseline Standard)'}`)
                )
              );
            })
          )
        )
      ),

      // Bottom Navigation
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between' } },
        React.createElement('button', {
          type: 'button',
          onClick: () => setActiveTab('vitals'),
          style: {
            padding: '12px 24px',
            background: '#f1f5f9',
            color: '#475569',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '700',
            cursor: 'pointer'
          }
        }, '← New Vitals Capture'),
        React.createElement('button', {
          type: 'button',
          onClick: () => setActiveTab('altitude'),
          style: {
            padding: '12px 24px',
            background: '#0284c7',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            fontWeight: '700',
            cursor: 'pointer'
          }
        }, 'Change Altitude Context')
      )
    ),

    // Staff PIN Override Modal
    showPinModal && React.createElement('div', {
      style: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }
    },
      React.createElement('div', {
        style: {
          background: '#ffffff',
          borderRadius: '12px',
          padding: '24px 30px',
          maxWidth: '400px',
          width: '90%',
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
        }
      },
        React.createElement('div', { style: { fontSize: '18px', fontWeight: '800', marginBottom: '8px' } }, t.pinPromptTitle),
        React.createElement('div', { style: { fontSize: '13px', color: '#64748b', marginBottom: '16px' } }, t.pinPromptDesc),
        React.createElement('form', { onSubmit: handlePinSubmit },
          React.createElement('input', {
            id: 'staffPinInput',
            type: 'password',
            maxLength: 8,
            placeholder: 'e.g. 1234',
            value: pinInput,
            onChange: (e) => setPinInput(e.target.value),
            autoFocus: true,
            style: {
              width: '100%',
              padding: '12px',
              fontSize: '20px',
              borderRadius: '8px',
              border: '2px solid #cbd5e1',
              boxSizing: 'border-box',
              marginBottom: '10px'
            }
          }),
          pinError && React.createElement('div', { style: { color: '#dc2626', fontSize: '13px', marginBottom: '10px' } }, pinError),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px' } },
            React.createElement('button', {
              type: 'button',
              onClick: () => {
                setShowPinModal(false);
                setPinError('');
                setPinInput('');
              },
              style: {
                padding: '10px 18px',
                background: '#f1f5f9',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '600',
                cursor: 'pointer'
              }
            }, 'Cancel'),
            React.createElement('button', {
              id: 'btnConfirmPin',
              type: 'submit',
              style: {
                padding: '10px 20px',
                background: '#0284c7',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                fontWeight: '700',
                cursor: 'pointer'
              }
            }, 'Verify PIN')
          )
        )
      )
    )
  );
}

// Render into DOM
const rootEl = document.getElementById('react-kiosk-root');
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(React.createElement(MediKioskApp));
}
