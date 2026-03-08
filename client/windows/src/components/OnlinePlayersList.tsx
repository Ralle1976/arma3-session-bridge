/// OnlinePlayersList.tsx — Shows connected VPN peers within the Sessions tab

import { type FC } from 'react'
import { useTranslation } from '../i18n/LanguageContext'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OnlinePeer {
  name: string
  tunnel_ip: string
  connection_quality: string
  last_handshake_ago: number | null
}

interface OnlinePlayersListProps {
  peers: OnlinePeer[]
  loading: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function qualityDotClass(quality: string): string {
  if (quality === 'good') return 'quality-dot good'
  if (quality === 'warning') return 'quality-dot warning'
  return 'quality-dot offline'
}

// ─── Component ───────────────────────────────────────────────────────────────

export const OnlinePlayersList: FC<OnlinePlayersListProps> = ({ peers, loading }) => {
  const { t } = useTranslation()

  return (
    <div className="online-players-card">
      <div className="online-players-header">
        <span className="section-title">
          {t.onlinePlayersTitle} ({peers.length})
        </span>
        {loading && <span className="online-players-spinner">⟳</span>}
      </div>

      {loading && peers.length === 0 ? (
        <div className="online-players-empty">{t.onlinePlayersLoading}</div>
      ) : peers.length === 0 ? (
        <div className="online-players-empty">{t.onlinePlayersEmpty}</div>
      ) : (
        <div className="online-players-list">
          {peers.map((peer, i) => (
            <div key={`${peer.name}-${i}`} className="online-player-row">
              <span className={qualityDotClass(peer.connection_quality)} />
              <span className="player-name">{peer.name}</span>
              <code className="player-ip">{peer.tunnel_ip}</code>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default OnlinePlayersList
