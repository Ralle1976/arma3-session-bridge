import { useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listSessions, type Session } from '../api/sessions'

function formatDuration(seconds?: number | null) {
  if (!seconds) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function SessionsPage() {
  const queryClient = useQueryClient()

  const { data: sessions, isLoading, isError } = useQuery<Session[]>({
    queryKey: ['sessions'],
    queryFn: listSessions,
    refetchInterval: 30_000,
  })

  // SSE: subscribe to /api/admin/events for live updates
  const sseRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const BASE = import.meta.env.VITE_API_URL ?? '/api'
    const token = localStorage.getItem('admin_token') ?? ''
    const url = `${BASE}/admin/events?token=${encodeURIComponent(token)}`

    const es = new EventSource(url, { withCredentials: true })
    sseRef.current = es

    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    }

    es.addEventListener('session_started', refresh)
    es.addEventListener('session_ended', refresh)
    es.addEventListener('session_updated', refresh)
    es.onmessage = refresh
    es.onerror = () => { /* silent — polling covers us */ }

    return () => {
      es.close()
      sseRef.current = null
    }
  }, [queryClient])

  const activeSessions = sessions?.filter((s) => s.active) ?? []
  const historySessions = sessions?.filter((s) => !s.active) ?? []

  return (
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Sessions</h1>
          <p className="text-gray-500 text-sm mt-1">
            Active &amp; historical VPN sessions
            {sessions && (
              <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-green-900/40 text-green-400 border border-green-800/50">
                {activeSessions.length} active
              </span>
            )}
          </p>
        </div>
        {/* SSE live indicator */}
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Live
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <svg className="animate-spin w-6 h-6 mr-3" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading sessions…
        </div>
      )}

      {isError && (
        <div className="card border-red-800/50 bg-red-900/10 text-red-400 text-sm">
          Failed to load sessions. API may be offline.
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {/* Active Sessions */}
          {activeSessions.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
                Active Sessions
              </h2>
              <div className="space-y-2">
                {activeSessions.map((session) => (
                  <div key={session.id} className="card border-green-800/30 bg-green-900/5 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
                      <div>
                        <p className="font-medium text-gray-200">{session.peer_name}</p>
                        {session.arma_player && (
                          <p className="text-xs text-gray-500">Player: {session.arma_player}</p>
                        )}
                        {session.mission && (
                          <p className="text-xs text-gray-600">
                            {session.mission}
                            {session.map_name ? ` — ${session.map_name}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-green-400 font-mono">
                        {formatDuration(session.duration_seconds)}
                      </p>
                      <p className="text-xs text-gray-600">
                        {new Date(session.started_at).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Session History */}
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Session History
            </h2>
            <div className="card p-0 overflow-hidden overflow-x-auto">
              <table className="w-full min-w-[600px]">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-800/40">
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Peer</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Player</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Started</th>
                    <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/60">
                  {historySessions.length > 0 ? (
                    historySessions.slice(0, 50).map((session) => (
                      <tr key={session.id} className="hover:bg-gray-800/30 transition-colors">
                        <td className="px-6 py-3 text-sm font-medium text-gray-300">{session.peer_name}</td>
                        <td className="px-6 py-3 text-sm text-gray-500">{session.arma_player ?? '—'}</td>
                        <td className="px-6 py-3 text-sm text-gray-500">
                          {new Date(session.started_at).toLocaleString()}
                        </td>
                        <td className="px-6 py-3 text-sm font-mono text-gray-400">
                          {formatDuration(session.duration_seconds)}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-gray-600 text-sm">
                        No session history yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
