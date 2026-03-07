/// FirstRunWizard.tsx — 3-Step Setup Wizard for Arma 3 Session Bridge
///
/// Step 1: Server URL + Registration Code
/// Step 2: Device name (with chip suggestions)
/// Step 3: Success screen

import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from '../i18n/LanguageContext'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  /** Absolute path where the .conf file will be saved */
  confPath: string
  /** Called after peer has been registered and conf validated */
  onComplete: () => void
}

type Step = 1 | 2 | 3

// ─── Component ────────────────────────────────────────────────────────────────

const DEFAULT_API_URL = 'https://arma3-session-bridge.ralle1976.cloud/api'

export function FirstRunWizard({ confPath, onComplete }: Props) {
  const { lang, t, toggleLang } = useTranslation()
  const [step, setStep] = useState<Step>(1)
  const [apiUrl, setApiUrl] = useState(DEFAULT_API_URL)
  const [registrationCode, setRegistrationCode] = useState('')
  const [deviceName, setDeviceName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Register: generate keypair + server registration + write conf ──

  const handleRegister = async () => {
    setLoading(true)
    setError(null)
    try {
      const base = apiUrl.trim().replace(/\/$/, '')

      await invoke('generate_and_register_peer', {
        apiUrl: base,
        peerName: deviceName.trim(),
        savePath: confPath,
        registrationCode: registrationCode.trim(),
      })

      const valid = await invoke<boolean>('validate_conf', { path: confPath })
      if (!valid) {
        setError('Generierte Config ist ungültig. Admin kontaktieren.')
        return
      }
      setStep(3)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  // ── Progress dots ──────────────────────────────────────────────────

  const dotClass = (n: number) => {
    if (step > n) return 'wizard-step-dot done'
    if (step === n) return 'wizard-step-dot active'
    return 'wizard-step-dot'
  }

  const lineClass = (afterStep: number) =>
    step > afterStep ? 'wizard-step-line done' : 'wizard-step-line'

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="wizard-overlay">
      {/* Header */}
      <div className="wizard-header">
        <div className="wizard-brand">
          <div className="wizard-logo">🎮</div>
          <div>
            <div className="wizard-brand-name">{t.wizardTitle}</div>
            <div className="wizard-brand-sub">{t.wizardSubtitle}</div>
          </div>
        </div>
        <button className="lang-toggle" onClick={toggleLang}>
          {lang === 'de' ? 'EN' : 'DE'}
        </button>
      </div>

      {/* Progress */}
      <div className="wizard-progress">
        <div className={dotClass(1)}>1</div>
        <div className={lineClass(1)} />
        <div className={dotClass(2)}>2</div>
        <div className={lineClass(2)} />
        <div className={dotClass(3)}>3</div>
      </div>

      {/* Body */}
      <div className="wizard-body">

        {/* ── Step 1: URL + Registration Code ─── */}
        {step === 1 && (
          <>
            <div className="wizard-step-title">{t.wizardStep1Title}</div>
            <div className="wizard-step-desc">{t.wizardStep1Desc}</div>

            <div className="wizard-info-box">
              <span className="info-icon">ℹ️</span>
              <span>{t.infoStep1}</span>
            </div>

            <div className="wizard-field">
              <div className="wizard-label">
                {t.labelServerUrl}
                <span
                  className="tooltip-icon"
                  data-tip={t.tooltipServerUrl}
                >?</span>
              </div>
              <input
                className="wizard-input"
                type="url"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder={t.placeholderServerUrl}
                autoFocus
              />
            </div>

            <div className="wizard-field">
              <div className="wizard-label">
                {t.labelRegCode}
                <span
                  className="tooltip-icon"
                  data-tip={t.tooltipRegCode}
                >?</span>
              </div>
              <input
                className="wizard-input"
                type="password"
                value={registrationCode}
                onChange={(e) => setRegistrationCode(e.target.value)}
                placeholder={t.placeholderRegCode}
              />
            </div>

            {error && <div className="wizard-error">⚠ {error}</div>}
          </>
        )}

        {/* ── Step 2: Device Name ─── */}
        {step === 2 && (
          <>
            <div className="wizard-step-title">{t.wizardStep2Title}</div>
            <div className="wizard-step-desc">{t.wizardStep2Desc}</div>

            <div className="wizard-info-box">
              <span className="info-icon">💡</span>
              <span>{t.infoStep2}</span>
            </div>

            <div className="wizard-field">
              <div className="wizard-label">
                {t.labelDeviceName}
                <span
                  className="tooltip-icon"
                  data-tip={t.tooltipDeviceName}
                >?</span>
              </div>
              <input
                className="wizard-input"
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                placeholder={t.placeholderDeviceName}
                autoFocus
              />
              <div className="chips">
                {[t.chipNameSuggestion1, t.chipNameSuggestion2, t.chipNameSuggestion3].map((chip) => (
                  <button
                    key={chip}
                    className="chip"
                    type="button"
                    onClick={() => setDeviceName(chip)}
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="wizard-error">⚠ {error}</div>}
          </>
        )}

        {/* ── Step 3: Success ─── */}
        {step === 3 && (
          <div className="wizard-success">
            <div className="success-icon">✓</div>
            <div className="success-title">{t.wizardStep3Title}</div>
            <div className="success-desc">{t.wizardStep3Desc}</div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="wizard-footer">
        {/* Back button */}
        <div>
          {step === 2 && (
            <button
              className="btn btn-secondary"
              onClick={() => { setError(null); setStep(1) }}
              disabled={loading}
            >
              {t.btnBack}
            </button>
          )}
        </div>

        {/* Next / Register / Start */}
        <div>
          {step === 1 && (
            <button
              className="btn btn-primary"
              onClick={() => { setError(null); setStep(2) }}
              disabled={!apiUrl.trim() || !registrationCode.trim()}
            >
              {t.btnNext}
            </button>
          )}
          {step === 2 && (
            <button
              className="btn btn-primary"
              onClick={handleRegister}
              disabled={!deviceName.trim() || loading}
            >
              {loading ? '⏳ ...' : t.btnRegister}
            </button>
          )}
          {step === 3 && (
            <button
              className="btn btn-primary"
              onClick={onComplete}
            >
              {t.btnStartPlaying}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
