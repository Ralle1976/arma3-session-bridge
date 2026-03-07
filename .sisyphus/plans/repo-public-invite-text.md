# Repo öffentlich + Erweiterter Einladungstext

## TL;DR

> **Quick Summary**: Altes GitHub-Repo wieder öffentlich schalten, Einladungstext mit VPN-Erklärung erweitern,
> README mit Platzhaltern dokumentieren, und VPN-Traffic standardmäßig auf Arma 3 Ports einschränken
> (admin-umschaltbar zwischen "Arma 3" und "offen").
>
> **Deliverables**:
> - Alte Release-Assets (v0.1.0–v0.1.6) gelöscht → nicht mehr herunterladbar
> - Repo auf public gestellt → Download-Link funktioniert wieder
> - `SettingsPage.tsx` → erweiterter Einladungstext + VPN-Modus-Toggle (Admin)
> - WireGuard Startup-Script → Default "Arma 3 restricted" (nur UDP 2302-2305)
> - Backend API → `PUT /admin/vpn-mode` → iptables via Docker SDK umschalten
> - `README.md` → saubere Projektdoku mit Platzhaltern
> - `docker-compose.yml` lokal um `PEER_REGISTRATION_CODE` + `SERVER_PUBLIC_URL` ergänzt
> - Admin-UI neu gebaut + deployed
>
> **Estimated Effort**: Medium
> **Parallel Execution**: NO — sequenziell (Abhängigkeiten)
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4+7 → Task 5+8 → Task 6+9 → Task 10

---

## Context

### Original Request
- Download-Link im Einladungstext funktioniert nicht weil Repo privat ist
- Nutzer sollen nicht nur die Verbindungsdaten erhalten, sondern auch verstehen was die App macht
- Erklärung: virtuelles LAN via WireGuard, wie Arma 3 LAN-Spiel funktioniert

### Technischer Hintergrund (für Einladungstext)
Wenn ein Spieler die App verbindet:
- Bekommt er eine virtuelle IP (10.8.0.x) im privaten VPN-Subnetz
- Alle verbundenen Spieler sind in diesem virtuellen LAN
- Arma 3 → Mehrspieler → LAN → Spiel des Hosts erscheint automatisch
- Kein Port-Forwarding, kein öffentlicher Gameserver nötig
- Konzept identisch mit Hamachi/ZeroTier, aber auf eigenem Server

### Offene Baustelle aus letzter Session
`docker-compose.yml` im lokalen Repo fehlt noch `PEER_REGISTRATION_CODE` + `SERVER_PUBLIC_URL` — wird in Task 1 mit erledigt.

---

## Work Objectives

### Core Objective
Repo wieder öffentlich + Einladungstext so erweitern dass Buddies sofort verstehen was die App tut und wie sie Arma 3 nutzen.

### Concrete Deliverables
- GitHub Release-Assets v0.1.0–v0.1.6 gelöscht (Releases selbst bleiben als Changelog)
- Repo Visibility: private → public
- `server/admin-ui/src/pages/SettingsPage.tsx`: `buildInviteText()` mit vollständiger Erklärung
- `docker-compose.yml`: zwei fehlende ENV-Keys ergänzt
- Admin-UI auf Server deployed

### Must NOT Have (Guardrails)
- KEINE sensiblen Daten im Einladungstext hardcoden (server_url und code kommen dynamisch aus der API)
- NICHT die v0.1.7 Release-Assets löschen — nur v0.1.0–v0.1.6
- KEINE anderen Dateien anfassen außer den genannten
- KEIN Commit mit Passwörtern, IPs oder API-Keys

---

## Execution Strategy

```
Wave 1 — Sequenziell (jeder Schritt baut auf dem vorherigen auf):
  Task 1: docker-compose.yml lokal fixen + committen
  Task 2: GitHub Release-Assets v0.1.0–v0.1.6 löschen (via gh CLI)
  Task 3: GitHub Repo auf public stellen (via gh CLI)
  Task 4: SettingsPage.tsx buildInviteText() erweitern + committen
  Task 5: SCP + Admin-UI rebuild + deploy auf Server
```

---

## TODOs

- [ ] 1. `docker-compose.yml` — fehlende ENV-Keys ergänzen + committen

  **What to do**:
  In `/mnt/c/Users/tango/Desktop/Bots/arma3-session-bridge/docker-compose.yml`
  unter `api` → `environment`, nach der Zeile `- WG_SERVER_PUBLIC_KEY=${WG_SERVER_PUBLIC_KEY}` einfügen:
  ```yaml
        - PEER_REGISTRATION_CODE=${PEER_REGISTRATION_CODE}
        - SERVER_PUBLIC_URL=${SERVER_PUBLIC_URL}
  ```
  Dann committen:
  ```bash
  cd /mnt/c/Users/tango/Desktop/Bots/arma3-session-bridge
  git add docker-compose.yml
  git commit -m "fix: docker-compose — PEER_REGISTRATION_CODE + SERVER_PUBLIC_URL für api-Service"
  ```

  **Must NOT do**:
  - Keine anderen Zeilen in docker-compose.yml verändern
  - Keine echten Werte eintragen — nur `${VARIABLE_NAME}` Platzhalter

  **Acceptance Criteria**:
  - [ ] `docker-compose.yml` enthält beide ENV-Keys in `api.environment`
  - [ ] `git diff HEAD` zeigt nur die zwei neuen Zeilen

---

- [ ] 2. GitHub Release-Assets v0.1.0–v0.1.6 löschen

  **What to do**:
  Via `gh` CLI alle Release-Assets der alten, nicht-funktionierenden Versionen löschen.
  Die Release-Einträge selbst bleiben bestehen (als Changelog/Versionshistorie).
  Nur die `.exe`-Dateien (Assets) werden entfernt.

  ```bash
  # Alle Releases auflisten
  gh release list --repo Ralle1976/arma3-session-bridge

  # Für jede Version v0.1.0 bis v0.1.6:
  # Assets auflisten
  gh release view v0.1.0 --repo Ralle1976/arma3-session-bridge --json assets

  # Asset löschen (Asset-ID via API ermitteln):
  # gh api repos/Ralle1976/arma3-session-bridge/releases/tags/v0.1.0 --jq '.assets[].id'
  # gh api -X DELETE repos/Ralle1976/arma3-session-bridge/releases/assets/{ASSET_ID}
  ```

  Skript-Variante (alle auf einmal):
  ```bash
  for TAG in v0.1.0 v0.1.1 v0.1.2 v0.1.3 v0.1.4 v0.1.5 v0.1.6; do
    echo "Processing $TAG..."
    ASSET_IDS=$(gh api repos/Ralle1976/arma3-session-bridge/releases/tags/$TAG \
      --jq '.assets[].id' 2>/dev/null || echo "")
    for ID in $ASSET_IDS; do
      echo "  Deleting asset $ID from $TAG"
      gh api -X DELETE repos/Ralle1976/arma3-session-bridge/releases/assets/$ID
    done
  done
  echo "Done"
  ```

  **Must NOT do**:
  - NICHT v0.1.7 Assets anfassen
  - NICHT die Release-Einträge selbst löschen (nur Assets)
  - NICHT das Repository löschen oder umbenennen

  **Acceptance Criteria**:
  - [ ] `gh release view v0.1.6 --json assets` → `assets: []` (leer)
  - [ ] `gh release view v0.1.7 --json assets` → enthält noch die `.exe`

---

- [ ] 3. GitHub Repo auf public stellen

  **What to do**:
  ```bash
  gh repo edit Ralle1976/arma3-session-bridge --visibility public --accept-visibility-change-consequences
  ```

  Danach verifizieren:
  ```bash
  gh repo view Ralle1976/arma3-session-bridge --json isPrivate --jq '.isPrivate'
  # Erwartetes Ergebnis: false
  ```

  Download-Link prüfen:
  ```bash
  curl -sI https://github.com/Ralle1976/arma3-session-bridge/releases/latest | grep location
  # Erwartetes Ergebnis: redirect zu /releases/tag/v0.1.7
  ```

  **Must NOT do**:
  - Nur ausführen NACHDEM Task 2 (Assets gelöscht) abgeschlossen ist

  **Acceptance Criteria**:
  - [ ] `gh repo view` zeigt `isPrivate: false`
  - [ ] `https://github.com/Ralle1976/arma3-session-bridge/releases/latest` ist ohne Login erreichbar
  - [ ] Nur v0.1.7 hat einen Download-Asset

---

- [ ] 4. `SettingsPage.tsx` — Einladungstext mit VPN-Erklärung erweitern

  **What to do**:
  In `/mnt/c/Users/tango/Desktop/Bots/arma3-session-bridge/server/admin-ui/src/pages/SettingsPage.tsx`
  die Funktion `buildInviteText()` (Zeile ~45) ersetzen durch den erweiterten Text:

  ```typescript
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
  ```

  Dann committen + pushen:
  ```bash
  cd /mnt/c/Users/tango/Desktop/Bots/arma3-session-bridge
  git add server/admin-ui/src/pages/SettingsPage.tsx
  git commit -m "feat: Einladungstext mit VPN-Erklärung + Arma 3 Anleitung erweitern"
  git push origin master
  ```

  **References**:
  - `server/admin-ui/src/pages/SettingsPage.tsx:45-60` — aktuelle `buildInviteText()` Funktion
  - `server/admin-ui/src/pages/SettingsPage.tsx:4` — `RELEASE_URL` Konstante (bereits definiert)
  - Variablen `serverUrl` und `code` kommen aus React-State (bereits vorhanden, dynamisch aus API)

  **Must NOT do**:
  - `serverUrl`, `code` oder `RELEASE_URL` NICHT hardcoden — nur die vorhandenen Variablen verwenden
  - Keine anderen Teile der Datei verändern (Styles, andere Funktionen)

  **Acceptance Criteria**:
  - [ ] `buildInviteText()` enthält den VPN-Erklärungs-Block
  - [ ] `buildInviteText()` enthält den Arma 3 Anweisungs-Block
  - [ ] `${serverUrl}` und `${code}` sind weiterhin dynamisch (nicht hardcoded)
  - [ ] TypeScript-Build läuft durch: `npm run build` im `server/admin-ui` Verzeichnis (kein TS-Fehler)

---

- [ ] 5. Admin-UI auf Server deployen

  **What to do**:
  ```bash
  # Geänderte Dateien per SCP auf Server kopieren
  sshpass -p 'rcpzug3lUvZtEg' scp -o StrictHostKeyChecking=no \
    server/admin-ui/src/pages/SettingsPage.tsx \
    root@212.227.54.229:/opt/arma3-session-bridge/server/admin-ui/src/pages/SettingsPage.tsx

  # Admin-UI neu bauen + Container neustarten
  sshpass -p 'rcpzug3lUvZtEg' ssh -o StrictHostKeyChecking=no root@212.227.54.229 "
    cd /opt/arma3-session-bridge
    docker compose build admin-ui 2>&1 | tail -5
    docker compose up -d --force-recreate admin-ui
    sleep 3
    docker compose ps
  "
  ```

  Danach End-to-End verifizieren:
  ```bash
  # Admin-UI erreichbar?
  curl -sI https://arma3-session-bridge.ralle1976.cloud | grep HTTP

  # Einladungstext via API prüfen (enthält VPN-Erklärung?)
  TOKEN=$(curl -s -X POST https://arma3-session-bridge.ralle1976.cloud/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"password": "Zwp2QHRZKrH27zKKIETf"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
  curl -s https://arma3-session-bridge.ralle1976.cloud/api/admin/settings \
    -H "Authorization: Bearer $TOKEN"
  # server_url muss "https://arma3-session-bridge.ralle1976.cloud" sein
  ```

  **Must NOT do**:
  - NICHT den `api`-Container anfassen (Settings-API funktioniert bereits)
  - NICHT WireGuard-Container neustarten

  **Acceptance Criteria**:
  - [ ] `https://arma3-session-bridge.ralle1976.cloud` antwortet mit HTTP 200
  - [ ] Admin-UI → Einstellungen → Einladungstext enthält "WIE ES FUNKTIONIERT"-Block
  - [ ] Einladungstext enthält "ARMA 3: SO FUNKTIONIERT'S"-Block
  - [ ] `server_url` im kopierten Text ist `https://arma3-session-bridge.ralle1976.cloud` (nicht localhost)
  - [ ] Download-Link im Text ist klickbar (Repo ist jetzt public)

---

- [ ] 5. `README.md` — Projekt sauber dokumentieren (mit Platzhaltern)

  **What to do**:
  Die bestehende `README.md` im Repo-Root ist ein nichtssagender Placeholder-Text.
  Ersetzen durch eine echte Projektbeschreibung — aber OHNE echte Server-URL, IP oder Codes.

  Inhalt des neuen README:
  ```markdown
  # Arma 3 Session Bridge

  Private WireGuard VPN-basierte Session-Management-App für Arma 3 — dein eigenes Hamachi, auf deinem eigenen Server.

  ## Was ist das?

  Arma 3 Session Bridge verbindet Spieler über ein **privates WireGuard-VPN** auf einem selbst gehosteten Server.
  Jeder verbundene Spieler erhält eine virtuelle IP-Adresse (z.B. `10.8.0.x`) und befindet sich damit
  im gleichen virtuellen LAN — als wären alle im selben Heimnetzwerk, egal wo sie sich befinden.

  Kein Port-Forwarding, kein öffentlicher Gameserver, keine Drittanbieter (wie Hamachi oder ZeroTier).

  ## Arma 3: So funktioniert's

  1. Alle Spieler verbinden sich mit der Session Bridge App → VPN aktiv
  2. Gastgeber startet Arma 3 → Mehrspieler → **LAN** → Spiel erstellen
  3. Mitspieler: Mehrspieler → LAN → Spiel erscheint automatisch im Browser
     oder Direktverbindung über die virtuelle IP des Gastgebers (`10.8.0.x`)

  ## Komponenten

  | Komponente | Tech | Beschreibung |
  |---|---|---|
  | **Windows Client** | Tauri v2 + React + Rust | Ersteinrichtungs-Wizard, WireGuard VPN, Session-Liste |
  | **Backend API** | Python + FastAPI | Peer-Registrierung, WireGuard-Management, Sessions |
  | **Admin-UI** | React + Vite | Dashboard, Peer-Verwaltung, Einladungstext-Generator |
  | **WireGuard** | linuxserver/wireguard | VPN-Server (Hub & Spoke) |

  ## Self-Hosting

  ### Voraussetzungen
  - Linux VPS (Ubuntu 22.04+), mind. 1 vCPU / 1 GB RAM
  - Docker + Docker Compose
  - Domain oder öffentliche IP

  ### Schnellstart

  ```bash
  git clone https://github.com/Ralle1976/arma3-session-bridge.git
  cd arma3-session-bridge
  cp .env.example .env
  # .env anpassen (siehe unten)
  docker compose up -d
  ```

  ### `.env` Konfiguration

  ```env
  ADMIN_PASSWORD=dein-sicheres-passwort
  JWT_SECRET=langer-zufaelliger-string
  WG_SERVER_IP=DEINE-SERVER-IP
  WG_PORT=51820
  WG_SERVER_PUBLIC_KEY=wird-automatisch-generiert
  PEER_REGISTRATION_CODE=dein-registrierungscode
  SERVER_PUBLIC_URL=https://deine-domain.example.com
  ```

  ### Dienste

  | Service | Port | URL |
  |---|---|---|
  | Backend API | 8001 | `https://deine-domain.example.com/api/` |
  | Admin-UI | 8090 | `https://deine-domain.example.com/` |
  | WireGuard | 51820/UDP | VPN-Endpunkt |

  ## Download (Windows Client)

  → **[Releases](https://github.com/Ralle1976/arma3-session-bridge/releases/latest)**

  ## Lizenz

  Privates Projekt — kein öffentliches Hosting vorgesehen. Self-Hosting auf eigene Verantwortung.
  ```

  Committen:
  ```bash
  git add README.md
  git commit -m "docs: README mit Projektbeschreibung, VPN-Erklärung, Self-Hosting Guide (Platzhalter)"
  git push origin master
  ```

  **Must NOT do**:
  - KEINE echte Server-URL (`arma3-session-bridge.ralle1976.cloud`) im README
  - KEINE echte IP (`212.227.54.229`) im README
  - KEINE echten Codes oder Passwörter im README
  - Nur `deine-domain.example.com`, `DEINE-SERVER-IP`, `dein-registrierungscode` als Platzhalter

  **Acceptance Criteria**:
  - [ ] `grep -r '212.227\|ralle1976.cloud\|rcpzug3\|osxIW1t\|Zwp2QHR' README.md` → kein Treffer
  - [ ] README enthält Abschnitte: Was ist das? / Arma 3 Anleitung / Self-Hosting / Download
  - [ ] README enthält nur Platzhalter-URLs wie `https://deine-domain.example.com`

---

- [ ] 6. Admin-UI auf Server deployen

  **What to do**:
  ```bash
  # Geänderte Datei per SCP auf Server kopieren
  sshpass -p 'rcpzug3lUvZtEg' scp -o StrictHostKeyChecking=no \
    server/admin-ui/src/pages/SettingsPage.tsx \
    root@212.227.54.229:/opt/arma3-session-bridge/server/admin-ui/src/pages/SettingsPage.tsx

  # Admin-UI neu bauen + Container neustarten
  sshpass -p 'rcpzug3lUvZtEg' ssh -o StrictHostKeyChecking=no root@212.227.54.229 "
    cd /opt/arma3-session-bridge
    docker compose build admin-ui 2>&1 | tail -5
    docker compose up -d --force-recreate admin-ui
    sleep 3
    docker compose ps
  "
  ```

  Danach End-to-End verifizieren:
  ```bash
  # Admin-UI erreichbar?
  curl -sI https://arma3-session-bridge.ralle1976.cloud | grep HTTP

  # Settings API: server_url korrekt?
  TOKEN=$(curl -s -X POST https://arma3-session-bridge.ralle1976.cloud/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"password": "Zwp2QHRZKrH27zKKIETf"}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
  curl -s https://arma3-session-bridge.ralle1976.cloud/api/admin/settings \
    -H "Authorization: Bearer $TOKEN"
  # server_url muss "https://arma3-session-bridge.ralle1976.cloud" sein
  ```

  **Must NOT do**:
  - NICHT den `api`-Container anfassen
  - NICHT WireGuard-Container neustarten

  **Acceptance Criteria**:
  - [ ] `https://arma3-session-bridge.ralle1976.cloud` antwortet mit HTTP 200
  - [ ] Admin-UI → Einstellungen → Einladungstext enthält "WIE ES FUNKTIONIERT"-Block
  - [ ] Einladungstext enthält "ARMA 3: SO FUNKTIONIERT'S"-Block
  - [ ] `server_url` im Einladungstext ist `https://arma3-session-bridge.ralle1976.cloud`
  - [ ] Download-Link ist öffentlich erreichbar (Repo ist jetzt public)

---

- [ ] 7. Backend API — VPN-Modus-Endpoint (`PUT /admin/vpn-mode`)

  **What to do**:
  Neue Datei `server/api/routers/vpn_mode.py` erstellen:

  ```python
  """
  vpn_mode.py — Admin VPN-Mode-Toggle
  Schaltet iptables im WireGuard-Container via Docker SDK um.
  Modi: 'arma3' (nur UDP 2302-2305 zwischen Peers) | 'open' (alles erlaubt)
  """
  import subprocess
  from fastapi import APIRouter, Depends, HTTPException
  from pydantic import BaseModel
  from auth import get_admin_user
  from database import get_connection

  router = APIRouter(prefix="/admin/vpn-mode", tags=["vpn-mode"])

  ARMA3_PORTS = [2302, 2303, 2304, 2305, 2344, 2345]  # Arma 3 + BattlEye

  class VpnModeRequest(BaseModel):
      mode: str  # 'arma3' oder 'open'

  def _apply_iptables(mode: str):
      """iptables-Regeln via docker exec in arma3-wireguard anwenden."""
      cmds = []
      # FORWARD-Chain leeren
      cmds.append(['docker', 'exec', 'arma3-wireguard', 'iptables', '-F', 'FORWARD'])

      if mode == 'arma3':
          # Nur Arma 3 + BattlEye Ports zwischen VPN-Peers
          for port in ARMA3_PORTS:
              cmds.append(['docker', 'exec', 'arma3-wireguard', 'iptables',
                           '-A', 'FORWARD', '-i', 'wg0', '-o', 'wg0',
                           '-p', 'udp', '--dport', str(port), '-j', 'ACCEPT'])
          # Alles andere zwischen Peers blockieren
          cmds.append(['docker', 'exec', 'arma3-wireguard', 'iptables',
                       '-A', 'FORWARD', '-i', 'wg0', '-o', 'wg0', '-j', 'DROP'])
      else:  # open
          # Alles erlauben
          cmds.append(['docker', 'exec', 'arma3-wireguard', 'iptables',
                       '-A', 'FORWARD', '-j', 'ACCEPT'])

      for cmd in cmds:
          result = subprocess.run(cmd, capture_output=True, text=True)
          if result.returncode != 0:
              raise RuntimeError(f'iptables error: {result.stderr}')

  @router.get('')
  async def get_vpn_mode(admin=Depends(get_admin_user)):
      async with get_connection() as conn:
          cursor = await conn.execute(
              "SELECT value FROM app_settings WHERE key = 'vpn_mode'"
          )
          row = await cursor.fetchone()
      return {'mode': row[0] if row else 'arma3'}

  @router.put('')
  async def set_vpn_mode(data: VpnModeRequest, admin=Depends(get_admin_user)):
      if data.mode not in ('arma3', 'open'):
          raise HTTPException(400, 'mode muss arma3 oder open sein')
      try:
          _apply_iptables(data.mode)
      except RuntimeError as e:
          raise HTTPException(500, str(e))
      async with get_connection() as conn:
          await conn.execute(
              "INSERT OR REPLACE INTO app_settings (key, value, updated_at) "
              "VALUES ('vpn_mode', ?, CURRENT_TIMESTAMP)",
              (data.mode,)
          )
          await conn.commit()
      return {'mode': data.mode, 'message': f'VPN-Modus auf "{data.mode}" gesetzt'}
  ```

  Router in `main.py` registrieren:
  ```python
  # In server/api/main.py, nach den anderen router-Imports:
  from routers.vpn_mode import router as vpn_mode_router
  app.include_router(vpn_mode_router)
  ```

  **References**:
  - `server/api/routers/settings.py` — Pattern für Router-Struktur, `get_admin_user`, `get_connection`
  - `server/api/main.py` — Router-Registrierung (nach `settings_router`)
  - `docker-compose.yml` Container-Name: `arma3-wireguard` (wichtig für docker exec)

  **Must NOT do**:
  - KEINEN Docker SDK (`docker` Python package) installieren — `subprocess + docker exec` reicht
  - NICHT den WireGuard-Container neustarten
  - NICHT die FORWARD-Chain generell leeren ohne sofort neue Regeln zu setzen (kurze Schutzlücke)

  **Acceptance Criteria**:
  - [ ] `GET /admin/vpn-mode` gibt `{"mode": "arma3"}` zurück (DB leer = Default)
  - [ ] `PUT /admin/vpn-mode` mit `{"mode": "open"}` gibt HTTP 200
  - [ ] `docker exec arma3-wireguard iptables -L FORWARD` zeigt korrekte Regeln nach Toggle
  - [ ] `PUT /admin/vpn-mode` mit ungültigem mode gibt HTTP 400

---

- [ ] 8. WireGuard Startup-Script — Default "Arma 3 restricted" beim Container-Start

  **What to do**:
  Neue Datei `server/wireguard/iptables-arma3.sh` erstellen — wird beim WireGuard-Container-Start ausgeführt
  und setzt die Arma 3 Firewall-Regeln als sichere Default:

  ```bash
  #!/bin/bash
  # iptables-arma3.sh — Startup-Firewall für WireGuard Container
  # Default: nur Arma 3 + BattlEye Ports zwischen VPN-Peers erlaubt

  echo "[iptables] Setze Arma 3 Firewall-Regeln..."

  # FORWARD-Chain leeren
  iptables -F FORWARD

  # Arma 3 Ports erlauben (2302-2305 Game + 2344/2345 BattlEye)
  for PORT in 2302 2303 2304 2305 2344 2345; do
      iptables -A FORWARD -i wg0 -o wg0 -p udp --dport $PORT -j ACCEPT
  done

  # Alles andere zwischen Peers blockieren
  iptables -A FORWARD -i wg0 -o wg0 -j DROP

  echo "[iptables] Arma 3 Modus aktiv (nur UDP 2302-2305 + BattlEye)"
  ```

  In `docker-compose.yml` das Script als Custom-Init mounten:
  ```yaml
  wireguard:
    volumes:
      - ./wireguard/config:/config
      - ./server/wireguard/entrypoint.sh:/custom-cont-init.d/99-gen-keys.sh:ro
      - ./server/wireguard/iptables-arma3.sh:/custom-cont-init.d/98-iptables.sh:ro  # NEU
  ```

  Script ausführbar machen und auf Server deployen:
  ```bash
  chmod +x server/wireguard/iptables-arma3.sh
  git add server/wireguard/iptables-arma3.sh docker-compose.yml
  git commit -m "feat: WireGuard Startup-Firewall — Default Arma 3 restricted (UDP 2302-2305)"
  ```

  SCP auf Server + WireGuard Container neu starten (Peers werden kurz getrennt!):
  ```bash
  sshpass -p 'rcpzug3lUvZtEg' scp -o StrictHostKeyChecking=no \
    server/wireguard/iptables-arma3.sh \
    root@212.227.54.229:/opt/arma3-session-bridge/server/wireguard/iptables-arma3.sh

  sshpass -p 'rcpzug3lUvZtEg' ssh -o StrictHostKeyChecking=no root@212.227.54.229 "
    chmod +x /opt/arma3-session-bridge/server/wireguard/iptables-arma3.sh
    # docker-compose.yml auf Server ebenfalls anpassen (neuen Volume-Mount)
    sed -i '/99-gen-keys.sh:ro/a\ \ \ \ \ \ - ./server/wireguard/iptables-arma3.sh:/custom-cont-init.d/98-iptables.sh:ro' \
      /opt/arma3-session-bridge/docker-compose.yml
    cd /opt/arma3-session-bridge
    docker compose up -d --force-recreate wireguard
    sleep 5
    docker exec arma3-wireguard iptables -L FORWARD --line-numbers
  "
  ```

  **Must NOT do**:
  - NICHT den WireGuard-Container neustarten ohne Ralle zu informieren (Peers verlieren kurz VPN)
  - NICHT die Regeln in `99-gen-keys.sh` einbauen (separate Concerns)

  **Acceptance Criteria**:
  - [ ] `docker exec arma3-wireguard iptables -L FORWARD` zeigt Arma 3 Regeln nach Restart
  - [ ] `docker exec arma3-wireguard iptables -L FORWARD | grep DROP` ist vorhanden
  - [ ] Script-Datei ist ausführbar (`chmod +x`)

---

- [ ] 9. Admin-UI — VPN-Modus-Toggle in SettingsPage

  **What to do**:
  In `server/admin-ui/src/pages/SettingsPage.tsx` eine neue Sektion unter dem Einladungstext eränzen:

  Neue API-Calls in `server/admin-ui/src/api/settings.ts`:
  ```typescript
  export async function getVpnMode(): Promise<{ mode: string }> {
    const resp = await apiClient.get('/admin/vpn-mode');
    return resp.data;
  }

  export async function setVpnMode(mode: string): Promise<{ mode: string; message: string }> {
    const resp = await apiClient.put('/admin/vpn-mode', { mode });
    return resp.data;
  }
  ```

  Neue Sektion in `SettingsPage.tsx` (als eigene Card, unter dem Einladungstext-Block):
  ```tsx
  {/* VPN-Modus Card */}
  <div style={s.card}>
    <h2 style={s.h2}>🔥 VPN-Modus</h2>
    <p style={s.desc}>
      Steuert welcher Traffic zwischen verbundenen Spielern erlaubt ist.
      Standard: nur Arma 3 (empfohlen). Offen: alle Ports — für andere Nutzung.
    </p>
    <div style={s.modeRow}>
      <button
        style={{ ...s.modeBtn, ...(vpnMode === 'arma3' ? s.modeBtnActive : {}) }}
        onClick={() => handleVpnMode('arma3')}
        disabled={vpnModeSaving}
      >
        🎮 Arma 3 only
        <small style={s.modeHint}>UDP 2302-2305 + BattlEye</small>
      </button>
      <button
        style={{ ...s.modeBtn, ...(vpnMode === 'open' ? s.modeBtnActive : {}) }}
        onClick={() => handleVpnMode('open')}
        disabled={vpnModeSaving}
      >
        🔓 Offen
        <small style={s.modeHint}>Alle Ports zwischen Peers</small>
      </button>
    </div>
    {vpnModeMsg && <div style={s.alertSuccess}>{vpnModeMsg}</div>}
  </div>
  ```

  Zusätzliche State + Handler in `SettingsPage`:
  ```typescript
  const [vpnMode, setVpnMode] = useState('arma3');
  const [vpnModeSaving, setVpnModeSaving] = useState(false);
  const [vpnModeMsg, setVpnModeMsg] = useState('');

  // In loadSettings():
  const modeData = await getVpnMode();
  setVpnMode(modeData.mode);

  async function handleVpnMode(mode: string) {
    setVpnModeSaving(true); setVpnModeMsg('');
    try {
      const result = await setVpnMode(mode);
      setVpnMode(result.mode);
      setVpnModeMsg(mode === 'arma3' ? '✅ Arma 3 Modus aktiv' : '✅ Offener Modus aktiv');
      setTimeout(() => setVpnModeMsg(''), 3000);
    } catch { setVpnModeMsg('❌ Fehler beim Umschalten'); }
    finally { setVpnModeSaving(false); }
  }
  ```

  Zusätzliche Styles:
  ```typescript
  modeRow:    { display: 'flex', gap: '1rem', marginBottom: '1rem' },
  modeBtn:    { flex: 1, background: '#0f1117', border: '2px solid #2a2d3e', borderRadius: 10,
                padding: '0.9rem 1rem', cursor: 'pointer', color: '#8b92a9',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.3rem' },
  modeBtnActive: { borderColor: '#5865f2', color: '#f1f2f6', background: 'rgba(88,101,242,0.1)' },
  modeHint:   { fontSize: '0.72rem', color: '#8b92a9' },
  ```

  **References**:
  - `server/admin-ui/src/api/settings.ts` — Pattern für neue API-Funktionen (getSettings, updateSettings)
  - `server/admin-ui/src/pages/SettingsPage.tsx` — vorhandene Card-Struktur + Styles (`s.card`, `s.h2` etc.)

  **Must NOT do**:
  - NICHT die bestehenden Cards (Registrierungs-Code, Einladungstext) verändern
  - TypeScript-Build muss fehlerfrei sein

  **Acceptance Criteria**:
  - [ ] Neue Card "VPN-Modus" erscheint in der Admin-UI unter Einladungstext
  - [ ] Klick auf "Arma 3 only" → aktiver Button blau hervorgehoben + Erfolgs-Meldung
  - [ ] Klick auf "Offen" → aktiver Button blau hervorgehoben
  - [ ] `npm run build` im admin-ui Verzeichnis → kein Fehler

---

## Commit Strategy

- **Task 1**: `fix: docker-compose — PEER_REGISTRATION_CODE + SERVER_PUBLIC_URL für api-Service`
- **Task 4**: `feat: Einladungstext mit VPN-Erklärung + Arma 3 Anleitung erweitern`
- **Task 5**: `docs: README mit Projektbeschreibung, VPN-Erklärung, Self-Hosting Guide (Platzhalter)`
- **Task 7+8+9**: `feat: VPN-Modus-Toggle — Default Arma 3 restricted, admin-umschaltbar`

## Success Criteria

```bash
# Repo public:
gh repo view Ralle1976/arma3-session-bridge --json isPrivate --jq '.isPrivate'
# → false

# Download-Link erreichbar:
curl -sI https://github.com/Ralle1976/arma3-session-bridge/releases/latest | grep -i location
# → /releases/tag/v0.1.7

# v0.1.6 Assets gelöscht:
gh api repos/Ralle1976/arma3-session-bridge/releases/tags/v0.1.6 --jq '.assets | length'
# → 0

# README ohne sensible Daten:
grep -r '212.227\|ralle1976.cloud\|rcpzug3\|osxIW1t\|Zwp2QHR' README.md
# → kein Treffer

# Admin-UI deployed:
curl -sI https://arma3-session-bridge.ralle1976.cloud | head -1
# → HTTP/2 200
```
