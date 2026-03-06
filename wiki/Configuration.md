# Configuration Reference (English)

## Environment Variables (.env)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ADMIN_PASSWORD` | ✅ Yes | — | Password for admin dashboard login |
| `JWT_SECRET` | ✅ Yes | — | Secret for JWT token signing (min. 32 characters) |
| `WG_SERVER_IP` | ✅ Yes | `10.8.0.1` | Public IP of your WireGuard/API server |
| `WG_PORT` | No | `51820` | WireGuard UDP listen port |
| `API_PORT` | No | `8001` | External port for FastAPI REST API |
| `ADMIN_UI_PORT` | No | `8090` | External port for Admin Dashboard UI |

### Generating a Secure JWT Secret

```bash
openssl rand -base64 48
```

## Docker Compose Services

### wireguard

Uses `linuxserver/wireguard:latest` image.

```yaml
ports:
  - "${WG_PORT:-51820}:51820/udp"
cap_add:
  - NET_ADMIN
  - SYS_MODULE
sysctls:
  - net.ipv4.conf.all.src_valid_mark=1
```

Internal environment variables (not in `.env`):
- `PUID=1000` — Container process user ID
- `PGID=1000` — Container process group ID
- `TZ=Europe/Berlin` — Timezone

### api

Built from `./server/api/Dockerfile`. Runs FastAPI with uvicorn.

```yaml
ports:
  - "${API_PORT:-8001}:8000"
volumes:
  - ./server/api:/app
  - ./wireguard/config:/wg-config:ro
  - /var/run/docker.sock:/var/run/docker.sock:ro
```

The API needs the WireGuard config directory to read peer public keys and generate `.conf` files.

### admin-ui

Uses `nginx:alpine` to serve the React build.

```yaml
ports:
  - "${ADMIN_UI_PORT:-8090}:80"
volumes:
  - ./server/admin-ui:/usr/share/nginx/html:ro
```

## API Authentication

The API uses two types of JWT Bearer tokens:

### Admin JWT

- **Obtained via:** `POST /auth/login` with your `ADMIN_PASSWORD`
- **Expiry:** 8 hours
- **Required for:** Creating/revoking peers, viewing admin stats, accessing event log

```bash
curl -s -X POST http://SERVER_IP:8001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR_ADMIN_PASSWORD"}'
# Response: {"access_token": "eyJ...", "token_type": "bearer"}
```

### Peer JWT

- **Obtained:** Once, when a peer is created via `POST /peers`
- **Expiry:** Never (revoke the peer to invalidate)
- **Required for:** Creating sessions (`POST /sessions`), sending heartbeats

> ⚠️ **Important:** The peer token is shown **only once** when the peer is created. Store it securely — it cannot be retrieved again.

## WireGuard Configuration

### Split-Tunnel (Recommended)

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

`AllowedIPs = 10.8.0.0/24` means **only** the VPN subnet goes through the tunnel. Regular internet traffic is NOT affected.

### Full-Tunnel (Not Recommended)

If you want all traffic through the VPN (higher latency):
```ini
AllowedIPs = 0.0.0.0/0, ::/0
```

The client app automatically **rejects** full-tunnel configurations (security check).

## Session Configuration

| Parameter | Value | Configurable |
|-----------|-------|-------------|
| Heartbeat interval (client) | 60 seconds | No (compile-time) |
| Session timeout | 5 minutes | No (server-side) |
| Max players per session | 256 | Yes (Arma 3 setting) |
| Session list refresh (client) | 30 seconds | No (compile-time) |

## Network Topology

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
  ├── 10.8.0.2   ──── Player A (assigned)
  ├── 10.8.0.3   ──── Player B (assigned)
  └── 10.8.0.x   ──── Player N (assigned)
```

## Client Configuration (Tauri App)

The Windows client uses a hardcoded API URL in `src-tauri/src/lib.rs`:

```rust
const API_BASE_URL: &str = "https://your-domain.example.com/api";
```

To use a custom server, rebuild the Tauri app with your API URL substituted.

## Admin Dashboard (React)

The React app connects to the API at the URL configured during installation. The admin UI communicates with:

- `POST /auth/login` — Initial login
- `GET /peers` — Peer list (polled every 30s)
- `GET /sessions` — Session list (polled every 30s)
- `GET /admin/stats` — System stats (polled every 10s)
- `GET /admin/events` — SSE live event stream

## Database

SQLite database is stored at `/app/arma3_bridge.db` inside the `arma3-api` container.

To backup:
```bash
docker exec arma3-api sqlite3 /app/arma3_bridge.db ".backup /tmp/backup.db"
docker cp arma3-api:/tmp/backup.db ./backup-$(date +%Y%m%d).db
```
