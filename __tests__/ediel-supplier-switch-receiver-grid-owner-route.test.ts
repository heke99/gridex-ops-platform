// FINDINGS H-10: Z03C/Z08 resolve the receiver's own grid-owner route, not only the tenant's generic route.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { io, basis } = vi.hoisted(() => ({ io: { route: vi.fn(), owners: vi.fn() },
  basis: { companyId: 'tenant', environment: 'production', legalReceiverId: '7359992000000', customerId: 'c', siteId: 's', pointId: 'p', gridArea: 'ABC' } }))
vi.mock('@/lib/ediel/core/kernel', () => ({ resolveCanonicalOutboundContext: io.route }))
vi.mock('@/lib/grid-owners/platformGridOwnerResolver', () => ({ selectTenantUsableGridOwners: io.owners }))
vi.mock('@/lib/ediel/production/switchCancellationSource', () => ({ readSwitchCancellationSource: vi.fn().mockResolvedValue({ ...basis, switchRequestId: 'sw' }), assertSwitchCancellationRoute: vi.fn() }))
vi.mock('@/lib/ediel/production/supplyRescissionOperation', () => ({ readSupplyRescissionMandate: vi.fn().mockResolvedValue({ ...basis, mandateId: 'm' }), assertSupplyRescissionRoute: vi.fn() }))
vi.mock('@/lib/ediel/production/bilateralProdatClosureOperation', () => ({ readBilateralClosureOperation: vi.fn().mockResolvedValue({ ...basis, operationId: 'o' }), assertBilateralClosureRoute: vi.fn() }))
vi.mock('@/lib/ediel/core/applicationReferenceResolver', () => ({ resolveApplicationReference: () => '23-DDQ-PRODAT' }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: vi.fn() }))
vi.mock('@/lib/cis/db', () => ({ createOutboundRequest: vi.fn() }))
vi.mock('@/lib/ediel/intent/intentEngine', () => ({ createEdielMessageIntent: vi.fn() }))
vi.mock('@/lib/ediel/intent/switchCancellationGateway', () => ({ renderAndQueueSwitchCancellation: vi.fn() }))
vi.mock('@/lib/ediel/intent/supplyRescissionGateway', () => ({ renderAndQueueSupplyRescission: vi.fn() }))
vi.mock('@/lib/ediel/intent/bilateralClosureGateway', () => ({ renderAndQueueBilateralClosure: vi.fn() }))

import { prepareAndQueueSwitchCancellation } from '@/lib/ediel/flows/prodatSwitchCancellation'
import { prepareAndQueueSupplyRescissionZ08 } from '@/lib/ediel/flows/prodatSupplyRescission'
import { prepareAndQueueBilateralClosureZ08 } from '@/lib/ediel/flows/prodatBilateralClosure'

// The route stops each flow right after the lookup: only the lookup arguments are under test.
const stop = new Error('stop_after_route')
const flows = {
  'Z03C cancellation': () => prepareAndQueueSwitchCancellation({ companyId: 'tenant', switchRequestId: 'sw', actorUserId: 'a' }),
  'Z08 rescission': () => prepareAndQueueSupplyRescissionZ08({ companyId: 'tenant', actorUserId: 'a', mandateId: 'm' }),
  'Z08 bilateral closure': () => prepareAndQueueBilateralClosureZ08({ companyId: 'tenant', actorUserId: 'a', operationId: 'o' }),
}

beforeEach(() => { io.route.mockReset().mockRejectedValue(stop); io.owners.mockReset() })
describe.each(Object.entries(flows))('%s route lookup', (_name, run) => {
  it('passes the one tenant-usable grid owner of the legal receiver', async () => {
    io.owners.mockResolvedValue([{ id: 'go', name: 'Nät AB', ediel_id: basis.legalReceiverId }])
    await expect(run()).rejects.toBe(stop)
    expect(io.owners).toHaveBeenCalledWith({ companyId: 'tenant', select: 'id,name,ediel_id', match: { ediel_id: basis.legalReceiverId, is_active: true } })
    expect(io.route).toHaveBeenCalledWith(expect.objectContaining({ requestType: 'supplier_switch', gridOwner: { id: 'go', name: 'Nät AB', ediel_id: basis.legalReceiverId }, receiverEdielId: basis.legalReceiverId }))
  })
  it('selects no grid owner when the receiver is ambiguous or absent', async () => {
    io.owners.mockResolvedValue([{ id: 'a' }, { id: 'b' }])
    await expect(run()).rejects.toBe(stop)
    expect(io.route).toHaveBeenCalledWith(expect.objectContaining({ gridOwner: null }))
  })
})
