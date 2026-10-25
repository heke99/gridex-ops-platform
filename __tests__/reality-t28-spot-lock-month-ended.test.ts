// reality-defects: T28
// T28 (reality G run 3, G9): with a source that served every day of October in advance the settlement cron locked
// October on 25 October, because the lock only checked coverage. A month's spot settlement is final only after the
// month has ended (Europe/Stockholm); the lock now refuses earlier, whatever the coverage says.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: (...args: unknown[]) => rpc(...args) } }))

const locked = { id: 'l1', source: 'elprisetjustnu', price_area: 'SE3', billing_month: '2026-10', status: 'locked', average_sek_per_kwh: 0.48,
  verified_at: '2026-11-01T06:00:00Z', locked_at: '2026-11-01T06:00:01Z', source_checksum: 'x' }

describe('T28 a spot month is locked only after it has ended', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: locked, error: null }) })

  it('refuses October on 25 October and on 31 October 23:59 Stockholm time, without calling the database', async () => {
    const { lockSpotSettlementMonth } = await import('@/lib/pricing/spot/settlementLocker')
    for (const now of ['2026-10-25T05:21:16Z', '2026-10-31T22:59:59Z']) {
      await expect(lockSpotSettlementMonth({ priceArea: 'SE3', billingMonth: '2026-10', now: new Date(now) })).rejects.toThrow('spot_settlement_month_not_ended')
    }
    expect(rpc).not.toHaveBeenCalled()
  })

  it('locks October from 1 November 00:00 Stockholm time (31 October 23:00Z) and any earlier month', async () => {
    const { lockSpotSettlementMonth } = await import('@/lib/pricing/spot/settlementLocker')
    await expect(lockSpotSettlementMonth({ priceArea: 'SE3', billingMonth: '2026-10', now: new Date('2026-10-31T23:00:00Z') })).resolves.toMatchObject({ status: 'locked' })
    await expect(lockSpotSettlementMonth({ priceArea: 'SE3', billingMonth: '2026-09', now: new Date('2026-10-25T05:21:16Z') })).resolves.toMatchObject({ status: 'locked' })
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
