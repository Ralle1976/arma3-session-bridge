fn main() {
    // Use Tauri's own app_manifest API for UAC elevation.
    // wireguard.exe /installtunnelservice and /uninstalltunnelservice
    // both require admin rights — this forces a UAC prompt on app launch.
    //
    // NOTE: Do NOT use embed-manifest crate — it conflicts with Tauri's
    // built-in manifest embedding (duplicate MANIFEST resource → LNK1123).
    let windows_attrs = tauri_build::WindowsAttributes::new()
        .app_manifest(r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <compatibility xmlns="urn:schemas-microsoft-com:compatibility.v1">
    <application>
      <supportedOS Id="{8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a}"/>
      <supportedOS Id="{1f676c76-80e1-4239-95bb-83d0f6d0da78}"/>
    </application>
  </compatibility>
</assembly>
"#);

    let attrs = tauri_build::Attributes::new()
        .windows_attributes(windows_attrs);

    tauri_build::try_build(attrs)
        .expect("failed to build Tauri application");
}
