/// TrayMenu.tsx — React mirror of the system-tray context menu
///
/// The actual tray icon and menu are managed in Rust (src-tauri/src/lib.rs).
/// This component renders the same actions inside the main window so users
/// who prefer the windowed UI get identical control surface.
///
/// Tray color semantics:
///   🟢 Green dot = VPN connected (10.8.0.0/24 tunnel active)
///   ⚫ Gray dot  = VPN disconnected

import type { FC } from 'react'

interface TrayMenuProps {
  /** Whether the WireGuard VPN tunnel is currently active */
  isConnected: boolean
  /** Called when the user clicks "Connect VPN" */
  onConnect: () => void
  /** Called when the user clicks "Disconnect VPN" */
  onDisconnect: () => void
  /** Called when the user clicks "Quit" */
  onQuit: () => void
}

export const TrayMenu: FC<TrayMenuProps> = ({
  isConnected,
  onConnect,
  onDisconnect,
  onQuit,
}) => {
  return (
    <div className="tray-menu" role="menu" aria-label="Tray menu">
      {/* Status indicator — mirrors the tray icon color */}
      <div className="tray-header">
        <span
          className={`tray-indicator ${isConnected ? 'tray-green' : 'tray-gray'}`}
          aria-label={isConnected ? 'Connected' : 'Disconnected'}
          title={
            isConnected
              ? 'VPN tunnel active — 10.8.0.0/24'
              : 'VPN tunnel inactive'
          }
        />
        <span className="tray-label">
          {isConnected ? 'Tunnel: 10.8.0.0/24' : 'Tunnel: inactive'}
        </span>
      </div>

      <hr className="tray-divider" />

      {/* Connect */}
      <button
        className={`tray-item ${isConnected ? 'disabled' : ''}`}
        role="menuitem"
        onClick={onConnect}
        disabled={isConnected}
        title="Start WireGuard split-tunnel to 10.8.0.0/24"
      >
        <span className="tray-item-icon">▶</span>
        Connect VPN
      </button>

      {/* Disconnect */}
      <button
        className={`tray-item ${!isConnected ? 'disabled' : ''}`}
        role="menuitem"
        onClick={onDisconnect}
        disabled={!isConnected}
        title="Stop WireGuard tunnel"
      >
        <span className="tray-item-icon">⏹</span>
        Disconnect VPN
      </button>

      <hr className="tray-divider" />

      {/* Quit */}
      <button
        className="tray-item tray-item-danger"
        role="menuitem"
        onClick={onQuit}
        title="Exit the application"
      >
        <span className="tray-item-icon">✕</span>
        Quit
      </button>
    </div>
  )
}

export default TrayMenu
