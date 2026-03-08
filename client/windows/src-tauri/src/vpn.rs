/// vpn.rs — Windows WireGuard CLI automation for Arma 3 Session Bridge
///
/// Uses wireguard.exe CLI to manage the VPN tunnel:
///   wireguard.exe /installtunnelservice <path-to-conf>
///   wireguard.exe /uninstalltunnelservice <tunnel-name>
///   wireguard.exe /dumplog
///
/// Tunnel config uses Split-Tunnel: AllowedIPs = 10.8.0.0/24 only

use std::path::Path;
use std::process::Command;
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};

// CREATE_NO_WINDOW — prevents console window flashing when spawning child processes
const CREATE_NO_WINDOW: u32 = 0x08000000;

// ─── Structs ───────────────────────────────────────────────────────────────────

/// Current state of the WireGuard tunnel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VpnStatus {
    /// Whether the tunnel service is currently in RUNNING state.
    pub connected: bool,
    /// Assigned IP inside the tunnel (e.g. `10.8.0.2`), if connected.
    pub tunnel_ip: Option<String>,
    /// Name of the tunnel (conf filename without .conf extension).
    pub tunnel_name: Option<String>,
}

// ─── High-level API (used by Tauri commands) ──────────────────────────────────

/// Connect: install the WireGuard tunnel service.
///
/// Derives the tunnel name from the `.conf` filename (basename without extension).
///
/// # Arguments
/// * `conf_path` – Absolute Windows path to the WireGuard `.conf` file,
///   e.g. `C:\ProgramData\WireGuard\arma3-session-bridge.conf`
///
/// # Errors
/// Returns an error string if WireGuard is not installed, the path is invalid,
/// or `wireguard.exe` exits non-zero.
pub fn connect_vpn(conf_path: &str) -> Result<(), String> {
    install_wireguard_if_missing()?;
    install_tunnel_service(conf_path)?;

    let start = std::time::Instant::now();
    while start.elapsed() < std::time::Duration::from_secs(8) {
        if get_tunnel_ip().is_ok() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(350));
    }

    Err("WireGuard-Dienst gestartet, aber keine Tunnel-IP gefunden. Bitte Endpoint/Firewall prüfen.".to_string())
}

/// Disconnect: uninstall the WireGuard tunnel service.
///
/// # Arguments
/// * `tunnel_name` – Name of the tunnel, e.g. `arma3-session-bridge`.
///
/// # Errors
/// Returns an error string if `wireguard.exe` is not found or exits non-zero.
pub fn disconnect_vpn(tunnel_name: &str) -> Result<(), String> {
    uninstall_tunnel_service(tunnel_name)
}

/// Query the current status of a named WireGuard tunnel.
///
/// Returns a [`VpnStatus`] with `connected = true` if the Windows service
/// `WireGuardTunnel$<tunnel_name>` is in RUNNING state, plus the assigned
/// tunnel IP if available.
///
/// # Arguments
/// * `tunnel_name` – Name of the tunnel, e.g. `arma3-session-bridge`.
///
/// # Errors
/// Returns an error string only if `tunnel_name` is empty.
pub fn check_vpn_status(tunnel_name: &str) -> Result<VpnStatus, String> {
    if tunnel_name.is_empty() {
        return Err("tunnel_name must not be empty".to_string());
    }

    let running = is_tunnel_running(tunnel_name);

    let tunnel_ip = if running {
        // Best-effort: ignore if netsh fails (e.g. in tests)
        get_tunnel_ip().ok()
    } else {
        None
    };

    let connected = running && tunnel_ip.is_some();

    Ok(VpnStatus {
        connected,
        tunnel_ip,
        tunnel_name: Some(tunnel_name.to_string()),
    })
}

/// Verify that WireGuard is installed on this machine.
///
/// Checks for the WireGuard executable at its default Windows install path.
/// Returns `Ok(())` if found, or an `Err` with an install URL if not.
pub fn install_wireguard_if_missing() -> Result<(), String> {
    if wireguard_is_present() {
        return Ok(());
    }

    // Not found — attempt silent auto-install (same as NSIS hook, but as in-app fallback)
    let ps = r#"
$url = 'https://download.wireguard.com/windows-client/wireguard-installer.exe'
$out = Join-Path $env:TEMP 'wireguard-installer.exe'
Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing
Start-Process -FilePath $out -ArgumentList '/S' -Wait
"#;

    let tmp = std::env::temp_dir().join("install-wg.ps1");
    std::fs::write(&tmp, ps)
        .map_err(|e| format!("Failed to write WireGuard install script: {e}"))?;

    let _ = Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
               tmp.to_str().unwrap_or("")])
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    let _ = std::fs::remove_file(&tmp);

    if wireguard_is_present() {
        return Ok(());
    }

    Err(
        "WireGuard konnte nicht installiert werden. Bitte manuell von https://www.wireguard.com/install/ installieren und die App neu starten."
            .to_string(),
    )
}

/// Read the current WireGuard tunnel IP from the active network interface.
///
/// Scans `netsh interface ipv4 show addresses` output for an address in the
/// `10.8.0.0/24` subnet (our Split-Tunnel range) and returns it.
///
/// # Errors
/// Returns an error if `netsh` cannot be executed or no matching address is found.
pub fn get_tunnel_ip() -> Result<String, String> {
    let output = Command::new("netsh")
        .args(["interface", "ipv4", "show", "addresses"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to run netsh: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    for line in stdout.lines() {
        let trimmed = line.trim();

        // English: "IP Address:"   German: "IP-Adresse:"   Spanish: "Dirección IP:"
        // We match any line that contains "IP" and split on ':' to extract the value.
        let lower = trimmed.to_lowercase();
        if (lower.starts_with("ip address") || lower.starts_with("ip-adresse"))
            && trimmed.contains(':')
        {
            if let Some(ip) = trimmed.splitn(2, ':').nth(1).map(str::trim) {
                if ip.starts_with("10.8.0.") && !ip.is_empty() {
                    return Ok(ip.to_string());
                }
            }
        }
    }

    Err("No WireGuard tunnel IP (10.8.0.x) found in active network interfaces".to_string())
}

// ─── Low-level CLI wrappers ────────────────────────────────────────────────────

/// Install a WireGuard tunnel as a Windows service (requires admin privileges).
///
/// # Arguments
/// * `conf_path` – Absolute path to the WireGuard `.conf` file.
///
/// # Errors
/// Returns an error string if the process cannot be started or exits non-zero.
pub fn install_tunnel_service(conf_path: &str) -> Result<(), String> {
    if conf_path.is_empty() {
        return Err("conf_path must not be empty".to_string());
    }

    // Pre-flight: verify conf file exists, is non-empty, and has no placeholder
    match std::fs::read_to_string(conf_path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!(
                "Config-Datei nicht gefunden: {conf_path}. Bitte die App neu einrichten."
            ));
        }
        Err(e) => return Err(format!("Config-Datei konnte nicht gelesen werden: {e}")),
        Ok(content) => {
            if content.trim().is_empty() {
                return Err(format!(
                    "Config-Datei ist leer: {conf_path}. Bitte die App neu einrichten."
                ));
            }
            if content.contains("<INSERT_PRIVATE_KEY_FROM_CREATION_RESPONSE>") {
                return Err(
                    "Config-Datei enthält noch den PrivateKey-Platzhalter. Bitte die App neu einrichten."
                        .to_string(),
                );
            }
        }
    }

    // Stop and delete existing service to avoid "Zugriff verweigert" error
    let tunnel_name = std::path::Path::new(conf_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("arma3-session-bridge");
    let service_name = format!("WireGuardTunnel${}", tunnel_name);

    let _ = std::process::Command::new("sc.exe")
        .args(["stop", &service_name])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    std::thread::sleep(std::time::Duration::from_millis(1500));

    let _ = std::process::Command::new("sc.exe")
        .args(["delete", &service_name])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    std::thread::sleep(std::time::Duration::from_millis(500));

    let output = Command::new(wireguard_exe_path())
        .args(["/installtunnelservice", conf_path])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to run wireguard.exe: {e}"))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let mut parts = vec![format!(
            "WireGuard Tunnel-Installation fehlgeschlagen (Exit-Code: {:?}).",
            output.status.code()
        )];
        if !stderr.is_empty() {
            parts.push(format!("Fehler: {stderr}"));
        }
        if !stdout.is_empty() {
            parts.push(format!("Ausgabe: {stdout}"));
        }
        Err(parts.join("\n"))
    }
}

/// Uninstall an existing WireGuard tunnel service (requires admin privileges).
///
/// # Arguments
/// * `tunnel_name` – Name of the tunnel (conf filename without extension).
///
/// # Errors
/// Returns an error string if the process cannot be started or exits non-zero.
pub fn uninstall_tunnel_service(tunnel_name: &str) -> Result<(), String> {
    if tunnel_name.is_empty() {
        return Err("tunnel_name must not be empty".to_string());
    }

    let status = Command::new(wireguard_exe_path())
        .args(["/uninstalltunnelservice", tunnel_name])
        .creation_flags(CREATE_NO_WINDOW)
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
        .creation_flags(CREATE_NO_WINDOW)
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
    let output = Command::new(wireguard_exe_path())
        .arg("/dumplog")
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("Failed to run wireguard.exe: {e}"))?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/// Return the full path to `wireguard.exe` on Windows.
///
/// Falls back to just `"wireguard.exe"` (PATH lookup) if the default install
/// location does not exist (e.g. during testing on Linux CI).
fn wireguard_is_present() -> bool {
    let candidates = [
        r"C:\Program Files\WireGuard\wireguard.exe",
        r"C:\Program Files (x86)\WireGuard\wireguard.exe",
    ];
    if candidates.iter().any(|p| Path::new(p).exists()) {
        return true;
    }
    // Also check PATH via where.exe
    Command::new("where.exe")
        .arg("wireguard.exe")
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn wireguard_exe_path() -> String {
    let candidates = [
        r"C:\Program Files\WireGuard\wireguard.exe",
        r"C:\Program Files (x86)\WireGuard\wireguard.exe",
    ];
    for c in &candidates {
        if Path::new(c).exists() {
            return c.to_string();
        }
    }
    "wireguard.exe".to_string() // PATH fallback
}

// ─── Tests ────────────────────────────────────────────────────────────────────

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

    #[test]
    fn test_check_vpn_status_rejects_empty() {
        let result = check_vpn_status("");
        assert!(result.is_err());
    }

    #[test]
    fn test_check_vpn_status_unknown_tunnel_not_connected() {
        let status = check_vpn_status("nonexistent-tunnel-xyz123")
            .expect("should not error on unknown tunnel name");
        assert!(!status.connected);
        assert!(status.tunnel_ip.is_none());
        assert_eq!(
            status.tunnel_name.as_deref(),
            Some("nonexistent-tunnel-xyz123")
        );
    }

    #[test]
    fn test_wireguard_exe_path_is_valid_string() {
        let path = wireguard_exe_path();
        assert!(path.contains("wireguard.exe"));
        assert!(path.contains("WireGuard") || path == "wireguard.exe");
    }

    #[test]
    fn test_vpn_status_struct_fields() {
        let status = VpnStatus {
            connected: false,
            tunnel_ip: None,
            tunnel_name: Some("test-tunnel".to_string()),
        };
        assert!(!status.connected);
        assert!(status.tunnel_ip.is_none());
        assert_eq!(status.tunnel_name.as_deref(), Some("test-tunnel"));
    }
}
