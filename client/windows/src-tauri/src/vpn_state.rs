//! vpn_state.rs — Deterministic VPN lifecycle state machine.
//!
//! # Design Principles
//!
//! - **Single source of truth**: `VpnStateMachine` owns all lifecycle state.
//!   `vpn.rs` functions are thin wrappers — they do NOT track state themselves.
//! - **Pure transitions**: `transition()` mutates state synchronously and returns
//!   `Result` so callers can react to invalid intent without side effects.
//! - **Async-safe**: State is behind `tokio::sync::Mutex` when used from async
//!   contexts (see `lib.rs`). The state machine itself is plain Rust — no async.
//! - **No I/O in transitions**: transition guards are pure logic. Side effects
//!   (tunnel start/stop, network calls) happen in callers AFTER a successful transition.
//! - **Reconnect backoff**: the machine owns the backoff counter so callers never
//!   need to track it externally.
//!
//! # State Diagram
//!
//! ```text
//!  Disconnected ──Connect──▶ Connecting ──mark_connected()──▶ Connected
//!  Connected    ──Disconnect──▶ Disconnecting ──mark_disconnected()──▶ Disconnected
//!  Connected    ──Reconnect──▶ Reconnecting ──mark_connected()──▶ Connected
//!  Reconnecting ──mark_connected()──▶ Connected   (resets attempt counter)
//!  Reconnecting ──mark_error()──▶ Error(reason)
//!  Error        ──Reconnect──▶ Reconnecting   (increments attempt counter)
//!  Error        ──Disconnect──▶ Disconnected   (clears counter)
//!  Any          ──mark_error()──▶ Error(reason)
//! ```

/// VPN lifecycle states.
///
/// These are the ONLY valid states a VPN connection can be in.
/// Callers must use `VpnStateMachine::transition()` to move between states.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VpnState {
    /// No active tunnel. Ready to connect.
    Disconnected,
    /// Tunnel setup in progress (handshake not yet confirmed).
    Connecting,
    /// Tunnel active with confirmed handshake.
    Connected,
    /// Attempting to restore a previously active tunnel.
    Reconnecting,
    /// Tear-down in progress (waiting for tunnel stop).
    Disconnecting,
    /// Unrecoverable or transient error. Includes reason string.
    Error(String),
}

/// User-facing intent that drives state transitions.
///
/// Intents are the ONLY way to trigger state changes. Direct state mutation
/// is not possible outside this module.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VpnIntent {
    /// Start a new VPN connection.
    Connect,
    /// Tear down the active tunnel gracefully.
    Disconnect,
    /// Re-establish a failed or lost tunnel (increments backoff counter).
    Reconnect,
    /// Run deep diagnostics without changing tunnel state.
    Diagnose,
}

/// Normalized event payload emitted after each state change.
///
/// Used as the payload for the `vpn-state-changed` Tauri event.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VpnStateEvent {
    /// New state label (e.g. "Connecting", "Connected", "Error").
    pub state: String,
    /// Human-readable reason for the transition (empty string if none).
    pub reason: String,
    /// Current reconnect attempt count (0 when not reconnecting).
    pub attempt: u32,
    /// Unix timestamp in milliseconds when this event was generated.
    pub timestamp_ms: u64,
}

/// Deterministic VPN lifecycle state machine.
///
/// Create one instance per application lifetime and share it behind a
/// `tokio::sync::Mutex` for async access.
///
/// ```rust
/// let mut sm = VpnStateMachine::new();
/// sm.transition(VpnIntent::Connect)?;
/// // ... start tunnel ...
/// sm.mark_connected();
/// ```
#[derive(Debug)]
pub struct VpnStateMachine {
    state: VpnState,
    reconnect_attempt: u32,
}

impl VpnStateMachine {
    /// Create a new state machine in the `Disconnected` state.
    pub fn new() -> Self {
        Self {
            state: VpnState::Disconnected,
            reconnect_attempt: 0,
        }
    }

    /// Return a reference to the current state.
    pub fn state(&self) -> &VpnState {
        &self.state
    }

    /// Return the current reconnect attempt count.
    pub fn reconnect_attempt(&self) -> u32 {
        self.reconnect_attempt
    }

    /// Apply an intent and transition to the next state.
    ///
    /// Returns `Ok(())` on a valid transition.  
    /// Returns `Err(reason)` if the intent is not valid from the current state
    /// (caller should NOT proceed with the side effect).
    ///
    /// **No I/O is performed here.** After a successful transition, the caller
    /// is responsible for executing the corresponding side effect (e.g. calling
    /// `vpn::connect_vpn()`).
    pub fn transition(&mut self, intent: VpnIntent) -> Result<(), String> {
        use VpnIntent::*;
        use VpnState::*;

        let next = match (&self.state, &intent) {
            // Connect is valid only from idle states
            (Disconnected, Connect)  => Connecting,
            (Error(_),     Connect)  => Connecting,
            // Connect from any active state is rejected
            (Connecting, Connect) => {
                return Err(format!(
                    "Cannot Connect: already in {:?}. Wait for current connect to complete or disconnect first.",
                    self.state
                ));
            }
            (Connected, Connect) => {
                return Err(format!(
                    "Cannot Connect: already Connected. Disconnect first or use Reconnect."
                ));
            }
            (Reconnecting, Connect) => {
                return Err(format!(
                    "Cannot Connect: reconnect already in progress."
                ));
            }
            (Disconnecting, Connect) => {
                return Err(format!(
                    "Cannot Connect: disconnect still in progress. Wait for Disconnected state."
                ));
            }

            // Disconnect is valid from active states
            (Connected, Disconnect)     => Disconnecting,
            (Connecting, Disconnect)    => Disconnecting,
            (Reconnecting, Disconnect)  => Disconnecting,
            (Error(_), Disconnect)      => {
                self.reconnect_attempt = 0;
                Disconnected
            }
            (Disconnected, Disconnect)  => return Ok(()), // already disconnected — idempotent

            // Reconnect is valid from degraded/active states
            (Connected,    Reconnect)   => {
                self.reconnect_attempt += 1;
                Reconnecting
            }
            (Error(_),     Reconnect)   => {
                self.reconnect_attempt += 1;
                Reconnecting
            }
            (Disconnected, Reconnect)   => {
                self.reconnect_attempt += 1;
                Reconnecting
            }
            (Reconnecting, Reconnect)   => {
                return Err("Already reconnecting.".to_string());
            }
            (Connecting, Reconnect)     => {
                return Err("Cannot reconnect while initial connect is in progress.".to_string());
            }

            // Diagnose never changes state
            (_, Diagnose)               => return Ok(()),

            // Catch any remaining combinations (unreachable if match is exhaustive)
            _ => {
                return Err(format!(
                    "Intent {:?} is not valid from state {:?}",
                    intent, self.state
                ));
            }
        };

        self.state = next;
        Ok(())
    }

    /// Mark the connection as fully established (handshake confirmed).
    ///
    /// Valid from `Connecting` and `Reconnecting`. Resets reconnect counter.
    /// Returns `Err` if called from an unexpected state.
    pub fn mark_connected(&mut self) -> Result<(), String> {
        match &self.state {
            VpnState::Connecting | VpnState::Reconnecting => {
                self.state = VpnState::Connected;
                self.reconnect_attempt = 0;
                Ok(())
            }
            other => Err(format!(
                "mark_connected() called from unexpected state {:?}",
                other
            )),
        }
    }

    /// Mark the tunnel as cleanly disconnected (after tear-down completes).
    ///
    /// Valid from `Disconnecting`. Resets reconnect counter.
    pub fn mark_disconnected(&mut self) -> Result<(), String> {
        match &self.state {
            VpnState::Disconnecting => {
                self.state = VpnState::Disconnected;
                self.reconnect_attempt = 0;
                Ok(())
            }
            other => Err(format!(
                "mark_disconnected() called from unexpected state {:?}",
                other
            )),
        }
    }

    /// Force state into `Error` with a reason string.
    ///
    /// Valid from any state. Does NOT reset the reconnect counter — the counter
    /// persists so callers can implement backoff using `reconnect_attempt()`.
    pub fn mark_error(&mut self, reason: String) {
        self.state = VpnState::Error(reason);
    }

    /// Build a normalized event payload for the current state.
    pub fn event_payload(&self, reason: &str) -> VpnStateEvent {
        use std::time::{SystemTime, UNIX_EPOCH};
        let timestamp_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        VpnStateEvent {
            state: match &self.state {
                VpnState::Disconnected  => "Disconnected".to_string(),
                VpnState::Connecting    => "Connecting".to_string(),
                VpnState::Connected     => "Connected".to_string(),
                VpnState::Reconnecting  => "Reconnecting".to_string(),
                VpnState::Disconnecting => "Disconnecting".to_string(),
                VpnState::Error(r)      => format!("Error: {r}"),
            },
            reason: reason.to_string(),
            attempt: self.reconnect_attempt,
            timestamp_ms,
        }
    }

    /// Return `true` if the machine is in a state where heartbeats should run.
    pub fn should_heartbeat(&self) -> bool {
        matches!(self.state, VpnState::Connected)
    }

    /// Return `true` if the machine is in a state where reconnect should be attempted.
    pub fn should_reconnect(&self) -> bool {
        matches!(self.state, VpnState::Disconnected | VpnState::Error(_))
    }
}

impl Default for VpnStateMachine {
    fn default() -> Self {
        Self::new()
    }
}

// ── Unit tests ────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_machine_starts_disconnected() {
        let sm = VpnStateMachine::new();
        assert!(matches!(sm.state(), VpnState::Disconnected));
        assert_eq!(sm.reconnect_attempt(), 0);
    }

    #[test]
    fn connect_from_disconnected_transitions_to_connecting() {
        let mut sm = VpnStateMachine::new();
        sm.transition(VpnIntent::Connect).unwrap();
        assert!(matches!(sm.state(), VpnState::Connecting));
    }

    #[test]
    fn connect_while_connecting_is_rejected() {
        let mut sm = VpnStateMachine::new();
        sm.transition(VpnIntent::Connect).unwrap();
        let result = sm.transition(VpnIntent::Connect);
        assert!(result.is_err(), "Double-connect must be rejected");
        assert!(matches!(sm.state(), VpnState::Connecting), "State must remain Connecting");
    }

    #[test]
    fn mark_connected_from_connecting_succeeds() {
        let mut sm = VpnStateMachine::new();
        sm.transition(VpnIntent::Connect).unwrap();
        sm.mark_connected().unwrap();
        assert!(matches!(sm.state(), VpnState::Connected));
        assert_eq!(sm.reconnect_attempt(), 0);
    }

    #[test]
    fn reconnect_from_connected_goes_to_reconnecting() {
        let mut sm = VpnStateMachine::new();
        sm.transition(VpnIntent::Connect).unwrap();
        sm.mark_connected().unwrap();
        sm.transition(VpnIntent::Reconnect).unwrap();
        assert!(matches!(sm.state(), VpnState::Reconnecting));
        assert_eq!(sm.reconnect_attempt(), 1);
    }

    #[test]
    fn reconnect_increments_attempt_counter() {
        let mut sm = VpnStateMachine::new();
        sm.mark_error("timeout".to_string());
        sm.transition(VpnIntent::Reconnect).unwrap();
        assert_eq!(sm.reconnect_attempt(), 1);
        // Back to error, reconnect again
        sm.mark_error("timeout2".to_string());
        sm.transition(VpnIntent::Reconnect).unwrap();
        assert_eq!(sm.reconnect_attempt(), 2);
    }

    #[test]
    fn mark_connected_resets_reconnect_counter() {
        let mut sm = VpnStateMachine::new();
        sm.mark_error("timeout".to_string());
        sm.transition(VpnIntent::Reconnect).unwrap(); // attempt = 1
        sm.mark_connected().unwrap();
        assert_eq!(sm.reconnect_attempt(), 0, "Counter must reset on successful connect");
    }

    #[test]
    fn disconnect_from_connected_transitions_to_disconnecting() {
        let mut sm = VpnStateMachine::new();
        sm.transition(VpnIntent::Connect).unwrap();
        sm.mark_connected().unwrap();
        sm.transition(VpnIntent::Disconnect).unwrap();
        assert!(matches!(sm.state(), VpnState::Disconnecting | VpnState::Disconnected));
    }

    #[test]
    fn mark_disconnected_from_disconnecting_succeeds() {
        let mut sm = VpnStateMachine::new();
        sm.transition(VpnIntent::Connect).unwrap();
        sm.mark_connected().unwrap();
        sm.transition(VpnIntent::Disconnect).unwrap();
        sm.mark_disconnected().unwrap();
        assert!(matches!(sm.state(), VpnState::Disconnected));
    }

    #[test]
    fn disconnect_from_disconnected_is_idempotent() {
        let mut sm = VpnStateMachine::new();
        let result = sm.transition(VpnIntent::Disconnect);
        assert!(result.is_ok(), "Disconnect from Disconnected must be a no-op");
        assert!(matches!(sm.state(), VpnState::Disconnected));
    }

    #[test]
    fn error_from_any_state_transitions_to_error() {
        let mut sm = VpnStateMachine::new();
        sm.mark_error("handshake timeout".to_string());
        assert!(matches!(sm.state(), VpnState::Error(_)));
    }

    #[test]
    fn reconnect_from_error_goes_to_reconnecting() {
        let mut sm = VpnStateMachine::new();
        sm.mark_error("handshake timeout".to_string());
        sm.transition(VpnIntent::Reconnect).unwrap();
        assert!(matches!(sm.state(), VpnState::Reconnecting | VpnState::Connecting));
    }

    #[test]
    fn disconnect_from_error_resets_counter_and_disconnects() {
        let mut sm = VpnStateMachine::new();
        sm.mark_error("timeout".to_string());
        sm.transition(VpnIntent::Reconnect).unwrap(); // attempt = 1
        sm.mark_error("timeout2".to_string());
        sm.transition(VpnIntent::Disconnect).unwrap();
        assert!(matches!(sm.state(), VpnState::Disconnected));
        assert_eq!(sm.reconnect_attempt(), 0);
    }

    #[test]
    fn diagnose_intent_never_changes_state() {
        let mut sm = VpnStateMachine::new();
        sm.transition(VpnIntent::Diagnose).unwrap();
        assert!(matches!(sm.state(), VpnState::Disconnected));
        sm.transition(VpnIntent::Connect).unwrap();
        sm.transition(VpnIntent::Diagnose).unwrap();
        assert!(matches!(sm.state(), VpnState::Connecting));
    }

    #[test]
    fn should_heartbeat_only_when_connected() {
        let mut sm = VpnStateMachine::new();
        assert!(!sm.should_heartbeat());
        sm.transition(VpnIntent::Connect).unwrap();
        assert!(!sm.should_heartbeat()); // Connecting — not yet
        sm.mark_connected().unwrap();
        assert!(sm.should_heartbeat()); // Connected — yes
        sm.transition(VpnIntent::Disconnect).unwrap();
        assert!(!sm.should_heartbeat()); // Disconnecting — no
    }

    #[test]
    fn should_reconnect_only_from_disconnected_or_error() {
        let mut sm = VpnStateMachine::new();
        assert!(sm.should_reconnect()); // Disconnected
        sm.transition(VpnIntent::Connect).unwrap();
        assert!(!sm.should_reconnect()); // Connecting
        sm.mark_connected().unwrap();
        assert!(!sm.should_reconnect()); // Connected
        sm.mark_error("x".to_string());
        assert!(sm.should_reconnect()); // Error
    }
}
