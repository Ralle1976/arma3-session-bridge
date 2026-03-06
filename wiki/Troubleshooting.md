# Troubleshooting Guide (English)

## Quick Diagnostic Checklist

Before diving into specific issues, run through this checklist:

- [ ] Is the tray icon **green**? (VPN connected)
- [ ] Is the API reachable? `curl http://YOUR_SERVER_IP:8001/health`
- [ ] Was the app started as **Administrator**?
- [ ] Is the `.conf` file valid? (Setup wizard validates it)
- [ ] Is port `51820/udp` **outbound** allowed?

---

## VPN Connection Issues

### Issue: VPN won't connect — tray icon stays red

**Possible causes and solutions:**

| Cause | Solution |
|-------|----------|
| Not running as administrator | Right-click → "Run as administrator" |
| Invalid `.conf` file | Reinstall and select a valid `.conf` file |
| Server unreachable | `ping YOUR_SERVER_IP` — if fails, check VPS status |
| UDP 51820 blocked | Try mobile hotspot; contact network admin |
| WireGuard driver error | Restart Windows; reinstall application |
| Antivirus interference | Add app exception in antivirus settings |

**Diagnostic commands:**
```cmd
# Test server reachability (Command Prompt)
ping YOUR_SERVER_IP

# Test API health
curl http://YOUR_SERVER_IP:8001/health

# Check if WireGuard service exists
sc query type= all | findstr WireGuard
```

### Issue: VPN connects then drops randomly

**Cause:** Windows power management shutting down the network adapter.

**Fix:**
1. Open **Device Manager** (Win + X → Device Manager)
2. Expand **Network adapters**
3. Right-click your adapter → **Properties**
4. Go to **Power Management** tab
5. Uncheck **"Allow the computer to turn off this device to save power"**
6. Click OK

Also disable sleep/hibernate while playing:
- Settings → System → Power & sleep → set to "Never"

### Issue: WireGuard tunnel service fails to install

**Symptoms:** Error during installation mentioning "service" or "driver"

**Fix:**
```cmd
:: Run as Administrator in Command Prompt
sc stop WireGuardTunnel$arma3-session-bridge
sc delete WireGuardTunnel$arma3-session-bridge
```

Then reinstall the application as administrator.

### Issue: Connected but can't reach 10.8.0.1 (gateway)

**Diagnostic:**
```cmd
ping 10.8.0.1
# Should respond if VPN is working
```

**If not responding:**
1. Check WireGuard config — `AllowedIPs` must include `10.8.0.0/24`
2. Verify the endpoint IP matches the server: `YOUR_SERVER_IP:51820`
3. Check server logs: `docker logs arma3-wireguard --tail 50`

---

## Session Issues

### Issue: My session doesn't appear in the list

**Checklist:**
1. VPN is connected (green icon)?
2. Did you click "Host Session" in the app?
3. Click "Refresh" in the session list
4. Wait 30 seconds (list auto-refreshes)
5. Check API: `curl http://YOUR_SERVER_IP:8001/sessions`

**If API returns empty list but you're hosting:**
- The heartbeat may have failed
- Disconnect and reconnect VPN, then host again

### Issue: Session disappears while I'm hosting

**Cause:** Heartbeat stopped (app minimized & Windows restricted background, sleep mode, network drop)

**Prevention:**
- Keep the Arma 3 Session Bridge app **visible** (not just system tray)
- Disable sleep mode while hosting
- Check Windows battery saver settings (disables background apps)

**Settings → System → Battery → Battery saver settings:**
- Turn off "Lower screen brightness when in battery saver"
- Or plug in laptop

### Issue: Players can join but then get disconnected

**Likely cause:** The host's tunnel connection is unstable.

**Fix:**
1. Add `PersistentKeepalive = 25` to the host's `.conf` file `[Peer]` section
2. Check host network stability

---

## Arma 3 Connection Issues

### Issue: "Unable to connect" in Arma 3 Direct Connect

**Complete checklist:**

```
1. VPN connected? (green tray icon)
2. Correct tunnel IP? (check session list — format: 10.8.0.X)
3. Port 2302? (Arma 3 default, enter in Direct Connect dialog)
4. Arma 3 Windows Firewall exception added?
5. Host's Arma 3 server actually started?
6. Host's antivirus allows Arma 3?
```

**Add Arma 3 Windows Firewall exception:**
1. Open **Windows Defender Firewall with Advanced Security**
2. Left panel: **Inbound Rules** → **New Rule**
3. Program rule → browse to `arma3_x64.exe`
   (usually: `C:\Program Files (x86)\Steam\steamapps\common\Arma 3\arma3_x64.exe`)
4. Allow connection → all profiles (Domain, Private, Public)

### Issue: High ping / rubber-banding in game

**Expected:** VPN adds 10–30 ms. All players share the same VPN server latency.

**If ping is unusually high (>100 ms):**
1. Check server load: `http://YOUR_SERVER_IP:8090` → Dashboard → Stats
2. Check your upload bandwidth (WireGuard game traffic uses upload on host)
3. Run `ping 10.8.0.1` — if >50 ms, your internet or the VPS is the bottleneck

---

## Admin Dashboard Issues

### Issue: Can't log in (wrong password)

**Cause:** `ADMIN_PASSWORD` mismatch.

**Fix on server:**
```bash
cat /opt/arma3-session-bridge/.env | grep ADMIN_PASSWORD
```

If you need to change it:
```bash
nano /opt/arma3-session-bridge/.env
# Update ADMIN_PASSWORD=...
docker compose restart api
```

### Issue: Dashboard shows "0 Active Peers" but players are connected

**Cause:** API is showing database count, not live WireGuard status.

**Note:** Peer status in the dashboard reflects database state, not real-time WireGuard connections. Use `docker exec arma3-wireguard wg show` on the server for live WireGuard status.

---

## Server-Side Diagnostics

### Check all container status

```bash
docker compose -f /opt/arma3-session-bridge/docker-compose.yml ps
```

### View API logs

```bash
docker logs arma3-api --tail 100 -f
```

### View WireGuard logs

```bash
docker logs arma3-wireguard --tail 100
```

### View live WireGuard peer status

```bash
docker exec arma3-wireguard wg show
```

### Restart a specific service

```bash
docker compose restart api     # Restart API
docker compose restart wireguard  # Restart WireGuard
```

### Restart all services

```bash
cd /opt/arma3-session-bridge
docker compose restart
```

---

## Getting Help

1. Check this page first
2. Read the [FAQ](FAQ)
3. Check [GitHub Issues](https://github.com/YourGitHubUser/arma3-session-bridge/issues)
4. Open a new issue with:
   - Client log file: `%APPDATA%\arma3-session-bridge\logs\`
   - Server API logs: `docker logs arma3-api --tail 200`
   - Description of what you tried
