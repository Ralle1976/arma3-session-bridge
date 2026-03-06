import { useQuery } from '@tanstack/react-query'
import apiClient from '../api/client'

interface HealthStatus {
  status: string
  version?: string
  uptime?: number
}

function StatCard({ label, value, color = 'blue' }: { label: string; value: string | number; color?: string }) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-400 bg-blue-900/20 border-blue-800/40',
    green: 'text-green-400 bg-green-900/20 border-green-800/40',
    yellow: 'text-yellow-400 bg-yellow-900/20 border-yellow-800/40',
    red: 'text-red-400 bg-red-900/20 border-red-800/40',
  }

  return (
    <div className={`card border ${colorMap[color] ?? colorMap.blue}`}>
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-3xl font-bold font-mono ${colorMap[color]?.split(' ')[0]}`}>{value}</p>
    </div>
  )
}

export default function DashboardPage() {
  const { data: health, isLoading, isError } = useQuery<HealthStatus>({
    queryKey: ['health'],
    queryFn: async () => {
      const res = await apiClient.get<HealthStatus>('/health')
      return res.data
    },
    refetchInterval: 30_000,
  })

  return (
    <div className="p-8">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-100">Dashboard</h1>
        <p className="text-gray-500 text-sm mt-1">System overview and status</p>
      </div>

      {/* Status Banner */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-lg mb-8 text-sm font-medium ${
        isLoading ? 'bg-gray-800 text-gray-400' :
        isError ? 'bg-red-900/30 text-red-400 border border-red-800/50' :
        'bg-green-900/30 text-green-400 border border-green-800/50'
      }`}>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          isLoading ? 'bg-gray-500' :
          isError ? 'bg-red-500' :
          'bg-green-500 animate-pulse'
        }`} />
        {isLoading ? 'Checking API status…' :
         isError ? 'API unreachable — backend may be offline' :
         `API online — ${health?.status ?? 'healthy'}`}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Active Peers" value="—" color="blue" />
        <StatCard label="Active Sessions" value="—" color="green" />
        <StatCard label="Total Sessions" value="—" color="yellow" />
        <StatCard label="Uptime" value={health?.uptime ? `${Math.floor(health.uptime / 60)}m` : '—'} color="blue" />
      </div>

      {/* Placeholder Chart Area */}
      <div className="card">
        <h2 className="text-base font-semibold text-gray-300 mb-4">Session Activity</h2>
        <div className="h-48 flex items-center justify-center border-2 border-dashed border-gray-800 rounded-lg">
          <div className="text-center">
            <svg className="w-10 h-10 text-gray-700 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-gray-600 text-sm">Chart data will appear here</p>
          </div>
        </div>
      </div>
    </div>
  )
}
