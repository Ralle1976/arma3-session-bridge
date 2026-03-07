fn main() {
    // Embed Windows application manifest requiring administrator elevation.
    // wireguard.exe /installtunnelservice and /uninstalltunnelservice
    // both require admin rights — this forces a UAC prompt on app launch.
    #[cfg(target_os = "windows")]
    {
        use embed_manifest::{embed_manifest, manifest::ExecutionLevel, new_manifest};
        embed_manifest(
            new_manifest("Arma3SessionBridge")
                .requested_execution_level(ExecutionLevel::RequireAdministrator),
        )
        .expect("unable to embed admin manifest");
    }

    tauri_build::build()
}
