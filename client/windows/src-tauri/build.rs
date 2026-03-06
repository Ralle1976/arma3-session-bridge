fn main() {
    // Embed Windows application manifest requiring administrator elevation.
    // WireGuard tunnel service operations (install/uninstall) require admin rights.
    // This causes Windows to show a UAC prompt when launching the app.
    #[cfg(target_os = "windows")]
    {
        println!(r#"cargo:rustc-link-arg=/MANIFESTUAC:level='requireAdministrator'"#);
    }

    tauri_build::build()
}
