import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareAndQueueProdatSwitch } from '@/lib/ediel/flows/prodatSwitch'

const io = vi.hoisted(() => ({ withdrawal: vi.fn(), normal: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/ediel/flows/prodatSwitchCancellation', () => ({ prepareAndQueueSwitchCancellation: io.withdrawal }))
vi.mock('@/lib/ediel/intent/switchRenderGateway', () => ({ renderAndQueueNormalSwitch: io.normal }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id, makeServerClient: vi.fn(), findOrCreateSwitchOutbound: vi.fn() }))
vi.mock('@/lib/operations/db', () => ({ getSupplierSwitchRequestById: vi.fn().mockResolvedValue({ id: 'switch', company_id: 'tenant', site_id: 'site', metering_point_id: 'point', prodat_variant: 'C' }), createSupplierSwitchEvent: vi.fn() }))
vi.mock('@/lib/masterdata/db', () => ({ getCustomerSiteById: vi.fn().mockResolvedValue({ id: 'site', company_id: 'tenant' }), getMeteringPointById: vi.fn().mockResolvedValue({ id: 'point' }), getGridOwnerById: vi.fn() }))
vi.mock('@/lib/ediel/prodat', () => ({ allocateProdatSwitchWireReferences: vi.fn() }))
vi.mock('@/lib/ediel/db', () => ({ linkEdielMessage: vi.fn() }))
vi.mock('@/lib/legal/authorizationChain', () => ({ resolveAuthorizationDocumentIdForPowerOfAttorney: vi.fn() }))
vi.mock('@/lib/ediel/core/productionGuards', () => ({ isEdielPortalParty: vi.fn() }))
vi.mock('@/lib/ediel/flows/routeDecisionContext', () => ({ resolveDecisionBackedOutboundContext: vi.fn() }))
vi.mock('@/lib/ediel/intent/intentEngine', () => ({ createEdielMessageIntent: vi.fn() }))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: vi.fn() }))

beforeEach(() => { io.withdrawal.mockReset(); io.normal.mockReset(); io.rpc.mockReset() })
describe('actual switch flow cancellation dispatch', () => {
  it('withdraws through the dedicated owner before new-contract origination gates', async () => {
    const message = { id: 'withdrawal', status: 'draft' }
    io.withdrawal.mockResolvedValue({ status: 'queued', message })
    expect(await prepareAndQueueProdatSwitch({ messageCode: 'Z03', actorUserId: 'actor', switchRequestId: 'switch', communicationRouteId: 'route', environment: 'production' })).toBe(message)
    expect(io.withdrawal).toHaveBeenCalledWith({ companyId: 'tenant', switchRequestId: 'switch', actorUserId: 'actor', preferredRouteId: 'route', environment: 'production' })
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.normal).not.toHaveBeenCalled()
  })
  it('preserves the existing throwing facade when genuine cancellation source is held', async () => {
    io.withdrawal.mockResolvedValue({ status: 'held', missing: ['immutable_original_unavailable'] })
    await expect(prepareAndQueueProdatSwitch({ messageCode: 'Z03', actorUserId: 'actor', switchRequestId: 'switch' })).rejects.toThrow('immutable_original_unavailable')
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.normal).not.toHaveBeenCalled()
  })
})
