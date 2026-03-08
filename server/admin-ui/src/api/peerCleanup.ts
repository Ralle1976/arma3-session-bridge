import apiClient from './client'

export interface CleanupPeerInfo {
  id: number
  name: string
  tunnel_ip: string
  days_inactive: number
  would_revoke: boolean
}

export interface CleanupStatus {
  interval_hours: number
  threshold_days: number
  total_active_peers: number
  peers_to_revoke: number
  peers: CleanupPeerInfo[]
}

export interface CleanupResult {
  status: string
  peers_revoked: number
  message: string
}

export async function getCleanupStatus(): Promise<CleanupStatus> {
  const res = await apiClient.get<CleanupStatus>('/admin/peer-cleanup/status')
  return res.data
}

export async function triggerCleanup(): Promise<CleanupResult> {
  const res = await apiClient.post<CleanupResult>('/admin/peer-cleanup')
  return res.data
}
