export interface AdminStats {
  connected_peers: number
  active_sessions: number
  total_sessions: number
  uptime_seconds: number
  wg_traffic_rx?: number
  wg_traffic_tx?: number
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function formatBytes(bytes?: number): string {
  if (bytes == null || bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

type CardColor = 'blue' | 'green' | 'yellow' | 'purple'

const colorMap: Record<CardColor, string> = {
  blue: 'text-blue-400 bg-blue-900/20 border-blue-800/40',
  green: 'text-green-400 bg-green-900/20 border-green-800/40',
  yellow: 'text-yellow-400 bg-yellow-900/20 border-yellow-800/40',
  purple: 'text-purple-400 bg-purple-900/20 border-purple-800/40',
}

interface StatCardProps {
  label: string
  value: string | number
  color?: CardColor
  sub?: string
}

function StatCard({ label, value, color = 'blue', sub }: StatCardProps) {
  const cls = colorMap[color]
  return (
    <div className={`card border ${cls}`}>
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold font-mono ${cls.split(' ')[0]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </div>
  )
}

interface StatsCardsProps {
  stats?: AdminStats
  uptimeFallback?: number
}

export default function StatsCards({ stats, uptimeFallback }: StatsCardsProps) {
  const uptime =
    stats?.uptime_seconds != null
      ? formatUptime(stats.uptime_seconds)
      : uptimeFallback != null
      ? formatUptime(uptimeFallback)
      : '—'

  const trafficValue =
    stats?.wg_traffic_rx != null || stats?.wg_traffic_tx != null
      ? `↑${formatBytes(stats?.wg_traffic_tx)} ↓${formatBytes(stats?.wg_traffic_rx)}`
      : '—'

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Connected Peers"
        value={stats?.connected_peers ?? '—'}
        color="blue"
      />
      <StatCard
        label="Active Sessions"
        value={stats?.active_sessions ?? '—'}
        color="green"
      />
      <StatCard
        label="Server Uptime"
        value={uptime}
        color="yellow"
      />
      <StatCard
        label="WG Traffic"
        value={trafficValue}
        color="purple"
        sub={stats?.total_sessions != null ? `${stats.total_sessions} total sessions` : undefined}
      />
    </div>
  )
}
