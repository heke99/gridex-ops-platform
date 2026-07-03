import { describe, expect, it, vi } from 'vitest'

// The Capway client module pulls in the auth/config layer which touches the
// Supabase service client at import time; only the error class is needed here.
vi.mock('@/lib/integrations/billing/capway/auth', () => ({
  getCapwayAccessToken: vi.fn(),
  resolveCapwayConnectionConfig: vi.fn(),
}))

import { CapwayApiError } from '@/lib/integrations/billing/capway/client'
import {
  classifyInvoiceExportError,
  computeNextRetryAt,
  INVOICE_EXPORT_MAX_ATTEMPTS,
} from '@/lib/integrations/billing/exportErrorClassification'

function httpError(status: number, excerpt: string | null = null): CapwayApiError {
  return new CapwayApiError({ message: `Capway/Aptic API ${status}: fel`, httpStatus: status, kind: 'http', responseExcerpt: excerpt })
}

describe('classifyInvoiceExportError', () => {
  it('classifies 400/422 as rejected with no retry', () => {
    for (const status of [400, 422]) {
      const classification = classifyInvoiceExportError(httpError(status))
      expect(classification.outcome).toBe('rejected')
      expect(classification.retryable).toBe(false)
      expect(classification.httpStatus).toBe(status)
    }
  })

  it('classifies 401/403 as configuration errors', () => {
    for (const status of [401, 403]) {
      const classification = classifyInvoiceExportError(httpError(status))
      expect(classification.outcome).toBe('configuration_error')
      expect(classification.errorCode).toBe('provider_auth_failed')
      expect(classification.retryable).toBe(false)
    }
  })

  it('classifies 404 as a configuration error (wrong endpoint)', () => {
    const classification = classifyInvoiceExportError(httpError(404))
    expect(classification.outcome).toBe('configuration_error')
    expect(classification.errorCode).toBe('provider_endpoint_not_found')
  })

  it('classifies 409 as needs_review (conflict resolved via idempotency lookup)', () => {
    const classification = classifyInvoiceExportError(httpError(409))
    expect(classification.outcome).toBe('needs_review')
    expect(classification.errorCode).toBe('provider_conflict')
    expect(classification.retryable).toBe(false)
  })

  it('classifies 429 and 408 as retryable', () => {
    expect(classifyInvoiceExportError(httpError(429)).outcome).toBe('failed_retryable')
    expect(classifyInvoiceExportError(httpError(429)).errorCode).toBe('provider_rate_limited')
    expect(classifyInvoiceExportError(httpError(408)).outcome).toBe('failed_retryable')
  })

  it('classifies 5xx as retryable server errors', () => {
    for (const status of [500, 502, 503]) {
      const classification = classifyInvoiceExportError(httpError(status))
      expect(classification.outcome).toBe('failed_retryable')
      expect(classification.errorCode).toBe('provider_server_error')
      expect(classification.retryable).toBe(true)
    }
  })

  it('classifies timeout and network failures as retryable', () => {
    const timeout = classifyInvoiceExportError(new CapwayApiError({ message: 'timeout', kind: 'timeout' }))
    expect(timeout.outcome).toBe('failed_retryable')
    expect(timeout.errorCode).toBe('provider_timeout')

    const network = classifyInvoiceExportError(new CapwayApiError({ message: 'ECONNREFUSED', kind: 'network' }))
    expect(network.outcome).toBe('failed_retryable')
    expect(network.errorCode).toBe('provider_unreachable')
  })

  it('classifies missing connection configuration as configuration_error', () => {
    const classification = classifyInvoiceExportError(new Error('Capway-kopplingen är inte färdigkonfigurerad för tenanten.'))
    expect(classification.outcome).toBe('configuration_error')
    expect(classification.errorCode).toBe('connection_not_configured')
  })

  it('classifies token endpoint failures by status', () => {
    const auth = classifyInvoiceExportError(new Error('Capway token kunde inte hämtas (401)'))
    expect(auth.outcome).toBe('configuration_error')
    expect(auth.errorCode).toBe('token_auth_failed')

    const server = classifyInvoiceExportError(new Error('Capway token kunde inte hämtas (503)'))
    expect(server.outcome).toBe('failed_retryable')
    expect(server.errorCode).toBe('token_endpoint_error')
  })

  it('classifies generic network errors as retryable and everything else as terminal failed', () => {
    expect(classifyInvoiceExportError(new Error('fetch failed')).outcome).toBe('failed_retryable')
    expect(classifyInvoiceExportError(new Error('getaddrinfo ENOTFOUND api.capway')).outcome).toBe('failed_retryable')

    const unknown = classifyInvoiceExportError(new Error('Något helt annat gick fel'))
    expect(unknown.outcome).toBe('failed')
    expect(unknown.errorCode).toBe('export_unknown_error')
    expect(unknown.retryable).toBe(false)
  })

  it('preserves the provider response excerpt for auditing', () => {
    const classification = classifyInvoiceExportError(httpError(400, '{"detail":"Ogiltig faktura"}'))
    expect(classification.responseExcerpt).toBe('{"detail":"Ogiltig faktura"}')
  })
})

describe('computeNextRetryAt (exponential backoff)', () => {
  const now = new Date('2026-05-15T12:00:00Z')
  const MINUTE = 60 * 1000

  it('doubles the delay per attempt: 15m, 30m, 1h, 2h...', () => {
    expect(new Date(computeNextRetryAt(1, now)).getTime() - now.getTime()).toBe(15 * MINUTE)
    expect(new Date(computeNextRetryAt(2, now)).getTime() - now.getTime()).toBe(30 * MINUTE)
    expect(new Date(computeNextRetryAt(3, now)).getTime() - now.getTime()).toBe(60 * MINUTE)
    expect(new Date(computeNextRetryAt(4, now)).getTime() - now.getTime()).toBe(120 * MINUTE)
  })

  it('caps the delay at 24 hours', () => {
    const delay = new Date(computeNextRetryAt(20, now)).getTime() - now.getTime()
    expect(delay).toBe(24 * 60 * MINUTE)
  })

  it('has a bounded number of attempts configured', () => {
    expect(INVOICE_EXPORT_MAX_ATTEMPTS).toBeGreaterThan(1)
    expect(INVOICE_EXPORT_MAX_ATTEMPTS).toBeLessThanOrEqual(10)
  })
})
