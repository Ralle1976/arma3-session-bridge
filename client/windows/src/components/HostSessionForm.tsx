/// HostSessionForm.tsx — Create a new hosted Arma 3 session

import type { FC } from 'react'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '../i18n/LanguageContext'
import type { Session } from './SessionList'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface HostSessionFormProps {
  vpnConnected: boolean
  onSessionCreated: (session: Session) => void
  onSessionCleared: () => void
}

// ─── Component ─────────────────────────────────────────────────────────────────

export const HostSessionForm: FC<HostSessionFormProps> = ({
  vpnConnected,
  onSessionCreated,
  onSessionCleared,
}) => {
  const { t } = useTranslation()
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
    onSessionCleared()
  }

  // ── Gate: VPN required ─────────────────────────────────────────────────────

  if (!vpnConnected) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🔒</div>
        <div>{t.btnVpnConnect}</div>
      </div>
    )
  }

  // ── Active hosted session ──────────────────────────────────────────────────

  if (hosted) {
    return (
      <div>
        <div className="session-active-banner">
          <span className="session-active-text">🟢 {t.sessionActive}: {hosted.mission_name}</span>
          <div style={{ marginTop: 6, marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            Du bist bereits Host. Beitreten ist nicht noetig.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <code style={{ color: 'var(--green)', fontSize: 13 }}>{hosted.host_tunnel_ip}</code>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => navigator.clipboard.writeText(hosted.host_tunnel_ip)}
            >
              📋
            </button>
            <button className="btn btn-danger btn-sm" onClick={handleReset}>
              {t.btnStopSession}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Host form ──────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="section-title" style={{ marginBottom: 16 }}>{t.hostTitle}</div>

      {error && <div className="wizard-error" style={{ marginBottom: 14 }}>{error}</div>}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">{t.labelMissionName}</label>
          <input
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
          <label className="form-label">{t.labelMaxPlayers}</label>
          <input
            type="number"
            className="form-input"
            style={{ maxWidth: 120 }}
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
          {loading ? '⏳ ...' : t.btnStartSession}
        </button>
      </form>
    </div>
  )
}

export default HostSessionForm
