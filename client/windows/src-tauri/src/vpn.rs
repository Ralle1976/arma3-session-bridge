//! vpn.rs — VPN connection management using embedded WireGuard tunnel
//!
//! On Windows: uses boringtun + wintun (see tunnel.rs) — no wireguard.exe needed.
//! On other platforms: stub implementations that return errors/disconnected state.
//! The VPN state machine (vpn_state.rs) is platform-independent.

use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use crate::tunnel::{self, EmbeddedTunnel, TunnelStats};

/// Global tunnel instance — only meaningful on Windows.
#[cfg(target_os = "windows")]
static TUNNEL: Mutex<Option<EmbeddedTunnel>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpnStatus {
    pub connected: bool,
    pub tunnel_ip: Option<String>,
    pub tunnel_name: Option<String>,
}

// ── Windows implementations ───────────────────────────────────────────────────

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
pub fn disconnect_vpn(_tunnel_name: &str) -> Result<(), String> {
    let mut lock = TUNNEL.lock().map_err(|e| format!("Lock error: {e}"))?;
    if let Some(mut tunnel) = lock.take() {
        tunnel.stop()?;
    }
    Ok(())
}

/// Scan network adapters for a 10.8.0.x address (works for both embedded wintun
/// and official WireGuard adapters). Used as fallback when embedded tunnel is not
/// running but the system WireGuard client may be active.
#[cfg(target_os = "windows")]
fn scan_adapters_for_vpn_ip() -> Option<String> {
    use std::os::windows::process::CommandExt;
    let output = std::process::Command::new("ipconfig")
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    for line in text.lines() {
        let t = line.trim();
        // Match EN: "IPv4 Address. . . : 10.8.0.x" and DE: "IPv4-Adresse"
        if (t.starts_with("IPv4") || t.starts_with("IP-Adresse")) && t.contains(':') {
            if let Some(ip_part) = t.splitn(2, ':').nth(1) {
                let ip = ip_part.trim()
                    .trim_end_matches("(Preferred)")
                    .trim_end_matches("(Bevorzugt)")
                    .trim();
                if ip.starts_with("10.8.0.") && ip.len() <= 12 {
                    return Some(ip.to_string());
                }
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
pub fn check_vpn_status(tunnel_name: &str) -> Result<VpnStatus, String> {
    if tunnel_name.is_empty() {
        return Err("tunnel_name must not be empty".to_string());
    }
    // ── 1. Embedded tunnel (boringtun + wintun) ─────────────────────────────
    let lock = TUNNEL.lock().map_err(|e| format!("Lock error: {e}"))?;
    if let Some(tunnel) = &*lock {
        if tunnel.is_connected() {
            return Ok(VpnStatus {
                connected: true,
                tunnel_ip: Some(tunnel.tunnel_ip().to_string()),
                tunnel_name: Some(tunnel_name.to_string()),
            });
        }
    }
    drop(lock);
    // ── 2. Fallback: official WireGuard service (WireGuardTunnel$<name>) ─────
    // Installed WireGuard registers a Windows service with this exact naming.
    use std::os::windows::process::CommandExt;
    let svc = format!("WireGuardTunnel${}", tunnel_name);
    let system_running = std::process::Command::new("sc")
        .args(["query", &svc])
        .creation_flags(0x08000000)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("RUNNING"))
        .unwrap_or(false);
    if system_running {
        return Ok(VpnStatus {
            connected: true,
            tunnel_ip: scan_adapters_for_vpn_ip(),
            tunnel_name: Some(tunnel_name.to_string()),
        });
    }
    Ok(VpnStatus {
        connected: false,
        tunnel_ip: None,
        tunnel_name: Some(tunnel_name.to_string()),
    })
}

#[cfg(target_os = "windows")]
pub fn get_tunnel_ip() -> Result<String, String> {
    // 1. Embedded tunnel
    let lock = TUNNEL.lock().map_err(|e| format!("Lock error: {e}"))?;
    if let Some(tunnel) = &*lock {
        if tunnel.is_connected() {
            return Ok(tunnel.tunnel_ip().to_string());
        }
    }
    drop(lock);
    // 2. Fallback: scan all network adapters for a 10.8.0.x address
    scan_adapters_for_vpn_ip().ok_or_else(|| "Kein aktiver VPN-Tunnel".to_string())
}

#[cfg(target_os = "windows")]
pub fn get_tunnel_stats() -> Option<TunnelStats> {
    let lock = TUNNEL.lock().ok()?;
    lock.as_ref().map(|t| t.get_stats())
}

/// Dump tunnel stats for diagnostics (replaces wireguard.exe /dumplog).
#[cfg(target_os = "windows")]
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

// ── Non-Windows stubs (compile-time only — enable cross-platform tests) ───────

#[cfg(not(target_os = "windows"))]
pub fn connect_vpn(conf_path: &str) -> Result<(), String> {
    // Read and validate config even on non-Windows (shared validation logic)
    let content = std::fs::read_to_string(conf_path)
        .map_err(|e| format!("Config-Datei kann nicht gelesen werden: {e}"))?;
    if content.trim().is_empty() {
        return Err("Config-Datei ist leer".to_string());
    }
    if content.contains("<INSERT_PRIVATE_KEY_FROM_CREATION_RESPONSE>") {
        return Err("Config-Datei enthält noch den PrivateKey-Platzhalter".to_string());
    }
    Err("VPN tunnel not supported on this platform".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn disconnect_vpn(_tunnel_name: &str) -> Result<(), String> {
    Ok(()) // idempotent no-op
}

#[cfg(not(target_os = "windows"))]
pub fn check_vpn_status(tunnel_name: &str) -> Result<VpnStatus, String> {
    if tunnel_name.is_empty() {
        return Err("tunnel_name must not be empty".to_string());
    }
    Ok(VpnStatus {
        connected: false,
        tunnel_ip: None,
        tunnel_name: Some(tunnel_name.to_string()),
    })
}

#[cfg(not(target_os = "windows"))]
pub fn get_tunnel_ip() -> Result<String, String> {
    Err("Kein aktiver VPN-Tunnel".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn get_tunnel_stats() -> Option<()> {
    None
}

#[cfg(not(target_os = "windows"))]
pub fn dump_log() -> Result<String, String> {
    Ok("No active embedded WireGuard tunnel (non-Windows build)".to_string())
}

// ── Unit tests ────────────────────────────────────────────────────────────────

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

    #[test]
    fn test_connect_vpn_missing_conf_returns_err() {
        let result = connect_vpn("Z:\\definitely\\missing\\arma3-session-bridge.conf");
        assert!(result.is_err(), "Missing config path must return a user-facing error");
    }
}
