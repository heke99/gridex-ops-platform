import {
  getCapwayAccessToken,
  resolveCapwayConnectionConfig,
} from '@/lib/integrations/billing/capway/auth'
import type {
  CapwayConnectionConfig,
  CapwayEnvironment,
  CapwayInvoiceListResult,
  CapwayPurchaseRequest,
  CapwayPutInvoice,
  CapwayPutInvoiceResult,
} from '@/lib/integrations/billing/capway/types'

// Structured provider error so callers can classify outcomes (retryable vs
// rejected vs configuration) instead of parsing the message text.
export class CapwayApiError extends Error {
  readonly httpStatus: number | null
  readonly kind: 'http' | 'network' | 'timeout'
  readonly responseExcerpt: string | null

  constructor(input: {
    message: string
    httpStatus?: number | null
    kind?: 'http' | 'network' | 'timeout'
    responseExcerpt?: string | null
  }) {
    super(input.message)
    this.name = 'CapwayApiError'
    this.httpStatus = input.httpStatus ?? null
    this.kind = input.kind ?? 'http'
    this.responseExcerpt = input.responseExcerpt ?? null
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function escapedODataString(value: string) {
  return value.replace(/'/g, "''")
}

export class CapwayApticClient {
  constructor(private readonly config: CapwayConnectionConfig) {}

  private async authorizationHeaders(): Promise<Record<string, string>> {
    if (this.config.authMode === 'apikey') {
      if (!this.config.apiKey || !this.config.apiKeyHeader) {
        throw new Error('Capway/Aptic API-key-konfiguration saknar key eller headernamn.')
      }
      return { [this.config.apiKeyHeader]: this.config.apiKey }
    }
    const token = await getCapwayAccessToken(this.config)
    return { Authorization: `Bearer ${token}` }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const authHeaders = await this.authorizationHeaders()
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort(new Error('Capway request timeout')),
      30_000,
    )
    let response: Response
    try {
      response = await fetch(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...authHeaders,
          ...(init.headers ?? {}),
        },
        cache: 'no-store',
        signal: init.signal ?? controller.signal,
      })
    } catch (error) {
      const isTimeout =
        error instanceof Error && /timeout|aborted|abort/i.test(error.message)
      throw new CapwayApiError({
        message: `Capway/Aptic API kunde inte nås: ${error instanceof Error ? error.message : 'nätverksfel'}`,
        httpStatus: null,
        kind: isTimeout ? 'timeout' : 'network',
      })
    } finally {
      clearTimeout(timeout)
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
      const detail =
        typeof payload?.detail === 'string'
          ? payload.detail
          : typeof payload?.title === 'string'
            ? payload.title
            : text
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
    return this.request<Record<string, unknown>>('/v1/Invoices/Ping', {
      method: 'GET',
    })
  }

  listInvoicesByExternalReference(externalReferenceCode: string) {
    const filter = `externalReferenceCode eq '${escapedODataString(externalReferenceCode)}'`
    const query = new URLSearchParams({ $filter: filter, $top: '2' })
    return this.request<CapwayInvoiceListResult>(`/v1/Invoices?${query.toString()}`, {
      method: 'GET',
    })
  }

  private async reconcileCreatedInvoice(
    externalReferenceCode: string | null | undefined,
  ): Promise<CapwayPutInvoiceResult | null> {
    if (!externalReferenceCode?.trim()) return null

    // Aptic documents filtered GET /v1/Invoices but not an Idempotency-Key
    // contract for PUT. Reconcile on Gridex's stable externalReferenceCode so
    // a lost create response cannot cause a blind duplicate on retry.
    const delays = [0, 250, 750]
    for (const delay of delays) {
      if (delay) await sleep(delay)
      try {
        const result = await this.listInvoicesByExternalReference(
          externalReferenceCode,
        )
        const invoiceGuids = (result.value ?? [])
          .map((row) => row.invoiceGuid)
          .filter(
            (value): value is string =>
              typeof value === 'string' && Boolean(value.trim()),
          )
        if (invoiceGuids.length > 1) {
          throw new CapwayApiError({
            message:
              'Capway/Aptic returnerade flera fakturor för samma Gridex externalReferenceCode.',
            httpStatus: 409,
            kind: 'http',
          })
        }
        if (invoiceGuids.length === 1) {
          return { invoiceGuids, reconciled: true }
        }
      } catch (error) {
        if (
          error instanceof CapwayApiError &&
          error.httpStatus !== null &&
          [400, 404].includes(error.httpStatus)
        ) {
          // Some tenant-specific Aptic configurations may restrict filtering.
          // In that case keep the original create error as source of truth.
          return null
        }
        if (delay === delays.at(-1)) throw error
      }
    }
    return null
  }

  async createInvoices(
    invoices: CapwayPutInvoice[],
    idempotencyKey: string,
  ): Promise<CapwayPutInvoiceResult> {
    if (!idempotencyKey.trim()) {
      throw new Error('Provider-idempotensnyckel krävs.')
    }
    if (invoices.length !== 1) {
      throw new Error(
        'Gridex skickar exakt en Aptic-faktura per exportpost för entydig replay och avstämning.',
      )
    }
    const externalReferenceCode = invoices[0]?.externalReferenceCode

    // Check before PUT as well. This is the safe retry path after a previous
    // process crashed after provider creation but before local persistence.
    const existing = await this.reconcileCreatedInvoice(externalReferenceCode)
    if (existing) return existing

    try {
      return await this.request<CapwayPutInvoiceResult>('/v1/Invoices', {
        method: 'PUT',
        // Keep the internal provider request id for gateways that support a
        // custom idempotency header, but correctness does not depend on it.
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify(invoices),
      })
    } catch (error) {
      const uncertain =
        error instanceof CapwayApiError &&
        (error.kind === 'network' ||
          error.kind === 'timeout' ||
          error.httpStatus === 408 ||
          error.httpStatus === 409 ||
          (error.httpStatus !== null && error.httpStatus >= 500))
      if (uncertain) {
        const reconciled = await this.reconcileCreatedInvoice(
          externalReferenceCode,
        ).catch(() => null)
        if (reconciled) return reconciled
      }
      throw error
    }
  }

  getInvoice(invoiceGuid: string) {
    return this.request<Record<string, unknown>>(
      `/v1/Invoices/${encodeURIComponent(invoiceGuid)}`,
      { method: 'GET' },
    )
  }

  getFinancialDetails(invoiceGuid: string) {
    return this.request<Record<string, unknown>>(
      `/v1/Invoices/${encodeURIComponent(invoiceGuid)}/FinancialDetails`,
      { method: 'GET' },
    )
  }

  getTransactions(invoiceGuid: string) {
    return this.request<Record<string, unknown>>(
      `/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Transactions`,
      { method: 'GET' },
    )
  }

  getPurchase(invoiceGuid: string) {
    return this.request<Record<string, unknown>>(
      `/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Purchase`,
      { method: 'GET' },
    )
  }

  postPurchase(invoiceGuid: string, payload: CapwayPurchaseRequest) {
    return this.request<Record<string, unknown>>(
      `/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Purchase`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    )
  }

  getRecourse(invoiceGuid: string) {
    return this.request<Record<string, unknown>>(
      `/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Recourse`,
      { method: 'GET' },
    )
  }

  dispute(
    invoiceGuid: string,
    payload: {
      reason?: string | null
      disputedAt?: string | null
      isDisputed?: boolean | null
    },
  ) {
    return this.request<Record<string, unknown>>(
      `/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Dispute`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    )
  }

  deprecate(
    invoiceGuid: string,
    payload: {
      deprecationLevel?: 'Reservation' | 'WriteOff'
      deprecatedAt?: string | null
      note?: string | null
    },
  ) {
    return this.request<Record<string, unknown>>(
      `/v1/Invoices/${encodeURIComponent(invoiceGuid)}/Deprecate`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    )
  }
}

export async function createCapwayApticClient(input: {
  companyId: string
  environment?: CapwayEnvironment
}) {
  const config = await resolveCapwayConnectionConfig(input)
  return new CapwayApticClient(config)
}
