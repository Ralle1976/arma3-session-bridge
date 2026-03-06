/// HostSessionForm.tsx — Create a new hosted Arma 3 session
///
/// Calls the `host_session` Tauri command which:
///   1. POSTs { mission_name, max_players } to the bridge API
///   2. Returns the created Session (including host_tunnel_ip)
///   3. Starts the auto-heartbeat (Rust side, every 60 s)
///
/// After hosting, the host must distribute their tunnel IP to players
/// so they can join in ArmA 3 multiplayer.

import type { FC } from 'react'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Session } from './SessionList'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface HostSessionFormProps {
  /** Whether VPN is connected (required to host) */
  vpnConnected: boolean
  /** Called when a session is successfully created */
  onSessionCreated: (session: Session) => void
}

// ─── Component ─────────────────────────────────────────────────────────────────

export const HostSessionForm: FC<HostSessionFormProps> = ({
  vpnConnected,
  onSessionCreated,
}) => {
  const [missionName, setMissionName] = useState('')
  const [maxPlayers, setMaxPlayers] = useState(8)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hosted, setHosted] = useState<Session | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!missionName.trim()) return

    setLoading(true)
    setError(null)
    try {
      const session = await invoke<Session>('host_session', {
        missionName: missionName.trim(),
        maxPlayers,
      })
      setHosted(session)
      onSessionCreated(session)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setHosted(null)
    setMissionName('')
    setMaxPlayers(8)
    setError(null)
  }

  // ── Gate: VPN required ─────────────────────────────────────────────────────

  if (!vpnConnected) {
    return (
      <section className="host-session-section">
        <h2>Host Session</h2>
        <p className="hint">⚠ Connect to VPN first to host a session.</p>
      </section>
    )
  }

  // ── After session is hosted ────────────────────────────────────────────────

  if (hosted) {
    return (
      <section className="host-session-section">
        <h2>Session Active</h2>
        <div className="hosted-session-card">
          <div className="hosted-row">
            <span className="hosted-label">Mission:</span>
            <strong>{hosted.mission_name}</strong>
          </div>
          <div className="hosted-row">
            <span className="hosted-label">Your tunnel IP:</span>
            <code className="ip-code">{hosted.host_tunnel_ip}</code>
            <button
              className="btn btn-xs"
              onClick={() => navigator.clipboard.writeText(hosted.host_tunnel_ip)}
              title="Copy IP to clipboard"
            >
              📋 Copy
            </button>
          </div>
          <div className="hosted-row">
            <span className="hosted-label">Max players:</span>
            <span>{hosted.max_players}</span>
          </div>
          <div className="hosted-row">
            <span className="hosted-label">Status:</span>
            <span className={`status-badge ${hosted.status}`}>{hosted.status}</span>
          </div>
          <p className="hosted-hint">
            Share your tunnel IP with players — they enter it in ArmA 3 Multiplayer → Direct Connect.
            <br />
            Heartbeat is sent automatically every 60 s to keep the session alive.
          </p>
          <button className="btn btn-danger" onClick={handleReset}>
            Stop Hosting
          </button>
        </div>
      </section>
    )
  }

  // ── Host form ──────────────────────────────────────────────────────────────

  return (
    <section className="host-session-section">
      <h2>Host Session</h2>

      {error && <div className="status-message error">{error}</div>}

      <form className="host-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="mission-name">Mission Name</label>
          <input
            id="mission-name"
            type="text"
            className="form-input"
            placeholder="e.g. Operation Arrowhead"
            value={missionName}
            onChange={(e) => setMissionName(e.target.value)}
            required
            maxLength={80}
            disabled={loading}
          />
        </div>

        <div className="form-group">
          <label htmlFor="max-players">Max Players</label>
          <input
            id="max-players"
            type="number"
            className="form-input form-input-sm"
            min={2}
            max={64}
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
            disabled={loading}
          />
        </div>

        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || !missionName.trim()}
        >
          {loading ? 'Creating session…' : '🚀 Host Session'}
        </button>
      </form>
    </section>
  )
}

export default HostSessionForm
