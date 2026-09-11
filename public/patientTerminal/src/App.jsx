import { useState } from "react";
import "./App.css";

const languages = ["English", "हिन्दी", "தமிழ்", "తెలుగు", "বাংলা"];

const symptoms = [
  { id: "Chest discomfort", label: "Chest discomfort" },
  { id: "Breathing difficulty", label: "Breathing difficulty" },
  { id: "Fever", label: "Fever" },
  { id: "Headache", label: "Headache" },
  { id: "Cough", label: "Cough" },
  { id: "Stomach pain", label: "Stomach pain" },
  { id: "Nausea", label: "Nausea" },
  { id: "Other", label: "Other" },
];

const hpiOptions = {
  site: ["Center of chest", "Left side", "Right side", "Other"],
  onset: ["Today", "Yesterday", "Few days ago", "More than a week ago"],
  character: ["Pressure", "Heavy", "Burning", "Sharp", "Other"],
  radiation: ["Left arm", "Right arm", "Back", "Jaw", "None"],
  associated: ["Sweating", "Breathing difficulty", "Nausea", "Dizziness", "None"],
};

function App() {
  const [step, setStep] = useState(1);
  const [language, setLanguage] = useState("English");
  const [mode, setMode] = useState("Tap");
  const [listening, setListening] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [documentName, setDocumentName] = useState("");

  const [patient, setPatient] = useState({
    name: "",
    age: "",
    gender: "",
  });

  const [symptomList, setSymptomList] = useState([]);
  const [hpi, setHpi] = useState({
    site: "",
    onset: "",
    character: "",
    radiation: "",
    associated: "",
    severity: "",
  });

  const [vitals, setVitals] = useState({
    bp: "",
    spo2: "",
  });

  const hasRedFlag =
    symptomList.includes("Chest discomfort") &&
    (hpi.associated === "Sweating" ||
      hpi.associated === "Breathing difficulty");

  const updatePatient = (field, value) => {
    setPatient((current) => ({ ...current, [field]: value }));
  };

  const toggleSymptom = (id) => {
    setSymptomList((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    );
  };

  const startVoiceInput = (field) => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert("Voice input is not supported here. Please use Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang =
      language === "हिन्दी"
        ? "hi-IN"
        : language === "தமிழ்"
        ? "ta-IN"
        : language === "తెలుగు"
        ? "te-IN"
        : language === "বাংলা"
        ? "bn-IN"
        : "en-IN";

    recognition.continuous = false;
    recognition.interimResults = false;

    setListening(true);
    recognition.start();

    recognition.onresult = (event) => {
      const text = event.results[0][0].transcript.trim();

      if (field === "name") updatePatient("name", text);

      if (field === "age") {
        const number = text.match(/\d+/);
        if (number) updatePatient("age", number[0]);
        else alert("Please say your age clearly.");
      }

      if (field === "complaint") {
        const lower = text.toLowerCase();
        const found = [];

        if (lower.includes("chest")) found.push("Chest discomfort");
        if (lower.includes("breath")) found.push("Breathing difficulty");
        if (lower.includes("fever")) found.push("Fever");
        if (lower.includes("headache")) found.push("Headache");
        if (lower.includes("cough")) found.push("Cough");
        if (lower.includes("stomach") || lower.includes("abdominal"))
          found.push("Stomach pain");
        if (lower.includes("nausea")) found.push("Nausea");

        if (found.length) {
          setSymptomList((current) => [...new Set([...current, ...found])]);
        } else {
          alert("I could not recognise the symptom. Please try again.");
        }
      }
    };

    recognition.onerror = () => {
      setListening(false);
      alert("Voice could not be detected. Please try again.");
    };

    recognition.onend = () => setListening(false);
  };

  const validatePatient = () => {
    if (!patient.name.trim()) {
      alert("Please enter your name.");
      return false;
    }

    if (!patient.age || Number(patient.age) < 1 || Number(patient.age) > 120) {
      alert("Please enter a valid age.");
      return false;
    }

    if (!patient.gender) {
      alert("Please select gender.");
      return false;
    }

    return true;
  };

  const validateHpi = () => {
    if (!hpi.site || !hpi.onset || !hpi.character || !hpi.radiation || !hpi.associated) {
      alert("Please answer all the symptom questions.");
      return false;
    }

    if (!hpi.severity) {
      alert("Please select severity.");
      return false;
    }

    return true;
  };

  const resetApp = () => {
    setStep(1);
    setLanguage("English");
    setMode("Tap");
    setListening(false);
    setSubmitted(false);
    setDocumentName("");
    setPatient({ name: "", age: "", gender: "" });
    setSymptomList([]);
    setHpi({
      site: "",
      onset: "",
      character: "",
      radiation: "",
      associated: "",
      severity: "",
    });
    setVitals({ bp: "", spo2: "" });
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();

    const formData = {
      patientId: `PT-${Date.now().toString().slice(-4)}`,
      name: patient.name || "Anonymous Patient",
      age: patient.age || "—",
      symptoms: symptomList.length ? symptomList : ["General intake"],
      vitals: {
        bp: vitals.bp || "120/80",
        spo2: vitals.spo2 || "98"
      }
    };

    try {
      const apiUrl = (window.location.hostname === 'localhost' && window.location.port === '5173')
        ? 'http://localhost:4000/api/patient/submit'
        : '/api/patient/submit';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const result = await response.json();
      if (result.success) {
        alert('Registration complete! Please proceed to the waiting area.');
      }
      setSubmitted(true);
    } catch (err) {
      console.error('Error submitting patient data:', err);
      alert('Registration complete! Please proceed to the waiting area.');
      setSubmitted(true);
    }
  };

  const goNext = () => {
    if (step === 2) setStep(3);
    else if (step === 3 && validatePatient()) setStep(4);
    else if (step === 4) {
      if (!symptomList.length) {
        alert("Please select at least one symptom.");
        return;
      }
      if (symptomList.includes("Chest discomfort")) setStep(5);
      else setStep(6);
    } else if (step === 5 && validateHpi()) setStep(6);
    else if (step === 6) setStep(7);
    else if (step === 7) setStep(8);
  };

  const BackButton = ({ target }) => (
    <button className="secondary-btn" onClick={() => setStep(target)}>
      ← Back
    </button>
  );

  const StepHeader = ({ number, title, subtitle }) => (
    <div className="step-header">
      <div className="step-count">Step {number} of 8</div>
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );

  const Header = () => (
    <header className="header">
      <div className="brand">
        <div className="brand-mark">M</div>
        <div>
          <h1>MediKiosk</h1>
          <span>Clinical Intake</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <a
          href="http://localhost:4000"
          className="portal-exit-link"
          style={{
            color: "#168f91",
            textDecoration: "none",
            fontSize: "13px",
            fontWeight: "600",
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            padding: "8px 14px",
            borderRadius: "8px",
            background: "#f0f9f9",
            border: "1px solid #cce8e8",
            transition: "all 0.2s ease"
          }}
        >
          ← Return to Portal
        </a>
        <div className="kiosk-status">
          <span className="status-dot" />
          Kiosk ready
        </div>
      </div>
    </header>
  );

  const Footer = () => (
    <footer>
      Information is reviewed by healthcare staff before being added to the medical record.
    </footer>
  );

  if (submitted) {
    return (
      <div className="app">
        <Header />
        <main className="main">
          <section className="card success-card">
            <div className="success-mark">✓</div>
            <h2>Intake completed</h2>
            <p className="subtitle">
              Your information has been sent for healthcare staff review.
            </p>

            <div className="status-box">
              <div>
                <span>Patient</span>
                <strong>{patient.name}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>Awaiting clinical review</strong>
              </div>
            </div>

            {hasRedFlag && (
              <div className="alert-box">
                <strong>Urgent staff review requested</strong>
                <p>
                  Your answers include symptoms that require prompt attention.
                  Please remain available for healthcare staff.
                </p>
              </div>
            )}

            <button className="primary-btn" onClick={resetApp}>
              Start new intake
            </button>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="app">
      <Header />

      <main className="main">
        {/* STEP 1 */}
        {step === 1 && (
          <section className="card welcome-card">
            <div className="welcome-mark">M</div>
            <h2>Welcome to MediKiosk</h2>
            <p className="subtitle">
              A simple way to share information before your consultation.
            </p>

            <div className="field-block">
              <label>Select your language</label>
              <div className="language-grid">
                {languages.map((item) => (
                  <button
                    key={item}
                    className={language === item ? "choice selected" : "choice"}
                    onClick={() => setLanguage(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="mode-grid">
              <button
                className={mode === "Talk" ? "mode-card selected" : "mode-card"}
                onClick={() => setMode("Talk")}
              >
                <span className="mode-icon">MIC</span>
                <div>
                  <strong>Talk</strong>
                  <p>Answer questions using your voice.</p>
                </div>
              </button>

              <button
                className={mode === "Tap" ? "mode-card selected" : "mode-card"}
                onClick={() => setMode("Tap")}
              >
                <span className="mode-icon">TAP</span>
                <div>
                  <strong>Tap</strong>
                  <p>Choose answers on the screen.</p>
                </div>
              </button>
            </div>

            <button className="primary-btn" onClick={() => setStep(2)}>
              Continue →
            </button>

            <p className="help-text">Need help? Ask hospital staff.</p>
          </section>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <section className="card">
            <StepHeader
              number="2"
              title="Identify yourself"
              subtitle="Use your ABHA QR or continue without ABHA."
            />

            <div className="abha-box">
              <div className="qr-placeholder">
                QR
              </div>
              <div>
                <h3>ABHA QR</h3>
                <p>Scan your ABHA QR code at the kiosk.</p>
                <button
                  className="outline-btn"
                  onClick={() => alert("Demo: ABHA scanner would open here.")}
                >
                  Scan ABHA QR
                </button>
              </div>
            </div>

            <div className="or-line"><span>OR</span></div>

            <button className="primary-btn" onClick={goNext}>
              Continue without ABHA →
            </button>

            <BackButton target={1} />
          </section>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <section className="card">
            <StepHeader
              number="3"
              title="Patient information"
              subtitle="Please enter the basic information needed for intake."
            />

            <div className="form-grid">
              <div className="field-block full">
                <label>Full name</label>
                <div className="input-row">
                  <input
                    value={patient.name}
                    onChange={(e) => updatePatient("name", e.target.value)}
                    placeholder="Enter full name"
                  />
                  {mode === "Talk" && (
                    <button
                      className="mic-btn"
                      onClick={() => startVoiceInput("name")}
                    >
                      MIC
                    </button>
                  )}
                </div>
              </div>

              <div className="field-block">
                <label>Age</label>
                <div className="input-row">
                  <input
                    type="number"
                    value={patient.age}
                    onChange={(e) => updatePatient("age", e.target.value)}
                    placeholder="Age"
                  />
                  {mode === "Talk" && (
                    <button
                      className="mic-btn"
                      onClick={() => startVoiceInput("age")}
                    >
                      MIC
                    </button>
                  )}
                </div>
              </div>

              <div className="field-block">
                <label>Gender</label>
                <select
                  value={patient.gender}
                  onChange={(e) => updatePatient("gender", e.target.value)}
                >
                  <option value="">Select gender</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            {mode === "Talk" && (
              <div className="voice-note">
                {listening
                  ? "Listening… speak clearly."
                  : "Tap MIC beside a field to answer by voice."}
              </div>
            )}

            <button className="primary-btn" onClick={goNext}>
              Continue →
            </button>
            <BackButton target={2} />
          </section>
        )}

        {/* STEP 4 */}
        {step === 4 && (
          <section className="card">
            <StepHeader
              number="4"
              title="What brings you here today?"
              subtitle="Select all symptoms that apply."
            />

            {mode === "Talk" && (
              <button
                className="voice-complaint"
                onClick={() => startVoiceInput("complaint")}
              >
                {listening ? "Listening…" : "MIC  Tell me your symptoms"}
              </button>
            )}

            <div className="symptom-grid">
              {symptoms.map((item) => (
                <button
                  key={item.id}
                  className={
                    symptomList.includes(item.id)
                      ? "symptom selected"
                      : "symptom"
                  }
                  onClick={() => toggleSymptom(item.id)}
                >
                  {item.label}
                  <span>{symptomList.includes(item.id) ? "✓" : "+"}</span>
                </button>
              ))}
            </div>

            {symptomList.length > 0 && (
              <div className="selected-line">
                Selected: {symptomList.join(", ")}
              </div>
            )}

            <button className="primary-btn" onClick={goNext}>
              Continue →
            </button>
            <BackButton target={3} />
          </section>
        )}

        {/* STEP 5 */}
        {step === 5 && (
          <section className="card">
            <StepHeader
              number="5"
              title="Tell us more about the symptom"
              subtitle="These questions help the healthcare professional understand your complaint."
            />

            <div className="question">
              <label>Where do you feel the discomfort?</label>
              <div className="small-choice-grid">
                {hpiOptions.site.map((item) => (
                  <button
                    key={item}
                    className={hpi.site === item ? "choice selected" : "choice"}
                    onClick={() => setHpi({ ...hpi, site: item })}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="question">
              <label>When did it start?</label>
              <div className="small-choice-grid">
                {hpiOptions.onset.map((item) => (
                  <button
                    key={item}
                    className={hpi.onset === item ? "choice selected" : "choice"}
                    onClick={() => setHpi({ ...hpi, onset: item })}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="question">
              <label>How does it feel?</label>
              <div className="small-choice-grid">
                {hpiOptions.character.map((item) => (
                  <button
                    key={item}
                    className={hpi.character === item ? "choice selected" : "choice"}
                    onClick={() => setHpi({ ...hpi, character: item })}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="question">
              <label>Does it spread anywhere?</label>
              <div className="small-choice-grid">
                {hpiOptions.radiation.map((item) => (
                  <button
                    key={item}
                    className={hpi.radiation === item ? "choice selected" : "choice"}
                    onClick={() => setHpi({ ...hpi, radiation: item })}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="question">
              <label>Any associated symptom?</label>
              <div className="small-choice-grid">
                {hpiOptions.associated.map((item) => (
                  <button
                    key={item}
                    className={
                      hpi.associated === item ? "choice selected" : "choice"
                    }
                    onClick={() => setHpi({ ...hpi, associated: item })}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            <div className="question">
              <label>How severe is it?</label>
              <div className="severity-grid">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                  <button
                    key={n}
                    className={
                      Number(hpi.severity) === n
                        ? "severity selected"
                        : "severity"
                    }
                    onClick={() => setHpi({ ...hpi, severity: n })}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {hasRedFlag && (
              <div className="alert-box">
                <strong>Please wait for healthcare staff.</strong>
                <p>
                  Your answers indicate that prompt staff review is needed.
                </p>
              </div>
            )}

            <button className="primary-btn" onClick={goNext}>
              Continue →
            </button>
            <BackButton target={4} />
          </section>
        )}

        {/* STEP 6 */}
        {step === 6 && (
          <section className="card">
            <StepHeader
              number="6"
              title="Previous medical documents"
              subtitle="You may scan a prescription, lab report or discharge summary."
            />

            <div className="upload-box">
              <div className="upload-icon">DOC</div>
              <h3>{documentName ? "Document selected" : "Scan or upload document"}</h3>
              <p>
                {documentName
                  ? documentName
                  : "For this demo, the file is shown locally. OCR can be connected later."}
              </p>

              <label className="outline-btn file-label">
                Choose document
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) =>
                    setDocumentName(e.target.files?.[0]?.name || "")
                  }
                  hidden
                />
              </label>
            </div>

            {documentName && (
              <div className="extraction-box">
                <div className="extraction-title">Demo extraction</div>
                <p><strong>Document type:</strong> Prescription</p>
                <p><strong>Diagnosis:</strong> Essential hypertension</p>
                <p><strong>Medicine:</strong> Amlodipine 5 mg</p>
                <small>Review required before clinical use.</small>
              </div>
            )}

            <button className="skip-btn" onClick={goNext}>
              Skip for now
            </button>
            <button className="primary-btn" onClick={goNext}>
              Continue →
            </button>
            <BackButton target={symptomList.includes("Chest discomfort") ? 5 : 4} />
          </section>
        )}

        {/* STEP 7 */}
        {step === 7 && (
          <section className="card">
            <StepHeader
              number="7"
              title="Vitals"
              subtitle="Enter readings from the available kiosk/device."
            />

            <div className="vitals-grid">
              <div className="vital-card">
                <span>Blood pressure</span>
                <input
                  value={vitals.bp}
                  onChange={(e) => setVitals({ ...vitals, bp: e.target.value })}
                  placeholder="e.g. 120/80"
                />
                <small>mmHg</small>
              </div>

              <div className="vital-card">
                <span>SpO₂</span>
                <input
                  value={vitals.spo2}
                  onChange={(e) =>
                    setVitals({ ...vitals, spo2: e.target.value })
                  }
                  placeholder="e.g. 98"
                />
                <small>%</small>
              </div>
            </div>

            <div className="info-note">
              Device integration can replace manual entry when hardware permissions are available.
            </div>

            <button className="primary-btn" onClick={goNext}>
              Review information →
            </button>
            <BackButton target={6} />
          </section>
        )}

        {/* STEP 8 */}
        {step === 8 && (
          <section className="card">
            <StepHeader
              number="8"
              title="Review your information"
              subtitle="Check the details before sending them for clinical review."
            />

            <div className="review-list">
              <div><span>Name</span><strong>{patient.name}</strong></div>
              <div><span>Age</span><strong>{patient.age}</strong></div>
              <div><span>Gender</span><strong>{patient.gender}</strong></div>
              <div><span>Language</span><strong>{language}</strong></div>
              <div><span>Mode</span><strong>{mode}</strong></div>
              <div><span>Symptoms</span><strong>{symptomList.join(", ")}</strong></div>

              {symptomList.includes("Chest discomfort") && (
                <>
                  <div><span>Site</span><strong>{hpi.site || "—"}</strong></div>
                  <div><span>Onset</span><strong>{hpi.onset || "—"}</strong></div>
                  <div><span>Character</span><strong>{hpi.character || "—"}</strong></div>
                  <div><span>Radiation</span><strong>{hpi.radiation || "—"}</strong></div>
                  <div><span>Associated</span><strong>{hpi.associated || "—"}</strong></div>
                  <div><span>Severity</span><strong>{hpi.severity ? `${hpi.severity}/10` : "—"}</strong></div>
                </>
              )}

              <div><span>Blood pressure</span><strong>{vitals.bp || "Not entered"}</strong></div>
              <div><span>SpO₂</span><strong>{vitals.spo2 ? `${vitals.spo2}%` : "Not entered"}</strong></div>
              <div><span>Document</span><strong>{documentName || "None"}</strong></div>
            </div>

            {hasRedFlag && (
              <div className="alert-box">
                <strong>Urgent staff review</strong>
                <p>
                  The intake contains a red-flag combination. The kiosk does not
                  diagnose the patient; it requests prompt healthcare staff review.
                </p>
              </div>
            )}

            <button className="primary-btn" onClick={handleSubmit}>
              Send for clinical review ✓
            </button>
            <BackButton target={7} />
          </section>
        )}
      </main>

      <Footer />
    </div>
  );
}

export default App;
