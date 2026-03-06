// main.rs — Tauri v2 binary entry point
// Prevents a console window from appearing on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    arma3_session_bridge_client::run();
}
