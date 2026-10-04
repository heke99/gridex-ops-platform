import {beforeEach, describe, expect, it, vi} from 'vitest'

const io = vi.hoisted(() => ({existing: vi.fn(), create: vi.fn(), cancel: vi.fn()}))
vi.mock('@/lib/cis/db', () => ({findOpenOutboundBySource: io.existing, createOutboundRequest: io.create,
  cancelSupplierSwitchOutboundAttemptsForReplacement: io.cancel, repairOutboundRequestCommunicationRoute: vi.fn(), updateOutboundRequestStatus: vi.fn()}))
vi.mock('@/lib/ediel/core/kernel', () => ({finalizeCanonicalOutboundDraft: vi.fn(), resolveCanonicalOutboundContext: vi.fn()}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {}}))
vi.mock('@/lib/ediel/db', () => ({getEdielMessageById: vi.fn()}))
vi.mock('@/lib/ediel/outbox/createOutboxItem', () => ({createOutboxItem: vi.fn()}))
import {findOrCreateSwitchOutbound} from '@/lib/ediel/flows/shared'

const input = {actorUserId: 'actor', switchRequestId: 'switch', customerId: 'customer', siteId: 'site',
  meteringPointId: 'point', gridOwnerId: null, externalReference: null, payload: {}, environment: 'test' as const}
const row = () => ({id: 'existing', operation_id: 'switch', customer_id: 'customer', site_id: 'site',
  metering_point_id: 'point', payload: {environment: 'test'}})

beforeEach(() => {vi.clearAllMocks(); io.existing.mockResolvedValue(row())})
describe('switch outbound reuses its persisted intended environment', () => {
  it('reuses the exact own operation using the real payload environment column', async () => {
    const existing = row(); io.existing.mockResolvedValue(existing)
    expect(await findOrCreateSwitchOutbound(input)).toBe(existing)
    expect(io.create).not.toHaveBeenCalled(); expect(io.cancel).not.toHaveBeenCalled()
  })
  it.each([{environment: 'production'}, {}, {environment: null}])('holds conflicting or unavailable persisted environment %j', async payload => {
    io.existing.mockResolvedValue({...row(), payload})
    await expect(findOrCreateSwitchOutbound(input)).rejects.toThrow('switch_outbound_owned_operation_required')
    expect(io.create).not.toHaveBeenCalled(); expect(io.cancel).not.toHaveBeenCalled()
  })
  it.each(['operation_id', 'customer_id', 'site_id', 'metering_point_id'])('holds a different %s with no new attempt', async field => {
    io.existing.mockResolvedValue({...row(), [field]: 'foreign'})
    await expect(findOrCreateSwitchOutbound(input)).rejects.toThrow('switch_outbound_owned_operation_required')
    expect(io.create).not.toHaveBeenCalled(); expect(io.cancel).not.toHaveBeenCalled()
  })
})
