/// DiagnosePanel.tsx — 7-point connection checklist with per-peer ping display

import { type FC, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '../i18n/LanguageContext'

// ─── Local Types ──────────────────────────────────────────────────────────────

interface ConnectionInfo {
  tunnel_ip: string | null
  server_url: string | null
  vpn_mode: string
  api_latency_ms: number | null
  wireguard_installed: boolean
  peer_name: string | null
}

interface PingResult {
  gateway_ip: string
  latency_ms: number | null
  reachable: boolean
}

interface FirewallSetupResult {
  rules_added: string[]
  rules_existed: string[]
  success: boolean
  error: string | null
}

interface OnlinePeer {
  name: string
  tunnel_ip: string
  connection_quality: string
  last_handshake_ago: number | null
}

interface PeerPingResult {
  ip: string
  latency_ms: number | null
  reachable: boolean
  packet_loss_pct: number
}

// ─── Diag-specific translation keys (added by T3 agent to translations.ts) ───

interface DiagTranslations {
  diagTitle: string
  diagStart: string
  diagRunning: string
  diagApiReachable: string
  diagWgInstalled: string
  diagTunnelActive: string
  diagGatewayPing: string
  diagFirewallRules: string
  diagOnlinePeers: string
  diagVpnRequired: string
  diagNoPeers: string
  diagReachable: string
  diagUnreachable: string
}

// ─── Public Interface ─────────────────────────────────────────────────────────

interface DiagnosePanelProps {
  vpnConnected: boolean
  tunnelIp: string | null
}

// ─── Internal State ───────────────────────────────────────────────────────────

type ItemStatus = 'idle' | 'running' | 'ok' | 'warn' | 'error' | 'skipped'

interface DiagResults {
  apiLatencyMs: number | null
  apiStatus: ItemStatus
  wgInstalled: boolean | null
  wgStatus: ItemStatus
  tunnelConnected: boolean | null
  tunnelIpResult: string | null
  tunnelStatus: ItemStatus
  gatewayPing: PingResult | null
  gatewayStatus: ItemStatus
  firewallResult: FirewallSetupResult | null
  firewallStatus: ItemStatus
  onlinePeers: OnlinePeer[] | null
  peersStatus: ItemStatus
  peerPings: Array<PeerPingResult | null> | null
  peerPingsStatus: ItemStatus
}

const INIT_RESULTS: DiagResults = {
  apiLatencyMs: null, apiStatus: 'idle',
  wgInstalled: null, wgStatus: 'idle',
  tunnelConnected: null, tunnelIpResult: null, tunnelStatus: 'idle',
  gatewayPing: null, gatewayStatus: 'idle',
  firewallResult: null, firewallStatus: 'idle',
  onlinePeers: null, peersStatus: 'idle',
  peerPings: null, peerPingsStatus: 'idle',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<ItemStatus, string> = {
  idle: '○',
  running: '⏳',
  ok: '✅',
  warn: '⚠️',
  error: '❌',
  skipped: '○',
}

const STATUS_COLOR: Record<ItemStatus, string> = {
  idle: 'var(--text-muted)',
  running: 'var(--text-secondary)',
  ok: 'var(--green)',
  warn: 'var(--yellow)',
  error: 'var(--red, #ef4444)',
  skipped: 'var(--text-muted)',
}

function apiLatencyStatus(ms: number | null): ItemStatus {
  if (ms === null) return 'error'
  if (ms < 300) return 'ok'
  if (ms < 1000) return 'warn'
  return 'error'
}

function pingLatencyStatus(ms: number | null, reachable: boolean): ItemStatus {
  if (!reachable || ms === null) return 'error'
  if (ms < 100) return 'ok'
  if (ms < 300) return 'warn'
  return 'error'
}

// ─── Layout constants ─────────────────────────────────────────────────────────

const ROW: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 0',
  fontSize: 13,
}

const ROW_INDENT: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '3px 0',
  paddingLeft: 28,
  fontSize: 12,
}

const ICON_COL: React.CSSProperties = {
  width: 18,
  flexShrink: 0,
  textAlign: 'center',
  fontSize: 14,
  lineHeight: 1,
}

const LABEL_COL: React.CSSProperties = {
  flex: 1,
  color: 'var(--text-secondary)',
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const VALUE_COL: React.CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontSize: 11,
  fontWeight: 600,
  textAlign: 'right',
  minWidth: 80,
  flexShrink: 0,
}

// ─── Component ────────────────────────────────────────────────────────────────

const DiagnosePanel: FC<DiagnosePanelProps> = ({ vpnConnected, tunnelIp }) => {
  const { t } = useTranslation()
  // Cast to include diag keys added by T3 agent; graceful ?? fallbacks if missing
  const dt = t as typeof t & Partial<DiagTranslations>

  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<DiagResults>(INIT_RESULTS)

  // ── Main diagnose handler (NO auto-start; user must click button) ───────────

  const runDiagnose = useCallback(async () => {
    setRunning(true)

    // Reset ALL results — show ⏳ for active checks, ○ for skipped
    setResults({
      apiLatencyMs: null, apiStatus: 'running',
      wgInstalled: null, wgStatus: 'running',
      tunnelConnected: null, tunnelIpResult: null, tunnelStatus: 'running',
      gatewayPing: null, gatewayStatus: vpnConnected ? 'running' : 'skipped',
      firewallResult: null, firewallStatus: 'running',
      onlinePeers: null, peersStatus: 'running',
      peerPings: null, peerPingsStatus: vpnConnected ? 'running' : 'skipped',
    })

    try {
      // ── Phase 1: API + WireGuard + Tunnel — parallel (one get_connection_info call) ──

      const [connInfo, vpnStatus] = await Promise.all([
        invoke<ConnectionInfo>('get_connection_info').catch(() => null),
        invoke<{ connected: boolean; tunnel_ip: string | null }>(
          'check_vpn_status',
          { tunnelName: 'arma3-session-bridge' },
        ).catch(() => null),
      ])

      const apiLatencyMs = connInfo?.api_latency_ms ?? null
      const apiStatus: ItemStatus = connInfo === null
        ? 'error'
        : apiLatencyStatus(apiLatencyMs)

      const wgInstalled = connInfo?.wireguard_installed ?? null
      const wgStatus: ItemStatus = connInfo === null
        ? 'error'
        : (wgInstalled ? 'ok' : 'error')

      const tunnelConnected = vpnStatus?.connected ?? null
      const tunnelIpResult = vpnStatus?.tunnel_ip ?? null
      const tunnelStatus: ItemStatus = vpnStatus === null
        ? 'error'
        : (tunnelConnected ? 'ok' : 'idle')

      setResults(prev => ({
        ...prev,
        apiLatencyMs, apiStatus,
        wgInstalled, wgStatus,
        tunnelConnected, tunnelIpResult, tunnelStatus,
      }))

      // ── Phase 2: Gateway ping + Firewall — parallel ──────────────────────────

      const [gwPing, fwResult] = await Promise.all([
        vpnConnected
          ? invoke<PingResult>('ping_gateway').catch(() => null)
          : Promise.resolve(null),
        invoke<FirewallSetupResult>('setup_firewall_rules').catch(() => null),
      ])

      const gatewayStatus: ItemStatus = !vpnConnected
        ? 'skipped'
        : gwPing === null
          ? 'error'
          : pingLatencyStatus(gwPing.latency_ms, gwPing.reachable)

      const firewallStatus: ItemStatus = fwResult === null
        ? 'error'
        : !fwResult.success
          ? 'error'
          : fwResult.rules_added.length > 0
            ? 'warn'
            : 'ok'

      setResults(prev => ({
        ...prev,
        gatewayPing: gwPing, gatewayStatus,
        firewallResult: fwResult, firewallStatus,
      }))

      // ── Phase 3: Online Peers ─────────────────────────────────────────────────

      const peers = await invoke<OnlinePeer[]>('get_online_peers').catch(() => null)
      const peersStatus: ItemStatus = peers === null
        ? 'error'
        : peers.length >= 1 ? 'ok' : 'ok'    // 0 peers = not an error

      setResults(prev => ({
        ...prev,
        onlinePeers: peers,
        peersStatus,
        peerPingsStatus: vpnConnected && peers !== null && peers.length > 0
          ? 'running'
          : 'skipped',
      }))

      // ── Phase 4: Per-peer pings — all in parallel ─────────────────────────────

      if (vpnConnected && peers !== null && peers.length > 0) {
        const pings = await Promise.all(
          peers.map(p =>
            invoke<PeerPingResult>('ping_peer', { tunnelIp: p.tunnel_ip }).catch(() => null),
          ),
        )
        setResults(prev => ({
          ...prev,
          peerPings: pings,
          peerPingsStatus: 'ok',
        }))
      }

    } finally {
      setRunning(false)
    }
  }, [vpnConnected])

  // ── Render ───────────────────────────────────────────────────────────────────

  const {
    apiLatencyMs, apiStatus,
    wgInstalled, wgStatus,
    tunnelConnected, tunnelIpResult, tunnelStatus,
    gatewayPing, gatewayStatus,
    firewallResult, firewallStatus,
    onlinePeers, peersStatus,
    peerPings, peerPingsStatus,
  } = results

  function CheckRow({
    status,
    label,
    value,
    indent = false,
  }: {
    status: ItemStatus
    label: string
    value?: string
    indent?: boolean
  }) {
    return (
      <div style={indent ? ROW_INDENT : ROW}>
        <span style={{ ...ICON_COL, color: STATUS_COLOR[status] }}>
          {STATUS_ICON[status]}
        </span>
        <span style={LABEL_COL}>{label}</span>
        {value !== undefined && (
          <span style={{ ...VALUE_COL, color: STATUS_COLOR[status] }}>{value}</span>
        )}
      </div>
    )
  }

  // Helpers for value display — '' while idle/running so nothing clutters the row

  function apiValue(): string {
    if (apiStatus === 'idle' || apiStatus === 'running') return ''
    if (apiLatencyMs !== null) return `${apiLatencyMs} ms`
    return dt.diagUnreachable ?? '—'
  }

  function wgValue(): string {
    if (wgStatus === 'idle' || wgStatus === 'running') return ''
    if (wgInstalled === null) return '—'
    return wgInstalled ? (dt.diagReachable ?? '✓') : '✗'
  }

  function tunnelValue(): string {
    if (tunnelStatus === 'idle') return tunnelIp ?? ''   // Show known prop IP as hint
    if (tunnelStatus === 'running') return ''
    if (tunnelConnected && tunnelIpResult) return tunnelIpResult
    return ''
  }

  function gatewayValue(): string {
    if (!vpnConnected) return dt.diagVpnRequired ?? 'VPN benötigt'
    if (gatewayStatus === 'idle' || gatewayStatus === 'running') return ''
    if (gatewayPing === null) return dt.diagUnreachable ?? '—'
    return gatewayPing.latency_ms !== null
      ? `${gatewayPing.latency_ms} ms`
      : (dt.diagUnreachable ?? '—')
  }

  function firewallValue(): string {
    if (firewallStatus === 'idle' || firewallStatus === 'running') return ''
    if (firewallResult === null) return dt.diagUnreachable ?? '—'
    if (firewallResult.rules_added.length > 0) return `+${firewallResult.rules_added.length}`
    return dt.diagReachable ?? 'OK'
  }

  function peersValue(): string {
    if (peersStatus === 'idle' || peersStatus === 'running') return ''
    if (onlinePeers === null) return '—'
    if (onlinePeers.length === 0) return dt.diagNoPeers ?? '0'
    return String(onlinePeers.length)
  }

  return (
    <div className="connection-info-panel">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="connection-info-header">
        <span className="connection-info-title">
          {dt.diagTitle ?? 'Diagnose'}
        </span>
        <button
          className="btn btn-primary btn-sm"
          onClick={runDiagnose}
          disabled={running}
        >
          {running
            ? dt.diagRunning ?? '⏳ Läuft...'
            : dt.diagStart ?? 'Diagnose starten'}
        </button>
      </div>

      {/* ── 7-item checklist ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', paddingTop: 6 }}>

        {/* 1. API erreichbar */}
        <CheckRow
          status={apiStatus}
          label={dt.diagApiReachable ?? 'API erreichbar'}
          value={apiValue()}
        />

        {/* 2. WireGuard installiert */}
        <CheckRow
          status={wgStatus}
          label={dt.diagWgInstalled ?? 'WireGuard installiert'}
          value={wgValue()}
        />

        {/* 3. VPN-Tunnel aktiv */}
        <CheckRow
          status={tunnelStatus}
          label={dt.diagTunnelActive ?? 'VPN-Tunnel aktiv'}
          value={tunnelValue()}
        />

        {/* 4. Gateway pingbar (10.8.0.1) — skipped if VPN not connected */}
        <CheckRow
          status={vpnConnected ? gatewayStatus : 'skipped'}
          label={dt.diagGatewayPing ?? 'Gateway pingbar (10.8.0.1)'}
          value={gatewayValue()}
        />

        {/* 5. Firewall-Regeln */}
        <CheckRow
          status={firewallStatus}
          label={dt.diagFirewallRules ?? 'Firewall-Regeln'}
          value={firewallValue()}
        />

        {/* 6. Online Peers (Anzahl) */}
        <CheckRow
          status={peersStatus}
          label={dt.diagOnlinePeers ?? 'Online Peers'}
          value={peersValue()}
        />

        {/* 7. Per-peer pings — indented under Online Peers ─────────────────── */}

        {/* VPN disconnected: one gray "VPN benötigt" row */}
        {!vpnConnected && (
          <div style={{ ...ROW_INDENT }}>
            <span style={{ ...ICON_COL, color: STATUS_COLOR.skipped }}>
              {STATUS_ICON.skipped}
            </span>
            <span style={{ ...LABEL_COL, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {dt.diagVpnRequired ?? 'VPN benötigt'}
            </span>
            <span style={VALUE_COL} />
          </div>
        )}

        {/* VPN connected, pings still running */}
        {vpnConnected && peerPingsStatus === 'running' && (
          <div style={ROW_INDENT}>
            <span style={ICON_COL}>⏳</span>
            <span style={{ ...LABEL_COL, color: 'var(--text-secondary)' }}>
              {'...'}
            </span>
            <span style={VALUE_COL} />
          </div>
        )}

        {/* VPN connected, pings done — one row per peer */}
        {vpnConnected && peerPings !== null && onlinePeers !== null &&
          onlinePeers.map((peer, idx) => {
            const ping = peerPings[idx] ?? null
            const ps: ItemStatus = ping === null
              ? 'error'
              : pingLatencyStatus(ping.latency_ms, ping.reachable)
            return (
              <div key={peer.tunnel_ip} style={ROW_INDENT}>
                <span style={{ ...ICON_COL, color: STATUS_COLOR[ps] }}>
                  {STATUS_ICON[ps]}
                </span>
                <span style={{ ...LABEL_COL, fontFamily: 'monospace', fontSize: 11 }}>
                  {peer.name}
                  <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                    {peer.tunnel_ip}
                  </span>
                </span>
                <span style={{ ...VALUE_COL, color: STATUS_COLOR[ps] }}>
                  {ping !== null
                    ? (ping.latency_ms !== null
                        ? `${ping.latency_ms} ms`
                        : (dt.diagUnreachable ?? '—'))
                    : (dt.diagUnreachable ?? '—')}
                </span>
              </div>
            )
          })
        }

      </div>
    </div>
  )
}

export { DiagnosePanel }
export type { DiagnosePanelProps }
