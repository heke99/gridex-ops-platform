import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeNextDurableE66 } from '@/lib/inbound-mail/normalizeDurableE66'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc } }))

const scope = {
  companyId: '11111111-1111-4111-8111-111111111111',
  mailboxId: '22222222-2222-4222-8222-222222222222',
  actorUserId: '33333333-3333-4333-8333-333333333333',
  environment: 'test' as const,
}
const sourceId = '44444444-4444-4444-8444-444444444444'
const leaseToken = '55555555-5555-4555-8555-555555555555'
const lease = {
  p_company: scope.companyId,
  p_mailbox: scope.mailboxId,
  p_actor: scope.actorUserId,
  p_environment: scope.environment,
  p_source: sourceId,
  p_lease: leaseToken,
}
const chunk = { ...lease, p_next: 0, p_limit: 2 }

const normalize = () => normalizeNextDurableE66(scope, { maxChunks: 1, budgetMs: 5_000 })
const lostResponse = { data: null, error: { message: 'TypeError: fetch failed', code: '' }, status: 0 }

describe('E66 normalization commit recovery', () => {
  beforeEach(() => {
    rpc.mockReset()
    rpc.mockResolvedValueOnce({ data: { kind: 'claimed', sourceId, leaseToken }, error: null, status: 200 })
    rpc.mockResolvedValueOnce({ data: { sourceId, nextOrdinal: 0, observationCount: 2 }, error: null, status: 200 })
  })

  it('confirms the original terminal response with the exact attempted scope, lease and checkpoint', async () => {
    rpc.mockResolvedValueOnce(lostResponse)
    rpc.mockResolvedValueOnce({ data: { state: 'progress', nextOrdinal: 2 }, error: null, status: 200 })

    await expect(normalize()).resolves.toEqual({ state: 'ready', sourceId, nextOrdinal: 2, observationCount: 2 })
    expect(rpc).toHaveBeenNthCalledWith(3, 'gridex_normalize_e66_with_customer_outcome_v1', chunk)
    expect(rpc).toHaveBeenNthCalledWith(4, 'gridex_read_e66_normalization_chunk_receipt_v1', chunk)
    expect(rpc).toHaveBeenCalledTimes(4)
  })

  it('keeps a transport failure unconfirmed when there is no exact receipt', async () => {
    rpc.mockResolvedValueOnce(lostResponse)
    rpc.mockResolvedValueOnce({ data: null, error: null, status: 200 })

    await expect(normalize()).rejects.toThrow('e66_normalization_chunk_unconfirmed')
    expect(rpc).toHaveBeenNthCalledWith(4, 'gridex_read_e66_normalization_chunk_receipt_v1', chunk)
    expect(rpc).toHaveBeenCalledTimes(4)
  })

  it('checks the exact smaller attempt after a confirmed statement timeout', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'statement timeout', code: '57014' }, status: 500 })
    rpc.mockResolvedValueOnce(lostResponse)
    rpc.mockResolvedValueOnce({ data: { state: 'progress', nextOrdinal: 1 }, error: null, status: 200 })
    rpc.mockResolvedValueOnce({ data: true, error: null, status: 200 })

    await expect(normalize()).resolves.toEqual({ state: 'progress', sourceId, nextOrdinal: 1, observationCount: 2 })
    expect(rpc).toHaveBeenNthCalledWith(4, 'gridex_normalize_e66_with_customer_outcome_v1', { ...chunk, p_limit: 1 })
    expect(rpc).toHaveBeenNthCalledWith(5, 'gridex_read_e66_normalization_chunk_receipt_v1', { ...chunk, p_limit: 1 })
    expect(rpc).toHaveBeenNthCalledWith(6, 'gridex_yield_e66_normalization_v1', { ...lease, p_next: 1 })
  })

  it('propagates a confirmed SQL rejection without trying to recover it as a transport error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'stage_probe_stale', code: 'P0001' }, status: 400 })

    await expect(normalize()).rejects.toThrow('e66_normalization_chunk_failed:stage_probe_stale')
    expect(rpc).toHaveBeenCalledTimes(3)
  })
})
