import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import apiClient from '../api/client'
import type { AdminStats } from './StatsCards'
import { formatBytes } from './StatsCards'

interface TrafficPoint {
  time: number
  timeLabel: string
  rx: number
  tx: number
}

/** Max data points to keep in the rolling window */
const MAX_POINTS = 30

function formatTimeTick(value: number): string {
  const d = new Date(value)
  const h = d.getHours().toString().padStart(2, '0')
  const m = d.getMinutes().toString().padStart(2, '0')
  const s = d.getSeconds().toString().padStart(2, '0')
  return `${h}:${m}:${s}`
}

// Custom tooltip formatter
function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: number
}) {
  if (!active || !payload?.length) return null

  return (
    <div className="bg-[rgba(12,20,34,0.95)] backdrop-blur-xl border border-glass-strong rounded-lg px-3 py-2 text-xs shadow-glass-lg">
      <p className="text-gray-400 mb-1">{label != null ? formatTimeTick(label) : ''}</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }} className="font-mono">
          {entry.name}: {formatBytes(entry.value)}
        </p>
      ))}
    </div>
  )
}

export default function TrafficChart() {
  const [history, setHistory] = useState<TrafficPoint[]>([])
  const prevRx = useRef<number | null>(null)
  const prevTx = useRef<number | null>(null)

  const { data: stats } = useQuery<AdminStats>({
    queryKey: ['stats'],
    queryFn: async () => {
      const res = await apiClient.get<AdminStats>('/admin/stats')
      return res.data
    },
    refetchInterval: 10_000,
    retry: false,
  })

  useEffect(() => {
    if (!stats) return

    const now = Date.now()
    const rx = stats.wg_traffic_rx ?? 0
    const tx = stats.wg_traffic_tx ?? 0

    // Calculate delta bytes since last poll (rate)
    const deltaRx = prevRx.current != null ? Math.max(0, rx - prevRx.current) : 0
    const deltaTx = prevTx.current != null ? Math.max(0, tx - prevTx.current) : 0

    prevRx.current = rx
    prevTx.current = tx

    const point: TrafficPoint = {
      time: now,
      timeLabel: formatTimeTick(now),
      rx: deltaRx,
      tx: deltaTx,
    }

    setHistory((prev) => {
      const updated = [...prev, point]
      return updated.slice(-MAX_POINTS)
    })
  }, [stats])

  const hasData = history.length > 1

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-gray-300">WireGuard Traffic</h2>
        <span className="text-xs text-gray-600">Last {MAX_POINTS} samples · 10s interval</span>
      </div>

      {!hasData ? (
        <div className="h-48 flex items-center justify-center border-2 border-dashed border-glass-strong rounded-lg">
          <div className="text-center">
            <svg
              className="w-10 h-10 text-gray-700 mx-auto mb-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            <p className="text-gray-600 text-sm">Collecting traffic data…</p>
          </div>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={history} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(59,130,246,0.06)" />
            <XAxis
              dataKey="time"
              type="number"
              domain={['dataMin', 'dataMax']}
              tickFormatter={formatTimeTick}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: '#374151' }}
            />
            <YAxis
              tickFormatter={(v: number) => formatBytes(v)}
              tick={{ fill: '#6b7280', fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={70}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: '12px', color: '#9ca3af' }}
            />
            <Line
              type="monotone"
              dataKey="rx"
              name="RX (↓)"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
            <Line
              type="monotone"
              dataKey="tx"
              name="TX (↑)"
              stroke="#ef4444"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
