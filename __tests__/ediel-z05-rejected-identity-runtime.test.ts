// masterplan: AT-Z05H-SUPPLIER, AT-Z08H-SUPPLIER
// Rejected209 prerequisite only: real async runtime, private rejection owner,
// structural validator, response renderer and source-evidence decoder execute.
// DB READs below are declared finite IO. This proves no genuine native source,
// sent ACK, legal commercial transition or whole H05/H08 acceptance.
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {ownerId, ownerRows, ownerRulePack} from './helpers/sourceOwnerFixtures'
import {withProdatFixtureInsertContext} from './helpers/prodatInboundSourceFixture'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {head, source} from './fixtures/prodat-identity'
import {line, characteristic, type Parts} from './fixtures/prodat-register'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {resolveCanonicalRuntimeDecisionWithRegistry, readReceivedCanonicalProdatResponseValidation,
  readReceivedCanonicalProdatApplicationObjects, readReceivedCanonicalProdatSourceFunction} from '@/lib/ediel/core/runtimeDecision'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'
import {buildReceivedSourceValidationEvidence} from '@/lib/ediel/core/receivedSourceValidationEvidence'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {resolveReceivedZ05RejectedIdentityRuntime} from '@/lib/ediel/prodat/receivedZ05RejectedIdentityRuntime'
import {hasReceivedZ05RejectedIdentityRejection} from '@/lib/ediel/prodat/receivedZ05RejectedIdentityRejection'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({source: {} as EdielMessageRow, rows: {} as Record<string, Row[]>,
  legal: {} as Row, catalog: [] as Row[], calls: [] as {name: string; args: Row}[], permission: true,
  sourceError: false, legalError: false, catalogError: false, permissionError: null as unknown, delay: 0, clockReadHook: null as (() => void) | null,
  bornSourceId: '', sourceQueryFilters: [] as {key: string; value: unknown}[],
  writes: [] as {port: string; value: Row}[], validationMode: 'refused' as 'refused' | 'recorded', captureRefused: false, status: null as Row | null,
  actorReadHook: null as (() => void) | null, originalReadHook: null as (() => void) | null}))
const actor = ownerId(50), company = ownerId(2)
function table(name: string) {
  if (!Object.hasOwn(io.rows, name)) throw Error('UNDECLARED_REJECTION_READ:' + name)
  const filters: ((row: Row) => boolean)[] = []
  let columns = '*'
  const read = () => ({data: io.rows[name].filter(row => filters.every(f => f(row))).map(row => columns === '*' ? structuredClone(row)
    : Object.fromEntries(columns.split(',').map(k => [k, row[k]])))[0] ?? null,
    error: name === 'ediel_messages' && io.sourceError ? Error('DECLARED_ORIGINAL_READ_ERROR') : null})
  const q = {select: (c = '*') => {columns = c; return q}, eq: (k: string, v: unknown) => {
    if (name === 'ediel_messages') io.sourceQueryFilters.push({key: k, value: v})
    filters.push(row => row[k] === v); return q},
    not: (k: string, op: string, v: unknown) => {if (op !== 'is') throw Error('UNDECLARED_FILTER'); filters.push(row => row[k] !== v); return q},
    single: async () => {const result = read()
      if (name === 'ediel_messages') {const hook = io.originalReadHook; io.originalReadHook = null; hook?.()}
      return result}, maybeSingle: async () => read(),
    lte: () => q, or: () => q, limit: () => q, abortSignal: () => q,
    update: (value: Row) => {io.writes.push({port: 'table:' + name, value: structuredClone(value)}); if (name !== 'ediel_messages') throw Error('UNEXPECTED_DOMAIN_WRITE:' + name); return q},
    then: (resolve: (value: {data: Row[]; error: null; count: number}) => unknown) => {const data = io.rows[name].filter(row => filters.every(f => f(row))).map(row => structuredClone(row)); return Promise.resolve({data, error: null, count: data.length}).then(resolve)}}
  return q
}
function rpcPort(name: string, args: Row) {
  io.calls.push({name, args: structuredClone(args)})
  if (name === 'ediel_read_prodat_bilateral_source_capability_v1') return {data: null, error: Error('DECLARED_POSITIVE_H_CAPABILITY_UNAVAILABLE')}
  if (name === 'gridex_actor_has_company_permission') {
    const result = {data: io.permission && args.p_actor_user_id === actor
      && args.p_company_id === company && ['communication.read', 'communication.write', 'ediel_testing.write'].includes(String(args.p_permission)), error: io.permissionError}
    const hook = io.actorReadHook; io.actorReadHook = null; hook?.()
    return result
  }
  if (name === 'ediel_require_inbound_legal_context_v1') {
    expect(args).toEqual({p_company_id: company, p_message_id: io.bornSourceId})
    if (io.delay) vi.setSystemTime(new Date(Date.now() + io.delay))
    io.clockReadHook?.()
    return {data: structuredClone(io.legal), error: io.legalError ? Error('DECLARED_LEGAL_READ_ERROR') : null}
  }
  if (name === 'resolve_canonical_ediel_rule_pack_with_witness_v1') return {data: structuredClone(io.catalog), error: io.catalogError ? Error('DECLARED_CATALOG_READ_ERROR') : null}
  if (name === 'ediel_read_technical_source_endpoint_v2') return {data: null, error: null}
  if (name === 'ediel_apply_customer_life_event_source_v1') return {data: {applied: false, reason: 'not_customer_life_event'}, error: null}
  if (name === 'ediel_list_business_acks_for_source_v1') return {data: {version: 1, companyId: company, sourceMessageId: io.source.id, environment: 'test', ackFamily: args.p_ack_family ?? null, messages: []}, error: null}
  if (name === 'gridex_read_outbound_acks_for_source_v2') return {data: {version: 2, executionActorUserId: actor, executionPhase: args.p_phase, sourceMessageId: io.source.id, sourcePayloadHash: evidenceHash(io.source.raw_payload!), companyId: company, environment: 'test', originals: []}, error: null}
  if (name === 'gridex_record_prodat_source_validation_v6') {
    io.writes.push({port: name, value: structuredClone(args)})
    if (io.validationMode === 'refused') return {data: null, error: Error('DECLARED_CANONICAL_WRITE_REFUSED_NO_RECEIPT')}
    const hash = (value: unknown) => value === null ? null : evidenceHash(String(value))
    return {data: {version: 6, companyId: company, environment: 'test', sourceMessageId: io.source.id, sourcePayloadHash: evidenceHash(io.source.raw_payload!),
      factsHash: hash(args.p_facts_text), responseFactsHash: hash(args.p_response_facts_text), objectFactsHash: hash(args.p_object_facts_text),
      sourceFunctionFactsHash: hash(args.p_source_function_facts_text), applicationFactsHash: hash(args.p_application_facts_text), ignoredFieldsHash: hash(args.p_ignored_fields_text),
      sourceDisposition: 'not_established', assessmentId: ownerId(700)}, error: null}
  }
  if (name === 'ediel_probe_source_rule_pack_capture_v1') {
    if (io.captureRefused) return {data: null, error: Error('DECLARED_FRESH_CAPTURE_REFUSED')}
    return {data: {status: 'captured', evidence: {rulePackId: io.source.canonical_rule_pack_id, messageProfileId: io.source.rule_profile_version_id,
      profileKey: io.source.rule_profile_key, version: io.source.rule_profile_version, sourceHash: io.source.rule_pack_checksum, snapshot: io.source.rule_pack_snapshot}}, error: null}
  }
  throw Error('UNDECLARED_REJECTION_RPC:' + name)
}
vi.mock('@/lib/supabase/service', () => ({supabaseService: {from: (name: string) => table(name), rpc: (name: string, args: Row) => {
  const value = rpcPort(name, args), promise = Promise.resolve(value)
  return Object.assign(promise, {abortSignal: () => promise})
}}}))
vi.mock('@/lib/ediel/db', () => ({getEdielMessageById: async (id: string) => id === io.source.id ? structuredClone(io.source) : null,
  updateEdielMessageStatus: async (value: Row) => {io.status = structuredClone(value); return {...structuredClone(io.source), status: value.status, parsed_payload: value.parsedPayload, validation_report: value.validationReport}},
  createEdielMessageEvent: async (value: Row) => {io.writes.push({port: 'event', value: structuredClone(value)}); return {id: 'declared-event'}},
  linkEdielMessage: async () => {throw Error('UNEXPECTED_LINK_WRITE')}, listAckMessagesForSource: async () => [],
  getEdielRouteProfileByCommunicationRouteId: async () => null, listEdielMessagesByIds: async () => [],
}))
vi.mock('@/lib/ediel/core/kernel', () => ({createCanonicalAckMessage: async (value: Row) => {io.writes.push({port: 'ack', value: structuredClone(value)}); throw Error('DECLARED_FIRST_ACK_WRITE_REFUSED')}}))
vi.mock('@/lib/ediel/outbox/createOutboxItem', () => ({createOutboxItem: async () => {throw Error('UNEXPECTED_OUTBOX_WRITE')}}))
vi.mock('@/lib/ediel/actorTestingEngine', () => ({syncActorTestingForMessage: async () => null}))
vi.mock('@/lib/ediel/inboundCases', () => ({createOrUpdateInboundProdatCase: async () => {throw Error('UNEXPECTED_CASE_WRITE')}}))
vi.mock('@/lib/ediel/orchestrator/edielProcessingPipeline', () => ({analyzeEdielProcessingPipeline: async () => null}))
function object(n = '1', identity = '', li = 'OWN-' + n): Parts[] {
  return [line(n, identity, undefined, '9'), ['DTM', ['93', '202610161330', '203']], ...characteristic('Z13', 'Z25'),
    ['RFF', ['Z05', 'NET']], ['RFF', ['LI', li]], ['NAD', 'UD', ['199001011234', 'SE2', '260']],
    ['NAD', 'IT', ['735999000000000001', '', '9']]]
}
function setup(body = object()) {
  const wire = tokenizeEdifact(guideOrderedFixtureRaw([...head(), ...body], 'Z05'))
  const raw = EdifactEnvelopeCodec.encode({sender: '12345', receiver: '54321', senderQualifier: '14', receiverQualifier: '14',
    interchangeReference: 'I', applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true, environment: 'test',
    createdAt: new Date('2026-09-17T10:00:00Z'), timeZone: 'Europe/Stockholm', messages: [{messageReference: 'M',
      messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments: wire.segments.filter(s => !['UNB', 'UNH', 'UNT', 'UNZ'].includes(s.tag)).map(s => s.raw)}]})
  const original = ownerRulePack(), profileKey = 'PRODAT:Z05:H:26.A:r3'
  const profile = {...original.profile, messageCode: 'Z05', transactionSubtype: 'H', reasonForTransaction: 'Z25'}
  const snapshot = {...original.original_snapshot, messageProfile: {...original.original_snapshot.messageProfile, profile_key: profileKey, profile}}
  io.source = withProdatFixtureInsertContext({...source(raw, 'Z05'), message_version: 'E2SE6A', message_created_at: null,
    customer_id: null, site_id: null, metering_point_id: null, canonical_rule_pack_id: original.rule_pack_id, rule_profile_key: profileKey,
    rule_profile_version_id: original.message_profile_id, rule_profile_version: original.original_version, rule_pack_checksum: original.source_hash,
    rule_pack_snapshot: {...snapshot, profileKey, profileVersionId: original.message_profile_id, version: original.original_version, checksum: original.source_hash}})
  io.rows = ownerRows(); for (const name of ['ediel_actor_settings', 'ediel_route_profiles', 'communication_routes']) io.rows[name] = []; io.rows.ediel_messages = [structuredClone(io.source) as unknown as Row]
  io.catalog = [{...original, profile_key: profileKey, profile, original_snapshot: snapshot}]
  io.legal = {basisKind: 'observed_source_persistence', companyId: company, environment: 'test', direction: 'inbound', family: 'PRODAT',
    code: 'Z05', subtype: 'H', legalActorId: ownerId(9), legalEdielId: '54321', actorRole: 'electricity_supplier', transportActorId: ownerId(9),
    transportEdielId: '54321', applicationReference: '23-DDQ-PRODAT', sourceEdition: 'c'.repeat(64), sourceReceivedAt: io.source.message_received_at,
    observedAt: io.source.message_received_at, canonicalProjection: {family: 'PRODAT', code: 'Z05', subtype: 'H', transactionReasonCode: 'Z25',
      direction: 'inbound', receiverRoles: ['supplier'], applicationReferences: ['23-DDQ-PRODAT']}}
  io.calls = []; io.permission = true; io.writes = []; io.validationMode = 'refused'; io.captureRefused = false; io.status = null
  io.bornSourceId = io.source.id; io.sourceQueryFilters = []; io.actorReadHook = null; io.originalReadHook = null
  io.sourceError = false; io.legalError = false; io.catalogError = false; io.permissionError = null; io.delay = 0; io.clockReadHook = null
  expect(validateEdifactSyntax(io.source).ok).toBe(true)
}
beforeEach(() => {vi.useFakeTimers({toFake: ['Date']}); vi.setSystemTime(new Date('2026-10-07T22:30:00Z')); setup()})
afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers()})


const response = (decision: Awaited<ReturnType<typeof resolveCanonicalRuntimeDecisionWithRegistry>>) =>
  readReceivedCanonicalProdatResponseValidation(decision, io.source)

it.each(['invalid', 'absent', 'two', 'mixed'] as const)('actual runtime owns only physical209 negative %s scopes without positive H capability', async kind => {
  const body = kind === 'two' ? [...object(), ...object('2')] : kind === 'mixed' ? [...object('1', '735123456789012345'), ...object('2')] : object()
  if (kind === 'absent') body[0] = ['LIN', '1']
  setup(body)
  const before = structuredClone({source: io.source, rows: io.rows})
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(io.source, {actorUserId: actor})
  expect(decision).toMatchObject({policy: null, syntaxDecision: 'accepted', applicationDecision: 'rejected', functionalDecision: 'not_applicable', utiltsBusinessOutcome: null})
  const facet = response(decision)
  expect(facet?.responses.map(r => [r.ercCode, r.fieldCode, r.id, r.li])).toEqual(kind === 'two'
    ? [['42', '209', null, 'OWN-1'], ['42', '209', null, 'OWN-2']]
    : [[kind === 'absent' ? '41' : '42', '209', null, kind === 'mixed' ? 'OWN-2' : 'OWN-1']])
  if (kind === 'mixed') expect(facet?.objects.map(o => o.outcome)).toEqual(['held', 'negative'])
  expect(hasReceivedZ05RejectedIdentityRejection(decision, io.source, actor)).toBe(true)
  expect(readReceivedCanonicalProdatApplicationObjects(decision, io.source)).toBeNull()
  expect(readReceivedCanonicalProdatSourceFunction(decision, io.source)).toBeNull()
  expect(decision.responsePlan.some(p => p.family === 'APERAK' && p.outcome === 'positive')).toBe(false)
  const evidence = buildReceivedSourceValidationEvidence({original: io.source, validated: io.source, resolvedCompanyId: company, decision})
  expect(evidence?.prodatResponseValidation).toEqual(facet)
  expect(evidence?.prodatObjectValidation).toBeUndefined()
  expect(evidence?.prodatApplicationValidation).toBeUndefined()
  expect(evidence?.prodatSourceFunctionValidation).toBeUndefined()
  expect({source: io.source, rows: io.rows}).toEqual(before)
})

it('actorless rejection observation cannot grant a response or business owner', async () => {
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(io.source)
  expect(decision.policy).toBeNull()
  expect(decision.applicationDecision).not.toBe('accepted')
  expect(response(decision)).toBeNull()
  expect(hasReceivedZ05RejectedIdentityRejection(decision, io.source)).toBe(false)
})

it.each(['foreign', 'permission', 'membership', '42501'] as const)('current %s actor denial cannot be swallowed into a rejection ACK', async kind => {
  if (kind === 'permission') io.permission = false
  if (kind === 'membership') io.rows.company_memberships = []
  if (kind === '42501') io.permissionError = {code: '42501', message: 'DECLARED_ACTOR_SQL_DENIAL'}
  await expect(resolveCanonicalRuntimeDecisionWithRegistry(io.source, {actorUserId: kind === 'foreign' ? ownerId(999) : actor})).rejects.toBeInstanceOf(EdielExecutionFailure)
})

it.each(['stored-raw', 'legal-role', 'expired-read', 'catalog-error'] as const)('unqualified %s cannot gain a response from a physical defect', async kind => {
  if (kind === 'stored-raw') io.rows.ediel_messages[0].raw_payload = io.source.raw_payload!.replace('OWN-1', 'FOREIGN')
  if (kind === 'legal-role') io.legal.actorRole = 'grid_owner'
  if (kind === 'expired-read') io.delay = 2001
  if (kind === 'catalog-error') io.catalogError = true
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(io.source, {actorUserId: actor})
  expect(response(decision)).toBeNull()
  expect(hasReceivedZ05RejectedIdentityRejection(decision, io.source, actor)).toBe(false)
})

it('serialized decisions and changed original rows cannot redeem the runtime response owner', async () => {
  const decision = await resolveCanonicalRuntimeDecisionWithRegistry(io.source, {actorUserId: actor})
  expect(response(decision)).not.toBeNull()
  expect(readReceivedCanonicalProdatResponseValidation(structuredClone(decision), io.source)).toBeNull()
  expect(readReceivedCanonicalProdatResponseValidation(decision, {...io.source, raw_payload: io.source.raw_payload! + ' '})).toBeNull()
  decision.responsePlan = []
  expect(response(decision)).toBeNull()
  expect(hasReceivedZ05RejectedIdentityRejection(decision, io.source, actor)).toBe(false)
})

it.each(['invalid', 'absent'] as const)('independent helper supplies a private %s rejection facet without impersonating runtime ownership', async kind => {
  const body = object()
  if (kind === 'absent') body[0] = ['LIN', '1']
  setup(body)
  const base = resolveCanonicalRuntimeDecision(io.source)
  const originalBase = structuredClone(base)
  const result = await resolveReceivedZ05RejectedIdentityRuntime(io.source, base, actor)
  expect(result).not.toBeNull()
  expect(result?.facet.responses).toEqual([expect.objectContaining({scope: 'object', ercCode: kind === 'absent' ? '41' : '42', fieldCode: '209', id: null, li: 'OWN-1'})])
  expect(result?.decision).toMatchObject({policy: null, applicationDecision: 'rejected', functionalDecision: 'not_applicable'})
  expect(hasReceivedZ05RejectedIdentityRejection(result!.decision, io.source, actor)).toBe(true)
  expect(readReceivedCanonicalProdatResponseValidation(result!.decision, io.source)).toBeNull()
  expect(base).toEqual(originalBase)
})

it.each(['refused', 'capture-refused', 'ready'] as const)('public ingress %s enforces evidence/capture before the same private negative ACK', async mode => {
  io.validationMode = mode === 'refused' ? 'refused' : 'recorded'
  io.captureRefused = mode === 'capture-refused'
  const before = structuredClone({source: io.source, rows: io.rows})
  const error = await processInboundEdielMessage({actorUserId: actor, edielMessageId: io.source.id}).catch(error => error)
  expect(error?.message).toBe(mode === 'refused' ? 'prodat_canonical_source_validation_unconfirmed'
    : mode === 'capture-refused' ? 'ediel_source_rule_pack_basis_required' : 'DECLARED_FIRST_ACK_WRITE_REFUSED')
  const records = io.writes.filter(write => write.port === 'gridex_record_prodat_source_validation_v6')
  expect(records).toHaveLength(1)
  expect(JSON.parse(String(records[0].value.p_facts_text))).toMatchObject({applicationDecision: 'rejected', functionalDecision: 'not_applicable'})
  expect(JSON.parse(String(records[0].value.p_response_facts_text)).responses).toEqual([expect.objectContaining({fieldCode: '209', ercCode: '42', li: 'OWN-1', id: null})])
  expect(records[0].value.p_object_facts_text).toBeNull()
  expect(records[0].value.p_application_facts_text).toBeNull()
  expect(records[0].value.p_source_function_facts_text).toBeNull()
  const acks = io.writes.filter(write => write.port === 'ack')
  expect(acks).toHaveLength(mode === 'ready' ? 1 : 0)
  if (mode === 'ready') expect(acks[0].value).toMatchObject({ackFamily: 'APERAK', outcome: 'negative'})
  else expect(io.status).toBeNull()
  expect(io.writes.some(write => write.port.startsWith('table:') && write.port !== 'table:ediel_messages')).toBe(false)
  expect({source: io.source, rows: io.rows}).toEqual(before)
})
