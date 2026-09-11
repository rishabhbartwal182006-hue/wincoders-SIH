// ============================================================
//  VitalScanner.jsx  — copy this file into:
//  public/patientTerminal/src/VitalScanner.jsx
//
//  Then import it in App.jsx:
//    import VitalScanner from './VitalScanner';
//  And place <VitalScanner sessionId={sessionId} /> wherever
//  you want the scanner panel to appear in your patient flow.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';

const API_BASE = 'http://localhost:4000';

// ── Small badge showing online / offline ─────────────────────
function StatusBadge({ label, online }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 600,
      background: online ? '#e8f5e9' : '#fbe9e7',
      color: online ? '#2e7d32' : '#bf360c',
      border: `1px solid ${online ? '#a5d6a7' : '#ffab91'}`
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: online ? '#43a047' : '#e64a19',
        display: 'inline-block'
      }} />
      {label}: {online ? 'Online' : 'Offline'}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────
export default function VitalScanner({ sessionId, onScanSuccess }) {
  const [scannerOnline, setScannerOnline]   = useState(null);
  const [esp32Online,   setEsp32Online]     = useState(null);
  const [scanning,      setScanning]        = useState(false);
  const [result,        setResult]          = useState(null);   // last scan result
  const [error,         setError]           = useState(null);
  const [statusLoading, setStatusLoading]   = useState(true);

  // Poll status every 8 seconds (paused while scanning to avoid camera buffer collision)
  const checkStatus = useCallback(async () => {
    if (scanning) return;
    try {
      const res = await fetch(`${API_BASE}/api/v1/vitals/status`);
      const data = await res.json();
      setScannerOnline(data.scanner_online);
      setEsp32Online(data.esp32_online);
    } catch {
      setScannerOnline(false);
      setEsp32Online(false);
    } finally {
      setStatusLoading(false);
    }
  }, [scanning]);

  useEffect(() => {
    checkStatus();
    const timer = setInterval(checkStatus, 8000);
    return () => clearInterval(timer);
  }, [checkStatus]);

  const handleScan = async () => {
    if (!sessionId) {
      setError('No active session. Please start a session first.');
      return;
    }
    setScanning(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/v1/vitals/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Server error ${res.status}`);
      }
      setResult(data.reading);
      if (onScanSuccess && data.reading) {
        onScanSuccess(data.reading);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  };

  // ── Render ────────────────────────────────────────────────
  const canScan = scannerOnline && esp32Online && !scanning;

  return (
    <div style={{
      background: '#fafafa',
      border: '1px solid #e0e0e0',
      borderRadius: 12,
      padding: '20px 24px',
      maxWidth: 420,
      fontFamily: 'Inter, Segoe UI, sans-serif'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ fontSize: 22 }}>🩺</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#1a1a2e' }}>
            Vital Scanner
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            Glucometer · ESP32-CAM · Groq AI
          </div>
        </div>
      </div>

      {/* Status badges */}
      {statusLoading ? (
        <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
          Checking device status…
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          <StatusBadge label="AI Scanner" online={scannerOnline} />
          <StatusBadge label="ESP32-CAM"  online={esp32Online}   />
        </div>
      )}

      {/* Instructions */}
      {!result && !scanning && (
        <ol style={{
          margin: '0 0 14px 0', padding: '0 0 0 18px',
          fontSize: 13, color: '#555', lineHeight: 1.8
        }}>
          <li>Place the glucometer display in front of the camera</li>
          <li>Ensure the reading is visible and well-lit</li>
          <li>Click <strong>Scan Now</strong> — the red LED will blink</li>
        </ol>
      )}

      {/* Scan button */}
      <button
        onClick={handleScan}
        disabled={!canScan}
        style={{
          width: '100%',
          padding: '11px 0',
          borderRadius: 8,
          border: 'none',
          cursor: canScan ? 'pointer' : 'not-allowed',
          background: canScan
            ? 'linear-gradient(135deg, #1565c0, #0d47a1)'
            : '#bdbdbd',
          color: '#fff',
          fontWeight: 700,
          fontSize: 14,
          letterSpacing: 0.3,
          transition: 'opacity 0.2s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8
        }}
      >
        {scanning ? (
          <>
            <span style={{
              width: 14, height: 14,
              border: '2px solid rgba(255,255,255,0.4)',
              borderTopColor: '#fff',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'vs-spin 0.8s linear infinite'
            }} />
            Scanning…
          </>
        ) : (
          <>📷 Scan Now</>
        )}
      </button>

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 12, padding: '10px 14px',
          background: '#ffebee', borderRadius: 8,
          border: '1px solid #ef9a9a', color: '#c62828', fontSize: 13
        }}>
          ⚠️ {error}
          {!scannerOnline && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
              Make sure FastAPI is running: <code>uvicorn app:app --port 8000 --reload</code>
            </div>
          )}
          {scannerOnline && !esp32Online && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#888' }}>
              Make sure ESP32-CAM is powered and on the same WiFi hotspot.
            </div>
          )}
        </div>
      )}

      {/* Result */}
      {result && (
        <div style={{
          marginTop: 14, padding: '14px 16px',
          background: '#e8f5e9', borderRadius: 10,
          border: '1px solid #a5d6a7'
        }}>
          <div style={{ fontSize: 11, color: '#388e3c', fontWeight: 600, marginBottom: 4 }}>
            ✅ READING CAPTURED
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 38, fontWeight: 800, color: '#1b5e20' }}>
              {result.value ?? '—'}
            </span>
            <span style={{ fontSize: 16, color: '#388e3c', fontWeight: 600 }}>
              {result.unit || 'mg/dL'}
            </span>
          </div>

          <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
            <strong>Type:</strong>{' '}
            {(result.type || 'blood_glucose').replace(/_/g, ' ')}
          </div>

          {result.device && (
            <div style={{ fontSize: 12, color: '#555' }}>
              <strong>Device:</strong> {result.device}
            </div>
          )}

          {result.confidence != null && (
            <div style={{ fontSize: 12, color: '#555' }}>
              <strong>AI Confidence:</strong>{' '}
              {Math.round(result.confidence * 100)}%
            </div>
          )}

          {result.is_memory && (
            <div style={{
              marginTop: 6, fontSize: 12, color: '#e65100',
              background: '#fff3e0', padding: '4px 8px', borderRadius: 6
            }}>
              ⚠️ Memory recall reading — not a live test result
            </div>
          )}

          {result.clinical_notes && (
            <div style={{ fontSize: 11, color: '#777', marginTop: 6, fontStyle: 'italic' }}>
              {result.clinical_notes}
            </div>
          )}

          <button
            onClick={() => { setResult(null); setError(null); }}
            style={{
              marginTop: 10, padding: '5px 14px',
              borderRadius: 6, border: '1px solid #a5d6a7',
              background: 'transparent', color: '#2e7d32',
              cursor: 'pointer', fontSize: 12
            }}
          >
            Scan Again
          </button>
        </div>
      )}

      {/* Spinner keyframe — injected once */}
      <style>{`
        @keyframes vs-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
