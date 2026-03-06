/// vpn.rs — Windows WireGuard CLI automation for Arma 3 Session Bridge
///
/// Uses wireguard.exe CLI to manage the VPN tunnel:
///   wireguard.exe /installtunnelservice <path-to-conf>
///   wireguard.exe /uninstalltunnelservice <tunnel-name>
///   wireguard.exe /dumplog
///
/// Tunnel config uses Split-Tunnel: AllowedIPs = 10.8.0.0/24 only

use std::process::Command;

/// Install a WireGuard tunnel as a Windows service (requires admin privileges).
///
/// # Arguments
/// * `conf_path` – Absolute path to the WireGuard `.conf` file,
///   e.g. `C:\ProgramData\WireGuard\arma3-session-bridge.conf`
///
/// # Errors
/// Returns an error string if the process cannot be started or exits non-zero.
pub fn install_tunnel_service(conf_path: &str) -> Result<(), String> {
    if conf_path.is_empty() {
        return Err("conf_path must not be empty".to_string());
    }

    let status = Command::new("wireguard.exe")
        .args(["/installtunnelservice", conf_path])
        .status()
        .map_err(|e| format!("Failed to run wireguard.exe: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "wireguard.exe /installtunnelservice exited with: {:?}",
            status.code()
        ))
    }
}

/// Uninstall an existing WireGuard tunnel service (requires admin privileges).
///
/// # Arguments
/// * `tunnel_name` – Name of the tunnel, e.g. `arma3-session-bridge`
///   (must match the `.conf` filename without extension)
///
/// # Errors
/// Returns an error string if the process cannot be started or exits non-zero.
pub fn uninstall_tunnel_service(tunnel_name: &str) -> Result<(), String> {
    if tunnel_name.is_empty() {
        return Err("tunnel_name must not be empty".to_string());
    }

    let status = Command::new("wireguard.exe")
        .args(["/uninstalltunnelservice", tunnel_name])
        .status()
        .map_err(|e| format!("Failed to run wireguard.exe: {e}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!(
            "wireguard.exe /uninstalltunnelservice exited with: {:?}",
            status.code()
        ))
    }
}

/// Check whether a WireGuard tunnel service is currently running.
///
/// Uses `sc.exe query WireGuardTunnel$<name>` and looks for the RUNNING state.
/// Returns `false` if the service is stopped, not found, or if `sc.exe` fails.
pub fn is_tunnel_running(tunnel_name: &str) -> bool {
    if tunnel_name.is_empty() {
        return false;
    }

    let service_name = format!("WireGuardTunnel${tunnel_name}");

    match Command::new("sc.exe")
        .args(["query", &service_name])
        .output()
    {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout.contains("RUNNING")
        }
        Err(_) => false,
    }
}

/// Dump WireGuard kernel log for diagnostics.
///
/// Calls `wireguard.exe /dumplog` and returns the output as a string.
pub fn dump_log() -> Result<String, String> {
    let output = Command::new("wireguard.exe")
        .arg("/dumplog")
        .output()
        .map_err(|e| format!("Failed to run wireguard.exe: {e}"))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_install_tunnel_rejects_empty_path() {
        let result = install_tunnel_service("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must not be empty"));
    }

    #[test]
    fn test_uninstall_tunnel_rejects_empty_name() {
        let result = uninstall_tunnel_service("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("must not be empty"));
    }

    #[test]
    fn test_is_tunnel_running_empty_returns_false() {
        assert!(!is_tunnel_running(""));
    }

    #[test]
    fn test_service_name_format() {
        let tunnel_name = "arma3-session-bridge";
        let service_name = format!("WireGuardTunnel${tunnel_name}");
        assert_eq!(service_name, "WireGuardTunnel$arma3-session-bridge");
    }

    #[test]
    fn test_is_tunnel_running_nonexistent_returns_false() {
        // A definitely nonexistent tunnel must not panic — it returns false
        let result = is_tunnel_running("definitely-nonexistent-tunnel-xyz");
        assert!(!result);
    }
}
