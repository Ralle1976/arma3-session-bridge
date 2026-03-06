/**
 * PeersPage — API layer tests
 *
 * Tests listPeers / createPeer / deletePeer functions that back the PeersPage table.
 * Pure TypeScript (node env), no DOM rendering required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listPeers, createPeer, deletePeer, type Peer } from '../api/peers'
import apiClient from '../api/client'

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

const mockPeers: Peer[] = [
  {
    id: 'peer-1',
    name: 'alpha',
    public_key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    tunnel_ip: '10.8.0.2',
    allowed_ips: '10.8.0.2/32',
    created_at: '2026-03-06T10:00:00Z',
    enabled: true,
  },
  {
    id: 'peer-2',
    name: 'bravo',
    public_key: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
    tunnel_ip: '10.8.0.3',
    allowed_ips: '10.8.0.3/32',
    created_at: '2026-03-06T11:00:00Z',
    enabled: false,
  },
]

// ── listPeers ────────────────────────────────────────────────────────────────

describe('listPeers()', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls GET /peers', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.get as any).mockResolvedValueOnce({ data: mockPeers })
    await listPeers()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(apiClient.get as any).toHaveBeenCalledWith('/peers')
  })

  it('returns the peers array from response.data', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.get as any).mockResolvedValueOnce({ data: mockPeers })
    const result = await listPeers()
    expect(result).toEqual(mockPeers)
    expect(result).toHaveLength(2)
  })

  it('returns an empty array when there are no peers', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.get as any).mockResolvedValueOnce({ data: [] })
    const result = await listPeers()
    expect(result).toHaveLength(0)
  })

  it('propagates network errors', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.get as any).mockRejectedValueOnce(new Error('Network error'))
    await expect(listPeers()).rejects.toThrow('Network error')
  })
})

// ── createPeer ───────────────────────────────────────────────────────────────

describe('createPeer(name)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls POST /peers with the peer name', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.post as any).mockResolvedValueOnce({ data: mockPeers[0] })
    await createPeer('alpha')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(apiClient.post as any).toHaveBeenCalledWith('/peers', { name: 'alpha' })
  })

  it('returns the created peer data', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.post as any).mockResolvedValueOnce({ data: mockPeers[0] })
    const result = await createPeer('alpha')
    expect(result.id).toBe('peer-1')
    expect(result.name).toBe('alpha')
    expect(result.tunnel_ip).toBe('10.8.0.2')
  })
})

// ── deletePeer ───────────────────────────────────────────────────────────────

describe('deletePeer(id)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('calls DELETE /peers/:id', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.delete as any).mockResolvedValueOnce({ data: null })
    await deletePeer('peer-1')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(apiClient.delete as any).toHaveBeenCalledWith('/peers/peer-1')
  })

  it('resolves without error on success', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.delete as any).mockResolvedValueOnce({ data: null })
    await expect(deletePeer('peer-2')).resolves.toBeUndefined()
  })

  it('propagates errors when delete fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.delete as any).mockRejectedValueOnce(new Error('Not found'))
    await expect(deletePeer('unknown')).rejects.toThrow('Not found')
  })
})
