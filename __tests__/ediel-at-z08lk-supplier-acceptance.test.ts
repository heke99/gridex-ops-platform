// masterplan: AT-Z08LK-SUPPLIER
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { EdielMessageIntent } from '@/lib/ediel/intent/types'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { resolveCanonicalOutboundContext } from '@/lib/ediel/core/kernel'

// AT-Z08LK component proof: the real operation decoder, legal-route guard,
// flow and gateway execute. Finalizer/queue and protected DB/version reads are
// declared finite ports. Existing native LK source owns fields, ACK and supply
// closure; these assertions alone do not certify that whole native contract.
const io = vi.hoisted(() => ({ rpc: vi.fn(), tenant: vi.fn(), route: vi.fn(), createIntent: vi.fn(), getIntent: vi.fn(),
  request: vi.fn(), validate: vi.fn(), render: vi.fn(), finalize: vi.fn(), queue: vi.fn(), lifecycle: vi.fn(), authorize: vi.fn(), duplicate: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc } }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: io.tenant }))
vi.mock('@/lib/ediel/core/kernel', () => ({ resolveCanonicalOutboundContext: io.route }))
vi.mock('@/lib/ediel/services/authorization', () => ({ assertEdielTenantActor: io.authorize }))
vi.mock('@/lib/ediel/core/dedupe', () => ({ findOutboundEdielMessageDuplicate: io.duplicate }))
vi.mock('@/lib/ediel/core/referenceGenerator', () => ({ generateEdielInterchangeReference: () => 'OWN-INTERCHANGE' }))
vi.mock('@/lib/cis/db', () => ({ createOutboundRequest: io.request }))
vi.mock('@/lib/ediel/intent/intentEngine', () => ({ createEdielMessageIntent: io.createIntent, getEdielMessageIntentById: io.getIntent,
  evaluateIntentValidation: io.validate, updateIntentLifecycle: io.lifecycle }))
vi.mock('@/lib/ediel/intent/renderers/bilateralClosure', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/ediel/intent/renderers/bilateralClosure')>()
  return { buildBilateralClosureDraft: io.render.mockImplementation(real.buildBilateralClosureDraft) }
})
vi.mock('@/lib/ediel/core/versionRegistry', () => ({ resolveCanonicalOutboundVersion: async () => '26A' }))
vi.mock('@/lib/ediel/flows/shared', () => ({ finalizeOutboundDraft: io.finalize, queuePreparedEdielMessage: io.queue }))
import { prepareAndQueueBilateralClosureZ08 } from '@/lib/ediel/flows/prodatBilateralClosure'
import { renderAndQueueBilateralClosure } from '@/lib/ediel/intent/bilateralClosureGateway'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { parseProdatMessage, parsedProdatObjects } from '@/lib/ediel/prodat/parser'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { createProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { prepareCustomerMasterdataSource } from '@/lib/ediel/production/customerMasterdataSource'
import { bindCustomerMasterdataDraftContext, rememberCustomerMasterdataDraft } from '@/lib/ediel/prodat/customerMasterdataDraft'
import { qualifyBilateralProdatOutboundDraft } from '@/lib/ediel/production/bilateralProdatOutboundDraft'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'
import type { ProdatEngineDiagnostics } from '@/lib/ediel/prodat/types'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const input = { companyId: id(1), actorUserId: id(2), operationId: id(3) }
const reference = 'LK' + input.operationId.replaceAll('-', '')
let route: Awaited<ReturnType<typeof resolveCanonicalOutboundContext>>
let intent: EdielMessageIntent
let original: EdielMessageRow
let priorRequests: Array<{ id: string }>
let customerIdentity: string
let customerHeld: boolean
let separateBilling: boolean
function basis() {
  return { status: 'authorized', version: 1, owner: 'immutable-bilateral-prodat-closure-operation-v1', ...input, environment: 'test',
    periodId: id(4), profileId: id(5), customerId: id(6), siteId: id(7), pointId: id(8), contractId: id(9), contractHash: 'a'.repeat(64),
    externalPoint: '735123456789012345', identityAgency: '9', gridArea: 'TES', legalActorId: id(10), legalSenderId: '12345',
    legalReceiverId: '54321', balanceResponsibleId: '7300000000001', sourceHash: 'b'.repeat(64), sourceGrammarHash: 'c'.repeat(64),
    effectiveAt: '2026-10-16T12:30:00Z', lineItemReference: reference, documentReference: reference,
    customerIdentity: { id: '199001011234', qualifier: 'SE2', agency: '260' } }
}
const gateway = () => renderAndQueueBilateralClosure({ ...input, intentId: intent.id, outboundRequestId: id(12), routeContext: route })

beforeEach(() => {
  vi.clearAllMocks()
  io.rpc.mockReset(); io.validate.mockReset(); io.finalize.mockReset()
  customerIdentity = '199001011234'; customerHeld = false
  separateBilling = false
  io.authorize.mockResolvedValue(undefined); io.duplicate.mockResolvedValue(null)
  priorRequests = []
  route = { companyId: input.companyId, environment: 'test', route: { id: id(11) }, routeRuntime: { route_profile_id: id(13) },
    senderEdielId: '12345', receiverEdielId: '54321', applicationReference: '23-DDQ-PRODAT',
    actor: { tenantIdentity: { legalActorId: id(10) }, legalActorEdielId: '12345', marketRoles: ['electricity_supplier'] } } as unknown as typeof route
  intent = { id: id(14), companyId: input.companyId, environment: 'test', market: 'electricity', messageFamily: 'PRODAT', messageCode: 'Z08',
    businessProcess: 'supplier_switch', direction: 'outbound', senderEdielId: '12345', receiverEdielId: '54321',
    applicationReference: '23-DDQ-PRODAT', routeProfileId: id(13), communicationRouteId: id(11), operationId: input.operationId,
    interchangeReference: 'OWN-INTERCHANGE', messageReference: '1', transactionReference: reference,
    idempotencyKey: `bilateral-closure:${input.operationId}`, payload: { transactionSubtype: 'LK' }, validationStatus: 'validated',
    renderStatus: 'not_rendered', outboxStatus: 'not_queued' }
  original = { id: id(15), company_id: input.companyId, environment: 'test', direction: 'outbound', status: 'draft',
    intent_id: intent.id, source_operation_id: input.operationId, outbound_request_id: id(12), message_family: 'PRODAT', message_code: 'Z08',
    raw_payload: 'declared-renderer-output' } as EdielMessageRow
  io.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'ediel_read_bilateral_prodat_closure_operation_v1') {
      expect(args).toEqual({ p_company_id: input.companyId, p_actor_user_id: input.actorUserId, p_operation_id: input.operationId })
      return { data: basis(), error: null }
    }
    if (name === 'ediel_prepare_customer_masterdata_v1') return { data: customerHeld ? { status: 'held', missing: ['source_not_current'] } : {
      status: 'authorized', companyId: input.companyId, customerId: id(6), environment: 'test', asOf: args.p_as_of,
      sourceKind: 'registered_customer_address', sourceReference: 'declared-own-source', sourceDigest: 'd'.repeat(64), sourceContextId: id(16),
      customerIdentity: { id: customerIdentity, qualifier: 'SE2', agency: '260' },
      endUserMasterdata: { nameParts: ['Synthetic Customer'], streetParts: ['Synthetic Street 1'], postalCode: '12345', city: 'Test City', country: 'SE' },
    }, error: null }
    if (name === 'ediel_read_bilateral_prodat_outbound_original_v1') return { data: { owner: 'immutable-bilateral-prodat-outbound-profile-v1', messageCode: 'Z08' }, error: null }
    // Finite read-only native port. The actual decoder, weak qualification and
    // policy consume it; this is not execution of the native SQL function.
    if (name === 'ediel_qualify_bilateral_prodat_outbound_draft_v1') return { data: {
      version: 1, owner: 'immutable-bilateral-prodat-outbound-profile-v1', companyId: input.companyId, actorUserId: input.actorUserId,
      environment: 'test', messageCode: 'Z08', payloadHash: createHash('sha256').update(String(args.p_raw_payload)).digest('hex'),
      objects: [{ objectId: '735123456789012345', identityAgency: '9', firstLineIndex: 0, lineItemReference: reference,
        process: 'closure_request_lk', profileVersionId: id(5), rulePackId: id(20), messageProfileId: id(21),
        pointId: id(8), customerId: id(6), siteId: id(7), contractId: id(9), contractHash: 'a'.repeat(64),
        sourceHash: 'b'.repeat(64), sourceGrammarHash: 'c'.repeat(64), eventAt: '2026-10-16T12:30:00Z' }],
    }, error: null }
    throw Error(`undeclared_z08lk_rpc:${name}`)
  })
  io.tenant.mockImplementation((company: string) => {
    expect(company).toBe(input.companyId)
    return { from: (table: string) => {
      if (!['outbound_requests', 'ediel_messages', 'customer_contracts'].includes(table)) throw Error(`undeclared_z08lk_table:${table}`)
      const q = { select: () => q, eq: () => q, limit: () => q, returns: () => q,
        maybeSingle: async () => ({ data: table === 'customer_contracts' ? { id: id(9), company_id: input.companyId, customer_id: id(6), invoice_recipient: null,
          billing_street: separateBilling ? 'Other Street 2' : null, billing_postal_code: separateBilling ? '54321' : null,
          billing_city: separateBilling ? 'Other City' : null, billing_country: separateBilling ? 'SE' : null,
          billing_address_same_as_site: !separateBilling } : original, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: priorRequests, error: null }).then(resolve) }
      return q
    } }
  })
  io.route.mockImplementation(async () => route)
  io.createIntent.mockImplementation(async () => intent)
  io.getIntent.mockImplementation(async () => intent)
  io.request.mockResolvedValue({ id: id(12) })
  io.validate.mockReturnValue({ ok: true, blockingReasons: [] })
  io.finalize.mockImplementation(async () => original)
})
function expectNoQueue() { expect(io.queue).not.toHaveBeenCalled(); expect(io.lifecycle).not.toHaveBeenCalled() }

describe('AT-Z08LK protected closure flow and actual queue gateway', () => {
  it('missing current bilateral operation stops before route, intent or request creation', async () => {
    io.rpc.mockResolvedValue({ data: null, error: null })
    expect(await prepareAndQueueBilateralClosureZ08(input)).toEqual({ status: 'held', missing: ['actual_current_own_supply_and_authenticated_reviewed_lk_agreement'] })
    expect(io.route).not.toHaveBeenCalled(); expect(io.createIntent).not.toHaveBeenCalled(); expect(io.request).not.toHaveBeenCalled()
    expect(io.render).not.toHaveBeenCalled(); expectNoQueue()
  })

  it.each([
    ['tenant', { companyId: id(99) }], ['environment', { environment: 'production' }],
    ['legal receiver', { receiverEdielId: 'OTHER' }], ['application', { applicationReference: '23-DGI-PRODAT' }],
    ['legal actor', { actor: { tenantIdentity: { legalActorId: id(99) }, legalActorEdielId: '12345', marketRoles: ['electricity_supplier'] } }],
    ['legal sender', { actor: { tenantIdentity: { legalActorId: id(10) }, legalActorEdielId: 'OTHER', marketRoles: ['electricity_supplier'] } }],
    ['role', { actor: { tenantIdentity: { legalActorId: id(10) }, legalActorEdielId: '12345', marketRoles: ['electricity_esco'] } }],
  ])('refuses changed %s on the real legal route guard before any new intent', async (_label, patch) => {
    Object.assign(route, patch)
    await expect(prepareAndQueueBilateralClosureZ08(input)).rejects.toThrow('bilateral_closure_canonical_legal_route_mismatch')
    expect(io.createIntent).not.toHaveBeenCalled(); expect(io.request).not.toHaveBeenCalled(); expectNoQueue()
  })

  it('queues only the stored operation and uses the exact immutable operation correlation', async () => {
    expect(await prepareAndQueueBilateralClosureZ08(input)).toEqual({ status: 'queued', message: original })
    expect(io.rpc.mock.calls.filter(([name]) => name === 'ediel_read_bilateral_prodat_closure_operation_v1')).toHaveLength(2)
    expect(io.createIntent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ messageCode: 'Z08', direction: 'outbound',
      applicationReference: '23-DDQ-PRODAT', operationId: input.operationId, transactionReference: reference,
      idempotencyKey: `bilateral-closure:${input.operationId}`, payload: { transactionSubtype: 'LK', actorRole: 'supplier', bilateralClosureOperationId: input.operationId } }))
    expect(io.render).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ basis: expect.objectContaining({ operationId: input.operationId,
      periodId: id(4), lineItemReference: reference, effectiveAt: '2026-10-16T12:30:00Z' }), intent, routeContext: route }))
    const draft = io.finalize.mock.calls[0][0].draft
    const tokens = tokenizeEdifact(draft.rawPayload)
    const unb = tokens.segments.find(segment => segment.tag === 'UNB')!
    expect(segmentComposite(unb, 7, tokens.una)).toEqual(['23-DDQ-PRODAT'])
    expect(segmentComposite(tokens.segments.find(segment => segment.tag === 'BGM'), 1, tokens.una)).toEqual(['Z08'])
    const objects = parsedProdatObjects(parseProdatMessage(draft.rawPayload))
    expect(objects).toHaveLength(1)
    expect(objects[0]).toMatchObject({ meteringPointId: '735123456789012345', identityAgency: '9' })
    expect(objects[0].registers).toHaveLength(1)
    expect(objects[0].registers[0]).toMatchObject({ reasonForTransaction: 'Z23', lineItemReference: reference,
      contractEndDate: '202610161330', balanceResponsibleId: '7300000000001', customerId: '199001011234' })
    expect(draft).toMatchObject({ direction: 'outbound', messageCode: 'Z08', sourceOperationId: input.operationId,
      intentId: intent.id, outboundRequestId: id(12), customerId: id(6), siteId: id(7), meteringPointId: id(8) })
    expect(io.queue).toHaveBeenCalledExactlyOnceWith({ actorUserId: input.actorUserId, messageId: original.id,
      outboundRequestId: id(12), intentId: intent.id, payload: { bilateralClosureOperationId: input.operationId, intentId: intent.id,
        operationId: input.operationId, messageFamily: 'PRODAT', messageCode: 'Z08', routeId: route.route.id } })
    expect(io.finalize.mock.invocationCallOrder[0]).toBeLessThan(io.queue.mock.invocationCallOrder[0])
    expect(io.lifecycle.mock.calls.map(([, update]) => update)).toEqual([
      { renderStatus: 'rendered', edielMessageId: original.id, outboundRequestId: id(12), actorUserId: input.actorUserId },
      { outboxStatus: 'queued', actorUserId: input.actorUserId },
    ])
  })

  it('reuses the existing own request and refuses ambiguous requests', async () => {
    priorRequests = [{ id: id(12) }]
    expect((await prepareAndQueueBilateralClosureZ08(input)).status).toBe('queued')
    expect(io.request).not.toHaveBeenCalled()
    vi.clearAllMocks(); priorRequests.push({ id: id(99) })
    await expect(prepareAndQueueBilateralClosureZ08(input)).rejects.toThrow('bilateral_closure_outbound_request_ambiguous')
    expect(io.render).not.toHaveBeenCalled(); expectNoQueue()
  })

  it('withdrawal between flow and gateway cannot be bypassed by the earlier basis', async () => {
    io.rpc.mockResolvedValueOnce({ data: basis(), error: null }).mockResolvedValueOnce({ data: null, error: null })
    expect((await prepareAndQueueBilateralClosureZ08(input)).status).toBe('held')
    expect(io.render).not.toHaveBeenCalled(); expect(io.finalize).not.toHaveBeenCalled(); expectNoQueue()
  })

  it.each([
    ['tenant', { companyId: id(99) }], ['environment', { environment: 'production' }],
    ['operation', { operationId: id(99) }], ['family', { messageFamily: 'UTILTS' }],
    ['code', { messageCode: 'Z03' }], ['route', { communicationRouteId: id(99) }],
  ])('rejects a foreign intent %s before reading/rendering the closure', async (_label, patch) => {
    Object.assign(intent, patch)
    await expect(gateway()).rejects.toThrow('bilateral_closure_intent_scope_mismatch')
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.render).not.toHaveBeenCalled(); expectNoQueue()
  })

  it('blocked intent cannot render or queue from a copied validation result', async () => {
    io.validate.mockReturnValue({ ok: false, blockingReasons: [{ code: 'current_permission_revoked' }] })
    expect(await gateway()).toEqual({ status: 'held', missing: ['current_permission_revoked'] })
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.render).not.toHaveBeenCalled(); expectNoQueue()
  })

  it.each(['intent_id', 'source_operation_id', 'outbound_request_id'])('rejects a changed finalized %s before queue or lifecycle effects', async key => {
    Object.assign(original, { [key]: id(99) })
    await expect(gateway()).rejects.toThrow('bilateral_closure_final_original_scope_mismatch')
    expect(io.finalize).toHaveBeenCalledOnce(); expectNoQueue()
  })


  it.each(['held', 'changed'] as const)('refuses %s current customer source before finalization or queue', async condition => {
    customerHeld = condition === 'held'; customerIdentity = condition === 'changed' ? '199001019999' : customerIdentity
    await expect(gateway()).rejects.toThrow(condition === 'held' ? 'customer_masterdata_source_held:source_not_current' : 'bilateral_closure_actual_customer_changed')
    expect(io.finalize).not.toHaveBeenCalled(); expectNoQueue()
  })

  it('finalizer refusal cannot be converted into queue success', async () => {
    io.finalize.mockRejectedValue(Error('current_native_original_refused'))
    await expect(gateway()).rejects.toThrow('current_native_original_refused')
    expectNoQueue()
  })


  it.each(['intent_id', 'source_operation_id', 'outbound_request_id', 'environment'])('rejects changed existing-original %s without a queue replay', async key => {
    intent.edielMessageId = original.id; original.status = 'sent'
    Object.assign(original, { [key]: key === 'environment' ? 'production' : id(99) })
    await expect(gateway()).rejects.toThrow('bilateral_closure_existing_original_scope_mismatch')
    expect(io.rpc).not.toHaveBeenCalled(); expect(io.render).not.toHaveBeenCalled(); expect(io.finalize).not.toHaveBeenCalled(); expectNoQueue()
  })

  it('public sent status cannot bypass the protected original qualification', async () => {
    intent.edielMessageId = original.id; original.status = 'sent'
    io.rpc.mockResolvedValue({ data: null, error: null })
    await expect(gateway()).rejects.toThrow('bilateral_closure_existing_original_unqualified')
    expect(io.render).not.toHaveBeenCalled(); expect(io.finalize).not.toHaveBeenCalled(); expectNoQueue()
  })

  it('a qualified already sent original is reused without render, queue or lifecycle replay', async () => {
    intent.edielMessageId = original.id; original.status = 'sent'
    expect(await gateway()).toEqual({ status: 'existing', message: original })
    expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_read_bilateral_prodat_outbound_original_v1', { p_company_id: input.companyId, p_message_id: original.id })
    expect(io.render).not.toHaveBeenCalled(); expect(io.finalize).not.toHaveBeenCalled(); expectNoQueue()
  })

  it('actual canonical finalizer rejects an inbound LK candidate before authorization, persistence or queue', async () => {
    const renderer = await vi.importActual<typeof import('@/lib/ediel/intent/renderers/bilateralClosure')>('@/lib/ediel/intent/renderers/bilateralClosure')
    const kernel = await vi.importActual<typeof import('@/lib/ediel/core/kernel')>('@/lib/ediel/core/kernel')
    io.render.mockImplementation(async params => {
      const { draft } = await renderer.buildBilateralClosureDraft(params)
      return { draft: { ...draft, direction: 'inbound' as const } }
    })
    io.finalize.mockImplementation(params => kernel.finalizeCanonicalOutboundDraft(params))
    await expect(gateway()).rejects.toThrow('canonical_outbound_owner_scope_required')
    expect(io.finalize).toHaveBeenCalledOnce()
    expect(io.authorize).not.toHaveBeenCalled(); expect(io.duplicate).not.toHaveBeenCalled()
    expect(io.rpc.mock.calls.filter(([name]) => /create.*original|create.*message|persist/i.test(name))).toEqual([])
    expectNoQueue()
  })

  it.each([
    ['R262', 'Z02', 'FIELD_MATRIX_REQUIRED_FIELD_MISSING', 'NAD+Z02/C082/3039'],
    ['activated IV', 'IV', 'PRODAT_INVOICEE_REQUIRED', 'Z08:INVOICEE_GROUP'],
  ])('real finalizer rejects omitted %s before protected original or queue effects', async (_label, party, code, detail) => {
    separateBilling = party === 'IV'
    const renderer = await vi.importActual<typeof import('@/lib/ediel/intent/renderers/bilateralClosure')>('@/lib/ediel/intent/renderers/bilateralClosure')
    const kernel = await vi.importActual<typeof import('@/lib/ediel/core/kernel')>('@/lib/ediel/core/kernel')
    const contextFor = (draft: CreateEdielMessageInput) => bindCustomerMasterdataDraftContext({ draft,
      companyId: input.companyId, environment: 'test', routeId: route.route.id })!
    const policyFor = async (draft: CreateEdielMessageInput) => validateRulebookMessage({ family: 'PRODAT', code: 'Z08',
      rawPayload: draft.rawPayload, parsedPayload: draft.parsedPayload, applicationReference: draft.applicationReference,
      mode: 'send', direction: 'outbound', environment: 'test', companyId: input.companyId, version: draft.messageVersion,
      bilateralDraft: draft, bilateralDraftActorUserId: input.actorUserId,
      bilateralDraftQualification: await qualifyBilateralProdatOutboundDraft({ draft, actorUserId: input.actorUserId }),
      customerMasterdataContext: contextFor(draft), customerMasterdataRow: { company_id: input.companyId,
        customer_id: draft.customerId, environment: 'test', direction: 'outbound', message_family: 'PRODAT', message_code: 'Z08',
        raw_payload: draft.rawPayload, intent_id: draft.intentId, communication_route_id: route.route.id } })
    io.render.mockImplementation(async params => {
      const { draft } = await renderer.buildBilateralClosureDraft(params)
      expect((await policyFor(draft)).issues.filter(issue => issue.blocking || issue.severity === 'error')).toEqual([])
      const engine = draft.parsedPayload!.prodatEngine as ProdatEngineDiagnostics
      // Independent original customer/contract source; never inferred from malformed bytes.
      const selected = engine.registerEvidence!.facts
      const facts = { market: selected.market, endUserAddressObjects: selected.endUserAddressObjects, invoiceeObjects: selected.invoiceeObjects }
      const wire = tokenizeEdifact(draft.rawPayload!)
      const body = wire.segments.slice(wire.segments.findIndex(s => s.tag === 'UNH') + 1, wire.segments.findIndex(s => s.tag === 'UNT'))
        .filter(s => !(s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === party)).map(s => s.raw)
      expect(wire.segments.some(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === party)).toBe(true)
      const rawPayload = EdifactEnvelopeCodec.encode({ sender: route.senderEdielId, receiver: route.receiverEdielId,
        interchangeReference: intent.interchangeReference, applicationReference: intent.applicationReference, environment: 'test',
        acknowledgementRequest: true, messages: [{ messageReference: intent.messageReference, messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: body }] })
      const changed = tokenizeEdifact(rawPayload)
      const candidate = { ...draft, rawPayload, parsedPayload: { ...draft.parsedPayload, prodatEngine: { ...engine,
        registerEvidence: createProdatRegisterEvidence({ code: 'Z08', rawSegments: changed.segments.map(s => s.raw), una: changed.una, facts }) } } }
      const address = facts.endUserAddressObjects![0].source
      rememberCustomerMasterdataDraft(candidate, await prepareCustomerMasterdataSource({ ...input, customerId: id(6),
        environment: 'test', asOf: address.asOf }))
      const result = await policyFor(candidate)
      expect(result.issues).toContainEqual(expect.objectContaining({ code, blocking: true,
        ...(party === 'Z02' ? { fieldPath: detail, prodatDiagnostic: expect.objectContaining({ fieldNumber: '262' }) } : { description: expect.stringContaining(detail) }) }))
      expect(result.issues.filter(issue => /SOURCE_UNQUALIFIED|BINDING/.test(issue.code))).toEqual([])
      return { draft: candidate }
    })
    io.finalize.mockImplementation(params => kernel.finalizeCanonicalOutboundDraft({ ...params, customerMasterdataContext: contextFor(params.draft) }))
    await expect(gateway()).rejects.toThrow(code)
    expect(io.authorize).toHaveBeenCalledExactlyOnceWith({ companyId: input.companyId, actorUserId: input.actorUserId, permission: 'communication.write' })
    expect(io.duplicate).toHaveBeenCalledOnce(); expect(io.finalize).toHaveBeenCalledOnce()
    expect(io.rpc.mock.calls.filter(([name]) => /create.*original|create.*message|persist/i.test(name))).toEqual([])
    expectNoQueue()
  })
})
