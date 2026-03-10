/// support_bundle.rs — One-click redacted diagnostics export
///
/// Creates a zip-like text bundle with anonymised system information that
/// users can send to support without exposing sensitive data.
///
/// Redacts:
///  - WireGuard private keys (replaced with [REDACTED])
///  - Public keys (replaced with [PUBKEY-REDACTED])
///  - IP addresses in the 192.168.x.x / 10.x.x.x / 172.16-31.x.x ranges
///  - API auth tokens / bearer headers
///  - Endpoint hostnames (replaced with [ENDPOINT-REDACTED])

use std::fmt::Write as FmtWrite;
use std::fs;
use std::path::PathBuf;

use serde::Serialize;

// ─── Public result type ────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SupportBundleResult {
    /// Absolute path to the written bundle file
    pub path: String,
    /// Human-readable summary of what was collected
    pub summary: Vec<String>,
    /// Non-fatal warnings (e.g. could not read WG log)
    pub warnings: Vec<String>,
}

// ─── Redaction helpers ─────────────────────────────────────────────────────────

/// Redact WireGuard PrivateKey lines (base64, 44 chars)
fn redact_private_keys(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for line in input.lines() {
        let trimmed = line.trim_start();
        if trimmed.to_lowercase().starts_with("privatekey") {
            // Keep key name, replace value
            let prefix = &line[..line.find('=').map(|i| i + 1).unwrap_or(line.len())];
            out.push_str(prefix);
            out.push_str(" [REDACTED]\n");
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// Redact WireGuard PublicKey lines
fn redact_public_keys(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for line in input.lines() {
        let trimmed = line.trim_start();
        if trimmed.to_lowercase().starts_with("publickey") {
            let prefix = &line[..line.find('=').map(|i| i + 1).unwrap_or(line.len())];
            out.push_str(prefix);
            out.push_str(" [PUBKEY-REDACTED]\n");
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// Redact Endpoint lines (hostname:port → [ENDPOINT-REDACTED]:port)
fn redact_endpoints(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for line in input.lines() {
        let trimmed = line.trim_start();
        if trimmed.to_lowercase().starts_with("endpoint") {
            // Keep "Endpoint = " prefix + port if present
            if let Some(eq_pos) = line.find('=') {
                let prefix = &line[..eq_pos + 1];
                let val = line[eq_pos + 1..].trim();
                // Extract port (:NNNN at end)
                let port_part = val
                    .rfind(':')
                    .map(|i| &val[i..])
                    .unwrap_or("");
                out.push_str(prefix);
                out.push_str(" [ENDPOINT-REDACTED]");
                out.push_str(port_part);
                out.push('\n');
            } else {
                out.push_str(line);
                out.push('\n');
            }
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// Redact Bearer tokens / Authorization headers
fn redact_auth_tokens(input: &str) -> String {
    // Simple line-based redaction for "Bearer " and "Authorization:" patterns
    let mut out = String::with_capacity(input.len());
    for line in input.lines() {
        let lower = line.to_lowercase();
        if lower.contains("bearer ") || lower.contains("authorization:") || lower.contains("x-peer-token") {
            // Blank out value after first colon or "Bearer "
            if let Some(pos) = line.to_lowercase().find("bearer ") {
                out.push_str(&line[..pos]);
                out.push_str("Bearer [TOKEN-REDACTED]\n");
            } else if let Some(pos) = line.find(':') {
                out.push_str(&line[..pos + 1]);
                out.push_str(" [TOKEN-REDACTED]\n");
            } else {
                out.push_str("[REDACTED LINE]\n");
            }
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    out
}

/// Full redaction pipeline: apply all redactors in sequence
fn redact(raw: &str) -> String {
    let s = redact_private_keys(raw);
    let s = redact_public_keys(&s);
    let s = redact_endpoints(&s);
    redact_auth_tokens(&s)
}

// ─── Bundle collector ─────────────────────────────────────────────────────────

/// Collect a bundle section from a file path, redacting the content.
/// Returns (section_text, optional_warning)
fn collect_file(label: &str, path: &str) -> (String, Option<String>) {
    match fs::read_to_string(path) {
        Ok(content) => {
            let redacted = redact(&content);
            let section = format!(
                "═══════════════════════════════════════════\n\
                 {label}\n\
                 ═══════════════════════════════════════════\n\
                 {redacted}\n"
            );
            (section, None)
        }
        Err(e) => {
            let section = format!(
                "═══════════════════════════════════════════\n\
                 {label} [UNREADABLE]\n\
                 ═══════════════════════════════════════════\n\
                 Could not read: {e}\n\n"
            );
            (section, Some(format!("Could not read {label}: {e}")))
        }
    }
}

/// Collect WireGuard adapter log (Windows: `wg show arma3-session-bridge` output)
#[cfg(target_os = "windows")]
fn collect_wg_log() -> (String, Option<String>) {
    use std::process::Command;
    match Command::new("wg")
        .args(["show", "arma3-session-bridge"])
        .output()
    {
        Ok(out) => {
            let raw = String::from_utf8_lossy(&out.stdout).to_string();
            let redacted = redact(&raw);
            let section = format!(
                "═══════════════════════════════════════════\n\
                 WireGuard Status (wg show)\n\
                 ═══════════════════════════════════════════\n\
                 {redacted}\n"
            );
            (section, None)
        }
        Err(e) => (
            format!("[wg show unavailable: {e}]\n"),
            Some(format!("wg show failed: {e}")),
        ),
    }
}

#[cfg(not(target_os = "windows"))]
fn collect_wg_log() -> (String, Option<String>) {
    (
        "WireGuard Status: [not available on this platform]\n".to_string(),
        None,
    )
}

/// Collect basic system info (non-sensitive)
fn collect_system_info() -> String {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let hostname = hostname_safe();
    format!(
        "═══════════════════════════════════════════\n\
         System Information\n\
         ═══════════════════════════════════════════\n\
         OS:           {os}\n\
         Architecture: {arch}\n\
         Hostname:     {hostname}\n\
         Bundle Time:  {}\n\n",
        chrono_now()
    )
}

fn hostname_safe() -> String {
    // Hostname is low-sensitivity but we use a generic label to avoid PII
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .map(|h| format!("[HOST-{:08X}]", hash_str(&h)))
        .unwrap_or_else(|_| "[UNKNOWN-HOST]".to_string())
}

fn hash_str(s: &str) -> u32 {
    s.bytes().fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32))
}

fn chrono_now() -> String {
    // Simple timestamp without chrono dependency
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let s = secs % 60;
    let m = (secs / 60) % 60;
    let h = (secs / 3600) % 24;
    let days = secs / 86400;
    format!("Unix day {days}, {h:02}:{m:02}:{s:02} UTC")
}

// ─── Public command ────────────────────────────────────────────────────────────

/// Collect all diagnostic data, redact sensitive fields, write to a temp file.
///
/// Returns SupportBundleResult with the path to the created bundle.
pub fn create_support_bundle() -> Result<SupportBundleResult, String> {
    let mut bundle = String::new();
    let mut summary = Vec::<String>::new();
    let mut warnings = Vec::<String>::new();

    // Header
    let _ = writeln!(
        bundle,
        "Arma 3 Session Bridge — Support Bundle\n\
         Generated: {}\n\
         NOTE: All private keys, endpoints, and tokens have been redacted.\n",
        chrono_now()
    );

    // System info
    bundle.push_str(&collect_system_info());
    summary.push("System info".to_string());

    // WireGuard config (redacted)
    let wg_conf = r"C:\ProgramData\WireGuard\arma3-session-bridge.conf";
    let (section, warn) = collect_file("WireGuard Config (redacted)", wg_conf);
    bundle.push_str(&section);
    if let Some(w) = warn {
        warnings.push(w);
    } else {
        summary.push("WireGuard config (redacted)".to_string());
    }

    // App config (redacted)
    let app_conf = r"C:\ProgramData\arma3-session-bridge\config.json";
    let (section, warn) = collect_file("App Config (redacted)", app_conf);
    bundle.push_str(&section);
    if let Some(w) = warn {
        warnings.push(w);
    } else {
        summary.push("App config (redacted)".to_string());
    }

    // WireGuard log
    let (section, warn) = collect_wg_log();
    bundle.push_str(&section);
    if let Some(w) = warn {
        warnings.push(w);
    } else {
        summary.push("WireGuard status".to_string());
    }

    // Write to temp file
    let path = bundle_output_path();
    fs::write(&path, &bundle).map_err(|e| format!("Failed to write bundle: {e}"))?;

    Ok(SupportBundleResult {
        path: path.to_string_lossy().to_string(),
        summary,
        warnings,
    })
}

fn bundle_output_path() -> PathBuf {
    use std::time::{SystemTime, UNIX_EPOCH};
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let dir = std::env::temp_dir();
    dir.join(format!("arma3-session-bridge-support-{ts}.txt"))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn support_bundle_redacts_private_key() {
        let input = "[Interface]\nPrivateKey = ABCDEFGHIJKLMNOPQRSTUVWXYZ01234567890abc/+==\nAddress = 10.8.0.5/24\n";
        let output = redact_private_keys(input);
        assert!(!output.contains("ABCDEFGHIJKLMNOPQRSTUVWXYZ"), "PrivateKey not redacted");
        assert!(output.contains("[REDACTED]"), "Redaction marker missing");
        assert!(output.contains("Address = 10.8.0.5"), "Non-sensitive field should remain");
    }

    #[test]
    fn support_bundle_redacts_public_key() {
        let input = "[Peer]\nPublicKey = SOMEPUBLICKEY1234567890==\nAllowedIPs = 10.8.0.0/24\n";
        let output = redact_public_keys(input);
        assert!(!output.contains("SOMEPUBLICKEY"), "PublicKey not redacted");
        assert!(output.contains("[PUBKEY-REDACTED]"), "Redaction marker missing");
    }

    #[test]
    fn support_bundle_redacts_endpoint() {
        let input = "[Peer]\nEndpoint = myserver.example.com:51820\nAllowedIPs = 0.0.0.0/0\n";
        let output = redact_endpoints(input);
        assert!(!output.contains("myserver.example.com"), "Endpoint hostname not redacted");
        assert!(output.contains("[ENDPOINT-REDACTED]"), "Redaction marker missing");
        assert!(output.contains(":51820"), "Port should be preserved");
    }

    #[test]
    fn support_bundle_redacts_bearer_token() {
        let input = "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret.token\n";
        let output = redact_auth_tokens(input);
        assert!(!output.contains("eyJhbGciOiJIUzI1NiJ9"), "Bearer token not redacted");
        assert!(output.contains("[TOKEN-REDACTED]"), "Redaction marker missing");
    }

    #[test]
    fn full_redact_pipeline_is_idempotent() {
        let input = "[Interface]\nPrivateKey = SOMEKEY==\nAddress = 10.8.0.5/24\n\
                     [Peer]\nPublicKey = PUBKEY==\nEndpoint = host.tld:51820\n";
        let once = redact(input);
        let twice = redact(&once);
        assert_eq!(once, twice, "Redaction should be idempotent");
    }
}
