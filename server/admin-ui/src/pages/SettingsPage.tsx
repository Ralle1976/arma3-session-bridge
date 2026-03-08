import { useState, useEffect } from 'react';
import { getSettings, updateSettings, getVpnMode, setVpnMode } from '../api/settings';
import { settingsTranslations, SettingsLang } from '../i18n/settingsTranslations';
import { getCleanupStatus, triggerCleanup, type CleanupStatus } from '../api/peerCleanup';

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
  const [cleanupStatus, setCleanupStatus] = useState<CleanupStatus | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupTriggering, setCleanupTriggering] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState('');
  const [lang, setLang] = useState<SettingsLang>(
    () => (localStorage.getItem('admin-lang') as SettingsLang) || 'de'
  );

  const t = settingsTranslations[lang];

  function toggleLang(newLang: SettingsLang) {
    setLang(newLang);
    localStorage.setItem('admin-lang', newLang);
  }

  useEffect(() => { loadSettings(); }, []);

  async function loadSettings() {
    try {
      const data = await getSettings();
      setCode(data.registration_code);
      setServerUrl(data.server_url);
      const modeData = await getVpnMode();
      setVpnModeState(modeData.mode);
      const cleanupData = await getCleanupStatus();
      setCleanupStatus(cleanupData);
    } catch {
      setError(t.errorLoading);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (newCode.length < 8) { setError(t.errorMinLength); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await updateSettings(newCode);
      setMessage('✅ ' + result.message);
      setCode(result.registration_code);
      setNewCode(''); setShowInput(false);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { detail?: string } } };
      setError(err?.response?.data?.detail ?? t.errorSaving);
    } finally { setSaving(false); }
  }

  async function handleVpnMode(mode: string) {
    setVpnModeSaving(true); setVpnModeMsg('');
    try {
      const result = await setVpnMode(mode);
      setVpnModeState(result.mode);
      setVpnModeMsg(mode === 'arma3' ? t.vpnModeArmaActive : t.vpnModeOpenActive);
      setTimeout(() => setVpnModeMsg(''), 3000);
    } catch { setVpnModeMsg(t.vpnModeError); }
    finally { setVpnModeSaving(false); }
  }

  async function handleCleanupTrigger() {
    setCleanupTriggering(true); setCleanupMsg('');
    try {
      const result = await triggerCleanup();
      const msg = result.peers_revoked === 0 ? t.cleanupResultNone : `${t.cleanupResultSuccess}: ${result.peers_revoked} peers`;
      setCleanupMsg('\u2705 ' + msg);
      const freshStatus = await getCleanupStatus();
      setCleanupStatus(freshStatus);
    } catch { setCleanupMsg('\u274c ' + t.cleanupError); }
    finally { setCleanupTriggering(false); }
  }

  function buildInviteText() {
    if (lang === 'en') {
      return `🎮 Arma 3 Session Bridge — Invitation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📡 HOW IT WORKS
When you connect the app, you get a virtual IP address
(e.g. 10.8.0.x). All connected players are then on the
same virtual LAN — as if you were on the same home network,
no matter where you are. No port forwarding, no public
game server needed.

🎯 ARMA 3: HOW TO PLAY
→ Everyone connects via the Session Bridge app first
→ Host starts Arma 3 → Multiplayer → LAN → Host Server
→ Players: Multiplayer → LAN → Game appears automatically
   OR: Direct connect via the host's IP (10.8.0.x)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚙️ SETUP (one-time, ~2 minutes)

1️⃣  Download the installer:
     ${RELEASE_URL}

2️⃣  Launch the app → Complete the setup wizard:
     • Server URL:           ${serverUrl}
     • Registration Code:    ${code}

3️⃣  Enter a device name (e.g. your gamer tag)

4️⃣  Done! Connect VPN → Launch Arma 3 → LAN → Play 🚀

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If you have any issues, just reach out.`;
    }

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

  if (loading) return <div className="p-8 text-gray-400">{t.loading}</div>;

  return (
    <div className="p-4 md:p-8 max-w-[700px]">
      {/* ── Header with language toggle ─────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-gray-100 text-2xl font-bold">{t.pageTitle}</h1>

        {/* DE/EN pill toggle */}
        <div className="flex items-center rounded-full border border-glass overflow-hidden bg-[rgba(10,16,28,0.7)] backdrop-blur-sm shadow-glow-accent-sm">
          <button
            onClick={() => toggleLang('de')}
            className={`px-4 py-1.5 text-sm font-semibold transition-all duration-200 ${
              lang === 'de'
                ? 'bg-accent text-white shadow-[0_0_8px_rgba(59,130,246,0.5)]'
                : 'text-gray-400 hover:text-gray-200 bg-transparent'
            }`}
          >
            DE
          </button>
          <div className="w-px h-5 bg-glass" />
          <button
            onClick={() => toggleLang('en')}
            className={`px-4 py-1.5 text-sm font-semibold transition-all duration-200 ${
              lang === 'en'
                ? 'bg-accent text-white shadow-[0_0_8px_rgba(59,130,246,0.5)]'
                : 'text-gray-400 hover:text-gray-200 bg-transparent'
            }`}
          >
            EN
          </button>
        </div>
      </div>

      {/* ── Registrierungs-Code ─────────────────────────── */}
      <div className="card mb-6">
        <h2 className="text-gray-100 mb-2 text-lg font-semibold">{t.regCodeTitle}</h2>
        <p className="text-gray-400 text-sm mb-5 leading-relaxed">
          {t.regCodeDesc}
        </p>

        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <code className="font-mono bg-[rgba(10,16,28,0.9)] px-3.5 py-1.5 rounded-md text-gray-100 tracking-wider text-base select-all border border-glass">
            {showCode ? code : '•'.repeat(Math.min(code.length, 20))}
          </code>
          <button
            className="bg-transparent text-gray-400 border border-glass rounded-md px-2.5 py-1 cursor-pointer text-sm whitespace-nowrap hover:text-gray-200 hover:border-glass-strong transition-colors"
            onClick={() => setShowCode(v => !v)}
          >
            {showCode ? t.btnHide : t.btnShow}
          </button>
          <button
            className={`bg-transparent border border-glass rounded-md px-2.5 py-1 cursor-pointer text-sm whitespace-nowrap hover:border-glass-strong transition-colors ${copied === 'code' ? 'text-green-500' : 'text-gray-400 hover:text-gray-200'}`}
            onClick={() => copyToClipboard(code, 'code')}
          >
            {copied === 'code' ? t.btnCopied : t.btnCopy}
          </button>
        </div>

        {message && <div className="bg-[rgba(34,197,94,0.12)] text-green-500 border border-[rgba(34,197,94,0.3)] rounded-lg px-4 py-3 mb-4 text-sm">{message}</div>}
        {error   && <div className="bg-[rgba(239,68,68,0.12)] text-red-500 border border-[rgba(239,68,68,0.3)] rounded-lg px-4 py-3 mb-4 text-sm">{error}</div>}

        {!showInput ? (
          <button className="btn-primary" onClick={() => setShowInput(true)}>{t.btnChangeCode}</button>
        ) : (
          <div className="flex flex-col gap-3">
            <input
              className="input-field"
              type="text"
              placeholder={t.inputNewCode}
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              autoFocus
            />
            <div className="flex gap-3 flex-wrap">
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? t.btnSaving : t.btnSave}
              </button>
              <button
                className="bg-[rgba(20,32,50,0.8)] text-gray-100 border-none rounded-lg px-5 py-2 cursor-pointer text-sm hover:bg-[rgba(30,48,72,0.9)] transition-colors"
                onClick={() => { setShowInput(false); setNewCode(''); setError(''); }}
              >
                {t.btnCancel}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Einladungstext ──────────────────────────────── */}
      <div className="card mb-6">
        <h2 className="text-gray-100 mb-2 text-lg font-semibold">{t.inviteTitle}</h2>
        <p className="text-gray-400 text-sm mb-5 leading-relaxed">
          {t.inviteDesc}
        </p>

        <div className="bg-[rgba(10,16,28,0.9)] rounded-lg p-4 mb-4 border border-glass">
          <pre className="m-0 text-gray-100 font-mono text-[0.82rem] leading-[1.7] whitespace-pre-wrap break-words select-all">{buildInviteText()}</pre>
        </div>

        <div className="flex gap-3 flex-wrap">
          <button
            className={copied === 'invite' ? 'bg-green-600 text-white font-bold px-5 py-2 rounded-xl cursor-pointer text-sm transition-colors border-none' : 'btn-primary'}
            onClick={() => copyToClipboard(buildInviteText(), 'invite')}
          >
            {copied === 'invite' ? t.btnCopiedAll : t.btnCopyAll}
          </button>
        </div>

        {/* Einzelne Felder zum Kopieren */}
        <div className="mt-5 flex flex-col gap-2.5">
          <div className="flex items-center gap-2.5 bg-[rgba(10,16,28,0.9)] rounded-lg px-3 py-2 border border-glass">
            <span className="text-gray-400 text-sm min-w-[160px] shrink-0">{t.labelServerUrl}</span>
            <code className="font-mono text-gray-100 text-sm flex-1 overflow-hidden text-ellipsis whitespace-nowrap select-all">{serverUrl}</code>
            <button
              className={`bg-transparent border border-glass rounded-md px-2.5 py-1 cursor-pointer text-sm whitespace-nowrap hover:border-glass-strong transition-colors ${copied === 'url' ? 'text-green-500' : 'text-gray-400 hover:text-gray-200'}`}
              onClick={() => copyToClipboard(serverUrl, 'url')}
            >
              {copied === 'url' ? '✅' : '📋'}
            </button>
          </div>
          <div className="flex items-center gap-2.5 bg-[rgba(10,16,28,0.9)] rounded-lg px-3 py-2 border border-glass">
            <span className="text-gray-400 text-sm min-w-[160px] shrink-0">{t.labelRegCode}</span>
            <code className="font-mono text-gray-100 text-sm flex-1 overflow-hidden text-ellipsis whitespace-nowrap select-all">{showCode ? code : '•'.repeat(Math.min(code.length, 20))}</code>
            <button
              className={`bg-transparent border border-glass rounded-md px-2.5 py-1 cursor-pointer text-sm whitespace-nowrap hover:border-glass-strong transition-colors ${copied === 'code2' ? 'text-green-500' : 'text-gray-400 hover:text-gray-200'}`}
              onClick={() => copyToClipboard(code, 'code2')}
            >
              {copied === 'code2' ? '✅' : '📋'}
            </button>
          </div>
          <div className="flex items-center gap-2.5 bg-[rgba(10,16,28,0.9)] rounded-lg px-3 py-2 border border-glass">
            <span className="text-gray-400 text-sm min-w-[160px] shrink-0">{t.labelDownload}</span>
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
        <h2 className="text-gray-100 mb-2 text-lg font-semibold">{t.vpnModeTitle}</h2>
        <p className="text-gray-400 text-sm mb-5 leading-relaxed">
          {t.vpnModeDesc}
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
            {t.vpnModeArma}
            <small className="text-[0.72rem] text-gray-400">{t.vpnModeArmaDesc}</small>
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
            {t.vpnModeOpen}
            <small className="text-[0.72rem] text-gray-400">{t.vpnModeOpenDesc}</small>
          </button>
        </div>
        {vpnModeMsg && <div className="bg-[rgba(34,197,94,0.12)] text-green-500 border border-[rgba(34,197,94,0.3)] rounded-lg px-4 py-3 mb-4 text-sm">{vpnModeMsg}</div>}
      </div>

      {/* ── Peer Auto-Cleanup ───────────────────────────── */}
      <div className="card mb-6">
        <h2 className="text-gray-100 mb-2 text-lg font-semibold">{t.cleanupTitle}</h2>
        <p className="text-gray-400 text-sm mb-5 leading-relaxed">
          {t.cleanupDesc}
        </p>

        {cleanupStatus && (
          <>
            {/* Config row */}
            <div className="flex gap-3 flex-wrap mb-5">
              <div className="bg-[rgba(10,16,28,0.9)] rounded-lg px-3 py-2 border border-glass flex items-center gap-2">
                <span className="text-gray-400 text-sm">{t.cleanupInterval}:</span>
                <span className="text-gray-100 text-sm font-semibold">{cleanupStatus.interval_hours} {t.cleanupHours}</span>
              </div>
              <div className="bg-[rgba(10,16,28,0.9)] rounded-lg px-3 py-2 border border-glass flex items-center gap-2">
                <span className="text-gray-400 text-sm">{t.cleanupThreshold}:</span>
                <span className="text-gray-100 text-sm font-semibold">{cleanupStatus.threshold_days} {t.cleanupDays}</span>
              </div>
            </div>

            {/* Stats row */}
            <div className="flex gap-3 flex-wrap mb-5">
              <div className="bg-[rgba(10,16,28,0.9)] rounded-lg px-3 py-2 border border-glass flex items-center gap-2">
                <span className="text-gray-400 text-sm">{t.cleanupActivePeers}:</span>
                <span className="text-gray-100 text-sm font-semibold">{cleanupStatus.total_active_peers}</span>
              </div>
              <div className="bg-[rgba(10,16,28,0.9)] rounded-lg px-3 py-2 border border-glass flex items-center gap-2">
                <span className="text-gray-400 text-sm">{t.cleanupToRevoke}:</span>
                <span className={`text-sm font-semibold ${cleanupStatus.peers_to_revoke > 0 ? 'text-red-400' : 'text-gray-100'}`}>
                  {cleanupStatus.peers_to_revoke}
                </span>
              </div>
            </div>

            {/* Peer table */}
            {cleanupStatus.peers.length === 0 ? (
              <p className="text-gray-500 text-sm italic mb-5">{t.cleanupNoPeers}</p>
            ) : (
              <div className="rounded-xl overflow-hidden border border-glass mb-5">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-[rgba(14,24,37,0.6)] border-b border-glass-strong">
                      <th className="px-4 py-3 text-left text-gray-400 font-medium text-xs uppercase tracking-wider">{t.cleanupPeerName}</th>
                      <th className="px-4 py-3 text-left text-gray-400 font-medium text-xs uppercase tracking-wider">{t.cleanupPeerIp}</th>
                      <th className="px-4 py-3 text-left text-gray-400 font-medium text-xs uppercase tracking-wider">{t.cleanupPeerDays}</th>
                      <th className="px-4 py-3 text-left text-gray-400 font-medium text-xs uppercase tracking-wider">{t.cleanupPeerStatus}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...cleanupStatus.peers]
                      .sort((a, b) => b.days_inactive - a.days_inactive)
                      .map(peer => (
                        <tr key={peer.id} className="hover:bg-[rgba(30,48,72,0.4)] transition-colors border-b border-glass last:border-b-0">
                          <td className="px-4 py-3 font-medium text-gray-200">{peer.name}</td>
                          <td className="px-4 py-3 font-mono text-sm text-gray-400">{peer.tunnel_ip}</td>
                          <td className="px-4 py-3 text-sm" style={{ color: peer.days_inactive > 20 ? '#ef4444' : peer.days_inactive > 7 ? '#f59e0b' : '#22c55e' }}>
                            {peer.days_inactive}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
                              peer.would_revoke
                                ? 'bg-[rgba(239,68,68,0.1)] text-red-400 border-[rgba(239,68,68,0.35)]'
                                : 'bg-[rgba(34,197,94,0.1)] text-green-400 border-[rgba(34,197,94,0.35)]'
                            }`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${peer.would_revoke ? 'bg-red-400' : 'bg-green-400'}`} />
                              {peer.would_revoke ? t.cleanupPeerDanger : t.cleanupPeerSafe}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Action button */}
        <div className="flex items-center gap-4 flex-wrap">
          <button
            className="btn-primary"
            onClick={handleCleanupTrigger}
            disabled={cleanupTriggering || cleanupLoading}
          >
            {cleanupTriggering ? t.cleanupTriggering : t.cleanupTrigger}
          </button>
        </div>

        {/* Result message */}
        {cleanupMsg && (
          <div className={`mt-4 rounded-lg px-4 py-3 text-sm border ${
            cleanupMsg.startsWith('\u274c')
              ? 'bg-[rgba(239,68,68,0.12)] text-red-500 border-[rgba(239,68,68,0.3)]'
              : 'bg-[rgba(34,197,94,0.12)] text-green-500 border-[rgba(34,197,94,0.3)]'
          }`}>
            {cleanupMsg}
          </div>
        )}
      </div>
    </div>
  );
}
