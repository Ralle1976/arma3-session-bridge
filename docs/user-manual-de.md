# Arma 3 Session Bridge — Benutzerhandbuch (Deutsch)

**Version:** 1.0.0  
**Letzte Aktualisierung:** März 2026  
**Sprache:** Deutsch

---

## Inhaltsverzeichnis

1. [Einleitung](#1-einleitung)
2. [Systemvoraussetzungen](#2-systemvoraussetzungen)
3. [Server-Installation mit Docker](#3-server-installation-mit-docker)
4. [Client-Installation (Windows)](#4-client-installation-windows)
5. [VPN-Verbindung herstellen](#5-vpn-verbindung-herstellen)
6. [Arma 3 Session hosten](#6-arma-3-session-hosten)
7. [Einer Session beitreten](#7-einer-session-beitreten)
8. [Admin-Dashboard](#8-admin-dashboard)
9. [Fehlerbehebung](#9-fehlerbehebung)
10. [Häufig gestellte Fragen (FAQ)](#10-häufig-gestellte-fragen-faq)

---

## 1. Einleitung

### Was ist Arma 3 Session Bridge?

Arma 3 Session Bridge ist eine Software-Lösung, die privates Arma 3 Multiplayer ermöglicht, **ohne Router-Portfreigaben** einzurichten. Das Herzstück ist ein WireGuard VPN-Tunnel, über den alle Spieler sicher miteinander verbunden werden.

### Das Problem

Arma 3 benötigt für Multiplayer offene Ports im Router (standardmäßig UDP 2302). In modernen Netzwerkumgebungen sind diese Ports oft blockiert:
- **CGNAT (Carrier-Grade NAT)**: Viele Internet-Provider teilen eine öffentliche IP zwischen mehreren Kunden
- **Firewalls**: Unternehmens- oder Schulnetzwerke blockieren Gaming-Ports
- **Fritz!Box / Router**: Port-Weiterleitung ist oft kompliziert oder nicht möglich

### Die Lösung

Arma 3 Session Bridge leitet den gesamten Spielverkehr durch einen WireGuard VPN-Server auf einem IONOS VPS (Virtual Private Server). Die Spieler verbinden sich alle mit diesem Server und spielen über das private VPN-Netzwerk `10.8.0.0/24`.

```
Spieler A ──WireGuard──┐
Spieler B ──WireGuard──┼── VPS (öffentliche IP: YOUR_SERVER_IP)
Spieler C ──WireGuard──┘      └── privates Netz: 10.8.0.0/24

Spieler C verbindet sich in Arma 3 mit: 10.8.0.2 (Tunnel-IP von Spieler A)
```

### Schlüssel-Konzepte

| Begriff | Erklärung |
|---------|-----------|
| **Peer** | Ein registrierter Spieler mit eigenem WireGuard-Zertifikat |
| **Tunnel-IP** | Die private VPN-IP des Spielers (z.B. `10.8.0.2`) |
| **Session** | Eine aktive Arma 3 Partie, die im System registriert ist |
| **Heartbeat** | Regelmäßige Signal, das die Session als aktiv markiert |
| **Split-Tunnel** | Nur VPN-Traffic geht durch den Tunnel, normaler Internet-Traffic nicht |

---

## 2. Systemvoraussetzungen

### Server (IONOS VPS)

| Anforderung | Minimum | Empfohlen |
|-------------|---------|-----------|
| Betriebssystem | Ubuntu 22.04 LTS | AlmaLinux 9.7 |
| CPU | 1 vCore | 2 vCores |
| RAM | 1 GB | 2 GB |
| Speicher | 20 GB SSD | 40 GB SSD |
| Netzwerk | 100 Mbit/s | 1 Gbit/s |
| Docker | 24.x | 25.x + |
| Docker Compose | 2.x | 2.x + |

**Erforderliche offene Ports:**
- `51820/udp` — WireGuard VPN
- `8001/tcp` — REST API
- `8090/tcp` — Admin Dashboard

### Windows Client (Spieler-PC)

| Anforderung | Details |
|-------------|---------|
| Betriebssystem | Windows 10 (64-bit) oder Windows 11 |
| Benutzerrechte | **Administrator** (zwingend erforderlich) |
| Arma 3 | Installiert via Steam |
| Netzwerk | Ausgehende UDP-Verbindungen erlaubt |
| Antivirus | Evtl. Ausnahme für arma3-session-bridge.exe nötig |

> ⚠️ **Wichtig:** Die Client-Software benötigt **Administrator-Rechte**, da WireGuard einen Kernel-Treiber installiert. Ohne Admin-Rechte startet die Anwendung nicht korrekt.

---

## 3. Server-Installation mit Docker

### 3.1 Voraussetzungen installieren

Verbinde dich per SSH mit deinem IONOS VPS:

```bash
ssh root@YOUR_SERVER_IP
```

Docker und Docker Compose installieren (AlmaLinux 9):

```bash
# Docker installieren
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y

# Docker starten und automatisch starten
systemctl enable docker
systemctl start docker

# Prüfen
docker --version
docker compose version
```

### 3.2 Repository klonen

```bash
cd /opt
git clone https://github.com/YourGitHubUser/arma3-session-bridge
cd arma3-session-bridge
```

### 3.3 Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
nano .env
```

Inhalt der `.env` Datei:

```env
# Admin-Passwort für das Dashboard (sicheres Passwort wählen!)
ADMIN_PASSWORD=mein-sicheres-passwort-hier

# JWT Secret für Token-Signierung (mindestens 32 Zeichen!)
JWT_SECRET=hier-kommt-ein-langes-zufaelliges-geheimnis

# Öffentliche IP deines IONOS Servers
WG_SERVER_IP=YOUR_SERVER_IP

# WireGuard Port (Standard: 51820)
WG_PORT=51820

# API Port (extern zugänglich)
API_PORT=8001

# Admin UI Port (extern zugänglich)
ADMIN_UI_PORT=8090
```

**JWT Secret generieren:**

```bash
openssl rand -base64 48
```

Das Ergebnis (eine zufällige Zeichenkette) als `JWT_SECRET` verwenden.

### 3.4 Firewall konfigurieren

```bash
# WireGuard UDP Port freigeben
firewall-cmd --permanent --add-port=51820/udp

# API Port freigeben
firewall-cmd --permanent --add-port=8001/tcp

# Admin UI Port freigeben
firewall-cmd --permanent --add-port=8090/tcp

# Regeln aktivieren
firewall-cmd --reload

# Prüfen
firewall-cmd --list-ports
```

### 3.5 Docker-Services starten

```bash
cd /opt/arma3-session-bridge
docker compose up -d
```

Ausgabe sollte etwa so aussehen:

```
[+] Running 3/3
 ✔ Container arma3-wireguard  Started
 ✔ Container arma3-api        Started
 ✔ Container arma3-admin-ui   Started
```

### 3.6 Installation prüfen

```bash
# API Health Check
curl http://localhost:8001/health
# Erwartete Antwort: {"status": "ok", "version": "0.1.0"}

# Container Status
docker compose ps
```

Alle Container sollten als `running` angezeigt werden.

### 3.7 Ersten Peer anlegen (Admin-Login)

```bash
# Admin-Token holen
TOKEN=$(curl -s -X POST http://localhost:8001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"DEIN-ADMIN-PASSWORT"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

# Ersten Peer anlegen
curl -X POST http://localhost:8001/peers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Spieler1"}'
```

Die Antwort enthält:
- `id` — Peer-ID
- `tunnel_ip` — Tunnel-IP (z.B. `10.8.0.2`)
- `peer_token` — **Einmalig** angezeigter Peer-JWT-Token (gut aufbewahren!)

### 3.8 Peer-Konfigurationsdatei herunterladen

```bash
# WireGuard .conf Datei herunterladen
curl -o spieler1.conf \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8001/peers/1/config
```

Diese `.conf` Datei muss an den Spieler weitergegeben werden (z.B. via Signal oder E-Mail).

> 🔒 **Sicherheitshinweis:** Die Peer-Config-Datei enthält einen privaten Schlüssel. Teile sie **niemals** öffentlich oder über unsichere Kanäle!

### 3.9 Updates

```bash
cd /opt/arma3-session-bridge
git pull
docker compose pull
docker compose up -d --build
```

---

## 4. Client-Installation (Windows)

### 4.1 Installer herunterladen

1. Öffne: `https://github.com/YourGitHubUser/arma3-session-bridge/releases/latest`
2. Lade die Datei `arma3-session-bridge-setup.exe` herunter

### 4.2 Installation ausführen

> ⚠️ **PFLICHT:** Den Installer als **Administrator** ausführen!

1. Rechtsklick auf `arma3-session-bridge-setup.exe`
2. „**Als Administrator ausführen**" wählen
3. UAC-Dialog mit „Ja" bestätigen

#### Setup-Assistent — Schritt für Schritt

**Schritt 1 — Willkommen**
- Klicke auf „Weiter"

**Schritt 2 — Installationsverzeichnis**
- Standard: `C:\Program Files\Arma3SessionBridge\`
- Kann beibehalten oder geändert werden
- Klicke „Weiter"

**Schritt 3 — Peer-Konfiguration**
- Klicke auf „Durchsuchen" und wähle deine `.conf` Datei
- Die Datei wird automatisch validiert (Split-Tunnel Check)
- Klicke „Weiter"

**Schritt 4 — API-Server URL**
- Standard: `http://YOUR_SERVER_IP:8001`
- Nur ändern wenn dein Server eine andere IP hat
- Klicke „Weiter"

**Schritt 5 — Startmenü-Eintrag**
- Optional: Desktop-Verknüpfung erstellen
- Klicke „Installieren"

**Schritt 6 — Fertigstellen**
- WireGuard-Treiber wird installiert (erfordert Neustart bei erstem Mal)
- Klicke „Fertigstellen"

### 4.3 Erste Verbindung testen

Nach der Installation:
1. Das **Arma 3 Session Bridge** Symbol erscheint im System-Tray (Taskleiste unten rechts)
2. Rechtsklick → „Connect VPN"
3. Warte auf „Connected: 10.8.0.x" als Tooltip
4. Öffne die Hauptoberfläche (Doppelklick auf Tray-Symbol)

### 4.4 Autostart konfigurieren

Die Anwendung startet automatisch mit Windows und verbindet sich beim Start automatisch mit dem VPN, wenn die Option im Setup aktiviert wurde.

### 4.5 Deinstallation

1. Windows Einstellungen → Apps → Arma 3 Session Bridge → Deinstallieren
2. Oder: `C:\Program Files\Arma3SessionBridge\uninstall.exe` ausführen

---

## 5. VPN-Verbindung herstellen

### 5.1 Über den System-Tray

Das Tray-Icon zeigt den aktuellen Status:
- 🔴 **Rotes Symbol** — Getrennt (Disconnected)
- 🟢 **Grünes Symbol** — Verbunden (Connected)

Rechtsklick auf das Symbol:
- **Connect VPN** — VPN-Verbindung herstellen
- **Disconnect VPN** — VPN-Verbindung trennen
- **Quit** — Anwendung beenden

### 5.2 Über die Hauptoberfläche

1. Doppelklick auf das Tray-Symbol
2. Hauptfenster öffnet sich
3. Klicke **„VPN verbinden"**
4. Status-Anzeige wechselt zu „Verbunden (10.8.0.x)"

### 5.3 Verbindung prüfen

Nach erfolgreicher Verbindung:
- Tray-Tooltip zeigt: `Connected: 10.8.0.2`
- Ping-Test (Command Prompt): `ping 10.8.0.1` sollte antworten
- Die Session-Liste lädt automatisch

### 5.4 Verbindungsprobleme

Wenn die Verbindung fehlschlägt:
1. Prüfe ob der Server erreichbar ist: `ping YOUR_SERVER_IP`
2. Prüfe Windows-Firewall (WireGuard muss erlaubt sein)
3. Prüfe ob die `.conf` Datei korrekt platziert ist
4. Starte die Anwendung als **Administrator** neu

---

## 6. Arma 3 Session hosten

### 6.1 Voraussetzungen

Bevor du eine Session hostest:
- ✅ VPN-Verbindung aktiv (grünes Tray-Symbol)
- ✅ Arma 3 gestartet und im Hauptmenü
- ✅ Gewünschte Mission vorbereitet

### 6.2 Session erstellen

1. Öffne die Hauptoberfläche (Doppelklick Tray-Icon)
2. Klicke auf **„Session hosten"**
3. Fülle das Formular aus:
   - **Missionsname**: Name der Mission (z.B. `Takistan_Patrol_v3`)
   - **Max. Spieler**: Maximale Spieleranzahl (1–64)
4. Klicke **„Hosten"**
5. Deine Tunnel-IP (z.B. `10.8.0.2`) wird angezeigt

### 6.3 Arma 3 Server starten

1. In Arma 3: **Multiplayer** → **Host Server**
2. Spieleranzahl entsprechend setzen
3. Mission auswählen
4. Server starten

### 6.4 Session-Info teilen

Teile anderen Spielern mit:
- Deine **Tunnel-IP** (sichtbar in der App): z.B. `10.8.0.2`
- Spieler verbinden sich in Arma 3 mit dieser IP

### 6.5 Heartbeat — Session aktiv halten

Die App sendet automatisch alle **60 Sekunden** einen Heartbeat-Signal an den Server. Ohne Heartbeat wird die Session nach **5 Minuten** automatisch beendet.

> 📌 **Tipp:** Lass die App während des Spielens im Hintergrund laufen. Das Schließen der App oder Trennen des VPNs beendet die Session sofort.

### 6.6 Session beenden

- Klicke **„Hosten beenden"** in der App, **oder**
- Trenne die VPN-Verbindung, **oder**
- Beende die App

---

## 7. Einer Session beitreten

### 7.1 Session-Liste öffnen

1. VPN verbinden (Schritt 5)
2. Hauptoberfläche öffnen
3. Die **Session-Liste** wird automatisch geladen
4. Klicke **„Aktualisieren"** für die neueste Liste

### 7.2 Session auswählen

Die Liste zeigt für jede aktive Session:
- **Missionsname** — Name der Mission
- **Karte** — Arma 3 Map-Name  
- **Spieler** — Aktuelle / Maximale Spieler
- **Host-IP** — Tunnel-IP des Hosts

### 7.3 In Arma 3 verbinden

1. Klicke **„Beitreten"** neben der gewünschten Session
2. Die **Host-Tunnel-IP** wird in die Zwischenablage kopiert (z.B. `10.8.0.2`)
3. Öffne Arma 3
4. **Multiplayer** → **Direkt verbinden**
5. Server-Adresse eingeben: `10.8.0.2`
6. Port: `2302` (Arma 3 Standard)
7. Verbinden

### 7.4 Verbindungsprobleme beim Beitreten

| Problem | Ursache | Lösung |
|---------|---------|--------|
| Host nicht gefunden | VPN nicht verbunden | VPN verbinden (Schritt 5) |
| Session lädt nicht | Server nicht erreichbar | API-URL prüfen |
| Timeout in Arma 3 | Firewall blockiert | Windows-Firewall Ausnahme für Arma 3 |
| Falsche IP | Veraltete Session-Liste | Liste aktualisieren |

---

## 8. Admin-Dashboard

### 8.1 Zugang

Das Admin-Dashboard ist im Webbrowser erreichbar:

```
http://YOUR_SERVER_IP:8090
```

Login mit dem in `.env` konfigurierten `ADMIN_PASSWORD`.

### 8.2 Dashboard-Übersicht

Die Startseite zeigt:
- **Aktive Peers** — Anzahl verbundener Spieler
- **Laufende Sessions** — Anzahl aktiver Spiele
- **Server-Laufzeit** — Uptime des API-Servers
- **Traffic-Statistiken** — In/Out Daten

### 8.3 Peer-Verwaltung

Unter **„Peers"** kannst du:

**Neuen Peer anlegen:**
1. Klicke **„+ Peer hinzufügen"**
2. Name eingeben (z.B. Spieler-Name oder Spitzname)
3. Klicke **„Erstellen"**
4. Die `.conf` Datei und den Peer-Token werden angezeigt
5. **Sofort speichern!** — Der Token wird nur einmal angezeigt

**Peer sperren (revoken):**
1. Peer in der Liste finden
2. Klicke das Mülleimer-Symbol
3. Bestätige die Aktion
4. Der Peer kann sich nicht mehr verbinden

**Peer-Config herunterladen:**
- Klicke das Download-Symbol beim Peer
- `.conf` Datei wird heruntergeladen

### 8.4 Sessions-Übersicht

Unter **„Sessions"** siehst du:
- Alle aktiven Sessions
- Session-Verlauf (beendete Sessions)
- Heartbeat-Timestamp (wann zuletzt aktiv)

**CSV-Export:**
Alle Session-Daten können als CSV-Datei exportiert werden (für Statistiken).

### 8.5 Event-Log

Der **Event-Log** zeigt alle System-Ereignisse in Echtzeit:
- Peer-Verbindungen
- Session-Start/-Ende
- Admin-Aktionen
- Fehler und Warnungen

Der Log wird über **Server-Sent Events (SSE)** live aktualisiert.

### 8.6 Sicherheitshinweise für Admins

- Verwende ein **starkes Admin-Passwort** (min. 20 Zeichen)
- Öffne das Dashboard **nicht** aus öffentlichen Netzwerken ohne VPN
- Rotiere das `JWT_SECRET` regelmäßig (erfordert Neustart aller Clients)
- Entziehe Peers sofort, wenn Spieler die Gruppe verlassen

---

## 9. Fehlerbehebung

### 9.1 VPN verbindet sich nicht

**Symptom:** Tray-Icon bleibt rot, kein Tooltip

**Ursachen und Lösungen:**

```
1. Anwendung ohne Admin-Rechte gestartet
   → Rechtsklick → "Als Administrator ausführen"

2. Falsche .conf Datei
   → Einstellungen öffnen → neue .conf Datei auswählen

3. Server nicht erreichbar
   → ping YOUR_SERVER_IP im Command Prompt
   → Falls kein Ping: VPS überprüfen (IONOS-Konsole)

4. UDP Port 51820 blockiert
   → Netzwerk-Admin kontaktieren (Schule/Betrieb)
   → Mobiles Hotspot als Workaround versuchen

5. WireGuard-Treiber Fehler
   → Windows Neustart
   → Anwendung deinstallieren und neu installieren
```

### 9.2 Session erscheint nicht in der Liste

**Symptom:** Eigene Session wird nach dem Hosten nicht angezeigt

**Lösungen:**
1. Liste manuell aktualisieren (Schaltfläche „Aktualisieren")
2. Prüfe ob VPN verbunden ist
3. API-Verbindung testen: Browser → `http://YOUR_SERVER_IP:8001/health`
4. Prüfe ob der Peer-Token noch gültig ist

### 9.3 Verbindung in Arma 3 scheitert

**Symptom:** Timeout oder „Host nicht gefunden" in Arma 3

**Checkliste:**
- [ ] VPN verbunden? (grünes Tray-Icon)
- [ ] Richtige IP eingegeben? (aus der Session-Liste, z.B. `10.8.0.2`)
- [ ] Port `2302`? (Arma 3 Standard-Port)
- [ ] Windows Firewall: Arma 3 als Ausnahme eingetragen?
- [ ] Host-Spieler noch verbunden?
- [ ] Ping-Test: `ping 10.8.0.2` (im CMD)

**Windows Firewall Ausnahme für Arma 3:**
1. Systemsteuerung → Windows Defender Firewall
2. „Eine App oder Feature durch Windows Defender Firewall zulassen"
3. „Einstellungen ändern" → „Andere App zulassen"
4. `C:\Program Files (x86)\Steam\steamapps\common\Arma 3\arma3_x64.exe` auswählen
5. Privat UND Öffentlich aktivieren

### 9.4 Heartbeat stoppt / Session verschwindet

**Symptom:** Eigene Session verschwindet nach einiger Zeit

**Ursachen:**
- PC ging in Energiesparmodus → Netzwerk unterbrochen
- App minimiert und Windows hat Hintergrund-Apps eingeschränkt
- Netzwerkunterbrechung

**Lösungen:**
1. Energiesparmodus für Netzwerkadapter deaktivieren:
   - Gerätemanager → Netzwerkadapter → Eigenschaften → Energieverwaltung
   - „Computer darf dieses Gerät ausschalten" deaktivieren
2. Windows-Einstellungen: Hintergrund-Apps erlauben

### 9.5 Client-Logs abrufen

Logs befinden sich unter:
```
%APPDATA%\arma3-session-bridge\logs\
```

Für die Fehleranalyse die neueste Log-Datei an den Admin senden.

### 9.6 Server-Logs prüfen

```bash
# API-Logs
docker logs arma3-api --tail 100

# WireGuard-Logs
docker logs arma3-wireguard --tail 100

# Admin-UI Logs
docker logs arma3-admin-ui --tail 50
```

---

## 10. Häufig gestellte Fragen (FAQ)

### Allgemein

**F: Kostet die Nutzung etwas?**  
A: Die Software selbst ist kostenlos. Der IONOS VPS kostet ca. 4–8 €/Monat.

**F: Wie viele Spieler können gleichzeitig verbunden sein?**  
A: Technisch unbegrenzt, praktisch durch den VPS-Plan limitiert. Für 8–16 Spieler reicht der kleinste IONOS-Plan.

**F: Ist die Verbindung sicher?**  
A: Ja. WireGuard verwendet moderne Kryptographie (Curve25519, ChaCha20-Poly1305). Alle Verbindungen sind Ende-zu-Ende verschlüsselt.

**F: Kann ich mehrere Sessions gleichzeitig haben?**  
A: Ja, mehrere Spieler können gleichzeitig separate Sessions hosten.

### Technisches

**F: Welcher Port muss für Arma 3 geöffnet sein?**  
A: Kein lokaler Port! Der gesamte Traffic läuft durch den WireGuard-Tunnel. Ausgehend muss UDP 51820 erlaubt sein (das ist in den meisten Netzwerken der Fall).

**F: Verschlechtert das VPN meine Ping-Zeit?**  
A: Minimal. Der VPN-Server fügt typisch 10–30 ms hinzu. Da alle Spieler über denselben Server verbunden sind, spielen alle unter gleichen Bedingungen.

**F: Was passiert, wenn der VPS-Server ausfällt?**  
A: Alle Verbindungen werden getrennt. Sessions gehen verloren. Der IONOS VPS hat 99.9% Uptime-Garantie.

**F: Kann ich meinen eigenen Server verwenden?**  
A: Ja! Ändere `WG_SERVER_IP` in der `.env` Datei auf deine Server-IP.

**F: Muss WireGuard separat installiert werden?**  
A: Nein. Das Installer-Paket enthält alles. WireGuard-Treiber wird automatisch installiert.

### Sessions

**F: Wie lange bleibt eine Session aktiv?**  
A: Sessions bleiben aktiv, solange der Host verbunden ist und Heartbeats sendet. Ohne Heartbeat: 5 Minuten Timeout.

**F: Was passiert, wenn der Host die Verbindung verliert?**  
A: Die Session wird nach 5 Minuten automatisch gelöscht. Andere Spieler werden aus dem Spiel geworfen.

**F: Können Spieler beitreten, während das Spiel läuft?**  
A: Das hängt von den Arma 3 Missioneinstellungen ab (JIP — Join-in-Progress). Die Bridge-Software selbst hat keine Einschränkungen.

### Probleme

**F: Die App startet, aber das VPN verbindet sich nicht.**  
A: Häufigste Ursache: Anwendung ohne Admin-Rechte. Rechtsklick → "Als Administrator ausführen".

**F: Mein Antivirus blockiert die App.**  
A: Füge die App als Ausnahme hinzu. False-Positive durch den WireGuard-Treiber ist bekannt.

**F: Nach Windows-Update funktioniert die App nicht mehr.**  
A: WireGuard-Treiber neu installieren: App deinstallieren → neu installieren (als Admin).

---

*Weitere Hilfe findest du im [GitHub Wiki](https://github.com/YourGitHubUser/arma3-session-bridge/wiki) oder erstelle ein [GitHub Issue](https://github.com/YourGitHubUser/arma3-session-bridge/issues).*
