import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createFakeDb } from './helpers/poaMailFakeDb'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof createFakeDb>, rpc: vi.fn(), reconcile: vi.fn(), queue: vi.fn(), realQueue: false }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  get storage() { return io.db.client.storage }, from: (table: string) => io.db.client.from(table), rpc: (...args: unknown[]) => io.rpc(...args),
} }))
vi.mock('@/lib/customer-operations/supplierSwitchOrchestration', () => ({ reconcileSupplierSwitchAfterCustomerDataChange: (...args: unknown[]) => io.reconcile(...args) }))
vi.mock('@/lib/customer-operations/manualSupplierInformationRequest', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/customer-operations/manualSupplierInformationRequest')>()
  return { ...actual, queueManualSupplierInformationRequest: (...args: Parameters<typeof actual.queueManualSupplierInformationRequest>) => io.realQueue ? actual.queueManualSupplierInformationRequest(...args) : io.queue(...args) }
})
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: async () => ({ allowed: true }) }))
import { continueManualCommercialReply, readAppliedManualReplyContext } from '@/lib/inbound-mail/manualReplyApplication'
import { applyManualMultiSiteReply, continueManualMultiSiteReply } from '@/lib/inbound-mail/manualMultiSiteReply'

const hash = 'a'.repeat(64)
const scope = { companyId: 'company', customerId: 'customer', parentRequestId: 'parent', inboundId: 'inbound' }
function member(siteId: string, requestId: string, complete = true, internalCreated = false) {
  const application = { version: 1, applied: true, complete, sourceHash: hash, inboundId: 'inbound', inbound_id: 'inbound',
    companyId: 'company', customerId: 'customer', siteId, requestId, terms: { earliestStartDate: '2027-04-01' } }
  return { version: 1, parentRequestId: 'parent', sourceHash: hash, companyId: 'company', customerId: 'customer',
    siteId, requestId, status: 'applied', requestType: 'current_supplier_contract_information_request', powerOfAttorneyId: `poa-${siteId}`,
    internalCreated, application }
}
beforeEach(() => {
  vi.clearAllMocks()
  io.realQueue = false
  vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('GRIDEX_MANUAL_OPS_ENVIRONMENT', ''); vi.stubEnv('MANUAL_GRID_OWNER_SAFE_RECIPIENT', '')
  const a = member('site-a', 'parent'), b = member('site-b', 'child')
  io.db = createFakeDb({
    manual_inbound_messages: [{ id: 'inbound', company_id: 'company', customer_id: 'customer', customer_site_id: 'site-a', request_id: 'parent',
      resolution_status: 'matched', processing_state: 'applied', extracted_payload: { sender_credible: true, sender_verification: { status: 'verified' },
        manual_automation: { sourceHash: hash, site_applications: { parent: a, child: b },
          multi_site: { version: 1, parentRequestId: 'parent', sourceHash: hash, appliedCount: 2, reviewCount: 0,
            results: [{ siteId: 'site-a', requestId: 'parent', facilityId: '735999123456789001', outcome: 'applied' }, { siteId: 'site-b', requestId: 'child', facilityId: '735999123456789002', outcome: 'applied' }] } } } }],
    grid_owner_information_requests: [a, b].map(entry => ({ id: entry.requestId, company_id: 'company', customer_id: 'customer', customer_site_id: entry.siteId,
      status: 'completed', request_type: 'current_supplier_contract_information_request', poa_id: entry.powerOfAttorneyId,
      created_by: 'original-actor', metadata: { customer_info_request_id: `cir-${entry.siteId}` }, parsed_payload: entry.application })),
  })
  io.reconcile.mockResolvedValue({ supplierSwitchRequestId: 'switch' })
  io.queue.mockResolvedValue({ status: 'queued', requestId: 'child' })
  io.rpc.mockImplementation(async (_name: string,args: Row) => {
    const items=(args.p_payload as Row).items as Row[]
    return {data:{ok:true,appliedCount:0,reviewCount:items.length,results:items.map(item=>({facilityId:item.facilityId,outcome:'needs_review'}))},error:null}
  })
})
afterEach(() => vi.unstubAllEnvs())
it('reads a child application from the original parent source without changing its foreign keys', async () => {
  const context = await readAppliedManualReplyContext({ ...scope, siteId: 'site-b', requestId: 'child' })
  expect(context?.application).toMatchObject({ siteId: 'site-b', requestId: 'child' })
  expect(io.db.tables.manual_inbound_messages[0]).toMatchObject({ request_id: 'parent', customer_site_id: 'site-a' })
})
it('resumes both sites independently with the recorded actor and no paid inference', async () => {
  await continueManualMultiSiteReply(scope)
  expect(io.reconcile.mock.calls.map(([arg]) => arg)).toEqual([
    expect.objectContaining({ companyId: 'company', customerId: 'customer', siteId: 'site-a', actorUserId: 'original-actor' }),
    expect.objectContaining({ companyId: 'company', customerId: 'customer', siteId: 'site-b', actorUserId: 'original-actor' }),
  ])
  await continueManualMultiSiteReply(scope)
  expect(io.reconcile).toHaveBeenCalledTimes(2)
})
it('retains each successful member and aggregates a legitimate completed business review for one site', async () => {
  io.reconcile.mockResolvedValueOnce({ ok: true, supplierSwitchRequestId: 'switch-a' })
    .mockResolvedValueOnce({ ok: false, supplierSwitchRequestId: null, blockers: [{ code: 'missing_customer_identity', message: 'Synthetic private description' }] })
  await continueManualMultiSiteReply(scope)
  const automation = (io.db.tables.manual_inbound_messages[0].extracted_payload as Row).manual_automation as Row
  expect(automation.continuation).toMatchObject({ status: 'completed', reviewRequired: true, reviewCount: 1 })
  const members = automation.site_applications as Record<string, Row>
  expect(members.parent.continuation).toMatchObject({ status: 'completed', supplierSwitchRequestId: 'switch-a' })
  expect(members.child.continuation).toMatchObject({ status: 'completed', reviewRequired: true, reviewReasons: ['missing_customer_identity'] })
  expect(JSON.stringify(automation.continuation)).not.toContain('Synthetic private description')
  await continueManualMultiSiteReply(scope)
  expect(io.reconcile).toHaveBeenCalledTimes(2)
})
it('retains the completed first continuation when a later site fails and retries only the missing effect', async () => {
  io.reconcile.mockResolvedValueOnce({ supplierSwitchRequestId: 'switch-a' }).mockRejectedValueOnce(new Error('transient dispatch readiness'))
  await expect(continueManualMultiSiteReply(scope)).rejects.toThrow('transient dispatch readiness')
  io.reconcile.mockResolvedValue({ supplierSwitchRequestId: 'switch-b' })
  await continueManualMultiSiteReply(scope)
  expect(io.reconcile.mock.calls.map(([arg]) => arg.siteId)).toEqual(['site-a', 'site-b', 'site-b'])
})
it.each(['companyId', 'customerId', 'siteId', 'requestId', 'parentRequestId', 'sourceHash'])('rejects a forged child binding field %s', async key => {
  const payload = io.db.tables.manual_inbound_messages[0].extracted_payload as Row
  const automation = payload.manual_automation as Row
  const members = automation.site_applications as Record<string, Row>
  members.child[key] = 'foreign'
  expect(await readAppliedManualReplyContext({ ...scope, siteId: 'site-b', requestId: 'child' })).toBeNull()
})
it('does not resume any child when the original parent has a current counterparty hold', async () => {
  io.db.tables.grid_owner_information_requests[0].metadata = { counterparty_reply: { requires_review: true } }
  await continueManualMultiSiteReply(scope)
  expect(io.reconcile).not.toHaveBeenCalled()
})
it('queues a genuine clarification for a partial received-only child with its own CIR and no fake sent state',async()=>{
  const child=member('site-b','child',false,true)
  const source=io.db.tables.manual_inbound_messages[0]
  const automation=(source.extracted_payload as Row).manual_automation as Row
  automation.site_applications={child}
  io.db.tables.grid_owner_information_requests[1].status='manual_response_received'
  io.db.tables.grid_owner_information_requests[1].parsed_payload=child.application
  await continueManualMultiSiteReply(scope)
  expect(io.queue).toHaveBeenCalledExactlyOnceWith({companyId:'company',customerId:'customer',siteId:'site-b',customerInfoRequestId:'cir-site-b',actorUserId:'original-actor'})
  expect(io.reconcile).not.toHaveBeenCalled()
  expect(io.db.tables.grid_owner_information_requests[1]).not.toHaveProperty('sent_at')
  await continueManualMultiSiteReply(scope)
  expect(io.queue).toHaveBeenCalledTimes(1)
},30_000)
it('retains clarification retry after a canonical queue failure',async()=>{
  const child=member('site-b','child',false,true)
  const automation=(io.db.tables.manual_inbound_messages[0].extracted_payload as Row).manual_automation as Row
  automation.site_applications={child}
  Object.assign(io.db.tables.grid_owner_information_requests[1],{status:'manual_response_received',parsed_payload:child.application})
  io.queue.mockRejectedValueOnce(new Error('archive temporarily unavailable'))
  await expect(continueManualMultiSiteReply(scope)).rejects.toThrow('archive temporarily unavailable')
  await continueManualMultiSiteReply(scope)
  expect(io.queue).toHaveBeenCalledTimes(2)
})
it('normalizes each site separately and sends one batch command under the immutable parent', async () => {
  const request = io.db.tables.grid_owner_information_requests[0]
  await applyManualMultiSiteReply({ ...scope, parentRequest: request, sourceHash: hash, receivedAt: '2026-10-18T12:00:00Z', groups: [
    { facilityId: '735999123456789001', requestId: 'parent', authoredText: 'Tidigaste start: 2027-04-01\nBrytavgift: Ingen', extracted: { earliest_supplier_start_date: '2027-04-01', termination_fee: 'Ingen' } },
    { facilityId: '735999123456789002', requestId: 'child', authoredText: 'Tidigaste start: 2027-05-01\nBrytavgift: Ingen', extracted: { earliest_supplier_start_date: '2027-05-01', termination_fee: 'Ingen' } },
  ] })
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('gridex_apply_manual_multi_site_reply_v1', expect.objectContaining({ p_company_id: 'company', p_parent_request_id: 'parent', p_inbound_id: 'inbound',
    p_payload: expect.objectContaining({ sourceHash: hash, items: [
      expect.objectContaining({ facilityId: '735999123456789001', payload: expect.objectContaining({ terms: expect.objectContaining({ earliestStartDate: '2027-04-01' }) }) }),
      expect.objectContaining({ facilityId: '735999123456789002', payload: expect.objectContaining({ terms: expect.objectContaining({ earliestStartDate: '2027-05-01' }) }) }),
    ] }) }))
})

it('propagates a qualified receipt day to each relative facility date without using the worker clock', async () => {
  await applyManualMultiSiteReply({ ...scope, parentRequest: io.db.tables.grid_owner_information_requests[0], sourceHash: hash,
    receivedAt: '2026-10-24T22:30:00.000Z', receivedAtSource: 'imap_internal_date', groups: [
      { facilityId: '735999123456789001', authoredText: 'Kunden kan starta om 30 dagar\nBrytavgift: Ingen', extracted: { earliest_supplier_start_date: 'om 30 dagar', termination_fee: 'Ingen' } },
      { facilityId: '735999123456789002', authoredText: 'Kunden kan starta om 31 dagar\nBrytavgift: Ingen', extracted: { earliest_supplier_start_date: 'om 31 dagar', termination_fee: 'Ingen' } },
    ] })
  const items = io.rpc.mock.calls[0][1].p_payload.items
  expect(items.map((item: Row) => item.reasons)).toEqual([[], []])
  expect(items.map((item: Row) => (item.payload as Row).terms)).toEqual([
    expect.objectContaining({ earliestStartDate: '2026-11-24', effectiveStartDate: '2026-11-24' }),
    expect.objectContaining({ earliestStartDate: '2026-11-25', effectiveStartDate: '2026-11-25' }),
  ])
})

function realQueueDb(): ReturnType<typeof createFakeDb> {
  return createFakeDb({
    companies: [{ id: 'company', legal_name: 'Synthetic El AB', org_number: '559999-9984', status: 'active', is_active: true }],
    customers: [{ id: 'customer', company_id: 'company', full_name: 'Synthetic Customer', personal_number: '199001011234', customer_number: 'K0001' }],
    customer_sites: [{ id: 'site-b', company_id: 'company', customer_id: 'customer', current_supplier_id: 'supplier-1', street: 'Gatan 1', postal_code: '11122', city: 'Stockholm', address_hash: 'hash-1', facility_data_status: 'facility_verified', protected_identity: false }],
    electricity_suppliers: [{ id: 'supplier-1', company_id: null, name: 'Synthetic supplier', is_active: true, platform_market_actor_id: 'actor-1' }],
    platform_market_actors: [{ id: 'actor-1', status: 'active', match_status: 'verified' }],
    platform_actor_roles: [{ actor_id: 'actor-1', actor_role: 'electricity_supplier', is_active: true }],
    platform_actor_contacts: [{ id: 'contact-1', actor_id: 'actor-1', contact_type: 'poa', channel: 'email', email: 'fullmakt@supplier.example', is_verified: true, verified_at: '2026-01-01T10:00:00Z', valid_from: '2026-01-01', valid_to: null, source: 'manual_admin' }],
    customer_info_requests: [{ id: 'cir-site-b', company_id: 'company', customer_id: 'customer', site_id: 'site-b', metering_point_id: null, authorization_document_id: 'doc-1', request_type: 'supplier_contract_information', target_party_type: 'current_supplier', status: 'ready_to_send', verified_payload: {}, requested_data_categories: ['binding_period', 'notice_period'], grid_owner_data_request_id: null, outbound_request_id: null, ediel_message_id: null }],
    customer_authorization_documents: [{ id: 'doc-1', company_id: 'company', customer_id: 'customer', site_id: 'site-b', metering_point_id: null, power_of_attorney_id: 'poa-site-b', customer_contract_id: null, document_type: 'power_of_attorney', status: 'active' }],
    authorization_scopes: [{ id: 'scope-1', company_id: 'company', customer_id: 'customer', authorization_document_id: 'doc-1', status: 'active', revoked_at: null, valid_from: '2026-01-01', valid_to: '2030-12-31', covers_current_supplier_contract: true, created_at: '2026-01-01T00:00:00Z' }],
    powers_of_attorney: [{ id: 'poa-site-b', company_id: 'company', customer_id: 'customer', site_id: 'site-b', customer_site_id: 'site-b', document_id: 'doc-1', status: 'signed', scope: 'current_supplier_contract', signed_scope_snapshot: ['current_supplier_contract'], accepted_at: '2026-01-01T10:00:00Z', signed_at: '2026-01-01T10:00:00Z', signer_name: 'Synthetic Customer', signer_identity_number: '199001011234', method: 'website_acceptance', fullmakt_snapshot: { legal_text: { title: 'Fullmakt', body: 'Synthetic accepted contract information scope.' } }, source: 'admin', valid_from: '2026-01-01', valid_to: '2030-12-31', revoked_at: null, evidence_payload: { verification_reference: 'synthetic-verification-1' }, metadata: {}, document_path: null, updated_at: null }],
    manual_communication_mailboxes: [{ id: 'mailbox-1', company_id: null, mailbox_type: 'manual_supplier_switch', environment: 'production', from_email: 'leverantorsbyte@gridex.example', is_active: true, is_verified: true }],
    grid_owner_information_requests: [], manual_email_outbox: [], metering_points: [], grid_owner_contact_channels: [], customer_contracts: [], ediel_mailboxes: [], market_calendar_days: [],
  })
}

function installRealClarificationPorts() {
  const source=io.db.tables.manual_inbound_messages[0]
  const parent=io.db.tables.grid_owner_information_requests[0]
  const childMember=member('site-b','child',false,true)
  const child={...io.db.tables.grid_owner_information_requests[1],status:'manual_response_received',case_reference:'GX-FIR-CHILD',
    recipient_email:'fullmakt@supplier.example',channel:'manual_email',grid_owner_id:null,requires_poa:true,
    metadata:{target_party:'current_supplier',customer_info_request_id:'cir-site-b',supplier_id:'supplier-1',supplier_actor_id:'actor-1',supplier_contact_id:'contact-1',authorization_document_id:'doc-1'},
    parsed_payload:childMember.application}
  const automation=(source.extracted_payload as Row).manual_automation as Row
  automation.site_applications={child:childMember}
  io.db=realQueueDb()
  io.db.tables.manual_inbound_messages=[source]
  io.db.tables.grid_owner_information_requests=[parent,child]
  Object.assign(io.db.tables.customer_info_requests[0],{status:'partially_received',verified_payload:{manual_supplier_request_id:'child',supplier_id:'supplier-1',supplier_actor_id:'actor-1',supplier_contact_id:'contact-1'}})
  io.realQueue=true
  return {source,child,application:childMember.application}
}
it('actually archives its own PDF and queues the first clarification through the canonical supplier adapter',async()=>{
  const {child,application}=installRealClarificationPorts()
  await continueManualMultiSiteReply(scope)
  expect(io.queue).not.toHaveBeenCalled()
  expect(io.db.tables.manual_email_outbox).toHaveLength(1)
  expect(io.db.tables.manual_email_outbox[0]).toMatchObject({request_id:'child',status:'queued',to_email:'fullmakt@supplier.example',
    subject:expect.stringContaining('GX-FIR-CHILD'),attachments:[expect.objectContaining({poa_id:'poa-site-b',kind:'power_of_attorney_archived_pdf',poa_document_path:expect.stringContaining('/poa-site-b/')})]})
  expect(child).toMatchObject({status:'manual_email_queued',parsed_payload:application,metadata:{manual_multi_site_clarification:{inboundId:'inbound',parentRequestId:'parent',sourceHash:hash}}})
  expect(child).not.toHaveProperty('sent_at')
  expect(child).not.toHaveProperty('manual_email_sent_at')
  expect(io.db.storageUploads).toHaveLength(1)
  expect(io.db.tables.manual_inbound_messages[0]).toMatchObject({request_id:'parent',customer_site_id:'site-a'})
  await continueManualMultiSiteReply(scope)
  expect(io.db.tables.manual_email_outbox).toHaveLength(1)
})
it('demonstrates why a received-only child must be guarded into the real queue ready state',async()=>{
  installRealClarificationPorts()
  const actual=await vi.importActual<typeof import('@/lib/customer-operations/manualSupplierInformationRequest')>('@/lib/customer-operations/manualSupplierInformationRequest')
  const result=await actual.queueManualSupplierInformationRequest({companyId:'company',customerId:'customer',siteId:'site-b',customerInfoRequestId:'cir-site-b',actorUserId:'original-actor'})
  expect(result).toMatchObject({status:'needs_review',blockerCode:'supplier_conversation_changed'})
  expect(io.db.tables.manual_email_outbox).toMatchObject([{status:'failed',last_error_code:'supplier_conversation_changed'}])
})
it.each([
  [],
  [{facilityId:'735999123456789099',outcome:'needs_review'}],
  [{facilityId:'735999123456789001',outcome:'applied'}],
  [{facilityId:'735999123456789001',outcome:'needs_review'},{facilityId:'735999123456789001',outcome:'needs_review'}],
].map(results=>({results})))('rejects missing, foreign, duplicate or unbound per-site database results',async ({results})=>{
  io.rpc.mockResolvedValueOnce({data:{ok:true,appliedCount:results.filter(entry=>entry.outcome==='applied').length,reviewCount:results.filter(entry=>entry.outcome==='needs_review').length,results},error:null})
  await expect(applyManualMultiSiteReply({...scope,parentRequest:io.db.tables.grid_owner_information_requests[0],sourceHash:hash,receivedAt:'2026-10-18T12:00:00Z',groups:[
    {facilityId:'735999123456789001',extracted:{earliest_supplier_start_date:'2027-04-01',termination_fee:'Ingen'},authoredText:'Tidigaste start: 2027-04-01\nBrytavgift: Ingen'},
  ]})).rejects.toThrow('manual_multi_site_result_scope_invalid')
  expect(io.reconcile).not.toHaveBeenCalled()
})

function currentAutomation(): Row { return (io.db.tables.manual_inbound_messages[0].extracted_payload as Row).manual_automation as Row }
it('persists a safe global and member review marker after a committed batch continuation fails, then clears it on retry',async()=>{
  const failure=new Error('private upstream response must never enter review metadata')
  io.reconcile.mockResolvedValueOnce({supplierSwitchRequestId:'switch-a'}).mockImplementationOnce(async()=>{
    currentAutomation().paidReader={status:'completed',opaque:'preserve-existing-source-sibling'}
    throw failure
  })
  await expect(continueManualMultiSiteReply(scope)).rejects.toBe(failure)
  const automation=currentAutomation()
  expect(automation.continuation).toMatchObject({status:'failed',sourceHash:hash,inboundId:'inbound',parentRequestId:'parent',requestId:'child',reason:'continuation_failed'})
  expect((automation.site_applications as Record<string,Row>).parent.continuation).toMatchObject({status:'completed'})
  expect((automation.site_applications as Record<string,Row>).child.continuation).toMatchObject({status:'failed',reason:'continuation_failed'})
  expect(JSON.stringify(automation)).not.toContain(failure.message)
  expect(automation.paidReader).toMatchObject({status:'completed'})
  expect(io.db.tables.manual_inbound_messages[0]).toMatchObject({processing_state:'applied'})
  io.reconcile.mockResolvedValue({supplierSwitchRequestId:'switch-b'})
  await continueManualMultiSiteReply(scope)
  expect(currentAutomation().continuation).toMatchObject({status:'completed',sourceHash:hash,inboundId:'inbound',parentRequestId:'parent'})
  expect(io.reconcile.mock.calls.map(([arg])=>arg.siteId)).toEqual(['site-a','site-b','site-b'])
})
it('records single-site postcommit failure for review and clears it after the real continuation succeeds',async()=>{
  const automation=currentAutomation()
  automation.application=(automation.site_applications as Record<string,Row>).parent.application
  delete automation.site_applications;delete automation.multi_site
  const failure=new Error('transient downstream failure with untrusted contents')
  io.reconcile.mockRejectedValueOnce(failure)
  const input={companyId:'company',customerId:'customer',siteId:'site-a',requestId:'parent',inboundId:'inbound'}
  await expect(continueManualCommercialReply(input)).rejects.toBe(failure)
  expect(currentAutomation().continuation).toMatchObject({status:'failed',sourceHash:hash,inboundId:'inbound',requestId:'parent',reason:'continuation_failed'})
  expect(JSON.stringify(currentAutomation())).not.toContain(failure.message)
  io.reconcile.mockResolvedValue({supplierSwitchRequestId:'switch-a'})
  await continueManualCommercialReply(input)
  expect(currentAutomation().continuation).toMatchObject({status:'completed'})
  expect(io.reconcile).toHaveBeenCalledTimes(2)
})
it('finishes the batch global marker when an existing partial request needs only its normal followup',async()=>{
  const child=member('site-b','child',false,false)
  const automation=currentAutomation();automation.site_applications={child};automation.continuation={status:'failed',reason:'continuation_failed'}
  Object.assign(io.db.tables.grid_owner_information_requests[1],{status:'manual_response_received',parsed_payload:child.application})
  await continueManualMultiSiteReply(scope)
  expect(currentAutomation().continuation).toMatchObject({status:'completed'})
  expect(io.queue).not.toHaveBeenCalled();expect(io.reconcile).not.toHaveBeenCalled()
})
