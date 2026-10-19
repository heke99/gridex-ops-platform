// Test observation only. No authority is minted, no owner is called at import,
// and no original business assertion is replaced by these late-cause checks.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { isDeepStrictEqual } from 'node:util'
import { expect, vi } from 'vitest'
import * as supplyMarketTransition from '@/lib/ediel/flows/supplyMarketTransition'
import { bindReceivedRegisterValidation } from '@/lib/ediel/core/receivedRegisterValidationBinding'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { parseSourceReceiptInstant } from '@/lib/ediel/utilts/receivedSourceInventory'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { literal, type NormalSwitchStageNativeFixture } from './ediel-normal-switch-native-fixture'

export type SupplyObservationFixture = NormalSwitchStageNativeFixture & {
  variant: 'L' | 'LK'; original: EdielMessageRow; li: string
}
export type OriginalNegativeContrast = 'line reference' | 'object' | 'grid area'
  | 'start date' | 'opposite subtype' | 'other grid party'
type Row = Record<string, unknown>
type Snapshot = Record<string, Row[]>
type RealSupply = typeof supplyMarketTransition.applySupplyMarketSource
type ObservedCall = {
  enteredAt: number; settledAt?: number; delegations: number
  status: 'pending' | 'fulfilled' | 'rejected'; available: boolean
  input?: unknown; result?: unknown; before?: Snapshot; after?: Snapshot
}
type SupplyObservation = {
  startedAt: number; finishedAt?: number; available: boolean; installed: boolean
  before?: Snapshot; after?: Snapshot; calls: ObservedCall[]
}

// Deliberately empty. A zero-call first refusal needs a separately reviewed
// existing producer/typed predicate; field numbers and generic holds are not it.
const earlyRefusalDescriptors: Record<OriginalNegativeContrast, null> = {
  'line reference': null, object: null, 'grid area': null, 'start date': null,
  'opposite subtype': null, 'other grid party': null,
}
const lateReasons = {
  'line reference': 'normal_z04_exact_sent_original_required',
  object: 'supply_original_cohort_changed',
  'grid area': 'normal_z04_owned_signed_contract_scope_required',
  'start date': 'normal_z04_exact_sent_original_required',
  'opposite subtype': 'normal_z04_exact_sent_original_required',
  'other grid party': 'normal_z04_exact_sent_original_required',
} as const satisfies Record<OriginalNegativeContrast, string>

function row(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('native_observation_record_unavailable')
  return value as Row
}
function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || value.length > 8192) throw Error('native_observation_rows_unavailable')
  return value.map(row)
}
function one(value: Row[]): Row {
  if (value.length !== 1) throw Error('native_observation_single_row_required')
  return value[0]
}
function digest(value: unknown): string | null {
  return typeof value === 'string' ? createHash('sha256').update(value, 'utf8').digest('hex') : null
}
function jsonFacts(value: unknown): Row {
  if (typeof value !== 'string') throw Error('native_observation_facts_unavailable')
  try { return row(JSON.parse(value)) } catch { throw Error('native_observation_facts_unavailable') }
}
function fact(name: string, value: boolean) {
  // Every name below is a fixed source literal. Private rows never reach expect.
  expect(value, name).toBe(true)
}
function clockInWindow(value: unknown, start: number, finish: number): boolean {
  const instant = parseSourceReceiptInstant(value)
  return instant !== null && instant >= BigInt(start) * BigInt(1000) && instant < BigInt(finish + 1) * BigInt(1000)
}
function sameInstant(a: unknown, b: unknown): boolean {
  const instant = parseSourceReceiptInstant(a)
  return instant !== null && instant === parseSourceReceiptInstant(b)
}
function physical(raw: unknown) {
  if (typeof raw !== 'string') throw Error('native_observation_wire_unavailable')
  const wire = tokenizeEdifact(raw), segments = wire.segments
  const unique = (tag: string, qualifier?: string, element = 1) => {
    const selected = segments.filter(token => token.tag === tag
      && (qualifier === undefined || segmentComposite(token, element, wire.una)[0] === qualifier))
    if (selected.length !== 1) throw Error('native_observation_physical_occurrence_unavailable')
    return selected[0]
  }
  const lin = unique('LIN'), unb = unique('UNB')
  const reason = unique('CCI', 'Z13', 2), reasonIndex = segments.indexOf(reason)
  const cav = segments[reasonIndex + 1]
  if (cav?.tag !== 'CAV') throw Error('native_observation_physical_reason_unavailable')
  const unh = unique('UNH'), unt = unique('UNT'), unz = unique('UNZ')
  return {
    raw, object: segmentComposite(lin, 3, wire.una)[0], agency: segmentComposite(lin, 3, wire.una)[3],
    li: segmentComposite(unique('RFF', 'LI'), 1, wire.una)[1],
    grid: segmentComposite(unique('RFF', 'Z05'), 1, wire.una)[1],
    start: segmentComposite(unique('DTM', '92'), 1, wire.una)[1],
    customer: segmentComposite(unique('NAD', 'UD'), 2, wire.una),
    reason: segmentComposite(cav, 1, wire.una)[0],
    sender: segmentComposite(unique('NAD', 'FR'), 2, wire.una)[0],
    receiver: segmentComposite(unique('NAD', 'DO'), 2, wire.una)[0],
    transportSender: segmentComposite(unb, 2, wire.una)[0],
    transportReceiver: segmentComposite(unb, 3, wire.una)[0],
    reference: segmentComposite(unh, 1, wire.una)[0],
    counted: segmentComposite(unt, 1, wire.una)[0] === String(segments.indexOf(unt) - segments.indexOf(unh) + 1)
      && segmentComposite(unt, 2, wire.una)[0] === segmentComposite(unh, 1, wire.una)[0]
      && segmentComposite(unz, 1, wire.una)[0] === '1'
      && segmentComposite(unz, 2, wire.una)[0] === segmentComposite(unb, 5, wire.una)[0],
  }
}

/** The sole caller below supplies its fixed SELECT. Explicit pipes prevent
 * execFileSync's default stderr echo before a rejected psql call. No private
 * query, output or error crosses the fixed unavailable boundary. */
function readOnlySnapshotSql(select: string): unknown {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('native_observation_owned_local_only')
  try {
    const output = execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres',
      '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: select, encoding: 'utf8', timeout: 10000,
      maxBuffer: 2_000_000, stdio: ['pipe', 'pipe', 'pipe'] }).trim()
    return output ? JSON.parse(output) : undefined
  } catch { throw Error('native_observation_private_read_unavailable') }
}

/** Private endpoint snapshot. Only plain SELECTs and JSON serialization; no
 * locks, owner/require/capability calls, resolver, recorder or private tokens.
 * The shared loopback guard/read timeout/buffer remain the existing ones. */
function readSnapshot(f: SupplyObservationFixture, source: EdielMessageRow): Snapshot {
  const received = physical(source.raw_payload)
  const company = literal(f.companyId), sourceId = literal(source.id), actor = literal(f.actorUserId)
  const originalId = literal(f.original.id), mailId = literal(source.inbound_email_message_id)
  const ownSource = `source_message_id=${sourceId}`
  const ownCompany = `company_id=${company}`
  const collections: Record<string, [string, string]> = {
    message: ['public.ediel_messages', `id=${sourceId}`],
    source: ['gridex_received_sources.sources', ownSource],
    assessments: ['gridex_received_sources.validation_assessments', ownSource],
    ignored: ['gridex_received_sources.prodat_ignored_field_facets', ownSource],
    objects: ['gridex_received_sources.prodat_object_validation_facets', ownSource],
    responses: ['gridex_received_sources.prodat_response_facets', ownSource],
    application: ['gridex_received_sources.prodat_application_facets', ownSource],
    sourceFunction: ['gridex_received_sources.prodat_source_function_facets', ownSource],
    partitions: ['gridex_received_sources.supply_object_partitions', ownSource],
    effects: ['gridex_received_sources.supply_object_effect_receipts', ownSource],
    confirmations: ['gridex_received_sources.normal_switch_confirmations', ownSource],
    transitions: ['gridex_received_sources.supply_source_transitions', ownSource],
    events: ['public.ediel_message_events', `ediel_message_id=${sourceId}`],
    legal: ['gridex_ediel_inbound_context.receipts', ownSource],
    rules: ['gridex_ediel_source_rules.receipts', ownSource],
    receptions: ['gridex_ediel_inbound_receptions.receptions', ownSource],
    mail: ['public.inbound_email_messages', `id=${mailId}`],
    parse: ['public.inbound_ediel_parse_results', `inbound_email_message_id=${mailId}`],
    original: ['public.ediel_messages', `id=${originalId}`],
    originalBinding: ['gridex_received_sources.switch_originals', `message_id=${originalId}`],
    originalLegal: ['gridex_ediel_inbound_context.receipts', `source_message_id=${originalId}`],
    originalRules: ['gridex_ediel_source_rules.receipts', `source_message_id=${originalId}`],
    provider: ['gridex_ediel_transport.attempts', `message_id=${originalId}`],
    requests: ['public.supplier_switch_requests', ownCompany],
    periods: ['public.customer_supply_periods', ownCompany],
    points: ['public.metering_points', ownCompany],
    sites: ['public.customer_sites', ownCompany],
    contracts: ['public.customer_contracts', ownCompany],
    customers: ['public.customers', ownCompany],
    companies: ['public.companies', `id=${company}`],
    auth: ['auth.users', `id=${actor}`],
    profiles: ['public.user_profiles', `id=${actor}`],
    memberships: ['public.company_memberships', `${ownCompany} AND user_id=${actor}`],
    roles: ['public.tenant_actor_roles', ownCompany],
    permissionRoles: ['public.user_roles', `user_id=${actor}`],
  }
  const collectionsSql = Object.entries(collections).map(([key, [table, predicate]]) =>
    `${literal(key)},(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),'[]'::jsonb) FROM ${table} r WHERE ${predicate})`)
  // The outer set intentionally has NO sent filter. The inner set follows LI.
  const value = readOnlySnapshotSql(`SELECT jsonb_build_object(${collectionsSql.join(',')},
    'directGrants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY to_jsonb(g)::text),'[]') FROM(
      SELECT up.*,coalesce(p.key,p.name) AS permission_name FROM public.user_permissions up
      JOIN public.permissions p ON p.id=up.permission_id
      WHERE up.user_id=${actor} AND (up.company_id IS NULL OR up.company_id=${company}))g),
    'outerCohort',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id) ORDER BY id),'[]') FROM(
      SELECT s.outbound_z03_message_id id FROM public.supplier_switch_requests s
      WHERE s.company_id=${company} AND ${literal(received.object)}=(SELECT p.ediel_metering_point_id FROM public.metering_points p WHERE p.id=s.metering_point_id AND p.company_id=s.company_id)
      UNION SELECT p.source_message_id FROM public.customer_supply_periods p JOIN public.metering_points mp ON mp.id=p.metering_point_id AND mp.company_id=p.company_id
      WHERE p.company_id=${company} AND mp.ediel_metering_point_id=${literal(received.object)}
      UNION SELECT p.source_end_message_id FROM public.customer_supply_periods p JOIN public.metering_points mp ON mp.id=p.metering_point_id AND mp.company_id=p.company_id
      WHERE p.company_id=${company} AND mp.ediel_metering_point_id=${literal(received.object)})discovered WHERE id IS NOT NULL),
    'innerOriginals',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id) ORDER BY id),'[]') FROM(
      SELECT DISTINCT s.outbound_z03_message_id id FROM public.supplier_switch_requests s
      WHERE s.company_id=${company} AND s.rff_li_reference=${literal(received.li)})discovered));`)
  return Object.fromEntries(Object.entries(row(value)).map(([key, value]) => [key, rows(value)]))
}

/** Install only for the existing ordinary processing window. Read/copy failure
 * never removes the business call, and rejection remains the same thrown value. */
export function observeOriginalNegativeSupply(f: SupplyObservationFixture, source: EdielMessageRow) {
  const observation: SupplyObservation = { startedAt: Date.now(), available: true, installed: false, calls: [] }
  try { observation.before = readSnapshot(f, source) } catch { observation.available = false }
  const real: RealSupply = supplyMarketTransition.applySupplyMarketSource
  let restore: (() => void) | undefined
  try {
    const spy = vi.spyOn(supplyMarketTransition, 'applySupplyMarketSource')
    restore = () => spy.mockRestore()
    spy.mockImplementation(async (input: Parameters<RealSupply>[0]): ReturnType<RealSupply> => {
      const call: ObservedCall = { enteredAt: Date.now(), delegations: 0, status: 'pending', available: true }
      observation.calls.push(call)
      try { call.input = structuredClone(input); call.before = readSnapshot(f, source) } catch { call.available = false }
      let result: Awaited<ReturnType<RealSupply>>
      try { call.delegations++; result = await real(input) }
      catch (error) { call.status = 'rejected'; call.settledAt = Date.now(); throw error }
      call.status = 'fulfilled'; call.settledAt = Date.now()
      try { call.result = structuredClone(result); call.after = readSnapshot(f, source) } catch { call.available = false }
      return result
    })
    observation.installed = true
  } catch {
    observation.available = false
    try { restore?.() } catch { /* The proof remains unavailable. */ }
  }
  let stopped = false
  return { observation, stop() {
    if (stopped) { observation.available = false; return }
    stopped = true
    observation.finishedAt = Date.now()
    try { restore?.() } catch { observation.available = false }
    try { observation.after = readSnapshot(f, source) } catch { observation.available = false }
  } }
}

const stableKeys = ['source', 'legal', 'receptions', 'mail', 'parse', 'original', 'originalBinding',
  'originalLegal', 'originalRules', 'provider', 'requests', 'periods', 'points', 'sites', 'contracts',
  'customers', 'companies', 'auth', 'profiles', 'memberships', 'roles', 'permissionRoles', 'directGrants',
  'outerCohort', 'innerOriginals'] as const
const authorityKeys = ['assessments', 'ignored', 'objects', 'responses', 'application', 'sourceFunction', 'rules'] as const
const effectKeys = ['partitions', 'effects', 'confirmations', 'transitions', 'periods'] as const
const facetSpecs = [
  ['ignored', 'canonical_assessment_id', 'fields_text', 'fields_hash'],
  ['objects', 'assessment_id', 'facts_text', 'facts_hash'],
  ['responses', 'assessment_id', 'response_facts_text', 'response_facts_hash'],
  ['application', 'assessment_id', 'application_facts_text', 'application_facts_hash'],
] as const

function sourceFacts(f: SupplyObservationFixture, source: EdielMessageRow, state: Snapshot) {
  const message = one(state.message), immutable = one(state.source)
  const hash = digest(source.raw_payload), birth = row(row(message.execution_context_snapshot).receivedProdatContext)
  const sourceBirth = row(row(source.execution_context_snapshot).receivedProdatContext)
  fact('source_exact_original_scope', message.id === source.id && message.company_id === f.companyId
    && message.environment === 'test' && message.direction === 'inbound' && message.message_standard === 'edifact'
    && message.message_family === 'PRODAT' && message.message_code === 'Z04')
  fact('source_exact_immutable_bytes', hash !== null && message.raw_payload === source.raw_payload
    && message.immutable_payload_hash === hash && immutable.raw_payload === source.raw_payload && immutable.payload_hash === hash)
  fact('source_exact_insert_context', immutable.source_message_id === source.id && immutable.company_id === f.companyId
    && immutable.environment === 'test' && immutable.origin === 'database_insert' && immutable.message_code === 'Z04'
    && isDeepStrictEqual(immutable.received_context, birth) && isDeepStrictEqual(birth, sourceBirth)
    && birth.version === 1 && birth.contextOrigin === 'database_insert' && birth.sourceMessageId === source.id
    && birth.companyId === f.companyId && birth.environment === 'test' && birth.messageCode === 'Z04' && birth.payloadHash === hash)
  fact('source_birth_clocks_preserved', sameInstant(message.message_received_at, source.message_received_at)
    && sameInstant(message.created_at, source.created_at) && sameInstant(immutable.source_received_at, source.message_received_at)
    && sameInstant(birth.sourceReceivedAt, source.message_received_at) && parseSourceReceiptInstant(birth.capturedAt) !== null
    && parseSourceReceiptInstant(immutable.captured_at) !== null)
  const reception = one(state.receptions), mail = one(state.mail), parse = one(state.parse)
  fact('source_first_reception', reception.classification === 'first_reception' && reception.source_message_id === source.id
    && reception.company_id === f.companyId && reception.environment === 'test' && reception.actor_user_id === f.actorUserId
    && reception.inbound_email_message_id === source.inbound_email_message_id && reception.parse_result_id === parse.id
    && reception.canonical_payload_hash === hash && reception.received_payload_hash === hash)
  fact('source_mail_parse_original', mail.id === source.inbound_email_message_id && mail.company_id === f.companyId
    && mail.environment === 'test' && mail.raw_edifact_payload === source.raw_payload && parse.company_id === f.companyId
    && parse.inbound_email_message_id === mail.id && parse.raw_payload === source.raw_payload && parse.parse_status === 'parsed'
    && sameInstant(reception.received_at, mail.received_at) && sameInstant(reception.received_at, source.message_received_at))
  return { message, hash, received: physical(source.raw_payload) }
}

function leafFacts(f: SupplyObservationFixture, source: EdielMessageRow, state: Snapshot, inputMessage: Row) {
  const { message, hash, received } = sourceFacts(f, source, state)
  const receipt = row(row(inputMessage.validation_report).receivedSourceValidationEvidence)
  const leaves = state.assessments.filter(candidate => !state.assessments.some(child => child.previous_assessment_id === candidate.id))
  const leaf = one(leaves), facts = jsonFacts(leaf.facts_text)
  fact('call_actual_full_source_and_receipt', inputMessage.id === source.id && inputMessage.company_id === f.companyId
    && inputMessage.environment === 'test' && inputMessage.direction === 'inbound' && inputMessage.message_standard === 'edifact'
    && inputMessage.message_family === 'PRODAT' && inputMessage.message_code === 'Z04' && inputMessage.raw_payload === source.raw_payload
    && inputMessage.immutable_payload_hash === hash
    && sameInstant(inputMessage.message_received_at, source.message_received_at) && sameInstant(inputMessage.created_at, source.created_at)
    && isDeepStrictEqual(row(inputMessage.execution_context_snapshot).receivedProdatContext, row(message.execution_context_snapshot).receivedProdatContext)
    && receipt.status === 'recorded' && receipt.sourceDisposition === 'not_established'
    && typeof receipt.assessmentId === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(receipt.assessmentId)
    && receipt.assessmentId === leaf.id && receipt.factsHash === leaf.facts_hash
    && isDeepStrictEqual(receipt, row(row(message.validation_report).receivedSourceValidationEvidence)))
  fact('call_sole_immutable_canonical_leaf', leaf.source_message_id === source.id && leaf.company_id === f.companyId
    && leaf.environment === 'test' && leaf.source_payload_hash === hash && leaf.owner === 'canonical-runtime-with-registry-v1'
    && digest(leaf.facts_text) === leaf.facts_hash && facts.version === 1 && facts.owner === leaf.owner
    && facts.sourceDisposition === 'not_established' && facts.coverage === 'canonical_runtime_only'
    && facts.originalTenantMatch === 'matched' && facts.messageReference === received.reference)
  fact('call_accepted_syntax_and_function', facts.syntaxDecision === 'accepted' && facts.functionalDecision === 'accepted')
  const register = bindReceivedRegisterValidation(facts.registerValidation, received.raw)
  fact('call_complete_physical_register_acceptance', register !== null && register.objects.length === 1
    && register.objects.every(object => object.disposition === 'accepted' && object.reasons.length === 0))
  if (!register) throw Error('native_observation_register_unavailable')
  const { disposition, reasons, ...scope } = register.objects[0]
  fact('call_actual_received_object_scope', scope.messageIndex === 0 && scope.messageReference === received.reference
    && scope.objectId === received.object && scope.identityAgency === received.agency && scope.registers.length === 1
    && disposition === 'accepted' && reasons.length === 0)
  for (const [key, idKey, textKey, hashKey] of facetSpecs) {
    const facet = one(state[key])
    fact('call_v6_facet_same_source_and_leaf', facet[idKey] === leaf.id && facet.source_message_id === source.id
      && facet.company_id === f.companyId && facet.environment === 'test' && facet.source_payload_hash === hash
      && digest(facet[textKey]) === facet[hashKey])
  }
  fact('call_normal_source_function_absent', state.sourceFunction.length === 0)
  const application = jsonFacts(one(state.application).application_facts_text)
  const applicationObjects = rows(application.objects), own = one(applicationObjects)
  const { applicationDecision, reasonCodes, ...applicationScope } = own
  fact('call_accepted_exact_own_application', application.version === 1 && application.sourcePayloadHash === hash
    && application.owner === 'canonical-prodat-application-all-v1' && application.coverage === 'canonical_own_application_only'
    && application.headerDecision === 'accepted' && applicationDecision === 'accepted'
    && isDeepStrictEqual(reasonCodes, []) && isDeepStrictEqual(applicationScope, scope))
  const fullGuide = jsonFacts(one(state.objects).facts_text), guideObject = one(rows(fullGuide.objects))
  fact('call_complete_own_guide_scope', fullGuide.owner === 'canonical-full-prodat-object-validation-v1'
    && fullGuide.coverage === 'full_canonical_guide_objects_only' && fullGuide.sharedAccepted === true
    && guideObject.objectId === scope.objectId && guideObject.identityAgency === scope.identityAgency
    && guideObject.messageReference === scope.messageReference && guideObject.firstLineIndex === scope.registers[0].lineIndex
    && guideObject.lineItemReference === received.li && guideObject.disposition === 'accepted'
    && isDeepStrictEqual(guideObject.reasons, []) && isDeepStrictEqual(guideObject.negativeFields, []))
  const response = jsonFacts(one(state.responses).response_facts_text), responseObject = one(rows(response.objects))
  fact('call_response_facet_exact_physical_scope', response.version === 1 && response.sourcePayloadHash === hash
    && responseObject.id === scope.objectId && responseObject.li === received.li
    && responseObject.lineIndex === scope.registers[0].segmentIndex
    && isDeepStrictEqual(responseObject.registerLineIndices, scope.registers.map(register => register.segmentIndex)))
  return { leaf, scope, facts, received }
}

function legalAndActorFacts(f: SupplyObservationFixture, source: EdielMessageRow, state: Snapshot,
  current: ReturnType<typeof leafFacts>, enteredAt: number) {
  const hash = digest(source.raw_payload), legal = one(state.legal), context = row(legal.context)
  const rules = one(state.rules), evidence = row(rules.evidence), witness = row(current.facts.rulePackEvidence)
  const actualSubtype = current.received.reason === 'Z22' ? 'L' : current.received.reason === 'Z23' ? 'LK' : null
  fact('call_actual_frozen_legal_basis', legal.source_message_id === source.id && legal.company_id === f.companyId
    && legal.environment === 'test' && legal.direction === 'inbound' && legal.payload_sha256 === hash
    && legal.status === 'ready' && legal.reason === null && sameInstant(legal.source_received_at, source.message_received_at)
    && context.companyId === f.companyId && context.environment === 'test' && context.direction === 'inbound'
    && context.family === 'PRODAT' && context.code === 'Z04' && context.subtype === actualSubtype
    && context.actorRole === 'electricity_supplier' && context.legalActorId === f.actorUserId
    && context.legalEdielId === current.received.receiver && context.transportEdielId === current.received.transportReceiver
    && context.applicationReference === '23-DDQ-PRODAT' && sameInstant(context.sourceReceivedAt, source.message_received_at))
  const snapshot = row(evidence.snapshot), guide = row(snapshot.rulePack), profile = row(snapshot.messageProfile)
  fact('call_actual_frozen_rule_basis', rules.source_message_id === source.id && rules.company_id === f.companyId
    && rules.environment === 'test' && rules.direction === 'inbound' && rules.payload_sha256 === hash
    && rules.canonical_assessment_id === current.leaf.id && rules.original_source_message_id === null
    && witness.profileKey === evidence.profileKey && witness.messageProfileId === evidence.messageProfileId
    && witness.rulePackId === evidence.rulePackId && witness.sourceHash === evidence.sourceHash
    && guide.id === evidence.rulePackId && guide.source_hash === evidence.sourceHash && profile.id === evidence.messageProfileId
    && evidence.rulePackId === source.canonical_rule_pack_id && evidence.messageProfileId === source.rule_profile_version_id
    && evidence.profileKey === source.rule_profile_key && evidence.version === source.rule_profile_version
    && evidence.sourceHash === source.rule_pack_checksum && isDeepStrictEqual(snapshot.originalMessageSnapshot, source.rule_pack_snapshot))
  const auth = one(state.auth), user = one(state.profiles), company = one(state.companies), member = one(state.memberships)
  const instant = BigInt(enteredAt) * BigInt(1000)
  const roles = state.roles.filter(role => role.actor_id === f.actorUserId && role.environment === 'test'
    && role.role_code === 'electricity_supplier' && role.company_id === f.companyId)
  const role = one(roles), roleStart = parseSourceReceiptInstant(role.valid_from), roleEnd = parseSourceReceiptInstant(role.valid_to)
  // This existing synthetic fixture expressly uses active direct grants. This
  // is an independent positive witness, not a substitute permission evaluator.
  const write = state.directGrants.some(grant => grant.user_id === f.actorUserId
    && (grant.company_id === null || grant.company_id === f.companyId) && grant.permission_name === 'metering.write'
    && (grant.status === null || grant.status === 'active') && grant.is_active !== false
    && (grant.effect === null || grant.effect === 'allow'))
  fact('call_current_execution_actor', auth.id === f.actorUserId && auth.deleted_at === null
    && (auth.banned_until === null || (parseSourceReceiptInstant(auth.banned_until) ?? instant + BigInt(1)) <= instant)
    && user.id === f.actorUserId && user.user_status === 'active' && member.user_id === f.actorUserId
    && member.company_id === f.companyId && member.status === 'active' && member.is_active === true
    && parseSourceReceiptInstant(member.accepted_at) !== null && company.id === f.companyId && company.is_active !== false
    && !['archived', 'suspended', 'pending_deletion', 'deleted'].includes(String(company.status)) && write
    && roleStart !== null && roleStart <= instant && (role.valid_to === null || roleEnd !== null && instant < roleEnd))
}

function originalAndPredicateFacts(f: SupplyObservationFixture, source: EdielMessageRow,
  contrast: OriginalNegativeContrast, other: SupplyObservationFixture | null, state: Snapshot) {
  const received = physical(source.raw_payload), original = one(state.original), sent = physical(original.raw_payload)
  const binding = one(state.originalBinding), request = one(state.requests.filter(item => item.id === f.switchId))
  const point = one(state.points.filter(item => item.id === f.pointId)), site = one(state.sites.filter(item => item.id === f.siteId))
  const contract = one(state.contracts.filter(item => item.id === f.contractId)), customer = one(state.customers.filter(item => item.id === f.customerId))
  const hash = digest(original.raw_payload), originalLegal = one(state.originalLegal), originalRules = one(state.originalRules)
  fact('original_actual_sent_binding', original.id === f.original.id && original.company_id === f.companyId
    && original.environment === 'test' && original.direction === 'outbound' && original.message_standard === 'edifact'
    && original.message_family === 'PRODAT' && original.message_code === 'Z03' && ['sent', 'acknowledged'].includes(String(original.status))
    && parseSourceReceiptInstant(original.message_sent_at) !== null && parseSourceReceiptInstant(original.immutable_rendered_at) !== null
    && original.raw_payload === f.original.raw_payload && original.immutable_payload_hash === hash
    && binding.message_id === original.id && binding.company_id === f.companyId)
  fact('original_immutable_legal_rule_basis', originalLegal.status === 'ready' && originalLegal.company_id === f.companyId
    && originalLegal.environment === 'test' && originalLegal.direction === 'outbound' && originalLegal.payload_sha256 === hash
    && originalRules.company_id === f.companyId && originalRules.environment === 'test'
    && originalRules.direction === 'outbound' && originalRules.payload_sha256 === hash)
  const accepted = state.provider.filter(attempt => attempt.classification === 'accepted'), attempt = one(accepted)
  const transport = row(attempt.binding), provider = row(attempt.provider_result)
  fact('original_actual_provider_acceptance', attempt.message_id === original.id && attempt.company_id === f.companyId
    && attempt.environment === 'test' && parseSourceReceiptInstant(attempt.entered_at) !== null
    && parseSourceReceiptInstant(attempt.observed_at) !== null && transport.originalHash === hash
    && transport.to === original.receiver_email && typeof transport.to === 'string'
    && Array.isArray(provider.accepted) && provider.accepted.length > 0
    && provider.accepted.every(recipient => typeof recipient === 'string' && recipient.toLowerCase() === String(transport.to).toLowerCase())
    && isDeepStrictEqual(provider.rejected, []))
  fact('original_owned_request', request.company_id === f.companyId && request.outbound_z03_message_id === original.id
    && request.rff_li_reference === f.li && request.customer_id === f.customerId && request.metering_point_id === f.pointId
    && original.customer_id === request.customer_id && original.metering_point_id === request.metering_point_id
    && (request.site_id === null || request.site_id === f.siteId) && (request.customer_site_id === null || request.customer_site_id === f.siteId)
    && (request.contract_id === null || request.contract_id === f.contractId)
    && (request.customer_contract_id === null || request.customer_contract_id === f.contractId)
    && (request.site_id === f.siteId || request.customer_site_id === f.siteId)
    && (request.contract_id === f.contractId || request.customer_contract_id === f.contractId)
    && ['prepared', 'queued', 'submitted', 'sent', 'waiting', 'waiting_response', 'waiting_for_z04', 'awaiting_confirmation'].includes(String(request.status))
    && request.lifecycle_blocked === false)
  const customerIdentity = typeof customer.org_number === 'string' && customer.org_number.trim()
    ? customer.org_number.trim() : typeof customer.personal_number === 'string' ? customer.personal_number.trim() : null
  fact('original_owned_signed_graph', point.company_id === f.companyId && point.customer_id === f.customerId
    && point.site_id === f.siteId && point.ediel_metering_point_id === f.external && point.grid_area_code === f.gridAreaCode
    && point.grid_owner_ediel_id === f.receiver && site.company_id === f.companyId && site.customer_id === f.customerId
    && contract.company_id === f.companyId && contract.customer_id === f.customerId && contract.metering_point_id === f.pointId
    && ['signed', 'active'].includes(String(contract.status)) && parseSourceReceiptInstant(contract.signed_at) !== null
    && typeof contract.signed_version === 'string' && contract.signed_version.length > 0
    && typeof contract.contract_version === 'string' && contract.contract_version.length > 0
    && customer.company_id === f.companyId && customerIdentity === f.customerIdentity.id && state.periods.length === 0)
  fact('original_unaltered_physical_basis', sent.counted && received.counted && sent.li === f.li
    && sent.reason === (f.variant === 'L' ? 'Z22' : 'Z23') && sent.start === f.requestedStartDate.replaceAll('-', '') + '0000'
    && sent.customer[0] === customerIdentity && sent.sender === f.sender && sent.receiver === f.receiver
    && received.customer[0] === customerIdentity && received.customer[1] === 'SE2' && received.customer[2] === '260'
    && received.agency === '9' && received.receiver === sent.sender && received.transportReceiver === sent.transportSender
    && received.sender === received.transportSender && received.receiver === received.transportReceiver)
  const startDate = new Date(f.requestedStartDate + 'T12:00:00Z')
  startDate.setUTCDate(startDate.getUTCDate() + 1)
  const nextStart = startDate.toISOString().slice(0, 10).replaceAll('-', '') + '0000'
  const predicates = {
    li: received.li === sent.li,
    object: received.object === f.external,
    grid: received.grid === point.grid_area_code,
    start: received.start === sent.start,
    reason: received.reason === sent.reason,
    party: received.sender === sent.receiver && received.transportSender === sent.transportReceiver,
  }
  const changed = { 'line reference': 'li', object: 'object', 'grid area': 'grid', 'start date': 'start',
    'opposite subtype': 'reason', 'other grid party': 'party' } as const
  fact('contrast_exactly_one_correlation_predicate', Object.entries(predicates).every(([key, matches]) => matches === (key !== changed[contrast])))
  fact('contrast_exact_original_mutation', contrast === 'line reference' ? /^[0-9a-f]{32}$/i.test(received.li) && received.li !== f.li
    : contrast === 'object' ? other !== null && other.companyId !== f.companyId && other.external !== f.external && received.object === other.external
    : contrast === 'grid area' ? received.grid === 'OTHER'
    : contrast === 'start date' ? received.start === nextStart
    : contrast === 'opposite subtype' ? received.reason === (f.variant === 'L' ? 'Z23' : 'Z22')
    : other !== null && other.companyId !== f.companyId && other.receiver !== f.receiver && received.sender === other.receiver)
  const outer = state.outerCohort.map(item => item.id), inner = state.innerOriginals.map(item => item.id)
  fact('contrast_actual_discovery_sets', contrast === 'object'
    ? outer.length === 0 && inner.length === 1 && inner[0] === f.original.id && !outer.includes(f.original.id)
    : outer.length === 1 && outer[0] === f.original.id
      && (contrast === 'line reference' ? inner.length === 0 : inner.length === 1 && inner[0] === f.original.id))
}

/** Called AFTER every inherited negative business/history/APERAK/activation
 * oracle. Genuine healthy L/LK whole tails are a separate qualification gate. */
export function assertOriginalNegativeSupplyCause(f: SupplyObservationFixture, source: EdielMessageRow,
  contrast: OriginalNegativeContrast, other: SupplyObservationFixture | null, observation: SupplyObservation) {
  console.info('native_original_negative_cause_observation', JSON.stringify({ variant: f.variant, contrast,
    calls: observation.calls.length, expectedLateReason: lateReasons[contrast],
    earlyDescriptor: 'NONE_APPROVED', available: observation.available && observation.calls.every(call => call.available) }))
  fact('observation_installed_and_readable', observation.installed && observation.available)
  if (observation.calls.length === 0) {
    fact('zero_call_intended_first_refusal_descriptor_required', earlyRefusalDescriptors[contrast] !== null)
    return
  }
  fact('late_exactly_one_ordinary_call', observation.calls.length === 1)
  const call = observation.calls[0]
  fact('late_exactly_one_real_resolved_delegation', call.delegations === 1 && call.status === 'fulfilled' && call.available)
  fact('late_all_endpoint_reads_available', !!observation.before && !!observation.after && !!call.before && !!call.after
    && observation.finishedAt !== undefined && call.settledAt !== undefined)
  if (!observation.before || !observation.after || !call.before || !call.after
    || observation.finishedAt === undefined || call.settledAt === undefined) throw Error('native_observation_endpoint_unavailable')
  const before = observation.before, entry = call.before, exit = call.after, after = observation.after
  const input = row(call.input), message = row(input.message), result = row(call.result)
  fact('late_actual_actor_and_process_window', input.actorUserId === f.actorUserId
    && call.enteredAt >= observation.startedAt && call.settledAt >= call.enteredAt && call.settledAt <= observation.finishedAt)
  for (const state of [before, entry, exit, after]) sourceFacts(f, source, state)
  const current = leafFacts(f, source, entry, message)
  leafFacts(f, source, exit, message); leafFacts(f, source, after, message)
  for (const key of stableKeys) fact('late_unrelated_endpoint_rows_unchanged', isDeepStrictEqual(before[key], entry[key])
    && isDeepStrictEqual(entry[key], exit[key]) && isDeepStrictEqual(exit[key], after[key]))
  for (const key of authorityKeys) {
    fact('late_same_immutable_leaf_and_facets', isDeepStrictEqual(entry[key], exit[key]) && isDeepStrictEqual(exit[key], after[key]))
    fact('late_old_authority_history_preserved', before[key].every(previous => entry[key].some(candidate => isDeepStrictEqual(previous, candidate))))
  }
  fact('late_one_new_first_canonical_assessment', before.assessments.length === 0 && entry.assessments.length === 1
    && current.leaf.previous_assessment_id === null && clockInWindow(current.leaf.assessed_at, observation.startedAt, call.enteredAt))
  for (const key of effectKeys) fact('late_no_prior_or_new_business_receipt', [before, entry, exit, after].every(state => state[key].length === 0))
  legalAndActorFacts(f, source, entry, current, call.enteredAt)
  originalAndPredicateFacts(f, source, contrast, other, entry)
  fact('late_fresh_unapplied_actual_result', result.applied === false && result.idempotent === false
    && result.fullyApplied === false && result.reviewRequired === true && result.reason === 'no_qualified_supply_objects'
    && isDeepStrictEqual(result.periods, []) && isDeepStrictEqual(result.commits, []) && isDeepStrictEqual(result.effectReceiptIds, []))
  const partition = rows(result.partition), held = one(partition)
  fact('late_exact_preselected_held_scope_and_cause', held.disposition === 'held' && held.reason === lateReasons[contrast]
    && isDeepStrictEqual(held.object, current.scope))
  const oldIds = new Set(before.events.map(event => event.id))
  fact('late_old_source_events_unchanged', before.events.every(previous => after.events.some(candidate => isDeepStrictEqual(previous, candidate))))
  const domain = after.events.filter(event => !oldIds.has(event.id) && event.event_type === 'validated'
    && Object.hasOwn(row(event.payload), 'sourceObjectPartition'))
  const event = one(domain), payload = row(event.payload)
  fact('late_new_domain_event_exact_result', event.company_id === f.companyId && event.ediel_message_id === source.id
    && event.event_status === 'warning' && clockInWindow(event.created_at, observation.startedAt, observation.finishedAt)
    && isDeepStrictEqual(payload.sourceObjectPartition, result.partition) && payload.applied === result.applied
    && payload.idempotent === result.idempotent && payload.fullyApplied === result.fullyApplied
    && payload.reviewRequired === result.reviewRequired && isDeepStrictEqual(payload.committedEffectReceiptIds, result.effectReceiptIds))
}
