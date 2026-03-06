/// SessionList.tsx — Browse & join active Arma 3 sessions
///
/// Displays sessions fetched from GET /sessions and lets the user click
/// "Join" to retrieve the host tunnel IP via the `join_session` Tauri command.
/// The returned IP is shown in ArmA 3 as the multiplayer server address.

import type { FC } from 'react'
import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

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
  /** Sessions to display */
  sessions: Session[]
  /** Whether VPN is connected (required to join) */
  vpnConnected: boolean
  /** Called when user triggers a refresh */
  onRefresh: () => void
  /** Whether a refresh is in progress */
  loading: boolean
}

// ─── Component ─────────────────────────────────────────────────────────────────

export const SessionList: FC<SessionListProps> = ({
  sessions,
  vpnConnected,
  onRefresh,
  loading,
}) => {
  const [joinResult, setJoinResult] = useState<{ sessionId: string; ip: string } | null>(null)
  const [joinError, setJoinError] = useState<string | null>(null)
  const [joining, setJoining] = useState<string | null>(null) // session ID being joined

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
    <section className="session-list-section">
      <div className="section-header">
        <h2>Active Sessions ({activeSessions.length})</h2>
        <button
          className="btn btn-sm"
          onClick={onRefresh}
          disabled={loading || !vpnConnected}
          title="Refresh session list"
        >
          {loading ? '⟳ Loading…' : '⟳ Refresh'}
        </button>
      </div>

      {/* Join result banner */}
      {joinResult && (
        <div className="status-message success">
          <strong>Join ready!</strong> Connect ArmA 3 to:{' '}
          <code className="ip-code">{joinResult.ip}</code>
          <button
            className="btn btn-xs"
            onClick={() => navigator.clipboard.writeText(joinResult.ip)}
            title="Copy IP to clipboard"
          >
            📋 Copy
          </button>
        </div>
      )}

      {/* Join error */}
      {joinError && (
        <div className="status-message error">{joinError}</div>
      )}

      {/* Gate: VPN required */}
      {!vpnConnected ? (
        <p className="hint">⚠ Connect to VPN first to browse sessions.</p>
      ) : activeSessions.length === 0 ? (
        <p className="hint">No active sessions found. Click Refresh or host one!</p>
      ) : (
        <ul className="session-list">
          {activeSessions.map((session) => (
            <li key={session.id} className={`session-item ${session.status}`}>
              {/* Mission info */}
              <div className="session-info">
                <span className="session-mission">{session.mission_name}</span>
                <span className="session-status">
                  <span className={`status-dot ${session.status}`} />
                  {session.status}
                </span>
              </div>

              {/* Player count */}
              <div className="session-meta">
                <span className="session-players">
                  👥 {session.current_players} / {session.max_players}
                </span>
                <span className="session-ip" title="Host tunnel IP (visible after join)">
                  🌐 {session.host_tunnel_ip || '—'}
                </span>
              </div>

              {/* Join action */}
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleJoin(session.id)}
                disabled={
                  joining === session.id ||
                  session.current_players >= session.max_players
                }
                title={
                  session.current_players >= session.max_players
                    ? 'Session is full'
                    : `Get host IP to join ${session.mission_name}`
                }
              >
                {joining === session.id ? 'Getting IP…' : 'Join →'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default SessionList
