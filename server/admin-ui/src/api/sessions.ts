import apiClient from './client'

export interface Session {
  id: string
  peer_name: string
  peer_id: string
  arma_player?: string | null
  started_at: string
  ended_at?: string | null
  duration_seconds?: number | null
  active: boolean
  mission?: string | null
  map_name?: string | null
  player_count?: number | null
  status?: string
}

export async function listSessions(): Promise<Session[]> {
  const res = await apiClient.get<Session[]>('/admin/sessions')
  return res.data
}

export async function getSession(id: string): Promise<Session> {
  const res = await apiClient.get<Session>(`/admin/sessions/${id}`)
  return res.data
}
