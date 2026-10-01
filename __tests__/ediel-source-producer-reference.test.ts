import { beforeEach, expect, it, vi } from 'vitest'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ports = vi.hoisted(() => ({ readBrp: vi.fn(), readCancellation: vi.fn(), readService: vi.fn(), intent: vi.fn(), request: vi.fn(), brpGateway: vi.fn(), cancellationGateway: vi.fn(), serviceGateway: vi.fn(), route: vi.fn() }))
const noRequest = { select: () => noRequest, eq: () => noRequest, contains: () => noRequest, order: () => noRequest, limit: () => noRequest, returns: async () => ({ data: [], error: null }), then: (resolve: (result: { data: never[]; error: null }) => unknown) => resolve({ data: [], error: null }) }
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => noRequest } }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: () => ({ from: () => noRequest }) }))
vi.mock('@/lib/cis/db', () => ({ createOutboundRequest: ports.request }))
vi.mock('@/lib/ediel/core/kernel', () => ({ resolveCanonicalOutboundContext: ports.route }))
vi.mock('@/lib/ediel/intent/intentEngine', () => ({ createEdielMessageIntent: ports.intent }))
vi.mock('@/lib/ediel/intent/brpChangeGateway', () => ({ renderAndQueueBrpChange: ports.brpGateway }))
vi.mock('@/lib/ediel/intent/switchCancellationGateway', () => ({ renderAndQueueSwitchCancellation: ports.cancellationGateway }))
vi.mock('@/lib/ediel/intent/renderGateway', () => ({ renderAndQueueServicePermission: ports.serviceGateway }))
vi.mock('@/lib/ediel/production/brpChangeSource', async () => ({ ...await vi.importActual<typeof import('@/lib/ediel/production/brpChangeSource')>('@/lib/ediel/production/brpChangeSource'), readBrpChangeSource: ports.readBrp }))
vi.mock('@/lib/ediel/production/switchCancellationSource', async () => ({ ...await vi.importActual<typeof import('@/lib/ediel/production/switchCancellationSource')>('@/lib/ediel/production/switchCancellationSource'), readSwitchCancellationSource: ports.readCancellation }))
vi.mock('@/lib/ediel/services/permissionOrigin', () => ({ readServicePermissionOrigin: ports.readService }))
vi.mock('@/lib/ediel/services/authorization', () => ({ assertEdielTenantActor: vi.fn() }))
vi.mock('@/lib/ediel/services/commands', () => ({ coordinateEdielServicePermission: vi.fn() }))
import { prepareAndQueueBrpChangeZ09 } from '@/lib/ediel/flows/prodatBrpChange'
import { prepareAndQueueSwitchCancellation } from '@/lib/ediel/flows/prodatSwitchCancellation'
import { prepareAndQueueServicePermissionZ13, prepareAndQueueServicePermissionZ18 } from '@/lib/ediel/flows/prodatServicePermission'
const base = () => ({ status: 'authorized', companyId: id(1), environment: 'test', legalActorId: id(2), providerActorId: id(2), legalSenderId: '12345', legalReceiverId: '54321', customerId: id(3), siteId: id(4), meteringPointId: id(5), pointId: '735123456789012345', gridArea: 'TES', eventId: id(6), switchRequestId: id(7), originalMessageId: id(8), permissionId: id(9), permissionStateVersion: 1, evidenceId: id(10), li: 'ORIGINAL-LI', agreementReference: 'SOURCE-ANJ' })
beforeEach(() => {
  vi.clearAllMocks()
  ports.intent.mockImplementation(async input => ({ ...input, id: id(90) }))
  ports.request.mockResolvedValue({ id: id(91) })
  ports.brpGateway.mockResolvedValue({ status: 'queued' }); ports.cancellationGateway.mockResolvedValue({ status: 'queued' }); ports.serviceGateway.mockResolvedValue({ status: 'queued' })
  ports.route.mockResolvedValue({ companyId: id(1), environment: 'test', actor: { tenantIdentity: { legalActorId: id(2) }, legalActorEdielId: '12345', marketRoles: ['electricity_supplier', 'energy_service_company'] }, senderEdielId: '99111', receiverEdielId: '54321', applicationReference: '23-DDQ-PRODAT', route: { id: id(11) }, routeRuntime: { route_profile_id: id(12) } })
})
// Explicit source/native/gateway ports only; actual producer reference allocation
// is executed. These fixtures do not approve a source or enter a provider.
it('allocates a compact B envelope independently of its LI and binds the same source-owned internal site', async () => {
  ports.readBrp.mockResolvedValue(base())
  await prepareAndQueueBrpChangeZ09({ companyId: id(1), eventId: id(6), actorUserId: id(20) })
  const input = ports.intent.mock.calls[0][0]
  expect(input.interchangeReference).toHaveLength(14)
  expect(input.transactionReference).not.toBe(input.interchangeReference)
  expect(input.customerSiteId).toBe(id(4))
  expect(ports.request.mock.calls[0][0].siteId).toBe(id(4))
  expect(ports.brpGateway).toHaveBeenCalledOnce()
})
it('allocates a fresh compact C envelope while retaining the exact original LI and own site', async () => {
  ports.readCancellation.mockResolvedValue(base())
  await prepareAndQueueSwitchCancellation({ companyId: id(1), switchRequestId: id(7), actorUserId: id(20) })
  expect(ports.intent.mock.calls[0][0].interchangeReference).toHaveLength(14)
  expect(ports.intent.mock.calls[0][0].transactionReference).toBe('ORIGINAL-LI')
  expect(ports.request.mock.calls[0][0].siteId).toBe(id(4))
})
it('allocates a new Z13 LI separately and retains only the actual end-user agreement reference', async () => {
  ports.readService.mockResolvedValue({ ...base(), li: null })
  await prepareAndQueueServicePermissionZ13({ providerCompanyId: id(1), assignmentId: id(21), actorUserId: id(20), expectedVersion: 1, permissionId: id(9) })
  const input = ports.intent.mock.calls[0][0]
  expect(input.interchangeReference).toHaveLength(14)
  expect(input.transactionReference).not.toBe(input.interchangeReference)
  expect(input.payload.authorizationReference).toBe('SOURCE-ANJ')
})
it('retains original source LI for a separate Z18 while allocating a compact new envelope', async () => {
  ports.readService.mockResolvedValue(base())
  await prepareAndQueueServicePermissionZ18({ providerCompanyId: id(1), assignmentId: id(21), actorUserId: id(20), expectedVersion: 1, permissionId: id(9) })
  expect(ports.intent.mock.calls[0][0].interchangeReference).toHaveLength(14)
  expect(ports.intent.mock.calls[0][0].transactionReference).toBe('ORIGINAL-LI')
})
