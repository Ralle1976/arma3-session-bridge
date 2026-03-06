import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LoginPage from '../pages/LoginPage'
import { AuthProvider } from '../context/AuthContext'
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

function renderLoginPage() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <LoginPage />
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders username and password fields', () => {
    renderLoginPage()
    expect(screen.getByLabelText(/username/i)).toBeTruthy()
    expect(screen.getByLabelText(/password/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /sign in/i })).toBeTruthy()
  })

  it('shows error message when login fails', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.post as any).mockRejectedValueOnce(new Error('Unauthorized'))

    renderLoginPage()

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'wrongpassword' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      expect(screen.queryByText(/invalid credentials/i)).toBeTruthy()
    })
  })

  it('disables submit button while loading', async () => {
    // Never resolves — simulates in-flight request
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(apiClient.post as any).mockReturnValue(new Promise(() => {}))

    renderLoginPage()

    fireEvent.change(screen.getByLabelText(/username/i), {
      target: { value: 'admin' },
    })
    fireEvent.change(screen.getByLabelText(/password/i), {
      target: { value: 'secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /signing in/i })
      expect(btn).toBeTruthy()
    })
  })
})
