import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { TrayMenu } from './components/TrayMenu'
import { SessionList } from './components/SessionList'
import { HostSessionForm } from './components/HostSessionForm'
import { FirstRunWizard } from './components/FirstRunWizard'
import type { Session } from './components/SessionList'
import './App.css'

// ─── Constants ───────────────────────────────────────────────────────────────

const WG_CONF_PATH =
  import.meta.env.VITE_WG_CONF_PATH ??
  'C:\\ProgramData\\WireGuard\\arma3-session-bridge.conf'

const WG_TUNNEL_NAME =
  import.meta.env.VITE_WG_TUNNEL_NAME ?? 'arma3-session-bridge'

// Active tab type for the main panel
type ActiveTab = 'sessions' | 'host'

// ─── App Component ──────────────────────────────────────────────────────────

function App() {
  const [vpnConnected, setVpnConnected] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<ActiveTab>('sessions')
  // null = checking, false = missing/invalid, true = valid
  const [configValid, setConfigValid] = useState<boolean | null>(null)
  // ── VPN actions ─────────────────────────────────────────────────────

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
      const status = await invoke<{ connected: boolean; tunnel_ip: string | null }>('check_vpn_status', {
        tunnelName: WG_TUNNEL_NAME,
      })
      setVpnConnected(status.connected)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    if (!vpnConnected) return
    setLoading(true)
    setError(null)
    try {
      // get_sessions uses hardcoded API_BASE_URL on the Rust side
      const data = await invoke<Session[]>('get_sessions')
      setSessions(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [vpnConnected])

  // ── Lifecycle ───────────────────────────────────────────────────────

  useEffect(() => {
    // Check config validity on startup before doing anything else
    invoke<boolean>('validate_conf', { path: WG_CONF_PATH })
      .then((valid) => setConfigValid(valid))
      .catch(() => setConfigValid(false))
  }, [])

  useEffect(() => {
    if (configValid !== true) return
    checkStatus()

    const unlisten_connect = listen('tray-connect', () => connect())
    const unlisten_disconnect = listen('tray-disconnect', () => disconnect())

    // Auto-reconnect events from background Rust task
    const unlisten_reconnected = listen<string>('vpn-reconnected', (event) => {
      setVpnConnected(true)
      setStatusMessage(`VPN auto-reconnected — Tunnel IP: ${event.payload}`)
    })
    const unlisten_reconnect_failed = listen<string>('vpn-reconnect-failed', (event) => {
      setError(`VPN auto-reconnect failed: ${event.payload}`)
    })

    const interval = setInterval(checkStatus, 30_000)

    return () => {
      clearInterval(interval)
      unlisten_connect.then((f) => f())
      unlisten_disconnect.then((f) => f())
      unlisten_reconnected.then((f) => f())
      unlisten_reconnect_failed.then((f) => f())
    }
  }, [configValid, checkStatus, connect, disconnect])

  useEffect(() => {
    if (vpnConnected) {
      refreshSessions()
    }
  }, [vpnConnected, refreshSessions])

  // ── Render ──────────────────────────────────────────────────────────

  // Loading state while we check config
  if (configValid === null) {
    return (
      <div className="app app--loading">
        <p>Checking configuration…</p>
      </div>
    )
  }

  // First-run wizard when no valid config exists
  if (configValid === false) {
    return (
      <FirstRunWizard
        confPath={WG_CONF_PATH}
        onComplete={() => setConfigValid(true)}
      />
    )
  }

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

      {/* VPN Controls */}
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
      </section>

      {/* Tab navigation */}
      <nav className="tab-nav">
        <button
          className={`tab-btn ${activeTab === 'sessions' ? 'active' : ''}`}
          onClick={() => setActiveTab('sessions')}
        >
          🌍 Browse Sessions
        </button>
        <button
          className={`tab-btn ${activeTab === 'host' ? 'active' : ''}`}
          onClick={() => setActiveTab('host')}
        >
          🚀 Host Session
        </button>
      </nav>

      {/* Tab panels */}
      {activeTab === 'sessions' && (
        <SessionList
          sessions={sessions}
          vpnConnected={vpnConnected}
          onRefresh={refreshSessions}
          loading={loading}
        />
      )}

      {activeTab === 'host' && (
        <HostSessionForm
          vpnConnected={vpnConnected}
          onSessionCreated={(session) => {
            setSessions((prev) => [session, ...prev])
            setActiveTab('sessions')
            setStatusMessage(`Hosting: ${session.mission_name} — share IP ${session.host_tunnel_ip} with players`)
          }}
        />
      )}
    </div>
  )
}

export default App
