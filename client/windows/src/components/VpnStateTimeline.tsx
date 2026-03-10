/**
 * VpnStateTimeline.tsx — Live VPN state history component
 *
 * Displays a scrollable timeline of VpnStateEvent entries received from the
 * Rust VPN state machine via the `vpn-state-changed` event.
 *
 * Props:
 *  - events: VpnStateEvent[] — ordered newest-first array managed by App.tsx
 *  - onClear: () => void — callback to clear the event history
 */

import type { CSSProperties } from 'react'
import { useTranslation } from '../i18n/LanguageContext'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VpnStateEvent {
  state: string
  reason: string
  attempt: number
  timestamp_ms: number
}

interface VpnStateTimelineProps {
  events: VpnStateEvent[]
  onClear: () => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Map state string prefix → display style */
const STATE_STYLE: Record<string, { icon: string; color: string; dotColor: string }> = {
  Connected:    { icon: '🟢', color: 'var(--green, #4ade80)',   dotColor: '#4ade80' },
  Disconnected: { icon: '⚪', color: 'var(--text-muted)',        dotColor: '#6b7280' },
  Connecting:   { icon: '🔵', color: 'var(--blue, #60a5fa)',    dotColor: '#60a5fa' },
  Reconnecting: { icon: '🟡', color: 'var(--yellow, #f59e0b)',  dotColor: '#f59e0b' },
  Error:        { icon: '🔴', color: 'var(--red, #ef4444)',     dotColor: '#ef4444' },
}

const FALLBACK_STYLE = { icon: '⬜', color: 'var(--text-secondary)', dotColor: '#9ca3af' }

function getStateStyle(state: string) {
  for (const key of Object.keys(STATE_STYLE)) {
    if (state.startsWith(key)) return STATE_STYLE[key]
  }
  return FALLBACK_STYLE
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function formatDuration(fromMs: number, toMs: number): string {
  const diff = Math.round((toMs - fromMs) / 1000)
  if (diff < 60) return `${diff}s`
  const m = Math.floor(diff / 60)
  const s = diff % 60
  return s === 0 ? `${m}m` : `${m}m ${s}s`
}

// ─── TimelineEntry ────────────────────────────────────────────────────────────

function TimelineEntry({
  event,
  nextEvent,
  isFirst,
  stateLabel,
}: {
  event: VpnStateEvent
  nextEvent: VpnStateEvent | null
  isFirst: boolean
  stateLabel: string
}) {
  const style = getStateStyle(event.state)

  // Duration = time until the next event (which is older, array is newest-first)
  const duration = nextEvent
    ? formatDuration(nextEvent.timestamp_ms, event.timestamp_ms)
    : null

  const dotStyle: CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: style.dotColor,
    flexShrink: 0,
    marginTop: 4,
    boxShadow: isFirst ? `0 0 0 3px ${style.dotColor}33` : undefined,
  }

  const lineStyle: CSSProperties = {
    position: 'absolute',
    left: 4,
    top: 14,
    bottom: -8,
    width: 2,
    background: 'var(--border)',
  }

  return (
    <div style={{
      display: 'flex',
      gap: 10,
      paddingBottom: 8,
      position: 'relative',
    }}>
      {/* Timeline spine */}
      <div style={{ position: 'relative', flexShrink: 0, width: 10 }}>
        <div style={dotStyle} />
        {nextEvent && <div style={lineStyle} />}
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingBottom: 2 }}>
        {/* State label + icon */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 12 }}>{style.icon}</span>
          <span style={{
            fontSize: 13,
            fontWeight: isFirst ? 700 : 500,
            color: isFirst ? style.color : 'var(--text-secondary)',
          }}>
            {stateLabel}
          </span>
          {event.attempt > 0 && (
            <span style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              background: 'rgba(255,255,255,0.06)',
              padding: '1px 5px',
              borderRadius: 3,
            }}>
              #{event.attempt}
            </span>
          )}
        </div>

        {/* Reason text */}
        {event.reason && (
          <div style={{
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.4,
            marginBottom: 2,
          }}>
            {event.reason}
          </div>
        )}

        {/* Timestamp + duration */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {formatTimestamp(event.timestamp_ms)}
          </span>
          {duration && (
            <span style={{
              fontSize: 10,
              color: 'var(--text-muted)',
              background: 'rgba(255,255,255,0.04)',
              padding: '1px 5px',
              borderRadius: 3,
              fontVariantNumeric: 'tabular-nums',
            }}>
              ⏱ {duration}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── VpnStateTimeline ────────────────────────────────────────────────────────

export function VpnStateTimeline({ events, onClear }: VpnStateTimelineProps) {
  const { t } = useTranslation()
  const td = t as typeof t & Record<string, string>
  const tr = (key: string, fallback: string): string =>
    (td[key] as string | undefined) ?? fallback

  // Resolve i18n key for a state string
  function resolveStateLabel(state: string): string {
    for (const prefix of ['Connected', 'Disconnected', 'Connecting', 'Reconnecting', 'Error']) {
      if (state.startsWith(prefix)) {
        const label = tr(`timeline_state_${prefix}`, prefix)
        // For error states, append the suffix if present
        if (prefix === 'Error' && state.length > 6) {
          const detail = state.replace(/^Error:\s*/, '')
          return detail ? `${label}: ${detail}` : label
        }
        return label
      }
    }
    return state
  }

  const isEmpty = events.length === 0

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 12,
      }}>
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          🕐 {tr('timeline_title', 'VPN Connection History')}
        </span>
        {!isEmpty && (
          <button
            onClick={onClear}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: 10,
              padding: '2px 4px',
              borderRadius: 3,
            }}
          >
            {tr('timeline_clear', 'Clear')}
          </button>
        )}
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div style={{
          textAlign: 'center',
          padding: '24px 0',
          color: 'var(--text-muted)',
          fontSize: 12,
        }}>
          {tr('timeline_empty', 'No events recorded yet.')}
        </div>
      )}

      {/* Event list — newest first */}
      {!isEmpty && (
        <div style={{ maxHeight: 320, overflowY: 'auto' }}>
          {events.map((event, i) => (
            <TimelineEntry
              key={`${event.timestamp_ms}-${i}`}
              event={event}
              nextEvent={events[i + 1] ?? null}
              isFirst={i === 0}
              stateLabel={resolveStateLabel(event.state)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
