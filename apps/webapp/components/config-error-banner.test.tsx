import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigErrorBanner, ConfigErrorInline } from './config-error-banner'

describe('ConfigErrorBanner', () => {
  it('renders the heading and help text', () => {
    render(<ConfigErrorBanner error={null} />)
    expect(screen.getByRole('heading', { name: /unable to load configuration/i })).toBeInTheDocument()
    expect(screen.getByText(/backend service is running/i)).toBeInTheDocument()
  })

  it('displays the error message when provided', () => {
    render(<ConfigErrorBanner error="Backend returned 502" />)
    expect(screen.getByText('Backend returned 502')).toBeInTheDocument()
  })

  it('does not render error detail when error is null', () => {
    render(<ConfigErrorBanner error={null} />)
    expect(screen.queryByRole('code')).not.toBeInTheDocument()
  })

  it('calls onRetry when Try again is clicked', async () => {
    const onRetry = vi.fn()
    render(<ConfigErrorBanner error={null} onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('disables retry button and shows retrying text when isRetrying=true', () => {
    render(<ConfigErrorBanner error={null} onRetry={vi.fn()} isRetrying={true} />)
    const btn = screen.getByRole('button', { name: /retrying/i })
    expect(btn).toBeDisabled()
  })

  it('renders reload page button', () => {
    render(<ConfigErrorBanner error={null} />)
    expect(screen.getByRole('button', { name: /reload page/i })).toBeInTheDocument()
  })

  it('has role=alert for accessibility', () => {
    render(<ConfigErrorBanner error={null} />)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })
})

describe('ConfigErrorInline', () => {
  it('renders inline error text', () => {
    render(<ConfigErrorInline error="Config unavailable" />)
    expect(screen.getByText('Config unavailable')).toBeInTheDocument()
  })

  it('renders retry button when onRetry is provided', () => {
    const onRetry = vi.fn()
    render(<ConfigErrorInline error={null} onRetry={onRetry} />)
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('calls onRetry when retry button is clicked', async () => {
    const onRetry = vi.fn()
    render(<ConfigErrorInline error={null} onRetry={onRetry} />)
    await userEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('disables retry button when isRetrying=true', () => {
    render(<ConfigErrorInline error={null} onRetry={vi.fn()} isRetrying={true} />)
    expect(screen.getByRole('button', { name: /retry/i })).toBeDisabled()
  })
})
