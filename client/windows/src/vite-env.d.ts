/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Arma 3 Session Bridge API, e.g. http://10.8.0.1:8001 */
  readonly VITE_API_URL: string
  /** WireGuard config file path on Windows */
  readonly VITE_WG_CONF_PATH: string
  /** WireGuard tunnel name (without .conf extension) */
  readonly VITE_WG_TUNNEL_NAME: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
