# Installationsanleitung (Deutsch)

## Voraussetzungen

### Server
- Linux VPS mit öffentlicher IP (AlmaLinux 9.7 / Ubuntu 22.04+ empfohlen)
- Docker Engine 24.x+ und Docker Compose 2.x+
- Offene Ports: `51820/udp`, `8001/tcp`, `8090/tcp`

### Windows-Client
- Windows 10/11 (64-bit)
- Administrator-Rechte (zwingend erforderlich)
- Arma 3 über Steam installiert

## Server-Installation

### Schritt 1: Docker installieren

**AlmaLinux / CentOS:**
```bash
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y
systemctl enable docker && systemctl start docker
```

**Ubuntu:**
```bash
apt-get update
apt-get install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y
systemctl enable docker && systemctl start docker
```

### Schritt 2: Repository klonen

```bash
cd /opt
git clone https://github.com/Ralle1976/arma3-session-bridge
cd arma3-session-bridge
```

### Schritt 3: Umgebungsvariablen konfigurieren

```bash
cp .env.example .env
nano .env
```

Erforderliche Werte:
```env
ADMIN_PASSWORD=dein-sicheres-passwort
JWT_SECRET=dein-geheimnis-mindestens-32-zeichen
WG_SERVER_IP=YOUR_SERVER_IP
WG_PORT=51820
API_PORT=8001
ADMIN_UI_PORT=8090
```

Sicheres JWT Secret generieren:
```bash
openssl rand -base64 48
```

### Schritt 4: Firewall konfigurieren

**AlmaLinux/CentOS (firewalld):**
```bash
firewall-cmd --permanent --add-port=51820/udp
firewall-cmd --permanent --add-port=8001/tcp
firewall-cmd --permanent --add-port=8090/tcp
firewall-cmd --reload
firewall-cmd --list-ports
```

**Ubuntu (ufw):**
```bash
ufw allow 51820/udp
ufw allow 8001/tcp
ufw allow 8090/tcp
ufw status
```

### Schritt 5: Docker-Services starten

```bash
cd /opt/arma3-session-bridge
docker compose up -d
```

Erwartete Ausgabe:
```
[+] Running 3/3
 ✔ Container arma3-wireguard  Started
 ✔ Container arma3-api        Started
 ✔ Container arma3-admin-ui   Started
```

### Schritt 6: Installation prüfen

```bash
# API Health Check
curl http://localhost:8001/health
# Erwartete Antwort: {"status": "ok", "version": "0.1.0"}

# Container-Status
docker compose ps
```

Alle Container sollten als `running` angezeigt werden.

### Schritt 7: Ersten Peer anlegen

```bash
# Admin-Token holen
TOKEN=$(curl -s -X POST http://localhost:8001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"DEIN-ADMIN-PASSWORT"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

# Peer anlegen
curl -X POST http://localhost:8001/peers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Spieler1"}'
```

Antwort enthält:
- `tunnel_ip` — VPN-IP des Spielers (z.B. `10.8.0.2`)
- `peer_token` — **Nur einmal angezeigt! Sofort speichern!**

### Schritt 8: Peer-Konfiguration herunterladen

```bash
curl -o spieler1.conf \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8001/peers/1/config
```

Die `.conf` Datei sicher an den Spieler weitergeben (z.B. über Signal, verschlüsselte E-Mail).

## Client-Installation (Windows)

### Herunterladen

Neusten Installer herunterladen:
**[Releases](https://github.com/Ralle1976/arma3-session-bridge/releases/latest)**

Datei: `arma3-session-bridge-setup.exe`

### Installation — Schritt für Schritt

> ⚠️ **PFLICHT: Rechtsklick → "Als Administrator ausführen"**

1. Rechtsklick auf `arma3-session-bridge-setup.exe` → **"Als Administrator ausführen"**
2. UAC-Dialog mit „Ja" bestätigen
3. **Setup-Assistent:**
   - Schritt 1: „Weiter" klicken
   - Schritt 2: Installationsverzeichnis wählen (Standard: `C:\Program Files\Arma3SessionBridge\`)
   - Schritt 3: `.conf` Datei auswählen (Durchsuchen-Schaltfläche)
   - Schritt 4: API-URL eingeben: `http://YOUR_SERVER_IP:8001`
   - Schritt 5: „Installieren" klicken
4. „Fertigstellen" klicken

### Client-Installation prüfen

1. **Arma 3 Session Bridge** Symbol erscheint im System-Tray (rechts unten in der Taskleiste)
2. Rechtsklick → „VPN verbinden"
3. Tooltip sollte innerhalb von 10 Sekunden „Connected: 10.8.0.x" anzeigen

## Updates

### Server-Update

```bash
cd /opt/arma3-session-bridge
git pull
docker compose pull
docker compose up -d --build
```

### Client-Update

Neusten Installer von [Releases](https://github.com/Ralle1976/arma3-session-bridge/releases/latest) herunterladen und ausführen. Der Installer übernimmt Updates automatisch.
