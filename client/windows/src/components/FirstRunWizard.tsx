/// FirstRunWizard.tsx — First-Run Setup Wizard for Arma 3 Session Bridge
///
/// Shown when no valid WireGuard .conf is found on startup.
///
/// Steps:
///   1. Bridge API URL + Registrierungs-Code (vom Admin, nicht das Admin-PW!)
///   2. Enter Peer Name → App generates WireGuard keypair locally & registers

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  /** Absolute path where the .conf file will be saved */
  confPath: string
  /** Called after peer has been registered and conf validated */
  onComplete: () => void
}

type Step = 1 | 2

// ─── Component ────────────────────────────────────────────────────────────────

const DEFAULT_API_URL = 'https://arma3-session-bridge.ralle1976.cloud/api'

export function FirstRunWizard({ confPath, onComplete }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL)
  const [registrationCode, setRegistrationCode] = useState('')
  const [peerId, setPeerId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Registrieren: Keypair generieren + Server-Registrierung + Conf schreiben ──

  const handleRegister = async () => {
    setLoading(true)
    setError(null)
    try {
      const base = apiUrl.trim().replace(/\/$/, '')

      // Keypair lokal generieren + beim Server registrieren + conf schreiben.
      // Kein fetch() — alles über Tauri-Command (kein CSP-Problem).
      await invoke('generate_and_register_peer', {
        apiUrl: base,
        peerName: peerId.trim(),
        savePath: confPath,
        registrationCode: registrationCode.trim(),
      })

      // Step C: Validate: must have [Interface] + AllowedIPs = 10.8.0.0/24
      const valid = await invoke<boolean>('validate_conf', { path: confPath })
      if (!valid) {
        setError('Generierte Config ist ungültig. Admin kontaktieren.')
        return
      }
      onComplete()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="wizard-overlay">
      <div className="wizard-card">
        {/* Title */}
        <div className="wizard-header">
          <h2>🚀 Ersteinrichtung</h2>
          <p className="wizard-subtitle">
            Keine VPN-Konfiguration gefunden. Lass uns deine Verbindung einrichten.
          </p>
        </div>

        {/* Step indicators — 2 steps */}
        <div className="wizard-steps">
          <div className={`wizard-step-dot ${step >= 1 ? 'done' : ''} ${step === 1 ? 'current' : ''}`}>
            <span>1</span>
            <label>URL &amp; Code</label>
          </div>
          <div className="wizard-step-line" />
          <div className={`wizard-step-dot ${step >= 2 ? 'done' : ''} ${step === 2 ? 'current' : ''}`}>
            <span>2</span>
            <label>Registrieren</label>
          </div>
        </div>

        {/* Error */}
        {error && <div className="wizard-error">⚠ {error}</div>}

        {/* ── Step 1: API URL + Registrierungs-Code ─────────────────────────── */}
        {step === 1 && (
          <div className="wizard-panel">
            <label className="wizard-label" htmlFor="wizard-api-url">
              Bridge API URL
            </label>
            <input
              id="wizard-api-url"
              className="wizard-input"
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://arma3-session-bridge.ralle1976.cloud/api"
              autoFocus
            />
            <label className="wizard-label" htmlFor="wizard-reg-code" style={{ marginTop: '12px' }}>
              Registrierungs-Code
            </label>
            <input
              id="wizard-reg-code"
              className="wizard-input"
              type="password"
              value={registrationCode}
              onChange={(e) => setRegistrationCode(e.target.value)}
              placeholder="Code vom Admin"
            />
            <p className="wizard-hint">
              Den Code bekommst du vom Admin (z.B. per Discord).
              Das ist <strong>nicht</strong> das Admin-Passwort — nur zum Registrieren.
            </p>
            <div className="wizard-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setError(null)
                  setStep(2)
                }}
                disabled={!apiUrl.trim() || !registrationCode.trim()}
              >
                Weiter →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Peer Name + Register ───────────────────────────────── */}
        {step === 2 && (
          <div className="wizard-panel">
            <label className="wizard-label" htmlFor="wizard-peer-id">
              Dein Peer-Name
            </label>
            <input
              id="wizard-peer-id"
              className="wizard-input"
              type="text"
              value={peerId}
              onChange={(e) => setPeerId(e.target.value)}
              placeholder="z.B. ralle-arma3"
              autoFocus
            />
            <p className="wizard-hint">
              Der Name muss eindeutig sein (z.B. <code>ralle-arma3</code>). Die App generiert
              deinen VPN-Schlüssel automatisch.
            </p>
            <div className="wizard-actions">
              <button
                className="btn"
                onClick={() => { setError(null); setStep(1) }}
                disabled={loading}
              >
                ← Zurück
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRegister}
                disabled={!peerId.trim() || loading}
              >
                {loading ? '⏳ Registriere...' : '✅ Registrieren & Verbinden'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
