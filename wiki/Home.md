# Arma 3 Session Bridge — Wiki

Welcome to the **Arma 3 Session Bridge** wiki. Private Arma 3 multiplayer via WireGuard VPN — no port-forwarding required.

## Pages

| Page | Language | Description |
|------|----------|-------------|
| [Installation](Installation) | English | Server & client installation guide |
| [Installation-DE](Installation-DE) | Deutsch | Server & Client Installationsanleitung |
| [Configuration](Configuration) | English | Environment variables & config reference |
| [Configuration-DE](Configuration-DE) | Deutsch | Konfigurationsreferenz |
| [Troubleshooting](Troubleshooting) | English | Common problems and solutions |
| [Troubleshooting-DE](Troubleshooting-DE) | Deutsch | Häufige Probleme und Lösungen |
| [FAQ](FAQ) | English | Frequently asked questions |
| [FAQ-DE](FAQ-DE) | Deutsch | Häufig gestellte Fragen |

## Quick Links

- [GitHub Repository](https://github.com/YourGitHubUser/arma3-session-bridge)
- [User Manual (English)](https://github.com/YourGitHubUser/arma3-session-bridge/blob/master/docs/user-manual-en.md)
- [Benutzerhandbuch (Deutsch)](https://github.com/YourGitHubUser/arma3-session-bridge/blob/master/docs/user-manual-de.md)
- [API Reference (OpenAPI)](https://github.com/YourGitHubUser/arma3-session-bridge/blob/master/openapi.yaml)

## Architecture Overview

```
Windows Player A ─── WireGuard ──┐
Windows Player B ─── WireGuard ──┼── VPS (YOUR_SERVER_IP)
Windows Player C ─── WireGuard ──┘    ├── WireGuard VPN  (UDP 51820)
                                        ├── FastAPI API   (Port 8001)
                                        └── React Admin  (Port 8090)
```

## Stack

| Component | Technology |
|-----------|-----------|
| VPN | WireGuard (linuxserver/wireguard:latest) |
| API | FastAPI (Python 3.11), SQLite |
| Admin UI | React + TailwindCSS, nginx |
| Client | Tauri v2 (Rust + React), NSIS Installer |
| Server | your VPS, AlmaLinux 9.7, Docker |

## Getting Started

1. **Server Admin:** See [Installation](Installation) to set up the server
2. **Players:** Get your `.conf` file from the admin, then see [Installation](Installation) for client setup
3. **Configuration help:** See [Configuration](Configuration)
4. **Something broken?** See [Troubleshooting](Troubleshooting) or [FAQ](FAQ)
