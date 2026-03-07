#!/bin/bash
echo "[iptables] Setze Arma 3 Firewall-Regeln..."
iptables -F FORWARD
for PORT in 2302 2303 2304 2305 2344 2345; do
    iptables -A FORWARD -i wg0 -o wg0 -p udp --dport $PORT -j ACCEPT
done
iptables -A FORWARD -i wg0 -o wg0 -j DROP
echo "[iptables] Arma 3 Modus aktiv (nur UDP 2302-2305 + BattlEye)"
