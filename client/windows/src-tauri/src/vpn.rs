//! vpn.rs — VPN connection management using embedded WireGuard tunnel
//!
//! Uses boringtun + wintun (see tunnel.rs) instead of external wireguard.exe.
//! No external WireGuard installation required.

use std::sync::Mutex;
use serde::{Deserialize, Serialize};
use crate::tunnel::{self, EmbeddedTunnel, TunnelStats};

// Global tunnel instance — thread-safe via Mutex
static TUNNEL: Mutex<Option<EmbeddedTunnel>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpnStatus {
    pub connected: bool,
    pub tunnel_ip: Option<String>,
    pub tunnel_name: Option<String>,
}

pub fn connect_vpn(conf_path: &str) -> Result<(), String> {
    // 1. Validate conf_path exists and is non-empty
    let content = std::fs::read_to_string(conf_path)
        .map_err(|e| format!("Config-Datei kann nicht gelesen werden: {e}"))?;
    if content.trim().is_empty() {
        return Err("Config-Datei ist leer".to_string());
    }
    if content.contains("<INSERT_PRIVATE_KEY_FROM_CREATION_RESPONSE>") {
        return Err("Config-Datei enthält noch den PrivateKey-Platzhalter".to_string());
    }

    // 2. Parse WireGuard config
    let config = tunnel::parse_conf(&content)?;

    // 3. Stop existing tunnel if any
    {
        let mut lock = TUNNEL.lock().map_err(|e| format!("Lock error: {e}"))?;
        if let Some(mut old) = lock.take() {
            let _ = old.stop();
        }
    }

    // 4. Start new tunnel
    let tun = EmbeddedTunnel::start(config)?;

    // 5. Wait for handshake (up to 10s)
    let start = std::time::Instant::now();
    while start.elapsed() < std::time::Duration::from_secs(10) {
        if tun.is_connected() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(350));
    }

    let mut lock = TUNNEL.lock().map_err(|e| format!("Lock error: {e}"))?;
    *lock = Some(tun);
    Ok(())
}

pub fn disconnect_vpn(_tunnel_name: &str) -> Result<(), String> {
    let mut lock = TUNNEL.lock().map_err(|e| format!("Lock error: {e}"))?;
    if let Some(mut tunnel) = lock.take() {
        tunnel.stop()?;
    }
    Ok(())
}

pub fn check_vpn_status(tunnel_name: &str) -> Result<VpnStatus, String> {
    if tunnel_name.is_empty() {
        return Err("tunnel_name must not be empty".to_string());
    }
    let lock = TUNNEL.lock().map_err(|e| format!("Lock error: {e}"))?;
    match &*lock {
        Some(tunnel) => Ok(VpnStatus {
            connected: tunnel.is_connected(),
            tunnel_ip: if tunnel.is_connected() { Some(tunnel.tunnel_ip().to_string()) } else { None },
            tunnel_name: Some(tunnel_name.to_string()),
        }),
        None => Ok(VpnStatus {
            connected: false,
            tunnel_ip: None,
            tunnel_name: Some(tunnel_name.to_string()),
        }),
    }
}

pub fn get_tunnel_ip() -> Result<String, String> {
    let lock = TUNNEL.lock().map_err(|e| format!("Lock error: {e}"))?;
    match &*lock {
        Some(tunnel) if tunnel.is_connected() => Ok(tunnel.tunnel_ip().to_string()),
        _ => Err("Kein aktiver VPN-Tunnel".to_string()),
    }
}

pub fn get_tunnel_stats() -> Option<TunnelStats> {
    let lock = TUNNEL.lock().ok()?;
    lock.as_ref().map(|t| t.get_stats())
}

/// Dump tunnel stats for diagnostics (replaces wireguard.exe /dumplog).
pub fn dump_log() -> Result<String, String> {
    match get_tunnel_stats() {
        Some(stats) => Ok(format!(
            "Embedded WireGuard tunnel stats:\n  rx_bytes: {}\n  tx_bytes: {}\n  connected: {}\n  last_handshake: {}s ago",
            stats.rx_bytes,
            stats.tx_bytes,
            stats.connected,
            stats.last_handshake
                .map(|t| t.elapsed().as_secs().to_string())
                .unwrap_or_else(|| "never".to_string()),
        )),
        None => Ok("No active embedded WireGuard tunnel".to_string()),
    }
}

// Keep tests for basic validation
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_disconnect_when_not_connected() {
        let result = disconnect_vpn("test");
        assert!(result.is_ok());
    }

    #[test]
    fn test_status_when_not_connected() {
        let status = check_vpn_status("test").unwrap();
        assert!(!status.connected);
        assert!(status.tunnel_ip.is_none());
    }

    #[test]
    fn test_status_empty_name_errors() {
        assert!(check_vpn_status("").is_err());
    }

    #[test]
    fn test_get_tunnel_ip_when_not_connected() {
        assert!(get_tunnel_ip().is_err());
    }
}
