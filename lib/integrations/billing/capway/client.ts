import { getCapwayAccessToken, resolveCapwayConnectionConfig } from '@/lib/integrations/billing/capway/auth'
import type { CapwayConnectionConfig, CapwayEnvironment, CapwayPurchaseRequest, CapwayPutInvoice, CapwayPutInvoiceResult } from '@/lib/integrations/billing/capway/types'

export class CapwayApticClient {
  constructor(private readonly config: CapwayConnectionConfig) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getCapwayAccessToken(this.config)
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    })

    if (response.status === 204) return {} as T
    const text = await response.text()
    const payload = text ? JSON.parse(text) : {}
    if (!response.ok) {
      const detail = typeof payload?.detail === 'string' ? payload.detail : typeof payload?.title === 'string' ? payload.title : text
      throw new Error(`Capway/Aptic API ${response.status}: ${detail || 'okänt fel'}`)
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
