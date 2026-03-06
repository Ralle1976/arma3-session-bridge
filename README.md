# Arma 3 Session Bridge

> Private Arma 3 multiplayer via WireGuard VPN — no port-forwarding required.

[![Build Windows Client](https://github.com/YourGitHubUser/arma3-session-bridge/actions/workflows/build-windows.yml/badge.svg)](https://github.com/YourGitHubUser/arma3-session-bridge/actions/workflows/build-windows.yml)
[![Deploy Server](https://github.com/YourGitHubUser/arma3-session-bridge/actions/workflows/deploy.yml/badge.svg)](https://github.com/YourGitHubUser/arma3-session-bridge/actions/workflows/deploy.yml)

## Overview

Arma 3 Session Bridge solves the classic problem of hosting private Arma 3 sessions: **players behind NAT/CGNAT can host games** without opening router ports. All traffic is tunnelled through a WireGuard VPN on a cheap your VPS.

- **Server**: your VPS (AlmaLinux 9.7, public IP `YOUR_SERVER_IP`)
- **VPN**: WireGuard split-tunnel `10.8.0.0/24`, UDP port `51820`
- **API**: FastAPI REST, port `8001`, SQLite database
- **Admin UI**: React + TailwindCSS dashboard, port `8090`
- **Windows Client**: Tauri v2 app, NSIS installer (`arma3-session-bridge-setup.exe`)

## Architecture

```
Windows Player A ─── WireGuard ──┐
Windows Player B ─── WireGuard ──┼── VPS (YOUR_SERVER_IP)
Windows Player C ─── WireGuard ──┘    ├── WireGuard VPN     (UDP 51820)
                                        ├── FastAPI REST API  (Port 8001)
                                        └── React Admin UI    (Port 8090)
```

### Split-Tunnel Routing

Only Arma 3 VPN traffic (`10.8.0.0/24`) is routed through the tunnel. Regular internet traffic flows directly to avoid unnecessary latency.

```
Player → Arma3 connect 10.8.0.2:2302
        ↓ WireGuard tunnel (encrypted)
Server → WireGuard decrypts → forwards to Host Player's 10.8.0.2
```

## Quick Start

### Server Deployment

```bash
# Clone repository
git clone https://github.com/YourGitHubUser/arma3-session-bridge
cd arma3-session-bridge

# Configure environment
cp .env.example .env
# Edit .env: fill in ADMIN_PASSWORD, JWT_SECRET, WG_SERVER_IP

# Start all services
docker compose up -d

# Verify health
curl http://YOUR_SERVER_IP:8001/health
```

### Windows Client Installation

1. Download the latest release: **[arma3-session-bridge-setup.exe](https://github.com/YourGitHubUser/arma3-session-bridge/releases/latest)**
2. Run **AS ADMINISTRATOR** (required for WireGuard service installation)
3. Follow the **Setup Wizard** (enter API URL + your peer config file)
4. Connect VPN via system tray icon

## Configuration (`.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_PASSWORD` | Admin dashboard password | *(required)* |
| `JWT_SECRET` | JWT signing secret (min. 32 chars) | *(required)* |
| `WG_SERVER_IP` | Public IP of your your server | `YOUR_SERVER_IP` |
| `WG_PORT` | WireGuard UDP port | `51820` |
| `API_PORT` | External port for REST API | `8001` |
| `ADMIN_UI_PORT` | External port for Admin UI | `8090` |

### Generate a secure JWT secret

```bash
openssl rand -base64 48
```

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/health` | Public | Liveness probe |
| `POST` | `/auth/login` | Public | Admin login → JWT |
| `POST` | `/peers` | Admin JWT | Create WireGuard peer |
| `GET` | `/peers` | Admin JWT | List all peers |
| `GET` | `/peers/{id}` | Admin JWT | Get peer details |
| `DELETE` | `/peers/{id}` | Admin JWT | Revoke peer |
| `GET` | `/peers/{id}/config` | Admin JWT | Download `.conf` file |
| `POST` | `/sessions` | Peer JWT | Open Arma 3 session |
| `GET` | `/sessions` | Public | List active sessions |
| `DELETE` | `/sessions/{id}` | Peer JWT | Close session |
| `PUT` | `/sessions/{id}/heartbeat` | Peer JWT | Keep session alive |
| `GET` | `/admin/stats` | Admin JWT | System statistics |
| `GET` | `/admin/events` | Admin JWT | SSE live event stream |

Full OpenAPI spec: [openapi.yaml](openapi.yaml)

## Docker Services

| Service | Container | Image | Port |
|---------|-----------|-------|------|
| WireGuard VPN | `arma3-wireguard` | `linuxserver/wireguard:latest` | `51820/udp` |
| REST API | `arma3-api` | Built from `./server/api` | `8001→8000` |
| Admin UI | `arma3-admin-ui` | `nginx:alpine` | `8090→80` |

## Repository Structure

```
arma3-session-bridge/
├── .env.example            # Environment variable template
├── docker-compose.yml      # Server stack definition
├── openapi.yaml            # REST API specification
├── docs/                   # User documentation
│   ├── user-manual-de.md   # Deutsches Benutzerhandbuch
│   └── user-manual-en.md   # English User Manual
├── server/
│   ├── api/                # FastAPI backend (Python)
│   │   ├── main.py         # Application entry point
│   │   ├── models.py       # Pydantic data models
│   │   ├── routers/        # API route handlers
│   │   └── services/       # Business logic (WireGuard, cleanup, events)
│   ├── admin-ui/           # React + TailwindCSS dashboard
│   └── wireguard/          # WireGuard entrypoint scripts
├── client/
│   └── windows/            # Tauri v2 Windows client
│       ├── src/            # React frontend
│       └── src-tauri/      # Rust backend (VPN, API calls, tray)
└── .github/
    └── workflows/
        ├── build-windows.yml  # Build NSIS installer
        └── deploy.yml         # SSH deploy to your VPS
```

## Joining an Arma 3 Session

1. Open the **Arma 3 Session Bridge** client
2. Click **Connect VPN** (or use tray icon)
3. The **Session List** updates automatically every 30 seconds
4. Click **Join** on any active session
5. Note the **Host Tunnel IP** (e.g. `10.8.0.2`)
6. In Arma 3: **Multiplayer → Direct Connect** → enter `10.8.0.2:2302`

## Hosting an Arma 3 Session

1. Connect to VPN first (required)
2. Click **Host Session**
3. Enter mission name and max player count
4. Your tunnel IP is automatically registered (e.g. `10.8.0.2`)
5. Other players see your session in the list within 30 seconds
6. The client sends heartbeats every 60 seconds to keep the session alive
7. Click **Stop Hosting** or disconnect VPN to close the session

## System Requirements

### Server
- Linux VPS with public IP (AlmaLinux 9.7 / Ubuntu 22.04+)
- Docker + Docker Compose
- Ports open: `51820/udp`, `8001/tcp`, `8090/tcp`

### Windows Client
- Windows 10/11 (64-bit)
- **Administrator rights** (required for WireGuard kernel module)
- Arma 3 installed via Steam

## Admin Dashboard

Access at `http://YOUR_SERVER_IP:8090`

Features:
- Live peer list (online/offline status)
- Active session overview
- Traffic statistics charts
- Peer management (create, revoke)
- CSV export for all data
- Real-time event log (SSE stream)

## Troubleshooting

### VPN connects but Arma 3 can't find the host
- Ensure the host player's tunnel IP is correctly registered (check Session List)
- Verify Arma 3 firewall rule: `2302/udp` must be allowed in Windows Firewall
- Use `ping 10.8.0.x` (from Command Prompt) to test tunnel connectivity

### `Access denied` when starting the client
- The installer **must** be run as Administrator
- If already installed, right-click the shortcut → "Run as administrator"

### Session disappears from list
- The host client's heartbeat may have stopped — check that the client is running
- Sessions auto-expire after 5 minutes without a heartbeat

## Contributing

Pull requests are welcome. Please:
1. Open an issue first for major changes
2. Follow existing code style (Rust: `cargo fmt`, Python: `black .`, TS: `eslint`)
3. Add tests for new functionality
4. Update documentation accordingly

## License

See [client/windows/LICENSE.txt](client/windows/LICENSE.txt)

---

*Documentation: [Wiki](https://github.com/YourGitHubUser/arma3-session-bridge/wiki) | [User Manual DE](docs/user-manual-de.md) | [User Manual EN](docs/user-manual-en.md)*
