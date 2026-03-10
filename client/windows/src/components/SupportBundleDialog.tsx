/**
 * SupportBundleDialog.tsx — One-click support bundle creation dialog
 *
 * Invokes the `create_support_bundle` Tauri command and shows the
 * resulting file path with copy-to-clipboard and folder-open actions.
 */

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '../i18n/LanguageContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SupportBundleResult {
  path: string
  summary: string[]
  warnings: string[]
}

interface SupportBundleDialogProps {
  /** Whether the dialog is visible */
  open: boolean
  /** Close the dialog */
  onClose: () => void
}

// ─── SupportBundleDialog ──────────────────────────────────────────────────────

export function SupportBundleDialog({ open, onClose }: SupportBundleDialogProps) {
  const { t } = useTranslation()
  const td = t as typeof t & Record<string, string>
  const tr = (key: string, fallback: string): string =>
    (td[key] as string | undefined) ?? fallback

  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<SupportBundleResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (!open) return null

  async function handleCreate() {
    setCreating(true)
    setResult(null)
    setError(null)
    try {
      const res = await invoke<SupportBundleResult>('create_support_bundle')
      setResult(res)
    } catch (e) {
      setError(tr('supportBundle_error', 'Error creating bundle: {{error}}')
        .replace('{{error}}', String(e)))
    } finally {
      setCreating(false)
    }
  }

  async function handleCopyPath() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.path)
      setCopied(true)
      setTimeout(() => setCopied(false), 2400)
    } catch { /* ignore */ }
  }

  function handleClose() {
    setResult(null)
    setError(null)
    setCopied(false)
    onClose()
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  const overlayStyle = {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  }

  const dialogStyle = {
    background: 'var(--surface, #0f1927)',
    border: '1px solid var(--border-strong)',
    borderRadius: '10px',
    padding: '24px',
    width: 400,
    maxWidth: '90vw',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  }

  return (
    <div style={overlayStyle} onClick={handleClose}>
      <div style={dialogStyle} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              📦 {tr('supportBundle_title', 'Create Support Bundle')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {tr('supportBundle_description',
                'Creates a diagnostics file with anonymized system information for support.')}
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              fontSize: 16,
              lineHeight: 1,
              padding: '0 0 0 8px',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Create button */}
        {!result && (
          <button
            onClick={() => { void handleCreate() }}
            disabled={creating}
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: error ? 12 : 0 }}
          >
            {creating
              ? `⏳ ${tr('supportBundle_creating', 'Creating...')}`
              : `📦 ${tr('supportBundle_btn', 'Create Bundle')}`}
          </button>
        )}

        {/* Error */}
        {error && (
          <div style={{
            fontSize: 12,
            color: 'var(--red, #ef4444)',
            padding: '8px 10px',
            background: 'rgba(239,68,68,0.08)',
            borderRadius: 6,
            border: '1px solid rgba(239,68,68,0.2)',
          }}>
            ❌ {error}
          </div>
        )}

        {/* Success result */}
        {result && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Path display */}
            <div style={{
              background: 'rgba(6,10,18,0.8)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '8px 10px',
              fontFamily: "'Consolas', monospace",
              fontSize: 11,
              color: 'var(--text-secondary)',
              wordBreak: 'break-all',
            }}>
              {result.path}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => { void handleCopyPath() }}
                className="btn btn-secondary btn-sm"
                style={{ flex: 1 }}
              >
                {copied ? '✅ Copied!' : `📋 ${tr('supportBundle_copyPath', 'Copy path')}`}
              </button>
              <button
                onClick={handleCreate}
                disabled={creating}
                className="btn btn-secondary btn-sm"
                style={{ flex: 1 }}
              >
                🔄 {creating ? tr('supportBundle_creating', 'Creating...') : 'Regenerate'}
              </button>
            </div>

            {/* Summary */}
            {result.summary.length > 0 && (
              <div>
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 4,
                }}>
                  Collected
                </div>
                {result.summary.map((item, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>
                    <span style={{ color: 'var(--green, #4ade80)' }}>✓</span>
                    {item}
                  </div>
                ))}
              </div>
            )}

            {/* Warnings */}
            {result.warnings.length > 0 && (
              <div>
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 4,
                }}>
                  Warnings
                </div>
                {result.warnings.map((w, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--yellow, #f59e0b)', marginBottom: 2 }}>
                    <span>⚠️</span>
                    {w}
                  </div>
                ))}
              </div>
            )}

            {/* Reminder */}
            <div style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              padding: '6px 8px',
              background: 'rgba(96,165,250,0.06)',
              borderRadius: 5,
              border: '1px solid rgba(96,165,250,0.15)',
              lineHeight: 1.5,
            }}>
              🔒 All private keys, endpoints, and tokens have been redacted.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
