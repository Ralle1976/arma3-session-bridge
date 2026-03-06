/// vpn_test.rs — Integration tests for VPN automation
///
/// These tests run on the host platform (Linux CI or Windows dev machine).
/// They verify logic that does NOT require WireGuard to be installed:
///   - Status check for non-existent tunnels → always returns connected=false
///   - WireGuard path detection → returns Ok or a meaningful error

use arma3_session_bridge_client::vpn;

/// Verify that `check_vpn_status` on a clearly nonexistent tunnel name
/// returns a `VpnStatus` with `connected = false` and no tunnel IP.
///
/// This test works on all platforms because `sc.exe` will either be absent
/// (Linux/CI → is_tunnel_running returns false) or report the service as
/// not found (Windows → also returns false).
#[test]
fn test_vpn_status_not_connected() {
    let status = vpn::check_vpn_status("definitely-nonexistent-tunnel-abc123")
        .expect("check_vpn_status should not return Err for an unknown tunnel");

    assert!(
        !status.connected,
        "Unknown tunnel must report connected = false, got: {status:?}"
    );
    assert!(
        status.tunnel_ip.is_none(),
        "Disconnected tunnel must have no tunnel_ip, got: {:?}",
        status.tunnel_ip
    );
    assert_eq!(
        status.tunnel_name.as_deref(),
        Some("definitely-nonexistent-tunnel-abc123"),
        "tunnel_name must be echoed back in VpnStatus"
    );
}

/// Verify that `install_wireguard_if_missing` correctly detects the
/// WireGuard executable path and returns a meaningful result.
///
/// On a machine without WireGuard (Linux CI), the function must:
///   - Return `Err(msg)` where `msg` mentions "WireGuard"
///
/// On a Windows machine with WireGuard installed, it must:
///   - Return `Ok(())`
///
/// In both cases, the function must NOT panic.
#[test]
fn test_wireguard_path_detection() {
    let result = vpn::install_wireguard_if_missing();

    match result {
        Ok(()) => {
            // WireGuard is installed — path detection worked correctly on Windows
        }
        Err(msg) => {
            // Expected on Linux CI or Windows without WireGuard
            assert!(
                msg.to_lowercase().contains("wireguard"),
                "Error message should mention WireGuard, got: '{msg}'"
            );
            assert!(
                !msg.is_empty(),
                "Error message must not be empty"
            );
        }
    }
}

/// Verify that `is_tunnel_running` returns false for a nonexistent tunnel.
#[test]
fn test_is_tunnel_running_nonexistent() {
    assert!(
        !vpn::is_tunnel_running("nonexistent-tunnel-for-test-xyz"),
        "is_tunnel_running must return false for a nonexistent service"
    );
}

/// Verify that `is_tunnel_running` returns false for an empty tunnel name
/// (guard against empty-string edge case).
#[test]
fn test_is_tunnel_running_empty_name() {
    assert!(
        !vpn::is_tunnel_running(""),
        "is_tunnel_running must return false for empty tunnel name"
    );
}

/// Verify that `check_vpn_status` rejects an empty tunnel name with Err.
#[test]
fn test_check_vpn_status_empty_name_is_err() {
    let result = vpn::check_vpn_status("");
    assert!(result.is_err(), "Empty tunnel name must return Err");
}
