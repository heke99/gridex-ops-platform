// masterplan: DB-01, AT-DB-01
// Bounded consumer proof, not native migration or whole-contract approval.
// Only the Supabase I/O port is replaced. Real creators, tenant/AGT validators,
// renderers, preflight, business-reference publication and event writers run.
// Rows below are declared unit inputs, never private custody/accepted receipts.
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreateEdielMessageInput } from '@/lib/ediel/types'

type Row = Record<string, unknown>
type Filter = { column: string; values: unknown[]; exclude?: boolean }
type Read = { table: string; columns: string; filters: Filter[] }
type Write = { table: string; rows: Row[] }
const port = vi.hoisted(() => ({ from: null as null | ((table: string) => unknown),
  rpc: null as null | ((name: string, args: Row) => unknown) }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    if (!port.from) throw new Error('DB01 declared database input port not initialized')
    return port.from(table)
  },
  rpc: (name: string, args: Row) => {
    if (!port.rpc) throw new Error('DB01 declared RPC input port not initialized')
    return port.rpc(name, args)
  },
} }))

import { createEdielMessage, getEdielMessageById } from '@/lib/ediel/db'
import * as messageDb from '@/lib/ediel/db'
import { createEdielSupplierAgtOutboundCommand } from '@/lib/ediel/testing/agtEngine'
import { evaluateProductionTransportSecurity } from '@/lib/ediel/config'
import * as kernel from '@/lib/ediel/core/kernel'
import * as validator from '@/lib/ediel/rulebook/validator'

const COMPANY = '10000000-0000-4000-8000-000000000001'
const FOREIGN_COMPANY = '10000000-0000-4000-8000-000000000002'
const USER = '20000000-0000-4000-8000-000000000001'
const PARTY = '30000000-0000-4000-8000-000000000001'
const ROUTE = '40000000-0000-4000-8000-000000000001'
const PROFILE = '50000000-0000-4000-8000-000000000001'
const RUN = '60000000-0000-4000-8000-000000000001'
const CERTIFICATE = '70000000-0000-4000-8000-000000000001'
const LEGACY_ADDRESS = '80000000-0000-4000-8000-000000000001'
const FOREIGN_ADDRESS = '80000000-0000-4000-8000-000000000002'
const STALE_ADDRESS = '80000000-0000-4000-8000-000000000003'
const NOW = '2026-10-06T20:00:00.000Z'
const PACK = '90000000-0000-4000-8000-000000000001'
const MESSAGE_PROFILE = '90000000-0000-4000-8000-000000000002'
const WITNESS = '90000000-0000-4000-8000-000000000003'
const POSITIVE_REGISTRATION = '90000000-0000-4000-8000-000000000004'
const POSITIVE_WITNESS = '90000000-0000-4000-8000-000000000005'
const PROFILE_KEY = 'PRODAT:Z09:G:26.A:r3'
let tables: Record<string, Row[]>
let reads: Read[]
let writes: Write[]
let nextId: number
let rpcCalls: {name: string; args: Row}[]

/** Declared serialized SDK responses only. Real kernel/validator interpret
 * them. This neither executes protected SQL nor proves private custody,
 * native authorization, publication, one-use consumption or certification. */
function declaredPositiveOriginal(context: Row) {
  const wireSha256 = createHash('sha256').update(Buffer.from(String(context.rawPayload), 'latin1')).digest('hex')
  return {kind: 'source_qualified_positive_fixture', version: 1, registrationId: POSITIVE_REGISTRATION,
    companyId: COMPANY, runId: RUN, roleCode: 'supplier', caseCode: 'L7', suite: 'PRODAT', revision: '2026A', stepNo: 1,
    wireSha256, originalFileSha256: wireSha256, expectedOutcome: 'positive', expectedDiagnosticCodes: [],
    testReceiverEdielId: '91100', validUntil: '2026-10-07T20:00:00.000Z',
    sourceReference: 'synthetic://finite-db01-l7-original', ownerDecisionReference: 'synthetic://finite-db01-l7-owner',
    authorizesBusinessEffect: false}
}
function declaredRpc(name: string, args: Row) {
  rpcCalls.push({name, args: structuredClone(args)})
  if (name === 'gridex_actor_has_company_permission') {
    return Promise.resolve({data: args.p_actor_user_id === USER && args.p_company_id === COMPANY
      && ['communication.write', 'communication.send'].includes(String(args.p_permission)), error: null})
  }
  if (name === 'ediel_customer_event_certification_original_v1') {
    // L7 E32 is a metering-method original, not an E34 life-event declaration.
    expect(args).toEqual({p_company_id: COMPANY, p_actor_user_id: USER, p_run_id: RUN, p_step_no: 1})
    return Promise.resolve({data: null, error: null})
  }
  if (name === 'gridex_ediel_positive_fixture_read_v1') {
    expect(args.p_context).toMatchObject({companyId: COMPANY, runId: RUN, stepNo: 1, actorUserId: USER, diagnosticCodes: []})
    return Promise.resolve({data: declaredPositiveOriginal(args.p_context as Row), error: null})
  }
  if (name === 'gridex_ediel_positive_fixture_prepare_v1') {
    expect(args.p_context).toMatchObject({companyId: COMPANY, runId: RUN, stepNo: 1, actorUserId: USER, registrationId: POSITIVE_REGISTRATION})
    return Promise.resolve({data: {witnessId: POSITIVE_WITNESS, qualification: declaredPositiveOriginal(args.p_context as Row)}, error: null})
  }
  if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') {
    expect(args).toMatchObject({p_market: 'electricity', p_family: 'PRODAT', p_message_code: 'Z09',
      p_transaction_subtype: 'G', p_direction: 'outbound', p_business_date: '2026-10-06'})
    const rulePack = {id: PACK, source_hash: 'a'.repeat(64), guide_version: '26.A', guide_revision: '3'}
    const profile = {family: 'PRODAT', messageCode: 'Z09', transactionSubtype: 'G', canonicalDirection: 'outbound',
      reasonForTransaction: 'E32', guideVersion: '26.A', guideRevision: '3'}
    const messageProfile = {id: MESSAGE_PROFILE, rule_pack_id: PACK, profile_key: PROFILE_KEY, profile}
    return Promise.resolve({data: {rule_pack_id: PACK, message_profile_id: MESSAGE_PROFILE,
      market: 'electricity', family: 'PRODAT', guide_version: '26.A', guide_revision: '3', unh_association_code: 'E2SE6A',
      valid_from: '2026-04-01', valid_to: null, source_document: 'Declared finite registry response, not acquired source',
      source_hash: rulePack.source_hash, field_matrix_version: '26A-r3', profile_key: PROFILE_KEY, business_process: 'masterdata',
      phase: null, profile, parser_ready: true, builder_ready: true, validator_ready: true, ack_ready: true, state_machine_ready: true,
      original_version: '26.A:r3', original_snapshot: {rulePack, messageProfile, guideSources: []}}, error: null})
  }
  if (name === 'ediel_registry_dispatch_source_v1') {
    expect(args).toEqual({p_company_id: COMPANY, p_communication_route_id: ROUTE, p_route_profile_id: PROFILE,
      p_environment: 'test', p_message_family: 'PRODAT', p_application_reference: '23-DDQ-PRODAT'})
    // The test portal has no registered actor-market source in these explicit
    // finite inputs. The existing nullable RPC contract remains unchanged.
    return Promise.resolve({data: null, error: null})
  }
  if (name === 'ediel_prepare_outbound_owner_witness_v1') {
    const input = args.p_input as Row
    expect(input).toMatchObject({companyId: COMPANY, actorUserId: USER, environment: 'test',
      rulePackEvidence: {rulePackId: PACK, messageProfileId: MESSAGE_PROFILE, profileKey: PROFILE_KEY}})
    expect(input.rawPayload).toEqual(expect.stringContaining("CCI++Z13'CAV+E32'"))
    return Promise.resolve({data: {version: 1, witnessId: WITNESS, evidence: input.rulePackEvidence}, error: null})
  }
  throw new Error(`DB01 undeclared RPC response: ${name}`)
}

/** Finite database adapter: applies actual tenant/id predicates and projection;
 * it does not repair a payload, validate a role, or choose a route for the code. */
function query(table: string) {
  if (!(table in tables)) throw new Error(`DB01 undeclared database table: ${table}`)
  const filters: Filter[] = []
  let columns = '*'
  let limit = Infinity
  let pending: Row[] | null = null
  let written: Row[] | null = null
  function result(single: boolean, optional = false) {
    if (pending && !written) {
      written = pending.map(row => ({ id: `unit-${++nextId}`, created_at: NOW, ...structuredClone(row) }))
      writes.push({ table, rows: structuredClone(written) })
      tables[table].push(...written)
    }
    const rows = (written ?? tables[table]).filter(row => filters.every(filter => filter.exclude
      ? !filter.values.includes(row[filter.column]) : filter.values.includes(row[filter.column]))).slice(0, limit)
    reads.push({ table, columns, filters: structuredClone(filters) })
    const projected = rows.map(row => columns === '*' ? structuredClone(row) : Object.fromEntries(columns.split(',').map(column => [column, row[column]])))
    if (single && (rows.length > 1 || !optional && rows.length !== 1)) {
      return { data: null, error: { code: 'PGRST116', message: 'Declared unit DB expected one row' } }
    }
    return { data: single ? projected[0] ?? null : projected, error: null }
  }
  const chain = {
    select(value = '*') { columns = value; return chain },
    eq(column: string, value: unknown) { filters.push({ column, values: [value] }); return chain },
    in(column: string, values: unknown[]) { filters.push({ column, values }); return chain },
    not(column: string, operator: string, value: unknown) {
      if (operator !== 'is') throw new Error(`DB01 undeclared NOT operator: ${operator}`)
      filters.push({column, values: [value], exclude: true}); return chain
    },
    order() { return chain },
    limit(value: number) { limit = value; return chain },
    insert(value: Row | Row[]) { pending = Array.isArray(value) ? value : [value]; return chain },
    upsert(value: Row | Row[]) { pending = Array.isArray(value) ? value : [value]; return chain },
    single: async () => result(true),
    maybeSingle: async () => result(true, true),
    then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result(false)).then(resolve) },
  }
  return chain
}

function profile() { return tables.ediel_route_profiles[0] }
function actor() { return tables.ediel_actor_settings[0] }
function seed(hint: string | null = LEGACY_ADDRESS, testCaseCode = 'L7') {
  tables = {
    ediel_messages: [], ediel_message_events: [], ediel_business_references: [],
    ediel_test_run_messages: [], ediel_test_artifacts: [],
    company_memberships: [{company_id: COMPANY, user_id: USER, status: 'active', is_active: true, accepted_at: NOW}],
    user_profiles: [{id: USER, user_status: 'active'}],
    ediel_parties: [{ id: PARTY, ediel_id: '24200', roles: ['supplier'], status: 'verified' }],
    // Contradictory and stale legacy facts are deliberately tempting, but no
    // current producer should consult them to choose an address or certificate.
    ediel_party_addresses: [
      { id: LEGACY_ADDRESS, party_id: PARTY, company_id: COMPANY, smtp_address: 'wrong@example.invalid', receiver_certificate_id: 'wrong-cert', environment: 'production' },
      { id: FOREIGN_ADDRESS, party_id: PARTY, company_id: FOREIGN_COMPANY, smtp_address: 'foreign@example.invalid', environment: 'test' },
      { id: STALE_ADDRESS, party_id: PARTY, company_id: COMPANY, status: 'expired', valid_to: '2020-01-01', smtp_address: 'stale@example.invalid' },
    ],
    ediel_actor_settings: [{ id: 'actor-setting', company_id: COMPANY, environment: 'test', is_active: true,
      actor_role: 'supplier', actor_ediel_id: '24200', ediel_id: '24200', actor_name: 'Declared supplier', sender_name: 'Declared supplier',
      sender_sub_address: 'SUPPLIER', mailbox: 'actor-mailbox', smtp_from_email: 'sender@example.invalid', brp_ediel_id: '24201' }],
    tenant_ediel_profiles: [{ id: 'tenant-profile', company_id: COMPANY, environment: 'test', market: 'electricity', is_enabled: true,
      valid_from: '2026-01-01T00:00:00Z', valid_to: null }],
    tenant_actor_identifiers: [{ id: 'tenant-id', company_id: COMPANY, environment: 'test', actor_id: 'own-legal-actor',
      identifier_type: 'EdielId', identifier_value: '24200', valid_from: '2026-01-01T00:00:00Z', valid_to: null }],
    tenant_actor_roles: [{ id: 'tenant-role', company_id: COMPANY, environment: 'test', actor_id: 'own-legal-actor',
      role_code: 'electricity_supplier', valid_from: '2026-01-01T00:00:00Z', valid_to: null }],
    tenant_counterparty_relations: [],
    communication_routes: [{ id: ROUTE, company_id: COMPANY, route_name: 'AGT 2026A PRODAT Edielportalen',
      is_active: true, route_scope: 'company', route_type: 'ediel_partner', target_email: 'portal@example.invalid' }],
    ediel_route_profiles: [{ id: PROFILE, company_id: COMPANY, communication_route_id: ROUTE, environment: 'test',
      message_family: 'PRODAT', is_enabled: true, default_test_flag: 1, sender_ediel_id: '24200', receiver_ediel_id: '91100',
      sender_sub_address: 'SUPPLIER', receiver_sub_address: 'PRODAT', application_reference: '23-DDQ-PRODAT',
      mailbox: 'locked-mailbox', party_id: PARTY, party_address_id: hint, encryption_mode: 'smime',
      transport_security_mode: 'required_encrypted', certificate_id: 'fallback-cert', receiver_certificate_id: CERTIFICATE }],
    ediel_system_test_settings: [{ id: 'system-test-input', company_id: COMPANY, environment: 'test', test_suite: 'AGT', is_active: true,
      actor_role: 'supplier', message_family: 'PRODAT', setup_package: 'agt_ddq_prodat_l', environment_type: 'agt_test',
      test_portal_counterparty_id: 'portal', default_receiver_subaddress: 'PRODAT' }],
    ediel_counterparties: [{ id: 'portal', counterparty_ediel_id: '91100', counterparty_name: 'Declared test portal', email: 'portal@example.invalid' }],
    ediel_test_runs: [{ id: RUN, company_id: COMPANY, status: 'running', test_suite: 'PRODAT', test_case_code: testCaseCode,
      role_code: 'supplier', approval_version: '2026A', encryption_mode: 'smime', route_profile_id: PROFILE, started_at: '2026-10-06T19:00:00Z' }],
  }
}

function freshInput(hint?: string | null): CreateEdielMessageInput {
  return { actorUserId: USER, companyId: COMPANY, direction: 'outbound', messageStandard: 'edifact', messageFamily: 'PRODAT',
    messageCode: 'Z03', messageVersion: '26A', environment: 'production', testFlag: 0, status: 'prepared',
    transportType: 'smtp', mailbox: 'canonical-mailbox', senderEdielId: '24200', receiverEdielId: '11900',
    receiverEmail: 'canonical@example.invalid', receiverSubAddress: 'PRODAT', applicationReference: '23-DDQ-PRODAT',
    communicationRouteId: ROUTE, routeProfileId: PROFILE, partyId: PARTY, partyAddressId: hint,
    transportSecurityMode: 'required_encrypted', routeTransportSecurityMode: 'required_encrypted', expectedReceiverCertificateId: CERTIFICATE,
    outboundRequestId: 'own-outbound-request', customerId: 'own-customer', siteId: 'own-site', meteringPointId: 'own-point',
    interchangeReference: 'OWN-UNB', externalReference: 'OWN-BGM', transactionReference: 'OWN-LI',
    rawPayload: "UNB+UNOC:3+24200:SVK+11900:SVK+261006:2000+OWN-UNB++++1'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+OWN-BGM'LIN+1++735999000000242003:9'RFF+LI:OWN-LI'UNT+5+1'UNZ+1+OWN-UNB'" }
}
function createdRows() { return writes.filter(write => write.table === 'ediel_messages').flatMap(write => write.rows) }
function assertNoEffects() { expect(writes).toEqual([]) }
async function createAgt(testCaseCode = 'L7', companyId = COMPANY) {
  return createEdielSupplierAgtOutboundCommand({ actorUserId: USER, companyId, testRunId: RUN, testCaseCode })
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(NOW))
  reads = []; writes = []; rpcCalls = []; nextId = 0; seed(); port.from = query; port.rpc = declaredRpc
})
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); port.from = null; port.rpc = null })

describe('DB01 fresh message address retirement preserves current authority', () => {
  it.each([
    ['absent', undefined], ['explicit null', null], ['contradictory', LEGACY_ADDRESS],
    ['foreign', FOREIGN_ADDRESS], ['stale', STALE_ADDRESS],
  ] as const)('%s legacy hint stores NULL and preserves canonical IDs, references and created event', async (_label, hint) => {
    const row = await createEdielMessage(freshInput(hint))
    expect(row).toMatchObject({ company_id: COMPANY, communication_route_id: ROUTE, route_profile_id: PROFILE,
      mailbox: 'canonical-mailbox', party_id: PARTY, receiver_email: 'canonical@example.invalid', receiver_ediel_id: '11900',
      transport_security_mode: 'required_encrypted', route_transport_security_mode: 'required_encrypted', expected_receiver_certificate_id: CERTIFICATE })
    expect(createdRows()).toHaveLength(1)
    expect(tables.ediel_business_references).toEqual(expect.arrayContaining([
      expect.objectContaining({ company_id: COMPANY, source_message_id: row.id, reference_type: 'UNB_REF', reference_value: 'OWN-UNB', business_object_id: 'own-outbound-request', customer_id: 'own-customer', customer_site_id: 'own-site', metering_point_id: 'own-point' }),
      expect.objectContaining({ company_id: COMPANY, source_message_id: row.id, reference_type: 'BGM_REF', reference_value: 'OWN-BGM' }),
      expect.objectContaining({ company_id: COMPANY, source_message_id: row.id, reference_type: 'RFF_LI', reference_value: 'OWN-LI' }),
    ]))
    expect(tables.ediel_message_events).toEqual([expect.objectContaining({ company_id: COMPANY, ediel_message_id: row.id, event_type: 'created',
      payload: { status: 'prepared', direction: 'outbound', externalReference: 'OWN-BGM', communicationRouteId: ROUTE } })])
    expect(reads.some(read => ['ediel_parties', 'ediel_party_addresses'].includes(read.table))).toBe(false)
    // All preceding assertions establish real creation and preserved effects;
    // the prospective failure is the actual persisted legacy ID, not setup.
    expect(row).toHaveProperty('party_address_id', null)
    expect(createdRows()[0].party_address_id).toBeNull()
  })

  it('the scoped historical reader retains an original legacy address without writing history', async () => {
    const original = { id: 'historical-message', company_id: COMPANY, party_address_id: LEGACY_ADDRESS, raw_payload: 'historical-original', immutable_payload_hash: 'historical-hash' }
    tables.ediel_messages.push(structuredClone(original))
    expect(await getEdielMessageById(original.id, { companyId: COMPANY })).toEqual(original)
    expect(await getEdielMessageById(original.id, { companyId: FOREIGN_COMPANY })).toBeNull()
    expect(tables.ediel_messages).toEqual([original]); assertNoEffects()
  })

  it.each([
    { receiverEmail: 'portal@ediel.se', diagnostic: 'ediel_portal_email_in_production' },
    { receiverEdielId: '91100', diagnostic: 'Produktionsruntime innehåller TGT-adressering' },
  ])('legacy hint cannot rescue the real production guard: $diagnostic', async ({ diagnostic, ...bad }) => {
    await expect(createEdielMessage({ ...freshInput(LEGACY_ADDRESS), ...bad })).rejects.toThrow(diagnostic)
    assertNoEffects()
  })
})

describe('DB01 actual AGT producer uses current runtime while ignoring retired hints', () => {
  it.each([
    ['absent', null], ['contradictory', LEGACY_ADDRESS], ['foreign', FOREIGN_ADDRESS], ['stale', STALE_ADDRESS],
  ] as const)('%s profile hint leaves the rendered L7 canonical context intact and stores NULL', async (_label, hint) => {
    seed(hint)
    // Observation only: the spy retains the actual implementation and all
    // persistence/reference/event effects; no creator is stubbed or replaced.
    const messageCreation = vi.spyOn(messageDb, 'createEdielMessage')
    const canonicalCreation = vi.spyOn(kernel, 'createCanonicalOutboundMessage')
    const nationalValidation = vi.spyOn(validator, 'validateRulebookMessageWithRegistry')
    const row = await createAgt()
    expect(row).toMatchObject({ company_id: COMPANY, environment: 'test', test_flag: 1, message_family: 'PRODAT', message_code: 'Z09',
      communication_route_id: ROUTE, mailbox: 'locked-mailbox', party_id: PARTY,
      sender_ediel_id: '24200', receiver_ediel_id: '91100', receiver_email: 'portal@example.invalid', application_reference: '23-DDQ-PRODAT',
      transport_security_mode: 'required_encrypted', route_transport_security_mode: 'required_encrypted' })
    expect(row.raw_payload).toContain("CCI++Z13'CAV+E32'")
    expect(row.raw_payload).toContain("CCI++Z04'CAV+Z03'")
    expect(row.validation_report?.lockedSendContext).toEqual({ source: 'ediel_test_runs', testRunId: RUN, testSuite: 'PRODAT', testCaseCode: 'L7',
      roleCode: 'supplier', encryptionMode: 'smime', routeProfileId: PROFILE, communicationRouteId: ROUTE,
      transportSecurityMode: 'required_encrypted', routeTransportSecurityMode: 'required_encrypted', routeEncryptionMode: 'smime', certificateId: CERTIFICATE })
    expect(tables.ediel_test_run_messages).toEqual([expect.objectContaining({ company_id: COMPANY, test_run_id: RUN, ediel_message_id: row.id, expected_code: 'Z09', expected_direction: 'outbound' })])
    expect(tables.ediel_message_events.map(event => event.event_type)).toEqual(['created', 'prepared'])
    expect(tables.ediel_test_artifacts).toHaveLength(1)
    expect(createdRows()).toHaveLength(1)
    expect(messageCreation.mock.calls).toHaveLength(1)
    expect(row).toHaveProperty('party_address_id', null)
    // Keep the AGT caller check independent of the lower persistence fix:
    // merely ignoring the hint in db.ts must not hide continued forwarding.
    expect(messageCreation.mock.calls[0][0].partyAddressId).toBeUndefined()
    // Stronger prospective source seam, after all previous rendering,
    // security, linkage, reference and retirement oracles have executed.
    expect.soft(canonicalCreation).toHaveBeenCalledOnce()
    expect.soft(nationalValidation).toHaveBeenCalledOnce()
    expect.soft(row).toMatchObject({route_profile_id: PROFILE, canonical_rule_pack_id: PACK,
      rule_profile_version_id: MESSAGE_PROFILE, rule_profile_key: PROFILE_KEY,
      rule_profile_version: '26.A:r3', rule_pack_checksum: 'a'.repeat(64),
      execution_context_snapshot: {outboundOwnerWitnessId: WITNESS, executionContext: {
        companyId: COMPANY, environment: 'test', direction: 'outbound', rulePackId: PACK,
        communicationRouteId: ROUTE, routeProfileId: PROFILE, senderEdielId: '24200', senderRole: 'supplier'}}})
    expect.soft(rpcCalls.map(call => call.name)).toContain('ediel_prepare_outbound_owner_witness_v1')
    // The command owns this identity before the real gateway. Neither the
    // persistence port nor a supplied execution snapshot may fill it in.
    const operationId = `ediel_agt:${COMPANY}:test:2026A:PRODAT:supplier:L7:step:1:run:${RUN}`
    expect.soft(canonicalCreation.mock.calls[0][0].baseInput.sourceOperationId).toBe(operationId)
    expect.soft(messageCreation.mock.calls[0][0].sourceOperationId).toBe(operationId)
    expect.soft(row.source_operation_id).toBe(operationId)
    expect.soft(row.execution_context_snapshot).toMatchObject({executionContext: {sourceOperationId: operationId}})
  })

  it.each(['missing', 'foreign'] as const)('an invalid %s locked profile cannot fall back to the valid runtime profile', async kind => {
    const invalidProfile = '50000000-0000-4000-8000-000000000099'
    tables.ediel_test_runs[0].route_profile_id = invalidProfile
    if (kind === 'foreign') tables.ediel_route_profiles.push({...profile(), id: invalidProfile, company_id: FOREIGN_COMPANY})
    // The ordinary runtime selector still has its own valid profile, so a
    // refusal must come from the distinct selected locked-run scope.
    expect(profile()).toMatchObject({id: PROFILE, company_id: COMPANY, is_enabled: true})
    await expect.soft(createAgt()).rejects.toThrow('agt_run_route_profile_unavailable')
    assertNoEffects()
    expect(rpcCalls.some(call => call.name === 'ediel_prepare_outbound_owner_witness_v1')).toBe(false)
  })

  it('a manual command without a locked run selects its real named AGT runtime profile', async () => {
    tables.ediel_test_runs = []
    const canonicalCreation = vi.spyOn(kernel, 'createCanonicalOutboundMessage')
    const messageCreation = vi.spyOn(messageDb, 'createEdielMessage')
    const row = await createEdielSupplierAgtOutboundCommand({actorUserId: USER, companyId: COMPANY, testCaseCode: 'L7'})
    expect(row).toMatchObject({communication_route_id: ROUTE, route_profile_id: PROFILE,
      mailbox: 'locked-mailbox', party_address_id: null, canonical_rule_pack_id: PACK})
    expect(tables.ediel_test_run_messages).toEqual([])
    expect(canonicalCreation).toHaveBeenCalledOnce()
    expect(messageCreation).toHaveBeenCalledOnce()
    expect(row.interchange_reference).toMatch(/^[0-9A-F]{14}$/)
    // Manual commands retain their actual generated UNB identity; there is
    // no invented persisted run or new retry/idempotency authority here.
    const operationId = `ediel_agt:${COMPANY}:test:2026A:PRODAT:supplier:L7:step:1:command:${row.interchange_reference}`
    expect.soft(canonicalCreation.mock.calls[0][0].baseInput.sourceOperationId).toBe(operationId)
    expect.soft(messageCreation.mock.calls[0][0].sourceOperationId).toBe(operationId)
    expect.soft(row.source_operation_id).toBe(operationId)
    expect.soft(row.execution_context_snapshot).toMatchObject({executionContext: {sourceOperationId: operationId}})
  })

  it.each([
    ['missing', () => { tables.ediel_test_runs = [] }],
    ['foreign', () => { tables.ediel_test_runs[0].company_id = FOREIGN_COMPANY }],
    ['finished', () => { tables.ediel_test_runs[0].status = 'passed' }],
  ] as const)('an explicitly requested %s run cannot become an unlocked manual command', async (_name, change) => {
    change()
    await expect(createAgt()).rejects.toThrow('agt_run_unavailable')
    assertNoEffects()
    expect(rpcCalls).toEqual([])
  })

  it.each([
    ['case', () => { tables.ediel_test_runs[0].test_case_code = 'L1' }],
    ['suite', () => { tables.ediel_test_runs[0].test_suite = 'UTILTS' }],
    ['role', () => { tables.ediel_test_runs[0].role_code = 'grid_owner' }],
    ['version', () => { tables.ediel_test_runs[0].approval_version = 'UNSUPPORTED' }],
  ] as const)('a selected run with a different %s cannot supply AGT source context', async (_name, change) => {
    change()
    await expect(createAgt()).rejects.toThrow('agt_run_scope_mismatch')
    assertNoEffects()
    expect(rpcCalls).toEqual([])
  })

  it.each([
    ['missing id', 'route_profile_id', null],
    ['disabled', 'is_enabled', false],
    ['production environment', 'environment', 'production'],
    ['non-test flag', 'default_test_flag', 0],
    ['different family', 'message_family', 'UTILTS'],
    ['different route', 'communication_route_id', '40000000-0000-4000-8000-000000000099'],
    ['different sender', 'sender_ediel_id', '11900'],
    ['different receiver', 'receiver_ediel_id', '11900'],
    ['different APP', 'application_reference', 'WRONG-PRODAT'],
    ['different sender subaddress', 'sender_sub_address', 'OTHER'],
    ['different receiver subaddress', 'receiver_sub_address', 'OTHER'],
  ] as const)('the actual locked-profile read refuses %s after valid runtime selection', async (_name, column, value) => {
    if (column === 'route_profile_id') tables.ediel_test_runs[0][column] = value
    else port.from = table => {
      const current = query(table)
      if (table === 'ediel_route_profiles') {
        const eq = current.eq
        current.eq = (key, selected) => {
          // Physical table change at the distinct id-selected read. Earlier
          // ordinary runtime reads keep their real returned row snapshots.
          if (key === 'id') profile()[column] = value
          return eq(key, selected)
        }
      }
      return current
    }
    await expect(createAgt()).rejects.toThrow('agt_run_route_profile_unavailable')
    assertNoEffects()
    expect(rpcCalls).toEqual([])
  })

  it.each(['membership', 'permission', 'registry', 'witness'] as const)('actual canonical %s refusal leaves no message/run/artifact effects', async boundary => {
    if (boundary === 'membership') tables.company_memberships = []
    port.rpc = (name, args) => {
      if (boundary === 'permission' && name === 'gridex_actor_has_company_permission') {
        rpcCalls.push({name, args: structuredClone(args)})
        return Promise.resolve({data: false, error: null})
      }
      if (boundary === 'registry' && name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') {
        rpcCalls.push({name, args: structuredClone(args)})
        return Promise.resolve({data: [], error: null})
      }
      if (boundary === 'witness' && name === 'ediel_prepare_outbound_owner_witness_v1') {
        rpcCalls.push({name, args: structuredClone(args)})
        return Promise.resolve({data: null, error: new Error('Declared SDK witness unavailable')})
      }
      return declaredRpc(name, args)
    }
    const diagnostic = {membership: 'ediel_tenant_actor_forbidden', permission: 'ediel_tenant_permission_forbidden',
      // With a positive binding, existing kernel reports registry rejection as diagnostic mismatch.
      registry: 'canonical_outbound_positive_fixture_diagnostics_mismatch', witness: 'ediel_outbound_owner_witness_required'}[boundary]
    await expect(createAgt()).rejects.toThrow(diagnostic)
    assertNoEffects()
    if (boundary !== 'witness') expect(rpcCalls.some(call => call.name === 'ediel_prepare_outbound_owner_witness_v1')).toBe(false)
  })

  it('the real public kernel and national validator refuse the rendered legacy AGT process label before a witness', async () => {
    const messageCreation = vi.spyOn(messageDb, 'createEdielMessage')
    await createAgt()
    const actualRenderedInput = messageCreation.mock.calls[0][0]
    for (const table of ['ediel_messages', 'ediel_message_events', 'ediel_business_references', 'ediel_test_run_messages', 'ediel_test_artifacts']) tables[table] = []
    writes = []; rpcCalls = []
    await expect(kernel.createCanonicalOutboundMessage({actorUserId: USER, requestType: 'customer_masterdata',
      baseInput: {...actualRenderedInput, processType: 'agt_supplier_l7', communicationRouteId: ROUTE, routeProfileId: PROFILE}}))
      .rejects.toThrow('CANONICAL_PROCESS_GROUP_MISMATCH')
    assertNoEffects()
    expect(rpcCalls.some(call => call.name === 'ediel_prepare_outbound_owner_witness_v1')).toBe(false)
  })

  it('the real L1 preflight retains its independent address/invoicee hold despite a legacy hint', async () => {
    seed(LEGACY_ADDRESS, 'L1')
    await expect(createAgt('L1')).rejects.toThrow('PRODAT_DEPENDENT_CONDITION_UNDETERMINED: Z03:229')
    await expect(createAgt('L1')).rejects.toThrow('PRODAT_DEPENDENT_CONDITION_UNDETERMINED: Z03:INVOICEE_GROUP')
    expect(reads.some(read => read.table === 'ediel_route_profiles' && read.filters.some(filter => filter.column === 'id'))).toBe(false)
    assertNoEffects()
  })

  it('the locked-profile read stops requesting the retired column even when its stored value is null', async () => {
    seed(null)
    await createAgt()
    const lockedReads = reads.filter(read => read.table === 'ediel_route_profiles' && read.filters.some(filter => filter.column === 'id'))
    expect(lockedReads).toHaveLength(1)
    expect(lockedReads[0].filters).toEqual(expect.arrayContaining([{ column: 'id', values: [PROFILE] }, { column: 'company_id', values: [COMPANY] }]))
    expect(lockedReads[0].columns.split(',')).not.toContain('party_address_id')
  })

  it.each([
    ['wrong SMTP', () => { tables.communication_routes[0].target_email = 'wrong@example.invalid' }, 'DB-konfigurerade testportaladressen'],
    ['foreign profile', () => { profile().company_id = FOREIGN_COMPANY }, 'runtimeprofil saknas'],
    ['wrong sender identity', () => { profile().sender_ediel_id = '11900' }, 'matchar inte tenantens aktörs-Ediel-id'],
    ['wrong APP', () => { profile().application_reference = 'WRONG-PRODAT' }, '23-DDQ-PRODAT'],
    ['disabled route', () => { tables.communication_routes[0].is_active = false }, 'Aktivera communication route'],
    ['missing tenant market role', () => { tables.tenant_actor_roles = [] }, 'tenant_market_roles_missing'],
    ['missing locked run role', () => { tables.ediel_test_runs[0].role_code = null }, 'agt_run_role_code_required'],
  ] as const)('a legacy hint cannot rescue %s in the actual AGT/tenant gates', async (_label, breakCurrent, diagnostic) => {
    breakCurrent()
    await expect(createAgt()).rejects.toThrow(diagnostic)
    assertNoEffects()
  })

  it('a foreign company cannot borrow the own actor/profile through a legacy hint', async () => {
    await expect(createAgt('L1', FOREIGN_COMPANY)).rejects.toThrow('Ingen aktiv ediel_actor_settings')
    assertNoEffects()
  })

  it.each([
    ['plaintext', 'none', 'unencrypted', CERTIFICATE, 'production_prodat_smime_required'],
    ['missing certificate', 'smime', 'required_encrypted', null, 'certificate_missing'],
    ['unverified security', 'none', 'needs_verification', CERTIFICATE, 'transport_security_needs_verification'],
  ] as const)('%s stays blocked by the real production security evaluator despite legacy claims', (_label, encryptionMode, security, certificate, diagnostic) => {
    // This is the real security evaluator's boundary, not an assertion that
    // the AGT test command itself performs production certificate activation.
    const current = { ...profile(), environment: 'production' as const, message_standard: 'edifact' as const, message_family: 'PRODAT',
      encryption_mode: encryptionMode, transport_security_mode: security, certificate_id: certificate,
      allow_unencrypted_production: true, allow_unencrypted_production_expires_at: '2099-01-01T00:00:00Z', allow_unencrypted_production_reason: 'manual legacy verification' }
    const decision = evaluateProductionTransportSecurity({ runtime: current })
    expect(decision.ok).toBe(false)
    expect(decision.overrideActive).toBe(false)
    expect(decision.issues.map(issue => issue.key)).toContain(diagnostic)
    expect(actor().actor_ediel_id).toBe('24200'); assertNoEffects()
  })
})

// The missing consumer mutation is skipping positive-original resolution or
// binding a copied draft: either loses the actual protected preparation token.
describe('DB01 AGT registered positive original reaches the canonical consumer', () => {
  it('keeps one rendered original through qualification, preparation and durable run-linked creation', async () => {
    const row = await createAgt()
    expect(row.execution_context_snapshot).toMatchObject({outboundOwnerWitnessId: WITNESS,
      sourceQualifiedPositiveFixtureWitnessId: POSITIVE_WITNESS})
    expect(tables.ediel_test_run_messages).toEqual([expect.objectContaining({test_run_id: RUN, ediel_message_id: row.id, step_no: 1})])
    const read = rpcCalls.find(call => call.name === 'gridex_ediel_positive_fixture_read_v1')!
    const prepare = rpcCalls.find(call => call.name === 'gridex_ediel_positive_fixture_prepare_v1')!
    const owner = rpcCalls.find(call => call.name === 'ediel_prepare_outbound_owner_witness_v1')!
    expect(read.args.p_context).toMatchObject({rawPayload: row.raw_payload, companyId: COMPANY, runId: RUN, actorUserId: USER})
    expect(prepare.args.p_context).toMatchObject({rawPayload: row.raw_payload, registrationId: POSITIVE_REGISTRATION})
    expect(owner.args.p_input).toMatchObject({rawPayload: row.raw_payload, sourceQualifiedPositiveFixtureWitnessId: POSITIVE_WITNESS})
    expect(declaredPositiveOriginal(read.args.p_context as Row).authorizesBusinessEffect).toBe(false)
  })

  it.each([
    ['missing registration', {}, 'ediel_positive_fixture_original_required'],
    ['wrong run', {runId: '60000000-0000-4000-8000-000000000002'}, 'ediel_positive_fixture_authority_scope_invalid'],
    ['wrong company', {companyId: FOREIGN_COMPANY}, 'ediel_positive_fixture_authority_scope_invalid'],
    ['wrong step', {stepNo: 2}, 'ediel_positive_fixture_authority_scope_invalid'],
    ['changed wire', {wireSha256: 'f'.repeat(64)}, 'ediel_positive_fixture_authority_scope_invalid'],
    ['expired original', {validUntil: '2026-10-06T19:59:59.000Z'}, 'ediel_positive_fixture_authority_scope_invalid'],
    ['business authority claim', {authorizesBusinessEffect: true}, 'ediel_positive_fixture_authority_scope_invalid'],
    ['negative diagnostic claim', {expectedDiagnosticCodes: ['SYNTHETIC_NEGATIVE']}, 'ediel_positive_fixture_authority_scope_invalid'],
  ] as const)('%s refuses before message, references, witness or run effects', async (label, mutation, diagnostic) => {
    port.rpc = (name, args) => {
      if (name === 'gridex_ediel_positive_fixture_read_v1') {
        rpcCalls.push({name, args: structuredClone(args)})
        return Promise.resolve({data: label === 'missing registration' ? null : {...declaredPositiveOriginal(args.p_context as Row), ...mutation}, error: null})
      }
      return declaredRpc(name, args)
    }
    await expect(createAgt()).rejects.toThrow(diagnostic)
    assertNoEffects()
    expect(rpcCalls.some(call => ['gridex_ediel_positive_fixture_prepare_v1', 'ediel_prepare_outbound_owner_witness_v1'].includes(call.name))).toBe(false)
  })

  it('positive classification cannot suppress actual canonical admission diagnostics', async () => {
    port.rpc = async (name, args) => {
      const result = await declaredRpc(name, args)
      if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') return {...result, data: {...result.data as Row, parser_ready: false}}
      return result
    }
    await expect(createAgt()).rejects.toThrow('canonical_outbound_positive_fixture_diagnostics_mismatch')
    assertNoEffects()
    expect(rpcCalls.some(call => call.name === 'gridex_ediel_positive_fixture_prepare_v1')).toBe(false)
  })

  it('an unavailable original authority cannot become a manual command', async () => {
    port.rpc = (name, args) => name === 'gridex_ediel_positive_fixture_read_v1'
      ? Promise.resolve({data: null, error: new Error('Synthetic authority unavailable')}) : declaredRpc(name, args)
    await expect(createAgt()).rejects.toThrow('ediel_positive_fixture_authority_unavailable')
    assertNoEffects()
  })

  it('failed actual fixture preparation leaves no durable consumer effects', async () => {
    port.rpc = (name, args) => name === 'gridex_ediel_positive_fixture_prepare_v1'
      ? Promise.resolve({data: null, error: new Error('Synthetic preparation unavailable')}) : declaredRpc(name, args)
    await expect(createAgt()).rejects.toThrow('ediel_positive_fixture_witness_required')
    assertNoEffects()
    expect(rpcCalls.some(call => call.name === 'ediel_prepare_outbound_owner_witness_v1')).toBe(false)
  })
})
