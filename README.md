# Arma 3 Session Bridge

> Privates Arma 3 Multiplayer über WireGuard VPN — kein Port-Forwarding nötig.

[![Build Windows Client](https://github.com/Ralle1976/arma3-session-bridge/actions/workflows/build-windows.yml/badge.svg)](https://github.com/Ralle1976/arma3-session-bridge/actions/workflows/build-windows.yml)
[![Deploy Server](https://github.com/Ralle1976/arma3-session-bridge/actions/workflows/deploy.yml/badge.svg)](https://github.com/Ralle1976/arma3-session-bridge/actions/workflows/deploy.yml)

---

## Was ist das?

Arma 3 Session Bridge löst das klassische Problem beim privaten Arma 3 Hosting: **Spieler hinter NAT/CGNAT können Spiele hosten**, ohne Router-Ports zu öffnen.

### Wie funktioniert es?

Alle Spieler verbinden sich mit einem WireGuard VPN auf einem günstigen VPS. Dadurch befinden sich alle im **selben virtuellen LAN** (`10.8.0.0/24`) — als wären sie im selben Heimnetzwerk, egal wo sie sich befinden.

```
Spieler A (Windows) ─── WireGuard ──┐
Spieler B (Windows) ─── WireGuard ──┼── VPS (Hub)
Spieler C (Windows) ─── WireGuard ──┘    ├── WireGuard VPN  (UDP 51820)
                                           ├── FastAPI REST   (Port 8001)
                                           └── React Admin UI (Port 8090)
```

**Hub & Spoke Topologie:** Der VPS ist der zentrale Knotenpunkt. Alle Spieler verbinden sich mit dem VPS, nicht direkt miteinander. Der Traffic läuft verschlüsselt durch den Tunnel.

---

## 🎮 Arma 3: So funktioniert's

1. **Alle Spieler** verbinden sich zuerst mit der Session Bridge App (VPN)
2. **Gastgeber** startet Arma 3 → Mehrspieler → LAN → Spiel erstellen
3. **Mitspieler:** Mehrspieler → LAN → Spiel erscheint automatisch in der Liste
   - ODER: Direktverbindung über die VPN-IP des Gastgebers (z.B. `10.8.0.2:2302`)

Kein öffentlicher Gameserver, kein Port-Forwarding, keine DynDNS nötig.

---

## 📥 Download (Windows Client)

**[→ Neuesten Installer herunterladen](https://github.com/Ralle1976/arma3-session-bridge/releases/latest)**

- Als **Administrator** ausführen (für WireGuard-Dienst-Installation erforderlich)
- Einrichtungs-Wizard ausfüllen: Server-URL + Registrierungs-Code (vom Admin erhalten)
- VPN verbinden → Arma 3 starten → LAN → spielen 🚀

---

## 🖥️ Self-Hosting (Server aufsetzen)

### Voraussetzungen

- Linux VPS mit öffentlicher IP (Ubuntu 22.04+ oder AlmaLinux 9+)
- Docker + Docker Compose
- Offene Ports: `51820/udp` (WireGuard), `8001/tcp` (API), `8090/tcp` (Admin UI)

### Schnellstart

```bash
# Repository klonen
git clone https://github.com/Ralle1976/arma3-session-bridge
cd arma3-session-bridge

# Umgebungsvariablen konfigurieren
cp .env.example .env
# .env bearbeiten (siehe unten)

# Alle Services starten
docker compose up -d

# Health-Check
curl http://DEINE-SERVER-IP:8001/health
```

### .env Konfiguration

```env
# Admin-Passwort für das Dashboard
ADMIN_PASSWORD=dein-sicheres-passwort

# JWT-Signing-Secret (min. 32 Zeichen)
JWT_SECRET=dein-jwt-secret-mindestens-32-zeichen-lang

# Öffentliche IP deines Servers
WG_SERVER_IP=DEINE-SERVER-IP

# WireGuard UDP-Port (Standard: 51820)
WG_PORT=51820

# Registrierungs-Code für neue Spieler
PEER_REGISTRATION_CODE=dein-registrierungscode

# Öffentliche URL des Servers (für Einladungslinks)
SERVER_PUBLIC_URL=https://deine-domain.example.com

# Externe Ports (optional, Standard wie angegeben)
API_PORT=8001
ADMIN_UI_PORT=8090
```

### Sicheres JWT-Secret generieren

```bash
openssl rand -base64 48
```

### Admin Dashboard

Erreichbar unter: `http://DEINE-SERVER-IP:8090` oder `https://deine-domain.example.com`

Features:
- Peer-Verwaltung (erstellen, widerrufen)
- Einladungstext mit VPN-Erklärung generieren und kopieren
- VPN-Modus umschalten (Arma 3 restricted / Offen)
- Live-Statistiken und Event-Log

---

## 🔧 Komponenten

| Komponente | Technologie | Beschreibung |
|------------|-------------|--------------|
| WireGuard VPN | `linuxserver/wireguard` | Hub & Spoke VPN, UDP 51820 |
| REST API | FastAPI (Python) | Peer-Verwaltung, Session-Tracking, Admin-Endpoints |
| Admin UI | React + Vite | Dashboard für Peer-Verwaltung und Einladungen |
| Windows Client | Tauri v2 (Rust + React) | NSIS-Installer, VPN-Verbindung, Session-Browser |

---

## 📋 API Endpoints

| Method | Endpoint | Auth | Beschreibung |
|--------|----------|------|--------------|
| `GET` | `/health` | Public | Liveness-Probe |
| `POST` | `/auth/login` | Public | Admin-Login → JWT |
| `POST` | `/peers` | Admin JWT | WireGuard-Peer erstellen |
| `GET` | `/peers` | Admin JWT | Alle Peers auflisten |
| `DELETE` | `/peers/{id}` | Admin JWT | Peer widerrufen |
| `GET` | `/peers/{id}/config` | Admin JWT | `.conf`-Datei herunterladen |
| `POST` | `/sessions` | Peer JWT | Arma 3 Session öffnen |
| `GET` | `/sessions` | Public | Aktive Sessions auflisten |
| `DELETE` | `/sessions/{id}` | Peer JWT | Session schließen |
| `GET` | `/admin/stats` | Admin JWT | System-Statistiken |
| `GET` | `/admin/vpn-mode` | Admin JWT | VPN-Modus abfragen |
| `PUT` | `/admin/vpn-mode` | Admin JWT | VPN-Modus umschalten |

---

## 💻 Systemanforderungen

### Server
- Linux VPS mit öffentlicher IP (Ubuntu 22.04+ / AlmaLinux 9+)
- Docker + Docker Compose
- Ports offen: `51820/udp`, `8001/tcp`, `8090/tcp`

### Windows Client
- Windows 10/11 (64-bit)
- **Administrator-Rechte** (für WireGuard-Kernel-Modul erforderlich)
- Arma 3 via Steam installiert

---

## 🔥 VPN-Modus

Der Admin kann zwischen zwei Modi umschalten:

| Modus | Traffic | Empfohlen für |
|-------|---------|---------------|
| **Arma 3** (Standard) | Nur UDP 2302–2305 + BattlEye (2344–2345) | Arma 3 Spielsessions |
| **Offen** | Alle Ports zwischen Peers | Andere Nutzung (z.B. andere Spiele) |

---

## 🛠️ Troubleshooting

### VPN verbindet, aber Arma 3 findet den Host nicht
- Sicherstellen, dass alle Spieler mit dem VPN verbunden sind
- Host-Spieler: Arma 3 → Mehrspieler → **LAN** (nicht Internet!)
- Windows-Firewall prüfen: Port `2302/udp` muss erlaubt sein
- Ping-Test: `ping 10.8.0.x` (VPN-IP des Hosts) aus der Eingabeaufforderung

### `Access denied` beim Starten des Clients
- Installer **muss als Administrator** ausgeführt werden
- Falls bereits installiert: Rechtsklick auf Verknüpfung → "Als Administrator ausführen"

### Session verschwindet aus der Liste
- Der Heartbeat des Host-Clients hat aufgehört — Client muss laufen
- Sessions laufen nach 5 Minuten ohne Heartbeat automatisch ab

### Registrierungs-Code wird nicht akzeptiert
- Code beim Admin erfragen (sichtbar im Admin Dashboard)
- Groß-/Kleinschreibung beachten
- Leerzeichen am Anfang/Ende entfernen

---

## 📁 Repository-Struktur

```
arma3-session-bridge/
├── .env.example                # Vorlage für Umgebungsvariablen
├── docker-compose.yml          # Server-Stack-Definition
├── server/
│   ├── api/                    # FastAPI Backend (Python)
│   │   ├── main.py             # Anwendungs-Einstiegspunkt
│   │   ├── routers/            # API-Route-Handler
│   │   └── services/           # Business-Logik
│   ├── admin-ui/               # React Dashboard
│   └── wireguard/              # WireGuard-Skripte
├── client/
│   └── windows/                # Tauri v2 Windows-Client
│       ├── src/                # React Frontend
│       └── src-tauri/          # Rust Backend (VPN, API, Tray)
└── .github/
    └── workflows/
        ├── build-windows.yml   # NSIS-Installer bauen
        └── deploy.yml          # SSH-Deploy auf VPS
```

---

## 🤝 Contributing

Pull Requests sind willkommen. Bitte:
1. Zuerst ein Issue für größere Änderungen öffnen
2. Bestehenden Code-Stil einhalten (Python: `black .`, TS: `eslint`)
3. Tests für neue Funktionalität hinzufügen

## 📄 Lizenz

Siehe [client/windows/LICENSE.txt](client/windows/LICENSE.txt)
