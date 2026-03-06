/// lib.rs — Tauri v2 application core for Arma 3 Session Bridge Windows Client
///
/// Exports:
///   - Tauri commands: connect_vpn, disconnect_vpn, check_vpn_status, get_sessions
///   - System-Tray with: Connect / Disconnect / Quit menu items
///   - `run()` — entry point called from main.rs

pub mod vpn;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// Session data returned by the API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: u64,
    pub peer_id: u64,
    pub mission: Option<String>,
    pub map_name: Option<String>,
    pub player_count: u32,
    pub started_at: String,
    pub ended_at: Option<String>,
    pub active: bool,
}

// ─── Tauri Commands ────────────────────────────────────────────────────────────

/// Install the WireGuard tunnel service (Connect VPN).
///
/// Invoked from frontend as: `invoke('connect_vpn', { confPath: '...' })`
///
/// # Parameters
/// * `conf_path` – Full Windows path to the WireGuard `.conf` file.
///
/// Requires elevated privileges (admin). Call via `runas` if needed.
#[tauri::command]
fn connect_vpn(conf_path: String) -> Result<String, String> {
    vpn::install_tunnel_service(&conf_path)?;
    Ok("VPN connected successfully".to_string())
}

/// Uninstall the WireGuard tunnel service (Disconnect VPN).
///
/// Invoked from frontend as: `invoke('disconnect_vpn', { tunnelName: '...' })`
///
/// # Parameters
/// * `tunnel_name` – Name of the WireGuard tunnel (conf filename without .conf).
#[tauri::command]
fn disconnect_vpn(tunnel_name: String) -> Result<String, String> {
    vpn::uninstall_tunnel_service(&tunnel_name)?;
    Ok("VPN disconnected successfully".to_string())
}

/// Check whether the WireGuard tunnel service is running.
///
/// Invoked from frontend as: `invoke('check_vpn_status', { tunnelName: '...' })`
///
/// Returns `true` if connected, `false` otherwise.
#[tauri::command]
fn check_vpn_status(tunnel_name: String) -> bool {
    vpn::is_tunnel_running(&tunnel_name)
}

/// Fetch active Arma 3 sessions from the bridge API.
///
/// Invoked from frontend as: `invoke('get_sessions', { apiUrl: '...' })`
///
/// # Parameters
/// * `api_url` – Base URL of the API, e.g. `http://10.8.0.1:8001`
///
/// Calls `GET <api_url>/sessions` and returns the JSON array.
#[tauri::command]
fn get_sessions(api_url: String) -> Result<Vec<serde_json::Value>, String> {
    let url = format!("{}/sessions", api_url.trim_end_matches('/'));

    let response = ureq::get(&url)
        .call()
        .map_err(|e| e.to_string())?;

    let data: Vec<serde_json::Value> = response
        .into_json()
        .map_err(|e| e.to_string())?;

    Ok(data)
}

// ─── Application Entry ─────────────────────────────────────────────────────────

/// Build and run the Tauri application with system-tray support.
///
/// System-Tray menu items:
///   • Connect VPN    — triggers connect_vpn command
///   • Disconnect VPN — triggers disconnect_vpn command
///   • ──────────────
///   • Quit           — exits the application
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
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
            // Gray by default (disconnected); color switch is handled in frontend
            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Arma 3 Session Bridge — Disconnected")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "connect" => {
                        // Emit event to frontend for connect flow
                        let _ = app.emit("tray-connect", ());
                    }
                    "disconnect" => {
                        // Emit event to frontend for disconnect flow
                        let _ = app.emit("tray-disconnect", ());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            connect_vpn,
            disconnect_vpn,
            check_vpn_status,
            get_sessions,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
