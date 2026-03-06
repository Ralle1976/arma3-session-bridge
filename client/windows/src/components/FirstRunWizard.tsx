/// FirstRunWizard.tsx — First-Run Setup Wizard for Arma 3 Session Bridge
///
/// Shown when no valid WireGuard .conf is found on startup.
///
/// Steps:
///   1. Enter Bridge API URL + Admin Password
///   2. Enter Peer Name / ID
///   3. Download .conf via GET /peers/{id}/config — validates Split-Tunnel before accepting

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  /** Absolute path where the .conf file will be saved */
  confPath: string
  /** Called after a valid config has been downloaded & validated */
  onComplete: () => void
}

type Step = 1 | 2 | 3

// ─── Component ────────────────────────────────────────────────────────────────

const DEFAULT_API_URL = 'https://your-server.example.com/api'

export function FirstRunWizard({ confPath, onComplete }: Props) {
  const [step, setStep] = useState<Step>(1)
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL)
  const [adminPassword, setAdminPassword] = useState('')
  const [peerId, setPeerId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Step 3: Login + Download + Validate ──────────────────────────────────

  const handleDownload = async () => {
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

      // Step B: Download conf from API using Bearer token
      // peer_id accepts both integer ID and peer name string
      await invoke('download_peer_config', {
        apiUrl: base,
        peerId: peerId.trim(),
        savePath: confPath,
        token,
      })

      // Step C: Validate: must have [Interface] + AllowedIPs = 10.8.0.0/24 (no full-tunnel)
      const valid = await invoke<boolean>('validate_conf', { path: confPath })
      if (!valid) {
        setError(
          'Downloaded config is invalid. ' +
            'It must contain [Interface] and AllowedIPs = 10.8.0.0/24. ' +
            'Full-tunnel configs (0.0.0.0/0) are not allowed.',
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

        {/* Step indicators */}
        <div className="wizard-steps">
          <div className={`wizard-step-dot ${step >= 1 ? 'done' : ''} ${step === 1 ? 'current' : ''}`}>
            <span>1</span>
            <label>API + Password</label>
          </div>
          <div className="wizard-step-line" />
          <div className={`wizard-step-dot ${step >= 2 ? 'done' : ''} ${step === 2 ? 'current' : ''}`}>
            <span>2</span>
            <label>Peer Name</label>
          </div>
          <div className="wizard-step-line" />
          <div className={`wizard-step-dot ${step >= 3 ? 'done' : ''} ${step === 3 ? 'current' : ''}`}>
            <span>3</span>
            <label>Download</label>
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
              placeholder="https://your-server.example.com/api"
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
              The admin password is used to authenticate and download your peer config.
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

        {/* ── Step 2: Peer Name ───────────────────────────────────────────── */}
        {step === 2 && (
          <div className="wizard-panel">
            <label className="wizard-label" htmlFor="wizard-peer-id">
              Your Peer Name / ID
            </label>
            <input
              id="wizard-peer-id"
              className="wizard-input"
              type="text"
              value={peerId}
              onChange={(e) => setPeerId(e.target.value)}
              placeholder="e.g. ralle-arma3 or 2"
              autoFocus
            />
            <p className="wizard-hint">
              Enter your peer name (e.g. <code>ralle-arma3</code>) or integer ID. Ask your server admin if unsure.
            </p>
            <div className="wizard-actions">
              <button className="btn" onClick={() => { setError(null); setStep(1) }}>
                ← Back
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setError(null)
                  setStep(3)
                }}
                disabled={!peerId.trim()}
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Download Config ─────────────────────────────────────── */}
        {step === 3 && (
          <div className="wizard-panel">
            <p className="wizard-summary">
              Ready to download your WireGuard config:
            </p>
            <div className="wizard-info-box">
              <div>
                <strong>Endpoint:</strong>
                <br />
                <code>
                  {apiUrl.trim().replace(/\/$/, '')}/peers/{peerId.trim()}/config
                </code>
              </div>
              <div>
                <strong>Save to:</strong>
                <br />
                <code>{confPath}</code>
              </div>
            </div>
            <p className="wizard-hint">
              Only Split-Tunnel configs (AllowedIPs = 10.8.0.0/24) are accepted.
            </p>
            <div className="wizard-actions">
              <button
                className="btn"
                onClick={() => { setError(null); setStep(2) }}
                disabled={loading}
              >
                ← Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleDownload}
                disabled={loading}
              >
                {loading ? '⏳ Downloading…' : '⬇ Download & Validate Config'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
