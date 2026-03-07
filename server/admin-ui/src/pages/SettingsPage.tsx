import { useState, useEffect } from 'react';
import { getSettings, updateSettings } from '../api/settings';

const RELEASE_URL = 'https://github.com/Ralle1976/arma3-session-bridge/releases/latest';

export default function SettingsPage() {
  const [code, setCode] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    try {
      const data = await getSettings();
      setCode(data.registration_code);
      setServerUrl(data.server_url);
    } catch {
      setError('Fehler beim Laden der Einstellungen');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (newCode.length < 8) { setError('Code muss mindestens 8 Zeichen lang sein'); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await updateSettings(newCode);
      setMessage('✅ ' + result.message);
      setCode(result.registration_code);
      setNewCode(''); setShowInput(false);
    } catch (e: any) {
      setError(e.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  }

  function buildInviteText() {
    return `🎮 Arma 3 Session Bridge — Einladung

1️⃣  Installer herunterladen:
     ${RELEASE_URL}

2️⃣  App starten → den Einrichtungs-Wizard ausfüllen:
     • Server-URL:            ${serverUrl}
     • Registrierungs-Code:  ${code}

3️⃣  Gerätename eingeben (z.B. deinen Gamer-Tag)

4️⃣  Fertig! VPN verbinden → Sessions beitreten 🚀

Bei Problemen einfach melden.`;
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    });
  }

  if (loading) return <div style={s.loading}>Laden…</div>;

  return (
    <div style={s.page}>
      <h1 style={s.h1}>⚙️ Einstellungen</h1>

      {/* ── Registrierungs-Code ─────────────────────────── */}
      <div style={s.card}>
        <h2 style={s.h2}>🔑 Registrierungs-Code</h2>
        <p style={s.desc}>
          Neue Spieler geben diesen Code beim ersten App-Start ein. Nur du (der Admin) siehst ihn hier im Klartext.
        </p>

        <div style={s.codeRow}>
          <code style={s.codeBox}>
            {showCode ? code : '•'.repeat(Math.min(code.length, 20))}
          </code>
          <button style={s.btnGhost} onClick={() => setShowCode(v => !v)}>
            {showCode ? '🙈 Verbergen' : '👁 Anzeigen'}
          </button>
          <button
            style={{ ...s.btnGhost, color: copied === 'code' ? '#22c55e' : undefined }}
            onClick={() => copyToClipboard(code, 'code')}
          >
            {copied === 'code' ? '✅ Kopiert' : '📋 Kopieren'}
          </button>
        </div>

        {message && <div style={s.alertSuccess}>{message}</div>}
        {error   && <div style={s.alertError}>{error}</div>}

        {!showInput ? (
          <button style={s.btnPrimary} onClick={() => setShowInput(true)}>Code ändern</button>
        ) : (
          <div style={s.inputGroup}>
            <input
              style={s.input}
              type="text"
              placeholder="Neuer Code (min. 8 Zeichen)"
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              autoFocus
            />
            <div style={s.btnRow}>
              <button style={s.btnPrimary} onClick={handleSave} disabled={saving}>
                {saving ? 'Speichern…' : '💾 Speichern'}
              </button>
              <button style={s.btnSecondary} onClick={() => { setShowInput(false); setNewCode(''); setError(''); }}>
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Einladungstext ──────────────────────────────── */}
      <div style={s.card}>
        <h2 style={s.h2}>📨 Einladungstext für Buddies</h2>
        <p style={s.desc}>
          Kopiere diesen Text und schick ihn per Discord, WhatsApp oder Signal. Dein Buddy muss nur den
          Installer laden und die Daten aus der Nachricht eintragen — fertig.
        </p>

        <div style={s.inviteBox}>
          <pre style={s.invitePre}>{buildInviteText()}</pre>
        </div>

        <div style={s.btnRow}>
          <button
            style={{ ...s.btnPrimary, ...(copied === 'invite' ? s.btnSuccess : {}) }}
            onClick={() => copyToClipboard(buildInviteText(), 'invite')}
          >
            {copied === 'invite' ? '✅ Kopiert!' : '📋 Ganzen Text kopieren'}
          </button>
        </div>

        {/* Einzelne Felder zum Kopieren */}
        <div style={s.fieldGrid}>
          <div style={s.fieldRow}>
            <span style={s.fieldLabel}>Server-URL</span>
            <code style={s.fieldValue}>{serverUrl}</code>
            <button style={s.btnGhost} onClick={() => copyToClipboard(serverUrl, 'url')}>
              {copied === 'url' ? '✅' : '📋'}
            </button>
          </div>
          <div style={s.fieldRow}>
            <span style={s.fieldLabel}>Registrierungs-Code</span>
            <code style={s.fieldValue}>{showCode ? code : '•'.repeat(Math.min(code.length, 20))}</code>
            <button style={s.btnGhost} onClick={() => copyToClipboard(code, 'code2')}>
              {copied === 'code2' ? '✅' : '📋'}
            </button>
          </div>
          <div style={s.fieldRow}>
            <span style={s.fieldLabel}>Download-Link</span>
            <code style={{ ...s.fieldValue, fontSize: '0.75rem' }}>{RELEASE_URL}</code>
            <button style={s.btnGhost} onClick={() => copyToClipboard(RELEASE_URL, 'dl')}>
              {copied === 'dl' ? '✅' : '📋'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Inline-Styles ───────────────────────────────────────────────────────── */
const s: Record<string, React.CSSProperties> = {
  page:         { padding: '2rem', maxWidth: 700, fontFamily: 'inherit' },
  h1:           { color: '#f1f2f6', marginBottom: '1.5rem', fontSize: '1.5rem' },
  h2:           { color: '#f1f2f6', marginBottom: '0.5rem', fontSize: '1.05rem', fontWeight: 600 },
  desc:         { color: '#8b92a9', fontSize: '0.875rem', marginBottom: '1.25rem', lineHeight: 1.6 },
  loading:      { padding: '2rem', color: '#8b92a9' },
  card:         { background: '#1a1d27', borderRadius: 12, padding: '1.5rem', border: '1px solid #2a2d3e', marginBottom: '1.5rem' },
  codeRow:      { display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' },
  codeBox:      { fontFamily: 'monospace', background: '#0f1117', padding: '0.4rem 0.9rem', borderRadius: 6, color: '#f1f2f6', letterSpacing: '0.07em', fontSize: '1rem', userSelect: 'all' },
  inviteBox:    { background: '#0f1117', borderRadius: 8, padding: '1rem 1.25rem', marginBottom: '1rem', border: '1px solid #2a2d3e' },
  invitePre:    { margin: 0, color: '#f1f2f6', fontFamily: 'monospace', fontSize: '0.82rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', userSelect: 'all' },
  fieldGrid:    { marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' },
  fieldRow:     { display: 'flex', alignItems: 'center', gap: '0.6rem', background: '#0f1117', borderRadius: 8, padding: '0.5rem 0.75rem', border: '1px solid #2a2d3e' },
  fieldLabel:   { color: '#8b92a9', fontSize: '0.8rem', minWidth: 160, flexShrink: 0 },
  fieldValue:   { fontFamily: 'monospace', color: '#f1f2f6', fontSize: '0.85rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', userSelect: 'all' },
  inputGroup:   { display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  input:        { background: '#0f1117', border: '1px solid #2a2d3e', borderRadius: 8, padding: '0.6rem 1rem', color: '#f1f2f6', fontSize: '0.95rem', width: '100%', outline: 'none', boxSizing: 'border-box' },
  btnRow:       { display: 'flex', gap: '0.75rem', flexWrap: 'wrap' },
  btnPrimary:   { background: '#5865f2', color: 'white', border: 'none', borderRadius: 8, padding: '0.5rem 1.25rem', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 500 },
  btnSecondary: { background: '#2a2d3e', color: '#f1f2f6', border: 'none', borderRadius: 8, padding: '0.5rem 1.25rem', cursor: 'pointer', fontSize: '0.9rem' },
  btnSuccess:   { background: '#22c55e' },
  btnGhost:     { background: 'transparent', color: '#8b92a9', border: '1px solid #2a2d3e', borderRadius: 6, padding: '0.25rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem', whiteSpace: 'nowrap' },
  alertSuccess: { background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' },
  alertError:   { background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.875rem' },
};
