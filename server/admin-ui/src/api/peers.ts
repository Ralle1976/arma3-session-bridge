import apiClient from './client'

export interface Peer {
  id: string
  name: string
  public_key: string
  tunnel_ip: string
  allowed_ips: string
  created_at: string
  last_seen?: string | null
  last_handshake?: string | null
  enabled: boolean
  revoked?: boolean
}

export interface CreatePeerResponse {
  id: string
  name: string
  public_key: string
  tunnel_ip: string
  allowed_ips: string
  created_at: string
  enabled: boolean
  config?: string
}

export async function listPeers(): Promise<Peer[]> {
  const res = await apiClient.get<Peer[]>('/peers')
  return res.data.map(peer => ({
    ...peer,
    enabled: peer.revoked !== undefined ? !peer.revoked : peer.enabled,
  }))
}

export async function createPeer(name: string): Promise<CreatePeerResponse> {
  const res = await apiClient.post<CreatePeerResponse>('/peers', { name })
  return res.data
}

export async function deletePeer(id: string): Promise<void> {
  await apiClient.delete(`/peers/${id}`)
}

export async function downloadConfig(id: string, peerName: string): Promise<void> {
  const res = await apiClient.get<BlobPart>(`/peers/${id}/config`, {
    responseType: 'blob',
  })
  const url = URL.createObjectURL(
    new Blob([res.data], { type: 'text/plain' }),
  )
  const a = document.createElement('a')
  a.href = url
  a.download = `peer-${peerName}.conf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
