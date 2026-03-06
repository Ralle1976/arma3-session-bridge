# FAQ — Häufig gestellte Fragen (Deutsch)

## Allgemein

**F: Ist die Software kostenlos?**

A: Ja. Die Software ist Open-Source. Du zahlst nur für den VPS — ca. 4–8 €/Monat bei IONOS für den kleinsten Plan, der für eine private Gruppe von Freunden ausreicht.

---

**F: Was ist der Unterschied zu einfachen Router-Portfreigaben?**

A: Drei entscheidende Vorteile:
1. **Kein Router-Zugang nötig** — funktioniert hinter CGNAT, Firewalls, Schulnetzwerken
2. **Dauerhaft verfügbarer Server** — der VPS ist immer erreichbar; Spieler müssen die Heim-IP des Hosts nicht kennen
3. **Session-Entdeckung** — die App zeigt alle verfügbaren Sessions in einer Liste an

---

**F: Beeinträchtigt das meinen Internet-Speed?**

A: Nur Arma 3 VPN-Traffic läuft durch den Tunnel (Split-Tunnel). Normales Surfen, Discord, Streaming — alles völlig unbeeinträchtigt. Kein Unterschied für Nicht-Spiel-Traffic.

---

**F: Wie viele gleichzeitige Spieler werden unterstützt?**

A: Technisch unbegrenzt. Praktisch:
- IONOS Cloud XS (1 vCore, 1 GB RAM, 100 Mbit/s): Komfortabel für 8–12 Spieler
- IONOS Cloud S (2 vCore, 4 GB RAM, 200 Mbit/s): Komfortabel für 20–32 Spieler
- Größere Pläne für 40+ Spieler

---

**F: Sind meine Arma 3 Daten sicher?**

A: Der VPN verschlüsselt den gesamten Spiel-Traffic (WireGuard verwendet ChaCha20-Poly1305). Der VPS-Besitzer sieht Metadaten wie Verbindungszeiten und Session-Infos, aber keinen tatsächlichen Spielinhalt. Das Admin-Dashboard zeigt nur Peer-Namen, Session-Namen und Statistiken.

---

## Technisches

**F: Warum braucht der Installer Administrator-Rechte?**

A: WireGuard installiert einen Windows Kernel-Treiber (`wireguard.sys`). Die Kernel-Treiber-Installation erfordert Administrator-Rechte. Das ist eine einmalige Anforderung.

---

**F: Welche Ports muss der Client öffnen?**

A: Nur **ausgehend UDP 51820** muss erlaubt sein. Es müssen keine eingehenden Ports auf dem Spieler-PC geöffnet werden.

---

**F: Kann ich den WireGuard-Port ändern (wenn 51820 gesperrt ist)?**

A: Ja. Auf dem Server `WG_PORT` in `.env` ändern und neu starten. Spieler brauchen neue `.conf` Dateien mit dem aktualisierten `Endpoint`-Port.

Häufige Alternativ-Ports: `443` (HTTPS-ähnlich), `53` (DNS-ähnlich), `4500` (IPSec NAT-T)

---

**F: Funktioniert das mit WLAN und mobilem Hotspot?**

A: Ja. Jede Internetverbindung die ausgehend UDP erlaubt funktioniert. Mobile Hotspots sind eine hervorragende Alternative wenn Unternehmens- oder Schulnetzwerke UDP 51820 sperren.

---

**F: Kann ich den Server auf meinem Heim-PC betreiben statt auf einem VPS?**

A: Technisch möglich wenn du eine statische öffentliche IP hast. Jedoch wird ein VPS dringend empfohlen:
- Heim-IP muss stabil sein (ändert sich bei Router-Neustart)
- Port 51820/udp muss im Router geöffnet sein
- Heim-PC muss 24/7 laufen

---

**F: Was passiert mit Sessions wenn der VPS neu startet?**

A: Docker ist mit `restart: unless-stopped` konfiguriert. Nach einem VPS-Neustart starten alle Services automatisch. Laufende Sessions gehen verloren, aber der VPN verbindet sich automatisch neu für alle Clients mit `PersistentKeepalive = 25` in ihrer `.conf`.

---

## Hosten

**F: Muss ich die App während des Hostens offen lassen?**

A: Ja. Die App sendet alle 60 Sekunden einen Heartbeat. Ohne Heartbeat wird die Session nach 5 Minuten automatisch aus der Liste entfernt. Im Tray minimieren ist OK — nur nicht schließen.

---

**F: Kann ich hosten ohne der Arma 3 Spielserver zu sein?**

A: Nein. Der "Host" in Arma 3 Session Bridge betreibt auch den Arma 3 Spielserver. Die Bridge registriert deine VPN Tunnel-IP damit andere Spieler sie finden und sich verbinden können. Wenn du nur beitreten möchtest, musst du keine Session hosten.

---

**F: Können mehrere Spieler gleichzeitig hosten?**

A: Ja. Mehrere Sessions können gleichzeitig auf verschiedenen VPN-IPs laufen.

---

**F: Wie erfahren Spieler meine VPN-IP?**

A: Automatisch! Wenn du auf „Session hosten" klickst, wird deine Tunnel-IP in der Session-Liste der Bridge registriert. Andere Spieler sehen sie innerhalb von 30 Sekunden. Sie klicken „Beitreten" und die IP wird in die Zwischenablage kopiert.

---

**F: Welche Mission-Dateien brauchen Spieler?**

A: Die Bridge übernimmt nur VPN-Verbindungen — kein Spiel-Content. Spieler brauchen dieselben Mission-Dateien und Mods wie der Host, genau wie im normalen Arma 3 Multiplayer. Mission-Dateien via Steam Workshop oder Datei-Transfer teilen wie gewohnt.

---

## Arma 3 spezifisch

**F: Welche Arma 3 Verbindungsmethode verwenden?**

A: **Multiplayer → Direkt verbinden** mit:
- **IP:** Tunnel-IP des Hosts (z.B. `10.8.0.2`)
- **Port:** `2302` (Arma 3 Standard)

---

**F: Funktionieren Steam Mods / Workshop-Inhalte?**

A: Ja. Der VPN ist rein auf Transport-Ebene. Mods, Mission-Dateien, DLC — alles funktioniert normal. Alle müssen dieselben Mods geladen haben.

---

**F: Funktioniert Zeus / Game Master?**

A: Ja. Alle Arma 3 Funktionen funktionieren normal über den VPN.

---

**F: Funktioniert Join-in-Progress (JIP)?**

A: Ja, wenn die Mission JIP erlaubt. Die Bridge hat keine Einschränkungen beim Beitreten.

---

## Admin

**F: Wie füge ich einen neuen Spieler hinzu?**

A: Im Admin-Dashboard:
1. Anmelden unter `http://YOUR_SERVER_IP:8090`
2. Zu „Peers" gehen
3. „+ Peer hinzufügen" klicken
4. Spieler-Namen eingeben
5. `.conf` Datei herunterladen und sicher weitergeben

---

**F: Wie entferne/sperre ich einen Spieler?**

A: Im Admin-Dashboard unter „Peers" auf das Mülleimer-Symbol klicken. Der VPN-Zugang des Peers wird sofort entzogen — er kann sich nicht mehr mit der vorhandenen `.conf` Datei verbinden.

---

**F: Kann ich sehen wer gerade mit dem VPN verbunden ist?**

A: Ja — zwei Möglichkeiten:
1. Admin-Dashboard → Peers-Bereich (zeigt zuletzt gesehen Zeiten)
2. Server-Befehl: `docker exec arma3-wireguard wg show`

---

**F: Wie setze ich das Admin-Passwort zurück?**

A: `.env` Datei auf dem Server bearbeiten:
```bash
nano /opt/arma3-session-bridge/.env
# ADMIN_PASSWORD=... ändern
docker compose restart api
```

Sessions die mit dem alten Passwort signiert wurden werden sofort ungültig.

---

**F: Kann ich mehrere Admins haben?**

A: In der aktuellen Version (1.0.0) gibt es nur einen Admin-Account (ADMIN_PASSWORD). Multi-Admin-Unterstützung ist für eine zukünftige Version geplant.
