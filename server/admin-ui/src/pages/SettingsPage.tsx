import { useState, useEffect } from 'react';
import { getSettings, updateSettings, getVpnMode, setVpnMode } from '../api/settings';

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
  const [vpnMode, setVpnModeState] = useState('arma3');
  const [vpnModeSaving, setVpnModeSaving] = useState(false);
  const [vpnModeMsg, setVpnModeMsg] = useState('');

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    try {
      const data = await getSettings();
      setCode(data.registration_code);
      setServerUrl(data.server_url);
      const modeData = await getVpnMode();
      setVpnModeState(modeData.mode);
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
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err?.response?.data?.detail ?? 'Fehler beim Speichern');
    } finally { setSaving(false); }
  }

  async function handleVpnMode(mode: string) {
    setVpnModeSaving(true); setVpnModeMsg('');
    try {
      const result = await setVpnMode(mode);
      setVpnModeState(result.mode);
      setVpnModeMsg(mode === 'arma3' ? '✅ Arma 3 Modus aktiv' : '✅ Offener Modus aktiv');
      setTimeout(() => setVpnModeMsg(''), 3000);
    } catch { setVpnModeMsg('❌ Fehler beim Umschalten'); }
    finally { setVpnModeSaving(false); }
  }

  function buildInviteText() {
    return `🎮 Arma 3 Session Bridge — Einladung
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 WIE ES FUNKTIONIERT
Wenn du die App verbindest, bekommst du eine virtuelle
IP-Adresse (z.B. 10.8.0.x). Alle verbundenen Spieler
befinden sich dann im gleichen virtuellen LAN — als wärt
ihr im selben Heimnetzwerk, egal wo ihr gerade seid.
Kein Port-Forwarding, kein öffentlicher Gameserver nötig.

🎯 ARMA 3: SO FUNKTIONIERT'S
→ Alle verbinden sich zuerst mit der Session Bridge App
→ Gastgeber startet Arma 3 → Mehrspieler → LAN → Spiel erstellen
→ Mitspieler: Mehrspieler → LAN → Spiel erscheint automatisch
   ODER: Direktverbindung über die IP des Gastgebers (10.8.0.x)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚙️ EINRICHTUNG (einmalig, ~2 Minuten)

1️⃣  Installer herunterladen:
     ${RELEASE_URL}

2️⃣  App starten → Einrichtungs-Wizard ausfüllen:
     • Server-URL:            ${serverUrl}
     • Registrierungs-Code:  ${code}

3️⃣  Gerätename eingeben (z.B. deinen Gamer-Tag)

4️⃣  Fertig! VPN verbinden → Arma 3 starten → LAN → spielen 🚀

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Bei Problemen einfach melden.`;
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    });
  }

  if (loading) return <div className="p-8 text-gray-400">Laden…</div>;

  return (
    <div className="p-4 md:p-8 max-w-[700px]">
      <h1 className="text-gray-100 mb-6 text-2xl font-bold">⚙️ Einstellungen</h1>

      {/* ── Registrierungs-Code ─────────────────────────── */}
      <div className="card mb-6">
        <h2 className="text-gray-100 mb-2 text-lg font-semibold">🔑 Registrierungs-Code</h2>
        <p className="text-gray-400 text-sm mb-5 leading-relaxed">
          Neue Spieler geben diesen Code beim ersten App-Start ein. Nur du (der Admin) siehst ihn hier im Klartext.
        </p>

        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <code className="font-mono bg-[rgba(10,16,28,0.9)] px-3.5 py-1.5 rounded-md text-gray-100 tracking-wider text-base select-all border border-glass">
            {showCode ? code : '•'.repeat(Math.min(code.length, 20))}
          </code>
          <button
            className="bg-transparent text-gray-400 border border-glass rounded-md px-2.5 py-1 cursor-pointer text-sm whitespace-nowrap hover:text-gray-200 hover:border-glass-strong transition-colors"
            onClick={() => setShowCode(v => !v)}
          >
            {showCode ? '🙈 Verbergen' : '👁 Anzeigen'}
          </button>
          <button
            className={`bg-transparent border border-glass rounded-md px-2.5 py-1 cursor-pointer text-sm whitespace-nowrap hover:border-glass-strong transition-colors ${copied === 'code' ? 'text-green-500' : 'text-gray-400 hover:text-gray-200'}`}
            onClick={() => copyToClipboard(code, 'code')}
          >
            {copied === 'code' ? '✅ Kopiert' : '📋 Kopieren'}
          </button>
        </div>

        {message && <div className="bg-[rgba(34,197,94,0.12)] text-green-500 border border-[rgba(34,197,94,0.3)] rounded-lg px-4 py-3 mb-4 text-sm">{message}</div>}
        {error   && <div className="bg-[rgba(239,68,68,0.12)] text-red-500 border border-[rgba(239,68,68,0.3)] rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

        {!showInput ? (
          <button className="btn-primary" onClick={() => setShowInput(true)}>Code ändern</button>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              className="input-field"
              type="text"
              placeholder="Neuer Code (min. 8 Zeichen)"
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              autoFocus
            />
            <div className="flex gap-3 flex-wrap">
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Speichern…' : '💾 Speichern'}
              </button>
              <button
                className="bg-[rgba(20,32,50,0.8)] text-gray-100 border-none rounded-lg px-5 py-2 cursor-pointer text-sm hover:bg-[rgba(30,48,72,0.9)] transition-colors"
                onClick={() => { setShowInput(false); setNewCode(''); setError(''); }}
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Einladungstext ──────────────────────────────── */}
      <div className="card mb-6">
        <h2 className="text-gray-100 mb-2 text-lg font-semibold">📨 Einladungstext für Buddies</h2>
        <p className="text-gray-400 text-sm mb-5 leading-relaxed">
          Kopiere diesen Text und schick ihn per Discord, WhatsApp oder Signal. Dein Buddy muss nur den
          Installer laden und die Daten aus der Nachricht eintragen — fertig.
        </p>

        <div className="bg-[rgba(10,16,28,0.9)] rounded-lg p-4 mb-4 border border-glass">
          <pre className="m-0 text-gray-100 font-mono text-[0.82rem] leading-[1.7] whitespace-pre-wrap break-words select-all">{buildInviteText()}</pre>
        </div>

        <div className="flex gap-3 flex-wrap">
          <button
            className={copied === 'invite' ? 'bg-green-600 text-white font-bold px-5 py-2 rounded-xl cursor-pointer text-sm transition-colors border-none' : 'btn-primary'}
            onClick={() => copyToClipboard(buildInviteText(), 'invite')}
          >
            {copied === 'invite' ? '✅ Kopiert!' : '📋 Ganzen Text kopieren'}
          </button>
        </div>

        {/* Einzelne Felder zum Kopieren */}
        <div className="mt-5 flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5 bg-[rgba(10,16,28,0.9)] rounded-lg px-3 py-2 border border-glass">
            <span className="text-gray-400 text-sm min-w-[160px] shrink-0">Server-URL</span>
            <code className="font-mono text-gray-100 text-sm flex-1 overflow-hidden text-ellipsis whitespace-nowrap select-all">{serverUrl}</code>
            <button
              className={`bg-transparent border border-glass rounded-md px-2.5 py-1 cursor-pointer text-sm whitespace-nowrap hover:border-glass-strong transition-colors ${copied === 'url' ? 'text-green-500' : 'text-gray-400 hover:text-gray-200'}`}
              onClick={() => copyToClipboard(serverUrl, 'url')}
            >
              {copied === 'url' ? '✅' : '📋'}
            </button>
          </div>
          <div className="flex items-center gap-2.5 bg-[rgba(10,16,28,0.9)] rounded-lg px-3 py-2 border border-glass">
            <span className="text-gray-400 text-sm min-w-[160px] shrink-0">Registrierungs-Code</span>
            <code className="font-mono text-gray-100 text-sm flex-1 overflow-hidden text-ellipsis whitespace-nowrap select-all">{showCode ? code : '•'.repeat(Math.min(code.length, 20))}</code>
            <button
              className={`bg-transparent border border-glass rounded-md px-2.5 py-1 cursor-pointer text-sm whitespace-nowrap hover:border-glass-strong transition-colors ${copied === 'code2' ? 'text-green-500' : 'text-gray-400 hover:text-gray-200'}`}
              onClick={() => copyToClipboard(code, 'code2')}
            >
              {copied === 'code2' ? '✅' : '📋'}
            </button>
          </div>
          <div className="flex items-center gap-2.5 bg-[rgba(10,16,28,0.9)] rounded-lg px-3 py-2 border border-glass">
            <span className="text-gray-400 text-sm min-w-[160px] shrink-0">Download-Link</span>
            <code className="font-mono text-gray-100 text-xs flex-1 overflow-hidden text-ellipsis whitespace-nowrap select-all">{RELEASE_URL}</code>
            <button
              className={`bg-transparent border border-glass rounded-md px-2.5 py-1 cursor-pointer text-sm whitespace-nowrap hover:border-glass-strong transition-colors ${copied === 'dl' ? 'text-green-500' : 'text-gray-400 hover:text-gray-200'}`}
              onClick={() => copyToClipboard(RELEASE_URL, 'dl')}
            >
              {copied === 'dl' ? '✅' : '📋'}
            </button>
          </div>
        </div>
      </div>

      {/* ── VPN-Modus ───────────────────────────────────── */}
      <div className="card mb-6">
        <h2 className="text-gray-100 mb-2 text-lg font-semibold">🔥 VPN-Modus</h2>
        <p className="text-gray-400 text-sm mb-5 leading-relaxed">
          Steuert welcher Traffic zwischen verbundenen Spielern erlaubt ist.
          Standard: nur Arma 3 (empfohlen). Offen: alle Ports — für andere Nutzung.
        </p>
        <div className="flex gap-4 mb-4">
          <button
            className={`flex-1 bg-[rgba(10,16,28,0.9)] border-2 rounded-xl p-4 cursor-pointer flex flex-col items-center gap-1 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
              vpnMode === 'arma3'
                ? 'border-accent text-gray-100 bg-[rgba(59,130,246,0.1)] shadow-glow-accent-sm'
                : 'border-glass text-gray-400 hover:border-glass-strong'
            }`}
            onClick={() => handleVpnMode('arma3')}
            disabled={vpnModeSaving}
          >
            🎮 Arma 3 only
            <small className="text-[0.72rem] text-gray-400">UDP 2302-2305 + BattlEye</small>
          </button>
          <button
            className={`flex-1 bg-[rgba(10,16,28,0.9)] border-2 rounded-xl p-4 cursor-pointer flex flex-col items-center gap-1 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed ${
              vpnMode === 'open'
                ? 'border-accent text-gray-100 bg-[rgba(59,130,246,0.1)] shadow-glow-accent-sm'
                : 'border-glass text-gray-400 hover:border-glass-strong'
            }`}
            onClick={() => handleVpnMode('open')}
            disabled={vpnModeSaving}
          >
            🔓 Offen
            <small className="text-[0.72rem] text-gray-400">Alle Ports zwischen Peers</small>
          </button>
        </div>
        {vpnModeMsg && <div className="bg-[rgba(34,197,94,0.12)] text-green-500 border border-[rgba(34,197,94,0.3)] rounded-lg px-4 py-3 mb-4 text-sm">{vpnModeMsg}</div>}
      </div>
    </div>
  );
}
