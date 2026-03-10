use arma3_session_bridge_client::vpn;

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

#[test]
fn test_disconnect_when_not_connected() {
    let result = vpn::disconnect_vpn("any-tunnel-name");
    assert!(result.is_ok(), "disconnect_vpn should be idempotent");
}

#[test]
fn test_get_tunnel_ip_when_not_connected() {
    let result = vpn::get_tunnel_ip();
    assert!(result.is_err(), "No active tunnel should return Err");
}

#[test]
fn test_check_vpn_status_empty_name_is_err() {
    let result = vpn::check_vpn_status("");
    assert!(result.is_err(), "Empty tunnel name must return Err");
}

#[test]
fn test_connect_vpn_missing_conf_returns_err() {
    let result = vpn::connect_vpn("Z:\\definitely\\missing\\arma3-session-bridge.conf");
    assert!(
        result.is_err(),
        "Missing config path must return a user-facing error"
    );
}

// ── Task 2: VPN State Machine Tests ─────────────────────────────────────────

#[test]
fn state_machine_starts_disconnected() {
    use arma3_session_bridge_client::vpn_state::{VpnState, VpnStateMachine};
    let sm = VpnStateMachine::new();
    assert!(
        matches!(sm.state(), VpnState::Disconnected),
        "New state machine must start in Disconnected state"
    );
    assert_eq!(sm.reconnect_attempt(), 0, "reconnect_attempt must start at 0");
}

#[test]
fn state_machine_rejects_connect_when_already_connecting() {
    use arma3_session_bridge_client::vpn_state::{VpnIntent, VpnState, VpnStateMachine};
    let mut sm = VpnStateMachine::new();
    // Transition to Connecting
    let r1 = sm.transition(VpnIntent::Connect);
    assert!(r1.is_ok(), "First Connect from Disconnected must succeed");
    assert!(matches!(sm.state(), VpnState::Connecting), "State must be Connecting after first Connect");
    // Second Connect while already Connecting must be rejected
    let r2 = sm.transition(VpnIntent::Connect);
    assert!(
        r2.is_err(),
        "Connect intent while already Connecting must be rejected, got: {r2:?}"
    );
    assert!(
        matches!(sm.state(), VpnState::Connecting),
        "State must remain Connecting after rejected intent"
    );
}

#[test]
fn state_machine_enforces_disconnect_before_reconnect_path() {
    use arma3_session_bridge_client::vpn_state::{VpnIntent, VpnState, VpnStateMachine};
    let mut sm = VpnStateMachine::new();
    // Drive to Connected
    sm.transition(VpnIntent::Connect).unwrap();
    sm.mark_connected();
    assert!(matches!(sm.state(), VpnState::Connected));
    // Reconnect from Connected → must go through Reconnecting first
    let r = sm.transition(VpnIntent::Reconnect);
    assert!(r.is_ok(), "Reconnect from Connected must be accepted");
    assert!(
        matches!(sm.state(), VpnState::Reconnecting),
        "State must be Reconnecting after Reconnect intent, got: {:?}", sm.state()
    );
}

#[test]
fn state_machine_disconnect_from_connected_transitions_to_disconnected() {
    use arma3_session_bridge_client::vpn_state::{VpnIntent, VpnState, VpnStateMachine};
    let mut sm = VpnStateMachine::new();
    sm.transition(VpnIntent::Connect).unwrap();
    sm.mark_connected();
    sm.transition(VpnIntent::Disconnect).unwrap();
    assert!(
        matches!(sm.state(), VpnState::Disconnecting | VpnState::Disconnected),
        "Disconnect intent must move toward Disconnected, got: {:?}", sm.state()
    );
}

#[test]
fn state_machine_error_can_reconnect() {
    use arma3_session_bridge_client::vpn_state::{VpnIntent, VpnState, VpnStateMachine};
    let mut sm = VpnStateMachine::new();
    sm.mark_error("handshake timeout".to_string());
    assert!(matches!(sm.state(), VpnState::Error(_)));
    let r = sm.transition(VpnIntent::Reconnect);
    assert!(r.is_ok(), "Reconnect from Error must be accepted");
    assert!(
        matches!(sm.state(), VpnState::Reconnecting | VpnState::Connecting),
        "After Reconnect from Error state must be Reconnecting or Connecting, got: {:?}", sm.state()
    );
}
