import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { TrayMenu } from './components/TrayMenu'
import './App.css'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SessionInfo {
  id: number
  peer_id: number
  mission: string | null
  map_name: string | null
  player_count: number
  started_at: string
  ended_at: string | null
  active: boolean
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const API_URL =
  import.meta.env.VITE_API_URL ?? 'http://10.8.0.1:8001'

const WG_CONF_PATH =
  import.meta.env.VITE_WG_CONF_PATH ??
  'C:\\ProgramData\\WireGuard\\arma3-session-bridge.conf'

const WG_TUNNEL_NAME =
  import.meta.env.VITE_WG_TUNNEL_NAME ?? 'arma3-session-bridge'

// ─── App Component ─────────────────────────────────────────────────────────────

function App() {
  const [vpnConnected, setVpnConnected] = useState(false)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  // ── VPN actions ──────────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const msg = await invoke<string>('connect_vpn', { confPath: WG_CONF_PATH })
      setVpnConnected(true)
      setStatusMessage(msg)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const disconnect = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const msg = await invoke<string>('disconnect_vpn', { tunnelName: WG_TUNNEL_NAME })
      setVpnConnected(false)
      setSessions([])
      setStatusMessage(msg)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  const checkStatus = useCallback(async () => {
    try {
      const connected = await invoke<boolean>('check_vpn_status', {
        tunnelName: WG_TUNNEL_NAME,
      })
      setVpnConnected(connected)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    if (!vpnConnected) return
    setLoading(true)
    setError(null)
    try {
      const data = await invoke<SessionInfo[]>('get_sessions', { apiUrl: API_URL })
      setSessions(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [vpnConnected])

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Check VPN status on startup
    checkStatus()

    // Listen for tray-menu events emitted from Rust
    const unlisten_connect = listen('tray-connect', () => {
      connect()
    })
    const unlisten_disconnect = listen('tray-disconnect', () => {
      disconnect()
    })

    // Poll VPN status every 30 seconds
    const interval = setInterval(checkStatus, 30_000)

    return () => {
      clearInterval(interval)
      unlisten_connect.then((f) => f())
      unlisten_disconnect.then((f) => f())
    }
  }, [checkStatus, connect, disconnect])

  // Auto-refresh sessions when VPN connects
  useEffect(() => {
    if (vpnConnected) {
      refreshSessions()
    }
  }, [vpnConnected, refreshSessions])

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* Header */}
      <header className="app-header">
        <h1>Arma 3 Session Bridge</h1>
        <div className={`vpn-badge ${vpnConnected ? 'connected' : 'disconnected'}`}>
          <span className="vpn-dot" />
          {vpnConnected ? 'VPN Connected' : 'VPN Disconnected'}
        </div>
      </header>

      {/* Tray Menu Mirror */}
      <TrayMenu
        isConnected={vpnConnected}
        onConnect={connect}
        onDisconnect={disconnect}
        onQuit={() => invoke('plugin:window|close')}
      />

      {/* Status messages */}
      {statusMessage && (
        <div className="status-message success">{statusMessage}</div>
      )}
      {error && <div className="status-message error">{error}</div>}

      {/* Controls */}
      <section className="controls">
        <button
          className="btn btn-primary"
          onClick={connect}
          disabled={loading || vpnConnected}
        >
          Connect VPN
        </button>
        <button
          className="btn btn-danger"
          onClick={disconnect}
          disabled={loading || !vpnConnected}
        >
          Disconnect VPN
        </button>
        <button className="btn" onClick={checkStatus} disabled={loading}>
          Check Status
        </button>
        <button
          className="btn"
          onClick={refreshSessions}
          disabled={loading || !vpnConnected}
        >
          Refresh Sessions
        </button>
      </section>

      {/* Sessions */}
      <section className="sessions">
        <h2>Active Sessions ({sessions.filter((s) => s.active).length})</h2>

        {!vpnConnected ? (
          <p className="hint">Connect to VPN first to see sessions.</p>
        ) : sessions.length === 0 ? (
          <p className="hint">No active sessions found.</p>
        ) : (
          <ul className="session-list">
            {sessions.map((session) => (
              <li key={session.id} className={`session-item ${session.active ? 'active' : 'ended'}`}>
                <span className="session-mission">
                  {session.mission ?? 'Unknown Mission'}
                </span>
                <span className="session-map">
                  {session.map_name ?? 'Unknown Map'}
                </span>
                <span className="session-players">
                  {session.player_count} players
                </span>
                <span className="session-started">
                  {new Date(session.started_at).toLocaleString()}
                </span>
                {!session.active && session.ended_at && (
                  <span className="session-ended">
                    Ended: {new Date(session.ended_at).toLocaleString()}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default App
