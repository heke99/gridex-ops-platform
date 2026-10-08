// Private rejection-basis/physical projection prerequisite only. Actor, stored
// original, immutable legal receipt and catalog READs below are declared finite
// IO. No genuine SQL capture, runtime owner, public ACK, send or whole proof.
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {ownerId, ownerRows, ownerRulePack} from './helpers/sourceOwnerFixtures'
import {withProdatFixtureInsertContext} from './helpers/prodatInboundSourceFixture'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {head, source} from './fixtures/prodat-identity'
import {line, characteristic, type Parts} from './fixtures/prodat-register'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {resolveCanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {projectProdatDiagnostics} from '@/lib/ediel/prodat/prodatDiagnosticProjection'
import {evidenceHash} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {buildReceivedProdatResponseValidation} from '@/lib/ediel/core/receivedProdatResponseValidation'
import {loadReceivedZ05RejectedIdentityRejection, observeReceivedZ05RejectedIdentity,
  validateReceivedZ05RejectedIdentityStructure, readReceivedZ05RejectedIdentityWitness,
  ownReceivedZ05RejectedIdentityRejection, hasReceivedZ05RejectedIdentityRejection} from '@/lib/ediel/prodat/receivedZ05RejectedIdentityRejection'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({source: {} as EdielMessageRow, rows: {} as Record<string, Row[]>,
  legal: {} as Row, catalog: [] as Row[], calls: [] as {name: string; args: Row}[], permission: true,
  sourceError: false, legalError: false, catalogError: false, permissionError: null as unknown, delay: 0, clockReadHook: null as (() => void) | null,
  bornSourceId: '', sourceQueryFilters: [] as {key: string; value: unknown}[],
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
      return result}, maybeSingle: async () => read()}
  return q
}
vi.mock('@/lib/supabase/service', () => ({supabaseService: {from: (name: string) => table(name), rpc: async (name: string, args: Row) => {
  io.calls.push({name, args: structuredClone(args)})
  if (name === 'gridex_actor_has_company_permission') {
    const result = {data: io.permission && args.p_actor_user_id === actor
      && args.p_company_id === company && args.p_permission === 'communication.read', error: io.permissionError}
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
  throw Error('UNDECLARED_REJECTION_RPC:' + name)
}}}))
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
  io.rows = ownerRows(); io.rows.ediel_messages = [structuredClone(io.source) as unknown as Row]
  io.catalog = [{...original, profile_key: profileKey, profile, original_snapshot: snapshot}]
  io.legal = {basisKind: 'observed_source_persistence', companyId: company, environment: 'test', direction: 'inbound', family: 'PRODAT',
    code: 'Z05', subtype: 'H', legalActorId: ownerId(9), legalEdielId: '54321', actorRole: 'electricity_supplier', transportActorId: ownerId(9),
    transportEdielId: '54321', applicationReference: '23-DDQ-PRODAT', sourceEdition: 'c'.repeat(64), sourceReceivedAt: io.source.message_received_at,
    observedAt: io.source.message_received_at, canonicalProjection: {family: 'PRODAT', code: 'Z05', subtype: 'H', transactionReasonCode: 'Z25',
      direction: 'inbound', receiverRoles: ['supplier'], applicationReferences: ['23-DDQ-PRODAT']}}
  io.calls = []; io.permission = true
  io.bornSourceId = io.source.id; io.sourceQueryFilters = []; io.actorReadHook = null; io.originalReadHook = null
  io.sourceError = false; io.legalError = false; io.catalogError = false; io.permissionError = null; io.delay = 0; io.clockReadHook = null
  expect(validateEdifactSyntax(io.source).ok).toBe(true)
}
const input = () => {const wire = tokenizeEdifact(io.source.raw_payload!); return {rawSegments: wire.segments.map(s => s.raw), una: wire.una}}
const registryCalls = () => io.calls.filter(c => c.name === 'resolve_canonical_ediel_rule_pack_with_witness_v1')
beforeEach(() => {vi.useFakeTimers({toFake: ['Date']}); vi.setSystemTime(new Date('2026-10-07T22:30:00Z')); setup()})
afterEach(() => {vi.restoreAllMocks(); vi.useRealTimers()})

it.each([
  ['actor', 'id'], ['actor', 'company_id'], ['original-read', 'id'], ['original-read', 'company_id'],
] as const)('caller %s-stage %s mutation cannot redirect an authorized original READ', async (stage, field) => {
  const original = structuredClone(io.source)
  const mutate = () => {io.source[field] = ownerId(999)}
  if (stage === 'actor') io.actorReadHook = mutate
  else io.originalReadHook = mutate
  const token = await loadReceivedZ05RejectedIdentityRejection(io.source, actor)
  expect(io.source[field]).toBe(ownerId(999))
  expect(io.calls.filter(c => c.name === 'gridex_actor_has_company_permission')).toHaveLength(1)
  expect(io.calls.find(c => c.name === 'gridex_actor_has_company_permission')?.args).toMatchObject({p_company_id: original.company_id})
  expect(io.sourceQueryFilters).toEqual([{key: 'id', value: original.id}, {key: 'company_id', value: original.company_id}])
  expect(io.calls.filter(c => c.name === 'ediel_require_inbound_legal_context_v1').map(c => c.args))
    .toEqual([{p_company_id: original.company_id, p_message_id: original.id}])
  if (token) {
    expect(readReceivedZ05RejectedIdentityWitness(token, io.source, actor)).toBeNull()
    expect(readReceivedZ05RejectedIdentityWitness(token, original, actor)).not.toBeNull()
  }
})

it.each(['invalid', 'absent'])('observes actual own %s field209 without borrowing NAD identity', kind => {
  const body = object(); if (kind === 'absent') body[0] = ['LIN', '1']; setup(body)
  expect(projectProdatDiagnostics(observeReceivedZ05RejectedIdentity(input())).applicationErrors).toMatchObject([
    {fieldCode: '209', ercCode: kind === 'invalid' ? '42' : '41', referenceNumber: null, lineItemReference: 'OWN-1'}])
  expect(io.calls).toEqual([])
})
it.each(['invalid', 'absent'])('fresh private READ owns only the %s born original and catalog witness', async kind => {
  const body = object(); if (kind === 'absent') body[0] = ['LIN', '1']; setup(body)
  const token = await loadReceivedZ05RejectedIdentityRejection(io.source, actor)
  expect(token).not.toBeNull(); if (!token) return
  const witness = readReceivedZ05RejectedIdentityWitness(token, io.source, actor)
  expect(witness).toMatchObject({profileKey: io.source.rule_profile_key, sourceHash: io.source.rule_pack_checksum})
  expect(registryCalls()).toHaveLength(1)
  expect(registryCalls()[0].args).toMatchObject({p_family: 'PRODAT', p_message_code: 'Z05', p_transaction_subtype: 'H', p_direction: 'inbound'})
  expect(readReceivedZ05RejectedIdentityWitness({...token}, io.source, actor)).toBeNull()
  expect(readReceivedZ05RejectedIdentityWitness(token, io.source, ownerId(999))).toBeNull()
})
it.each(['invalid', 'absent', 'two', 'mixed'])('genuine private component projects only own negative %s identities', async kind => {
  const body = kind === 'two' ? [...object(), ...object('2')] : kind === 'mixed' ? [...object('1', '735123456789012345'), ...object('2')] : object()
  if (kind === 'absent') body[0] = ['LIN', '1']; setup(body)
  const token = await loadReceivedZ05RejectedIdentityRejection(io.source, actor)
  expect(token).not.toBeNull(); if (!token) return
  const witness = readReceivedZ05RejectedIdentityWitness(token, io.source, actor)
  const structural = validateReceivedZ05RejectedIdentityStructure(input())
  expect(structural).not.toBeNull(); if (!structural) return
  const errors = projectProdatDiagnostics(observeReceivedZ05RejectedIdentity(input())).applicationErrors
  // Declared rejected decision assembly exercises the private API and actual
  // renderer. It never impersonates the unavailable runtime WeakMap owner.
  const base = resolveCanonicalRuntimeDecision(io.source), plan = {family: 'APERAK' as const, outcome: 'negative' as const,
    reason: 'Own field209 rejection', applicationErrors: errors}
  const decision: CanonicalRuntimeDecision = {...base, policy: null, applicationDecision: 'rejected', functionalDecision: 'not_applicable',
    prodatRegisterValidation: structural.evidence, responsePlan: [plan], validationReport: {...base.validationReport, rulePackEvidence: witness, syntaxDecision: 'accepted', applicationDecision: 'rejected', functionalDecision: 'not_applicable'}}
  decision.validationReport.responsePlan = decision.responsePlan
  expect(buildReceivedProdatResponseValidation(io.source, decision)).toBeNull()
  expect(ownReceivedZ05RejectedIdentityRejection(decision, io.source, actor, token)).toBe(true)
  expect(hasReceivedZ05RejectedIdentityRejection(decision, io.source, actor)).toBe(true)
  const facet = buildReceivedProdatResponseValidation(io.source, decision)
  expect(facet).not.toBeNull()
  expect(facet?.responses.map(r => [r.ercCode, r.fieldCode, r.id, r.li])).toEqual(kind === 'two'
    ? [['42', '209', null, 'OWN-1'], ['42', '209', null, 'OWN-2']]
    : [[kind === 'absent' ? '41' : '42', '209', null, kind === 'mixed' ? 'OWN-2' : 'OWN-1']])
  if (kind === 'mixed') expect(facet?.objects.map(o => o.outcome)).toEqual(['held', 'negative'])
  expect(hasReceivedZ05RejectedIdentityRejection(structuredClone(decision), io.source, actor)).toBe(false)
  expect(ownReceivedZ05RejectedIdentityRejection(decision, io.source, actor, token)).toBe(false)
  decision.issues.push({...base.issues[0], code: 'MUTATED'})
  expect(hasReceivedZ05RejectedIdentityRejection(decision, io.source, actor)).toBe(false)
})
it.each(['healthy', 'L', 'bad314', 'duplicateLI', 'missingLI'])('unqualified %s cannot perform private source IO', async kind => {
  const body = kind === 'healthy' ? object('1', '735123456789012345') : kind === 'duplicateLI' ? [...object(), ...object('2', '', 'OWN-1')]
    : kind === 'bad314' ? object('2') : kind === 'missingLI' ? object().filter(p => !(p[0] === 'RFF' && (p[1] as string[])[0] === 'LI')) : object()
  if (kind === 'L') body[body.findIndex(p => p[0] === 'CAV')] = ['CAV', ['Z22']]
  setup(body)
  expect(await loadReceivedZ05RejectedIdentityRejection(io.source, actor)).toBeNull()
  expect(io.calls).toEqual([])
})

it.each(['actorless', 'foreign', 'permission', 'membership', '42501'])('current %s actor cannot grant a rejected source witness', async kind => {
  if (kind === 'permission') io.permission = false
  if (kind === 'membership') io.rows.company_memberships = []
  if (kind === '42501') io.permissionError = {code: '42501', message: 'DECLARED_ACTOR_SQL_DENIAL'}
  const run = loadReceivedZ05RejectedIdentityRejection(io.source, kind === 'actorless' ? '' : kind === 'foreign' ? ownerId(999) : actor)
  if (kind === 'actorless') expect(await run).toBeNull()
  else await expect(run).rejects.toBeInstanceOf(EdielExecutionFailure)
  expect(registryCalls()).toEqual([])
  expect(io.calls.filter(c => c.name === 'ediel_require_inbound_legal_context_v1')).toEqual([])
})
it.each(['hash', 'company', 'environment', 'receipt', 'created', 'extra-context', 'source-error', 'stored-raw', 'stored-snapshot'])('unqualified %s birth cannot produce a private witness', async kind => {
  const context = (io.source.execution_context_snapshot as Row).receivedProdatContext as Row
  if (kind === 'hash') context.payloadHash = 'f'.repeat(64)
  if (kind === 'company') context.companyId = ownerId(999)
  if (kind === 'environment') context.environment = 'production'
  if (kind === 'receipt') io.source.message_received_at = null
  if (kind === 'created') io.source.created_at = 'invalid'
  if (kind === 'extra-context') context.approved = true
  if (kind === 'source-error') io.sourceError = true
  if (kind === 'stored-raw') io.rows.ediel_messages[0].raw_payload = io.source.raw_payload!.replace('OWN-1', 'FOREIGN')
  if (kind === 'stored-snapshot') io.rows.ediel_messages[0].rule_pack_snapshot = {}
  expect(await loadReceivedZ05RejectedIdentityRejection(io.source, actor)).toBeNull()
  expect(registryCalls()).toEqual([])
})
it.each(['legal-error', 'company', 'environment', 'direction', 'family', 'code', 'subtype', 'role', 'receiver', 'transport', 'clock', 'edition', 'reason', 'catalog-empty', 'catalog-ambiguous', 'catalog-error', 'catalog-foreign', 'catalog-incomplete', 'expired-read', 'backward-read'])('private %s refusal cannot supply a witness or effect', async kind => {
  if (kind === 'legal-error') io.legalError = true
  if (kind === 'company') io.legal.companyId = ownerId(999)
  if (kind === 'environment') io.legal.environment = 'production'
  if (kind === 'direction') io.legal.direction = 'outbound'
  if (kind === 'family') io.legal.family = 'UTILTS'
  if (kind === 'code') io.legal.code = 'Z04'
  if (kind === 'subtype') io.legal.subtype = 'L'
  if (kind === 'role') io.legal.actorRole = 'grid_owner'
  if (kind === 'receiver') io.legal.legalEdielId = 'FOREIGN'
  if (kind === 'transport') io.legal.transportEdielId = 'FOREIGN'
  if (kind === 'clock') io.legal.sourceReceivedAt = '2026-09-19T00:00:00Z'
  if (kind === 'edition') io.legal.sourceEdition = 'invalid'
  if (kind === 'reason') (io.legal.canonicalProjection as Row).transactionReasonCode = 'Z22'
  if (kind === 'catalog-empty') io.catalog = []
  if (kind === 'catalog-ambiguous') io.catalog.push(structuredClone(io.catalog[0]))
  if (kind === 'catalog-error') io.catalogError = true
  if (kind === 'catalog-foreign') io.catalog[0].source_hash = 'f'.repeat(64)
  if (kind === 'catalog-incomplete') io.catalog[0].validator_ready = false
  if (kind === 'expired-read') io.delay = 2001
  if (kind === 'backward-read') io.delay = -1
  const before = structuredClone(io.rows)
  expect(await loadReceivedZ05RejectedIdentityRejection(io.source, actor)).toBeNull()
  expect(io.rows).toEqual(before)
})
async function prepared() {
  const token = await loadReceivedZ05RejectedIdentityRejection(io.source, actor)
  expect(token).not.toBeNull(); if (!token) throw Error('ASSERTION_ALREADY_FAILED')
  const witness = readReceivedZ05RejectedIdentityWitness(token, io.source, actor)
  const structural = validateReceivedZ05RejectedIdentityStructure(input())
  expect(structural).not.toBeNull(); if (!structural) throw Error('ASSERTION_ALREADY_FAILED')
  const base = resolveCanonicalRuntimeDecision(io.source)
  const decision: CanonicalRuntimeDecision = {...base, policy: null, applicationDecision: 'rejected', functionalDecision: 'not_applicable',
    prodatRegisterValidation: structural.evidence, responsePlan: [{family: 'APERAK' as const, outcome: 'negative' as const,
      reason: 'Own field209 rejection', applicationErrors: projectProdatDiagnostics(observeReceivedZ05RejectedIdentity(input())).applicationErrors}],
    validationReport: {...base.validationReport, rulePackEvidence: witness, syntaxDecision: 'accepted', applicationDecision: 'rejected', functionalDecision: 'not_applicable'}}
  decision.validationReport.responsePlan = decision.responsePlan
  return {token, decision}
}
it.each(['accepted', 'functional', 'syntax', 'positive', 'borrowedLI', 'fakeZ07', 'changed-witness', 'copied-structure', 'changed-structure', 'foreign-structure', 'foreign-source', 'foreign-actor', 'expired-token', 'backward-token'])('redemption refuses %s and consumes its private READ', async kind => {
  const {token, decision} = await prepared()
  if (kind === 'accepted') decision.applicationDecision = 'accepted'
  if (kind === 'functional') decision.functionalDecision = 'accepted'
  if (kind === 'syntax') decision.syntaxDecision = 'rejected'
  if (kind === 'positive') decision.responsePlan[0].outcome = 'positive'
  if (kind === 'borrowedLI') decision.responsePlan[0].applicationErrors![0].lineItemReference = 'FOREIGN'
  if (kind === 'fakeZ07') decision.responsePlan[0].applicationErrors![0].referenceNumber = '735123456789012345'
  if (kind === 'changed-witness') decision.validationReport.rulePackEvidence = {}
  if (kind === 'copied-structure') decision.prodatRegisterValidation = structuredClone(decision.prodatRegisterValidation)
  if (kind === 'changed-structure') decision.prodatRegisterValidation!.objects[0].disposition = 'accepted'
  if (kind === 'foreign-structure') decision.prodatRegisterValidation = validateReceivedZ05RejectedIdentityStructure({
    ...input(), rawSegments: input().rawSegments.map(s => s.replace('OWN-1', 'FOREIGN'))})!.evidence
  if (kind === 'expired-token') vi.setSystemTime(new Date(Date.now() + 2001))
  if (kind === 'backward-token') vi.setSystemTime(new Date(Date.now() - 1))
  expect(ownReceivedZ05RejectedIdentityRejection(decision, kind === 'foreign-source' ? {...io.source, id: ownerId(999)} : io.source,
    kind === 'foreign-actor' ? ownerId(999) : actor, token)).toBe(false)
  expect(readReceivedZ05RejectedIdentityWitness(token, io.source, actor)).toBeNull()
  expect(hasReceivedZ05RejectedIdentityRejection(decision, io.source, actor)).toBe(false)
  expect(buildReceivedProdatResponseValidation(io.source, decision)).toBeNull()
})
it('compares the retained receipt in Stockholm, without a cached subtype or current clock fallback', async () => {
  const received = '2026-09-20T22:30:00Z'
  io.source.message_received_at = received
  const context = (io.source.execution_context_snapshot as Row).receivedProdatContext as Row
  context.sourceReceivedAt = received; context.payloadHash = evidenceHash(io.source.raw_payload!)
  io.legal.sourceReceivedAt = received; io.rows.ediel_messages = [structuredClone(io.source) as unknown as Row]
  io.source.parsed_payload = {subtype: 'L', accepted: true}
  const token = await loadReceivedZ05RejectedIdentityRejection(io.source, actor)
  expect(token).not.toBeNull()
  expect(registryCalls()[0].args.p_business_date).toBe('2026-09-21')
})

it.each(['report-accepted', 'report-functional', 'report-syntax', 'report-policy', 'report-positive-plan'])('rejected owner refuses a contradictory %s report', async kind => {
  const {token, decision} = await prepared()
  if (kind === 'report-accepted') decision.validationReport.applicationDecision = 'accepted'
  if (kind === 'report-functional') decision.validationReport.functionalDecision = 'accepted'
  if (kind === 'report-syntax') decision.validationReport.syntaxDecision = 'rejected'
  if (kind === 'report-policy') decision.validationReport.canonicalPolicy = {family: 'PRODAT', businessEffect: 'apply'}
  if (kind === 'report-positive-plan') decision.validationReport.responsePlan = [{family: 'APERAK', outcome: 'positive'}]
  expect(ownReceivedZ05RejectedIdentityRejection(decision, io.source, actor, token)).toBe(false)
  expect(hasReceivedZ05RejectedIdentityRejection(decision, io.source, actor)).toBe(false)
  expect(buildReceivedProdatResponseValidation(io.source, decision)).toBeNull()
})

// The monotonic clock port is deliberately controlled; all real source/owner
// methods execute. Fixed wall time must not renew a stale private READ/structure.
it.each([2001, -1])('refuses a private READ with monotonic elapsed %s while wall time stays fixed', async elapsed => {
  const monotonic = vi.spyOn(performance, 'now').mockReturnValue(10_000), wall = Date.now()
  expect(performance.now()).toBe(10_000)
  io.clockReadHook = () => {monotonic.mockReturnValue(10_000 + elapsed)}
  expect(await loadReceivedZ05RejectedIdentityRejection(io.source, actor)).toBeNull()
  expect(Date.now()).toBe(wall)
})
it.each(['witness', 'redemption', 'structure'])('refuses monotonic-expired %s without a wall-clock advance', async stage => {
  const monotonic = vi.spyOn(performance, 'now').mockReturnValue(10_000), wall = Date.now()
  const {token, decision} = await prepared()
  monotonic.mockReturnValue(12_001)
  if (stage === 'witness') expect(readReceivedZ05RejectedIdentityWitness(token, io.source, actor)).toBeNull()
  else {
    // A newly qualified READ remains fresh; only the earlier genuine structure
    // is expired. A refreshed token cannot renew that structural invocation.
    const selected = stage === 'structure' ? await loadReceivedZ05RejectedIdentityRejection(io.source, actor) : token
    expect(selected).not.toBeNull(); if (!selected) return
    expect(ownReceivedZ05RejectedIdentityRejection(decision, io.source, actor, selected)).toBe(false)
    expect(hasReceivedZ05RejectedIdentityRejection(decision, io.source, actor)).toBe(false)
    expect(buildReceivedProdatResponseValidation(io.source, decision)).toBeNull()
  }
  expect(Date.now()).toBe(wall)
})
it('retains the exact two-second monotonic boundary when the wall clock stays valid', async () => {
  const monotonic = vi.spyOn(performance, 'now').mockReturnValue(10_000)
  const {token, decision} = await prepared()
  monotonic.mockReturnValue(12_000)
  expect(readReceivedZ05RejectedIdentityWitness(token, io.source, actor)).not.toBeNull()
  expect(ownReceivedZ05RejectedIdentityRejection(decision, io.source, actor, token)).toBe(true)
})

// Caller-only accessors are in-process API inputs, never native/SQL fixtures.
// setup already retained a separate plain born original before this mutation.
function unusedCallerGetter() {
  let reads = 0
  Object.defineProperty(io.source, 'parsed_payload', {enumerable: true, get() {
    reads++; throw Error('UNUSED_H209_CALLER_PROPERTY_READ')
  }})
  return () => reads
}
it.each(['permission', '42501'] as const)('unused caller getter preserves actual %s quarantine before original READ', async kind => {
  const stored = structuredClone(io.rows), original = structuredClone(io.source)
  const denial = {code: '42501', message: 'DECLARED_ACTOR_SQL_DENIAL'}
  if (kind === 'permission') io.permission = false
  else io.permissionError = denial
  const getterReads = unusedCallerGetter()
  const outcome = await loadReceivedZ05RejectedIdentityRejection(io.source, actor)
    .then(value => ({value, error: null}), (error: unknown) => ({value: null, error}))
  expect(outcome.error).toBeInstanceOf(EdielExecutionFailure)
  expect(outcome.error).toMatchObject({disposition: {kind: 'security_quarantine',
    code: kind === 'permission' ? 'EDIEL_TENANT_PERMISSION_FORBIDDEN' : 'EDIEL_TENANT_ACTOR_FORBIDDEN'}})
  if (kind === '42501') expect(Object.getOwnPropertyDescriptor(outcome.error, 'cause')?.value).toBe(denial)
  expect(outcome.value).toBeNull()
  expect(getterReads()).toBe(0)
  expect(io.calls).toEqual([{name: 'gridex_actor_has_company_permission', args: {
    p_actor_user_id: actor, p_company_id: original.company_id, p_permission: 'communication.read'}}])
  expect(io.sourceQueryFilters).toEqual([])
  expect(io.rows).toEqual(stored)
})
it('unused caller getter leaves the lawful original READ and private witness intact', async () => {
  const original = structuredClone(io.source), stored = structuredClone(io.rows)
  const getterReads = unusedCallerGetter()
  const token = await loadReceivedZ05RejectedIdentityRejection(io.source, actor)
  expect(token).not.toBeNull()
  expect(getterReads()).toBe(0)
  expect(io.calls.filter(c => c.name === 'gridex_actor_has_company_permission')).toEqual([
    {name: 'gridex_actor_has_company_permission', args: {
      p_actor_user_id: actor, p_company_id: original.company_id, p_permission: 'communication.read'}}])
  expect(io.sourceQueryFilters).toEqual([{key: 'id', value: original.id}, {key: 'company_id', value: original.company_id}])
  expect(io.calls.filter(c => c.name === 'ediel_require_inbound_legal_context_v1').map(c => c.args))
    .toEqual([{p_company_id: original.company_id, p_message_id: original.id}])
  expect(registryCalls()).toHaveLength(1)
  expect(io.rows).toEqual(stored)
  if (!token) throw Error('EXPECTED_ACTUAL_PRIVATE_H209_READ')
  expect(readReceivedZ05RejectedIdentityWitness(token, original, actor)).toMatchObject({
    profileKey: original.rule_profile_key, sourceHash: original.rule_pack_checksum})
})
it.each(['actorless', 'healthy', 'invalid-birth', 'invalid-syntax', 'L'] as const)('unused caller getter cannot admit %s to private IO', async kind => {
  if (kind === 'healthy') setup(object('1', '735123456789012345'))
  if (kind === 'L') {
    const body = object(); body[body.findIndex(p => p[0] === 'CAV')] = ['CAV', ['Z22']]; setup(body)
  }
  const context = (io.source.execution_context_snapshot as Row).receivedProdatContext as Row
  if (kind === 'invalid-birth') context.payloadHash = 'f'.repeat(64)
  if (kind === 'invalid-syntax') {
    io.source.raw_payload = io.source.raw_payload!.replace(/UNT\+\d+\+/, 'UNT+999+')
    context.payloadHash = evidenceHash(io.source.raw_payload)
    expect(validateEdifactSyntax(io.source).ok).toBe(false)
  }
  if (kind === 'healthy' || kind === 'L') expect(observeReceivedZ05RejectedIdentity(input())).toEqual([])
  const stored = structuredClone(io.rows), getterReads = unusedCallerGetter()
  expect(await loadReceivedZ05RejectedIdentityRejection(io.source, kind === 'actorless' ? '' : actor)).toBeNull()
  expect(getterReads()).toBe(0)
  expect(io.calls).toEqual([])
  expect(io.sourceQueryFilters).toEqual([])
  expect(io.rows).toEqual(stored)
})
