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
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
      background: online ? '#edf8f8' : '#fef2f2',
      color: online ? '#126e70' : '#b91c1c',
      border: `1px solid ${online ? '#c4e7e7' : '#fecaca'}`
    }}>
      <span style={{
        width: 7, height: 7, borderRadius: '50%',
        background: online ? '#168f91' : '#ef4444',
        display: 'inline-block'
      }} />
      {label}: {online ? 'Ready' : 'Offline'}
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
      setError('No active session.');
      return;
    }
    setScanning(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/v1/vitals/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Scan failed (${res.status})`);
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

  const canScan = scannerOnline && esp32Online && !scanning;

  return (
    <div style={{
      background: '#fafcfc',
      border: '1px solid #dce5e8',
      borderRadius: '16px',
      padding: '28px 24px',
      marginTop: '10px',
      fontFamily: 'Inter, Arial, sans-serif'
    }}>
      {/* Top Header & Status */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#173b4d', margin: 0 }}>
            Device Scanner
          </h3>
        </div>

        {/* Live Badges */}
        <div style={{ display: 'flex', gap: 8 }}>
          <StatusBadge label="Scanner" online={scannerOnline} />
          <StatusBadge label="Device" online={esp32Online} />
        </div>
      </div>

      {/* Main Scan Trigger Button */}
      <button
        type="button"
        onClick={handleScan}
        disabled={!canScan}
        style={{
          width: '100%',
          padding: '15px 24px',
          borderRadius: 10,
          border: 'none',
          cursor: canScan ? 'pointer' : 'not-allowed',
          background: canScan ? '#168f91' : '#b0bec5',
          color: '#ffffff',
          fontWeight: 700,
          fontSize: 15,
          letterSpacing: '0.4px',
          transition: 'all 0.2s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          boxShadow: canScan ? '0 4px 14px rgba(22, 143, 145, 0.25)' : 'none'
        }}
      >
        {scanning ? (
          <>
            <span style={{
              width: 16, height: 16,
              border: '2px solid rgba(255,255,255,0.4)',
              borderTopColor: '#ffffff',
              borderRadius: '50%',
              display: 'inline-block',
              animation: 'vs-spin 0.8s linear infinite'
            }} />
            Reading Measurement…
          </>
        ) : (
          <>Get Vitals</>
        )}
      </button>

      {/* Error Message */}
      {error && (
        <div style={{
          marginTop: 16, padding: '12px 16px',
          background: '#fef2f2', borderRadius: 10,
          border: '1px solid #fecaca', color: '#991b1b', fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 10
        }}>
          <span>⚠️</span>
          <div>{error}</div>
        </div>
      )}

      {/* Captured Result Card */}
      {result && (
        <div style={{
          marginTop: 20,
          background: '#ffffff',
          border: '2px solid #168f91',
          borderRadius: 14,
          padding: '22px 24px',
          boxShadow: '0 6px 20px rgba(22, 143, 145, 0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.8px',
              textTransform: 'uppercase', color: '#168f91'
            }}>
              ✓ Validated Reading
            </div>
            {result.confidence && (
              <div style={{
                fontSize: 12, fontWeight: 600, color: '#2e9d68',
                background: '#edf8f3', padding: '3px 10px', borderRadius: 12
              }}>
                {Math.round(result.confidence * 100)}% Confidence
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 44, fontWeight: 800, color: '#18394b', letterSpacing: '-0.5px' }}>
              {result.value ?? '—'}
            </span>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#168f91' }}>
              {result.unit || 'mg/dL'}
            </span>
            <span style={{ fontSize: 14, color: '#70818a', marginLeft: 8 }}>
              ({(result.type || 'blood_glucose').replace(/_/g, ' ')})
            </span>
          </div>

          {result.device && (
            <div style={{ fontSize: 13, color: '#536a73', marginTop: 4 }}>
              Device: <strong>{result.device}</strong>
            </div>
          )}

          {result.is_memory && (
            <div style={{
              marginTop: 10, fontSize: 12, color: '#b45309',
              background: '#fef3c7', padding: '6px 12px', borderRadius: 8,
              display: 'inline-block'
            }}>
              ⚠️ Memory recall reading detected from meter
            </div>
          )}

          {result.clinical_notes && (
            <div style={{ fontSize: 12, color: '#74858d', marginTop: 8, fontStyle: 'italic' }}>
              {result.clinical_notes}
            </div>
          )}
        </div>
      )}

      {/* Animation Style */}
      <style>{`
        @keyframes vs-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}