// masterplan: SC-039
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ result: {} as Record<string, unknown> }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: async () => ({ data: db.result, error: null }) } }))
import * as supply from '@/lib/ediel/flows/supplyMarketTransition'

const ID = '00000000-0000-4000-8000-000000000001'
const RECEIPT = '00000000-0000-4000-8000-000000000002'
const message = { id: ID, company_id: ID, direction: 'inbound', message_family: 'PRODAT', message_code: 'Z04' } as const
const appliedPartition = [{ object: { messageIndex: 0, messageReference: 'L-own', objectId: '735999999999999999', identityAgency: '9',
  registers: [{ lineIndex: 0, segmentIndex: 3, lineNumber: '1', registerIndex: null, registerPosition: 1 }] },
  disposition: 'applied', effectReceiptId: RECEIPT, effectFactsHash: 'a'.repeat(64) }]
const apply = () => supply.applySupplyMarketSource({ actorUserId: ID, message })
beforeEach(() => { db.result = { applied: true, idempotent: false, periods: [], commits: [],
  partition: appliedPartition, effectReceiptIds: [RECEIPT], switchIds: [] } })

describe('SC039 late-L causal no-effect result', () => {
  it('preserves its committed own receipt for ACKs without inventing a switch, period or business commit', async () => {
    const result = await apply()
    expect(result).toMatchObject({ applied: true, fullyApplied: true, reviewRequired: false, switchIds: [], periods: [], commits: [], effectReceiptIds: [RECEIPT] })
    expect(supply.supplyMarketHasBusinessEffects(result)).toBe(false)
  })
  it('preserves legacy ancillary projections when the optional switch list is absent', async () => {
    delete db.result.switchIds
    const result = await apply()
    expect(result.switchIds).toBeUndefined()
    expect(supply.supplyMarketHasBusinessEffects(result)).toBe(true)
  })
  it.each([{ value: null }, { value: 'not-an-array' }, { value: [ID, ID] }, { value: ['not-a-uuid'] },
    { value: [123] }, { value: Array(8193).fill(ID) }])('refuses malformed explicit switch IDs instead of silently treating them as no effect (%#)', async ({ value }) => {
    db.result.switchIds = value
    await expect(apply()).rejects.toThrow('supply_switch_ids_invalid')
  })
  it('retains actual switch effects even with no new period or commit', async () => {
    db.result.switchIds = [ID]
    const result = await apply()
    expect(result.switchIds).toEqual([ID])
    expect(supply.supplyMarketHasBusinessEffects(result)).toBe(true)
  })
  it('never suppresses actual period or business commit effects merely because the switch list is empty', async () => {
    const result = await apply()
    expect(supply.supplyMarketHasBusinessEffects({ ...result, periods: [{ id: ID, status: 'active' }] })).toBe(true)
    expect(supply.supplyMarketHasBusinessEffects({ ...result, commits: [{ switchRequestId: ID, supplyPeriodId: ID, customerId: ID, meteringPointId: ID, siteId: ID }] })).toBe(true)
    expect(supply.supplyMarketHasBusinessEffects({ ...result, partition: null })).toBe(true)
  })
  it('keeps held partitions held and preserves replay identity', async () => {
    db.result = { applied: false, idempotent: true, periods: [], commits: [], switchIds: [],
      partition: [{ object: appliedPartition[0].object, disposition: 'held', reason: 'normal_z04_locked_original_scope_required' }] }
    const result = await apply()
    expect(result).toMatchObject({ applied: false, fullyApplied: false, reviewRequired: true, idempotent: true, effectReceiptIds: [] })
    expect(supply.supplyMarketHasBusinessEffects(result)).toBe(false)
  })
})
