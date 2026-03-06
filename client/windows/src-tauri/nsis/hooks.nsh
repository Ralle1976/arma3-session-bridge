; =============================================================================
; Arma3 Session Bridge — NSIS Installer Hooks
; =============================================================================
; Pre-Install:  Checks if WireGuard for Windows is installed.
;               If not: opens WireGuard download page and aborts install.
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

  ; Find WireGuard
  !insertmacro _FindWireGuard $R0

  ; If WireGuard path is empty → not installed
  StrCmp $R0 "" wireguard_missing wireguard_ok

  wireguard_missing:
    MessageBox MB_YESNO|MB_ICONINFORMATION \
      "$(^Name) setzt WireGuard f$\u00fcr Windows voraus.$\n$\n\
WireGuard ist auf diesem System nicht installiert.$\n$\n\
M$\u00f6chtest du die WireGuard-Download-Seite jetzt $\u00f6ffnen?$\n$\n\
Installiere WireGuard und starte anschlie$\u00dfend diesen Installer erneut." \
      IDYES open_wg_page IDNO abort_install

    open_wg_page:
      ExecShell "open" "https://www.wireguard.com/install/"
      MessageBox MB_OK|MB_ICONINFORMATION \
        "WireGuard-Download-Seite wurde ge$\u00f6ffnet.$\n$\nBitte installiere WireGuard und starte dann diesen Installer erneut."
      Abort

    abort_install:
      MessageBox MB_OK|MB_ICONWARNING \
        "Installation abgebrochen.$\n$\nWireGuard wird f$\u00fcr $(^Name) ben$\u00f6tigt."
      Abort

  wireguard_ok:
    ; WireGuard is installed — continue installation
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
