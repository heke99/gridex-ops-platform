import {isDeepStrictEqual} from 'node:util'
import {supabaseService} from '@/lib/supabase/service'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {segmentComposite, tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {DEFAULT_UNA, serializeUna, type EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {EdielExecutionFailure} from '@/lib/ediel/core/failureDisposition'
import {requireEdielInboundLegalContext} from '@/lib/ediel/tenant/sourceLegalContext'
import {receivedOriginalRulePackWitness} from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import {bindReceivedRegisterValidation} from '@/lib/ediel/core/receivedRegisterValidationBinding'
import {evidenceHash, isEvidenceRecord, isEvidenceUuid} from '@/lib/ediel/utilts/durableSourceDiscovery'
import {parseSourceReceiptInstant} from '@/lib/ediel/utilts/receivedSourceInventory'
import {validateFieldMatrixPayload} from '@/lib/ediel/rulebook/fieldMatrix'
import {validateProdatRegisterPolicy} from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import {canonicalProdat26AFieldRules, prodatRegisterFieldScope} from './prodat26AFieldMatrix'
import {prodatRegisterGroups} from './prodatRegisterGroups'
import {prodatRegisterFieldState} from './prodatRegisterFields'
import {prodatCharacteristicValues} from './prodatCharacteristicFields'
import {isProdatRejectedIdentityScope} from './prodatRejectedIdentityScope'
import {prodatFieldDiagnostic} from './prodatFieldDiagnostic'
import {projectProdatRegisterValidation, type ProdatRegisterValidationEvidence} from './prodatRegisterValidationEvidence'
import {projectProdatDiagnostics, isQualifiedProdatApplicationError} from './prodatDiagnosticProjection'
import {assertReceivedZ04RequiredStartActor as assertRejectedSourceActor} from './receivedZ04RequiredStartRejection'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'

type Input = {rawSegments: readonly string[]; una?: EdifactServiceStringAdvice}
type Witness = NonNullable<ReturnType<typeof receivedOriginalRulePackWitness>>
declare const rejectionBrand: unique symbol
/** This private READ is a rejection basis, never an operational H capability. */
export type ReceivedZ05RejectedIdentityRejection = Readonly<{[rejectionBrand]: true}>
const contextKeys = ['version', 'contextOrigin', 'sourceMessageId', 'companyId', 'environment', 'messageCode', 'payloadHash', 'sourceReceivedAt', 'capturedAt']
type FreshClock = {wall: number; monotonic: number}
const clock = (): FreshClock => ({wall: Date.now(), monotonic: performance.now()})
const reads = new WeakMap<ReceivedZ05RejectedIdentityRejection, {identity: string; actor: string; at: FreshClock; witness: Witness}>()
const structures = new WeakMap<object, {wire: string; facts: string; at: FreshClock}>()
const owners = new WeakMap<object, {identity: string; actor: string; decisionHash: string}>()
const fresh = (at: FreshClock) => {
  const now = clock()
  return now.wall >= at.wall && now.wall - at.wall <= 2000
    && now.monotonic >= at.monotonic && now.monotonic - at.monotonic <= 2000
}
const wireIdentity = (input: Input) => evidenceHash(JSON.stringify([input.rawSegments, serializeUna(input.una ?? DEFAULT_UNA)]))
function bornIdentity(value: unknown): string | null {
  if (!isEvidenceRecord(value) || value.direction !== 'inbound' || value.message_standard !== 'edifact'
    || value.message_family !== 'PRODAT' || value.message_code !== 'Z05' || !isEvidenceUuid(value.id) || !isEvidenceUuid(value.company_id)
    || !['test', 'production'].includes(String(value.environment)) || typeof value.raw_payload !== 'string'
    || Buffer.byteLength(value.raw_payload, 'utf8') > 262144 || !isEvidenceRecord(value.execution_context_snapshot)) return null
  const context = value.execution_context_snapshot.receivedProdatContext, received = parseSourceReceiptInstant(value.message_received_at)
  const created = parseSourceReceiptInstant(value.created_at), document = value.message_created_at === null ? null : parseSourceReceiptInstant(value.message_created_at)
  if (!isEvidenceRecord(context) || Object.keys(context).length !== contextKeys.length || !contextKeys.every(k => Object.hasOwn(context, k))
    || context.version !== 1 || context.contextOrigin !== 'database_insert' || context.sourceMessageId !== value.id
    || context.companyId !== value.company_id || context.environment !== value.environment || context.messageCode !== 'Z05'
    || context.payloadHash !== evidenceHash(value.raw_payload) || received === null || created === null
    || parseSourceReceiptInstant(context.sourceReceivedAt) !== received || parseSourceReceiptInstant(context.capturedAt) === null
    || value.message_created_at !== null && document === null) return null
  return evidenceHash(JSON.stringify([value.id, value.company_id, value.environment, value.direction, value.message_standard,
    value.message_family, value.message_code, value.message_version, value.application_reference, value.raw_payload, received.toString(),
    created.toString(), document?.toString() ?? null, parseSourceReceiptInstant(context.capturedAt)!.toString(),
    value.canonical_rule_pack_id, value.rule_profile_key, value.rule_profile_version_id, value.rule_profile_version,
    value.rule_pack_checksum, value.rule_pack_snapshot]))
}
function bornWitness(source: EdielMessageRow): Witness | null {
  const snapshot = source.rule_pack_snapshot
  if (!isEvidenceRecord(snapshot) || snapshot.profileKey !== source.rule_profile_key || snapshot.profileVersionId !== source.rule_profile_version_id
    || snapshot.version !== source.rule_profile_version || snapshot.checksum !== source.rule_pack_checksum) return null
  return receivedOriginalRulePackWitness({profileKey: source.rule_profile_key, messageProfileId: source.rule_profile_version_id,
    rulePackId: source.canonical_rule_pack_id, sourceHash: source.rule_pack_checksum, version: source.rule_profile_version,
    snapshot: {rulePack: snapshot.rulePack, messageProfile: snapshot.messageProfile, guideSources: snapshot.guideSources}})
}

/** An exact physical required209 finding precedes any policy or source READ. */
export function observeReceivedZ05RejectedIdentity(input: Input): EdielRulebookIssue[] {
  const una = input.una ?? DEFAULT_UNA, grouped = prodatRegisterGroups(input.rawSegments, una, 'Z05')
  if (!grouped.groups.length || grouped.problems.length || prodatCharacteristicValues('223', grouped.tokens, una).some(reason => reason !== 'Z25')
    || grouped.groups.some(group => {
      const field = prodatRegisterFieldState('209', group.segments, una)
      return !(field?.present && !field.malformed) && !isProdatRejectedIdentityScope({code: 'Z05', group, rawSegments: input.rawSegments, una})
    })) return []
  return grouped.groups.filter(group => isProdatRejectedIdentityScope({code: 'Z05', group, rawSegments: input.rawSegments, una})).map(group => {
    const field = prodatRegisterFieldState('209', group.segments, una)!
    return {code: field.malformed ? 'FIELD_MATRIX_FIELD_FORMAT_INVALID' : 'FIELD_MATRIX_REQUIRED_FIELD_MISSING', severity: 'error', blocking: true,
      title: 'Obligatoriskt PRODAT-fält saknas eller är ogiltigt', description: 'Eget fält 209 krävs enligt P26.A §2.2.', fieldPath: 'LIN',
      prodatDiagnostic: prodatFieldDiagnostic('209', field.malformed ? 'invalid' : 'missing', input, group.segments.map(s => s.raw),
        'PRODAT26A:§2.2:Z05:209', group.lineIndex, 'register', field.failureEvidence)}
  })
}

/** Actual canonical local-register invocation only; copies grant no owner. */
export function validateReceivedZ05RejectedIdentityStructure(input: Input): {evidence: ProdatRegisterValidationEvidence; issues: EdielRulebookIssue[]} | null {
  if (!observeReceivedZ05RejectedIdentity(input).length) return null
  const una = input.una ?? DEFAULT_UNA, rules = canonicalProdat26AFieldRules('Z05').filter(rule => prodatRegisterFieldScope(rule.fieldNumber ?? '') === 'local')
  const fields = validateFieldMatrixPayload({family: 'PRODAT', code: 'Z05', direction: 'inbound', mode: 'parse', rawSegments: input.rawSegments, una}, rules)
  const register = validateProdatRegisterPolicy({code: 'Z05', direction: 'inbound', rawSegments: input.rawSegments, una, rules, requireIndependentInventory: false})
  const evidence = projectProdatRegisterValidation({code: 'Z05', rawSegments: input.rawSegments, una, registerIssues: register.issues,
    fieldIssues: fields, handledFields: register.handledFields, completeRuleSelection: true})
  structures.set(evidence, {wire: wireIdentity(input), facts: evidenceHash(JSON.stringify(evidence)), at: clock()})
  return {evidence, issues: [...fields, ...register.issues]}
}

/** Fresh actor, stored original and private legal receipt; the catalogue merely
 * compares the actual born guide. No event, point or bilateral ground is made. */
export async function loadReceivedZ05RejectedIdentityRejection(source: EdielMessageRow, actor: string): Promise<ReceivedZ05RejectedIdentityRejection | null> {
  const at = clock(), identity = bornIdentity(source)
  // Pin the authorized READ principal before any asynchronous actor or source
  // port. A caller-owned row may change while those ports are pending.
  const messageId = source.id, companyId = source.company_id, environment = source.environment
  const actorSource: EdielMessageRow = {...source, id: messageId, company_id: companyId, environment}
  if (!identity || !validateEdifactSyntax({...source, status: 'received', syntax_check_status: 'not_checked', validation_report: {}, failure_reason: null}).ok) return null
  const wire = tokenizeEdifact(source.raw_payload!), input = {rawSegments: wire.segments.map(s => s.raw), una: wire.una}
  if (!observeReceivedZ05RejectedIdentity(input).length || !await assertRejectedSourceActor(actorSource, actor)) return null
  try {
    const stored = await supabaseService.from('ediel_messages').select('*').eq('id', messageId).eq('company_id', companyId!).single()
    if (stored.error || bornIdentity(stored.data) !== identity) return null
    const original = stored.data as EdielMessageRow, witness = bornWitness(original)
    if (!witness) return null
    const legal = await requireEdielInboundLegalContext(companyId!, messageId), basis = legal as unknown as Record<string, unknown>
    const projection = basis.canonicalProjection, receivers = wire.segments.filter(s => s.tag === 'NAD' && segmentComposite(s, 1, wire.una)[0] === 'DO')
    const unb = wire.segments.filter(s => s.tag === 'UNB'), received = parseSourceReceiptInstant(original.message_received_at)
    if (!fresh(at) || unb.length !== 1 || receivers.length !== 1 || legal.basisKind !== 'observed_source_persistence'
      || legal.direction !== 'inbound' || legal.environment !== environment || basis.family !== 'PRODAT' || basis.code !== 'Z05' || basis.subtype !== 'H'
      || !isEvidenceUuid(legal.legalActorId) || !isEvidenceUuid(legal.transportActorId) || legal.actorRole !== 'electricity_supplier'
      || legal.legalEdielId !== segmentComposite(receivers[0], 2, wire.una)[0] || legal.transportEdielId !== segmentComposite(unb[0], 3, wire.una)[0]
      || legal.applicationReference !== segmentComposite(unb[0], 7, wire.una)[0]
      || environment !== (segmentComposite(unb[0], 11, wire.una)[0] === '1' ? 'test' : 'production')
      || typeof basis.sourceEdition !== 'string' || !/^[a-f0-9]{64}$/.test(basis.sourceEdition) || received === null
      || parseSourceReceiptInstant(legal.sourceReceivedAt) !== received || parseSourceReceiptInstant(legal.observedAt) === null
      || !isEvidenceRecord(projection) || projection.family !== 'PRODAT' || projection.code !== 'Z05' || projection.subtype !== 'H'
      || projection.transactionReasonCode !== 'Z25' || !['inbound', 'both'].includes(String(projection.direction))
      || !Array.isArray(projection.receiverRoles) || !projection.receiverRoles.some(r => ['supplier', 'electricity_supplier'].includes(r))
      || !Array.isArray(projection.applicationReferences) || !projection.applicationReferences.includes(legal.applicationReference)) return null
    // Pure response projection needs no mail-birth adapter. Load the actual
    // catalogue resolver only when this authenticated original READ reaches it.
    const {resolveSupplyEndBirthProfile} = await import('@/lib/inbound-mail/supplyEndBirthProfile')
    const selected = await resolveSupplyEndBirthProfile({rawPayload: original.raw_payload, receivedAt: original.message_received_at!, purpose: 'rejected_identity'})
    if (!selected || !fresh(at) || !isDeepStrictEqual(selected, {canonical_rule_pack_id: original.canonical_rule_pack_id,
      rule_profile_key: original.rule_profile_key, rule_profile_version_id: original.rule_profile_version_id,
      rule_profile_version: original.rule_profile_version, rule_pack_checksum: original.rule_pack_checksum, rule_pack_snapshot: original.rule_pack_snapshot})) return null
    const token = Object.freeze({}) as ReceivedZ05RejectedIdentityRejection
    reads.set(token, {identity, actor, at, witness}); return token
  } catch (error) {
    if (error instanceof EdielExecutionFailure && error.disposition.kind === 'security_quarantine') throw error
    return null
  }
}
export function readReceivedZ05RejectedIdentityWitness(token: ReceivedZ05RejectedIdentityRejection, source: EdielMessageRow, actor: string): Witness | null {
  const read = reads.get(token)
  return read && read.actor === actor && read.identity === bornIdentity(source) && fresh(read.at) ? structuredClone(read.witness) : null
}

/** One redemption owns only a genuine209 negative plan and this invocation's
 * actual structural result. Public copies or changed decisions grant nothing. */
export function ownReceivedZ05RejectedIdentityRejection(decision: CanonicalRuntimeDecision, source: EdielMessageRow, actor: string,
  token: ReceivedZ05RejectedIdentityRejection): boolean {
  const read = reads.get(token); reads.delete(token)
  const structure = decision.prodatRegisterValidation && structures.get(decision.prodatRegisterValidation)
  if (decision.prodatRegisterValidation) structures.delete(decision.prodatRegisterValidation)
  const plans = decision.responsePlan.filter(plan => plan.family === 'APERAK'), wire = tokenizeEdifact(source.raw_payload)
  const input = {rawSegments: wire.segments.map(s => s.raw), una: wire.una}
  if (!read || !structure || !fresh(read.at) || !fresh(structure.at) || read.actor !== actor || read.identity !== bornIdentity(source)
    || structure.wire !== wireIdentity(input) || structure.facts !== evidenceHash(JSON.stringify(decision.prodatRegisterValidation))
    || decision.policy !== null || decision.syntaxDecision !== 'accepted' || decision.applicationDecision !== 'rejected' || decision.functionalDecision !== 'not_applicable'
    || decision.validationReport.syntaxDecision !== decision.syntaxDecision || decision.validationReport.applicationDecision !== decision.applicationDecision
    || decision.validationReport.functionalDecision !== decision.functionalDecision || decision.validationReport.canonicalPolicy !== null
    || !isDeepStrictEqual(decision.validationReport.responsePlan, decision.responsePlan)
    || decision.utiltsBusinessOutcome !== null || decision.prodatApplicationValidation !== undefined || decision.prodatSourceFunctionValidation !== undefined
    || !isDeepStrictEqual(decision.canonical, parseCanonicalMessageRow(source)) || !bindReceivedRegisterValidation(decision.prodatRegisterValidation, source.raw_payload!)
    || plans.length !== 1 || plans[0].outcome !== 'negative' || !plans[0].applicationErrors?.length
    || !plans[0].applicationErrors.every(error => isQualifiedProdatApplicationError(error) && error.fieldCode === '209' && ['41', '42'].includes(error.ercCode))
    || !isDeepStrictEqual(receivedOriginalRulePackWitness(decision.validationReport.rulePackEvidence), read.witness)
    || !isDeepStrictEqual(plans[0].applicationErrors, projectProdatDiagnostics(observeReceivedZ05RejectedIdentity(input)).applicationErrors)) return false
  owners.set(decision, {identity: read.identity, actor, decisionHash: evidenceHash(JSON.stringify(decision))}); return true
}
/** Observation only. This does not mint the runtime's separate response port. */
export function hasReceivedZ05RejectedIdentityRejection(decision: object, source: unknown, actor?: string): boolean {
  const owner = owners.get(decision)
  return Boolean(owner && (actor === undefined || owner.actor === actor) && owner.identity === bornIdentity(source)
    && owner.decisionHash === evidenceHash(JSON.stringify(decision)))
}
