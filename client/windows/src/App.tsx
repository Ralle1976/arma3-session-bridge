import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { SessionList } from './components/SessionList'
import { HostSessionForm } from './components/HostSessionForm'
import { FirstRunWizard } from './components/FirstRunWizard'
import { useTranslation } from './i18n/LanguageContext'
import type { Session } from './components/SessionList'
import './App.css'

// ─── Constants ───────────────────────────────────────────────────────────────

const WG_CONF_PATH =
  import.meta.env.VITE_WG_CONF_PATH ??
  'C:\\ProgramData\\WireGuard\\arma3-session-bridge.conf'

const WG_TUNNEL_NAME =
  import.meta.env.VITE_WG_TUNNEL_NAME ?? 'arma3-session-bridge'

type ActiveTab = 'sessions' | 'host'
type VpnStatus = 'connected' | 'disconnected' | 'connecting'

// ─── App Component ──────────────────────────────────────────────────────────

function App() {
  const { lang, t, toggleLang } = useTranslation()
  const [vpnStatus, setVpnStatus] = useState<VpnStatus>('disconnected')
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<ActiveTab>('sessions')
  // null = checking, false = missing/invalid, true = valid
  const [configValid, setConfigValid] = useState<boolean | null>(null)

  // ── VPN actions ─────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    setVpnStatus('connecting')
    try {
      await invoke<string>('connect_vpn', { confPath: WG_CONF_PATH })
      setVpnStatus('connected')
    } catch {
      setVpnStatus('disconnected')
    }
  }, [])

  const disconnect = useCallback(async () => {
    try {
      await invoke<string>('disconnect_vpn', { tunnelName: WG_TUNNEL_NAME })
      setVpnStatus('disconnected')
      setSessions([])
    } catch {
      // keep current status
    }
  }, [])

  const checkStatus = useCallback(async () => {
    try {
      const status = await invoke<{ connected: boolean; tunnel_ip: string | null }>('check_vpn_status', {
        tunnelName: WG_TUNNEL_NAME,
      })
      setVpnStatus(status.connected ? 'connected' : 'disconnected')
    } catch {
      // ignore
    }
  }, [])

  const refreshSessions = useCallback(async () => {
    if (vpnStatus !== 'connected') return
    setLoading(true)
    try {
      const data = await invoke<Session[]>('get_sessions')
      setSessions(data)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [vpnStatus])

  const handleVpnToggle = () => {
    if (vpnStatus === 'connected') {
      disconnect()
    } else if (vpnStatus === 'disconnected') {
      connect()
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  useEffect(() => {
    invoke<boolean>('validate_conf', { path: WG_CONF_PATH })
      .then((valid) => setConfigValid(valid))
      .catch(() => setConfigValid(false))
  }, [])

  useEffect(() => {
    if (configValid !== true) return
    checkStatus()

    const unlisten_connect = listen('tray-connect', () => connect())
    const unlisten_disconnect = listen('tray-disconnect', () => disconnect())

    const unlisten_reconnected = listen<string>('vpn-reconnected', () => {
      setVpnStatus('connected')
    })
    const unlisten_reconnect_failed = listen<string>('vpn-reconnect-failed', () => {
      setVpnStatus('disconnected')
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
    if (vpnStatus === 'connected') {
      refreshSessions()
    }
  }, [vpnStatus, refreshSessions])

  // ── Render ──────────────────────────────────────────────────────────

  if (configValid === null) {
    return (
      <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Checking configuration…</p>
      </div>
    )
  }

  if (configValid === false) {
    return (
      <FirstRunWizard
        confPath={WG_CONF_PATH}
        onComplete={() => setConfigValid(true)}
      />
    )
  }

  const vpnLabel =
    vpnStatus === 'connected' ? t.vpnConnected :
    vpnStatus === 'connecting' ? t.vpnConnecting :
    t.vpnDisconnected

  return (
    <div className="app-shell">
      {/* Titlebar */}
      <div className="titlebar">
        <div className="titlebar-left">
          <div className="titlebar-logo">🎮</div>
          <div>
            <div className="titlebar-title">{t.appTitle}</div>
          </div>
        </div>
        <div className="titlebar-right">
          <button className="lang-toggle" onClick={toggleLang}>
            {lang === 'de' ? 'EN' : 'DE'}
          </button>
          <button
            className={`vpn-badge ${vpnStatus}`}
            onClick={handleVpnToggle}
            disabled={vpnStatus === 'connecting'}
          >
            <span className="vpn-dot" />
            {vpnLabel}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab-btn ${tab === 'sessions' ? 'active' : ''}`}
          onClick={() => setTab('sessions')}
        >
          {t.tabSessions}
        </button>
        <button
          className={`tab-btn ${tab === 'host' ? 'active' : ''}`}
          onClick={() => setTab('host')}
        >
          {t.tabHost}
        </button>
      </div>

      {/* Content */}
      <div className="tab-content">
        {tab === 'sessions' ? (
          <SessionList
            sessions={sessions}
            vpnConnected={vpnStatus === 'connected'}
            onRefresh={refreshSessions}
            loading={loading}
          />
        ) : (
          <HostSessionForm
            vpnConnected={vpnStatus === 'connected'}
            onSessionCreated={(session) => {
              setSessions((prev) => [session, ...prev])
              setTab('sessions')
            }}
          />
        )}
      </div>
    </div>
  )
}

export default App
