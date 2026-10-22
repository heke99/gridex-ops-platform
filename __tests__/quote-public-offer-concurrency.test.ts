import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('@/lib/website/publicContracts', () => ({ resolvePublicContractOffer: io.read }))
import { resolveQuotePublicContractOffer } from '@/lib/website/quotePublicOfferRead'

const input = (overrides: Record<string, unknown> = {}) => ({
  client: { id: 'client-a', company_id: 'company-a' },
  offerReference: 'offer-a', customerType: 'private', channel: 'website', ...overrides,
}) as Parameters<typeof resolveQuotePublicContractOffer>[0]

function deferred() {
  let resolve!: (value: unknown) => void
  let reject!: (error: Error) => void
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('pending public quote offer reads', () => {
  beforeEach(() => { io.read.mockReset() })

  it('shares only the in-flight read for four identical identities and clones each result', async () => {
    const gate = deferred(); io.read.mockReturnValue(gate.promise)
    const calls = Array.from({ length: 4 }, () => resolveQuotePublicContractOffer(input()))
    expect(io.read).toHaveBeenCalledTimes(1)
    gate.resolve({ id: 'public-offer', pricing_snapshot: { amount: 100 }, price_options: [{ option_reference: 'standard' }] })
    const results = await Promise.all(calls)
    expect(results[0]).toEqual(results[1])
    expect(results[0]).not.toBe(results[1])
    results[0]!.pricing_snapshot!.amount = 999
    expect(results[1]!.pricing_snapshot!.amount).toBe(100)
    await resolveQuotePublicContractOffer(input())
    expect(io.read).toHaveBeenCalledTimes(2)
  })

  it('never shares across company, API client, offer or customer type', async () => {
    const gate = deferred(); io.read.mockReturnValue(gate.promise)
    const calls = [input(), input({ client: { id: 'client-a', company_id: 'company-b' } }),
      input({ client: { id: 'client-b', company_id: 'company-a' } }), input({ offerReference: 'offer-b' }), input({ customerType: 'business' })]
      .map(value => resolveQuotePublicContractOffer(value))
    expect(io.read).toHaveBeenCalledTimes(5)
    gate.resolve(null); expect(await Promise.all(calls)).toEqual([null, null, null, null, null])
  })

  it('evicts failures and never caches null or successful completed reads', async () => {
    const gate = deferred(); io.read.mockReturnValue(gate.promise)
    const failed = Promise.allSettled([resolveQuotePublicContractOffer(input()), resolveQuotePublicContractOffer(input())])
    expect(io.read).toHaveBeenCalledTimes(1)
    gate.reject(new Error('Synthetic database failure'))
    expect((await failed).every(row => row.status === 'rejected')).toBe(true)
    io.read.mockResolvedValue(null)
    expect(await resolveQuotePublicContractOffer(input())).toBeNull()
    expect(await resolveQuotePublicContractOffer(input())).toBeNull()
    expect(io.read).toHaveBeenCalledTimes(3)
  })

  it('bypasses Partner API, legacy lookup and incomplete identities', async () => {
    const gate = deferred(); io.read.mockReturnValue(gate.promise)
    const calls = [input({ channel: 'api' }), input({ channel: 'api' }),
      input({ offerReference: '' }), input({ offerReference: '' }),
      input({ client: { company_id: 'company-a' } }), input({ client: { company_id: 'company-a' } })]
      .map(value => resolveQuotePublicContractOffer(value))
    expect(io.read).toHaveBeenCalledTimes(6)
    gate.resolve(null); await Promise.all(calls)
  })

  it('caps tracked pending keys and still performs an ordinary fresh read on overflow', async () => {
    const gate = deferred(); io.read.mockReturnValue(gate.promise)
    const calls = Array.from({ length: 64 }, (_, index) => resolveQuotePublicContractOffer(input({ offerReference: `offer-${index}` })))
    calls.push(resolveQuotePublicContractOffer(input({ offerReference: 'overflow' })))
    calls.push(resolveQuotePublicContractOffer(input({ offerReference: 'overflow' })))
    expect(io.read).toHaveBeenCalledTimes(66)
    gate.resolve(null); await Promise.all(calls)
  })
})
