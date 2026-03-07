import { useState, useEffect } from 'react';
import { getSettings, updateSettings } from '../api/settings';

export default function SettingsPage() {
  const [masked, setMasked] = useState('');
  const [preview, setPreview] = useState('');
  const [newCode, setNewCode] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const data = await getSettings();
      setMasked(data.registration_code_masked);
      setPreview(data.registration_code_preview);
    } catch (e) {
      setError('Fehler beim Laden der Einstellungen');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (newCode.length < 8) {
      setError('Code muss mindestens 8 Zeichen lang sein');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await updateSettings(newCode);
      setMessage(result.message);
      setMasked(result.masked);
      setNewCode('');
      setShowInput(false);
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="page-loading">Laden...</div>;

  return (
    <div className="settings-page">
      <h1>Einstellungen</h1>
      
      <div className="settings-card">
        <h2>Registrierungs-Code</h2>
        <p className="settings-description">
          Dieser Code wird von neuen Nutzern beim ersten Start der Windows-App eingegeben,
          um sich am VPN-Server zu registrieren.
        </p>
        
        <div className="current-code">
          <span className="label">Aktueller Code:</span>
          <span className="code-display">{masked}</span>
          <span className="code-preview">(beginnt mit: <strong>{preview}</strong>)</span>
        </div>

        {message && <div className="alert alert-success">{message}</div>}
        {error && <div className="alert alert-error">{error}</div>}

        {!showInput ? (
          <button className="btn btn-primary" onClick={() => setShowInput(true)}>
            Code ändern
          </button>
        ) : (
          <div className="code-input-group">
            <input
              type="text"
              className="input"
              placeholder="Neuer Registrierungs-Code (min. 8 Zeichen)"
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
            />
            <div className="button-row">
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Speichern...' : 'Speichern'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setShowInput(false); setNewCode(''); setError(''); }}>
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .settings-page { padding: 2rem; max-width: 600px; }
        .settings-page h1 { margin-bottom: 1.5rem; color: #f1f2f6; }
        .settings-card { background: #1a1d27; border-radius: 12px; padding: 1.5rem; border: 1px solid #2a2d3e; }
        .settings-card h2 { color: #f1f2f6; margin-bottom: 0.5rem; font-size: 1.1rem; }
        .settings-description { color: #8b92a9; font-size: 0.875rem; margin-bottom: 1.5rem; line-height: 1.5; }
        .current-code { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 1.25rem; flex-wrap: wrap; }
        .current-code .label { color: #8b92a9; font-size: 0.875rem; }
        .code-display { font-family: monospace; background: #0f1117; padding: 0.35rem 0.75rem; border-radius: 6px; color: #f1f2f6; letter-spacing: 0.05em; font-size: 1rem; }
        .code-preview { color: #8b92a9; font-size: 0.8rem; }
        .alert { padding: 0.75rem 1rem; border-radius: 8px; margin-bottom: 1rem; font-size: 0.875rem; }
        .alert-success { background: rgba(34,197,94,0.15); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
        .alert-error { background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
        .code-input-group { display: flex; flex-direction: column; gap: 0.75rem; }
        .input { background: #0f1117; border: 1px solid #2a2d3e; border-radius: 8px; padding: 0.6rem 1rem; color: #f1f2f6; font-size: 0.95rem; width: 100%; outline: none; }
        .input:focus { border-color: #5865f2; }
        .button-row { display: flex; gap: 0.75rem; }
        .btn { padding: 0.5rem 1.25rem; border-radius: 8px; border: none; cursor: pointer; font-size: 0.9rem; font-weight: 500; transition: opacity 0.2s; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-primary { background: #5865f2; color: white; }
        .btn-primary:hover:not(:disabled) { background: #4752c4; }
        .btn-secondary { background: #2a2d3e; color: #f1f2f6; }
        .btn-secondary:hover { background: #353849; }
        .page-loading { padding: 2rem; color: #8b92a9; }
      `}</style>
    </div>
  );
}
