#!/bin/bash
# WireGuard Key Generation Script
# Runs as linuxserver/wireguard custom init — generates keys only on first start.
# NO hardcoded secrets. Keys are generated at runtime and stored in /config.

set -e

WG_DIR="/config/wg_confs"
SERVER_KEY_FILE="/config/server_privatekey"
SERVER_PUB_FILE="/config/server_publickey"
WG_CONF="${WG_DIR}/wg0.conf"

# Ensure wg tools are available
if ! command -v wg &>/dev/null; then
    echo "[arma3] ERROR: wg command not found — cannot generate keys."
    exit 0
fi

# Only generate if private key does not exist yet
if [ ! -f "${SERVER_KEY_FILE}" ]; then
    echo "[arma3] First start detected — generating WireGuard server keys..."
    mkdir -p "${WG_DIR}"

    # Generate server keypair
    SERVER_PRIVATE=$(wg genkey)
    SERVER_PUBLIC=$(echo "${SERVER_PRIVATE}" | wg pubkey)

    echo "${SERVER_PRIVATE}" > "${SERVER_KEY_FILE}"
    echo "${SERVER_PUBLIC}"  > "${SERVER_PUB_FILE}"
    chmod 600 "${SERVER_KEY_FILE}"

    echo "[arma3] Server public key: ${SERVER_PUBLIC}"
    echo "[arma3] Keys stored in /config — never commit these to git!"
else
    SERVER_PRIVATE=$(cat "${SERVER_KEY_FILE}")
    SERVER_PUBLIC=$(cat "${SERVER_PUB_FILE}")
    echo "[arma3] Existing WireGuard keys loaded."
    echo "[arma3] Server public key: ${SERVER_PUBLIC}"
fi

# Write wg0.conf only if it doesn't exist yet
if [ ! -f "${WG_CONF}" ]; then
    echo "[arma3] Writing initial wg0.conf (Split-Tunnel: 10.8.0.0/24)..."

    WG_SERVER_IP="${WG_SERVER_IP:-10.8.0.1}"
    WG_PORT="${WG_PORT:-51820}"

    cat > "${WG_CONF}" <<EOF
[Interface]
Address = ${WG_SERVER_IP}/24
ListenPort = ${WG_PORT}
PrivateKey = ${SERVER_PRIVATE}

# Split-Tunnel: only route 10.8.0.0/24 through the VPN
# Peer configs are added via the API (POST /peers)
# AllowedIPs per peer = 10.8.0.X/32
EOF

    chmod 600 "${WG_CONF}"
    echo "[arma3] wg0.conf written."
else
    echo "[arma3] wg0.conf already exists — skipping creation."
fi
