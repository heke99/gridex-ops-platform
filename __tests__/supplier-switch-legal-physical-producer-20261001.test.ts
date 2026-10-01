import { beforeEach, expect, it, vi } from 'vitest'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { selectedAddressFact, selectedInvoiceeFact } from './fixtures/prodat-ud'
import type { buildProdatZ03FromSwitch } from '@/lib/ediel/prodat/compatAdapter'
// Actual exported orchestration and renderer; only outer current repository,
// routing/readiness result, message persistence and queue boundaries are memory.
// No SQL/Auth/privilege/receive/dispatch/provider exercise occurs.
const boundary = vi.hoisted(() => ({ request: {} as Record<string, unknown>, site: {}, point: {}, grid: {},
  context: {} as Record<string, unknown>, message: null as Record<string, unknown> | null,
  queues: 0, writes: [] as Array<Record<string, unknown>> }))
const memory = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: true, error: null })),
  from: vi.fn((name: string) => {
    if (name !== 'supplier_switch_requests') throw Error('unexpected_memory_repository:' + name)
    const filters: Record<string, unknown> = {}, result = { data: boundary.request, error: null }
    const query = { eq: (key: string, value: unknown) => { filters[key] = value; return query },
      select: () => query, single: async () => result, maybeSingle: async () => result,
      then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) }
    return { update: (patch: Record<string, unknown>) => { boundary.writes.push(patch); Object.assign(boundary.request, patch); return query } }
  }),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: memory }))
vi.mock('@/lib/masterdata/db', () => ({ getGridOwnerById: async () => boundary.grid,
  getMeteringPointById: async () => boundary.point, getCustomerSiteById: async () => boundary.site }))
vi.mock('@/lib/operations/db', () => ({ getSupplierSwitchRequestById: async () => boundary.request,
  createSupplierSwitchEvent: async () => null }))
vi.mock('@/lib/ediel/db', () => ({ linkEdielMessage: async () => null }))
vi.mock('@/lib/legal/authorizationChain', () => ({ resolveAuthorizationDocumentIdForPowerOfAttorney: async () => 'unused' }))
vi.mock('@/lib/ediel/flows/routeDecisionContext', () => ({ resolveDecisionBackedOutboundContext: async () => boundary.context }))
vi.mock('@/lib/ediel/intent/intentEngine', () => ({ createEdielMessageIntent: async () => ({ id: 'memory-intent', validationStatus: 'valid' }) }))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry', () => ({ resolveCanonicalRulePack: async () => ({ rulePackId: 'memory-pack',
  messageProfileId: 'memory-profile', profileKey: 'PRODAT:Z03:L:26.A:r3', guideVersion: '26.A', guideRevision: '3', fieldMatrixVersion: '26.A:r3' }) }))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (id: string) => id, makeServerClient: async () => memory,
  findOrCreateSwitchOutbound: async () => ({ id: 'memory-outbound' }),
  finalizeOutboundDraft: async ({ draft }: { draft: Record<string, unknown> }) => {
    boundary.message ??= { id: 'f0350000-0000-4000-8000-000000000020', raw_payload: draft.rawPayload,
      transaction_reference: draft.transactionReference, sender_ediel_id: draft.senderEdielId, receiver_ediel_id: draft.receiverEdielId,
      parsed_payload: draft.parsedPayload, status: 'prepared', switch_request_id: draft.switchRequestId }
    return boundary.message
  }, queuePreparedEdielMessage: async () => { boundary.queues++ },
}))
import { prepareAndQueueEdielZ03 } from '@/lib/ediel/flows/prodatSwitch'
const id = (n: number) => `f0350000-0000-4000-8000-${String(n).padStart(12, '0')}`
const requestedStart = new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10)
const request = { id: id(1), company_id: id(2), customer_id: id(3), site_id: id(4), metering_point_id: id(5),
  grid_owner_id: id(6), operation_id: id(7), power_of_attorney_id: id(10), authorization_document_id: id(11),
  request_type: 'switch', status: 'queued', requested_start_date: requestedStart,
  current_supplier_name: 'Synthetic prior supplier', incoming_supplier_name: 'Synthetic current supplier',
  incoming_supplier_org_number: '5590001235', external_reference: 'ACTUAL-CASE-REFERENCE',
  validation_snapshot: { portalData: { customerName: 'Synthetic customer', customerId: '5590001235',
    customerIdCodeListQualifier: 'SE1', customerAddress: 'Testgatan 1', customerPostalCode: '12345',
    customerCity: 'Teststad', customerCountry: 'SE', reasonForTransaction: 'Z22',
    meteringMethod: 'Z03', powerOfAttorneyReference: 'SYNTHETIC-SIGNED-MANDATE', balanceResponsibleId: '54321',
    dependentConditionFacts: { market: 'electricity', meterReadingsSentInUtilts: true,
      endUserAddressObjects: [selectedAddressFact('735123456789012352', id(2), '9', '5590001235', ['Testgatan 1'], 'SE1')],
      invoiceeObjects: [selectedInvoiceeFact('735123456789012352', id(2), '9', '5590001235', ['Testgatan 1'], 'SE1', '12345', 'Teststad')],
    } } } }
const input = { actorUserId: id(8), senderEdielId: '12345', receiverEdielId: '60001',
  communicationRouteId: id(9), applicationReference: '23-DDQ-PRODAT', environment: 'test',
  externalReference: request.external_reference, switchRequest: request,
  site: { id: id(4), company_id: id(2), customer_id: id(3), site_type: 'consumption',
    facility_id: '735123456789012352', street: 'Testgatan 1', postal_code: '12345', city: 'Teststad',
    grid_owner_id: id(6), grid_area_code: 'SYN', current_supplier_name: 'Synthetic prior supplier' },
  meteringPoint: { id: id(5), company_id: id(2), customer_id: id(3), site_id: id(4), customer_site_id: id(4),
    meter_point_id: '735123456789012352', metering_point_id: '735123456789012352', grid_owner_id: id(6) },
  gridOwner: { id: id(6), company_id: id(2), ediel_id: '60001', owner_code: 'SYN', name: 'Synthetic grid owner' },
} as unknown as Parameters<typeof buildProdatZ03FromSwitch>[0]


beforeEach(() => {
 boundary.request = { ...input.switchRequest, contract_id: id(15), customer_contract_id: id(15),
   grid_owner_ediel_id: null, rff_li_reference: null, outbound_z03_message_id: null }
 boundary.site = input.site; boundary.point = input.meteringPoint; boundary.grid = input.gridOwner!
 boundary.context = { ...input, route: { id: id(9) }, routeDecision: { edielRouteProfileId: id(16) },
   actor: { legalActorEdielId: '12345', representedByTransportAgent: false }, environment: 'test' }
 boundary.message = null; boundary.queues = 0; boundary.writes = []
})
it('actual preparation reaches its real renderer and queues the exact returned message', async () => {
 const message = await prepareAndQueueEdielZ03({ actorUserId: id(8), switchRequestId: request.id, environment: 'test' })
 expect(message.switch_request_id).toBe(request.id); expect(boundary.queues).toBe(1)
 expect(message.raw_payload).toContain('BGM+Z03'); expect(memory.rpc).toHaveBeenCalledWith('gridex_assert_supplier_switch_ready',
   { p_company_id: request.company_id, p_contract_id: id(15) })
})
it('actual preparation preserves canonical legal supplier independently of a delegated physical sender', async () => {
 boundary.context.senderEdielId = '82150'
 boundary.context.actor = { legalActorEdielId: '12345', representedByTransportAgent: true }
 const message = await prepareAndQueueEdielZ03({ actorUserId: id(8), switchRequestId: request.id, environment: 'test' })
 const wire = tokenizeEdifact(message.raw_payload!), unb = wire.segments.find(s => s.tag === 'UNB'),
   fr = wire.segments.find(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === 'FR')
 expect(segmentComposite(unb, 2, wire.una)[0]).toBe('82150')
 expect(segmentComposite(fr, 2, wire.una)).toEqual(['12345', '160', 'SVK'])
})
