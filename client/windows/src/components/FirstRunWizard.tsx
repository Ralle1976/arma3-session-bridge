/// FirstRunWizard.tsx — First-Run Setup Wizard for Arma 3 Session Bridge
///
/// Shown when no valid WireGuard .conf is found on startup.
///
/// Steps:
///   1. Enter Bridge API URL + Admin Password
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
  const [adminPassword, setAdminPassword] = useState('')
  const [peerId, setPeerId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Step 2: Login + Generate Keypair + Register + Validate ───────────────

  const handleRegister = async () => {
    setLoading(true)
    setError(null)
    try {
      const base = apiUrl.trim().replace(/\/$/, '')

      // Step A: Login to get admin JWT
      const loginRes = await fetch(`${base}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: adminPassword }),
      })
      if (!loginRes.ok) {
        setError(`Login failed (HTTP ${loginRes.status}): wrong admin password?`)
        return
      }
      const loginData = await loginRes.json() as { access_token: string }
      const token = loginData.access_token

      // Step B: Generate keypair locally + register + write conf
      await invoke('generate_and_register_peer', {
        apiUrl: base,
        peerName: peerId.trim(),
        savePath: confPath,
        token,
      })

      // Step C: Validate: must have [Interface] + AllowedIPs = 10.8.0.0/24
      const valid = await invoke<boolean>('validate_conf', { path: confPath })
      if (!valid) {
        setError(
          'Generated config is invalid. ' +
            'It must contain [Interface] and AllowedIPs = 10.8.0.0/24.',
        )
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
          <h2>🚀 First Run Setup</h2>
          <p className="wizard-subtitle">
            No WireGuard config found. Let's set up your connection.
          </p>
        </div>

        {/* Step indicators — 2 steps */}
        <div className="wizard-steps">
          <div className={`wizard-step-dot ${step >= 1 ? 'done' : ''} ${step === 1 ? 'current' : ''}`}>
            <span>1</span>
            <label>API + Password</label>
          </div>
          <div className="wizard-step-line" />
          <div className={`wizard-step-dot ${step >= 2 ? 'done' : ''} ${step === 2 ? 'current' : ''}`}>
            <span>2</span>
            <label>Register</label>
          </div>
        </div>

        {/* Error */}
        {error && <div className="wizard-error">⚠ {error}</div>}

        {/* ── Step 1: API URL + Admin Password ─────────────────────────────── */}
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
            <label className="wizard-label" htmlFor="wizard-admin-pw" style={{ marginTop: '12px' }}>
              Admin Password
            </label>
            <input
              id="wizard-admin-pw"
              className="wizard-input"
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Enter admin password"
            />
            <p className="wizard-hint">
              The admin password is used to authenticate and register your peer automatically.
            </p>
            <div className="wizard-actions">
              <button
                className="btn btn-primary"
                onClick={() => {
                  setError(null)
                  setStep(2)
                }}
                disabled={!apiUrl.trim() || !adminPassword.trim()}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Peer Name + Register ───────────────────────────────── */}
        {step === 2 && (
          <div className="wizard-panel">
            <label className="wizard-label" htmlFor="wizard-peer-id">
              Your Peer Name
            </label>
            <input
              id="wizard-peer-id"
              className="wizard-input"
              type="text"
              value={peerId}
              onChange={(e) => setPeerId(e.target.value)}
              placeholder="e.g. ralle-arma3"
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
                ← Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleRegister}
                disabled={!peerId.trim() || loading}
              >
                {loading ? '⏳ Registriere & lade Config...' : '✅ Register & Connect'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
