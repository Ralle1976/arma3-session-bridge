# Fehlerbehebung (Deutsch)

## Schnell-Diagnose-Checkliste

Bevor du spezifische Probleme untersuchst, diese Checkliste abarbeiten:

- [ ] Ist das Tray-Symbol **grün**? (VPN verbunden)
- [ ] Ist die API erreichbar? `curl http://212.227.54.229:8001/health`
- [ ] Wurde die App als **Administrator** gestartet?
- [ ] Ist die `.conf` Datei gültig? (Setup-Assistent prüft das)
- [ ] Ist Port `51820/udp` für ausgehende Verbindungen erlaubt?

---

## VPN-Verbindungsprobleme

### Problem: VPN verbindet sich nicht — Tray-Symbol bleibt rot

**Mögliche Ursachen und Lösungen:**

| Ursache | Lösung |
|---------|--------|
| Keine Admin-Rechte | Rechtsklick → "Als Administrator ausführen" |
| Ungültige `.conf` Datei | Neu installieren und gültige `.conf` Datei wählen |
| Server nicht erreichbar | `ping 212.227.54.229` — bei Fehler VPS-Status prüfen |
| UDP 51820 blockiert | Mobilen Hotspot versuchen; Netzwerkadmin kontaktieren |
| WireGuard Treiberfehler | Windows neu starten; App neu installieren |
| Antivirus-Einschränkung | App-Ausnahme in Antivirus-Einstellungen hinzufügen |

**Diagnose-Befehle:**
```cmd
# Server-Erreichbarkeit testen (Command Prompt)
ping 212.227.54.229

# API-Health prüfen
curl http://212.227.54.229:8001/health

# WireGuard-Dienst prüfen
sc query type= all | findstr WireGuard
```

### Problem: VPN verbindet sich, bricht aber zufällig ab

**Ursache:** Windows Energieverwaltung schaltet den Netzwerkadapter ab.

**Lösung:**
1. **Gerätemanager** öffnen (Win + X → Gerätemanager)
2. **Netzwerkadapter** aufklappen
3. Rechtsklick auf Adapter → **Eigenschaften**
4. Reiter **Energieverwaltung**
5. Haken bei **"Computer darf dieses Gerät ausschalten"** entfernen
6. OK klicken

Außerdem Schlafmodus deaktivieren:
- Einstellungen → System → Energieoptionen → "Nie" einstellen

### Problem: WireGuard Tunnel-Dienst kann nicht installiert werden

**Symptome:** Fehlermeldung bei der Installation über "Dienst" oder "Treiber"

**Lösung:**
```cmd
:: Als Administrator im Command Prompt ausführen
sc stop WireGuardTunnel$arma3-session-bridge
sc delete WireGuardTunnel$arma3-session-bridge
```

Dann App als Administrator neu installieren.

### Problem: Verbunden, aber 10.8.0.1 (Gateway) nicht erreichbar

**Diagnose:**
```cmd
ping 10.8.0.1
# Sollte antworten wenn VPN korrekt funktioniert
```

**Falls keine Antwort:**
1. WireGuard-Config prüfen — `AllowedIPs` muss `10.8.0.0/24` enthalten
2. Endpoint-IP prüfen: `212.227.54.229:51820`
3. Server-Logs prüfen: `docker logs arma3-wireguard --tail 50`

---

## Session-Probleme

### Problem: Meine Session erscheint nicht in der Liste

**Checkliste:**
1. VPN verbunden? (grünes Symbol)
2. „Session hosten" in der App geklickt?
3. „Aktualisieren" in der Session-Liste klicken
4. 30 Sekunden warten (automatische Aktualisierung)
5. API prüfen: `curl http://212.227.54.229:8001/sessions`

**Falls API leere Liste zurückgibt obwohl du hostest:**
- Heartbeat könnte fehlgeschlagen sein
- VPN trennen und neu verbinden, dann erneut hosten

### Problem: Session verschwindet während des Hostens

**Ursache:** Heartbeat gestoppt (App minimiert und Windows schränkte Hintergrundprozesse ein, Schlafmodus, Netzwerkabbruch)

**Vorbeugung:**
- Arma 3 Session Bridge App **sichtbar** lassen (nicht nur Tray-Symbol)
- Schlafmodus während des Hostens deaktivieren
- Windows Batterie-Sparmodus-Einstellungen prüfen

**Einstellungen → System → Akku → Energiesparmodus:**
- „Bildschirmhelligkeit im Energiesparmodus verringern" deaktivieren
- Oder Laptop anschließen

### Problem: Spieler können beitreten, werden dann aber getrennt

**Wahrscheinliche Ursache:** Die Tunnel-Verbindung des Hosts ist instabil.

**Lösung:**
1. `PersistentKeepalive = 25` zum `[Peer]` Abschnitt der Host-`.conf` Datei hinzufügen
2. Netzwerk-Stabilität des Hosts prüfen

---

## Arma 3 Verbindungsprobleme

### Problem: „Verbindung nicht möglich" bei Arma 3 Direktverbindung

**Vollständige Checkliste:**

```
1. VPN verbunden? (grünes Tray-Symbol)
2. Richtige Tunnel-IP? (Session-Liste prüfen — Format: 10.8.0.X)
3. Port 2302? (Arma 3 Standard, im Direktverbindungs-Dialog eingeben)
4. Arma 3 Windows-Firewall-Ausnahme hinzugefügt?
5. Host hat Arma 3 Server tatsächlich gestartet?
6. Antivirus des Hosts erlaubt Arma 3?
```

**Arma 3 Windows-Firewall-Ausnahme hinzufügen:**
1. **Windows Defender Firewall mit erweiterter Sicherheit** öffnen
2. Linkes Panel: **Eingehende Regeln** → **Neue Regel**
3. Programmregel → zu `arma3_x64.exe` navigieren
   (meist: `C:\Program Files (x86)\Steam\steamapps\common\Arma 3\arma3_x64.exe`)
4. Verbindung zulassen → alle Profile (Domäne, Privat, Öffentlich)

### Problem: Hoher Ping / Rubber-Banding im Spiel

**Erwartet:** VPN fügt 10–30 ms hinzu. Alle Spieler teilen die gleiche VPN-Server-Latenz.

**Bei ungewöhnlich hohem Ping (>100 ms):**
1. Server-Last prüfen: `http://212.227.54.229:8090` → Dashboard → Stats
2. Upload-Bandbreite prüfen (WireGuard Spiel-Traffic nutzt Upload beim Host)
3. `ping 10.8.0.1` ausführen — bei >50 ms ist Internet oder VPS der Engpass

---

## Admin-Dashboard Probleme

### Problem: Kann mich nicht anmelden (falsches Passwort)

**Ursache:** `ADMIN_PASSWORD` stimmt nicht überein.

**Lösung auf dem Server:**
```bash
cat /opt/arma3-session-bridge/.env | grep ADMIN_PASSWORD
```

Falls Änderung nötig:
```bash
nano /opt/arma3-session-bridge/.env
# ADMIN_PASSWORD=... aktualisieren
docker compose restart api
```

---

## Server-Diagnose

### Alle Container-Status prüfen

```bash
docker compose -f /opt/arma3-session-bridge/docker-compose.yml ps
```

### API-Logs anzeigen

```bash
docker logs arma3-api --tail 100 -f
```

### WireGuard-Logs anzeigen

```bash
docker logs arma3-wireguard --tail 100
```

### Live WireGuard Peer-Status

```bash
docker exec arma3-wireguard wg show
```

### Einzelnen Service neu starten

```bash
docker compose restart api       # API neu starten
docker compose restart wireguard # WireGuard neu starten
```

### Alle Services neu starten

```bash
cd /opt/arma3-session-bridge
docker compose restart
```

---

## Hilfe erhalten

1. Diese Seite zuerst lesen
2. [FAQ](FAQ-DE) lesen
3. [GitHub Issues](https://github.com/Ralle1976/arma3-session-bridge/issues) prüfen
4. Neues Issue erstellen mit:
   - Client-Log-Datei: `%APPDATA%\arma3-session-bridge\logs\`
   - Server-API-Logs: `docker logs arma3-api --tail 200`
   - Beschreibung was du versucht hast
