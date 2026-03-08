/// ConnectionInfoPanel.tsx — Network Dashboard with 4 sections

import { type FC, useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '../i18n/LanguageContext'

// ─── Exported Types ──────────────────────────────────────────────────────────

export interface MyPeerStats {
  name: string
  tunnel_ip: string
  connection_quality: string // 'good' | 'warning' | 'offline'
  last_handshake_ago: number | null
  rx_bytes: number
  tx_bytes: number
}

export interface PingResult {
  gateway_ip: string
  latency_ms: number | null
  reachable: boolean
}

// ─── Internal Types ──────────────────────────────────────────────────────────

interface ConnectionInfo {
  tunnel_ip: string | null
  server_url: string | null
  vpn_mode: string
  api_latency_ms: number | null
  wireguard_installed: boolean
  peer_name: string | null
}

export interface ConnectionInfoPanelProps {
  visible: boolean
  myStats: MyPeerStats | null
  pingResult: PingResult | null
  statsLoading: boolean
  vpnMode: string
}

// ─── Port label keys (strict subset of Translations) ─────────────────────────

type PortLabelKey =
  | 'portGameTraffic'
  | 'portSteamQuery'
  | 'portSteamPort'
  | 'portVoice'
  | 'portBattlEye'

interface PortEntry {
  port: number
  protocol: string
  labelKey: PortLabelKey
}

const ARMA3_PORTS: PortEntry[] = [
  { port: 2302, protocol: 'UDP', labelKey: 'portGameTraffic' },
  { port: 2303, protocol: 'UDP', labelKey: 'portSteamQuery' },
  { port: 2304, protocol: 'UDP', labelKey: 'portSteamPort' },
  { port: 2305, protocol: 'UDP', labelKey: 'portVoice' },
  { port: 2306, protocol: 'UDP', labelKey: 'portBattlEye' },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatBytesRaw(bytes: number): string {
  return `${bytes.toLocaleString()} B`
}

function trafficBarPct(bytes: number, maxBytes: number): number {
  if (maxBytes === 0) return 0
  return Math.min(100, (bytes / maxBytes) * 100)
}

function latencyClass(ms: number): string {
  if (ms < 50) return 'latency-good'
  if (ms <= 150) return 'latency-warn'
  return 'latency-bad'
}

function latencyBarPct(ms: number): number {
  return Math.min(100, (ms / 500) * 100)
}

function truncateUrl(url: string, maxLen = 36): string {
  if (url.length <= maxLen) return url
  return url.slice(0, maxLen - 1) + '\u2026'
}

// ─── Component ───────────────────────────────────────────────────────────────

export const ConnectionInfoPanel: FC<ConnectionInfoPanelProps> = ({
  visible,
  myStats,
  pingResult,
  statsLoading,
  vpnMode,
}) => {
  const { t } = useTranslation()
  const [info, setInfo] = useState<ConnectionInfo | null>(null)
  const [infoLoading, setInfoLoading] = useState(false)

  const fetchInfo = useCallback(async () => {
    setInfoLoading(true)
    try {
      const data = await invoke<ConnectionInfo>('get_connection_info')
      setInfo(data)
    } catch {
      // ignore
    } finally {
      setInfoLoading(false)
    }
  }, [])

  useEffect(() => {
    if (visible) {
      fetchInfo()
    }
  }, [visible, fetchInfo])

  if (!visible) return null

  const maxBytes = myStats
    ? Math.max(myStats.rx_bytes, myStats.tx_bytes, 1)
    : 1

  return (
    <div className="connection-info-panel">
      {/* Panel Header */}
      <div className="connection-info-header">
        <span className="connection-info-title">{t.netDashTitle}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {info !== null && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {'🔧 WireGuard: '}
              <span className={info.wireguard_installed ? 'latency-good' : 'latency-bad'}>
                {info.wireguard_installed ? '✓' : '✗'}
              </span>
              {info.server_url != null && (
                <span style={{ marginLeft: 10 }}>
                  {'🖥️ '}{truncateUrl(info.server_url)}
                </span>
              )}
            </span>
          )}
          <button
            className="connection-info-refresh"
            onClick={fetchInfo}
            disabled={infoLoading || statsLoading}
            title="Refresh"
          >
            {infoLoading || statsLoading ? '⏳' : '🔄'}
          </button>
        </div>
      </div>

      {/* 4-section dashboard grid */}
      <div className="net-dashboard-grid">

        {/* ── Section 1: Traffic Stats ── */}
        <div className="net-section">
          <div className="net-section-title">{t.trafficTitle}</div>
          {myStats !== null ? (
            <div className="traffic-stats">
              {/* Download row */}
              <div className="traffic-row">
                <span className="traffic-icon">📥</span>
                <div className="traffic-info">
                  <div className="traffic-label">{t.trafficDownload}</div>
                  <div className="traffic-value">{formatBytes(myStats.rx_bytes)}</div>
                  <div className="traffic-bar" title={formatBytesRaw(myStats.rx_bytes)}>
                    <div
                      className="traffic-bar-fill download"
                      style={{ width: `${trafficBarPct(myStats.rx_bytes, maxBytes)}%` }}
                    />
                  </div>
                  <div className="traffic-raw">{formatBytesRaw(myStats.rx_bytes)}</div>
                </div>
              </div>
              {/* Upload row */}
              <div className="traffic-row">
                <span className="traffic-icon">📤</span>
                <div className="traffic-info">
                  <div className="traffic-label">{t.trafficUpload}</div>
                  <div className="traffic-value">{formatBytes(myStats.tx_bytes)}</div>
                  <div className="traffic-bar" title={formatBytesRaw(myStats.tx_bytes)}>
                    <div
                      className="traffic-bar-fill upload"
                      style={{ width: `${trafficBarPct(myStats.tx_bytes, maxBytes)}%` }}
                    />
                  </div>
                  <div className="traffic-raw">{formatBytesRaw(myStats.tx_bytes)}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="net-section-empty">—</div>
          )}
        </div>

        {/* ── Section 2: Latency / Ping ── */}
        <div className="net-section">
          <div className="net-section-title">{t.latencyTitle}</div>
          {pingResult !== null ? (
            <div className="latency-stats">
              <div className="latency-gateway-row">
                <span className="ci-label">{t.latencyGateway}</span>
                <span className="ci-value" style={{ fontFamily: 'monospace' }}>
                  {pingResult.gateway_ip}
                </span>
              </div>
              <div className="latency-value-row">
                <span
                  className={`latency-value ${
                    pingResult.latency_ms !== null
                      ? latencyClass(pingResult.latency_ms)
                      : 'latency-bad'
                  }`}
                >
                  {pingResult.latency_ms !== null ? `${pingResult.latency_ms} ms` : '—'}
                </span>
                <span
                  className={`reachable-badge ${pingResult.reachable ? 'reachable' : 'unreachable'}`}
                >
                  {pingResult.reachable ? t.latencyReachable : t.latencyUnreachable}
                </span>
              </div>
              {pingResult.latency_ms !== null && (
                <div className="latency-meter">
                  <div
                    className={`latency-meter-fill ${latencyClass(pingResult.latency_ms)}`}
                    style={{ width: `${latencyBarPct(pingResult.latency_ms)}%` }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="net-section-empty">—</div>
          )}
        </div>

        {/* ── Section 3: Arma 3 Ports ── */}
        <div className="net-section">
          <div className="net-section-title">{t.portsTitle}</div>
          <div className={`ports-mode-badge ${vpnMode === 'arma3' ? 'arma3' : 'open'}`}>
            {vpnMode === 'arma3' ? t.portsArmaOnly : t.portsOpenMode}
          </div>
          <div className="port-table">
            {ARMA3_PORTS.map(({ port, protocol, labelKey }) => (
              <div className="port-row" key={port}>
                <span className="port-number">{port}</span>
                <span className="port-protocol">{protocol}</span>
                <span className="port-label">{t[labelKey]}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Section 4: Own Peer Stats ── */}
        <div className="net-section">
          <div className="net-section-title">{t.peerStatsTitle}</div>
          {myStats !== null ? (
            <div className="peer-stats">
              <div className="peer-name-row">
                <span className={`quality-dot ${myStats.connection_quality}`} />
                <span className="peer-name-value">{myStats.name}</span>
              </div>
              <div className="connection-info-grid">
                <span className="ci-label">🌐 Tunnel IP</span>
                <span className="ci-value" style={{ fontFamily: 'monospace' }}>
                  {myStats.tunnel_ip}
                </span>
                <span className="ci-label">{t.lastHandshake}</span>
                <span className="ci-value">
                  {myStats.last_handshake_ago !== null
                    ? `${myStats.last_handshake_ago}${t.secondsAgo}`
                    : t.neverConnected}
                </span>
                <span className="ci-label">Status</span>
                <span
                  className={`ci-value quality-label ${myStats.connection_quality}`}
                >
                  {myStats.connection_quality}
                </span>
              </div>
            </div>
          ) : (
            <div className="net-section-empty">—</div>
          )}
        </div>

      </div>
    </div>
  )
}
