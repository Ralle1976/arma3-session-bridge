import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getVersion } from '@tauri-apps/api/app'
import { SessionList } from './components/SessionList'
import { HostSessionForm } from './components/HostSessionForm'
import { FirstRunWizard } from './components/FirstRunWizard'
import { ConnectionInfoPanel } from './components/ConnectionInfoPanel'
import type { MyPeerStats, PingResult } from './components/ConnectionInfoPanel'
import { VpnStatusBar } from './components/VpnStatusBar'
import { useTranslation } from './i18n/LanguageContext'
import type { Session } from './components/SessionList'
import type { OnlinePeer } from './components/OnlinePlayersList'
import './App.css'
import { DiagnosePanel } from './components/DiagnosePanel'

// ─── Constants ───────────────────────────────────────────────────────────────

const WG_CONF_PATH =
  import.meta.env.VITE_WG_CONF_PATH ??
  'C:\\ProgramData\\WireGuard\\arma3-session-bridge.conf'

const WG_TUNNEL_NAME =
  import.meta.env.VITE_WG_TUNNEL_NAME ?? 'arma3-session-bridge'

type ActiveTab = 'sessions' | 'host' | 'diagnose'
type VpnStatus = 'connected' | 'disconnected' | 'connecting'

// ─── App Component ──────────────────────────────────────────────────────────

function App() {
  const { lang, t, toggleLang } = useTranslation()
  const [vpnStatus, setVpnStatus] = useState<VpnStatus>('disconnected')
  const [vpnError, setVpnError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<Session[]>([])
  const [hostedSessionId, setHostedSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<ActiveTab>('sessions')
  const [appVersion, setAppVersion] = useState<string>('...')
  // null = checking, false = missing/invalid, true = valid
  const [configValid, setConfigValid] = useState<boolean | null>(null)
  const [showConnectionInfo, setShowConnectionInfo] = useState(false)
  const [vpnMode, setVpnMode] = useState<string>('arma3')
  const [onlinePeers, setOnlinePeers] = useState<OnlinePeer[]>([])
  const [peersLoading, setPeersLoading] = useState(false)
  const [connectionStartTime, setConnectionStartTime] = useState<number | null>(null)
  const [tunnelIp, setTunnelIp] = useState<string | null>(null)
  const [peerName, setPeerName] = useState<string | null>(null)
  const [myStats, setMyStats] = useState<MyPeerStats | null>(null)
  const [pingResult, setPingResult] = useState<PingResult | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [firewallResult, setFirewallResult] = useState<{
    rules_added: string[]
    rules_existed: string[]
    success: boolean
    error: string | null
  } | null>(null)
  // ── VPN actions ─────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    setVpnError(null)
    setVpnStatus('connecting')
    try {
      await invoke<string>('connect_vpn', { confPath: WG_CONF_PATH })
      setVpnStatus('connected')
      setShowConnectionInfo(true)
      setConnectionStartTime(Date.now())
      invoke<string>('get_vpn_mode').then(m => setVpnMode(m)).catch(() => {})
      invoke<{ tunnel_ip: string | null; peer_name: string | null }>('get_connection_info')
        .then(info => { setTunnelIp(info.tunnel_ip); setPeerName(info.peer_name) })
        .catch(() => {})
    } catch (e) {
      setVpnStatus('disconnected')
      setVpnError(String(e))
    }
  }, [])

  const disconnect = useCallback(async () => {
    try {
      // Notify server BEFORE disconnecting tunnel (best-effort, don't block on failure)
      await invoke('notify_disconnect').catch(() => {})
      await invoke<string>('disconnect_vpn', { tunnelName: WG_TUNNEL_NAME })
      setVpnStatus('disconnected')
      setSessions([])
      setConnectionStartTime(null)
      setOnlinePeers([])
      setVpnMode('arma3')
      setTunnelIp(null)
      setPeerName(null)
      setMyStats(null)
      setPingResult(null)
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
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => setAppVersion('unknown'))
  }, [])

  useEffect(() => {
    // Step 1: validate local .conf syntax
    invoke<boolean>('validate_conf', { path: WG_CONF_PATH })
      .then(async (valid) => {
        if (!valid) {
          // File missing or invalid — show wizard
          setConfigValid(false)
          return
        }
        // Step 2: verify peer still exists on the server
        try {
          const exists = await invoke<boolean>('check_peer_exists', { confPath: WG_CONF_PATH })
          if (!exists) {
            // Peer deleted on server — wipe local conf and show wizard
            await invoke('delete_conf_file', { path: WG_CONF_PATH })
            setConfigValid(false)
          } else {
            // Existing peer must also have local peer token for authenticated session APIs
            const hasToken = await invoke<boolean>('has_peer_token')
            if (!hasToken) {
              setConfigValid(false)
            } else {
              setConfigValid(true)
            }
          }
        } catch {
          // If peer check fails unexpectedly, proceed as valid to avoid false re-registration
          setConfigValid(true)
        }
      })
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
    const unlisten = listen<{ rules_added: string[]; rules_existed: string[]; success: boolean; error: string | null }>(
      'firewall-setup-result',
      (event) => {
        setFirewallResult(event.payload)
      }
    )
    return () => { unlisten.then((f) => f()) }
  }, [])

  useEffect(() => {
    if (vpnStatus === 'connected') {
      refreshSessions()
    }
  }, [vpnStatus, refreshSessions])

  // ── Online peers polling ────────────────────────────────────────────

  useEffect(() => {
    if (vpnStatus !== 'connected') return
    const fetchPeers = async () => {
      setPeersLoading(true)
      try {
        const peers = await invoke<OnlinePeer[]>('get_online_peers')
        setOnlinePeers(peers)
      } catch { /* ignore */ } finally { setPeersLoading(false) }
    }
    fetchPeers()
    const interval = setInterval(fetchPeers, 30_000)
    return () => clearInterval(interval)
  }, [vpnStatus])

  // ── Network dashboard stats polling ────────────────────────────

  useEffect(() => {
    if (vpnStatus !== 'connected' || !showConnectionInfo) return
    const fetchStats = async () => {
      setStatsLoading(true)
      try {
        const [stats, ping] = await Promise.all([
          invoke<MyPeerStats>('get_my_stats'),
          invoke<PingResult>('ping_gateway'),
        ])
        setMyStats(stats)
        setPingResult(ping)
      } catch { /* ignore */ } finally { setStatsLoading(false) }
    }
    fetchStats()
    const interval = setInterval(fetchStats, 15_000)
    return () => clearInterval(interval)
  }, [vpnStatus, showConnectionInfo])

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
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>v{appVersion}</div>
          </div>
        </div>
        <div className="titlebar-right">
          {(vpnStatus === 'connected' || vpnStatus === 'connecting') && (
            <span className={`vpn-mode-badge ${vpnMode === 'arma3' ? 'arma3' : 'open'}`}>
              {vpnMode === 'arma3' ? t.vpnModeArma : t.vpnModeOpen}
            </span>
          )}
          {vpnStatus === 'connected' && (
            <button
              className="info-toggle-btn"
              onClick={() => setShowConnectionInfo((v) => !v)}
              title="Connection diagnostics"
            >
              ℹ️
            </button>
          )}
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

      {/* VPN Error Banner */}
      {vpnError !== null && (
        <div style={{
          background: 'var(--error, #c0392b)',
          color: '#fff',
          padding: '8px 16px',
          fontSize: '0.875rem',
          borderRadius: '4px',
          margin: '8px 16px 0',
        }}>
          ⚠️ VPN-Fehler: {vpnError}
        </div>
      )}

      {/* Firewall Info Banner */}
      {firewallResult !== null && firewallResult.rules_added.length > 0 && (
        <div style={{
          background: 'var(--accent, #2980b9)',
          color: '#fff',
          padding: '8px 16px',
          fontSize: '0.875rem',
          borderRadius: '4px',
          margin: '8px 16px 0',
        }}>
          <div>{t.firewallRulesAdded}</div>
          <ul style={{ margin: '4px 0 4px 16px', padding: 0 }}>
            {firewallResult.rules_added.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <button
            onClick={() => setFirewallResult(null)}
            style={{ background: 'transparent', border: '1px solid #fff', color: '#fff', cursor: 'pointer', borderRadius: 3, padding: '2px 8px', marginTop: 4 }}
          >
            {t.firewallDismiss}
          </button>
        </div>
      )}
      {firewallResult !== null && firewallResult.error !== null && (
        <div style={{
          background: 'var(--error, #c0392b)',
          color: '#fff',
          padding: '8px 16px',
          fontSize: '0.875rem',
          borderRadius: '4px',
          margin: '8px 16px 0',
        }}>
          ⚠️ {t.firewallError.replace('{{error}}', firewallResult.error)}
          <button
            onClick={() => setFirewallResult(null)}
            style={{ background: 'transparent', border: '1px solid #fff', color: '#fff', cursor: 'pointer', borderRadius: 3, padding: '2px 8px', marginLeft: 8 }}
          >
            {t.firewallDismiss}
          </button>
        </div>
      )}

      {/* VPN Status Bar (persistent, visible when connected) */}
      {vpnStatus === 'connected' && (
        <VpnStatusBar
          tunnelIp={tunnelIp}
          vpnMode={vpnMode}
          peerName={peerName}
          connectionStartTime={connectionStartTime}
        />
      )}

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
        <button
          className={`tab-btn ${tab === 'diagnose' ? 'active' : ''}`}
          onClick={() => setTab('diagnose')}
        >
          {t.tabDiagnose}
        </button>
      </div>

      {/* Connection Info Panel (shown when VPN connected and panel toggled open) */}
      <ConnectionInfoPanel
        visible={showConnectionInfo && vpnStatus === 'connected'}
        myStats={myStats}
        pingResult={pingResult}
        statsLoading={statsLoading}
        vpnMode={vpnMode}
      />

      {/* Content */}
      <div className="tab-content">
        {tab === 'sessions' ? (
          <SessionList
            sessions={sessions}
            vpnConnected={vpnStatus === 'connected'}
            onRefresh={refreshSessions}
            loading={loading}
            hostedSessionId={hostedSessionId}
            onlinePeers={onlinePeers}
            peersLoading={peersLoading}
          />
        ) : tab === 'host' ? (
          <HostSessionForm
            vpnConnected={vpnStatus === 'connected'}
            onSessionCreated={(session) => {
              setSessions((prev) => [session, ...prev])
              setHostedSessionId(String(session.id))
              setTab('sessions')
            }}
            onSessionCleared={() => setHostedSessionId(null)}
          />
        ) : (
          <DiagnosePanel vpnConnected={vpnStatus === 'connected'} tunnelIp={tunnelIp} />
        )}
      </div>
    </div>
  )
}

export default App
