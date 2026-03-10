/// lib.rs — Tauri v2 application core for Arma 3 Session Bridge Windows Client
///
/// Exports:
///   - Tauri commands: connect_vpn, disconnect_vpn, check_vpn_status,
///     get_sessions, host_session, join_session, send_heartbeat,
///     validate_conf, check_peer_exists, delete_conf_file,
///     get_host_ip, download_peer_config, generate_and_register_peer
///   - System-Tray with: Connect / Disconnect / Quit menu items
///   - Auto-Heartbeat: sends PUT /sessions/{id}/heartbeat every 60 s when hosting
///   - `run()` — entry point called from main.rs

pub mod vpn;
#[cfg(target_os = "windows")]
pub mod tunnel;
#[cfg(target_os = "windows")]
pub mod native_ping;
pub mod vpn_state;


// Platform-independent ping shim: on Windows uses native ICMP, elsewhere always None.
#[cfg(target_os = "windows")]
use native_ping::ping as platform_ping;
#[cfg(not(target_os = "windows"))]
fn platform_ping(_addr: std::net::Ipv4Addr, _timeout_ms: u32) -> Option<u32> { None }

use std::sync::Arc;

use serde::{de, Deserialize, Deserializer, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, State,
};
use tokio::sync::Mutex as AsyncMutex;

use vpn::VpnStatus;

// ─── Config Path ───────────────────────────────────────────────────────────────

/// Persistent app config (api_url stored here after first-run wizard).
const APP_CONFIG_PATH: &str = r"C:\ProgramData\arma3-session-bridge\config.json";

// ─── Shared Application State ─────────────────────────────────────────────────

/// State managed by Tauri — available in all commands via `State<'_, AppState>`.
pub struct AppState {
    /// Tray icon ID for tooltip updates (retrieved via `app.tray_by_id`).
    pub tray_id: String,
    /// ID of the currently hosted session, `None` if not hosting.
    /// Used by the background heartbeat task.
    pub active_session_id: Arc<AsyncMutex<Option<String>>>,
    /// Path to the active WireGuard .conf file, `None` if disconnected.
    /// Used by the background auto-reconnect task.
    pub active_conf_path: Arc<AsyncMutex<Option<String>>>,
    /// VPN lifecycle state machine — single source of truth for VPN state.
    /// Gates heartbeat and reconnect loops; emits `vpn-state-changed` events.
    pub vpn_sm: Arc<AsyncMutex<crate::vpn_state::VpnStateMachine>>,
}

// ─── Session Struct ────────────────────────────────────────────────────────────

/// Session returned by `GET /sessions` or `POST /sessions` from the bridge API.
fn de_session_id<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::String(s) => Ok(s),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        _ => Err(de::Error::custom("session.id must be string or number")),
    }
}

fn de_string_or_untitled<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    match value {
        serde_json::Value::String(s) => {
            if s.trim().is_empty() {
                Ok("Untitled Session".to_string())
            } else {
                Ok(s)
            }
        }
        serde_json::Value::Null => Ok("Untitled Session".to_string()),
        _ => Ok("Untitled Session".to_string()),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    #[serde(deserialize_with = "de_session_id")]
    pub id: String,
    #[serde(deserialize_with = "de_string_or_untitled")]
    pub mission_name: String,
    pub host_tunnel_ip: String,
    pub current_players: u32,
    pub max_players: u32,
    pub status: String,
}

// ─── Connection Info Struct ───────────────────────────────────────────────────

/// Diagnostic snapshot of the current VPN connection.
#[derive(Debug, Clone, Serialize)]
pub struct ConnectionInfo {
    pub tunnel_ip: Option<String>,
    pub server_url: Option<String>,
    /// "split-tunnel" or "full-tunnel"
    pub vpn_mode: String,
    pub api_latency_ms: Option<u64>,
    pub wireguard_installed: bool,
    pub peer_name: Option<String>,
}


/// A peer currently connected to the WireGuard VPN.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OnlinePeer {
    pub name: String,
    pub tunnel_ip: String,
    pub connection_quality: String,
    pub last_handshake_ago: Option<i64>,
}

/// Own peer stats returned by `GET /peers/me`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MyPeerStats {
    pub name: String,
    pub tunnel_ip: String,
    pub connection_quality: String,
    pub last_handshake_ago: Option<i64>,
    pub rx_bytes: u64,
    pub tx_bytes: u64,
}

/// Result of a ping/latency measurement to the VPN gateway.
#[derive(Debug, Clone, Serialize)]
pub struct PingResult {
    pub gateway_ip: String,
    pub latency_ms: Option<u64>,
    pub reachable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FirewallSetupResult {
    pub rules_added: Vec<String>,
    pub rules_existed: Vec<String>,
    pub success: bool,
    pub error: Option<String>,
}

/// Result of a peer-to-peer ping/latency measurement inside the VPN tunnel.
#[derive(Debug, Clone, Serialize)]
pub struct PeerPingResult {
    pub ip: String,
    pub latency_ms: Option<u64>,
    pub reachable: bool,
    pub packet_loss_pct: u8,
}
// ─── API URL Helpers ───────────────────────────────────────────────────────────

/// Load the API base URL from the persisted config file.
///
/// Returns `Err` if the file doesn't exist or `api_url` key is missing.
fn load_api_url() -> Result<String, String> {
    let content = std::fs::read_to_string(APP_CONFIG_PATH)
        .map_err(|e| format!("Failed to read app config: {e}"))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse app config: {e}"))?;
    json["api_url"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "api_url not found in config.json".to_string())
}

/// Save the API base URL to the persisted config file.
///
/// Creates `C:\ProgramData\arma3-session-bridge\` if it doesn't exist.
fn save_api_url(api_url: &str) -> Result<(), String> {
    let config_dir = r"C:\ProgramData\arma3-session-bridge";
    std::fs::create_dir_all(config_dir)
        .map_err(|e| format!("Failed to create config directory: {e}"))?;
    let json = serde_json::json!({ "api_url": api_url });
    std::fs::write(APP_CONFIG_PATH, json.to_string())
        .map_err(|e| format!("Failed to write app config: {e}"))
}

/// Save the API URL and peer token together in the config file.
fn save_config(api_url: &str, peer_token: &str) -> Result<(), String> {
    let config_dir = r"C:\ProgramData\arma3-session-bridge";
    std::fs::create_dir_all(config_dir)
        .map_err(|e| format!("Failed to create config directory: {e}"))?;
    let json = serde_json::json!({
        "api_url": api_url,
        "peer_token": peer_token,
    });
    std::fs::write(APP_CONFIG_PATH, json.to_string())
        .map_err(|e| format!("Failed to write app config: {e}"))
}

/// Load the peer JWT token from the config file.
fn load_peer_token() -> Result<String, String> {
    let content = std::fs::read_to_string(APP_CONFIG_PATH)
        .map_err(|e| format!("Failed to read app config: {e}"))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse app config: {e}"))?;
    let token = json["peer_token"]
        .as_str()
        .ok_or_else(|| "peer_token not found in config.json".to_string())?
        .trim()
        .to_string();

    if token.is_empty() {
        return Err("peer_token is empty in config.json".to_string());
    }

    Ok(token)
}

// ─── VPN Commands ─────────────────────────────────────────────────────────────

/// Install the WireGuard tunnel service (Connect VPN).
///
/// Updates the tray tooltip to show the assigned tunnel IP.
///
/// Invoked from frontend: `invoke('connect_vpn', { confPath: '...' })`
#[tauri::command]
async fn connect_vpn(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    conf_path: String,
) -> Result<String, String> {
    vpn::connect_vpn(&conf_path)?;
    // Spawn firewall setup non-blocking — must not delay connect response
    let app_fw = app.clone();
    tauri::async_runtime::spawn(async move {
        let fw_result = tokio::task::spawn_blocking(setup_firewall_rules_internal)
            .await
            .unwrap_or_else(|e| FirewallSetupResult {
                rules_added: vec![],
                rules_existed: vec![],
                success: false,
                error: Some(e.to_string()),
            });
        let _ = app_fw.emit("firewall-setup-result", fw_result);
    });
    let ip = vpn::get_tunnel_ip().unwrap_or_else(|_| "connected".to_string());
    // Save conf_path for auto-reconnect
    {
        let mut lock = state.active_conf_path.lock().await;
        *lock = Some(conf_path.clone());
    }
    // Update tray tooltip to show assigned tunnel IP
    if let Some(tray) = app.tray_by_id(state.tray_id.as_str()) {
        let _ = tray.set_tooltip(Some(
            format!("Connected: {}", ip).as_str(),
        ));
    }
    Ok(format!("VPN connected — Tunnel IP: {}", ip))
}

/// Uninstall the WireGuard tunnel service (Disconnect VPN).
///
/// Clears the active session ID (stops heartbeat) and resets tray tooltip.
///
/// Invoked from frontend: `invoke('disconnect_vpn', { tunnelName: '...' })`
#[tauri::command]
async fn disconnect_vpn(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    tunnel_name: String,
) -> Result<String, String> {
    vpn::disconnect_vpn(&tunnel_name)?;
    // Clear session ID so heartbeat loop stops sending
    {
        let mut lock = state.active_session_id.lock().await;
        *lock = None;
    }
    // Clear conf path so reconnect loop stops
    {
        let mut lock = state.active_conf_path.lock().await;
        *lock = None;
    }
    // Reset tray tooltip
    if let Some(tray) = app.tray_by_id(state.tray_id.as_str()) {
        let _ = tray.set_tooltip(Some("Disconnected"));
    }
    Ok("VPN disconnected".to_string())
}

/// Check whether the WireGuard tunnel service is currently running.
///
/// Invoked from frontend: `invoke('check_vpn_status', { tunnelName: '...' })`
///
/// Returns [`VpnStatus`] with `connected`, `tunnel_ip`, `tunnel_name`.
#[tauri::command]
fn check_vpn_status(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    tunnel_name: String,
) -> Result<VpnStatus, String> {
    let status = vpn::check_vpn_status(&tunnel_name)?;

    // Update tray tooltip to reflect current connection state
    if let Some(tray) = app.tray_by_id(state.tray_id.as_str()) {
        let tooltip = if status.connected {
            let ip = status.tunnel_ip.as_deref().unwrap_or("unknown");
            format!("Connected: {}", ip)
        } else {
            "Disconnected".to_string()
        };
        let _ = tray.set_tooltip(Some(tooltip.as_str()));
    }

    Ok(status)
}

// ─── Session Commands ─────────────────────────────────────────────────────────

/// Fetch the list of active Arma 3 sessions from the bridge API.
///
/// Calls `GET /sessions` and returns a typed array of [`Session`].
///
/// Invoked from frontend: `invoke('get_sessions')`
#[tauri::command]
async fn get_sessions() -> Result<Vec<Session>, String> {
    let base = load_api_url()?;
    let url = format!("{}/sessions", base);

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("API error {}: {}", response.status(), response.status().canonical_reason().unwrap_or("Unknown")));
    }

    response
        .json::<Vec<Session>>()
        .await
        .map_err(|e| format!("Failed to parse sessions JSON: {e}"))
}

/// Create a new hosted session on the bridge API.
///
/// Calls `POST /sessions` with `{ mission_name, max_players }` and returns the
/// created [`Session`]. Stores the session ID in [`AppState`] so the background
/// heartbeat task can keep it alive.
///
/// Invoked from frontend: `invoke('host_session', { missionName, maxPlayers })`
#[tauri::command]
async fn host_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mission_name: String,
    max_players: u32,
) -> Result<Session, String> {
    let base = load_api_url()?;
    let url = format!("{}/sessions", base);
    let body = serde_json::json!({
        "mission_name": mission_name,
        "max_players": max_players,
        "current_players": 1,
    });

    let token = load_peer_token()
        .map_err(|e| format!("No peer token — please re-run setup wizard: {e}"))?;

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !response.status().is_success() {
        let err_body = response.text().await.unwrap_or_default();
        return Err(format!("API error: {}", err_body));
    }

    let session = response
        .json::<Session>()
        .await
        .map_err(|e| format!("Failed to parse session JSON: {e}"))?;

    // Store session ID for auto-heartbeat
    {
        let mut lock = state.active_session_id.lock().await;
        *lock = Some(session.id.clone());
    }

    // Update tray tooltip to indicate hosting
    if let Some(tray) = app.tray_by_id(state.tray_id.as_str()) {
        let _ = tray.set_tooltip(Some(
            format!("Arma 3 — Hosting: {}", mission_name).as_str(),
        ));
    }

    Ok(session)
}

/// Retrieve the host tunnel IP for a session (used to join in ArmA 3).
///
/// Calls `GET /sessions/{session_id}` and returns `host_tunnel_ip`.
///
/// Invoked from frontend: `invoke('join_session', { sessionId })`
#[tauri::command]
async fn join_session(session_id: String) -> Result<String, String> {
    let base = load_api_url()?;
    let url = format!("{}/sessions/{}", base, session_id);

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Session not found or API error: {}", response.status()));
    }

    let session = response
        .json::<Session>()
        .await
        .map_err(|e| format!("Failed to parse session JSON: {e}"))?;

    Ok(session.host_tunnel_ip)
}

/// Manually send a heartbeat for the current session.
///
/// Calls `PUT /sessions/{session_id}/heartbeat`.
///
/// Invoked from frontend: `invoke('send_heartbeat', { sessionId })`
#[tauri::command]
async fn send_heartbeat(session_id: String) -> Result<(), String> {
    let base = load_api_url()?;
    let url = format!("{}/sessions/{}/heartbeat", base, session_id);

    let token = load_peer_token()
        .map_err(|e| format!("No peer token — please re-run setup wizard: {e}"))?;

    let client = reqwest::Client::new();
    let response = client
        .put(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Heartbeat API error: {}", response.status()));
    }

    Ok(())
}

// ─── Config Commands ──────────────────────────────────────────────────────────

/// Validate a WireGuard .conf file for correct Split-Tunnel configuration.
///
/// Checks that the file:
///   - Contains the `[Interface]` section header
///   - Has `AllowedIPs` with `10.8.0.0/24` (split-tunnel only)
///   - Does NOT have `0.0.0.0/0` on any AllowedIPs line (no full-tunnel)
///
/// Returns `Ok(false)` when the file does not exist (first-run).
///
/// Invoked from frontend: `invoke('validate_conf', { path: '...' })`
#[tauri::command]
fn has_peer_token() -> bool {
    load_peer_token().is_ok()
}

#[tauri::command]
fn validate_conf(path: String) -> Result<bool, String> {
    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        // File missing → first run, not an error
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(format!("Failed to read conf file: {e}")),
    };

    let has_interface = content.contains("[Interface]");

    // AllowedIPs line must include 10.8.0.0/24 and must NOT include 0.0.0.0/0
    let has_split_tunnel = content.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.starts_with("AllowedIPs")
            && trimmed.contains("10.8.0.0/24")
            && !trimmed.contains("0.0.0.0/0")
    });

    // Conf must NOT still contain the private-key placeholder
    let has_real_key = !content.contains("<INSERT_PRIVATE_KEY_FROM_CREATION_RESPONSE>");

    Ok(has_interface && has_split_tunnel && has_real_key)
}

/// Check whether the registered peer still exists on the server.
///
/// Reads the peer name from the `# PeerName:` comment in the .conf file,
/// falls back to the filename stem. Then calls `GET {api_url}/peers/{name}/config`.
///
/// Returns `true` on HTTP 200, `false` on 404 or network error.
/// Returns `true` as a safe fallback if no API URL is configured yet.
///
/// Invoked from frontend: `invoke('check_peer_exists', { confPath: '...' })`
#[tauri::command]
async fn check_peer_exists(conf_path: String) -> Result<bool, String> {
    // Read conf file — if missing, peer obviously doesn't exist locally
    let content = match std::fs::read_to_string(&conf_path) {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };

    // Extract peer name from "# PeerName: <name>" comment, fall back to filename stem
    let peer_name = content
        .lines()
        .find_map(|line| {
            let trimmed = line.trim();
            if trimmed.starts_with("# PeerName:") {
                let name = trimmed.trim_start_matches("# PeerName:").trim().to_string();
                if !name.is_empty() { Some(name) } else { None }
            } else {
                None
            }
        })
        .or_else(|| {
            std::path::Path::new(&conf_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_string())
        })
        .filter(|n| !n.is_empty());

    let peer_name = match peer_name {
        Some(n) => n,
        None => return Ok(false),
    };

    // No config.json → no API URL → peer cannot exist → force setup wizard
    let api_url = match load_api_url() {
        Ok(url) => url,
        Err(_) => return Ok(false), // No config.json → force re-setup wizard
    };

    let url = format!("{}/peers/{}/config", api_url.trim_end_matches('/'), peer_name);

    match reqwest::get(&url).await {
        Ok(response) => Ok(response.status() == reqwest::StatusCode::OK),
        Err(_) => Ok(false),
    }
}

/// Delete the WireGuard .conf file from disk.
///
/// Called when the peer no longer exists on the server, forcing re-registration.
///
/// Invoked from frontend: `invoke('delete_conf_file', { path: '...' })`
#[tauri::command]
fn delete_conf_file(path: String) -> Result<(), String> {
    std::fs::remove_file(&path)
        .map_err(|e| format!("Failed to delete conf file: {e}"))
}

/// Get the current WireGuard tunnel IP address.
///
/// Delegates to [`vpn::get_tunnel_ip`] which scans active network interfaces
/// for a `10.8.0.x` address.
///
/// Invoked from frontend: `invoke('get_host_ip')`
#[tauri::command]
fn get_host_ip() -> Result<String, String> {
    vpn::get_tunnel_ip()
}

/// Download a peer's WireGuard config from the bridge API and save to disk.
///
/// Calls `GET {api_url}/peers/{peer_id}/config` and writes the response body
/// to `save_path`, creating parent directories if needed.
///
/// Invoked from frontend:
///   `invoke('download_peer_config', { apiUrl, peerId, savePath })`
#[tauri::command]
async fn download_peer_config(
    api_url: String,
    peer_id: String,
    save_path: String,
    token: Option<String>,
) -> Result<(), String> {
    let url = format!("{}/peers/{}/config", api_url.trim_end_matches('/'), peer_id);

    let client = reqwest::Client::new();
    let mut req = client.get(&url);
    if let Some(ref t) = token {
        req = req.header("Authorization", format!("Bearer {}", t));
    }
    let response = req
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "API error {}: {}",
            response.status(),
            response.status().canonical_reason().unwrap_or("Unknown")
        ));
    }

    let content = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    // Create parent directories if they don't exist (e.g. C:\ProgramData\WireGuard\)
    if let Some(parent) = std::path::Path::new(&save_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {e}"))?;
    }

    std::fs::write(&save_path, content)
        .map_err(|e| format!("Failed to write conf file: {e}"))?;

    Ok(())
}


// ─── Self-Service Peer Registration ───────────────────────────────────────────

/// Generate a WireGuard keypair in-process using x25519-dalek (no wg.exe needed),
/// register the peer at the server via POST /peers/register, and write the
/// completed .conf to disk.
///
/// Flow:
///   1. Generate Curve25519 keypair locally (private + public key, base64)
///   2. POST {api_url}/peers/register { name, public_key } with Bearer token
///   3. Replace placeholder in returned .conf with real private_key
///   4. Prepend `# PeerName: {name}` comment as first line
///   5. Write .conf to save_path
///   6. Persist api_url to C:\ProgramData\arma3-session-bridge\config.json
///
/// Invoked from frontend:
///   `invoke('generate_and_register_peer', { apiUrl, peerName, savePath, registrationCode })`
#[tauri::command]
async fn generate_and_register_peer(
    api_url: String,
    peer_name: String,
    save_path: String,
    registration_code: String,
) -> Result<(), String> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use rand::rngs::OsRng;
    use x25519_dalek::{PublicKey, StaticSecret};

    // Generate WireGuard keypair in-process — no wg.exe required
    let private_secret = StaticSecret::random_from_rng(OsRng);
    let public_key = PublicKey::from(&private_secret);
    let private_key_b64 = STANDARD.encode(private_secret.as_bytes());
    let public_key_b64 = STANDARD.encode(public_key.as_bytes());

    // Register peer on server
    let url = format!("{}/peers/register", api_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("X-Registration-Code", &registration_code)
        .json(&serde_json::json!({
            "name": peer_name,
            "public_key": public_key_b64,
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = response.status();
    if status != reqwest::StatusCode::CREATED && !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Registration failed (HTTP {}): {}", status, body));
    }

    // Extract peer JWT from response header (needed for session auth)
    let peer_token = response
        .headers()
        .get("x-peer-token")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // Server returns .conf template — replace placeholder with real private key
    let conf_template = response
        .text()
        .await
        .map_err(|e| format!("Failed to read registration response: {e}"))?;

    // Prepend PeerName comment (first line) so check_peer_exists can find it later
    let conf_content = format!(
        "# PeerName: {}\n{}",
        peer_name,
        conf_template.replace("<INSERT_PRIVATE_KEY_FROM_CREATION_RESPONSE>", &private_key_b64)
    );

    // Write .conf to disk
    if let Some(parent) = std::path::Path::new(&save_path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {e}"))?;
    }
    std::fs::write(&save_path, &conf_content)
        .map_err(|e| format!("Failed to write conf file: {e}"))?;

    // Persist API URL + peer token so all subsequent commands can find the server
    save_config(&api_url, &peer_token)?;

    Ok(())
}

// ─── Connection Info Command ──────────────────────────────────────────────────

/// Return a diagnostic snapshot of the current VPN connection.
///
/// Invoked from frontend: `invoke('get_connection_info')`
#[tauri::command]
async fn get_connection_info() -> Result<ConnectionInfo, String> {
    const CONF_PATH: &str = r"C:\ProgramData\WireGuard\arma3-session-bridge.conf";

    // Tunnel IP
    let tunnel_ip = vpn::get_tunnel_ip().ok();

    // Server URL from persisted config
    let server_url = load_api_url().ok();

    // Read conf file once — used for vpn_mode and peer_name
    let conf_content = std::fs::read_to_string(CONF_PATH).ok();

    // VPN mode: full-tunnel if any AllowedIPs line contains 0.0.0.0/0
    let vpn_mode = conf_content.as_deref().map(|content| {
        let is_full_tunnel = content.lines().any(|line| {
            let t = line.trim();
            t.starts_with("AllowedIPs") && t.contains("0.0.0.0/0")
        });
        if is_full_tunnel { "full-tunnel".to_string() } else { "split-tunnel".to_string() }
    }).unwrap_or_else(|| "split-tunnel".to_string());

    // Peer name from "# PeerName: <name>" comment in conf
    let peer_name = conf_content.as_deref().and_then(|content| {
        content.lines().find_map(|line| {
            let trimmed = line.trim();
            if trimmed.starts_with("# PeerName:") {
                let name = trimmed.trim_start_matches("# PeerName:").trim().to_string();
                if !name.is_empty() { Some(name) } else { None }
            } else {
                None
            }
        })
    });

    // WireGuard binary presence check
    let wireguard_installed =
        std::path::Path::new(r"C:\Program Files\WireGuard\wireguard.exe").exists();

    // API latency — GET {server_url}/health with 5 s timeout
    let api_latency_ms = if let Some(ref url) = server_url {
        let health_url = format!("{}/health", url.trim_end_matches('/'));
        match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
        {
            Ok(client) => {
                let start = std::time::Instant::now();
                match client.get(&health_url).send().await {
                    Ok(_) => Some(start.elapsed().as_millis() as u64),
                    Err(_) => None,
                }
            }
            Err(_) => None,
        }
    } else {
        None
    };

    Ok(ConnectionInfo {
        tunnel_ip,
        server_url,
        vpn_mode,
        api_latency_ms,
        wireguard_installed,
        peer_name,
    })
}


// ─── Online Peers Command ─────────────────────────────────────────────────────────────

/// Fetch the list of currently online peers from the bridge API.
///
/// Calls `GET /peers/online` with the stored peer token.
///
/// Invoked from frontend: `invoke('get_online_peers')`
#[tauri::command]
async fn get_online_peers() -> Result<Vec<OnlinePeer>, String> {
    let base = load_api_url()?;
    let token = load_peer_token()?;
    let url = format!("{}/peers/online", base.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("API error {}: {}", response.status(), response.status().canonical_reason().unwrap_or("Unknown")));
    }

    response
        .json::<Vec<OnlinePeer>>()
        .await
        .map_err(|e| format!("Failed to parse online peers JSON: {e}"))
}

// ─── Disconnect Notify Command ────────────────────────────────────────────────────────

/// Notify the server that this peer is disconnecting gracefully.
///
/// Calls `POST /peers/disconnect` with the stored peer token.
/// This allows the server to immediately mark the peer as offline
/// instead of waiting for the WireGuard handshake timeout.
///
/// Invoked from frontend: `invoke('notify_disconnect')`
#[tauri::command]
async fn notify_disconnect() -> Result<(), String> {
    let base = load_api_url()?;
    let token = load_peer_token()?;
    let url = format!("{}/peers/disconnect", base.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    // Fire-and-forget style: we try our best but don't block disconnect
    let _ = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await;

    Ok(())
}

/// Fetch the current VPN mode from the server API.
///
/// Calls `GET /vpn-mode` (no auth required).
///
/// Invoked from frontend: `invoke('get_vpn_mode')`
#[tauri::command]
async fn get_vpn_mode() -> Result<String, String> {
    let base = load_api_url()?;
    let url = format!("{}/vpn-mode", base.trim_end_matches('/'));

    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !response.status().is_success() {
        return Ok("arma3".to_string()); // default fallback
    }

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse VPN mode JSON: {e}"))?;

    Ok(body["mode"].as_str().unwrap_or("arma3").to_string())
}


// ─── My Stats Command ─────────────────────────────────────────────────────────

/// Fetch the calling peer's own WireGuard stats from the server.
///
/// Calls `GET /peers/me` with the stored peer token.
/// Returns traffic bytes, connection quality, and handshake info.
///
/// Invoked from frontend: `invoke('get_my_stats')`
#[tauri::command]
async fn get_my_stats() -> Result<MyPeerStats, String> {
    let base = load_api_url()?;
    let token = load_peer_token()?;
    let url = format!("{}/peers/me", base.trim_end_matches('/'));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("API error {}", response.status()));
    }

    response
        .json::<MyPeerStats>()
        .await
        .map_err(|e| format!("Failed to parse peer stats JSON: {e}"))
}


// ─── Ping Gateway Command ─────────────────────────────────────────────────────

/// Ping the VPN gateway (10.8.0.1) and return the latency.
///
/// Uses Windows `ping -n 1 -w 3000` and parses the output.
/// Falls back to HTTP latency if ICMP fails.
///
/// Invoked from frontend: `invoke('ping_gateway')`
#[tauri::command]
async fn ping_gateway() -> Result<PingResult, String> {
    let gateway = "10.8.0.1";
    let addr: std::net::Ipv4Addr = gateway.parse().unwrap();

    // Try native ICMP ping first
    if let Some(ms) = platform_ping(addr, 3000) {
        return Ok(PingResult {
            gateway_ip: gateway.to_string(),
            latency_ms: Some(ms as u64),
            reachable: true,
        });
    }

    // Fallback: HTTP latency to API through tunnel
    if let Ok(base) = load_api_url() {
        let health_url = format!("{}/health", base.trim_end_matches('/'));
        if let Ok(client) = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(3))
            .build()
        {
            let start = std::time::Instant::now();
            if client.get(&health_url).send().await.is_ok() {
                return Ok(PingResult {
                    gateway_ip: gateway.to_string(),
                    latency_ms: Some(start.elapsed().as_millis() as u64),
                    reachable: true,
                });
            }
        }
    }

    Ok(PingResult {
        gateway_ip: gateway.to_string(),
        latency_ms: None,
        reachable: false,
    })
}


// ─── Firewall Setup ───────────────────────────────────────────────────────────

/// Run PowerShell to idempotently create 3 Windows Firewall rules for Arma 3 VPN.
/// Returns `FirewallSetupResult` — never returns `Err`; errors are encoded in the result.
fn setup_firewall_rules_internal() -> FirewallSetupResult {
    let script = r#"
$rules_added = @()
$rules_existed = @()

$defs = @(
    @{Name="Arma3SB-VPNInbound"; Direction="Inbound"; RemoteAddress="10.8.0.0/24"; Protocol="Any"},
    @{Name="Arma3SB-GamePorts"; Direction="Inbound"; Protocol="UDP"; LocalPort="2302-2306"},
    @{Name="Arma3SB-WGOutbound"; Direction="Outbound"; Protocol="UDP"; RemotePort="51820"}
)

foreach ($def in $defs) {
    $existing = Get-NetFirewallRule -DisplayName $def.Name -ErrorAction SilentlyContinue
    if ($existing) {
        $rules_existed += $def.Name
    } else {
        $params = @{
            DisplayName = $def.Name
            Direction   = $def.Direction
            Action      = "Allow"
            Profile     = "Any"
            Enabled     = "True"
        }
        if ($def.Protocol -ne "Any") { $params.Protocol = $def.Protocol }
        if ($def.RemoteAddress) { $params.RemoteAddress = $def.RemoteAddress }
        if ($def.LocalPort) { $params.LocalPort = $def.LocalPort }
        if ($def.RemotePort) { $params.RemotePort = $def.RemotePort }
        New-NetFirewallRule @params | Out-Null
        $rules_added += $def.Name
    }
}

[pscustomobject]@{rules_added=$rules_added; rules_existed=$rules_existed; success=$true; error=$null} | ConvertTo-Json -Compress
"#;

    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000_u32);
    }

    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            return FirewallSetupResult {
                rules_added: vec![],
                rules_existed: vec![],
                success: false,
                error: Some(format!("Firewall-Regeln konnten nicht gesetzt werden. Bitte als Administrator ausführen.: {e}")),
            };
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stderr.contains("Access is denied") || stderr.contains("Zugriff verweigert") {
        return FirewallSetupResult {
            rules_added: vec![],
            rules_existed: vec![],
            success: false,
            error: Some("Firewall-Regeln konnten nicht gesetzt werden. Bitte als Administrator ausführen.".to_string()),
        };
    }

    match serde_json::from_str::<FirewallSetupResult>(&stdout) {
        Ok(result) => result,
        Err(_) => FirewallSetupResult {
            rules_added: vec![],
            rules_existed: vec![],
            success: false,
            error: Some("Firewall-Regeln konnten nicht gesetzt werden. Bitte als Administrator ausführen.".to_string()),
        },
    }
}

/// Expose `setup_firewall_rules_internal` as a Tauri command (async wrapper).
#[tauri::command]
async fn setup_firewall_rules() -> Result<FirewallSetupResult, String> {
    tokio::task::spawn_blocking(setup_firewall_rules_internal)
        .await
        .map_err(|e| e.to_string())
}

// ─── Peer Ping Command ────────────────────────────────────────────────────────

/// Ping a specific peer inside the WireGuard tunnel (10.8.0.x) and return latency.
///
/// Invoked from frontend: `invoke('ping_peer', { tunnelIp: '10.8.0.x' })`
#[tauri::command]
async fn ping_peer(tunnel_ip: String) -> Result<PeerPingResult, String> {
    if !tunnel_ip.starts_with("10.8.0.") {
        return Err(format!("Ungültige Tunnel-IP: muss 10.8.0.x sein, bekam: {tunnel_ip}"));
    }

    let addr: std::net::Ipv4Addr = tunnel_ip.parse()
        .map_err(|e| format!("Invalid IP: {e}"))?;

    let latency_ms = platform_ping(addr, 5000).map(|v| v as u64);
    let reachable = latency_ms.is_some();
    let packet_loss_pct: u8 = if reachable { 0 } else { 100 };

    Ok(PeerPingResult {
        ip: tunnel_ip,
        latency_ms,
        reachable,
        packet_loss_pct,
    })
}

// ─── Deep Diagnostics ────────────────────────────────────────────────────────

/// A single diagnostic check result.
#[derive(Debug, Clone, Serialize)]
pub struct DiagStep {
    pub id: String,
    pub label: String,
    /// "pass", "fail", "warn", "skip"
    pub status: String,
    pub detail: Option<String>,
    /// Auto-fix action ID: "reconnect", "reregister", "install_wg", "fix_firewall", or null
    pub fix_action: Option<String>,
}

/// Full diagnostic result returned by deep_diagnose.
#[derive(Debug, Clone, Serialize)]
pub struct DeepDiagnoseResult {
    pub steps: Vec<DiagStep>,
    /// "healthy", "degraded", "broken"
    pub overall: String,
    pub problems: Vec<String>,
    pub suggestions: Vec<String>,
    pub wg_log: Option<String>,
    pub config_sanitized: Option<String>,
    pub raw_adapter_info: Option<String>,
}

const CONF_PATH_WG: &str = r"C:\ProgramData\WireGuard\arma3-session-bridge.conf";

fn deep_diagnose_sync() -> Result<DeepDiagnoseResult, String> {
    let mut steps: Vec<DiagStep> = Vec::new();
    let mut problems: Vec<String> = Vec::new();
    let mut suggestions: Vec<String> = Vec::new();
    let mut wg_log: Option<String> = None;
    let mut config_sanitized: Option<String> = None;
    let mut raw_adapter_info: Option<String> = None;
    let mut server_public_key: Option<String> = None;

    // ── Check 1: WireGuard installed ─────────────────────────────────────────
    let wg_installed = true; // Embedded WireGuard tunnel — always available
    steps.push(DiagStep {
        id: "wg_installed".into(),
        label: "WireGuard installed".into(),
        status: if wg_installed { "pass" } else { "fail" }.into(),
        detail: if wg_installed { None } else { Some("WireGuard is not installed on this system".into()) },
        fix_action: if wg_installed { None } else { Some("install_wg".into()) },
    });
    if !wg_installed {
        problems.push("WireGuard is NOT installed".into());
        suggestions.push("Install WireGuard from https://www.wireguard.com/install/".into());
    }

    // ── Check 2: Config file exists ──────────────────────────────────────────
    let config_exists = std::fs::metadata(CONF_PATH_WG).is_ok();
    steps.push(DiagStep {
        id: "config_exists".into(),
        label: "Config file found".into(),
        status: if config_exists { "pass" } else { "fail" }.into(),
        detail: if config_exists { Some(format!("Path: {}", CONF_PATH_WG)) } else { Some(format!("Not found: {}", CONF_PATH_WG)) },
        fix_action: if config_exists { None } else { Some("reregister".into()) },
    });
    if !config_exists {
        problems.push("Config file missing".into());
        suggestions.push("Re-register your device via the Setup Wizard".into());
    }

    // ── Check 3: Config valid ────────────────────────────────────────────────
    let conf_content = std::fs::read_to_string(CONF_PATH_WG).ok();
    if let Some(ref content) = conf_content {
        let has_interface = content.contains("[Interface]");
        let has_peer = content.contains("[Peer]");
        let has_placeholder = content.contains("<INSERT_PRIVATE_KEY_FROM_CREATION_RESPONSE>");
        let has_endpoint = content.lines().any(|l| {
            let t = l.trim();
            t.starts_with("Endpoint") && t.contains(':') && t.len() > 10
        });
        let has_allowed_ips = content.lines().any(|l| {
            let t = l.trim();
            t.starts_with("AllowedIPs") && t.contains("10.8.0.0/24")
        });
        let has_bad_route = content.lines().any(|l| {
            let t = l.trim();
            t.starts_with("AllowedIPs") && t.contains("0.0.0.0/0")
        });

        let mut issues: Vec<String> = Vec::new();
        if !has_interface { issues.push("Missing [Interface] section".into()); }
        if !has_peer { issues.push("Missing [Peer] section".into()); }
        if has_placeholder { issues.push("PrivateKey still contains placeholder".into()); }
        if !has_endpoint { issues.push("No Endpoint configured".into()); }
        if !has_allowed_ips { issues.push("AllowedIPs does not contain 10.8.0.0/24".into()); }
        if has_bad_route { issues.push("AllowedIPs contains 0.0.0.0/0 (full tunnel — dangerous!)".into()); }

        let config_ok = issues.is_empty();

        // Extract endpoint for detail
        let endpoint_line = content.lines()
            .find(|l| l.trim().starts_with("Endpoint"))
            .unwrap_or("")
            .trim()
            .to_string();
        let allowed_line = content.lines()
            .find(|l| l.trim().starts_with("AllowedIPs"))
            .unwrap_or("")
            .trim()
            .to_string();

        steps.push(DiagStep {
            id: "config_valid".into(),
            label: "Config valid".into(),
            status: if config_ok { "pass" } else { "fail" }.into(),
            detail: Some(if config_ok {
                format!("{} | {}", endpoint_line, allowed_line)
            } else {
                issues.join("; ")
            }),
            fix_action: if config_ok { None } else { Some("reregister".into()) },
        });
        if !config_ok {
            problems.push(format!("Config invalid: {}", issues.join(", ")));
            suggestions.push("Re-register your device to get a fresh config".into());
        }

        // Sanitize config for display
        let sanitized = content.lines().map(|l| {
            if l.trim().starts_with("PrivateKey") {
                "PrivateKey = [HIDDEN]".to_string()
            } else {
                l.to_string()
            }
        }).collect::<Vec<_>>().join("\n");
        config_sanitized = Some(sanitized);
    } else if config_exists {
        steps.push(DiagStep {
            id: "config_valid".into(),
            label: "Config valid".into(),
            status: "fail".into(),
            detail: Some("Could not read config file".into()),
            fix_action: Some("reregister".into()),
        });
    } else {
        steps.push(DiagStep {
            id: "config_valid".into(),
            label: "Config valid".into(),
            status: "skip".into(),
            detail: Some("Skipped — no config file".into()),
            fix_action: None,
        });
    }

    // ── Check 4: Server key match — deferred until check 10 ──────────────────
    // Placeholder: we'll update this after server check
    let config_peer_pubkey = conf_content.as_deref().and_then(|content| {
        let mut in_peer = false;
        for line in content.lines() {
            let t = line.trim();
            if t == "[Peer]" { in_peer = true; continue; }
            if t.starts_with('[') { in_peer = false; continue; }
            if in_peer && t.starts_with("PublicKey") {
                if let Some(val) = t.splitn(2, '=').nth(1) {
                    return Some(val.trim().to_string());
                }
            }
        }
        None
    });

    // ── Check 5: Service running ─────────────────────────────────────────────
    let service_running = vpn::check_vpn_status("arma3-session-bridge").map(|s| s.connected).unwrap_or(false);
    steps.push(DiagStep {
        id: "service_running".into(),
        label: "WireGuard service running".into(),
        status: if service_running { "pass" } else { "fail" }.into(),
        detail: if service_running { Some("WireGuardTunnel$arma3-session-bridge is RUNNING".into()) } else { Some("Service not running or not installed".into()) },
        fix_action: if service_running { None } else { Some("reconnect".into()) },
    });
    if !service_running {
        problems.push("WireGuard service is NOT running".into());
        suggestions.push("Try reconnecting the VPN tunnel".into());
    }

    // ── Check 6: Adapter IP ──────────────────────────────────────────────────
    let tunnel_ip = vpn::get_tunnel_ip().ok();
    steps.push(DiagStep {
        id: "adapter_ip".into(),
        label: "Tunnel adapter IP".into(),
        status: if tunnel_ip.is_some() { "pass" } else { "fail" }.into(),
        detail: Some(tunnel_ip.clone().unwrap_or_else(|| "No 10.8.0.x IP found on any adapter".into())),
        fix_action: if tunnel_ip.is_some() { None } else { Some("reconnect".into()) },
    });
    if tunnel_ip.is_none() {
        problems.push("No tunnel IP found — adapter may not be active".into());
        suggestions.push("Reconnect the VPN".into());
    }

    // ── Check 7: Route table ─────────────────────────────────────────────────
    {
        let mut cmd = std::process::Command::new("route");
        cmd.arg("print");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        match cmd.output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let has_route = stdout.contains("10.8.0");
                steps.push(DiagStep {
                    id: "route_table".into(),
                    label: "Route 10.8.0.0/24 present".into(),
                    status: if has_route { "pass" } else { "fail" }.into(),
                    detail: if has_route { Some("Route to 10.8.0.0 subnet found in routing table".into()) } else { Some("No route for 10.8.0.0/24 — tunnel may not be active".into()) },
                    fix_action: if has_route { None } else { Some("reconnect".into()) },
                });
                raw_adapter_info = Some(stdout);
                if !has_route {
                    problems.push("No route for 10.8.0.0/24".into());
                }
            }
            Err(e) => {
                steps.push(DiagStep {
                    id: "route_table".into(),
                    label: "Route 10.8.0.0/24 present".into(),
                    status: "skip".into(),
                    detail: Some(format!("Could not run route print: {}", e)),
                    fix_action: None,
                });
            }
        }
    }

    // ── Check 8: Gateway ping ────────────────────────────────────────────────
    {
        let addr: std::net::Ipv4Addr = "10.8.0.1".parse().unwrap();
        let ms = platform_ping(addr, 3000);
        let reachable = ms.is_some();
        steps.push(DiagStep {
            id: "gateway_ping".into(),
            label: "Gateway 10.8.0.1 reachable".into(),
            status: if reachable { "pass" } else { "fail" }.into(),
            detail: Some(if let Some(latency) = ms {
                format!("Gateway responded in {}ms", latency)
            } else {
                "Gateway 10.8.0.1 unreachable — tunnel may not be established".into()
            }),
            fix_action: if reachable { None } else { Some("reconnect".into()) },
        });
        if !reachable {
            problems.push("Gateway 10.8.0.1 unreachable".into());
            suggestions.push("Check if another VPN or firewall blocks outbound UDP 51820".into());
        }
    }

    // ── Check 9: API reachable ───────────────────────────────────────────────
    {
        let api_result = (|| -> Result<u64, String> {
            let api_url = load_api_url()?;
            let health_url = format!("{}/health", api_url.trim_end_matches('/'));
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .map_err(|e| e.to_string())?;
            let start = std::time::Instant::now();
            client.get(&health_url).send().map_err(|e| e.to_string())?;
            Ok(start.elapsed().as_millis() as u64)
        })();

        match api_result {
            Ok(ms) => {
                steps.push(DiagStep {
                    id: "api_reachable".into(),
                    label: "API reachable".into(),
                    status: "pass".into(),
                    detail: Some(format!("API responded in {}ms", ms)),
                    fix_action: None,
                });
            }
            Err(e) => {
                steps.push(DiagStep {
                    id: "api_reachable".into(),
                    label: "API reachable".into(),
                    status: "fail".into(),
                    detail: Some(format!("API unreachable: {}", e)),
                    fix_action: None,
                });
                problems.push("API unreachable — check internet connection".into());
            }
        }
    }

    // ── Check 10: Server peer status ─────────────────────────────────────────
    {
        let server_result = (|| -> Result<serde_json::Value, String> {
            let api_url = load_api_url()?;
            let token = load_peer_token()?;
            let diag_url = format!("{}/peers/me/diagnose", api_url.trim_end_matches('/'));
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(|e| e.to_string())?;
            let resp = client.get(&diag_url)
                .header("Authorization", format!("Bearer {}", token))
                .send()
                .map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Err(format!("HTTP {}", resp.status()));
            }
            resp.json::<serde_json::Value>().map_err(|e| e.to_string())
        })();

        match server_result {
            Ok(data) => {
                let peer_configured = data["peer_configured_in_wg"].as_bool().unwrap_or(false);
                let has_handshake = data["has_recent_handshake"].as_bool().unwrap_or(false);
                let handshake_ago = data["handshake_seconds_ago"].as_i64();
                let endpoint_seen = data["endpoint_seen"].as_str();
                let srv_pubkey = data["server_public_key"].as_str().map(|s| s.to_string());
                let peer_name = data["peer_name"].as_str().unwrap_or("unknown");

                server_public_key = srv_pubkey.clone();

                // Peer configured?
                if !peer_configured {
                    steps.push(DiagStep {
                        id: "server_peer_status".into(),
                        label: "Server peer status".into(),
                        status: "fail".into(),
                        detail: Some(format!("Server does NOT have peer '{}' configured in WireGuard", peer_name)),
                        fix_action: Some("reregister".into()),
                    });
                    problems.push(format!("Server doesn't have peer '{}' configured", peer_name));
                    suggestions.push("Re-register your device".into());
                } else if has_handshake {
                    let ago_str = handshake_ago.map(|s| format!("{}s ago", s)).unwrap_or_else(|| "recently".into());
                    steps.push(DiagStep {
                        id: "server_peer_status".into(),
                        label: "Server peer status".into(),
                        status: "pass".into(),
                        detail: Some(format!("Peer '{}' — handshake {} | endpoint: {}", peer_name, ago_str, endpoint_seen.unwrap_or("none"))),
                        fix_action: None,
                    });
                } else {
                    let ep_info = endpoint_seen.map(|e| format!("last endpoint: {}", e)).unwrap_or_else(|| "NO endpoint ever seen".into());
                    steps.push(DiagStep {
                        id: "server_peer_status".into(),
                        label: "Server peer status".into(),
                        status: "fail".into(),
                        detail: Some(format!("Peer '{}' — NO handshake | {} — your UDP packets are NOT reaching the server", peer_name, ep_info)),
                        fix_action: Some("reconnect".into()),
                    });
                    problems.push(format!("Server sees NO handshake from '{}'", peer_name));
                    suggestions.push("Reconnect VPN and check firewall/router for outbound UDP 51820".into());
                }
            }
            Err(e) => {
                steps.push(DiagStep {
                    id: "server_peer_status".into(),
                    label: "Server peer status".into(),
                    status: "fail".into(),
                    detail: Some(format!("Server diagnostic failed: {}", e)),
                    fix_action: None,
                });
                problems.push(format!("Could not reach server diagnostic endpoint: {}", e));
            }
        }
    }

    // ── Check 4 (deferred): Config server key match ──────────────────────────
    {
        if let (Some(ref cfg_key), Some(ref srv_key)) = (&config_peer_pubkey, &server_public_key) {
            let keys_match = cfg_key == srv_key;
            steps.insert(3, DiagStep {
                id: "config_server_key".into(),
                label: "Server key matches config".into(),
                status: if keys_match { "pass" } else { "fail" }.into(),
                detail: Some(if keys_match {
                    format!("Key matches (prefix: {}...)", &srv_key[..12.min(srv_key.len())])
                } else {
                    format!("MISMATCH — config: {}... vs server: {}...", &cfg_key[..12.min(cfg_key.len())], &srv_key[..12.min(srv_key.len())])
                }),
                fix_action: if keys_match { None } else { Some("reregister".into()) },
            });
            if !keys_match {
                problems.push("Server key MISMATCH between config and server".into());
                suggestions.push("Re-register to get correct server key".into());
            }
        } else {
            steps.insert(3, DiagStep {
                id: "config_server_key".into(),
                label: "Server key matches config".into(),
                status: "skip".into(),
                detail: Some("Could not compare — config or server key unavailable".into()),
                fix_action: None,
            });
        }
    }

    // ── Check 11: Firewall outbound ──────────────────────────────────────────
    {
        let fw_script = r#"Get-NetFirewallRule -DisplayName 'Arma3SB-*' -ErrorAction SilentlyContinue | Select-Object DisplayName,Direction,Action,Enabled | ConvertTo-Json -Compress"#;
        let mut cmd = std::process::Command::new("powershell");
        cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", fw_script]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        match cmd.output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let has_rules = !stdout.is_empty() && stdout != "null" && stdout.contains("Arma3SB");
                steps.push(DiagStep {
                    id: "firewall_outbound".into(),
                    label: "Firewall rules present".into(),
                    status: if has_rules { "pass" } else { "warn" }.into(),
                    detail: Some(if has_rules {
                        format!("Arma3SB firewall rules found: {}", stdout.chars().take(200).collect::<String>())
                    } else {
                        "No Arma3SB firewall rules found — run firewall setup".into()
                    }),
                    fix_action: if has_rules { None } else { Some("fix_firewall".into()) },
                });
                if !has_rules {
                    suggestions.push("Set up firewall rules via the Fix button".into());
                }
            }
            Err(e) => {
                steps.push(DiagStep {
                    id: "firewall_outbound".into(),
                    label: "Firewall rules present".into(),
                    status: "skip".into(),
                    detail: Some(format!("Could not check firewall: {}", e)),
                    fix_action: None,
                });
            }
        }
    }

    // ── Check 12: WireGuard log ──────────────────────────────────────────────
    {
        match vpn::dump_log() {
            Ok(log) => {
                // Take last 50 lines
                let lines: Vec<&str> = log.lines().collect();
                let last_50 = if lines.len() > 50 { &lines[lines.len()-50..] } else { &lines };
                let log_text = last_50.join("\n");
                wg_log = Some(log_text.clone());

                let error_keywords = ["Unable to", "Error", "failed", "denied", "rejected"];
                let found_errors: Vec<String> = last_50.iter()
                    .filter(|l| error_keywords.iter().any(|kw| l.to_lowercase().contains(&kw.to_lowercase())))
                    .map(|l| l.to_string())
                    .collect();

                if found_errors.is_empty() {
                    steps.push(DiagStep {
                        id: "wg_log_check".into(),
                        label: "WireGuard log clean".into(),
                        status: "pass".into(),
                        detail: Some(format!("{} log lines checked, no errors", last_50.len())),
                        fix_action: None,
                    });
                } else {
                    steps.push(DiagStep {
                        id: "wg_log_check".into(),
                        label: "WireGuard log warnings".into(),
                        status: "warn".into(),
                        detail: Some(format!("Found {} error(s): {}", found_errors.len(), found_errors.first().unwrap_or(&String::new()))),
                        fix_action: None,
                    });
                    problems.push(format!("WireGuard log contains {} error(s)", found_errors.len()));
                }
            }
            Err(_) => {
                steps.push(DiagStep {
                    id: "wg_log_check".into(),
                    label: "WireGuard log".into(),
                    status: "skip".into(),
                    detail: Some("Could not read WireGuard log".into()),
                    fix_action: None,
                });
            }
        }
    }

    // ── Compile overall status ───────────────────────────────────────────────
    let fail_count = steps.iter().filter(|s| s.status == "fail").count();
    let warn_count = steps.iter().filter(|s| s.status == "warn").count();
    let overall = if fail_count == 0 && warn_count == 0 {
        "healthy"
    } else if fail_count <= 2 {
        "degraded"
    } else {
        "broken"
    }.to_string();

    Ok(DeepDiagnoseResult {
        steps,
        overall,
        problems,
        suggestions,
        wg_log,
        config_sanitized,
        raw_adapter_info,
    })
}

#[tauri::command]
async fn deep_diagnose() -> Result<DeepDiagnoseResult, String> {
    tokio::task::spawn_blocking(deep_diagnose_sync)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fix_reconnect_vpn() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let tunnel_name = "arma3-session-bridge";
        let conf_path = CONF_PATH_WG;
        let _ = vpn::disconnect_vpn(tunnel_name);
        std::thread::sleep(std::time::Duration::from_secs(2));
        vpn::connect_vpn(conf_path)?;
        Ok("VPN reconnected successfully".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn fix_reregister_peer() -> Result<String, String> {
    Err("Bitte verwende den Setup-Wizard zur Neu-Registrierung. Klicke auf 'Gerät neu einrichten' im Hauptmenü.".to_string())
}

// ─── Application Entry ─────────────────────────────────────────────────────────

/// Build and run the Tauri application.
///
/// Sets up:
///   - Background heartbeat task (60 s interval, active when session hosted)
///   - System tray with: Connect VPN / Disconnect VPN / Quit
///   - Managed [`AppState`] (tray ID + active session arc)
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            // ── Heartbeat Arc (shared with background task) ────────────────────
            let session_arc: Arc<AsyncMutex<Option<String>>> =
                Arc::new(AsyncMutex::new(None));
            let heartbeat_arc = Arc::clone(&session_arc);

            // ── Conf path Arc (shared with reconnect task) ─────────────────────
            let conf_path_arc: Arc<AsyncMutex<Option<String>>> =
                Arc::new(AsyncMutex::new(None));
            let reconnect_arc = Arc::clone(&conf_path_arc);

            // ── VPN State Machine Arc (shared with both background tasks) ─────────
            let vpn_sm_arc: Arc<AsyncMutex<crate::vpn_state::VpnStateMachine>> =
                Arc::new(AsyncMutex::new(crate::vpn_state::VpnStateMachine::new()));
            let heartbeat_sm_arc = Arc::clone(&vpn_sm_arc);
            let reconnect_sm_arc = Arc::clone(&vpn_sm_arc);

            // ── Spawn auto-heartbeat task ──────────────────────────────────
            // Sends PUT /sessions/{id}/heartbeat every 60 s, gated by VPN state.
            // Heartbeat only runs when state machine reports should_heartbeat() == true
            // (i.e., state is Connected). This prevents spurious heartbeats during
            // reconnect or after disconnect.
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(
                    std::time::Duration::from_secs(60),
                );
                interval.tick().await;
                loop {
                    interval.tick().await;
                    // ── State gate: skip heartbeat unless Connected ────────────────
                    let should_beat = {
                        let sm = heartbeat_sm_arc.lock().await;
                        sm.should_heartbeat()
                    };
                    if !should_beat {
                        continue;
                    }
                    // ── Session ID check ─────────────────────────────────────
                    let sid_opt = {
                        let lock = heartbeat_arc.lock().await;
                        lock.clone()
                    };
                    if let Some(sid) = sid_opt {
                        // Load API URL dynamically — it may not exist on very first run
                        if let Ok(base_url) = load_api_url() {
                            let url = format!("{}/sessions/{}/heartbeat", base_url, sid);
                            if let Ok(token) = load_peer_token() {
                                let _ = reqwest::Client::new()
                                    .put(&url)
                                    .header("Authorization", format!("Bearer {}", token))
                                    .send()
                                    .await;
                            }
                        }
                    }
                }
            });

            // ── Spawn auto-reconnect task ──────────────────────────────────
            // Every 30 s: if conf_path is set and state machine allows reconnect
            // (Disconnected or Error), and tunnel is not running → attempt reconnect.
            // Emits `vpn-state-changed` with normalized payload after each attempt.
            let reconnect_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(
                    std::time::Duration::from_secs(30),
                );
                interval.tick().await; // skip first tick
                loop {
                    interval.tick().await;
                    // ── State gate: only attempt reconnect from Disconnected or Error ──
                    let should_try = {
                        let sm = reconnect_sm_arc.lock().await;
                        sm.should_reconnect()
                    };
                    if !should_try {
                        continue;
                    }
                    // ── Conf path check ────────────────────────────────────
                    let conf_opt = {
                        let lock = reconnect_arc.lock().await;
                        lock.clone()
                    };
                    if let Some(ref conf_path) = conf_opt {
                        let tunnel_name = std::path::Path::new(conf_path)
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("arma3-session-bridge")
                            .to_string();
                        if !vpn::check_vpn_status(&tunnel_name).map(|s| s.connected).unwrap_or(false) {
                            // Transition state machine to Reconnecting (from Disconnected/Error)
                            {
                                let mut sm = reconnect_sm_arc.lock().await;
                                let _ = sm.transition(crate::vpn_state::VpnIntent::Reconnect);
                                let payload = sm.event_payload("auto-reconnect started");
                                let _ = reconnect_app.emit("vpn-state-changed", payload);
                            }
                            match vpn::connect_vpn(conf_path) {
                                Ok(()) => {
                                    let ip = vpn::get_tunnel_ip()
                                        .unwrap_or_else(|_| "reconnected".to_string());
                                    // Mark connected in state machine and emit event
                                    {
                                        let mut sm = reconnect_sm_arc.lock().await;
                                        let _ = sm.mark_connected();
                                        let payload = sm.event_payload("auto-reconnected");
                                        let _ = reconnect_app.emit("vpn-state-changed", payload);
                                    }
                                    // Also emit legacy event for backwards compat
                                    let _ = reconnect_app.emit("vpn-reconnected", ip);
                                }
                                Err(e) => {
                                    // Mark error in state machine and emit event
                                    {
                                        let mut sm = reconnect_sm_arc.lock().await;
                                        sm.mark_error(e.clone());
                                        let payload = sm.event_payload("auto-reconnect failed");
                                        let _ = reconnect_app.emit("vpn-state-changed", payload);
                                    }
                                    // Also emit legacy event for backwards compat
                                    let _ = reconnect_app.emit("vpn-reconnect-failed", e);
                                }
                            }
                        }
                    }
                }
            });

            // ── Build tray menu ────────────────────────────────────────────────
            let connect_item = MenuItem::with_id(
                app,
                "connect",
                "Connect VPN",
                true,
                None::<&str>,
            )?;
            let disconnect_item = MenuItem::with_id(
                app,
                "disconnect",
                "Disconnect VPN",
                true,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &connect_item,
                    &disconnect_item,
                    &separator,
                    &quit_item,
                ],
            )?;

            // ── Build tray icon ────────────────────────────────────────────────
            // Default tooltip: Disconnected (gray). Updated by connect/disconnect.
            let tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Arma 3 Session Bridge — Disconnected")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "connect" => {
                        let _ = app.emit("tray-connect", ());
                    }
                    "disconnect" => {
                        let _ = app.emit("tray-disconnect", ());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Capture tray ID to allow tooltip updates from commands
            let tray_id = tray.id().0.clone();

            // ── Manage application state ───────────────────────────────────────
            app.manage(AppState {
                tray_id,
                active_session_id: session_arc,
                active_conf_path: conf_path_arc,
                vpn_sm: vpn_sm_arc,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_vpn,
            disconnect_vpn,
            check_vpn_status,
            get_sessions,
            host_session,
            join_session,
            send_heartbeat,
            has_peer_token,
            validate_conf,
            check_peer_exists,
            delete_conf_file,
            get_host_ip,
            download_peer_config,
            generate_and_register_peer,
            get_connection_info,
            get_online_peers,
            get_vpn_mode,
            notify_disconnect,
            get_my_stats,
            ping_gateway,
            setup_firewall_rules,
            ping_peer,
            deep_diagnose,
            fix_reconnect_vpn,
            fix_reregister_peer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
