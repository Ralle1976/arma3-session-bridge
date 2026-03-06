# Arma 3 Session Bridge — User Manual (English)

**Version:** 1.0.0  
**Last Updated:** March 2026  
**Language:** English

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [System Requirements](#2-system-requirements)
3. [Server Installation (Docker)](#3-server-installation-docker)
4. [Client Installation (Windows)](#4-client-installation-windows)
5. [Establishing a VPN Connection](#5-establishing-a-vpn-connection)
6. [Hosting an Arma 3 Session](#6-hosting-an-arma-3-session)
7. [Joining a Session](#7-joining-a-session)
8. [Admin Dashboard](#8-admin-dashboard)
9. [Troubleshooting](#9-troubleshooting)
10. [Frequently Asked Questions (FAQ)](#10-frequently-asked-questions-faq)

---

## 1. Introduction

### What is Arma 3 Session Bridge?

Arma 3 Session Bridge is a software solution that enables private Arma 3 multiplayer **without requiring router port-forwarding**. At its core is a WireGuard VPN tunnel that securely connects all players through a central server.

### The Problem

Arma 3 multiplayer requires open ports on your router (default UDP 2302). In modern network environments, these ports are often blocked:
- **CGNAT (Carrier-Grade NAT)**: Many ISPs share one public IP between multiple customers
- **Firewalls**: Corporate or school networks block gaming ports
- **Router limitations**: Port-forwarding is complex or impossible on some connections

### The Solution

Arma 3 Session Bridge routes all game traffic through a WireGuard VPN server hosted on an IONOS VPS (Virtual Private Server). All players connect to this server and play over a private VPN network `10.8.0.0/24`.

```
Player A ──WireGuard──┐
Player B ──WireGuard──┼── VPS (public IP: 212.227.54.229)
Player C ──WireGuard──┘      └── private network: 10.8.0.0/24

Player C connects in Arma 3 to: 10.8.0.2 (tunnel IP of Player A)
```

### Key Concepts

| Term | Explanation |
|------|-------------|
| **Peer** | A registered player with their own WireGuard certificate |
| **Tunnel IP** | The player's private VPN IP (e.g. `10.8.0.2`) |
| **Session** | An active Arma 3 match registered in the system |
| **Heartbeat** | Regular signal marking the session as active |
| **Split-Tunnel** | Only VPN traffic goes through the tunnel; regular internet traffic is unaffected |

---

## 2. System Requirements

### Server (IONOS VPS)

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| Operating System | Ubuntu 22.04 LTS | AlmaLinux 9.7 |
| CPU | 1 vCore | 2 vCores |
| RAM | 1 GB | 2 GB |
| Storage | 20 GB SSD | 40 GB SSD |
| Network | 100 Mbit/s | 1 Gbit/s |
| Docker | 24.x | 25.x+ |
| Docker Compose | 2.x | 2.x+ |

**Required open ports:**
- `51820/udp` — WireGuard VPN
- `8001/tcp` — REST API
- `8090/tcp` — Admin Dashboard

### Windows Client (Player PC)

| Requirement | Details |
|-------------|---------|
| Operating System | Windows 10 (64-bit) or Windows 11 |
| User Rights | **Administrator** (mandatory) |
| Arma 3 | Installed via Steam |
| Network | Outbound UDP connections permitted |
| Antivirus | May require exception for arma3-session-bridge.exe |

> ⚠️ **Important:** The client software requires **Administrator privileges** because WireGuard installs a kernel driver. The application will not function correctly without admin rights.

---

## 3. Server Installation (Docker)

### 3.1 Install Prerequisites

Connect to your IONOS VPS via SSH:

```bash
ssh root@212.227.54.229
```

Install Docker and Docker Compose (AlmaLinux 9):

```bash
# Install Docker
dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
dnf install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y

# Enable and start Docker
systemctl enable docker
systemctl start docker

# Verify
docker --version
docker compose version
```

### 3.2 Clone the Repository

```bash
cd /opt
git clone https://github.com/Ralle1976/arma3-session-bridge
cd arma3-session-bridge
```

### 3.3 Configure Environment Variables

```bash
cp .env.example .env
nano .env
```

Content of the `.env` file:

```env
# Admin password for the dashboard (choose a strong password!)
ADMIN_PASSWORD=my-secure-password-here

# JWT signing secret (minimum 32 characters!)
JWT_SECRET=a-long-random-secret-string-here

# Public IP of your IONOS server
WG_SERVER_IP=212.227.54.229

# WireGuard port (default: 51820)
WG_PORT=51820

# API port (externally accessible)
API_PORT=8001

# Admin UI port (externally accessible)
ADMIN_UI_PORT=8090
```

**Generate a secure JWT secret:**

```bash
openssl rand -base64 48
```

Use the output (a random string) as your `JWT_SECRET`.

### 3.4 Configure Firewall

```bash
# Open WireGuard UDP port
firewall-cmd --permanent --add-port=51820/udp

# Open API port
firewall-cmd --permanent --add-port=8001/tcp

# Open Admin UI port
firewall-cmd --permanent --add-port=8090/tcp

# Apply rules
firewall-cmd --reload

# Verify
firewall-cmd --list-ports
```

### 3.5 Start Docker Services

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

### 3.6 Verify Installation

```bash
# API health check
curl http://localhost:8001/health
# Expected: {"status": "ok", "version": "0.1.0"}

# Container status
docker compose ps
```

All containers should show as `running`.

### 3.7 Create the First Peer (Admin Login)

```bash
# Get admin token
TOKEN=$(curl -s -X POST http://localhost:8001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"YOUR-ADMIN-PASSWORD"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")

# Create first peer
curl -X POST http://localhost:8001/peers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Player1"}'
```

The response contains:
- `id` — Peer ID
- `tunnel_ip` — Tunnel IP (e.g. `10.8.0.2`)
- `peer_token` — **One-time** peer JWT token (save this immediately!)

### 3.8 Download Peer Configuration File

```bash
# Download WireGuard .conf file
curl -o player1.conf \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:8001/peers/1/config
```

This `.conf` file must be distributed to the player (e.g. via Signal or email).

> 🔒 **Security Note:** The peer config file contains a private key. **Never** share it publicly or via insecure channels!

### 3.9 Updates

```bash
cd /opt/arma3-session-bridge
git pull
docker compose pull
docker compose up -d --build
```

---

## 4. Client Installation (Windows)

### 4.1 Download the Installer

1. Go to: `https://github.com/Ralle1976/arma3-session-bridge/releases/latest`
2. Download `arma3-session-bridge-setup.exe`

### 4.2 Run the Installer

> ⚠️ **REQUIRED:** Run the installer as **Administrator**!

1. Right-click `arma3-session-bridge-setup.exe`
2. Select "**Run as administrator**"
3. Confirm the UAC dialog with "Yes"

#### Setup Wizard — Step by Step

**Step 1 — Welcome**
- Click "Next"

**Step 2 — Installation Directory**
- Default: `C:\Program Files\Arma3SessionBridge\`
- You may keep or change this
- Click "Next"

**Step 3 — Peer Configuration**
- Click "Browse" and select your `.conf` file
- The file is automatically validated (split-tunnel check)
- Click "Next"

**Step 4 — API Server URL**
- Default: `http://212.227.54.229:8001`
- Only change if your server has a different IP
- Click "Next"

**Step 5 — Start Menu Entry**
- Optional: Create a desktop shortcut
- Click "Install"

**Step 6 — Finish**
- WireGuard driver is installed (may require reboot on first install)
- Click "Finish"

### 4.3 Test the First Connection

After installation:
1. The **Arma 3 Session Bridge** icon appears in the system tray (bottom-right taskbar)
2. Right-click → "Connect VPN"
3. Wait for "Connected: 10.8.0.x" as the tooltip
4. Open the main UI (double-click the tray icon)

### 4.4 Configure Autostart

The application starts automatically with Windows and can be configured to auto-connect to the VPN at startup if you enabled that option during setup.

### 4.5 Uninstallation

1. Windows Settings → Apps → Arma 3 Session Bridge → Uninstall
2. Or: Run `C:\Program Files\Arma3SessionBridge\uninstall.exe`

---

## 5. Establishing a VPN Connection

### 5.1 Via the System Tray

The tray icon shows the current status:
- 🔴 **Red icon** — Disconnected
- 🟢 **Green icon** — Connected

Right-click the icon:
- **Connect VPN** — Establish VPN connection
- **Disconnect VPN** — Terminate VPN connection
- **Quit** — Exit the application

### 5.2 Via the Main Interface

1. Double-click the tray icon
2. Main window opens
3. Click **"Connect VPN"**
4. Status display switches to "Connected (10.8.0.x)"

### 5.3 Verify Connection

After a successful connection:
- Tray tooltip shows: `Connected: 10.8.0.2`
- Ping test (Command Prompt): `ping 10.8.0.1` should respond
- The session list loads automatically

### 5.4 Connection Issues

If the connection fails:
1. Check if the server is reachable: `ping 212.227.54.229`
2. Check Windows Firewall (WireGuard must be allowed)
3. Verify the `.conf` file is correctly placed
4. Restart the application as **Administrator**

---

## 6. Hosting an Arma 3 Session

### 6.1 Prerequisites

Before hosting a session:
- ✅ VPN connection active (green tray icon)
- ✅ Arma 3 launched and at the main menu
- ✅ Desired mission prepared

### 6.2 Create a Session

1. Open the main interface (double-click tray icon)
2. Click **"Host Session"**
3. Fill in the form:
   - **Mission Name**: Name of the mission (e.g. `Takistan_Patrol_v3`)
   - **Max Players**: Maximum number of players (1–64)
4. Click **"Host"**
5. Your tunnel IP (e.g. `10.8.0.2`) is displayed

### 6.3 Start the Arma 3 Server

1. In Arma 3: **Multiplayer** → **Host Server**
2. Set player count accordingly
3. Select the mission
4. Start the server

### 6.4 Share Session Info

Share with other players:
- Your **Tunnel IP** (visible in the app): e.g. `10.8.0.2`
- Players connect in Arma 3 using this IP

### 6.5 Heartbeat — Keeping the Session Alive

The app automatically sends a heartbeat signal every **60 seconds** to the server. Without a heartbeat, the session is automatically terminated after **5 minutes**.

> 📌 **Tip:** Keep the app running in the background while playing. Closing the app or disconnecting the VPN immediately terminates the session.

### 6.6 End the Session

- Click **"Stop Hosting"** in the app, **or**
- Disconnect the VPN, **or**
- Exit the app

---

## 7. Joining a Session

### 7.1 Open the Session List

1. Connect VPN (Step 5)
2. Open the main interface
3. The **Session List** loads automatically
4. Click **"Refresh"** for the latest list

### 7.2 Select a Session

The list shows for each active session:
- **Mission Name** — Name of the mission
- **Map** — Arma 3 map name
- **Players** — Current / Maximum players
- **Host IP** — Tunnel IP of the host

### 7.3 Connect in Arma 3

1. Click **"Join"** next to the desired session
2. The **host tunnel IP** is copied to the clipboard (e.g. `10.8.0.2`)
3. Open Arma 3
4. **Multiplayer** → **Direct Connect**
5. Enter server address: `10.8.0.2`
6. Port: `2302` (Arma 3 default)
7. Connect

### 7.4 Connection Issues When Joining

| Problem | Cause | Solution |
|---------|-------|----------|
| Host not found | VPN not connected | Connect VPN (Step 5) |
| Session list won't load | Server unreachable | Check API URL |
| Timeout in Arma 3 | Firewall blocking | Add Arma 3 Windows Firewall exception |
| Wrong IP | Stale session list | Refresh the list |

---

## 8. Admin Dashboard

### 8.1 Access

The Admin Dashboard is accessible in your web browser:

```
http://212.227.54.229:8090
```

Log in with the `ADMIN_PASSWORD` configured in `.env`.

### 8.2 Dashboard Overview

The home page shows:
- **Active Peers** — Number of connected players
- **Running Sessions** — Number of active games
- **Server Uptime** — API server uptime
- **Traffic Statistics** — In/Out data

### 8.3 Peer Management

Under **"Peers"** you can:

**Create a new peer:**
1. Click **"+ Add Peer"**
2. Enter a name (e.g. player name or nickname)
3. Click **"Create"**
4. The `.conf` file and peer token are displayed
5. **Save immediately!** — The token is shown only once

**Revoke a peer:**
1. Find the peer in the list
2. Click the trash icon
3. Confirm the action
4. The peer can no longer connect

**Download peer config:**
- Click the download icon next to the peer
- `.conf` file is downloaded

### 8.4 Sessions Overview

Under **"Sessions"** you can see:
- All active sessions
- Session history (ended sessions)
- Heartbeat timestamp (last active)

**CSV Export:**
All session data can be exported as a CSV file (for statistics).

### 8.5 Event Log

The **Event Log** shows all system events in real-time:
- Peer connections
- Session start/end
- Admin actions
- Errors and warnings

The log is updated live via **Server-Sent Events (SSE)**.

### 8.6 Security Notes for Admins

- Use a **strong admin password** (min. 20 characters)
- Do **not** access the dashboard from public networks without VPN
- Rotate the `JWT_SECRET` regularly (requires all clients to reconnect)
- Revoke peers immediately when players leave the group

---

## 9. Troubleshooting

### 9.1 VPN Won't Connect

**Symptom:** Tray icon stays red, no tooltip

**Causes and Solutions:**

```
1. Application started without admin rights
   → Right-click → "Run as administrator"

2. Invalid .conf file
   → Open settings → select a new .conf file

3. Server unreachable
   → ping 212.227.54.229 in Command Prompt
   → If no ping: check VPS (IONOS console)

4. UDP port 51820 blocked
   → Contact network admin (school/corporate)
   → Try mobile hotspot as workaround

5. WireGuard driver error
   → Restart Windows
   → Uninstall and reinstall the application
```

### 9.2 Session Not Appearing in the List

**Symptom:** Own session not visible after hosting

**Solutions:**
1. Manually refresh the list (click "Refresh")
2. Check if VPN is connected
3. Test API connection: Browser → `http://212.227.54.229:8001/health`
4. Check if the peer token is still valid

### 9.3 Connection Fails in Arma 3

**Symptom:** Timeout or "Host not found" in Arma 3

**Checklist:**
- [ ] VPN connected? (green tray icon)
- [ ] Correct IP entered? (from session list, e.g. `10.8.0.2`)
- [ ] Port `2302`? (Arma 3 default port)
- [ ] Windows Firewall: Arma 3 exception added?
- [ ] Host player still connected?
- [ ] Ping test: `ping 10.8.0.2` (in CMD)

**Add Windows Firewall exception for Arma 3:**
1. Control Panel → Windows Defender Firewall
2. "Allow an app or feature through Windows Defender Firewall"
3. "Change Settings" → "Allow another app"
4. Select `C:\Program Files (x86)\Steam\steamapps\common\Arma 3\arma3_x64.exe`
5. Enable both Private AND Public

### 9.4 Heartbeat Stops / Session Disappears

**Symptom:** Own session disappears after a while

**Causes:**
- PC entered sleep/hibernate mode → network interrupted
- App minimized and Windows restricted background apps
- Network interruption

**Solutions:**
1. Disable power management for network adapter:
   - Device Manager → Network Adapters → Properties → Power Management
   - Uncheck "Allow the computer to turn off this device to save power"
2. Windows Settings: Allow background apps

### 9.5 Retrieving Client Logs

Logs are located at:
```
%APPDATA%\arma3-session-bridge\logs\
```

Send the latest log file to the admin for error analysis.

### 9.6 Checking Server Logs

```bash
# API logs
docker logs arma3-api --tail 100

# WireGuard logs
docker logs arma3-wireguard --tail 100

# Admin UI logs
docker logs arma3-admin-ui --tail 50
```

---

## 10. Frequently Asked Questions (FAQ)

### General

**Q: Does it cost anything to use?**  
A: The software itself is free. The IONOS VPS costs approximately €4–8/month.

**Q: How many players can be connected simultaneously?**  
A: Technically unlimited, practically limited by the VPS plan. The smallest IONOS plan is sufficient for 8–16 players.

**Q: Is the connection secure?**  
A: Yes. WireGuard uses modern cryptography (Curve25519, ChaCha20-Poly1305). All connections are end-to-end encrypted.

**Q: Can I have multiple sessions at once?**  
A: Yes, multiple players can host separate sessions simultaneously.

### Technical

**Q: Which local port needs to be open for Arma 3?**  
A: None! All traffic runs through the WireGuard tunnel. Only outbound UDP 51820 must be allowed (which is the case in most networks).

**Q: Does the VPN increase my ping?**  
A: Minimally. The VPN server typically adds 10–30 ms. Since all players connect through the same server, everyone plays under equal conditions.

**Q: What happens if the VPS server goes down?**  
A: All connections are dropped. Sessions are lost. The IONOS VPS has a 99.9% uptime guarantee.

**Q: Can I use my own server?**  
A: Yes! Change `WG_SERVER_IP` in the `.env` file to your server's IP.

**Q: Does WireGuard need to be installed separately?**  
A: No. The installer package includes everything. The WireGuard driver is installed automatically.

### Sessions

**Q: How long does a session stay active?**  
A: Sessions remain active as long as the host is connected and sending heartbeats. Without a heartbeat: 5-minute timeout.

**Q: What happens if the host disconnects?**  
A: The session is automatically deleted after 5 minutes. Other players will be dropped from the game.

**Q: Can players join while the game is in progress?**  
A: This depends on the Arma 3 mission settings (JIP — Join-in-Progress). The bridge software itself has no restrictions.

### Issues

**Q: The app starts but VPN won't connect.**  
A: Most common cause: application without admin rights. Right-click → "Run as administrator".

**Q: My antivirus is blocking the app.**  
A: Add the app as an exception. False positives from the WireGuard driver are known to occur.

**Q: After a Windows update, the app stopped working.**  
A: Reinstall the WireGuard driver: uninstall the app → reinstall (as admin).

**Q: The session list shows "No sessions available" even though someone is hosting.**  
A: Check that your VPN is connected. The API is only reachable through the VPN subnet. Also try refreshing the list manually.

---

*More help available at the [GitHub Wiki](https://github.com/Ralle1976/arma3-session-bridge/wiki) or create a [GitHub Issue](https://github.com/Ralle1976/arma3-session-bridge/issues).*
