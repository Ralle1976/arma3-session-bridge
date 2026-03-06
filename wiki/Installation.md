# Installation Guide (English)

## Prerequisites

### Server
- Linux VPS with public IP (AlmaLinux 9.7 / Ubuntu 22.04+ recommended)
- Docker Engine 24.x+ and Docker Compose 2.x+
- Open ports: `51820/udp`, `8001/tcp`, `8090/tcp`

### Windows Client
- Windows 10/11 (64-bit)
- Administrator rights (mandatory)
- Arma 3 installed via Steam

## Server Installation

### Step 1: Install Docker

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

### Step 2: Clone Repository

```bash
cd /opt
git clone https://github.com/Ralle1976/arma3-session-bridge
cd arma3-session-bridge
```

### Step 3: Configure Environment

```bash
cp .env.example .env
nano .env
```

Required values:
```env
ADMIN_PASSWORD=your-strong-password-here
JWT_SECRET=your-random-secret-minimum-32-characters
WG_SERVER_IP=YOUR_SERVER_IP
WG_PORT=51820
API_PORT=8001
ADMIN_UI_PORT=8090
```

Generate a secure JWT secret:
```bash
openssl rand -base64 48
```

### Step 4: Configure Firewall

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

### Step 5: Start Docker Services

```bash
cd /opt/arma3-session-bridge
docker compose up -d
```

Expected output:
```
[+] Running 3/3
 ✔ Container arma3-wireguard  Started
 ✔ Container arma3-api        Started
 ✔ Container arma3-admin-ui   Started
```

### Step 6: Verify Installation

```bash
# API health check
curl http://localhost:8001/health
# Expected: {"status": "ok", "version": "0.1.0"}

# Container status
docker compose ps
```

All containers should show status `running`.

### Step 7: Create the First Peer

```bash
# Get admin token
TOKEN=$(curl -s -X POST http://localhost:8001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR-ADMIN-PASSWORD"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

# Create peer
curl -X POST http://localhost:8001/peers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Player1"}'
```

Response includes:
- `tunnel_ip` — Player's VPN IP (e.g. `10.8.0.2`)
- `peer_token` — **Shown only once! Save immediately!**

### Step 8: Download Peer Config

```bash
curl -o player1.conf \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8001/peers/1/config
```

Distribute the `.conf` file securely to the player (via Signal, encrypted email, etc.)

## Client Installation (Windows)

### Download

Get the latest installer from:
**[Releases](https://github.com/Ralle1976/arma3-session-bridge/releases/latest)**

File: `arma3-session-bridge-setup.exe`

### Install — Step by Step

> ⚠️ **REQUIRED: Right-click → "Run as administrator"**

1. Right-click `arma3-session-bridge-setup.exe` → **"Run as administrator"**
2. Confirm the UAC dialog with "Yes"
3. **Setup Wizard:**
   - Step 1: Click "Next"
   - Step 2: Choose installation directory (default: `C:\Program Files\Arma3SessionBridge\`)
   - Step 3: Browse and select your `.conf` file
   - Step 4: Enter API URL: `http://YOUR_SERVER_IP:8001`
   - Step 5: Click "Install"
4. Click "Finish"

### Verify Client Installation

1. The **Arma 3 Session Bridge** icon appears in the system tray (bottom-right)
2. Right-click → "Connect VPN"
3. Tooltip should show "Connected: 10.8.0.x" within 10 seconds

## Updating

### Server Update

```bash
cd /opt/arma3-session-bridge
git pull
docker compose pull
docker compose up -d --build
```

### Client Update

Download and run the latest installer from [Releases](https://github.com/Ralle1976/arma3-session-bridge/releases/latest). The installer handles updates automatically.
