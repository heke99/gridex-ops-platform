import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildElprisetJustNuUrl, fetchElprisetJustNuDay, SpotPriceProviderError } from '@/lib/pricing/spot/elprisetJustNuClient'

function response(body: unknown, status = 200, headers: Record<string, string> = { 'content-type': 'application/json' }): Response {
  return new Response(JSON.stringify(body), { status, headers })
}

const validRows = [{
  SEK_per_kWh: 0.5,
  EUR_per_kWh: 0.04,
  EXR: 11,
  time_start: '2026-07-23T22:00:00.000Z',
  time_end: '2026-07-23T23:00:00.000Z',
}]

const now = Date.parse('2026-10-20T12:00:00Z')
afterEach(() => vi.restoreAllMocks())

describe('Elpriset just nu client', () => {
  it('builds the canonical SE1-SE4 URL format', () => {
    expect(buildElprisetJustNuUrl({ date: '2026-07-24', priceArea: 'SE4' }))
      .toBe('https://www.elprisetjustnu.se/api/v1/prices/2026/07-24_SE4.json')
  })

  it.each([
    ['short seconds', '1', 1_000],
    ['long seconds', '3600', 3_600_000],
    ['future HTTP date', new Date(now + 3_600_000).toUTCString(), 3_600_000],
    ['past HTTP date', new Date(now - 60_000).toUTCString(), 0],
    ['finite seconds overflowing milliseconds', '1e308', Number.POSITIVE_INFINITY],
    ['huge unsigned seconds', '9'.repeat(400), Number.POSITIVE_INFINITY],
    ['absent header', null, null],
    ['invalid header', 'not-a-delay', null],
    ['invalid infinity literal', 'Infinity', null],
  ] as const)('hands off 429 with %s without an inline retry or sleep', async (_name, header, delay) => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (header !== null) headers['retry-after'] = header
    const fetchImpl = vi.fn().mockResolvedValue(response({ error: 'rate limited' }, 429, headers))
    const sleep = vi.fn(async () => undefined)
    await expect(fetchElprisetJustNuDay({ date: '2026-07-24', priceArea: 'SE3', fetchImpl, sleep }))
      .rejects.toMatchObject({ code: 'provider_rate_limited', status: 429, retryable: true, retryAfterMs: delay })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retains rate-limit metadata when only one attempt is allowed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 429, { 'retry-after': '3600' }))
    const sleep = vi.fn(async () => undefined)
    await expect(fetchElprisetJustNuDay({ date: '2026-07-24', priceArea: 'SE3', fetchImpl, sleep, maxAttempts: 1 }))
      .rejects.toMatchObject({ code: 'provider_rate_limited', retryable: true, retryAfterMs: 3_600_000 })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('stops when a rate limit follows a transient failure', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({ error: 'rate limited' }, 429, { 'content-type': 'application/json', 'retry-after': '1' }))
      .mockResolvedValueOnce(response(validRows))
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined)
    await expect(fetchElprisetJustNuDay({ date: '2026-07-24', priceArea: 'SE3', fetchImpl, sleep }))
      .rejects.toMatchObject({ code: 'provider_rate_limited', retryAfterMs: 1_000 })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(250)
    expect(sleep.mock.calls[0][0]).toBeLessThan(313)
  })

  it.each([408, 503])('keeps the existing retry policy for status %s', async status => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({}, status)).mockResolvedValueOnce(response(validRows))
    const sleep = vi.fn(async () => undefined)
    await expect(fetchElprisetJustNuDay({ date: '2026-07-24', priceArea: 'SE2', fetchImpl, sleep })).resolves.toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
  })

  it('keeps the five-attempt cap for other retryable failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 503))
    const sleep = vi.fn(async () => undefined)
    await expect(fetchElprisetJustNuDay({ date: '2026-07-24', priceArea: 'SE2', fetchImpl, sleep, maxAttempts: 20 }))
      .rejects.toMatchObject({ code: 'provider_unavailable', status: 503 })
    expect(fetchImpl).toHaveBeenCalledTimes(5)
    expect(sleep).toHaveBeenCalledTimes(4)
  })

  it('keeps AbortError normalization and the existing retry policy', async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new DOMException('synthetic abort', 'AbortError')).mockResolvedValueOnce(response(validRows))
    const sleep = vi.fn(async () => undefined)
    await expect(fetchElprisetJustNuDay({ date: '2026-07-24', priceArea: 'SE2', fetchImpl, sleep })).resolves.toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledOnce()
  })

  it('retries 5xx but not a not-published 404', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response(validRows))
    await expect(fetchElprisetJustNuDay({ date: '2026-07-24', priceArea: 'SE2', fetchImpl, sleep: async () => undefined })).resolves.toHaveLength(1)

    const missing = vi.fn().mockResolvedValue(response({}, 404))
    await expect(fetchElprisetJustNuDay({ date: '2026-07-25', priceArea: 'SE2', fetchImpl: missing }))
      .rejects.toMatchObject({ code: 'provider_not_published', retryable: false })
    expect(missing).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid JSON schema and interval length', async () => {
    await expect(fetchElprisetJustNuDay({
      date: '2026-07-24',
      priceArea: 'SE1',
      fetchImpl: vi.fn().mockResolvedValue(response([{ SEK_per_kWh: 'bad' }])) as typeof fetch,
    })).rejects.toBeInstanceOf(SpotPriceProviderError)

    await expect(fetchElprisetJustNuDay({
      date: '2026-07-24',
      priceArea: 'SE1',
      fetchImpl: vi.fn().mockResolvedValue(response([{
        SEK_per_kWh: 1,
        time_start: '2026-07-23T22:00:00Z',
        time_end: '2026-07-23T22:30:00Z',
      }])) as typeof fetch,
    })).rejects.toMatchObject({ code: 'invalid_payload' })
  })
})
