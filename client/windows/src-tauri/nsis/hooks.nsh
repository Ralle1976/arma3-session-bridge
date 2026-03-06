; =============================================================================
; Arma3 Session Bridge — NSIS Installer Hooks
; =============================================================================
; Pre-Install:  Checks if WireGuard is installed.
;               If missing: downloads + installs WireGuard silently (no user action).
; Post-Uninstall: Removes WireGuard tunnel "arma3-session-bridge".
; =============================================================================

; -----------------------------------------------------------------------------
; Helper: Locate WireGuard executable (x64 or x86 fallback)
; -----------------------------------------------------------------------------
!macro _FindWireGuard OutVar
  StrCpy ${OutVar} ""
  IfFileExists "$PROGRAMFILES64\WireGuard\wireguard.exe" 0 +3
    StrCpy ${OutVar} "$PROGRAMFILES64\WireGuard\wireguard.exe"
    Goto +2
  IfFileExists "$PROGRAMFILES\WireGuard\wireguard.exe" 0 +2
    StrCpy ${OutVar} "$PROGRAMFILES\WireGuard\wireguard.exe"
!macroend

; -----------------------------------------------------------------------------
; customInstall — runs BEFORE main application install
; Called automatically by Tauri's NSIS template via !insertmacro customInstall
; -----------------------------------------------------------------------------
!macro customInstall

  ; Check if WireGuard is already installed
  !insertmacro _FindWireGuard $R0
  StrCmp $R0 "" wireguard_missing wireguard_ok

  wireguard_missing:
    DetailPrint "WireGuard nicht gefunden — wird automatisch installiert..."

    ; Write a PowerShell script to temp dir (avoids complex quoting in ExecWait)
    FileOpen $R1 "$TEMP\install-wireguard.ps1" w
    FileWrite $R1 "$$url = 'https://download.wireguard.com/windows-client/wireguard-installer.exe'$\r$\n"
    FileWrite $R1 "$$out = Join-Path $$env:TEMP 'wireguard-installer.exe'$\r$\n"
    FileWrite $R1 "Invoke-WebRequest -Uri $$url -OutFile $$out -UseBasicParsing$\r$\n"
    FileWrite $R1 "Start-Process -FilePath $$out -ArgumentList '/S' -Wait$\r$\n"
    FileClose $R1

    ; Run PowerShell script (NSIS installer already runs as admin — perMachine)
    ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -File "$TEMP\install-wireguard.ps1"' $R2

    ; Delete temp script
    Delete "$TEMP\install-wireguard.ps1"

    ; Re-check whether installation succeeded
    !insertmacro _FindWireGuard $R0
    StrCmp $R0 "" wireguard_install_failed wireguard_ok

    wireguard_install_failed:
      MessageBox MB_OK|MB_ICONERROR \
        "WireGuard konnte nicht automatisch installiert werden.$\n$\nBitte installiere WireGuard manuell von:$\nhttps://www.wireguard.com/install/$\n$\nDanach diesen Installer erneut starten."
      Abort

  wireguard_ok:
    DetailPrint "WireGuard gefunden: $R0"

!macroend

; -----------------------------------------------------------------------------
; customUnInstall — runs DURING application uninstall
; Called automatically by Tauri's NSIS template via !insertmacro customUnInstall
; -----------------------------------------------------------------------------
!macro customUnInstall

  ; Find WireGuard before attempting to remove tunnel
  !insertmacro _FindWireGuard $R0

  StrCmp $R0 "" skip_tunnel_removal remove_tunnel

  remove_tunnel:
    DetailPrint "Entferne WireGuard-Tunnel: arma3-session-bridge"
    ; Remove the WireGuard tunnel service (requires admin — perMachine install ensures this)
    ExecWait '"$R0" /uninstalltunnelservice arma3-session-bridge' $1
    DetailPrint "Tunnel-Entfernung beendet mit Code: $1"
    Goto skip_tunnel_removal

  skip_tunnel_removal:
    ; WireGuard not found or tunnel removal skipped

!macroend
