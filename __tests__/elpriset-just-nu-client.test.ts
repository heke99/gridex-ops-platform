import { describe, expect, it, vi } from 'vitest'
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

describe('Elpriset just nu client', () => {
  it('builds the canonical SE1-SE4 URL format', () => {
    expect(buildElprisetJustNuUrl({ date: '2026-07-24', priceArea: 'SE4' }))
      .toBe('https://www.elprisetjustnu.se/api/v1/prices/2026/07-24_SE4.json')
  })

  it('retries 429 using Retry-After and then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ error: 'rate limited' }, 429, { 'content-type': 'application/json', 'retry-after': '1' }))
      .mockResolvedValueOnce(response(validRows))
    const sleep = vi.fn(async () => undefined)
    const rows = await fetchElprisetJustNuDay({ date: '2026-07-24', priceArea: 'SE3', fetchImpl, sleep })
    expect(rows).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(1000)
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
