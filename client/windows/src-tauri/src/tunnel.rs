//! tunnel.rs — Embedded WireGuard tunnel using boringtun (protocol) + wintun (TUN adapter)
//!
//! Architecture:
//!   App → TunnelConfig (parsed from .conf) → boringtun Tunn + wintun Adapter + UdpSocket
//!   TUN read  → tunn.encapsulate()    → UDP send
//!   UDP recv  → tunn.decapsulate()    → TUN write
//!   Every 250ms → tunn.update_timers() → keepalive / handshake retransmit
//!
//! wintun.dll must be shipped alongside the .exe.  The loader tries the
//! current working directory first, then falls back to PATH search.

#![allow(dead_code)]

use std::net::{Ipv4Addr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use std::thread::{self, JoinHandle};

use base64::Engine as _;
use serde::Serialize;

use boringtun::noise::{Tunn, TunnResult};
use x25519_dalek::{PublicKey, StaticSecret};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

// ── Constants ────────────────────────────────────────────────────────────────

/// CREATE_NO_WINDOW process creation flag — hides console windows from subprocesses.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// How often (in milliseconds) we call `tunn.update_timers()`.
const TIMER_INTERVAL: Duration = Duration::from_millis(250);

/// Working buffer size — large enough for any WireGuard-encapsulated Ethernet frame.
const PACKET_BUF_SIZE: usize = 65_536;

// ── TunnelConfig ─────────────────────────────────────────────────────────────

/// Parsed WireGuard `.conf` configuration.
///
/// Keys are stored as raw 32-byte arrays and converted to x25519 types
/// only when constructing the boringtun Tunn.  This avoids lifetime and
/// Clone issues with `StaticSecret` which is not `Clone`.
///
/// Serialization omits the private key; all other fields are included.
#[derive(Clone)]
pub struct TunnelConfig {
    /// Local x25519 private key bytes (from `[Interface] PrivateKey`).
    pub private_key_bytes: [u8; 32],
    /// Remote peer's x25519 public key bytes (from `[Peer] PublicKey`).
    pub peer_public_key_bytes: [u8; 32],
    /// Remote server UDP endpoint (from `[Peer] Endpoint`).
    pub server_endpoint: SocketAddr,
    /// TUN interface IP address (from `[Interface] Address`, prefix stripped).
    pub tunnel_ip: Ipv4Addr,
    /// Interface MTU (from `[Interface] MTU`, default 1420).
    pub mtu: u16,
    /// Persistent keepalive interval in seconds, or `None` (from `[Peer] PersistentKeepalive`).
    pub keepalive: Option<u16>,
}

impl std::fmt::Debug for TunnelConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TunnelConfig")
            .field("server_endpoint", &self.server_endpoint)
            .field("tunnel_ip", &self.tunnel_ip)
            .field("mtu", &self.mtu)
            .field("keepalive", &self.keepalive)
            .finish_non_exhaustive()
    }
}

impl Serialize for TunnelConfig {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        // Private key is intentionally excluded from serialization.
        let mut st = serializer.serialize_struct("TunnelConfig", 4)?;
        st.serialize_field("server_endpoint", &self.server_endpoint.to_string())?;
        st.serialize_field("tunnel_ip", &self.tunnel_ip.to_string())?;
        st.serialize_field("mtu", &self.mtu)?;
        st.serialize_field("keepalive", &self.keepalive)?;
        st.end()
    }
}

// ── TunnelStats ──────────────────────────────────────────────────────────────

/// Runtime statistics snapshot for the embedded WireGuard tunnel.
///
/// `last_handshake` holds the `Instant` of the last confirmed handshake.  It
/// is serialized as the number of whole seconds that have elapsed since that
/// moment (or `null` if no handshake has occurred yet).
#[derive(Clone, Debug, Default, Serialize)]
pub struct TunnelStats {
    /// Plaintext bytes received from the VPN server (after decapsulation).
    pub rx_bytes: u64,
    /// Bytes sent to the VPN server (after encapsulation, includes handshakes).
    pub tx_bytes: u64,
    /// `Instant` of the last successful handshake, serialised as seconds-ago.
    #[serde(serialize_with = "ser_instant_as_elapsed_secs")]
    pub last_handshake: Option<Instant>,
    /// `true` once the initial WireGuard handshake has completed.
    pub connected: bool,
}

fn ser_instant_as_elapsed_secs<S: serde::Serializer>(
    val: &Option<Instant>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match val {
        Some(t) => serializer.serialize_some(&t.elapsed().as_secs()),
        None => serializer.serialize_none(),
    }
}

// ── EmbeddedTunnel ───────────────────────────────────────────────────────────

/// Handle to a running embedded WireGuard tunnel.
///
/// Dropping the handle automatically calls `stop()`.
pub struct EmbeddedTunnel {
    running:   Arc<AtomicBool>,
    stats:     Arc<Mutex<TunnelStats>>,
    worker:    Option<JoinHandle<()>>,
    tunnel_ip: Ipv4Addr,
}

// ── Windows implementation ────────────────────────────────────────────────────

#[cfg(windows)]
impl EmbeddedTunnel {
    /// Start the WireGuard tunnel in a background thread.
    ///
    /// Steps performed inside the worker thread:
    /// 1. Load `wintun.dll` (shipped next to the exe).
    /// 2. Create a wintun adapter named `"Arma3VPN"`.
    /// 3. Configure the interface IP via `netsh`.
    /// 4. Add a route for `10.8.0.0/24`.
    /// 5. Create a `boringtun::noise::Tunn` with the provided keys.
    /// 6. Bind a UDP socket and connect to the server endpoint.
    /// 7. Start the wintun session and enter the packet routing loop.
    pub fn start(config: TunnelConfig) -> Result<Self, String> {
        let running   = Arc::new(AtomicBool::new(true));
        let stats     = Arc::new(Mutex::new(TunnelStats::default()));
        let tunnel_ip = config.tunnel_ip;

        let running_c = Arc::clone(&running);
        let stats_c   = Arc::clone(&stats);

        let handle = thread::Builder::new()
            .name("wg-tunnel".into())
            .spawn(move || {
                if let Err(e) = run_tunnel(config, running_c, stats_c) {
                    eprintln!("[tunnel] Fatal: {e}");
                }
            })
            .map_err(|e| format!("Failed to spawn tunnel thread: {e}"))?;

        Ok(Self {
            running,
            stats,
            worker: Some(handle),
            tunnel_ip,
        })
    }

    /// Signal the worker thread to stop and wait for it to exit.
    pub fn stop(&mut self) -> Result<(), String> {
        self.running.store(false, Ordering::SeqCst);
        if let Some(h) = self.worker.take() {
            h.join().map_err(|_| "Tunnel thread panicked".to_string())?;
        }
        Ok(())
    }

    /// Returns `true` if the initial WireGuard handshake has completed.
    pub fn is_connected(&self) -> bool {
        self.stats.lock().map(|s| s.connected).unwrap_or(false)
    }

    /// Returns a snapshot of the current tunnel statistics.
    pub fn get_stats(&self) -> TunnelStats {
        self.stats.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Returns the tunnel interface IP address.
    pub fn tunnel_ip(&self) -> Ipv4Addr {
        self.tunnel_ip
    }
}

// ── Non-Windows stub ──────────────────────────────────────────────────────────

#[cfg(not(windows))]
impl EmbeddedTunnel {
    pub fn start(_config: TunnelConfig) -> Result<Self, String> {
        Err("WireGuard tunnel is only supported on Windows".into())
    }

    pub fn stop(&mut self) -> Result<(), String> {
        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        false
    }

    pub fn get_stats(&self) -> TunnelStats {
        TunnelStats::default()
    }

    pub fn tunnel_ip(&self) -> Ipv4Addr {
        self.tunnel_ip
    }
}

impl Drop for EmbeddedTunnel {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

// ── Worker thread (Windows-only) ──────────────────────────────────────────────

#[cfg(windows)]
fn run_tunnel(
    config:  TunnelConfig,
    running: Arc<AtomicBool>,
    stats:   Arc<Mutex<TunnelStats>>,
) -> Result<(), String> {
    // ── Step 1: Load wintun.dll ───────────────────────────────────────────────
    // Try the file next to the exe first; fall back to DLL search path.
    let wintun = unsafe {
        wintun::load_from_path("wintun.dll")
            .or_else(|_| wintun::load())
            .map_err(|e| format!("Cannot load wintun.dll: {e}"))?
    };

    // ── Step 2: Create TUN adapter "Arma3VPN" ────────────────────────────────
    let adapter = wintun::Adapter::create(&wintun, "Arma3VPN", "WireGuard", None)
        .map_err(|e| format!("Cannot create wintun adapter 'Arma3VPN': {e}"))?;

    // ── Step 3: Configure interface IP via netsh ──────────────────────────────
    let ip_str = config.tunnel_ip.to_string();
    std::process::Command::new("netsh")
        .args([
            "interface", "ip", "set", "address",
            "Arma3VPN", "static", &ip_str, "255.255.255.0",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| format!("netsh failed to set interface IP: {e}"))?;

    // ── Step 4: Add route 10.8.0.0/24 → 10.8.0.1 ────────────────────────────
    // Non-fatal: route may already exist, or the adapter may not be up yet.
    let _ = std::process::Command::new("route")
        .args(["add", "10.8.0.0", "mask", "255.255.255.0", "10.8.0.1", "metric", "5"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    // ── Step 5: Build boringtun Tunn ─────────────────────────────────────────
    // boringtun 0.7 takes owned StaticSecret/PublicKey; new() returns Tunn directly (not Result<Box>).
    let static_private = StaticSecret::from(config.private_key_bytes);
    let peer_public = PublicKey::from(config.peer_public_key_bytes);

    let mut tunn = Tunn::new(
        static_private,
        peer_public,
        None,              // preshared key
        config.keepalive,  // persistent keepalive (seconds)
        0,                 // peer index
        None,              // external rate limiter
    );

    // ── Step 6: Bind UDP socket ───────────────────────────────────────────────
    let udp = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("UDP bind failed: {e}"))?;
    udp.connect(config.server_endpoint)
        .map_err(|e| format!("UDP connect to {} failed: {e}", config.server_endpoint))?;
    // Short read timeout so the loop can also poll the TUN side.
    udp.set_read_timeout(Some(Duration::from_millis(10)))
        .map_err(|e| format!("set_read_timeout failed: {e}"))?;

    // ── Step 7: Start wintun session ─────────────────────────────────────────
    // wintun 0.5 requires Arc<Session> for try_receive and allocate_send_packet.
    let session = Arc::new(
        adapter
            .start_session(wintun::MAX_RING_CAPACITY)
            .map_err(|e| format!("wintun start_session failed: {e}"))?
    );
    // Per-iteration scratch buffers — large enough to hold any WireGuard frame.
    let mut udp_buf   = vec![0u8; PACKET_BUF_SIZE];
    let mut encap_buf = vec![0u8; PACKET_BUF_SIZE];
    let mut decap_buf = vec![0u8; PACKET_BUF_SIZE];
    let mut last_tick = Instant::now();

    // ── Step 8: Packet routing loop ───────────────────────────────────────────
    while running.load(Ordering::Relaxed) {

        // (a) UDP recv → decapsulate → TUN write ───────────────────────────────
        match udp.recv(&mut udp_buf) {
            Ok(n) => {
                // src_addr: pass None to skip source-IP validation
                // (we're already `connect()`-ed so the OS filters for us)
                let result = tunn.decapsulate(None, &udp_buf[..n], &mut decap_buf);
                handle_tunn_result(result, &udp, &session, &stats);
            }
            Err(ref e)
                if e.kind() == std::io::ErrorKind::WouldBlock
                    || e.kind() == std::io::ErrorKind::TimedOut =>
            {
                // Normal: no packet in the 10 ms window — continue to poll TUN.
            }
            Err(e) => eprintln!("[tunnel] UDP recv error: {e}"),
        }

        // (b) TUN recv → encapsulate → UDP send ────────────────────────────────
        match session.try_receive() {
            Ok(Some(pkt)) => {
                // encapsulate borrows pkt.bytes() as &[u8]; result borrows encap_buf.
                let result = tunn.encapsulate(pkt.bytes(), &mut encap_buf);
                drop(pkt); // release wintun receive slot before handling result
                handle_tunn_result(result, &udp, &session, &stats);
            }
            Ok(None) => {}
            Err(e) => eprintln!("[tunnel] wintun try_receive error: {e}"),
        }

        // (c) Timer tick → keepalive / handshake retransmit ────────────────────
        if last_tick.elapsed() >= TIMER_INTERVAL {
            let result = tunn.update_timers(&mut encap_buf);
            handle_tunn_result(result, &udp, &session, &stats);
            last_tick = Instant::now();
        }
    }

    // ── Step 9: Cleanup ───────────────────────────────────────────────────────
    // Delete the route we added; adapter is cleaned up when `adapter` drops.
    let _ = std::process::Command::new("route")
        .args(["delete", "10.8.0.0"])
        .creation_flags(CREATE_NO_WINDOW)
        .status();

    Ok(())
}

// ── TunnResult dispatcher (Windows-only) ─────────────────────────────────────

/// Dispatch a `TunnResult` to the appropriate output channel and update stats.
///
/// - `WriteToNetwork` → send over UDP (encapsulated handshake or data).
/// - `WriteToTunnelV4` → write plaintext IP packet to the wintun adapter.
/// - `WriteToTunnelV6` → silently dropped (IPv6 not supported).
/// - `Done` / `Err` → log error, otherwise no-op.
#[cfg(windows)]
fn handle_tunn_result(
    result:  TunnResult<'_>,
    udp:     &UdpSocket,
    session: &Arc<wintun::Session>,
    stats:   &Arc<Mutex<TunnelStats>>,
) {
    match result {
        // Encrypted data / handshake message destined for the server.
        TunnResult::WriteToNetwork(data) => {
            match udp.send(data) {
                Ok(n) => {
                    if let Ok(mut s) = stats.lock() {
                        s.tx_bytes += n as u64;
                    }
                }
                Err(e) => eprintln!("[tunnel] UDP send error: {e}"),
            }
        }

        // Decrypted IPv4 packet destined for the local TUN interface.
        TunnResult::WriteToTunnelV4(data, _src_addr) => {
            let len = data.len();
            match session.allocate_send_packet(len as u16) {
                Ok(mut pkt) => {
                    pkt.bytes_mut().copy_from_slice(data);
                    session.send_packet(pkt);
                    if let Ok(mut s) = stats.lock() {
                        s.rx_bytes       += len as u64;
                        s.connected       = true;
                        // Mark handshake time the first time we receive data.
                        if s.last_handshake.is_none() {
                            s.last_handshake = Some(Instant::now());
                        }
                    }
                }
                Err(e) => eprintln!("[tunnel] wintun allocate_send_packet error: {e}"),
            }
        }

        // IPv6 — not routed through this tunnel.
        TunnResult::WriteToTunnelV6(_data, _src_addr) => {}

        // No output needed (e.g. timer tick with nothing to send).
        TunnResult::Done => {}

        // Protocol-level error — log but continue; the tunnel may recover.
        TunnResult::Err(e) => eprintln!("[tunnel] boringtun error: {e:?}"),
    }
}

// ── parse_conf ────────────────────────────────────────────────────────────────

/// Parse a WireGuard `.conf` file into a [`TunnelConfig`].
///
/// Recognised keys
/// ---------------
/// `[Interface]`: `PrivateKey`, `Address`, `MTU`  
/// `[Peer]`:      `PublicKey`, `Endpoint`, `PersistentKeepalive`
///
/// Unknown keys and comment lines (`#`) are silently ignored.
///
/// # Errors
/// Returns a human-readable `String` if any mandatory key is missing, a
/// key value is malformed, or the Endpoint cannot be resolved.
pub fn parse_conf(conf_content: &str) -> Result<TunnelConfig, String> {
    let mut private_key_bytes:     Option<[u8; 32]> = None;
    let mut peer_public_key_bytes: Option<[u8; 32]> = None;
    let mut server_endpoint:       Option<SocketAddr> = None;
    let mut tunnel_ip:             Option<Ipv4Addr> = None;
    let mut mtu:                   u16 = 1420;
    let mut keepalive:             Option<u16> = None;

    for raw in conf_content.lines() {
        let line = raw.trim();

        // Skip blank lines, comments, and section headers.
        if line.is_empty() || line.starts_with('#') || line.starts_with('[') {
            continue;
        }

        // Split on the FIRST `=` only; values may contain `=` (e.g. base64).
        let Some(eq) = line.find('=') else { continue };
        let key = line[..eq].trim();
        let val = line[eq + 1..].trim();

        match key {
            "PrivateKey" => {
                let raw_bytes = base64::engine::general_purpose::STANDARD
                    .decode(val)
                    .map_err(|e| format!("PrivateKey: base64 decode error — {e}"))?;
                private_key_bytes = Some(
                    raw_bytes
                        .try_into()
                        .map_err(|_| "PrivateKey must be exactly 32 bytes".to_string())?,
                );
            }

            "PublicKey" => {
                let raw_bytes = base64::engine::general_purpose::STANDARD
                    .decode(val)
                    .map_err(|e| format!("PublicKey: base64 decode error — {e}"))?;
                peer_public_key_bytes = Some(
                    raw_bytes
                        .try_into()
                        .map_err(|_| "PublicKey must be exactly 32 bytes".to_string())?,
                );
            }

            "Address" => {
                // Accept "10.8.0.2/24" or plain "10.8.0.2".
                let ip_str = val.split('/').next().unwrap_or(val);
                tunnel_ip = Some(
                    ip_str
                        .parse::<Ipv4Addr>()
                        .map_err(|e| format!("Address '{ip_str}': {e}"))?,
                );
            }

            "MTU" => {
                mtu = val
                    .parse()
                    .map_err(|e| format!("MTU '{val}': {e}"))?;
            }

            "Endpoint" => {
                // Supports both "1.2.3.4:51820" and "hostname:51820".
                let addr = val
                    .to_socket_addrs()
                    .map_err(|e| format!("Endpoint '{val}': cannot resolve — {e}"))?
                    .find(|a| a.is_ipv4())
                    .ok_or_else(|| format!("Endpoint '{val}': no IPv4 address found"))?;
                server_endpoint = Some(addr);
            }

            "PersistentKeepalive" => {
                keepalive = Some(
                    val.parse()
                        .map_err(|e| format!("PersistentKeepalive '{val}': {e}"))?,
                );
            }

            _ => {} // Ignore DNS, AllowedIPs, PreUp, etc.
        }
    }

    // ── Mandatory field validation ────────────────────────────────────────────
    let priv_bytes = private_key_bytes
        .ok_or("Missing 'PrivateKey' in [Interface] section")?;
    let peer_bytes = peer_public_key_bytes
        .ok_or("Missing 'PublicKey' in [Peer] section")?;
    let endpoint   = server_endpoint
        .ok_or("Missing 'Endpoint' in [Peer] section")?;
    let tun_ip     = tunnel_ip
        .ok_or("Missing 'Address' in [Interface] section")?;

    Ok(TunnelConfig {
        private_key_bytes:     priv_bytes,
        peer_public_key_bytes: peer_bytes,
        server_endpoint:       endpoint,
        tunnel_ip:             tun_ip,
        mtu,
        keepalive,
    })
}
