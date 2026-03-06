/// lib.rs — Tauri v2 application core for Arma 3 Session Bridge Windows Client
///
/// Exports:
///   - Tauri commands: connect_vpn, disconnect_vpn, check_vpn_status,
///     get_sessions, host_session, join_session, send_heartbeat
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
const API_BASE_URL: &str = "https://your-server.example.com/api";

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
        let _ = tray.set_tooltip(Some("Arma 3 Session Bridge — Disconnected"));
    }
    Ok("VPN disconnected".to_string())
}

/// Check whether the WireGuard tunnel service is currently running.
///
/// Invoked from frontend: `invoke('check_vpn_status', { tunnelName: '...' })`
///
/// Returns [`VpnStatus`] with `connected`, `tunnel_ip`, `tunnel_name`.
#[tauri::command]
fn check_vpn_status(tunnel_name: String) -> Result<VpnStatus, String> {
    vpn::check_vpn_status(&tunnel_name)
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
