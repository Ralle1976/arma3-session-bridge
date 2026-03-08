import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import apiClient from '../api/client'
import StatsCards from '../components/StatsCards'
import TrafficChart from '../components/TrafficChart'
import EventLog from '../components/EventLog'
import OptimizationBadges from '../components/OptimizationBadges'
import WgStatsCards from '../components/WgStatsCards'
import type { AdminStats } from '../components/StatsCards'

interface HealthStatus {
  status: string
  version?: string
  uptime?: number
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
    queryKey: ['stats'],
    queryFn: async () => {
      const res = await apiClient.get<AdminStats>('/admin/stats')
      return res.data
    },
    refetchInterval: 10_000,
    retry: false,
  })

  // SSE: invalidate queries on events (keep dashboard reactive)
  const sseRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const BASE = import.meta.env.VITE_API_URL ?? '/api'
    const token = localStorage.getItem('admin_token') ?? ''
    const url = `${BASE}/admin/events?token=${encodeURIComponent(token)}`

    const es = new EventSource(url, { withCredentials: true })
    sseRef.current = es

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['stats'] })
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
    <div className="p-4 md:p-8 space-y-8">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-100">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">System overview and live monitoring</p>
      </div>

      {/* Status Banner */}
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium backdrop-blur-glass ${
          healthLoading
            ? 'bg-raised/60 border border-glass text-gray-400'
            : healthError
            ? 'bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.4)] text-red-400 shadow-glow-red'
            : 'bg-[rgba(22,90,50,0.3)] border border-[rgba(34,197,94,0.4)] text-green-400 shadow-glow-green'
        }`}
      >
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            healthLoading
              ? 'bg-gray-500'
              : healthError
              ? 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
              : 'bg-green-500 animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.5)]'
          }`}
        />
        {healthLoading
          ? 'Checking API status…'
          : healthError
          ? 'API unreachable — backend may be offline'
          : `API online — ${health?.status ?? 'healthy'}`}
      </div>

      {/* Stats Grid */}
      <StatsCards stats={stats} uptimeFallback={health?.uptime} />

      {/* Optimization Badges */}
      <OptimizationBadges mtu={1420} keepalive={25} serverTuning={false} />

      {/* Live Peer Status */}
      <WgStatsCards />

      {/* Traffic Chart + Event Log side-by-side on wide screens */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <TrafficChart />
        <EventLog />
      </div>
    </div>
  )
}
