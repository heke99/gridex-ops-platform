import { getCapwayAccessToken, resolveCapwayConnectionConfig } from '@/lib/integrations/billing/capway/auth'
import type { CapwayConnectionConfig, CapwayEnvironment, CapwayPurchaseRequest, CapwayPutInvoice, CapwayPutInvoiceResult } from '@/lib/integrations/billing/capway/types'

// Structured provider error so callers can classify outcomes (retryable vs
// rejected vs configuration) instead of parsing the message text.
export class CapwayApiError extends Error {
  readonly httpStatus: number | null
  readonly kind: 'http' | 'network' | 'timeout'
  readonly responseExcerpt: string | null

  constructor(input: { message: string; httpStatus?: number | null; kind?: 'http' | 'network' | 'timeout'; responseExcerpt?: string | null }) {
    super(input.message)
    this.name = 'CapwayApiError'
    this.httpStatus = input.httpStatus ?? null
    this.kind = input.kind ?? 'http'
    this.responseExcerpt = input.responseExcerpt ?? null
  }
}

export class CapwayApticClient {
  constructor(private readonly config: CapwayConnectionConfig) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getCapwayAccessToken(this.config)
    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(init.headers ?? {}),
        },
        cache: 'no-store',
      })
    } catch (error) {
      const isTimeout = error instanceof Error && /timeout|aborted/i.test(error.message)
      throw new CapwayApiError({
        message: `Capway/Aptic API kunde inte nås: ${error instanceof Error ? error.message : 'nätverksfel'}`,
        httpStatus: null,
        kind: isTimeout ? 'timeout' : 'network',
      })
    }

    if (response.status === 204) return {} as T
    const text = await response.text()
    let payload: Record<string, unknown> = {}
    try {
      payload = text ? JSON.parse(text) : {}
    } catch {
      payload = {}
    }
    if (!response.ok) {
      const detail = typeof payload?.detail === 'string' ? payload.detail : typeof payload?.title === 'string' ? payload.title : text
      throw new CapwayApiError({
        message: `Capway/Aptic API ${response.status}: ${detail || 'okänt fel'}`,
        httpStatus: response.status,
        kind: 'http',
        responseExcerpt: text ? text.slice(0, 2000) : null,
      })
    }
    return payload as T
  }

  ping() {
    return this.request<Record<string, unknown>>('/v1/Invoices/Ping', { method: 'GET' })
  }

  createInvoices(invoices: CapwayPutInvoice[]) {
    return this.request<CapwayPutInvoiceResult>('/v1/Invoices', {
      method: 'PUT',
      body: JSON.stringify(invoices),
    })
  }

  getInvoice(invoiceGuid: string) {
    return this.request<Record<string, unknown>>(`/v1/Invoices/${encodeURIComponent(invoiceGuid)}`, { method: 'GET' })
  }

  getFinancialDetails(invoiceGuid: string) {
    return this.request<Record<string, unknown>>(`/v1/Invoices/${encodeURIComponent(invoiceGuid)}/FinancialDetails`, { method: 'GET' })
  }

  getTransactions(invoiceGuid: string) {
    return this.request<Record<string, unknown>>(`/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Transactions`, { method: 'GET' })
  }

  getPurchase(invoiceGuid: string) {
    return this.request<Record<string, unknown>>(`/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Purchase`, { method: 'GET' })
  }

  postPurchase(invoiceGuid: string, payload: CapwayPurchaseRequest) {
    return this.request<Record<string, unknown>>(`/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Purchase`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  getRecourse(invoiceGuid: string) {
    return this.request<Record<string, unknown>>(`/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Recourse`, { method: 'GET' })
  }

  dispute(invoiceGuid: string, payload: { reason?: string | null; disputedAt?: string | null; isDisputed?: boolean | null }) {
    return this.request<Record<string, unknown>>(`/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Dispute`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }

  deprecate(invoiceGuid: string, payload: { deprecationLevel?: 'Reservation' | 'WriteOff'; deprecatedAt?: string | null; note?: string | null }) {
    return this.request<Record<string, unknown>>(`/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Deprecate`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  }
}

export async function createCapwayApticClient(input: { companyId: string; environment?: CapwayEnvironment }) {
  const config = await resolveCapwayConnectionConfig(input)
  return new CapwayApticClient(config)
}
