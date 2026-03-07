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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    #[serde(deserialize_with = "de_session_id")]
    pub id: String,
    pub mission_name: String,
    pub host_tunnel_ip: String,
    pub current_players: u32,
    pub max_players: u32,
    pub status: String,
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

            // ── Spawn auto-heartbeat task ──────────────────────────────────────
            // Sends PUT /sessions/{id}/heartbeat every 60 s while session is active.
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(
                    std::time::Duration::from_secs(60),
                );
                interval.tick().await;
                loop {
                    interval.tick().await;
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

            // ── Spawn auto-reconnect task ──────────────────────────────────────
            // Every 30 s: if conf_path is set but tunnel not running → reconnect.
            let reconnect_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(
                    std::time::Duration::from_secs(30),
                );
                interval.tick().await; // skip first tick
                loop {
                    interval.tick().await;
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
                        if !vpn::is_tunnel_running(&tunnel_name) {
                            match vpn::connect_vpn(conf_path) {
                                Ok(()) => {
                                    let ip = vpn::get_tunnel_ip()
                                        .unwrap_or_else(|_| "reconnected".to_string());
                                    let _ = reconnect_app.emit("vpn-reconnected", ip);
                                }
                                Err(e) => {
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
