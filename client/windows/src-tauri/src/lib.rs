/// lib.rs — Tauri v2 application core for Arma 3 Session Bridge Windows Client
///
/// Exports:
///   - Tauri commands: connect_vpn, disconnect_vpn, check_vpn_status,
///     get_sessions, host_session, join_session, send_heartbeat,
///     validate_conf, get_host_ip, download_peer_config
///   - System-Tray with: Connect / Disconnect / Quit menu items
///   - Auto-Heartbeat: sends PUT /sessions/{id}/heartbeat every 60 s when hosting
///   - `run()` — entry point called from main.rs

pub mod vpn;

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, State,
};
use tokio::sync::Mutex as AsyncMutex;

use vpn::VpnStatus;

// ─── Constants ─────────────────────────────────────────────────────────────────

/// Bridge API base URL (hardcoded MVP — configurable via Tauri config in future).
const API_BASE_URL: &str = "https://arma3.ralle1976.cloud/api";

// ─── Shared Application State ─────────────────────────────────────────────────

/// State managed by Tauri — available in all commands via `State<'_, AppState>`.
pub struct AppState {
    /// Tray icon ID for tooltip updates (retrieved via `app.tray_by_id`).
    pub tray_id: String,
    /// ID of the currently hosted session, `None` if not hosting.
    /// Used by the background heartbeat task.
    pub active_session_id: Arc<AsyncMutex<Option<String>>>,
}

// ─── Session Struct ────────────────────────────────────────────────────────────

/// Session returned by `GET /sessions` or `POST /sessions` from the bridge API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub mission_name: String,
    pub host_tunnel_ip: String,
    pub current_players: u32,
    pub max_players: u32,
    pub status: String,
}

// ─── VPN Commands ─────────────────────────────────────────────────────────────

/// Install the WireGuard tunnel service (Connect VPN).
///
/// Updates the tray tooltip to show the assigned tunnel IP.
///
/// Invoked from frontend: `invoke('connect_vpn', { confPath: '...' })`
#[tauri::command]
fn connect_vpn(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    conf_path: String,
) -> Result<String, String> {
    vpn::connect_vpn(&conf_path)?;
    let ip = vpn::get_tunnel_ip().unwrap_or_else(|_| "connected".to_string());
    // Update tray tooltip to show assigned tunnel IP
    if let Some(tray) = app.tray_by_id(state.tray_id.as_str()) {
        let _ = tray.set_tooltip(Some(
            format!("Connected: {}", ip).as_str(),
            format!("Arma 3 Session Bridge — Connected ({})", ip).as_str(),
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
    let url = format!("{}/sessions", API_BASE_URL);

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
    let url = format!("{}/sessions", API_BASE_URL);
    let body = serde_json::json!({
        "mission_name": mission_name,
        "max_players": max_players,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("API error {}", response.status()));
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
    let url = format!("{}/sessions/{}", API_BASE_URL, session_id);

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
    let url = format!("{}/sessions/{}/heartbeat", API_BASE_URL, session_id);

    let client = reqwest::Client::new();
    let response = client
        .put(&url)
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

    Ok(has_interface && has_split_tunnel)
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
) -> Result<(), String> {
    let url = format!("{}/peers/{}/config", api_url.trim_end_matches('/'), peer_id);

    let response = reqwest::get(&url)
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

            // ── Spawn auto-heartbeat task ──────────────────────────────────────
            // Sends PUT /sessions/{id}/heartbeat every 60 s while session is active.
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(
                    std::time::Duration::from_secs(60),
                );
                // Skip the immediate first tick so heartbeat starts after 60 s
                interval.tick().await;
                loop {
                    interval.tick().await;
                    let sid_opt = {
                        let lock = heartbeat_arc.lock().await;
                        lock.clone()
                    };
                    if let Some(sid) = sid_opt {
                        let url = format!("{}/sessions/{}/heartbeat", API_BASE_URL, sid);
                        let _ = reqwest::Client::new().put(&url).send().await;
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
            validate_conf,
            get_host_ip,
            download_peer_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
