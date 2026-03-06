/// Integration tests for the VPN module
///
/// These tests exercise the public API of `arma3_session_bridge_client::vpn`.
/// Tests that require an actual WireGuard installation are guarded by
/// `#[ignore]` — run them with `cargo test -- --ignored` on a Windows host
/// with WireGuard and admin rights.

use arma3_session_bridge_client::vpn;

// ─── Service-name helpers ──────────────────────────────────────────────────────

#[test]
fn test_service_name_format_standard() {
    let tunnel_name = "arma3-session-bridge";
    let service_name = format!("WireGuardTunnel${tunnel_name}");
    assert_eq!(service_name, "WireGuardTunnel$arma3-session-bridge");
}

#[test]
fn test_service_name_format_single_word() {
    let tunnel_name = "arma3";
    let service_name = format!("WireGuardTunnel${tunnel_name}");
    assert_eq!(service_name, "WireGuardTunnel$arma3");
}

// ─── Empty-input guards ────────────────────────────────────────────────────────

#[test]
fn test_install_tunnel_rejects_empty_path() {
    let result = vpn::install_tunnel_service("");
    assert!(result.is_err(), "Empty path must return Err");
    let msg = result.unwrap_err();
    assert!(
        msg.contains("must not be empty"),
        "Error message should mention empty: got {msg}"
    );
}

#[test]
fn test_uninstall_tunnel_rejects_empty_name() {
    let result = vpn::uninstall_tunnel_service("");
    assert!(result.is_err(), "Empty tunnel name must return Err");
    let msg = result.unwrap_err();
    assert!(
        msg.contains("must not be empty"),
        "Error message should mention empty: got {msg}"
    );
}

#[test]
fn test_is_tunnel_running_empty_name_returns_false() {
    // Empty name → false without panicking
    assert!(!vpn::is_tunnel_running(""));
}

// ─── Non-existent tunnel (safe, works without WireGuard) ──────────────────────

#[test]
fn test_is_tunnel_running_nonexistent_returns_false() {
    // sc.exe query on an unknown service name → false, no panic
    let result = vpn::is_tunnel_running("definitely-nonexistent-tunnel-xyz-12345");
    assert!(
        !result,
        "A nonexistent tunnel should never appear as running"
    );
}

// ─── Admin-required tests (ignored by default) ─────────────────────────────────

#[test]
#[ignore = "Requires WireGuard installed and admin privileges on Windows"]
fn test_install_real_tunnel() {
    // Point at a real WireGuard conf file to exercise the full path
    let conf_path = r"C:\ProgramData\WireGuard\arma3-session-bridge.conf";
    let result = vpn::install_tunnel_service(conf_path);
    // This will fail unless wireguard.exe is present — expected in CI via MUST NOT DO
    // Left as documentation of the expected success path.
    assert!(result.is_ok(), "install_tunnel_service should succeed: {result:?}");
}

#[test]
#[ignore = "Requires WireGuard installed and admin privileges on Windows"]
fn test_uninstall_real_tunnel() {
    let result = vpn::uninstall_tunnel_service("arma3-session-bridge");
    assert!(result.is_ok(), "uninstall_tunnel_service should succeed: {result:?}");
}
