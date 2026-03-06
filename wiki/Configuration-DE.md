# Konfigurationsreferenz (Deutsch)

## Umgebungsvariablen (.env)

| Variable | Pflicht | Standard | Beschreibung |
|----------|---------|----------|-------------|
| `ADMIN_PASSWORD` | ✅ Ja | — | Passwort für das Admin-Dashboard |
| `JWT_SECRET` | ✅ Ja | — | Geheimnis für JWT-Token-Signierung (min. 32 Zeichen) |
| `WG_SERVER_IP` | ✅ Ja | `10.8.0.1` | Öffentliche IP des WireGuard/API-Servers |
| `WG_PORT` | Nein | `51820` | WireGuard UDP-Listen-Port |
| `API_PORT` | Nein | `8001` | Externer Port für FastAPI REST API |
| `ADMIN_UI_PORT` | Nein | `8090` | Externer Port für Admin-Dashboard-UI |

### Sicheres JWT Secret generieren

```bash
openssl rand -base64 48
```

## Docker Compose Services

### wireguard

Verwendet das `linuxserver/wireguard:latest` Image.

```yaml
ports:
  - "${WG_PORT:-51820}:51820/udp"
cap_add:
  - NET_ADMIN
  - SYS_MODULE
sysctls:
  - net.ipv4.conf.all.src_valid_mark=1
```

Interne Umgebungsvariablen (nicht in `.env`):
- `PUID=1000` — Container-Prozess-Benutzer-ID
- `PGID=1000` — Container-Prozess-Gruppen-ID
- `TZ=Europe/Berlin` — Zeitzone

### api

Gebaut aus `./server/api/Dockerfile`. Betreibt FastAPI mit uvicorn.

```yaml
ports:
  - "${API_PORT:-8001}:8000"
volumes:
  - ./server/api:/app
  - ./wireguard/config:/wg-config:ro
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

Die API benötigt das WireGuard-Config-Verzeichnis um Peer-Public-Keys zu lesen und `.conf` Dateien zu generieren.

### admin-ui

Verwendet `nginx:alpine` um den React-Build auszuliefern.

```yaml
ports:
  - "${ADMIN_UI_PORT:-8090}:80"
volumes:
  - ./server/admin-ui:/usr/share/nginx/html:ro
```

## API-Authentifizierung

Die API verwendet zwei Arten von JWT Bearer-Tokens:

### Admin-JWT

- **Abgerufen über:** `POST /auth/login` mit dem `ADMIN_PASSWORD`
- **Ablauf:** 8 Stunden
- **Erforderlich für:** Peers erstellen/sperren, Admin-Statistiken, Event-Log

```bash
curl -s -X POST http://SERVER_IP:8001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"DEIN_ADMIN_PASSWORT"}'
# Antwort: {"access_token": "eyJ...", "token_type": "bearer"}
```

### Peer-JWT

- **Abgerufen:** Einmalig bei der Peer-Erstellung über `POST /peers`
- **Ablauf:** Nie (Peer sperren zum Ungültigmachen)
- **Erforderlich für:** Sessions erstellen (`POST /sessions`), Heartbeats senden

> ⚠️ **Wichtig:** Der Peer-Token wird **nur einmal** bei der Erstellung angezeigt. Sofort sicher speichern — kann nicht erneut abgerufen werden.

## WireGuard-Konfiguration

### Split-Tunnel (Empfohlen)

```ini
[Interface]
PrivateKey = <peer-private-key>
Address = 10.8.0.X/24
DNS = 1.1.1.1

[Peer]
PublicKey = <server-public-key>
PresharedKey = <preshared-key>
AllowedIPs = 10.8.0.0/24
Endpoint = YOUR_SERVER_IP:51820
PersistentKeepalive = 25
```

`AllowedIPs = 10.8.0.0/24` bedeutet: **Nur** das VPN-Subnetz läuft durch den Tunnel. Normaler Internet-Traffic wird NICHT beeinflusst.

### Full-Tunnel (Nicht empfohlen)

Wenn der gesamte Traffic durch den VPN geleitet werden soll (höhere Latenz):
```ini
AllowedIPs = 0.0.0.0/0, ::/0
```

Die Client-App lehnt Full-Tunnel-Konfigurationen automatisch **ab** (Sicherheitsprüfung).

## Session-Konfiguration

| Parameter | Wert | Konfigurierbar |
|-----------|------|----------------|
| Heartbeat-Intervall (Client) | 60 Sekunden | Nein (Compile-Zeit) |
| Session-Timeout | 5 Minuten | Nein (Server-seitig) |
| Max. Spieler pro Session | 256 | Ja (Arma 3 Einstellung) |
| Session-Listen-Aktualisierung (Client) | 30 Sekunden | Nein (Compile-Zeit) |

## Netzwerktopologie

```
Internet
  │
  ▼
YOUR_SERVER_IP (your VPS — AlmaLinux 9.7)
  │
  ├── :51820/udp  ──── arma3-wireguard ────────┐
  ├── :8001/tcp   ──── arma3-api (FastAPI)     │
  └── :8090/tcp   ──── arma3-admin-ui (nginx)  │
                                                 │ Docker bridge: arma3-net
VPN: 10.8.0.0/24                               │
  ├── 10.8.0.1   ──── WireGuard Server  ◄─────┘
  ├── 10.8.0.2   ──── Spieler A (zugewiesen)
  ├── 10.8.0.3   ──── Spieler B (zugewiesen)
  └── 10.8.0.x   ──── Spieler N (zugewiesen)
```

## Client-Konfiguration (Tauri App)

Die Windows-Client-App verwendet eine feste API-URL in `src-tauri/src/lib.rs`:

```rust
const API_BASE_URL: &str = "https://your-domain.example.com/api";
```

Für einen eigenen Server: Tauri-App neu kompilieren mit eigener API-URL.

## Datenbank

SQLite-Datenbank wird unter `/app/arma3_bridge.db` im `arma3-api` Container gespeichert.

Backup erstellen:
```bash
docker exec arma3-api sqlite3 /app/arma3_bridge.db ".backup /tmp/backup.db"
docker cp arma3-api:/tmp/backup.db ./backup-$(date +%Y%m%d).db
```
