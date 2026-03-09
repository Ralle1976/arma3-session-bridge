/// DiagnosePanel.tsx — Deep VPN Diagnostics (complete rewrite)
/// Replaces the 7-point checklist with a full deep-diagnostic UI.

import { type ReactNode, type CSSProperties, useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '../i18n/LanguageContext'

// ─── Backend Types ────────────────────────────────────────────────────────────

interface DiagStep {
  id: string
  label: string
  status: 'pass' | 'fail' | 'warn' | 'skip'
  detail: string | null
  fix_action: string | null
}

interface DeepDiagnoseResult {
  steps: DiagStep[]
  overall: 'healthy' | 'degraded' | 'broken'
  problems: string[]
  suggestions: string[]
  wg_log: string | null
  config_sanitized: string | null
  raw_adapter_info: string | null
}

interface FirewallSetupResult {
  rules_added: string[]
  rules_existed: string[]
  success: boolean
  error: string | null
}

// Kept for App.tsx backward-compat; component is functionally self-contained
interface DiagnosePanelProps {
  vpnConnected?: boolean
  tunnelIp?: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_ICON: Record<DiagStep['status'], string> = {
  pass: '✅',
  fail: '❌',
  warn: '⚠️',
  skip: '⏭️',
}

const STATUS_COLOR: Record<DiagStep['status'], string> = {
  pass: 'var(--green, #4ade80)',
  fail: 'var(--red, #ef4444)',
  warn: 'var(--yellow, #f59e0b)',
  skip: '#6b7280',
}

const OVERALL_STYLE = {
  healthy: {
    bg: 'rgba(34, 197, 94, 0.07)',
    border: 'rgba(34, 197, 94, 0.28)',
    icon: '🟢',
    textColor: 'var(--green, #4ade80)',
  },
  degraded: {
    bg: 'rgba(234, 179, 8, 0.07)',
    border: 'rgba(234, 179, 8, 0.28)',
    icon: '🟡',
    textColor: 'var(--yellow, #f59e0b)',
  },
  broken: {
    bg: 'rgba(239, 68, 68, 0.07)',
    border: 'rgba(239, 68, 68, 0.28)',
    icon: '🔴',
    textColor: 'var(--red, #ef4444)',
  },
} as const

const FIX_ICON: Record<string, string> = {
  reconnect:   '🔄',
  reregister:  '🔁',
  fix_firewall: '🛡️',
  install_wg:  '📦',
}

// ─── BannerLabels interface ───────────────────────────────────────────────────

interface BannerLabels {
  healthy: string
  degraded: string
  broken: string
  problems: string
  suggestions: string
  fixReconnect: string
  fixReregister: string
  fixFirewall: string
}

// ─── SectionDivider ───────────────────────────────────────────────────────────

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 8px' }}>
      {label && (
        <span style={{
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.08em',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}>
          {label}
        </span>
      )}
      <div style={{ flex: 1, height: 1, background: 'var(--border)', opacity: 0.5 }} />
    </div>
  )
}

// ─── CollapsibleSection ───────────────────────────────────────────────────────

function CollapsibleSection({
  label, collapsed, onToggle, children,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <button
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          borderBottom: '1px solid var(--border)',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: 10,
          fontWeight: 700,
          textTransform: 'uppercase' as const,
          letterSpacing: '0.08em',
          padding: '2px 0 6px 0',
          width: '100%',
          textAlign: 'left' as const,
          marginBottom: collapsed ? 0 : 8,
        }}
      >
        <span style={{ fontSize: 9 }}>{collapsed ? '▶' : '▼'}</span>
        {label}
      </button>
      {!collapsed && children}
    </div>
  )
}

// ─── FixButton ────────────────────────────────────────────────────────────────

function FixButton({
  action, label, icon, fixingAction, onFix,
}: {
  action: string
  label: string
  icon: string
  fixingAction: string | null
  onFix: (action: string) => void
}) {
  const isBusy = fixingAction === action
  const isDisabled = fixingAction !== null

  return (
    <button
      onClick={() => onFix(action)}
      disabled={isDisabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '6px 12px',
        fontSize: 12,
        fontWeight: 600,
        border: '1px solid var(--border-strong)',
        borderRadius: '6px',
        background: 'linear-gradient(180deg, rgba(26,40,62,0.9), rgba(18,30,48,0.9))',
        color: 'var(--text-primary)',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled && !isBusy ? 0.5 : 1,
        transition: 'all 0.15s',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <span style={{ fontSize: 12 }}>{isBusy ? '⏳' : icon}</span>
      {isBusy ? 'Fixing…' : label}
    </button>
  )
}

// ─── StepRow ──────────────────────────────────────────────────────────────────

function StepRow({
  step, expandedStep, onToggle, fixingAction, onFix, fixLabels,
}: {
  step: DiagStep
  expandedStep: string | null
  onToggle: (id: string) => void
  fixingAction: string | null
  onFix: (action: string) => void
  fixLabels: Record<string, string>
}) {
  const expanded = expandedStep === step.id
  const isInteractive = step.detail !== null || step.fix_action !== null
  const statusColor = STATUS_COLOR[step.status]
  const icon = STATUS_ICON[step.status]

  return (
    <div style={{ marginBottom: 2 }}>
      {/* Main row */}
      <div
        role={isInteractive ? 'button' : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        onClick={() => isInteractive && onToggle(step.id)}
        onKeyDown={e => isInteractive && e.key === 'Enter' && onToggle(step.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          borderRadius: '6px',
          cursor: isInteractive ? 'pointer' : 'default',
          background: expanded ? 'rgba(59,130,246,0.05)' : 'transparent',
          border: `1px solid ${expanded ? 'rgba(96,165,250,0.2)' : 'transparent'}`,
          transition: 'background 0.12s, border-color 0.12s',
          userSelect: 'none' as const,
        }}
      >
        {/* Status icon */}
        <span style={{
          width: 20,
          textAlign: 'center' as const,
          fontSize: 13,
          flexShrink: 0,
          lineHeight: 1,
        }}>
          {icon}
        </span>

        {/* Label */}
        <span style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>
          {step.label}
        </span>

        {/* Inline fix tag — visible when row is collapsed */}
        {step.fix_action !== null && !expanded && (
          <button
            onClick={e => { e.stopPropagation(); onFix(step.fix_action!) }}
            disabled={fixingAction !== null}
            style={{
              fontSize: 10,
              padding: '2px 7px',
              border: `1px solid ${statusColor}`,
              borderRadius: 4,
              background: 'transparent',
              color: statusColor,
              cursor: fixingAction !== null ? 'not-allowed' : 'pointer',
              fontWeight: 700,
              opacity: fixingAction !== null ? 0.5 : 1,
              marginRight: 4,
              flexShrink: 0,
              letterSpacing: '0.02em',
            }}
          >
            🔧 Fix
          </button>
        )}

        {/* Expand chevron */}
        {isInteractive && (
          <span style={{
            color: 'var(--text-muted)',
            fontSize: 10,
            flexShrink: 0,
            width: 10,
            textAlign: 'center' as const,
          }}>
            {expanded ? '▼' : '▸'}
          </span>
        )}
      </div>

      {/* Expanded detail panel */}
      {expanded && (
        <div style={{
          margin: '3px 0 6px 28px',
          padding: '10px 12px',
          background: 'rgba(6, 10, 18, 0.7)',
          borderRadius: '6px',
          border: '1px solid var(--border)',
        }}>
          {step.detail && (
            <p style={{
              margin: step.fix_action ? '0 0 10px' : 0,
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.6,
            }}>
              {step.detail}
            </p>
          )}
          {step.fix_action && (
            <FixButton
              action={step.fix_action}
              label={fixLabels[step.fix_action] ?? step.fix_action}
              icon={FIX_ICON[step.fix_action] ?? '🔧'}
              fixingAction={fixingAction}
              onFix={onFix}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── OverallBanner ────────────────────────────────────────────────────────────

function OverallBanner({
  result, fixingAction, fixMessage, fixError, onFix, labels,
}: {
  result: DeepDiagnoseResult
  fixingAction: string | null
  fixMessage: string | null
  fixError: string | null
  onFix: (action: string) => void
  labels: BannerLabels
}) {
  const c = OVERALL_STYLE[result.overall]
  const count = result.problems.length

  const statusLabel =
    result.overall === 'healthy' ? labels.healthy :
    result.overall === 'degraded'
      ? labels.degraded.replace('{count}', String(count))
      : labels.broken.replace('{count}', String(count))

  const hasExtras =
    result.problems.length > 0 ||
    result.suggestions.length > 0 ||
    Boolean(fixMessage) ||
    Boolean(fixError)

  const hasFixButtons = result.overall !== 'healthy'

  return (
    <div style={{
      background: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: '8px',
      padding: '12px 14px',
      marginBottom: 4,
    }}>
      {/* Status headline */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: hasExtras || hasFixButtons ? 10 : 0,
      }}>
        <span style={{ fontSize: 15 }}>{c.icon}</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: c.textColor }}>
          {statusLabel}
        </span>
      </div>

      {/* Problems */}
      {result.problems.length > 0 && (
        <div style={{
          marginBottom: (result.suggestions.length > 0 || fixMessage || fixError || hasFixButtons) ? 10 : 0,
        }}>
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
            marginBottom: 5,
          }}>
            {labels.problems}
          </div>
          {result.problems.map((p, i) => (
            <div key={i} style={{
              display: 'flex',
              gap: 7,
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginBottom: 3,
              lineHeight: 1.5,
            }}>
              <span style={{ color: 'var(--red, #ef4444)', flexShrink: 0, marginTop: 1 }}>•</span>
              <span>{p}</span>
            </div>
          ))}
        </div>
      )}

      {/* Suggestions */}
      {result.suggestions.length > 0 && (
        <div style={{
          marginBottom: (fixMessage || fixError || hasFixButtons) ? 10 : 0,
        }}>
          <div style={{
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase' as const,
            letterSpacing: '0.06em',
            marginBottom: 5,
          }}>
            {labels.suggestions}
          </div>
          {result.suggestions.map((s, i) => (
            <div key={i} style={{
              display: 'flex',
              gap: 7,
              fontSize: 12,
              color: 'var(--text-secondary)',
              marginBottom: 3,
              lineHeight: 1.5,
            }}>
              <span style={{ color: 'var(--yellow, #f59e0b)', flexShrink: 0, marginTop: 1 }}>→</span>
              <span>{s}</span>
            </div>
          ))}
        </div>
      )}

      {/* Fix success message */}
      {fixMessage && (
        <div style={{
          fontSize: 12,
          color: 'var(--green, #4ade80)',
          padding: '6px 10px',
          background: 'rgba(34,197,94,0.08)',
          borderRadius: 6,
          border: '1px solid rgba(34,197,94,0.2)',
          marginBottom: hasFixButtons ? 10 : 0,
        }}>
          ✅ {fixMessage}
        </div>
      )}

      {/* Fix error message */}
      {fixError && (
        <div style={{
          fontSize: 12,
          color: 'var(--red, #ef4444)',
          padding: '6px 10px',
          background: 'rgba(239,68,68,0.08)',
          borderRadius: 6,
          border: '1px solid rgba(239,68,68,0.2)',
          marginBottom: hasFixButtons ? 10 : 0,
        }}>
          ❌ {fixError}
        </div>
      )}

      {/* Fix action buttons */}
      {hasFixButtons && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' as const }}>
          <FixButton
            action="reconnect"
            label={labels.fixReconnect}
            icon="🔄"
            fixingAction={fixingAction}
            onFix={onFix}
          />
          <FixButton
            action="reregister"
            label={labels.fixReregister}
            icon="🔁"
            fixingAction={fixingAction}
            onFix={onFix}
          />
          <FixButton
            action="fix_firewall"
            label={labels.fixFirewall}
            icon="🛡️"
            fixingAction={fixingAction}
            onFix={onFix}
          />
        </div>
      )}
    </div>
  )
}

// ─── DiagnosePanel ────────────────────────────────────────────────────────────

function DiagnosePanel(_props: DiagnosePanelProps) {
  const { t } = useTranslation()

  const [running, setRunning]           = useState(false)
  const [result, setResult]             = useState<DeepDiagnoseResult | null>(null)
  const [fixingAction, setFixingAction] = useState<string | null>(null)
  const [fixMessage, setFixMessage]     = useState<string | null>(null)
  const [fixError, setFixError]         = useState<string | null>(null)
  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [copiedReport, setCopiedReport] = useState(false)
  const [wgLogCollapsed, setWgLogCollapsed]   = useState(false)
  const [configCollapsed, setConfigCollapsed] = useState(false)

  // ── Deep diagnose ──────────────────────────────────────────────────────────

  const runDiagnose = useCallback(async () => {
    setRunning(true)
    setResult(null)
    setFixMessage(null)
    setFixError(null)
    setExpandedStep(null)
    try {
      const res = await invoke<DeepDiagnoseResult>('deep_diagnose')
      setResult(res)
    } catch (e) {
      setResult({
        steps: [],
        overall: 'broken',
        problems: [String(e)],
        suggestions: [],
        wg_log: null,
        config_sanitized: null,
        raw_adapter_info: null,
      })
    } finally {
      setRunning(false)
    }
  }, [])

  // ── Fix actions ────────────────────────────────────────────────────────────

  const handleFix = useCallback(async (action: string) => {
    setFixingAction(action)
    setFixMessage(null)
    setFixError(null)
    let succeeded = false
    try {
      let msg: string
      if (action === 'reconnect') {
        msg = await invoke<string>('fix_reconnect_vpn')
      } else if (action === 'reregister') {
        msg = await invoke<string>('fix_reregister_peer')
      } else if (action === 'fix_firewall') {
        const fw = await invoke<FirewallSetupResult>('setup_firewall_rules')
        msg = fw.success
          ? `OK — ${fw.rules_added.length} rule(s) added`
          : (fw.error ?? 'Firewall setup failed')
      } else {
        msg = `Unknown action: ${action}`
      }
      setFixMessage(msg)
      succeeded = true
    } catch (e) {
      setFixError(String(e))
    } finally {
      setFixingAction(null)
    }
    // Re-run diagnosis only on success so error message stays visible
    if (succeeded) {
      await runDiagnose()
    }
  }, [runDiagnose])

  // ── Copy report ────────────────────────────────────────────────────────────

  const copyReport = useCallback(async () => {
    if (!result) return
    const lines: string[] = [
      '======================================================',
      '  Arma 3 Session Bridge — Deep Diagnostics Report',
      `  ${new Date().toLocaleString()}`,
      '======================================================',
      `Overall: ${result.overall.toUpperCase()}`,
      '',
    ]
    if (result.problems.length > 0) {
      lines.push('PROBLEMS:')
      result.problems.forEach(p => lines.push(`  • ${p}`))
      lines.push('')
    }
    if (result.suggestions.length > 0) {
      lines.push('SUGGESTIONS:')
      result.suggestions.forEach(s => lines.push(`  → ${s}`))
      lines.push('')
    }
    lines.push('DIAGNOSTIC STEPS:')
    result.steps.forEach(step => {
      const padded = step.status.toUpperCase().padEnd(4)
      lines.push(`  ${STATUS_ICON[step.status]} [${padded}] ${step.label}`)
      if (step.detail) lines.push(`           ${step.detail}`)
    })
    if (result.wg_log) {
      lines.push('')
      lines.push('── WIREGUARD LOG ──────────────────────────────────────')
      lines.push(result.wg_log)
    }
    if (result.config_sanitized) {
      lines.push('')
      lines.push('── CONFIG (SANITIZED) ─────────────────────────────────')
      lines.push(result.config_sanitized)
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      setCopiedReport(true)
      setTimeout(() => setCopiedReport(false), 2400)
    } catch { /* clipboard unavailable */ }
  }, [result])

  // ── Translation helpers ────────────────────────────────────────────────────
  // Cast to Record so we can access newly-added snake_case keys at runtime.
  // Once translations.ts is updated, these keys exist in the type too.
  const td = t as typeof t & Record<string, string>
  const tr = (key: string, fallback: string): string =>
    (td[key] as string | undefined) ?? fallback

  const bannerLabels: BannerLabels = {
    healthy:      tr('diag_overall_healthy',  'All OK — VPN working perfectly'),
    degraded:     tr('diag_overall_degraded', 'Degraded — {count} problem(s) found'),
    broken:       tr('diag_overall_broken',   'Broken — {count} problem(s) found'),
    problems:     tr('diag_problems',         'Problems'),
    suggestions:  tr('diag_suggestions',      'Suggestions'),
    fixReconnect:  tr('diag_fix_reconnect',   'Reconnect VPN'),
    fixReregister: tr('diag_fix_reregister',  'Re-register Device'),
    fixFirewall:   tr('diag_fix_firewall',    'Set Firewall Rules'),
  }

  const fixLabels: Record<string, string> = {
    reconnect:    bannerLabels.fixReconnect,
    reregister:   bannerLabels.fixReregister,
    fix_firewall: bannerLabels.fixFirewall,
    install_wg:   tr('diag_fix_install', 'Install WireGuard'),
  }

  // ── Shared monospace block style ───────────────────────────────────────────

  const monoBlock: CSSProperties = {
    background: 'rgba(6, 10, 18, 0.92)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '10px 12px',
    fontFamily: "'Consolas', 'Courier New', monospace",
    fontSize: 11,
    color: 'var(--text-secondary)',
    overflow: 'auto',
    maxHeight: 200,
    margin: 0,
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="connection-info-panel" style={{ padding: '16px 20px' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 16,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}>
          🩺 {tr('diag_title', 'Deep VPN Diagnostics')}
        </span>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Copy report — only visible when results exist */}
          {result !== null && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { void copyReport() }}
              disabled={running}
              title={tr('diag_copy', 'Copy Report')}
            >
              {copiedReport
                ? `✅ ${tr('diag_copied', 'Copied!')}`
                : `📋 ${tr('diag_copy', 'Copy Report')}`}
            </button>
          )}

          {/* Run / re-run button */}
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { void runDiagnose() }}
            disabled={running}
          >
            {running
              ? `⏳ ${tr('diag_running', 'Running diagnostics...')}`
              : `🔄 ${tr('diag_run', 'Run Deep Diagnosis')}`}
          </button>
        </div>
      </div>

      {/* ── Initial / empty state ───────────────────────────────────────────── */}
      {result === null && !running && (
        <div style={{
          textAlign: 'center',
          padding: '52px 20px',
          color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: 38, marginBottom: 14 }}>🔍</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>
            {tr('diag_no_results', "Click 'Run Deep Diagnosis' for a full analysis.")}
          </div>
        </div>
      )}

      {/* ── Running state (no result yet) ──────────────────────────────────── */}
      {running && result === null && (
        <div style={{
          textAlign: 'center',
          padding: '40px 20px',
          color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⏳</div>
          <div style={{ fontSize: 13 }}>
            {tr('diag_running', 'Running diagnostics...')}
          </div>
        </div>
      )}

      {/* ── Results ─────────────────────────────────────────────────────────── */}
      {result !== null && (
        <>
          {/* Overall status banner */}
          <OverallBanner
            result={result}
            fixingAction={fixingAction}
            fixMessage={fixMessage}
            fixError={fixError}
            onFix={handleFix}
            labels={bannerLabels}
          />

          {/* Diagnostic steps list */}
          <SectionDivider label={tr('diag_steps', 'Diagnostic Steps')} />
          <div>
            {result.steps.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 8px' }}>
                —
              </div>
            ) : (
              result.steps.map(step => (
                <StepRow
                  key={step.id}
                  step={step}
                  expandedStep={expandedStep}
                  onToggle={id => setExpandedStep(prev => prev === id ? null : id)}
                  fixingAction={fixingAction}
                  onFix={handleFix}
                  fixLabels={fixLabels}
                />
              ))
            )}
          </div>

          {/* WireGuard Log — collapsible, monospace, max-height 200px */}
          {result.wg_log !== null && (
            <CollapsibleSection
              label={tr('diag_wg_log', 'WireGuard Log')}
              collapsed={wgLogCollapsed}
              onToggle={() => setWgLogCollapsed(v => !v)}
            >
              <pre style={monoBlock}>{result.wg_log}</pre>
            </CollapsibleSection>
          )}

          {/* Config (sanitized) — collapsible, monospace */}
          {result.config_sanitized !== null && (
            <CollapsibleSection
              label={tr('diag_config', 'Configuration (sanitized)')}
              collapsed={configCollapsed}
              onToggle={() => setConfigCollapsed(v => !v)}
            >
              <pre style={monoBlock}>{result.config_sanitized}</pre>
            </CollapsibleSection>
          )}
        </>
      )}
    </div>
  )
}

export { DiagnosePanel }
export type { DiagnosePanelProps }
