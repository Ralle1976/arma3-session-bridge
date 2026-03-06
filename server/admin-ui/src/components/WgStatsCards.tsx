import { useQuery } from '@tanstack/react-query'
import { fetchWgStats, type PeerStat } from '../api/wgStats'
import { formatBytes } from './StatsCards'

function formatHandshake(ago: number | null): string {
  if (ago === null) return 'Never'
  if (ago < 60) return `${ago}s ago`
  if (ago < 3600) return `${Math.floor(ago / 60)}m ago`
  return `${Math.floor(ago / 3600)}h ago`
}

function qualityColor(q: PeerStat['connection_quality']) {
  switch (q) {
    case 'good':    return 'text-green-400 bg-green-900/20 border-green-700/40'
    case 'warning': return 'text-yellow-400 bg-yellow-900/20 border-yellow-700/40'
    case 'offline': return 'text-red-400 bg-red-900/20 border-red-700/40'
  }
}

function qualityDot(q: PeerStat['connection_quality']) {
  switch (q) {
    case 'good':    return 'bg-green-500 animate-pulse'
    case 'warning': return 'bg-yellow-500'
    case 'offline': return 'bg-red-500'
  }
}

function qualityLabel(q: PeerStat['connection_quality']) {
  switch (q) {
    case 'good':    return 'Connected'
    case 'warning': return 'Unstable'
    case 'offline': return 'Offline'
  }
}

function PeerCard({ peer }: { peer: PeerStat }) {
  const shortKey = peer.public_key.slice(0, 12) + '…'
  const cls = qualityColor(peer.connection_quality)

  return (
    <div className={`card border ${cls} space-y-3`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${qualityDot(peer.connection_quality)}`} />
          <span className="font-mono text-sm text-gray-300" title={peer.public_key}>
            {shortKey}
          </span>
        </div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
          {qualityLabel(peer.connection_quality)}
        </span>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <p className="text-gray-500">Last Handshake</p>
          <p className="text-gray-200 font-mono">{formatHandshake(peer.last_handshake_ago)}</p>
        </div>
        <div>
          <p className="text-gray-500">Tunnel IP</p>
          <p className="text-gray-200 font-mono">{peer.allowed_ips.replace('/32', '')}</p>
        </div>
        <div>
          <p className="text-gray-500">↓ Received</p>
          <p className="text-gray-200 font-mono">{formatBytes(peer.transfer_rx_bytes)}</p>
        </div>
        <div>
          <p className="text-gray-500">↑ Sent</p>
          <p className="text-gray-200 font-mono">{formatBytes(peer.transfer_tx_bytes)}</p>
        </div>
      </div>

      {/* Endpoint */}
      {peer.endpoint && (
        <p className="text-xs text-gray-600 font-mono truncate" title={peer.endpoint}>
          {peer.endpoint}
        </p>
      )}
    </div>
  )
}

export default function WgStatsCards() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['wg-stats'],
    queryFn: fetchWgStats,
    refetchInterval: 15_000,
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="card text-gray-500 text-sm animate-pulse">
        Loading WireGuard peer stats…
      </div>
    )
  }

  if (isError || !data) {
    return (
      <div className="card text-gray-600 text-sm">
        WireGuard stats unavailable (interface may be down)
      </div>
    )
  }

  if (data.peers.length === 0) {
    return (
      <div className="card text-gray-600 text-sm">
        No peers registered yet — create a peer to see live stats here.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
        Live Peer Status ({data.peers.length})
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {data.peers.map((peer) => (
          <PeerCard key={peer.public_key} peer={peer} />
        ))}
      </div>
    </div>
  )
}
