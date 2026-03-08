import { useEffect, useRef, useState } from 'react'

export interface LogEvent {
  id: string
  type: string
  data: string
  timestamp: number
}

const MAX_EVENTS = 50

const EVENT_COLORS: Record<string, string> = {
  session_started: 'text-green-400',
  session_ended: 'text-yellow-400',
  peer_created: 'text-blue-400',
  peer_deleted: 'text-red-400',
  ping: 'text-gray-600',
}

const EVENT_LABELS: Record<string, string> = {
  session_started: 'Session Started',
  session_ended: 'Session Ended',
  peer_created: 'Peer Created',
  peer_deleted: 'Peer Deleted',
  ping: 'Ping',
  message: 'Event',
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function EventRow({ event }: { event: LogEvent }) {
  const colorCls = EVENT_COLORS[event.type] ?? 'text-gray-400'
  const label = EVENT_LABELS[event.type] ?? event.type

  let parsed: unknown = null
  try {
    parsed = JSON.parse(event.data)
  } catch {
    /* raw string */
  }

  const summary =
    parsed != null && typeof parsed === 'object'
      ? Object.entries(parsed as Record<string, unknown>)
          .slice(0, 3)
          .map(([k, v]) => `${k}: ${String(v)}`)
          .join('  ·  ')
      : event.data

  return (
    <div className="flex items-start gap-3 py-2 border-b border-glass last:border-0 group hover:bg-[rgba(30,48,72,0.4)] px-1 rounded transition-colors">
      <span className="text-gray-600 font-mono text-xs shrink-0 mt-0.5 w-20">
        {formatTime(event.timestamp)}
      </span>
      <span className={`text-xs font-semibold shrink-0 w-32 ${colorCls}`}>{label}</span>
      <span className="text-xs text-gray-500 truncate flex-1 font-mono">{summary || '—'}</span>
    </div>
  )
}

export default function EventLog() {
  const [events, setEvents] = useState<LogEvent[]>([])
  const [connected, setConnected] = useState(false)
  const [errorCount, setErrorCount] = useState(0)
  const counterRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const BASE = import.meta.env.VITE_API_URL ?? '/api'
    const token = localStorage.getItem('admin_token') ?? ''
    const url = `${BASE}/admin/events?token=${encodeURIComponent(token)}`

    function connect() {
      const es = new EventSource(url, { withCredentials: true })
      esRef.current = es

      es.onopen = () => {
        setConnected(true)
        setErrorCount(0)
      }

      es.onerror = () => {
        setConnected(false)
        setErrorCount((n) => n + 1)
      }

      const pushEvent = (type: string, data: string) => {
        const id = `${Date.now()}-${counterRef.current++}`
        setEvents((prev) => {
          const updated = [{ id, type, data, timestamp: Date.now() }, ...prev]
          return updated.slice(0, MAX_EVENTS)
        })
      }

      es.onmessage = (e) => pushEvent('message', e.data)

      const EVENT_TYPES = ['session_started', 'session_ended', 'peer_created', 'peer_deleted', 'ping']
      EVENT_TYPES.forEach((t) => {
        es.addEventListener(t, (e: Event) => {
          pushEvent(t, (e as MessageEvent).data ?? '')
        })
      })
    }

    connect()

    return () => {
      esRef.current?.close()
      esRef.current = null
    }
  }, [])

  // Auto-scroll to top (newest events first)
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = 0
    }
  }, [events])

  return (
    <div className="card flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-gray-300">Event Log</h2>
        <div className="flex items-center gap-2">
          {errorCount > 0 && (
            <span className="text-xs text-red-500 font-mono">{errorCount} error(s)</span>
          )}
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                connected ? 'bg-green-500 animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.5)]' : 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]'
              }`}
            />
            <span className="text-xs text-gray-500">{connected ? 'Live' : 'Disconnected'}</span>
          </div>
          <span className="text-xs text-gray-700">·</span>
          <span className="text-xs text-gray-600">{events.length}/{MAX_EVENTS}</span>
          {events.length > 0 && (
            <>
              <span className="text-xs text-gray-700">·</span>
              <button
                onClick={() => setEvents([])}
                className="text-xs text-gray-600 hover:text-blue-400 transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      <div
        ref={listRef}
        className="overflow-y-auto max-h-64 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-transparent"
      >
        {events.length === 0 ? (
          <div className="flex items-center justify-center h-24 border-2 border-dashed border-glass-strong rounded-lg">
            <p className="text-gray-600 text-sm">
              {connected ? 'Waiting for events…' : 'Connecting to event stream…'}
            </p>
          </div>
        ) : (
          events.map((ev) => <EventRow key={ev.id} event={ev} />)
        )}
      </div>
    </div>
  )
}
