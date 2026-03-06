import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PeersPage from '../pages/PeersPage'
import { AuthProvider } from '../context/AuthContext'
import * as peersApi from '../api/peers'

vi.mock('../api/peers', () => ({
  listPeers: vi.fn(),
  createPeer: vi.fn(),
  deletePeer: vi.fn(),
  downloadConfig: vi.fn(),
}))

// Also mock client so interceptor setup doesn't fail
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

function renderPeersPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuthProvider>
          <PeersPage />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return queryClient
}

const mockPeers: peersApi.Peer[] = [
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

describe('PeersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.setItem('admin_token', 'test-jwt-token')
  })

  it('shows loading state initially', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(peersApi.listPeers as any).mockReturnValue(new Promise(() => {}))
    renderPeersPage()
    expect(screen.getByText(/loading peers/i)).toBeTruthy()
  })

  it('renders "Add Peer" button', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(peersApi.listPeers as any).mockResolvedValueOnce([])
    renderPeersPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add peer/i })).toBeTruthy()
    })
  })

  it('renders peer names after successful fetch', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(peersApi.listPeers as any).mockResolvedValueOnce(mockPeers)
    renderPeersPage()
    await waitFor(() => {
      expect(screen.getByText('alpha')).toBeTruthy()
      expect(screen.getByText('bravo')).toBeTruthy()
    })
  })

  it('renders tunnel IPs for each peer', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(peersApi.listPeers as any).mockResolvedValueOnce(mockPeers)
    renderPeersPage()
    await waitFor(() => {
      expect(screen.getByText('10.8.0.2')).toBeTruthy()
      expect(screen.getByText('10.8.0.3')).toBeTruthy()
    })
  })

  it('shows empty state when no peers', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(peersApi.listPeers as any).mockResolvedValueOnce([])
    renderPeersPage()
    await waitFor(() => {
      expect(screen.getByText(/no peers configured/i)).toBeTruthy()
    })
  })

  it('shows error state on fetch failure', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(peersApi.listPeers as any).mockRejectedValueOnce(new Error('Network error'))
    renderPeersPage()
    await waitFor(() => {
      expect(screen.getByText(/failed to load peers/i)).toBeTruthy()
    })
  })
})
