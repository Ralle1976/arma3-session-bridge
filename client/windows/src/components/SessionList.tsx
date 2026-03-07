/// SessionList.tsx — Browse & join active Arma 3 sessions

import type { FC } from 'react'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '../i18n/LanguageContext'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Session {
  id: string
  mission_name: string
  host_tunnel_ip: string
  current_players: number
  max_players: number
  status: string
}

interface SessionListProps {
  sessions: Session[]
  vpnConnected: boolean
  onRefresh: () => void
  loading: boolean
}

// ─── Component ─────────────────────────────────────────────────────────────────

export const SessionList: FC<SessionListProps> = ({
  sessions,
  vpnConnected,
  onRefresh,
  loading,
}) => {
  const { t } = useTranslation()
  const [joinResult, setJoinResult] = useState<{ sessionId: string; ip: string } | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [joining, setJoining] = useState<string | null>(null)

  const handleJoin = async (sessionId: string) => {
    setJoining(sessionId)
    setJoinResult(null)
    setJoinError(null)
    try {
      const hostIp = await invoke<string>('join_session', { sessionId })
      setJoinResult({ sessionId, ip: hostIp })
    } catch (e) {
      setJoinError(String(e))
    } finally {
      setJoining(null)
    }
  }

  const activeSessions = sessions.filter((s) => s.status === 'active' || s.status === 'waiting')

  return (
    <div>
      <div className="session-header">
        <span className="section-title">{t.tabSessions} ({activeSessions.length})</span>
        <button
          className="btn btn-secondary btn-sm"
          onClick={onRefresh}
          disabled={loading || !vpnConnected}
        >
          {loading ? '⟳' : t.btnRefresh}
        </button>
      </div>

      {/* Join result */}
      {joinResult && (
        <div style={{ background: 'var(--green-dim)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 12, color: 'var(--green)', fontSize: 13 }}>
          ✓ IP: <code>{joinResult.ip}</code>{' '}
          <button className="btn btn-sm btn-secondary" onClick={() => navigator.clipboard.writeText(joinResult.ip)}>
            📋
          </button>
        </div>
      )}

      {/* Join error */}
      {joinError && (
        <div className="wizard-error" style={{ marginBottom: 12 }}>{joinError}</div>
      )}

      {!vpnConnected ? (
        <div className="empty-state">
          <div className="empty-state-icon">🔒</div>
          <div>{t.btnVpnConnect}</div>
        </div>
      ) : activeSessions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">🎮</div>
          <div>{t.noSessions}</div>
        </div>
      ) : (
        activeSessions.map((session) => (
          <div key={session.id} className="session-card">
            <div className="session-card-info">
              <div className="session-card-name">{session.mission_name}</div>
              <div className="session-card-meta">
                {t.labelPlayers}: {session.current_players}/{session.max_players} &nbsp;·&nbsp;
                {session.host_tunnel_ip || '—'}
              </div>
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleJoin(session.id)}
              disabled={joining === session.id || session.current_players >= session.max_players}
            >
              {joining === session.id ? '...' : t.btnJoin}
            </button>
          </div>
        ))
      )}
    </div>
  )
}

export default SessionList
