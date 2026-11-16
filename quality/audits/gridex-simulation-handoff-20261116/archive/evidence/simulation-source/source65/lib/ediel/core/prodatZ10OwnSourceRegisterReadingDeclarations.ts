import { isDeepStrictEqual } from 'node:util'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { getEdielMessageById } from '@/lib/ediel/db'
import { tenantSelect } from '@/lib/supabase/tenantQuery'
import { assertEdielTenantActor } from '@/lib/ediel/services/authorization'
import { requireEdielInboundLegalContext, type EdielSourceLegalContext } from '@/lib/ediel/tenant/sourceLegalContext'
import { readInboundReceptionRequest, type InboundReception } from '@/lib/ediel/inbound/receptions'
import { evidenceHash, isEvidenceRecord, isEvidenceUuid } from '@/lib/ediel/utilts/durableSourceDiscovery'
import { parseSourceReceiptInstant } from '@/lib/ediel/utilts/receivedSourceInventory'
import { prodatRegisterGroups } from '@/lib/ediel/prodat/prodatRegisterGroups'
import { prodatRegisterReadingMarket, prodatRegisterReadingState, prodatRegisterReadingSubtype } from '@/lib/ediel/prodat/prodatRegisterReadings'
import { resolveCanonicalEdielPolicy, type CanonicalEdielPolicy, type ProdatDependentConditionFacts } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import type { RulebookFieldRule } from '@/lib/ediel/rulebook/fieldMatrix'
import { stockholmBusinessDate } from '@/lib/ediel/core/executionContext'
import { parseCanonicalMessageRow } from '@/lib/ediel/core/canonicalMessage'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import { validateEdifactSyntax } from '@/lib/ediel/core/syntaxValidator'

declare const z10OwnReadingBrand: unique symbol
/** Private READ custody for an own physical declaration, never application or effect authority. */
export type ProdatZ10OwnSourceReadingContext = Readonly<{ [z10OwnReadingBrand]: true }>
type ReadingObjects = ProdatDependentConditionFacts['registerObjects']
type SourceBasis = Readonly<{ identity: string; source: EdielMessageRow }>
type LegalBasis = Readonly<{ sourceEdition: string; projection: Readonly<Record<string, unknown>> }>
type PrivateRead = SourceBasis & LegalBasis & Readonly<{ actor: string }>
const reads = new WeakMap<ProdatZ10OwnSourceReadingContext, PrivateRead>()
const bornKeys = ['version', 'contextOrigin', 'sourceMessageId', 'companyId', 'environment',
  'messageCode', 'payloadHash', 'sourceReceivedAt', 'capturedAt'] as const

/** Copy only primitive source evidence. Mutable reports, profiles and byCell facts are discarded. */
function captureBasis(row: EdielMessageRow): SourceBasis | null {
  if (!isEvidenceUuid(row.id) || !isEvidenceUuid(row.company_id) || !isEvidenceUuid(row.inbound_email_message_id)
    || !['test', 'production'].includes(row.environment) || row.direction !== 'inbound'
    || row.message_standard !== 'edifact' || row.message_family !== 'PRODAT' || row.message_code !== 'Z10'
    || row.message_version !== 'E2SE6A' || row.application_reference !== '23-DDQ-PRODAT'
    || typeof row.raw_payload !== 'string' || Buffer.byteLength(row.raw_payload, 'utf8') > 262144
    || !isEvidenceRecord(row.execution_context_snapshot)) return null
  const value = row.execution_context_snapshot.receivedProdatContext
  const received = parseSourceReceiptInstant(row.message_received_at)
  const created = parseSourceReceiptInstant(row.created_at)
  if (!isEvidenceRecord(value) || Object.keys(value).length !== bornKeys.length
    || !bornKeys.every(key => Object.hasOwn(value, key))
    || value.version !== 1 || value.contextOrigin !== 'database_insert'
    || value.sourceMessageId !== row.id || value.companyId !== row.company_id
    || value.environment !== row.environment || value.messageCode !== 'Z10'
    || value.payloadHash !== evidenceHash(row.raw_payload)
    || received === null || created === null
    || parseSourceReceiptInstant(value.sourceReceivedAt) !== received) return null
  const captured = parseSourceReceiptInstant(value.capturedAt)
  if (captured === null || typeof value.sourceReceivedAt !== 'string' || typeof value.capturedAt !== 'string') return null
  const born = Object.freeze({
    version: 1, contextOrigin: 'database_insert', sourceMessageId: row.id, companyId: row.company_id,
    environment: row.environment, messageCode: 'Z10', payloadHash: evidenceHash(row.raw_payload),
    sourceReceivedAt: value.sourceReceivedAt, capturedAt: value.capturedAt,
  })
  // A fresh complete row projection keeps the existing ordinary parser APIs,
  // without retaining aliases to any unrelated caller/SDK JSON or status.
  const source: EdielMessageRow = Object.freeze({
    id: row.id, company_id: row.company_id, inbound_email_message_id: row.inbound_email_message_id,
    direction: 'inbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z10',
    message_version: row.message_version, application_reference: row.application_reference,
    environment: row.environment, raw_payload: row.raw_payload, created_at: row.created_at,
    message_received_at: row.message_received_at,
    execution_context_snapshot: Object.freeze({ receivedProdatContext: born }),
    parsed_payload: Object.freeze({}), validation_report: Object.freeze({}),
    process_type: null, test_flag: row.environment === 'test' ? 1 : 0, status: 'received',
    transport_type: 'unknown', mailbox: null, mailbox_message_id: null,
    sender_ediel_id: null, sender_name: null, sender_sub_address: null, receiver_ediel_id: null,
    receiver_name: null, receiver_sub_address: null, sender_email: null, receiver_email: null,
    subject: null, file_name: null, mime_type: null, interchange_reference: null,
    external_reference: null, correlation_reference: null, transaction_reference: null,
    original_message_id: null, original_transaction_id: null, original_message_code: null,
    related_message_id: null, communication_route_id: null, outbound_request_id: null,
    switch_request_id: null, grid_owner_data_request_id: null, partner_export_id: null,
    customer_id: null, site_id: null, metering_point_id: null, grid_owner_id: null,
    requires_contrl: false, requires_aperak: false, contrl_status: null, aperak_status: null,
    utilts_err_status: null, ack_outcome: null, syntax_check_status: 'not_checked',
    functional_check_status: null, failure_reason: null, message_created_at: null, message_sent_at: null,
    parsed_at: null, validated_at: null, acknowledged_at: null, failed_at: null, ack_due_at: null,
    updated_at: row.created_at, created_by: null, updated_by: null,
  })
  const identity = evidenceHash(JSON.stringify([
    source.id, source.company_id, source.environment, source.direction, source.message_standard,
    source.message_family, source.message_code, source.message_version, source.application_reference,
    source.inbound_email_message_id, source.raw_payload, received.toString(), created.toString(), captured.toString(),
  ]))
  return Object.freeze({ identity, source })
}

function physicalSource(source: EdielMessageRow) {
  const syntax = validateEdifactSyntax(source)
  if (!syntax.ok || syntax.grammarQualification !== 'qualified') return null
  const wire = tokenizeEdifact(source.raw_payload!)
  const headers = wire.segments.filter(token => token.tag === 'UNH')
  const interchanges = wire.segments.filter(token => token.tag === 'UNB')
  const documents = wire.segments.filter(token => token.tag === 'BGM')
  if (headers.length !== 1 || interchanges.length !== 1 || documents.length !== 1) return null
  const identity = segmentComposite(headers[0], 2, wire.una)
  const application = segmentComposite(interchanges[0], 7, wire.una)
  if (identity.slice(0, 5).join(':') !== 'PRODAT:D:97A:UN:E2SE6A'
    || identity.slice(5).some(value => value !== '')
    || application.length !== 1 || application[0] !== source.application_reference
    || segmentComposite(documents[0], 1, wire.una)[0] !== 'Z10'
    || prodatRegisterReadingMarket(wire.segments, wire.una) !== 'electricity'
    || source.environment !== (segmentComposite(interchanges[0], 11, wire.una)[0] === '1' ? 'test' : 'production')) return null
  const grouped = prodatRegisterGroups(wire.segments, wire.una, 'Z10')
  const first = grouped.groups.filter(group => group.firstLineIndex === group.lineIndex)
  if (!first.length || grouped.groups.some(group => group.messageIndex !== 0 || !group.validRegisterChain)
    || first.some(group => !group.itemId || !['9', '89'].includes(group.identityAgency ?? '')
      || prodatRegisterReadingSubtype('Z10', group.segments, wire.una) !== 'M')) return null
  const canonical = parseCanonicalMessageRow(source)
  if (canonical.family !== 'PRODAT' || canonical.messageCode !== 'Z10' || canonical.subtype !== 'E58'
    || canonical.version !== source.message_version || canonical.applicationReference !== source.application_reference) return null
  const firstLine = wire.segments.findIndex(token => token.tag === 'LIN')
  const header259 = wire.segments.slice(0, firstLine)
    .some(token => token.tag === 'CCI' && segmentComposite(token, 2, wire.una)[0]?.trim().toUpperCase() === 'Z16')
  return { wire, first, groups: grouped.groups, canonical, interchange: interchanges[0], header259 }
}
type PhysicalSource = NonNullable<ReturnType<typeof physicalSource>>

/** Narrow genuine SDK result extensions, then retain only immutable primitives. */
function qualifyLegal(legal: EdielSourceLegalContext, source: EdielMessageRow, physical: PhysicalSource): LegalBasis | null {
  const basis: unknown = legal
  if (!isEvidenceRecord(basis)) return null
  const projection = basis.canonicalProjection
  const receivers = physical.wire.segments.filter(token =>
    token.tag === 'NAD' && segmentComposite(token, 1, physical.wire.una)[0] === 'DO')
  const received = parseSourceReceiptInstant(source.message_received_at)
  if (legal.basisKind !== 'observed_source_persistence' || legal.companyId !== source.company_id
    || legal.environment !== source.environment || legal.direction !== 'inbound'
    || basis.family !== 'PRODAT' || basis.code !== 'Z10' || basis.subtype !== 'M'
    || !isEvidenceUuid(legal.legalActorId) || !isEvidenceUuid(legal.transportActorId)
    || legal.actorRole !== 'electricity_supplier' || receivers.length !== 1
    || legal.legalEdielId !== segmentComposite(receivers[0], 2, physical.wire.una)[0]
    || legal.transportEdielId !== segmentComposite(physical.interchange, 3, physical.wire.una)[0]
    || legal.applicationReference !== physical.canonical.applicationReference
    || received === null || parseSourceReceiptInstant(legal.sourceReceivedAt) !== received
    || parseSourceReceiptInstant(legal.observedAt) === null
    || typeof basis.sourceEdition !== 'string' || !/^[a-f0-9]{64}$/.test(basis.sourceEdition)
    || !isEvidenceRecord(projection) || projection.family !== 'PRODAT' || projection.code !== 'Z10'
    || projection.subtype !== 'M' || projection.transactionReasonCode !== 'E58'
    || typeof projection.direction !== 'string' || !['inbound', 'both'].includes(projection.direction)
    || !Array.isArray(projection.applicationReferences)
    || !projection.applicationReferences.every(value => typeof value === 'string')
    || !projection.applicationReferences.includes(legal.applicationReference)
    || !Array.isArray(projection.receiverRoles) || !projection.receiverRoles.every(value => typeof value === 'string')
    || !projection.receiverRoles.some(role => role === 'supplier' || role === 'electricity_supplier')) return null
  return Object.freeze({
    sourceEdition: basis.sourceEdition,
    projection: Object.freeze({
      family: projection.family, code: projection.code, subtype: projection.subtype,
      transactionReasonCode: projection.transactionReasonCode, direction: projection.direction,
      applicationReferences: Object.freeze([...projection.applicationReferences]),
      receiverRoles: Object.freeze([...projection.receiverRoles]),
    }),
  })
}

function receptionMatches(reception: InboundReception | null, source: EdielMessageRow): reception is InboundReception {
  if (!reception) return false
  const hash = evidenceHash(source.raw_payload!)
  return reception.companyId === source.company_id && reception.sourceMessageId === source.id
    && reception.inboundEmailMessageId === source.inbound_email_message_id
    && reception.classification === 'first_reception' && reception.status === 'observed'
    && isEvidenceUuid(reception.receptionId) && isEvidenceUuid(reception.parseResultId)
    && reception.businessEffectAuthorized === false && reception.responseRequestId === null && reception.reason === null
    && reception.canonicalPayloadHash === hash && reception.receivedPayloadHash === hash
    && parseSourceReceiptInstant(reception.receivedAt) === parseSourceReceiptInstant(source.message_received_at)
}

/** Return only a checked primitive before the next SDK await begins. */
async function readAndMatchMail(source: EdielMessageRow): Promise<boolean> {
  const { data, error } = await tenantSelect(source.company_id!, 'inbound_email_messages',
    'id,company_id,environment,received_at,raw_edifact_payload')
    .eq('id', source.inbound_email_message_id!)
    .eq('environment', source.environment).maybeSingle()
  if (error) throw error
  if (!isEvidenceRecord(data)) return false
  const observed = {
    id: data.id, companyId: data.company_id, environment: data.environment,
    receivedAt: data.received_at, rawPayload: data.raw_edifact_payload,
  }
  return observed.id === source.inbound_email_message_id && observed.companyId === source.company_id
    && observed.environment === source.environment && observed.rawPayload === source.raw_payload
    && parseSourceReceiptInstant(observed.receivedAt) === parseSourceReceiptInstant(source.message_received_at)
}

async function readAndMatchParse(source: EdielMessageRow, parseResultId: string): Promise<boolean> {
  const { data, error } = await tenantSelect(source.company_id!, 'inbound_ediel_parse_results',
    'id,company_id,inbound_email_message_id,raw_payload,parse_status')
    .eq('id', parseResultId).maybeSingle()
  if (error) throw error
  if (!isEvidenceRecord(data)) return false
  const observed = {
    id: data.id, companyId: data.company_id, inboundEmailMessageId: data.inbound_email_message_id,
    rawPayload: data.raw_payload, parseStatus: data.parse_status,
  }
  return observed.id === parseResultId && observed.companyId === source.company_id
    && observed.inboundEmailMessageId === source.inbound_email_message_id
    && observed.rawPayload === source.raw_payload && observed.parseStatus === 'parsed'
}

async function readAndMatchMailAndParse(source: EdielMessageRow, parseResultId: string): Promise<boolean> {
  // Each helper consumes its SDK result immediately and returns only boolean;
  // no mail response/data alias survives into the later parse READ.
  if (!await readAndMatchMail(source)) return false
  return readAndMatchParse(source, parseResultId)
}

/** Source-only READ; no rule-pack capture, source writes or business permission. */
export async function loadProdatZ10OwnSourceReadingContext(
  source: EdielMessageRow,
  actorUserId: string,
): Promise<ProdatZ10OwnSourceReadingContext | null> {
  const original = captureBasis(source)
  if (!original || !isEvidenceUuid(actorUserId) || !physicalSource(original.source)) return null
  const companyId = original.source.company_id!
  const messageId = original.source.id
  const inboundEmailMessageId = original.source.inbound_email_message_id!
  await assertEdielTenantActor({ companyId, actorUserId, permission: 'communication.read' })
  const storedRow = await getEdielMessageById(messageId, { companyId })
  const stored = storedRow && captureBasis(storedRow)
  if (!stored || stored.identity !== original.identity) return null
  const physical = physicalSource(stored.source)
  if (!physical) return null
  const legal = await requireEdielInboundLegalContext(companyId, messageId)
  const legalBasis = qualifyLegal(legal, stored.source, physical)
  if (!legalBasis) return null
  const reception = await readInboundReceptionRequest({ companyId, messageId, inboundEmailMessageId, actorUserId })
  if (!receptionMatches(reception, stored.source)) return null
  const parseResultId = reception.parseResultId
  if (!await readAndMatchMailAndParse(stored.source, parseResultId)) return null
  const finalRow = await getEdielMessageById(messageId, { companyId })
  const final = finalRow && captureBasis(finalRow)
  if (!final || final.identity !== stored.identity || !physicalSource(final.source)) return null
  await assertEdielTenantActor({ companyId, actorUserId, permission: 'communication.read' })
  const context = Object.freeze({}) as ProdatZ10OwnSourceReadingContext
  reads.set(context, Object.freeze({ ...stored, ...legalBasis, actor: actorUserId }))
  return context
}

/** Consume exactly one private READ at the internally selected compiled policy. */
export function sourceProdatZ10OwnRegisterReadingDeclarations(input: {
  message: EdielMessageRow
  actorUserId: string
  context?: ProdatZ10OwnSourceReadingContext | null
  policy: CanonicalEdielPolicy
  admissionAt?: string | Date
}): ReadingObjects | null {
  const read = input.context ? reads.get(input.context) : undefined
  if (!read) return null
  // Failed redemption cannot be retried with repaired caller facts.
  reads.delete(input.context!)
  const caller = captureBasis(input.message)
  if (read.actor !== input.actorUserId || !caller || caller.identity !== read.identity) return null
  const source = read.source
  const physical = physicalSource(source)
  if (!physical) return null
  if (input.admissionAt instanceof Date && !Number.isFinite(input.admissionAt.getTime()))
    throw Error('prodat_source_readings_admission_clock_mismatch')
  const explicit = input.admissionAt instanceof Date ? input.admissionAt.toISOString() : input.admissionAt
  if (explicit !== undefined && explicit !== ''
    && parseSourceReceiptInstant(explicit) !== parseSourceReceiptInstant(source.message_received_at))
    throw Error('prodat_source_readings_admission_clock_mismatch')
  const expected = resolveCanonicalEdielPolicy({
    family: 'PRODAT', messageCode: 'Z10', subtypeOrReasonCode: physical.canonical.subtype,
    direction: 'inbound', referenceDate: stockholmBusinessDate(new Date(source.message_received_at!)),
    associationAssignedCode: physical.canonical.version,
    applicationReference: physical.canonical.applicationReference, mode: 'parse',
  })
  const keys = ['family', 'code', 'subtype', 'transactionReasonCode', 'direction', 'referenceDate',
    'associationAssignedCode', 'applicationReference', 'guide', 'fieldRules'] as const
  if (keys.some(key => !isDeepStrictEqual(input.policy[key], expected[key]))
    || expected.guide.guideRevision !== '26-A' || expected.guide.associationAssignedCode !== 'E2SE6A'
    || expected.guide.fieldMatrixStatus !== 'certified') throw Error('prodat_z10_own_source_readings_policy_unqualified')
  const rules = expected.fieldRules.filter((rule): rule is RulebookFieldRule =>
    'fieldNumber' in rule && rule.fieldNumber === '259')
  if (rules.length !== 1 || rules[0].segmentPath !== 'CCI++Z16/CAV')
    throw Error('prodat_z10_own_source_readings_policy_unqualified')
  const rule259 = rules[0]
  return physical.first.map(own => {
    const identityAgency = own.identityAgency
    if (identityAgency !== '9' && identityAgency !== '89') throw Error('prodat_z10_own_source_readings_scope_unqualified')
    const state = prodatRegisterReadingState('259', own.segments, physical.wire.una)
    const siblings = physical.groups.filter(group => group.messageIndex === own.messageIndex
      && group.itemId === own.itemId && group.identityAgency === own.identityAgency)
    const malformed = siblings.some(group => !group.validRegisterChain
      || prodatRegisterReadingState('259', group.segments, physical.wire.una).malformed)
    const allowed = !rule259.allowedValues || state.value !== null && rule259.allowedValues.includes(state.value)
    return Object.freeze({
      meteringPointId: own.itemId!, identityAgency,
      meterReadingsSentInUtilts: !physical.header259 && !malformed && state.present
        && !state.malformed && state.value !== null && allowed ? true : null,
    })
  })
}
