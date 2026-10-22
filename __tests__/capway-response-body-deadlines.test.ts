import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CapwayApiError, CapwayApticClient } from '@/lib/integrations/billing/capway/client'
import { clearCapwayTokenCache, getCapwayAccessToken } from '@/lib/integrations/billing/capway/auth'
import type { CapwayConnectionConfig, CapwayPutInvoice } from '@/lib/integrations/billing/capway/types'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => { throw new Error('No database access in provider deadline tests') } } }))

const apiConfig: CapwayConnectionConfig = {
  companyId: 'synthetic-company', environment: 'test', provider: 'capway_aptic',
  baseUrl: 'https://capway.invalid', authMode: 'apikey', apiKey: 'synthetic-key',
  apiKeyHeader: 'X-Unit-Key', defaultService: 'Invoicing', defaultFinancingMode: 'invoice_service',
}
const oauthConfig: CapwayConnectionConfig = {
  ...apiConfig, authMode: 'oauth2', tokenUrl: 'https://capway.invalid/token',
  clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
}
const cleanupBodies: Array<() => void> = []

function observe<T>(promise: Promise<T>) {
  const result: { status: 'pending' | 'fulfilled' | 'rejected'; value?: T; error?: unknown } = { status: 'pending' }
  const done = promise.then(
    value => { result.status = 'fulfilled'; result.value = value },
    error => { result.status = 'rejected'; result.error = error },
  )
  return { result, done }
}

// Real Response body consumption over an inert stream. The fake fetch boundary
// connects its AbortSignal to the body just as native fetch does; no HTTP runs.
function delayedBody(signal: AbortSignal | null | undefined, status = 200) {
  if (!signal) throw new Error('The provider request must carry its deadline signal')
  let body!: ReadableStreamDefaultController<Uint8Array>
  let closed = false
  const onAbort = () => {
    if (closed) return
    closed = true
    body.error(signal.reason)
  }
  const stream = new ReadableStream<Uint8Array>({ start(controller) { body = controller } })
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  const finish = (text: string) => {
    if (closed) return
    closed = true
    signal.removeEventListener('abort', onAbort)
    body.enqueue(new TextEncoder().encode(text))
    body.close()
  }
  cleanupBodies.push(() => finish('{}'))
  return {
    response: new Response(stream, { status, headers: { 'Content-Type': 'application/json' } }),
    signal,
    finish,
    fail(error: Error) {
      if (closed) return
      closed = true
      signal.removeEventListener('abort', onAbort)
      body.error(error)
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'))
  clearCapwayTokenCache()
})

afterEach(async () => {
  for (const cleanup of cleanupBodies.splice(0)) cleanup()
  await vi.runOnlyPendingTimersAsync()
  clearCapwayTokenCache()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('Capway API response body deadlines', () => {
  it('aborts a stalled body at 30 seconds even when headers arrived immediately', async () => {
    let body!: ReturnType<typeof delayedBody>
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      body = delayedBody(init.signal)
      return body.response
    }))
    const call = observe(new CapwayApticClient(apiConfig).ping())
    await vi.advanceTimersByTimeAsync(29_999)
    expect(call.result.status).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(call.result.status).toBe('rejected')
    expect(call.result.error).toBeInstanceOf(CapwayApiError)
    expect(call.result.error).toMatchObject({ kind: 'timeout', httpStatus: null })
    expect(body.signal.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('shares the 30-second budget between delayed headers and the body', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      await new Promise(resolve => setTimeout(resolve, 20_000))
      return delayedBody(init.signal).response
    }))
    const call = observe(new CapwayApticClient(apiConfig).getInvoice('synthetic-invoice'))
    await vi.advanceTimersByTimeAsync(29_999)
    expect(call.result.status).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(call.result.status).toBe('rejected')
    expect(call.result.error).toMatchObject({ kind: 'timeout' })
  })

  it('returns a body completed just before the deadline and cleans up its timer', async () => {
    let body!: ReturnType<typeof delayedBody>
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      body = delayedBody(init.signal)
      return body.response
    }))
    const call = observe(new CapwayApticClient(apiConfig).ping())
    await vi.advanceTimersByTimeAsync(29_999)
    body.finish('{"ok":true}')
    await call.done
    expect(call.result).toMatchObject({ status: 'fulfilled', value: { ok: true } })
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(body.signal.aborted).toBe(false)
  })

  it('classifies a broken response body as a network failure for write reconciliation', async () => {
    let body!: ReturnType<typeof delayedBody>
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      body = delayedBody(init.signal)
      return body.response
    }))
    const call = observe(new CapwayApticClient(apiConfig).ping())
    await vi.advanceTimersByTimeAsync(0)
    body.fail(new Error('Socket closed during response body'))
    await call.done
    expect(call.result.error).toBeInstanceOf(CapwayApiError)
    expect(call.result.error).toMatchObject({ kind: 'network', httpStatus: null })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves HTTP rejection status and the response excerpt', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"invalid invoice"}', { status: 422 })))
    await expect(new CapwayApticClient(apiConfig).ping()).rejects.toMatchObject({
      kind: 'http', httpStatus: 422, responseExcerpt: '{"detail":"invalid invoice"}',
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves no-content and invalid-JSON success handling', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response('not JSON', { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const client = new CapwayApticClient(apiConfig)
    await expect(client.ping()).resolves.toEqual({})
    await expect(client.ping()).resolves.toEqual({})
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up after a network failure before headers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network connection refused') }))
    await expect(new CapwayApticClient(apiConfig).ping()).rejects.toMatchObject({ kind: 'network' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reconciles a provider-created invoice after its create response body times out without another PUT', async () => {
    const methods: string[] = []
    let created = false
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      methods.push(init.method ?? 'GET')
      if (init.method === 'PUT') {
        created = true
        return delayedBody(init.signal).response
      }
      return Response.json({ value: created ? [{ invoiceGuid: 'synthetic-reconciled-guid' }] : [] })
    }))
    const invoice: CapwayPutInvoice = { externalReferenceCode: 'synthetic-stable-reference', customer: {}, debts: [] }
    const call = observe(new CapwayApticClient(apiConfig).createInvoices([invoice], 'synthetic-idempotency-key'))
    // The existing pre-create reconciliation performs three reads with 250/750ms delays.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(created).toBe(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(call.result).toMatchObject({
      status: 'fulfilled', value: { invoiceGuids: ['synthetic-reconciled-guid'], reconciled: true },
    })
    expect(methods).toEqual(['GET', 'GET', 'GET', 'PUT', 'GET'])
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('Capway OAuth response body deadlines and cache', () => {
  it('aborts a stalled token body at 15 seconds and does not cache the failed response', async () => {
    let body!: ReturnType<typeof delayedBody>
    const fetcher = vi.fn().mockImplementationOnce(async (_url: string, init: RequestInit) => {
      body = delayedBody(init.signal)
      return body.response
    }).mockImplementationOnce(async () => Response.json({ access_token: 'synthetic-recovered-token', expires_in: 120 }))
    vi.stubGlobal('fetch', fetcher)
    const call = observe(getCapwayAccessToken(oauthConfig))
    await vi.advanceTimersByTimeAsync(14_999)
    expect(call.result.status).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(call.result.status).toBe('rejected')
    expect(call.result.error).toMatchObject({ message: 'Capway token timeout' })
    expect(body.signal.aborted).toBe(true)
    await expect(getCapwayAccessToken(oauthConfig)).resolves.toBe('synthetic-recovered-token')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reads a token body before clearing the timer and caches only the complete token', async () => {
    let body!: ReturnType<typeof delayedBody>
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      body = delayedBody(init.signal)
      return body.response
    })
    vi.stubGlobal('fetch', fetcher)
    const call = observe(getCapwayAccessToken(oauthConfig))
    await vi.advanceTimersByTimeAsync(14_999)
    body.finish('{"access_token":"synthetic-complete-token","expires_in":120}')
    await call.done
    expect(call.result).toMatchObject({ status: 'fulfilled', value: 'synthetic-complete-token' })
    await expect(getCapwayAccessToken(oauthConfig)).resolves.toBe('synthetic-complete-token')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(body.signal.aborted).toBe(false)
  })

  it('preserves the cache refresh margin and clears timers after token success', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'synthetic-first', expires_in: 120 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'synthetic-refreshed', expires_in: 120 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(getCapwayAccessToken(oauthConfig)).resolves.toBe('synthetic-first')
    await vi.advanceTimersByTimeAsync(59_999)
    await expect(getCapwayAccessToken(oauthConfig)).resolves.toBe('synthetic-first')
    await vi.advanceTimersByTimeAsync(1)
    await expect(getCapwayAccessToken(oauthConfig)).resolves.toBe('synthetic-refreshed')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves token HTTP error details and leaves no cached token', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error_description: 'invalid client' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ access_token: 'synthetic-retry', expires_in: 120 }))
    vi.stubGlobal('fetch', fetcher)
    await expect(getCapwayAccessToken(oauthConfig)).rejects.toThrow('Capway token kunde inte hämtas (401): invalid client')
    await expect(getCapwayAccessToken(oauthConfig)).resolves.toBe('synthetic-retry')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})
