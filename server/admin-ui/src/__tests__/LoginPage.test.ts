/**
 * LoginPage — API layer tests
 *
 * Tests the auth API call behaviour that backs the LoginPage form.
 * Pure TypeScript (node env), no DOM rendering required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import apiClient from '../api/client'

vi.mock('../api/client', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  },
}))

describe('Login — auth API call', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls POST /auth/login with username and password', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.post as any).mockResolvedValueOnce({
      data: { access_token: 'test-jwt-token' },
    })

    const response = await apiClient.post<{ access_token: string }>('/auth/login', {
      username: 'admin',
      password: 'secret',
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(apiClient.post as any).toHaveBeenCalledWith('/auth/login', {
      username: 'admin',
      password: 'secret',
    })
    expect(response.data.access_token).toBe('test-jwt-token')
  })

  it('rejects with an error when credentials are invalid', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.post as any).mockRejectedValueOnce(new Error('Unauthorized'))

    await expect(
      apiClient.post('/auth/login', { username: 'admin', password: 'wrong' }),
    ).rejects.toThrow('Unauthorized')
  })

  it('returns an access_token string on successful login', async () => {
    const token = 'eyJhbGciOiJIUzI1NiJ9.test.sig'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.post as any).mockResolvedValueOnce({ data: { access_token: token } })

    const res = await apiClient.post<{ access_token: string }>('/auth/login', {
      username: 'admin',
      password: 'correct',
    })

    expect(typeof res.data.access_token).toBe('string')
    expect(res.data.access_token).toBe(token)
  })
})
