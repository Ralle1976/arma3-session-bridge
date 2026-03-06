# FAQ — Frequently Asked Questions (English)

## General

**Q: Is this software free?**

A: Yes. The software is open-source (MIT-adjacent license). You pay only for the VPS — approximately €4–8/month at any VPS provider for the smallest plan, which is sufficient for a private group of friends.

---

**Q: How is this different from just opening router ports?**

A: Three key advantages:
1. **No router access needed** — works behind CGNAT, corporate firewalls, school networks
2. **Always-on server** — your VPS is always reachable; players don't need to know the host's home IP
3. **Session discovery** — the app shows all available sessions in one list, no need to share IPs via chat

---

**Q: Is my internet speed affected?**

A: Only Arma 3 VPN traffic goes through the tunnel (split-tunnel). All other traffic — browsing, Discord, streaming — is completely unaffected. You will not notice any difference for non-game traffic.

---

**Q: How many simultaneous players are supported?**

A: Technically unlimited. Practically:
- Cloud XS-equivalent (1 vCore, 1 GB RAM, 100 Mbit/s): comfortable for 8–12 players
- Cloud S-equivalent (2 vCore, 4 GB RAM, 200 Mbit/s): comfortable for 20–32 players
- Any larger plan supports 40+ players

---

**Q: Is my Arma 3 data private?**

A: The VPN encrypts all game traffic (WireGuard uses ChaCha20-Poly1305). The VPS owner (you or your admin) can see metadata like connection times and session info, but not the actual game content. The admin dashboard shows peer names, session names, and statistics only.

---

## Technical

**Q: Why does the installer require administrator rights?**

A: WireGuard installs a Windows kernel driver (`wireguard.sys`). Kernel driver installation requires administrator privileges. This is a one-time requirement — after installation, the app can connect to an existing tunnel without elevated rights (though the service itself runs as SYSTEM).

---

**Q: What ports does the client need open?**

A: Only **outbound UDP 51820** must be permitted. No inbound ports need to be opened on the player's machine.

Checking if UDP 51820 is blocked:
```cmd
# This should succeed (timeout expected since ICMP is not UDP)
# Test with the actual WireGuard connection attempt instead
```

---

**Q: Can I change the WireGuard port (if 51820 is blocked)?**

A: Yes. On the server, change `WG_PORT` in `.env` and restart. Players need new `.conf` files with the updated `Endpoint` port.

Common alternative ports: `443` (HTTPS-like), `53` (DNS-like), `4500` (IPSec NAT-T)

---

**Q: Does this work with Wi-Fi and mobile hotspot?**

A: Yes. Any internet connection that allows outbound UDP works. Mobile hotspots are an excellent fallback when corporate or school networks block UDP 51820.

---

**Q: Can I run the server on my home PC instead of a VPS?**

A: Technically possible if you have a static public IP or use dynamic DNS. However, a VPS is strongly recommended because:
- Your home IP must be stable (home IPs change on router restarts)
- You need port 51820/udp open in your router
- Your home PC must stay on 24/7

---

**Q: What happens to my sessions if the VPS reboots?**

A: Docker is configured with `restart: unless-stopped`. After a VPS reboot, all services restart automatically. Ongoing sessions will be lost (as they are in RAM/SQLite), but the VPN reconnects automatically for all clients who have `PersistentKeepalive = 25` in their `.conf`.

---

## Hosting

**Q: Do I need to keep the app running while hosting?**

A: Yes. The app sends a heartbeat every 60 seconds. Without a heartbeat, the session is automatically removed from the list after 5 minutes. You can minimize it to the system tray — just don't close it.

---

**Q: Can I host while not being the Arma 3 game server?**

A: No. The "host" in Arma 3 Session Bridge is the person who runs the Arma 3 game server. The bridge registers your VPN tunnel IP so other players can find and connect to it. If you just want to join, you don't need to host a session.

---

**Q: Can multiple players host simultaneously?**

A: Yes. Multiple sessions can run at the same time on different VPN IPs. Each host registers their own session.

---

**Q: How do players get my VPN IP?**

A: Automatically! When you click "Host Session", your tunnel IP is registered in the bridge's session list. Other players see it in the app within 30 seconds. They click "Join" and the IP is copied to their clipboard for Arma 3's Direct Connect.

---

**Q: What mission files do players need?**

A: The bridge only handles VPN connectivity — not game content. Players need to have the same mission file and mods as the host, just like in normal Arma 3 multiplayer. Share mission files via Steam Workshop or direct file transfer as usual.

---

## Arma 3 Specific

**Q: Which Arma 3 connection method to use?**

A: Use **Multiplayer → Direct Connect** with:
- **IP:** The host's tunnel IP (e.g. `10.8.0.2`)
- **Port:** `2302` (Arma 3 default)

You can also try the **Remote** tab in the Arma 3 server browser, but Direct Connect is more reliable.

---

**Q: Do Steam Mods / Workshop content work?**

A: Yes. The VPN is purely transport-layer. Mods, mission files, DLC — all work normally. Everyone must have the same mods loaded (exactly like normal Arma 3 multiplayer).

---

**Q: Does Zeus / Game Master work?**

A: Yes. All Arma 3 features work normally over the VPN.

---

**Q: Does Join-in-Progress (JIP) work?**

A: Yes, if the mission allows JIP. The bridge has no restrictions on when players join.

---

**Q: Can I use Arma 3 mods that modify network behavior?**

A: Most mods work. Mods that add custom network protocols or require specific server ports may have issues. Standard mods (ACE, ACRE, TFAR, etc.) all work normally.

---

## Admin

**Q: How do I add a new player?**

A: In the Admin Dashboard:
1. Login at `http://YOUR_SERVER_IP:8090`
2. Go to "Peers"
3. Click "+ Add Peer"
4. Enter player name
5. Download and share the `.conf` file securely

Or via API:
```bash
curl -X POST http://SERVER:8001/peers \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"PlayerName"}'
```

---

**Q: How do I remove/ban a player?**

A: In the Admin Dashboard under "Peers", click the trash icon. The peer's VPN access is revoked immediately — they cannot reconnect with their existing `.conf` file.

---

**Q: Can I see who is currently connected to the VPN?**

A: Yes — two ways:
1. Admin Dashboard → Peers section (shows last seen times)
2. Server command: `docker exec arma3-wireguard wg show`

---

**Q: How do I reset the admin password?**

A: Edit the `.env` file on the server:
```bash
nano /opt/arma3-session-bridge/.env
# Change ADMIN_PASSWORD=...
docker compose restart api
```

Sessions signed with the old password become invalid immediately.
