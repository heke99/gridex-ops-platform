// Declared external IO component: actual coordinator -> Z02 linker -> real
// response enqueue/snapshot consumer. Native SQL/issuer/lock proof stays separate.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'
import { readOutboundAckOriginals } from '@/lib/ediel/core/outboundAckOriginals'
import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import { EdielExecutionFailure } from '@/lib/ediel/core/failureDisposition'
import { applyInboundProdatZ02ToCustomerInfoRequest } from '@/lib/onboarding/inboundEdielLinking'
import { externalZ02Reply } from '@/scripts/helpers/ediel-z02-supplier-native-wire'
import { head, source } from './fixtures/prodat-identity'
import { line, raw, characteristic, type Parts } from './fixtures/prodat-register'
import { source as actualSource } from './fixtures/prodat-identity'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: io }))
vi.mock('@/lib/supabase/tenantDb', () => ({ tenantDb: () => ({ from: io.from }) }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: async () => undefined }))
// The real enqueue implementation is retained; importing the facade's worker
// modules is unnecessary for this insertion-only transport component.
vi.mock('@/lib/customer-operations/automation', async () => {
  const actual = await import('@/lib/customer-operations/automation.part-1')
  return { enqueueInboundGridOwnerResponseAutomation: actual.enqueueInboundGridOwnerResponseAutomation }
})

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = { company: id(1), actor: id(2), customer: id(3), site: id(4), point: id(5),
  request: id(6), operation: id(7), source: id(8), original: id(9), job: id(10), trace: id(11), ack: id(12), gridRequest: id(13) }
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
let tables: Record<string, Row[]>
let original: EdielMessageRow
let ack: EdielMessageRow
let calls: Array<{ table?: string; operation?: string; name?: string; args?: Row }>
let actorActive: boolean
let allowed: Record<string, boolean>
let ownerKind: 'qualified' | 'held' | 'absent'
let malformedOwner: string
let readBarrier: (() => Promise<void>) | null
let nextId: number
let forgedLegacyPositive: boolean
let withdrawAfterOwnerRead: boolean

function gate() {
  return { z02_correlation_status: 'exact', z02_payload_validation_status: 'valid',
    z02_snapshot_freshness_status: 'valid', z02_atomic_core_applied: true,
    z02_atomic_core: { ok: true } }
}

/** Fluent filters, actual partial-index predicate and real onConflict keys.
 * A completed row does not pretend to enforce global idempotency. */
function from(table: string) {
  if (!(table in tables)) throw new Error(`undeclared_replay_sdk_table:${table}`)
  const filters: Array<(row: Row) => boolean> = []
  let operation = 'select', payload: Row | undefined, conflict: string | undefined, limit = Infinity
  const result = (single = false) => {
    calls.push({ table, operation })
    const rows = tables[table]
    let selected = rows.filter(row => filters.every(test => test(row)))
    if (operation === 'insert' && payload) {
      if (table === 'customer_operation_jobs' && rows.some(row => row.company_id === payload!.company_id && row.job_type === payload!.job_type
        && row.idempotency_key === payload!.idempotency_key && ['queued', 'running', 'waiting_response'].includes(String(row.status)))) {
        return { data: null, error: { code: '23505', message: 'declared_actual_active_index' } }
      }
      const saved = { id: id(nextId++), ...structuredClone(payload), ...(table === 'customer_operation_jobs' ? { result: gate() } : {}) }
      rows.push(saved); selected = [saved]
    } else if (operation === 'upsert' && payload) {
      if (!conflict) throw new Error('declared_snapshot_conflict_keys_required')
      const old = rows.find(row => conflict!.split(',').every(key => row[key] === payload![key]))
      const saved = old ? Object.assign(old, structuredClone(payload)) : { id: id(nextId++), ...structuredClone(payload) }
      if (!old) rows.push(saved)
      selected = [saved]
    } else if (operation === 'update' && payload) selected.forEach(row => Object.assign(row, structuredClone(payload)))
    selected = selected.slice(0, limit)
    return { data: single ? selected[0] ?? null : selected, error: null }
  }
  const q = {
    select: () => q, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q },
    not: (key: string, _operator: string, value: unknown) => { filters.push(row => row[key] !== value); return q },
    is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return q },
    order: () => q, limit: (value: number) => { limit = value; return q },
    insert: (value: Row) => { operation = 'insert'; payload = value; return q },
    upsert: (value: Row, options: { onConflict: string }) => { operation = 'upsert'; payload = value; conflict = options.onConflict; return q },
    update: (value: Row) => { operation = 'update'; payload = value; return q },
    single: async () => result(true), maybeSingle: async () => result(true),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
  }
  return q
}

async function rpc(name: string, args: Row) {
  calls.push({ name, args: structuredClone(args) })
  if (name === 'gridex_actor_has_company_permission') return { data: actorActive && args.p_actor_user_id === own.actor
    && args.p_company_id === own.company && allowed[String(args.p_permission)] === true, error: null }
  if (!['gridex_read_outbound_acks_for_source_v1', 'gridex_read_outbound_acks_for_source_v2'].includes(name))
    throw new Error(`undeclared_replay_sdk_rpc:${name}`)
  expect(args.p_source_message_id).toBe(own.source)
  expect(args.p_ack_family).toBe('APERAK')
  if (name.endsWith('_v2')) {
    if (readBarrier) await readBarrier()
    if (!actorActive || args.p_actor_user_id !== own.actor || !allowed['communication.write'])
      return { data: null, error: { code: '42501', message: 'declared_current_original_owner_refusal' } }
    expect(args.p_phase).toBe('prepare')
  }
  const data: Row = { version: name.endsWith('_v2') ? 2 : 1, sourceMessageId: original.id,
    sourcePayloadHash: hash(original.raw_payload!), companyId: original.company_id, environment: original.environment,
    ...(name.endsWith('_v2') ? { executionActorUserId: args.p_actor_user_id, executionPhase: args.p_phase } : {}),
    originals: ownerKind === 'absent' && !(name.endsWith('_v1') && forgedLegacyPositive)
      ? [] : [{ status: ownerKind === 'absent' ? 'qualified' : ownerKind, message: structuredClone(ack), payloadHash: hash(ack.raw_payload!) }] }
  if (name.endsWith('_v2') && malformedOwner) data[malformedOwner] = 'declared-wrong-owner-scope'
  if (name.endsWith('_v2') && withdrawAfterOwnerRead) allowed['metering.write'] = false
  return { data, error: null }
}

function fixture(variant: 'L' | 'LK' = 'L', responseFunction = 'AB', secondObject = false) {
  const parts: Parts[] = [...head(), line('1', '735123456789012345', undefined, '9'), ['DTM', ['92', '202611010000', '203']],
    ...characteristic('Z13', variant === 'L' ? 'Z22' : 'Z23'), ['RFF', ['Z05', 'NET']], ['RFF', ['LI', 'DECLARED-LI']],
    ['NAD', 'UD', ['199001011234', 'SE2', '260'], '', 'Synthetic', 'Street', 'Town', '', '12345', 'SE']]
  const business = tokenizeEdifact(raw(parts, 'Z01')).segments.filter(s => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(s.tag)).map(s => s.raw)
  const request = EdifactEnvelopeCodec.encode({ sender: '12345', receiver: '54321', senderQualifier: '14', receiverQualifier: '14',
    interchangeReference: 'SYNTHETIC-I', applicationReference: '23-DDQ-PRODAT', environment: 'test', acknowledgementRequest: false,
    createdAt: new Date('2026-10-06T12:00:00Z'), messages: [{ messageReference: 'SYNTHETIC-M', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: business }] })
  let wire = externalZ02Reply({ source: { rawPayload: request }, interchangeReference: 'REPLY-I', messageReference: 'REPLY-M', documentReference: 'REPLY-D',
    documentMinute: '202610061203', createdAt: new Date('2026-10-06T12:03:00Z'), measurementMethod: 'Z03',
    customerAddress: { street: 'Street', city: 'Town', postalCode: '12345', country: 'SE' },
    installationAddress: { street: 'Installation', city: 'Town', postalCode: '12345', country: 'SE' } })
  wire = wire.replace('+9+AB', `+9+${responseFunction}`)
  if (secondObject) {
    const parsed = EdifactEnvelopeCodec.decode(wire)
    const start = parsed.segments.findIndex(s => s.tag === 'LIN'), end = parsed.segments.findIndex(s => s.tag === 'UNT')
    const clone = parsed.segments.slice(start, end).map(s => s.raw.replace('LIN+1', 'LIN+2').replaceAll('735123456789012345', '735123456789012352').replaceAll('DECLARED-LI', 'SECOND-LI'))
    wire = EdifactEnvelopeCodec.encode({ sender: '54321', receiver: '12345', senderQualifier: '14', receiverQualifier: '14', interchangeReference: 'REPLY-I',
      applicationReference: '23-DDQ-PRODAT', environment: 'test', acknowledgementRequest: false, createdAt: new Date('2026-10-06T12:03:00Z'),
      messages: [{ messageReference: 'REPLY-M', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: [...parsed.segments.filter(s => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(s.tag)).map(s => s.raw), ...clone] }] })
  }
  original = { ...source(wire, 'Z02'), id: own.source, company_id: own.company, status: 'parsed', immutable_payload_hash: hash(wire),
    customer_id: own.customer, site_id: own.site, metering_point_id: own.point, grid_owner_data_request_id: own.gridRequest,
    message_received_at: '2026-10-06T12:03:00Z', related_message_id: own.original } as EdielMessageRow
  ack = { ...actualSource('', 'APERAK'), id: own.ack, company_id: own.company, direction: 'outbound', message_family: 'APERAK',
    raw_payload: EdifactEnvelopeCodec.encode({ sender: '12345', receiver: '54321', senderQualifier: '14', receiverQualifier: '14',
      interchangeReference: 'ACK-I', applicationReference: '23-DDQ-PRODAT', environment: 'test', acknowledgementRequest: false,
      messages: [{ messageReference: 'ACK-M', messageTypeToken: 'APERAK:D:96A:UN:E2SE6A', businessSegments:
        ['BGM+34+ACK-D+34', 'RFF+ACW:REPLY-D', 'NAD+FR+12345:160:SVK', 'NAD+DO+54321:160:SVK', 'ERC+100::260', 'RFF+LI:DECLARED-LI'] }] }),
    related_message_id: own.source, ack_outcome: 'negative', status: 'failed' } as EdielMessageRow
  const snapshot = { site_id: own.site, address_hash: 'street|12345|town', grid_owner_id: id(30), grid_area_code: 'NET',
    route_profile_id: null, facility_id: '735123456789012345', captured_at: '2026-10-06T12:00:00Z' }
  tables = {
    ediel_messages: [structuredClone(original) as unknown as Row, structuredClone(ack) as unknown as Row],
    company_memberships: [{ company_id: own.company, user_id: own.actor, status: 'active', is_active: true, accepted_at: '2026-01-01' }],
    user_profiles: [{ id: own.actor, user_status: 'active' }],
    customer_info_requests: [{ id: own.request, company_id: own.company, grid_owner_data_request_id: own.gridRequest, customer_id: own.customer,
      site_id: own.site, metering_point_id: own.point, operation_id: own.operation, status: 'verified', verified_payload: { original: true } }],
    customer_operation_jobs: [{ id: own.job, company_id: own.company, job_type: 'apply_inbound_grid_owner_response',
      idempotency_key: `inbound-grid-owner-response:${own.source}`, status: 'completed', operation_id: own.operation, trace_id: own.trace, result: gate() }],
    customer_operation_request_snapshots: [
      { company_id: own.company, operation_id: own.operation, request_kind: 'customer_data_request', request_reference: own.request, site_address_hash: snapshot.address_hash, snapshot },
      { company_id: own.company, operation_id: own.operation, request_kind: 'inbound_grid_owner_response', customer_operation_job_id: own.job,
        trace_id: own.trace, snapshot: { ...snapshot, trace_id: own.trace }, retained: 'full original after separate readiness' }],
    customer_info_request_events: [], ediel_outbox: [{ id: id(31), immutable: 'existing original outbox' }],
    customer_supply_periods: [], contracts: [],
  }
  return original
}

/** Execute exact production declarations, not a recreated coordinator. Only
 * unrelated canonical/tenant source IO and downstream projections are finite.
 * The defective linker/enqueue/upsert and protected ACK/actor adapters are real. */
function coordinator() {
  const file = readFileSync('lib/ediel/flows/inboundProcessing.ts', 'utf8')
  const ast = ts.createSourceFile('inboundProcessing.ts', file, ts.ScriptTarget.Latest, true)
  const names = new Set(['processInboundEdielMessage', 'processInboundProdatMessage', 'shouldProcessInboundMessage', 'technicalActorRefusal', 'inboundActorRefusal', 'prodatInternalReview', 'hasRetainedPositiveZ02Protocol'])
  const code = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text))
    .map(node => node.getText(ast).replace(/^export\s+/, '')).join('\n')
  const canonical = async ({ message }: { message: EdielMessageRow }) => ({ message, domainObjectCount: 0, authorizedPartialOwner: false,
    decision: { syntaxDecision: 'accepted', applicationDecision: 'accepted', functionalDecision: 'accepted', responsePlan: [], issues: [], policy: {}, prodatApplicationValidation: { objects: [] } },
    sourceOwnerSession: { finish: async () => undefined } })
  const context = vm.createContext({ Error, Set, Map, Object, Array, String, Boolean, Promise, Date, JSON, createHash,
    supabaseService: io, validateEdifactSyntax, tokenizeEdifact, segmentComposite, prodatRegisterGroups, readOutboundAckOriginals,
    assertEdielTenantActor, EdielExecutionFailure, ensureActorUserId: (actor: string) => actor,
    getEdielMessageById: async () => structuredClone(tables.ediel_messages.find(row => row.id === own.source)),
    applyInboundProdatZ02ToCustomerInfoRequest, applyInboundProdatZ14ToMeteringPermission: async () => ({ applied: false }),
    readEdielTechnicalSourceEndpoint: async () => null, hasReceivedProdatHeaderRejection: () => false,
    hasReceivedZ04RequiredStartRejection: () => false, hasReceivedZ04HRegisterRejection: () => false,
    hasReceivedZ04HRequiredFieldRejection: () => false, hasReceivedZ04HStructuralFieldRejection: () => false,
    resolveInboundTenantForMessage: async ({ message }: { message: EdielMessageRow }) => ({ status: 'tenant_resolved', companyId: own.company, message }),
    applyCanonicalRuntimeDecision: canonical, recordBackendAutomationPipelineTrace: async () => undefined,
    linkInboundProdatMessageCanonically: async () => ({ matchedSwitch: null }),
    updateEdielMessageStatus: async () => undefined, createOrUpdateInboundProdatCase: async () => null,
    applyInboundBusinessStateMachine: async () => ({ outcome: 'declared_unrelated_projection' }),
    createAutomaticPositiveAcks: async () => [], readCanonicalAckSnapshot: async () => ({ canonicalAckState: 'declared', ackMessages: [] }),
    createEdielMessageEvent: async () => undefined, ACTIVE_EDIEL_MESSAGE_FAMILIES: ['PRODAT'], isActiveEdielMessageFamily: () => true,
  })
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInContext(js, context)
  return vm.runInContext('processInboundEdielMessage', context) as (input: { actorUserId: string; edielMessageId: string }) => Promise<EdielMessageRow>
}

beforeEach(() => {
  calls = []; actorActive = true; allowed = { 'communication.write': true, 'metering.write': true }
  ownerKind = 'qualified'; malformedOwner = ''; readBarrier = null; nextId = 100
  forgedLegacyPositive = false; withdrawAfterOwnerRead = false
  io.from.mockImplementation(from); io.rpc.mockImplementation(rpc); fixture()
})
const run = () => coordinator()({ actorUserId: own.actor, edielMessageId: own.source })
const snapshot = () => structuredClone(tables)

it.each([['L', 'AB'], ['L', 'NA'], ['LK', 'AB'], ['LK', 'NA']] as const)(
  'completed own response replay is fully read-only for %s/%s', async (variant, responseFunction) => {
    fixture(variant, responseFunction); const before = snapshot()
    await run()
    expect(tables).toEqual(before)
  })

it('two concurrent terminal replays both qualify independently and preserve every store', async () => {
  const before = snapshot(); await Promise.all([run(), run()]); expect(tables).toEqual(before)
  expect(calls.filter(call => call.name === 'gridex_read_outbound_acks_for_source_v2')).toHaveLength(2)
})

it.each(['sourcePayloadHash', 'companyId', 'environment', 'executionActorUserId', 'executionPhase'])('refuses changed protected %s without any write', async field => {
  malformedOwner = field; const before = snapshot()
  await expect(run()).rejects.toThrow(); expect(tables).toEqual(before)
})

it('refuses actor withdrawal during the protected reader wait without any write', async () => {
  let entered!: () => void, release!: () => void
  const reading = new Promise<void>(resolve => { entered = resolve })
  const waiting = new Promise<void>(resolve => { release = resolve })
  readBarrier = async () => { entered(); await waiting }
  const before = snapshot(), pending = run()
  const refused = expect(pending).rejects.toMatchObject({ disposition: { kind: 'security_quarantine', code: 'EDIEL_INBOUND_EXECUTION_ACTOR_FORBIDDEN' } })
  await reading; actorActive = false; release(); await refused
  expect(tables).toEqual(before)
})

it('refreshes metering command permission after a qualified private read without any write', async () => {
  withdrawAfterOwnerRead = true; const before = snapshot()
  await expect(run()).rejects.toMatchObject({ disposition: { kind: 'security_quarantine' } })
  expect(tables).toEqual(before)
})

it.each(['communication.write', 'metering.write'])('refuses current %s withdrawal before terminal return', async permission => {
  allowed[permission] = false; const before = snapshot()
  await expect(run()).rejects.toMatchObject({ disposition: { kind: 'security_quarantine' } })
  expect(tables).toEqual(before)
})

it('never treats forged legacy positive availability as a private terminal receipt', async () => {
  ownerKind = 'absent'; forgedLegacyPositive = true
  await run()
  expect(calls.filter(call => call.name === 'gridex_read_outbound_acks_for_source_v2')).toHaveLength(1)
  expect(tables.customer_operation_jobs).toHaveLength(2)
})

it('public source/ACK statuses and relations cannot replace or reinterpret the protected whole original', async () => {
  tables.ediel_messages[0].status = 'manual_review'
  tables.ediel_messages[0].related_message_id = id(80)
  tables.ediel_messages[0].parsed_payload = { terminal: false, ackOutcome: 'negative' }
  tables.ediel_messages[1].related_message_id = id(81)
  tables.ediel_messages[1].ack_outcome = 'negative'
  const before = snapshot(); await run(); expect(tables).toEqual(before)
})

it('refuses a held private original even if all public cached flags say positive', async () => {
  ownerKind = 'held'; tables.ediel_messages[0].parsed_payload = { completed: true, finalAck: 'positive', core_applied: true }
  const before = snapshot(); await expect(run()).rejects.toThrow(); expect(tables).toEqual(before)
})

it.each(['absent', 'negative', 'partial'] as const)('preserves legitimate nonterminal %s continuation instead of trusting public completion', async kind => {
  if (kind === 'absent') ownerKind = 'absent'
  if (kind === 'negative') ack.raw_payload = ack.raw_payload!.replace('ERC+100', 'ERC+42')
  if (kind === 'partial') fixture('L', 'AB', true)
  tables.ediel_messages[0].parsed_payload = { finalAck: 'positive', sourceRules: { status: 'ready' }, completed: true }
  await run()
  expect(tables.customer_operation_jobs).toHaveLength(2)
  expect(tables.customer_operation_request_snapshots[1].customer_operation_job_id).not.toBe(own.job)
})

it('first processing with no business ACK still runs the actual enqueue/snapshot chain once', async () => {
  tables.ediel_messages = [tables.ediel_messages[0]]; ownerKind = 'absent'
  tables.customer_operation_jobs = []; tables.customer_operation_request_snapshots.splice(1)
  await run()
  expect(tables.customer_operation_jobs).toHaveLength(1)
  expect(tables.customer_operation_request_snapshots).toHaveLength(2)
})

it.each(['queued', 'running', 'waiting_response'])('nonterminal continuation retains the actual active-only %s index', async status => {
  ownerKind = 'absent'; tables.customer_operation_jobs[0].status = status; const before = snapshot()
  await run()
  expect(tables.customer_operation_jobs).toEqual(before.customer_operation_jobs)
  expect(tables.customer_operation_request_snapshots).toEqual(before.customer_operation_request_snapshots)
})
