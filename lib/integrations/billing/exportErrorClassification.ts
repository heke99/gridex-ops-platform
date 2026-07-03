import { CapwayApiError } from '@/lib/integrations/billing/capway/client'

// Terminal vs retryable outcome taxonomy for invoice export attempts.
// Mirrors the invoice_export_items/invoice_export_attempts status check constraints.
export type InvoiceExportOutcome =
  | 'sent'
  | 'rejected'
  | 'configuration_error'
  | 'failed_retryable'
  | 'failed'
  | 'needs_review'

export type InvoiceExportErrorClassification = {
  outcome: Exclude<InvoiceExportOutcome, 'sent'>
  errorCode: string
  message: string
  httpStatus: number | null
  responseExcerpt: string | null
  retryable: boolean
}

export const INVOICE_EXPORT_MAX_ATTEMPTS = 6

const BASE_RETRY_DELAY_MS = 15 * 60 * 1000
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000

// Exponential backoff: 15m, 30m, 1h, 2h, 4h... capped at 24h.
export function computeNextRetryAt(attemptCount: number, now: Date = new Date()): string {
  const exponent = Math.max(0, attemptCount - 1)
  const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** exponent, MAX_RETRY_DELAY_MS)
  return new Date(now.getTime() + delay).toISOString()
}

function classifyHttpStatus(status: number): Pick<InvoiceExportErrorClassification, 'outcome' | 'errorCode' | 'retryable'> {
  if (status === 401 || status === 403) {
    return { outcome: 'configuration_error', errorCode: 'provider_auth_failed', retryable: false }
  }
  if (status === 404) {
    return { outcome: 'configuration_error', errorCode: 'provider_endpoint_not_found', retryable: false }
  }
  if (status === 409) {
    return { outcome: 'needs_review', errorCode: 'provider_conflict', retryable: false }
  }
  if (status === 408 || status === 429) {
    return { outcome: 'failed_retryable', errorCode: status === 429 ? 'provider_rate_limited' : 'provider_timeout', retryable: true }
  }
  if (status >= 400 && status < 500) {
    return { outcome: 'rejected', errorCode: 'provider_rejected_payload', retryable: false }
  }
  if (status >= 500) {
    return { outcome: 'failed_retryable', errorCode: 'provider_server_error', retryable: true }
  }
  return { outcome: 'failed', errorCode: 'provider_unknown_status', retryable: false }
}

export function classifyInvoiceExportError(error: unknown): InvoiceExportErrorClassification {
  const message = error instanceof Error ? error.message : 'Okänt exportfel'

  if (error instanceof CapwayApiError) {
    if (error.kind === 'network' || error.kind === 'timeout') {
      return {
        outcome: 'failed_retryable',
        errorCode: error.kind === 'timeout' ? 'provider_timeout' : 'provider_unreachable',
        message,
        httpStatus: null,
        responseExcerpt: error.responseExcerpt,
        retryable: true,
      }
    }
    if (error.httpStatus !== null) {
      const classified = classifyHttpStatus(error.httpStatus)
      return {
        ...classified,
        message,
        httpStatus: error.httpStatus,
        responseExcerpt: error.responseExcerpt,
      }
    }
  }

  // Connection configuration missing (resolveCapwayConnectionConfig) or token
  // endpoint failures surfaced as plain errors with a known message shape.
  if (/inte färdigkonfigurerad/i.test(message)) {
    return { outcome: 'configuration_error', errorCode: 'connection_not_configured', message, httpStatus: null, responseExcerpt: null, retryable: false }
  }
  const tokenMatch = message.match(/Capway token kunde inte hämtas \((\d{3})\)/)
  if (tokenMatch) {
    const status = Number(tokenMatch[1])
    if (status >= 500) {
      return { outcome: 'failed_retryable', errorCode: 'token_endpoint_error', message, httpStatus: status, responseExcerpt: null, retryable: true }
    }
    return { outcome: 'configuration_error', errorCode: 'token_auth_failed', message, httpStatus: status, responseExcerpt: null, retryable: false }
  }
  if (error instanceof Error && /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket hang up|network/i.test(message)) {
    return { outcome: 'failed_retryable', errorCode: 'provider_unreachable', message, httpStatus: null, responseExcerpt: null, retryable: true }
  }

  return { outcome: 'failed', errorCode: 'export_unknown_error', message, httpStatus: null, responseExcerpt: null, retryable: false }
}
