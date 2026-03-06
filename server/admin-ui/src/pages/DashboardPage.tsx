import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import apiClient from '../api/client'

interface AdminStats {
  connected_peers: number
  active_sessions: number
  total_sessions: number
  uptime_seconds: number
  wg_traffic_rx?: number
  wg_traffic_tx?: number
}

interface HealthStatus {
  status: string
  version?: string
  uptime?: number
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function StatCard({
  label,
  value,
  color = 'blue',
  sub,
}: {
  label: string
  value: string | number
  color?: string
  sub?: string
}) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-400 bg-blue-900/20 border-blue-800/40',
    green: 'text-green-400 bg-green-900/20 border-green-800/40',
    yellow: 'text-yellow-400 bg-yellow-900/20 border-yellow-800/40',
    purple: 'text-purple-400 bg-purple-900/20 border-purple-800/40',
  }
  const cls = colorMap[color] ?? colorMap.blue

  return (
    <div className={`card border ${cls}`}>
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold font-mono ${cls.split(' ')[0]}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </div>
  )
}

export default function DashboardPage() {
  const queryClient = useQueryClient()

  const { data: health, isLoading: healthLoading, isError: healthError } = useQuery<HealthStatus>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await apiClient.get<HealthStatus>('/health')
      return res.data
    },
    refetchInterval: 30_000,
  })

  const { data: stats } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: async () => {
      const res = await apiClient.get<AdminStats>('/admin/stats')
      return res.data
    },
    refetchInterval: 30_000,
    // Don't throw if endpoint isn't ready yet
    retry: false,
  })

  // SSE: subscribe to admin events for live dashboard updates
  const sseRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const BASE = import.meta.env.VITE_API_URL ?? '/api'
    const token = localStorage.getItem('admin_token') ?? ''
    const url = `${BASE}/admin/events?token=${encodeURIComponent(token)}`

    const es = new EventSource(url, { withCredentials: true })
    sseRef.current = es

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      void queryClient.invalidateQueries({ queryKey: ['peers'] })
    }

    es.addEventListener('session_started', refresh)
    es.addEventListener('session_ended', refresh)
    es.addEventListener('peer_created', refresh)
    es.addEventListener('peer_deleted', refresh)
    es.onmessage = refresh
    es.onerror = () => { /* silent */ }

    return () => {
      es.close()
      sseRef.current = null
    }
  }, [queryClient])

  return (
    <div className="p-4 md:p-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-100">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">System overview and status</p>
      </div>

      {/* Status Banner */}
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-8 text-sm font-medium ${ healthLoading
          ? 'bg-gray-800 text-gray-400'
          : healthError
          ? 'bg-red-900/30 text-red-400 border border-red-800/50'
          : 'bg-green-900/30 text-green-400 border border-green-800/50'
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${ healthLoading
            ? 'bg-gray-500'
            : healthError
            ? 'bg-red-500'
            : 'bg-green-500 animate-pulse'
          }`}
        />
        {healthLoading
          ? 'Checking API status…'
          : healthError
          ? 'API unreachable — backend may be offline'
          : `API online — ${health?.status ?? 'healthy'}`}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
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
          value={
            stats?.uptime_seconds != null
              ? formatUptime(stats.uptime_seconds)
              : health?.uptime != null
              ? formatUptime(health.uptime)
              : '—'
          }
          color="yellow"
        />
        <StatCard
          label="WG Traffic"
          value={
            stats?.wg_traffic_rx != null || stats?.wg_traffic_tx != null
              ? `↑${formatBytes(stats?.wg_traffic_tx)} ↓${formatBytes(stats?.wg_traffic_rx)}`
              : '—'
          }
          color="purple"
          sub={stats?.total_sessions != null ? `${stats.total_sessions} total sessions` : undefined}
        />
      </div>

      {/* Activity area */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-300 mb-4">Session Activity</h2>
        <div className="h-48 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-lg">
          <div className="text-center">
            <svg className="w-10 h-10 text-gray-700 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-gray-600 text-sm">
              {stats ? `${stats.total_sessions} sessions recorded` : 'Chart data will appear here'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
