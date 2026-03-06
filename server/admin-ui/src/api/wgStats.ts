import apiClient from './client'

export interface PeerStat {
  public_key: string
  endpoint: string | null
  allowed_ips: string
  last_handshake_ago: number | null  // seconds, null = never connected
  transfer_rx_bytes: number
  transfer_tx_bytes: number
  persistent_keepalive: number
  connection_quality: 'good' | 'warning' | 'offline'
}

export interface WgStats {
  peers: PeerStat[]
  optimizations: {
    mtu: number
    keepalive_seconds: number
    server_tuning: boolean
  }
}

export async function fetchWgStats(): Promise<WgStats> {
  const res = await apiClient.get<WgStats>('/admin/wg-stats')
  return res.data
}
