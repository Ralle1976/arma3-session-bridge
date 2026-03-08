/// VpnStatusBar.tsx — Persistent status bar shown when VPN is connected

import { type FC, useState, useEffect } from 'react'
import { useTranslation } from '../i18n/LanguageContext'

// ─── Types ──────────────────────────────────────────────────────────────────

interface VpnStatusBarProps {
  tunnelIp: string | null
  vpnMode: string
  peerName: string | null
  connectionStartTime: number | null
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

  // Only render when connected (tunnel IP + start time available)
  if (!tunnelIp || !connectionStartTime) return null

  const isArmaMode = vpnMode === 'arma3'

  return (
    <div className="vpn-status-bar">
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
    </div>
  )
}

export default VpnStatusBar
