/// ConnectionInfoPanel.tsx — Expandable VPN connection diagnostics panel

import { type FC, useEffect, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ConnectionInfo {
  tunnel_ip: string | null
  server_url: string | null
  vpn_mode: string
  api_latency_ms: number | null
  wireguard_installed: boolean
  peer_name: string | null
}

interface ConnectionInfoPanelProps {
  visible: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function latencyClass(ms: number): string {
  if (ms < 100) return 'latency-good'
  if (ms <= 500) return 'latency-warn'
  return 'latency-bad'
}

function truncateUrl(url: string, maxLen = 36): string {
  if (url.length <= maxLen) return url
  return url.slice(0, maxLen - 1) + '…'
}

// ─── Component ───────────────────────────────────────────────────────────────

export const ConnectionInfoPanel: FC<ConnectionInfoPanelProps> = ({ visible }) => {
  const [info, setInfo] = useState<ConnectionInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchInfo = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await invoke<ConnectionInfo>('get_connection_info')
      setInfo(data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (visible) {
      fetchInfo()
    }
  }, [visible, fetchInfo])

  if (!visible) return null

  return (
    <div className="connection-info-panel">
      <div className="connection-info-header">
        <span className="connection-info-title">Connection Diagnostics</span>
        <button
          className="connection-info-refresh"
          onClick={fetchInfo}
          disabled={loading}
          title="Refresh diagnostics"
        >
          {loading ? '⏳' : '🔄'}
        </button>
      </div>

      {error !== null && (
        <div className="connection-info-error">⚠️ {error}</div>
      )}

      {info !== null && (
        <div className="connection-info-grid">
          <span className="ci-label">🌐 Tunnel IP</span>
          <span className="ci-value">{info.tunnel_ip ?? '—'}</span>

          <span className="ci-label">🖥️ Server</span>
          <span className="ci-value ci-server">
            {info.server_url != null ? truncateUrl(info.server_url) : '—'}
          </span>

          <span className="ci-label">🔀 VPN Mode</span>
          <span className="ci-value">
            {info.vpn_mode === 'full-tunnel' ? 'Full-Tunnel' : 'Split-Tunnel'}
          </span>

          <span className="ci-label">⚡ API Latency</span>
          <span className={`ci-value ${info.api_latency_ms != null ? latencyClass(info.api_latency_ms) : ''}`}>
            {info.api_latency_ms != null ? `${info.api_latency_ms}ms` : '—'}
          </span>

          <span className="ci-label">🔧 WireGuard</span>
          <span className={`ci-value ${info.wireguard_installed ? 'latency-good' : 'latency-bad'}`}>
            {info.wireguard_installed ? 'Installed ✓' : 'Missing ✗'}
          </span>

          <span className="ci-label">👤 Peer</span>
          <span className="ci-value">{info.peer_name ?? '—'}</span>
        </div>
      )}

      {info === null && !loading && error === null && (
        <div className="connection-info-empty">No data yet.</div>
      )}
    </div>
  )
}
