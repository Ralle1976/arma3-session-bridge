/// VpnStatusBar.tsx — Persistent status bar shown when VPN is connected

import { type FC, useState, useEffect } from 'react'
import { useTranslation } from '../i18n/LanguageContext'

// ─── Types ──────────────────────────────────────────────────────────────────

interface VpnStatusBarProps {
  tunnelIp: string | null
  vpnMode: string
  peerName: string | null
  connectionStartTime: number | null
  /** Number of reconnect attempts currently in progress (0 = not reconnecting). */
  reconnectAttempt?: number
  /** Human-readable reason for the current state (from state machine event). */
  stateReason?: string
  /** True when state is Reconnecting or Error — renders a degraded banner. */
  degraded?: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

// ─── Component ───────────────────────────────────────────────────────────────

export const VpnStatusBar: FC<VpnStatusBarProps> = ({
  tunnelIp,
  vpnMode,
  peerName,
  connectionStartTime,
  reconnectAttempt = 0,
  stateReason = '',
  degraded = false,
}) => {
  const { t } = useTranslation()
  const [elapsed, setElapsed] = useState<string>('00:00')

  useEffect(() => {
    if (!connectionStartTime) {
      setElapsed('00:00')
      return
    }
    const update = () => {
      setElapsed(formatDuration(Date.now() - connectionStartTime))
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [connectionStartTime])

  // Render when connected (tunnel IP + start time) OR when degraded (reconnecting/error)
  if (!tunnelIp && !degraded) return null

  const isArmaMode = vpnMode === 'arma3'

  return (
    <div className={`vpn-status-bar${degraded ? ' vpn-status-bar--degraded' : ''}`}>
      {/* Degraded banner: reconnecting / error */}
      {degraded && (
        <div className="vsb-degraded-banner">
          <span className="vsb-degraded-icon">⚠️</span>
          <span className="vsb-degraded-label">
            {reconnectAttempt > 0
              ? `${t.vpnReconnecting} · ${t.vpnReconnectAttempt(reconnectAttempt)}`
              : t.vpnStateError}
          </span>
          {stateReason && (
            <span className="vsb-degraded-reason">— {stateReason}</span>
          )}
        </div>
      )}

      {/* Main status row — only shown when tunnel IP is available */}
      {tunnelIp && (
        <>
          {/* Left: tunnel IP + peer name */}
          <div className="vsb-left">
            <span className="vsb-item">
              🌐 <code className="vsb-value">{tunnelIp}</code>
            </span>
            {peerName && (
              <span className="vsb-item">
                👤 <span className="vsb-peer">{peerName}</span>
              </span>
            )}
          </div>

          {/* Center: VPN mode badge */}
          <div className="vsb-center">
            <span className={`vpn-mode-badge ${isArmaMode ? 'arma3' : 'open'}`}>
              {isArmaMode ? t.vpnModeArma : t.vpnModeOpen}
            </span>
          </div>

          {/* Right: connection timer */}
          <div className="vsb-right">
            <span className="vsb-item">
              <span className="vsb-timer-label">{t.connectionTime}</span>
              <span className="connection-timer">{elapsed}</span>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

export default VpnStatusBar
