import {qualifyAssignedProdatHeaderNegativeAck} from '@/lib/ediel/ack/prodatAssignedHeaderNegativeAckValidation'
import {requiresBilateralProdatOutboundOwner,qualifyPersistedBilateralProdatOutboundOriginal,bilateralProdatOutboundDraftQualified,type QualifiedBilateralProdatOutboundDraft} from '@/lib/ediel/production/bilateralProdatOutboundDraft'
import {technicalSyntaxAckQualification,readPersistedEdielTechnicalContrlBasis,type TechnicalSyntaxAckEvidence} from '@/lib/ediel/ack/technicalSyntaxAuthority'
import {commonHeaderOriginalSource,prodatCommonHeaderRejectionQualification,readPersistedProdatCommonHeaderNegativeAckBasis,type ProdatCommonHeaderRejectionEvidence} from '@/lib/ediel/ack/prodatCommonHeaderRejectionAuthority'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {readSourceBoundAckRulePackEvidence,readPersistedOutboundAckRulePackEvidence,sourceQualifiedOutboundAck,sourceBoundAckCanonicalPolicy,type SourceQualifiedOutboundAck} from '@/lib/ediel/core/ackSourceRulePackEvidence'
import {validateCanonicalAckGuide} from './ackGuidePolicy'
import { requestedEdielCapability } from '@/lib/ediel/core/futureCapabilityPolicy'
import { canonicalAdmissionDate, resolveCanonicalMessagePolicy, resolveEdielMessageTimeAnchors } from '@/lib/ediel/core/messagePolicy'
import { stockholmBusinessDate } from '@/lib/ediel/core/executionContext'
import { prodatFreeTextSendIssues } from '@/lib/ediel/prodat/prodatFreeText'
import {gasApplicabilitySendIssue} from '@/lib/ediel/prodat/prodatGasAuthority'
import {validateProdatGasApplicability} from './prodatGasApplicabilityPolicy'
import type {GasSerialChangeSelection} from '@/lib/ediel/prodat/prodatGasApplicability'
import {deathStatusSendIssue,assertDeathStatusContextMatches,type DeathStatusValidationContext} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {validateProdatDeathStatus} from './prodatDeathStatusPolicy'
import type {DeathSelection} from '@/lib/ediel/prodat/prodatDeathStatus'
import type {MeterChangeSelection} from '@/lib/ediel/prodat/prodatMeterChangeFacts'
import {meterChangeSendIssue} from '@/lib/ediel/prodat/prodatMeterChangeAuthority'
import {validateProdatMeterChange} from './prodatMeterChangePolicy'
import {evaluateProdatTransactionReason} from '@/lib/ediel/prodat/prodatTransactionReason'
import {reportingAuthorityIssue} from '@/lib/ediel/prodat/prodatReportingPermissionAuthority'
import type {ExpectedContext} from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import {validateProdatReportingPermission} from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import {prodatDateEventAuthorityIssue} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import {validateProdatDateEvents} from './prodatDateEventPolicy'
import type {ProdatDateEventRow,ProdatDateEventValidationContext} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import {validateProdatInvoicee} from '@/lib/ediel/rulebook/prodatInvoiceePolicy'
import {validateProdatEndUserAddress} from './prodatEndUserAddressPolicy'
import { validateProdatRegisterPayload } from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import { prodatSendMessageScopeIssue } from '@/lib/ediel/prodat/prodatSendMessageScope'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { readProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna } from '@/lib/ediel/core/una'
import type { CreateEdielMessageInput, EdielDirection, EdielMessageRow } from '@/lib/ediel/types'
import {isRequestedChangeBasisQualified,requestedChangeRegisterFacts,requestedChangeWireDeathSelection,type RequestedChangeBasis} from '@/lib/ediel/production/requestedChangeSource'
import { parseRulebookMessage, type ParsedRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import { parseRulebookWirePayload } from './messageFormatParser'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'
import { resolveCanonicalEdielPolicy, isCanonicalProdatOwnWireDependentCondition, type CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { validateCanonicalPolicyFields } from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import { usesUtiltsAperakProfile } from '@/lib/ediel/aperakEngine'
import { resolveCanonicalRulePack } from '@/lib/ediel/rulebook/canonicalRulePackRegistry'
import { selectRulebookVersion } from '@/lib/ediel/rulebook/versionSelector'
import type { RegistryRulePackSnapshot } from '@/lib/ediel/rulebook/fieldRuleRegistry'
import {
  validateRulebookMessage as validateLegacyRulebookMessage,
  validateRulebookMessageWithRegistry as validateLegacyRulebookMessageWithRegistry,
  type RulebookValidationInput as LegacyRulebookValidationInput,
  type RulebookValidationResult as LegacyRulebookValidationResult,
} from '@/lib/ediel/rulebook/validatorLegacy'
import type { ProdatDependentConditionEvaluation } from '@/lib/ediel/prodat/prodatDependentConditionEngine'
import type {CustomerMasterdataValidationContext} from '@/lib/ediel/production/customerMasterdataSource'
import {customerMasterdataSendIssue,customerMasterdataRenderingIssue,type CustomerMasterdataSourceRow,type CustomerMasterdataRenderingSource} from '@/lib/ediel/prodat/customerMasterdataAuthority'

export type RulebookValidationInput = LegacyRulebookValidationInput & {
  /** Explicit local assessment time; sender DTM137 never admits a guide. */
  admissionAt?: string | Date
  messageRow?: EdielMessageRow
  /** Current authenticated server executor; a retained creator is source history. */
  executionActorUserId?: string
  /** Actual private source RPC capability; caller JSON supplies no authority. */
  bilateralDraftQualification?:QualifiedBilateralProdatOutboundDraft|null
  bilateralDraft?:CreateEdielMessageInput
  bilateralDraftActorUserId?:string
  requestedChangeBasis?:RequestedChangeBasis
  requestedChangeRow?:CreateEdielMessageInput|EdielMessageRow
  /** Protected actual-original port for a pre-persistence reverse ACK draft. */
  ackSourceQualification?:SourceQualifiedOutboundAck
  /** Protected syntax-only endpoint authority; never a business rule pack. */
  technicalSyntaxAckEvidence?:TechnicalSyntaxAckEvidence
  /** Source-only common-header national rejection, never a code profile. */
  prodatCommonHeaderRejectionEvidence?:ProdatCommonHeaderRejectionEvidence
  /** Explicit pure receiver knowledge, never incoming parsed metadata. */
  gasSerialChange?:GasSerialChangeSelection
  deathStatus?:DeathSelection
  deathStatusContext?:DeathStatusValidationContext
  customerMasterdataContext?:CustomerMasterdataValidationContext
  validationPurpose?:'render'|'outbound_original'|'send'
  customerMasterdataRenderingSource?:CustomerMasterdataRenderingSource
  customerMasterdataRow?:CustomerMasterdataSourceRow
  deathStatusRow?:Parameters<typeof assertDeathStatusContextMatches>[0]
  meterChange?:MeterChangeSelection
  /** Draft metadata from the canonical renderer. Used to verify that production
   * PRODAT D-conditions were already resolved with the original business facts. */
  dateEventRow?:ProdatDateEventRow
  dateEventContext?:ProdatDateEventValidationContext
  reportingContext?:ExpectedContext
  parsedPayload?: Record<string, unknown> | null
}

function qualifiedLifeEventContext(input:RulebookValidationInput):DeathStatusValidationContext|undefined{
  const context=input.deathStatusContext
  if(!context)return undefined
  const row=input.deathStatusRow??input.messageRow??{...input.dateEventRow,raw_payload:input.rawPayload,
    message_code:input.code,company_id:input.companyId,environment:input.environment,direction:input.direction}
  assertDeathStatusContextMatches(row,context)
  return context
}

function sourceQualifiedProdatFacts(input:RulebookValidationInput,code:string,rawSegments:string[],una:ReturnType<typeof parseUna>){
  const facts=input.mode==='send'?protectedRegisterFacts(input,code,rawSegments,una)

    :{meterChange:input.meterChange,deathStatus:input.deathStatus,gasSerialChange:input.gasSerialChange}
  const context=qualifiedLifeEventContext(input)
  return context?{...facts,deathStatus:context.selection,businessContext:context.businessContext}:facts
}

export type RulebookValidationResult = Omit<LegacyRulebookValidationResult,'fieldRuleSource'> & { canonicalPolicy?: CanonicalEdielPolicy; fieldRuleSource:'static'|'registry'|'technical_source'|'common_header_source';technicalSyntaxAckEvidence?:TechnicalSyntaxAckEvidence;prodatCommonHeaderRejectionEvidence?:ProdatCommonHeaderRejectionEvidence }

type ActiveCanonicalFamily = 'PRODAT' | 'UTILTS' | 'UTILTS_ERR' | 'APERAK' | 'CONTRL'
type BusinessRulePackFamily = 'PRODAT' | 'UTILTS'
type SourceBoundAckFamily = 'UTILTS_ERR' | 'APERAK' | 'CONTRL'

const ACTIVE_CANONICAL_FAMILIES: readonly ActiveCanonicalFamily[] = [
  'PRODAT',
  'UTILTS',
  'UTILTS_ERR',
  'APERAK',
  'CONTRL',
] as const

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function normalizeIdentifier(value: unknown): string {
  return String(value ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase()
}

function issue(input: Omit<EdielRulebookIssue, 'blocking'> & { blocking?: boolean }): EdielRulebookIssue {
  return { ...input, blocking: input.blocking ?? input.severity === 'error' }
}

function parse(input: RulebookValidationInput): ParsedRulebookMessage | null {
  if (!input.rawPayload) return input.parsed ?? null
  return parseRulebookWirePayload({rawPayload:input.rawPayload,family:input.family})
}

/** A real PRODAT header selects the policy before any row/cached metadata.
 * Reparse its bytes rather than trusting a caller's parsed code or family. Other
 * formats and genuinely detached/structured inputs keep their existing path.
 */
function sourceBoundProdatInput(input: RulebookValidationInput): { input: RulebookValidationInput; failure?: RulebookValidationResult } {
  if (!input.rawPayload || !/^(?:UNA|UNB|UNH)/.test(input.rawPayload.trimStart())) return { input }
  const tokens = tokenizeEdifact(input.rawPayload)
  const scopeFailure = input.mode === 'send' ? prodatSendMessageScopeIssue(tokens) : null
  if (scopeFailure) return { input, failure: {
    ok: false, blocking: true, family: 'PRODAT', code: null, processGroup: 'unknown',
    expectedApplicationReference: null, parsed: null, issues: [scopeFailure],
    fieldRuleSource: 'static', rulePackSnapshot: null,
  } }
  const header = tokens.segments.find(segment => segment.tag === 'UNH')
  if (segmentComposite(header, 2, tokens.una)[0]?.trim().toUpperCase() !== 'PRODAT') return { input }
  const parsed = parseRulebookMessage(input.rawPayload)
  return { input: { ...input, family: 'PRODAT', code: parsed.code, parsed } }
}

function admissionDate(input: RulebookValidationInput): string {
  if (input.messageRow) return canonicalAdmissionDate(input.messageRow, { admissionAt: input.admissionAt })
  // Detached validation has no physical receipt. Its local assessment instant
  // is captured once, independently from the sender's document/business date.
  const value = input.admissionAt ?? new Date()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('ediel_admission_time_invalid')
  return stockholmBusinessDate(date)
}

function captureAdmission(input: RulebookValidationInput): RulebookValidationInput {
  if (input.admissionAt) return input
  return { ...input, admissionAt: input.messageRow
    ? resolveEdielMessageTimeAnchors(input.messageRow).admissionAt
    : new Date().toISOString() }
}

function isActiveCanonicalFamily(family: string): family is ActiveCanonicalFamily {
  return (ACTIVE_CANONICAL_FAMILIES as readonly string[]).includes(family)
}

function isBusinessRulePackFamily(family: ActiveCanonicalFamily): family is BusinessRulePackFamily {
  return family === 'PRODAT' || family === 'UTILTS'
}

function isSourceBoundAckFamily(family: ActiveCanonicalFamily): family is SourceBoundAckFamily {
  return family === 'UTILTS_ERR' || family === 'APERAK' || family === 'CONTRL'
}

function direction(input: RulebookValidationInput): EdielDirection | null {
  if (input.direction === 'inbound' || input.direction === 'outbound') return input.direction

  // A send validation is an outbound transport operation by definition. This is
  // the only safe implicit direction: parse/test payloads may represent either
  // side and therefore remain fail-closed unless the caller supplies direction.
  if (input.mode === 'send') return 'outbound'
  return null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function requestedChangeRow(input:RulebookValidationInput) {
 const row=input.messageRow??input.requestedChangeRow
 return row?{...row,raw_payload:input.rawPayload,message_code:input.code,message_family:input.family}:{raw_payload:input.rawPayload,message_code:input.code,message_family:input.family,parsed_payload:input.parsedPayload}
}

function protectedRegisterFacts(input:RulebookValidationInput,code:string,rawSegments:string[],una:ReturnType<typeof parseUna>) {
 const facts=readProdatRegisterEvidence({dateEventRow:input.dateEventRow,dateEventContext:input.dateEventContext,reportingContext:input.reportingContext,customerMasterdataContext:input.customerMasterdataContext,customerMasterdataRenderingSource:input.validationPurpose==='render'&&!input.messageRow?input.customerMasterdataRenderingSource:undefined,code,rawSegments,una,parsedPayload:input.parsedPayload,companyId:input.companyId,runId:typeof input.parsedPayload?.testRunId==='string'?input.parsedPayload.testRunId:null,stepNo:typeof input.parsedPayload?.stepNo==='number'?input.parsedPayload.stepNo:null})
 if(input.requestedChangeBasis){
  if(!isRequestedChangeBasisQualified(input.requestedChangeBasis,requestedChangeRow(input)))throw Error('requested_change_protected_basis_scope_invalid')
  return {...facts,...requestedChangeRegisterFacts(input.requestedChangeBasis),deathStatus:requestedChangeWireDeathSelection(input.requestedChangeBasis,input.rawPayload??'')}
 }
 return facts
}

function renderedDependentSnapshot(input: RulebookValidationInput): unknown[] | null {
  const payload = record(input.parsedPayload)
  const engine = record(payload?.prodatEngine)
  const direct = engine?.dependentConditionStatuses ?? payload?.prodatDependentConditions
  return Array.isArray(direct) ? direct : null
}

function canonicalizeRenderedDependentSnapshot(input: {
  policy: CanonicalEdielPolicy
  snapshot: unknown[] | null
}): ProdatDependentConditionEvaluation[] | null {
  if (!input.snapshot) return null
  const byId = new Map<string, Record<string, unknown>>()
  for (const value of input.snapshot) {
    const row = record(value)
    const id = String(row?.id ?? '').trim()
    if (!id || byId.has(id)) return null
    byId.set(id, row ?? {})
  }
  if (byId.size !== input.policy.prodatDependentConditions.length) return null

  const results: ProdatDependentConditionEvaluation[] = []
  for (const canonical of input.policy.prodatDependentConditions) {
    const row = byId.get(canonical.id)
    if (!row) return null
    const status = String(row.status ?? '')
    if (status !== 'required' && status !== 'not_required' && status !== 'undetermined') return null
    if (String(row.fieldNumber ?? '') !== canonical.fieldNumber) return null
    results.push({
      ...canonical,
      status,
    })
  }
  return results
}

function parsedAssociationAssignedCode(parsed: ParsedRulebookMessage): string | null {
  const una = parsed.una ?? parseUna(null)
  const tokens = tokenizeEdifact(`${una.raw}${parsed.rawSegments.join(una.segmentTerminator)}${una.segmentTerminator}`)
  const messageType = segmentComposite(tokens.segments.find(segment => segment.tag === 'UNH'), 2, una)
  const association = normalizeIdentifier(messageType[4])
  return association || null
}

function associationAssignedCodeForPolicy(input: {
  family: ActiveCanonicalFamily
  code: string
  providedVersion: string | null | undefined
  referenceDate: string
  sourceBoundAck: boolean
  sourceMessageFamily?: string | null
}): string | null {
  const providedRaw = String(input.providedVersion ?? '').trim()
  const provided = normalizeIdentifier(providedRaw)

  if (input.sourceBoundAck) {
    if (input.family !== 'APERAK') return null

    const sourceFamily = normalize(input.sourceMessageFamily)
    if (sourceFamily === 'PRODAT') return 'E2SE6A'
    if (usesUtiltsAperakProfile(sourceFamily)) return 'E5SE5A'

    // Inbound APERAK and raw-payload preflight do not necessarily carry our
    // internal source metadata. The actual UNH association is still sufficient
    // to select the source-bound guide. Legacy 16B is deliberately not accepted.
    if (provided === 'E2SE6A') return 'E2SE6A'
    if (provided === 'E5SE5A') return 'E5SE5A'
    throw new Error(`canonical_aperak_source_profile_required:${sourceFamily || provided || 'missing'}`)
  }

  if (!providedRaw) return null
  if (input.family !== 'PRODAT') return providedRaw

  // PRODAT persists the human guide revision (for example 26A) as the runtime
  // message version, while the UNH association-assigned code is E2SE6A. Do not
  // feed a guide revision into the association-code selector. Unknown versions
  // are deliberately returned unchanged so canonical policy still fails closed.
  const selection = selectRulebookVersion({
    family: 'PRODAT',
    code: input.code,
    referenceDate: input.referenceDate,
  })
  const selectedVersion = normalizeIdentifier(selection.selectedVersion)
  const guideRevision = normalizeIdentifier(selection.guideRevision)
  if (provided === selectedVersion || provided === guideRevision) return null
  return providedRaw
}

function assertAckFamilyRuntimeVersion(input: {
  family: SourceBoundAckFamily
  providedVersion: string | null | undefined
  referenceDate: string
  policy: CanonicalEdielPolicy
  sourceMessageFamily?: string | null
}): void {
  const provided = normalizeIdentifier(input.providedVersion)
  if (!provided) return

  let sourceFamily = normalize(input.sourceMessageFamily)
  if (input.family === 'APERAK' && !sourceFamily) {
    if (provided === 'E2SE6A') sourceFamily = 'PRODAT'
    if (provided === 'E5SE5A') sourceFamily = 'UTILTS'
  }

  const selection = selectRulebookVersion({
    family: input.family,
    code: input.policy.code,
    referenceDate: input.referenceDate,
    sourceMessageFamily: input.family === 'APERAK' ? sourceFamily : null,
  })
  const accepted = new Set([
    normalizeIdentifier(selection.selectedVersion),
    normalizeIdentifier(input.policy.guide.guideRevision),
    normalizeIdentifier(input.policy.guide.associationAssignedCode),
    ...(input.family === 'APERAK' && usesUtiltsAperakProfile(sourceFamily) ? ['E5SE5A'] : []),
    ...(input.family === 'APERAK' && sourceFamily === 'PRODAT' ? ['E2SE6A'] : []),
  ].filter(Boolean))

  if (!accepted.has(provided)) {
    throw new Error(
      `canonical_ediel_version_not_allowed:${input.family}:${provided}:${[...accepted].join(',')}`,
    )
  }
}

function policyForValidation(input: RulebookValidationInput, parsed: ParsedRulebookMessage): CanonicalEdielPolicy {
  const familyValue = normalize(input.family ?? parsed.family)
  if (!isActiveCanonicalFamily(familyValue)) {
    throw new Error(`canonical_policy_family_required:${familyValue || 'missing'}`)
  }
  const code = canonicalMessageCode(familyValue, normalize(input.code ?? parsed.code))
  const dir = direction(input)
  if (!dir) throw new Error(`canonical_policy_direction_required:${familyValue}:${code}`)
  if (familyValue === 'UTILTS' && dir === 'inbound' && input.messageRow) {
    const retained = resolveCanonicalMessagePolicy(input.messageRow, undefined, { admissionAt: input.admissionAt })
    if (!retained) throw new Error('canonical_policy_family_required:UTILTS')
    return retained
  }
  const referenceDate = admissionDate(input)
  const sourceBoundAck = isSourceBoundAckFamily(familyValue)
  const sourceMessageFamily = record(input.parsedPayload)?.canonicalSourceMessageFamily as string | null | undefined
  const providedVersion = input.version ?? (familyValue === 'APERAK' ? parsedAssociationAssignedCode(parsed) : null)
  const associationAssignedCode = associationAssignedCodeForPolicy({
    family: familyValue,
    code,
    providedVersion,
    referenceDate,
    sourceBoundAck,
    sourceMessageFamily,
  })

  const policy = resolveCanonicalEdielPolicy({
    family: familyValue,
    requestedCapability: requestedEdielCapability({ message_intent: input.messageRow?.message_intent ?? null, parsed_payload: input.parsedPayload ?? {} }),
    messageCode: code,
    subtypeOrReasonCode: parsed.subtype,
    prodatDependentFacts: sourceQualifiedProdatFacts(input,code,parsed.rawSegments,parseUna(input.rawPayload)),
    businessContext:qualifiedLifeEventContext(input)?.businessContext,
    direction: dir,
    referenceDate,
    // Runtime guide aliases such as PRODAT 26A and CONTRL aliases are not UNH
    // association codes. APERAK is the exception: its source-bound association
    // is required to select the correct P- or U-family guide.
    associationAssignedCode,
    applicationReference: input.applicationReference ?? parsed.applicationReference ?? null,
    bilateralCapabilityVerified:qualifiedLifeEventContext(input)?.bilateralCapabilityVerified||(input.bilateralDraft&&input.bilateralDraftActorUserId?bilateralProdatOutboundDraftQualified({draft:input.bilateralDraft,actorUserId:input.bilateralDraftActorUserId,qualification:input.bilateralDraftQualification}):false),
    mode:input.mode==='send'&&input.bilateralDraftQualification?'parse':input.mode==='send'?'catalog_evidence':'parse',
  })

  if (sourceBoundAck) {
    assertAckFamilyRuntimeVersion({
      family: familyValue,
      providedVersion,
      referenceDate,
      policy,
      sourceMessageFamily,
    })
    if(input.ackSourceQualification){
      const qualification=sourceQualifiedOutboundAck({qualification:input.ackSourceQualification,companyId:input.companyId,environment:input.environment})
      if(!qualification||dir!=='outbound')throw new Error('ack_source_qualification_required')
      return sourceBoundAckCanonicalPolicy({qualification,policy})
    }
  }

  if (familyValue !== 'PRODAT' || input.mode !== 'send') return policy
  const snapshot = canonicalizeRenderedDependentSnapshot({
    policy,
    snapshot: renderedDependentSnapshot(input),
  })
  const production = input.environment === 'production'
  if (!snapshot) {
    if (production) throw new Error(`prodat_canonical_policy_snapshot_missing:${code}`)
    return policy
  }
  if (production && snapshot.some((condition) => condition.status === 'undetermined'&&!isCanonicalProdatOwnWireDependentCondition(condition))) {
    const ids = snapshot.filter((condition) => condition.status === 'undetermined'&&!isCanonicalProdatOwnWireDependentCondition(condition)).map((condition) => condition.id)
    throw new Error(`prodat_dependent_condition_undetermined:${ids.join(',')}`)
  }
  return { ...policy, prodatDependentConditions: snapshot }
}

function canonicalValidation(input: RulebookValidationInput, inheritedAckPolicy?:CanonicalEdielPolicy): RulebookValidationResult {
  const parsed = parse(input)
  const family = normalize(input.family ?? parsed?.family)
  const code = normalize(input.code ?? parsed?.code)
  const parserIssues: EdielRulebookIssue[] = [
    ...(parsed?.errors ?? []).map((description) => issue({ severity: 'error', code: 'PARSER_ERROR', title: 'Parserfel', description })),
    ...(parsed?.warnings ?? []).map((description) => issue({ severity: 'warning', code: 'PARSER_WARNING', title: 'Parser-varning', description })),
  ]
  // Raw admission shares the source-owned0062 bound and0035 test marker
  // with envelope validation. These service diagnostics never select a guide.
  if (input.rawPayload && parsed?.rawSegments.some(segment => segment.startsWith('UNH'))) {
    parserIssues.push(...validateEdifactEnvelope(input.rawPayload).issues
      .filter(entry => entry.code === 'message_reference_length_invalid' || entry.code === 'unb_test_indicator_invalid')
      .map(entry => issue({ severity: entry.severity, code: entry.code, title: entry.code === 'unb_test_indicator_invalid' ? 'EDIFACT-testindikator' : 'EDIFACT-meddelandereferens', description: entry.message })))
  }

  if (!parsed) {
    const issues = [...parserIssues, issue({ severity: 'error', code: 'CANONICAL_PAYLOAD_REQUIRED', title: 'Payload saknas', description: `${family} ${code} kan inte valideras utan payload.` })]
    return { ok: false, blocking: true, family: family || null, code: code || null, processGroup: 'unknown', expectedApplicationReference: null, parsed: null, issues, fieldRuleSource: 'static', rulePackSnapshot: null }
  }

  try {
    const policy = inheritedAckPolicy ?? policyForValidation(input, parsed)
    if (input.processGroup && policy.processGroup && String(input.processGroup).trim() !== policy.processGroup) {
      parserIssues.push(issue({
        severity: 'error',
        code: 'CANONICAL_PROCESS_GROUP_MISMATCH',
        title: 'Processgrupp matchar inte canonical policy',
        description: `${family} ${code} tillhör ${policy.processGroup}, men anropet anger ${input.processGroup}.`,
      }))
    }

    let fieldIssues = validateCanonicalPolicyFields({reportingContext:input.reportingContext, policy, rawPayload:input.rawPayload,rawSegments: parsed.rawSegments, una: parseUna(input.rawPayload) })
    if(input.ackSourceQualification&&isSourceBoundAckFamily(policy.family as ActiveCanonicalFamily)){
      const qualification=sourceQualifiedOutboundAck({qualification:input.ackSourceQualification,companyId:input.companyId,environment:input.environment})
      if(!qualification)throw new Error('ack_source_qualification_required')
      fieldIssues.push(...validateCanonicalAckGuide({policy,rawPayload:input.rawPayload,rawSegments:parsed.rawSegments,una:parsed.una,sourceRawPayload:qualification.sourceMessage.raw_payload}))
    }
    if (input.mode === 'send' && input.environment !== 'production') {
      fieldIssues = fieldIssues.map((entry) =>
        entry.code === 'PRODAT_DEPENDENT_CONDITION_UNDETERMINED' && entry.scope !== 'prodat_register' && entry.scope !== 'prodat_dependent'
          ? { ...entry, severity: 'warning' as const, blocking: false }
          : entry,
      )
    }
    if(input.mode==='send'&&policy.family==='PRODAT')fieldIssues.push(...validateProdatReportingPermission({code:policy.code,rawSegments:parsed.rawSegments,una:parseUna(input.rawPayload),facts:policy.prodatDependentFacts,requireAuthority:true,reportingContext:input.reportingContext}))
    if(input.mode==='send'&&policy.family==='PRODAT')fieldIssues.push(...validateProdatDateEvents({code:policy.code,rawSegments:parsed.rawSegments,una:parseUna(input.rawPayload),facts:policy.prodatDependentFacts,requireAuthority:true,dateEventContext:input.dateEventContext}))
    const issues = [...parserIssues, ...fieldIssues]
    const blocking = issues.some((entry) => entry.severity === 'error' || entry.blocking)
    return {
      ok: !blocking,
      blocking,
      family: policy.family,
      code: policy.code,
      processGroup: policy.processGroup ?? 'unknown',
      expectedApplicationReference: policy.applicationReference,
      canonicalPolicy: policy,
      parsed,
      issues,
      fieldRuleSource: 'static',
      rulePackSnapshot: null,
    }
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error)
    const transactionReasonIssues=family==='PRODAT'
      ? evaluateProdatTransactionReason({code:parsed.code??code,rawSegments:parsed.rawSegments,una:parsed.una??parseUna(input.rawPayload)}).issues : []
    // Missing/invalid root policy metadata must not hide source-derived D
    // defects behind the legacy intentional-invalid-test escape hatch.
    const protectedDependentIssues = family === 'PRODAT' && input.mode === 'send'
      ? validateProdatSubtypePayload({family, code, rawSegments:parsed.rawSegments, una:parsed.una ?? parseUna(input.rawPayload)}) : []
    // A missing/stale production snapshot cannot bypass the same protected
    // register structure and policy used on the normal path. Body-bound facts are re-read;
    // snapshot statuses and intentional-invalid labels supply no authority.
    const gasIssues=family==='PRODAT'?validateProdatGasApplicability({code:parsed.code??code,rawSegments:parsed.rawSegments,una:parsed.una??parseUna(input.rawPayload),direction:input.mode==='send'?'outbound':'inbound',facts:{gasSerialChange:input.gasSerialChange}}):[]
    const deathIssues = family==='PRODAT'?validateProdatDeathStatus({code:parsed.code??code,rawSegments:parsed.rawSegments,una:parsed.una??parseUna(input.rawPayload),direction:input.mode==='send'?'outbound':'inbound',facts:{deathStatus:qualifiedLifeEventContext(input)?.selection??input.deathStatus}}):[]
    const protectedRegisterIssues: EdielRulebookIssue[] = input.mode==='parse'&&family==='PRODAT'?validateProdatMeterChange({code:parsed.code??code,rawSegments:parsed.rawSegments,una:parsed.una??parseUna(input.rawPayload),direction:'inbound',applicationReference:parsed.applicationReference,facts:{meterChange:input.meterChange}}):[]
    if (family === 'PRODAT' && input.mode === 'send' && !description.startsWith('prodat_register_evidence_')) {
      try {
        const wireCode = parsed.code ?? code
        const una = parsed.una ?? parseUna(input.rawPayload)
        const facts = sourceQualifiedProdatFacts(input,wireCode,parsed.rawSegments,una)
        protectedRegisterIssues.push(...validateProdatReportingPermission({code:wireCode,rawSegments:parsed.rawSegments,una,facts,requireAuthority:true,reportingContext:input.reportingContext}))
        protectedRegisterIssues.push(...validateProdatDateEvents({code:wireCode,rawSegments:parsed.rawSegments,una,facts,requireAuthority:true,dateEventContext:input.dateEventContext}))
        protectedRegisterIssues.push(...validateProdatInvoicee({code:wireCode,rawSegments:parsed.rawSegments,una,facts}))
        protectedRegisterIssues.push(...validateProdatEndUserAddress({code:wireCode,rawSegments:parsed.rawSegments,una,facts}))
        protectedRegisterIssues.push(...validateProdatRegisterPayload({code:wireCode,rawSegments:parsed.rawSegments,una,facts,
          applicationReference:parsed.applicationReference ?? input.applicationReference,requireConditions:true}))
      } catch {
        protectedRegisterIssues.push({scope:'prodat_register',severity:'error',blocking:true,code:'PRODAT_REGISTER_EVIDENCE_INVALID',
          title:'Ogiltigt registerunderlag',description:'Registerfakta kunde inte knytas till det aktuella meddelandet.'})
      }
    }
    const authorityIssue=reportingAuthorityIssue(error)??prodatDateEventAuthorityIssue(error)
    const issues = [...parserIssues, ...transactionReasonIssues, ...gasIssues, ...deathIssues, ...protectedDependentIssues, ...protectedRegisterIssues, ...(authorityIssue?[authorityIssue]:[]), issue({
      severity: 'error',
      code: description.startsWith('prodat_register_evidence_') ? 'PRODAT_REGISTER_EVIDENCE_INVALID' : 'CANONICAL_POLICY_VALIDATION_FAILED',
      ...(description.startsWith('prodat_register_evidence_') ? {scope:'prodat_register' as const} : {}),
      title: 'Canonical Ediel-policy blockerade validering',
      description,
    })]
    return { ok: false, blocking: true, family: family || null, code: code || null, processGroup: 'unknown', expectedApplicationReference: null, parsed, issues, fieldRuleSource: 'static', rulePackSnapshot: null }
  }
}

/** One shared guide path for safely prescribed technical responses. This
 * authority grants only the protected syntax reply; legal/business approval
 * and a business pack are deliberately absent. Native provider-entry repeats
 * the exact immutable original/global-correlation/current-endpoint checks. */
function qualifyTechnicalContrl(input:RulebookValidationInput,result:RulebookValidationResult):RulebookValidationResult {
  const evidence=input.environment==='test'||input.environment==='production' ? technicalSyntaxAckQualification({evidence:input.technicalSyntaxAckEvidence,companyId:input.companyId ?? '',environment:input.environment}) : null
  const unavailable=()=>({...result,ok:false,blocking:true,issues:[...result.issues,issue({severity:'error',code:'CANONICAL_TECHNICAL_ACK_SOURCE_REQUIRED',title:'Skyddat tekniskt ursprung saknas',description:'CONTRL kräver den faktiska oföränderliga syntaxauktoriteten för samma företag och miljö.'})],rulePackSnapshot:null})
  if(!evidence||input.direction!=='outbound'||input.mode!=='send'||result.family!=='CONTRL'||!result.canonicalPolicy||!input.rawPayload||!result.parsed)return unavailable()
  const envelope=validateEdifactEnvelope(input.rawPayload)
  const syntaxIssues=envelope.issues.map(entry=>issue({severity:entry.severity,code:entry.code,title:'EDIFACT-kuvert',description:entry.message}))
  const own=validateCanonicalAckGuide({policy:result.canonicalPolicy,rawPayload:input.rawPayload,rawSegments:result.parsed.rawSegments,una:result.parsed.una,technicalOriginal:evidence})
  const issues=[...result.issues,...syntaxIssues,...own],blocking=issues.some(entry=>entry.blocking||entry.severity==='error')
  return {...result,ok:!blocking,blocking,issues,fieldRuleSource:'technical_source',rulePackSnapshot:null,technicalSyntaxAckEvidence:evidence}
}

function qualifyCommonHeaderNegativeAck(input:RulebookValidationInput,result:RulebookValidationResult):RulebookValidationResult {
  const evidence=input.environment==='test'||input.environment==='production'?prodatCommonHeaderRejectionQualification({evidence:input.prodatCommonHeaderRejectionEvidence,companyId:input.companyId??'',environment:input.environment}):null
  const unavailable=()=>({...result,ok:false,blocking:true,rulePackSnapshot:null,issues:[...result.issues,issue({severity:'error',code:'CANONICAL_COMMON_HEADER_SOURCE_REQUIRED',title:'Skyddat nationellt meddelandehuvud saknas',description:'En fält202-kvittens kräver den prospektivt frysta originalauktoriteten och faktiskt fastställd syntax.'})]})
  if(!evidence||input.direction!=='outbound'||input.mode!=='send'||result.family!=='APERAK'||!input.rawPayload||!result.parsed)return unavailable()
  const extended=qualifyAssignedProdatHeaderNegativeAck(input,result,evidence)
  if(extended)return extended
  if(!evidence.field202)return unavailable()
  const source=commonHeaderOriginalSource(evidence)
  if(!source?.raw_payload)return unavailable()
  const template=resolveCanonicalEdielPolicy({family:'APERAK',messageCode:'APERAK',direction:'outbound',referenceDate:stockholmBusinessDate(new Date(evidence.sourceReceivedAt)),associationAssignedCode:evidence.guide.associationAssignedCode,applicationReference:evidence.identities.applicationReference,mode:'parse'})
  const policy=Object.freeze({...template,guide:evidence.guide})
  const expectedGuide={...template.guide,family:'PRODAT'}
  if(JSON.stringify(Object.keys(expectedGuide).sort())!==JSON.stringify(Object.keys(evidence.guide).sort())||Object.entries(expectedGuide).some(([key,value])=>JSON.stringify(value)!==JSON.stringify(evidence.guide[key as keyof typeof evidence.guide])))return unavailable()
  const wire=tokenizeEdifact(input.rawPayload),errors=wire.segments.filter(t=>t.tag==='ERC'),texts=wire.segments.filter(t=>t.tag==='FTX'),bgms=wire.segments.filter(t=>t.tag==='BGM')
  const exact=errors.length===1&&texts.length===1&&bgms.length===1&&segmentComposite(bgms[0],3,wire.una)[0]==='27'
    &&JSON.stringify(segmentComposite(errors[0],1,wire.una))===JSON.stringify([evidence.field202.ercCode,'','260'])
    &&JSON.stringify(segmentComposite(texts[0],3,wire.una))===JSON.stringify(['202','','260'])
    &&JSON.stringify(segmentComposite(texts[0],4,wire.una))===JSON.stringify([evidence.field202.text])
  const syntax=validateEdifactEnvelope(input.rawPayload).issues.map(entry=>issue({severity:entry.severity,code:entry.code,title:'EDIFACT-kuvert',description:entry.message}))
  const guide=validateCanonicalAckGuide({policy,rawPayload:input.rawPayload,rawSegments:result.parsed.rawSegments,una:result.parsed.una,sourceRawPayload:source.raw_payload})
  const issues=[...result.issues,...syntax,...guide,...(exact?[]:[issue({severity:'error',code:'CANONICAL_COMMON_HEADER_NEGATIVE_SCOPE_INVALID',title:'Nationellt fält202-utfall avviker',description:'Den enda ERC/FTX-gruppen måste återge originalets fastställda header202-fel i en helt avvisande APERAK.'})])]
  const blocking=issues.some(entry=>entry.blocking||entry.severity==='error')
  return {...result,ok:!blocking,blocking,issues,canonicalPolicy:policy,fieldRuleSource:'common_header_source',rulePackSnapshot:null,prodatCommonHeaderRejectionEvidence:evidence}
}

export function validateRulebookMessage(input: RulebookValidationInput): RulebookValidationResult {
  input = captureAdmission(input)
  const freeText = input.mode === 'send' && input.direction !== 'inbound' ? prodatFreeTextSendIssues({ raw_payload: input.rawPayload, message_family: input.family, message_code: input.code }) : []
  const gasBoundary=input.mode==='send'&&input.direction!=='inbound'?gasApplicabilitySendIssue({message_code:input.code,message_family:input.family,raw_payload:input.rawPayload,parsed_payload:input.parsedPayload,application_reference:input.applicationReference}):null
  const deathBoundary=input.mode==='send'?deathStatusSendIssue(input.requestedChangeBasis?requestedChangeRow(input):(input.deathStatusRow??input.messageRow??{...input.dateEventRow,message_code:input.code,message_family:input.family,raw_payload:input.rawPayload,parsed_payload:input.parsedPayload,company_id:input.companyId,environment:input.environment,direction:input.direction}),input.deathStatusContext,input.requestedChangeBasis):null
  const masterdataBoundary=input.mode==='send'?input.customerMasterdataRenderingSource?customerMasterdataRenderingIssue({rawPayload:input.validationPurpose==='render'&&!input.messageRow?input.rawPayload:null,companyId:input.companyId,environment:input.environment,family:input.family,code:input.code,source:input.customerMasterdataRenderingSource}):customerMasterdataSendIssue({...input.messageRow??input.customerMasterdataRow??input.dateEventRow,message_code:input.code,message_family:input.family,raw_payload:input.rawPayload,company_id:input.companyId,environment:input.environment,direction:direction(input)},input.customerMasterdataContext):null
  const protect=(result:RulebookValidationResult):RulebookValidationResult=>deathBoundary||gasBoundary||masterdataBoundary||freeText.length?{...result,ok:false,blocking:true,issues:[...result.issues,...freeText.filter(entry => !result.issues.some(old => old.code === entry.code && old.description === entry.description)),...(deathBoundary?[deathBoundary]:[]),...(gasBoundary?[gasBoundary]:[]),...(masterdataBoundary?[masterdataBoundary]:[])]}:result

  const meterBoundary=input.mode==='send'?meterChangeSendIssue({message_code:input.code,message_family:input.family,raw_payload:input.rawPayload}):null
  if(meterBoundary)return protect({ok:false,blocking:true,family:'PRODAT',code:'Z10',processGroup:'unknown',expectedApplicationReference:null,parsed:null,issues:[meterBoundary],fieldRuleSource:'static',rulePackSnapshot:null})
  const source = sourceBoundProdatInput(input)
  if (source.failure) return protect(source.failure)
  input = source.input
  const parsed = parse(input)
  const family = normalize(input.family ?? parsed?.family)
  if (!isActiveCanonicalFamily(family)) return protect(validateLegacyRulebookMessage(input))
  const result=canonicalValidation({ ...input, parsed })
  return protect(input.prodatCommonHeaderRejectionEvidence?qualifyCommonHeaderNegativeAck(input,result):input.technicalSyntaxAckEvidence ? qualifyTechnicalContrl(input,result) : result)
}

export async function validateRulebookMessageWithRegistry(input: RulebookValidationInput): Promise<RulebookValidationResult> {
  input = captureAdmission(input)
  if (input.mode === 'send' && input.direction !== 'inbound' && prodatFreeTextSendIssues({ raw_payload: input.rawPayload, message_family: input.family, message_code: input.code }).length) return validateRulebookMessage(input)
  const gasBoundary=input.mode==='send'&&input.direction!=='inbound'?gasApplicabilitySendIssue({message_code:input.code,message_family:input.family,raw_payload:input.rawPayload,parsed_payload:input.parsedPayload,application_reference:input.applicationReference}):null
  const deathBoundary=input.mode==='send'?deathStatusSendIssue(input.requestedChangeBasis?requestedChangeRow(input):(input.deathStatusRow??input.messageRow??{...input.dateEventRow,message_code:input.code,message_family:input.family,raw_payload:input.rawPayload,parsed_payload:input.parsedPayload,company_id:input.companyId,environment:input.environment,direction:input.direction}),input.deathStatusContext,input.requestedChangeBasis):null
  const masterdataBoundary=input.mode==='send'?input.customerMasterdataRenderingSource?customerMasterdataRenderingIssue({rawPayload:input.validationPurpose==='render'&&!input.messageRow?input.rawPayload:null,companyId:input.companyId,environment:input.environment,family:input.family,code:input.code,source:input.customerMasterdataRenderingSource}):customerMasterdataSendIssue({...input.messageRow??input.customerMasterdataRow??input.dateEventRow,message_code:input.code,message_family:input.family,raw_payload:input.rawPayload,company_id:input.companyId,environment:input.environment,direction:direction(input)},input.customerMasterdataContext):null
  if(deathBoundary||gasBoundary||masterdataBoundary)return validateRulebookMessage(input) // Preserve existing protected diagnostics without registry I/O.

  const meterBoundary=input.mode==='send'?meterChangeSendIssue({message_code:input.code,message_family:input.family,raw_payload:input.rawPayload}):null
  if(meterBoundary)return {ok:false,blocking:true,family:'PRODAT',code:'Z10',processGroup:'unknown',expectedApplicationReference:null,parsed:null,issues:[meterBoundary],fieldRuleSource:'static',rulePackSnapshot:null}
  if(input.mode==='send'&&input.messageRow?.direction==='outbound'&&input.messageRow.message_family==='PRODAT'&&requiresBilateralProdatOutboundOwner({rawPayload:input.messageRow.raw_payload??''})){
    const qualified=await qualifyPersistedBilateralProdatOutboundOriginal(input.messageRow,input.executionActorUserId)
    input={...input,bilateralDraft:qualified.draft,bilateralDraftActorUserId:qualified.actorUserId,bilateralDraftQualification:qualified.qualification}
  }
  const source = sourceBoundProdatInput(input)
  if (source.failure) return source.failure
  input = source.input
  const parsed = parse(input)
  const familyValue = normalize(input.family ?? parsed?.family)
  if (!isActiveCanonicalFamily(familyValue)) return validateLegacyRulebookMessageWithRegistry(input)

  const result = canonicalValidation({ ...input, parsed })
  if(input.prodatCommonHeaderRejectionEvidence)return qualifyCommonHeaderNegativeAck(input,result)
  // Supplied evidence qualifies only fresh preparation. A persisted CONTRL send
  // always re-reads its private chain with the actual sender's current SEND phase.
  if(input.technicalSyntaxAckEvidence&&!(familyValue==='CONTRL'&&input.mode==='send'&&input.messageRow))return qualifyTechnicalContrl(input,result)
  // A source-bound response's national guide comes from the protected original.
  // Today's reason catalogue must not reject a genuine retained-guide reply
  // before that original is read. The same parser/guide checks run on the
  // inherited policy below; business-family blocking behavior is unchanged.
  if (!parsed || (result.blocking&&!isSourceBoundAckFamily(familyValue)) || !result.canonicalPolicy) return result
  const dir = direction(input)
  if (!dir) return { ...result, ok: false, blocking: true, issues: [...result.issues, issue({ severity: 'error', code: 'CANONICAL_EVIDENCE_DIRECTION_REQUIRED', title: 'Riktning saknas', description: 'Rule-pack evidence kräver explicit inbound/outbound-riktning.' })] }

  if(familyValue==='CONTRL'&&input.mode==='send'&&input.messageRow){
    try{
      if(!input.companyId||(input.environment!=='test'&&input.environment!=='production')||!input.rawPayload)throw new Error('ediel_technical_ack_basis_required')
      const {evidence}=await readPersistedEdielTechnicalContrlBasis({companyId:input.companyId,environment:input.environment,ackMessageId:input.messageRow.id,expectedRawPayload:input.rawPayload,actorUserId:input.executionActorUserId??'',phase:'send'})
      return qualifyTechnicalContrl({...input,technicalSyntaxAckEvidence:evidence},result)
    }catch(error){
      return {...result,ok:false,blocking:true,rulePackSnapshot:null,issues:[...result.issues,issue({severity:'error',code:'CANONICAL_TECHNICAL_ACK_SOURCE_REQUIRED',title:'Skyddat tekniskt ursprung saknas',description:error instanceof Error?error.message:String(error)})]}
    }
  }

  const executionSnapshot=input.messageRow?.execution_context_snapshot
  const commonHeaderWitness=executionSnapshot&&typeof executionSnapshot==='object'&&!Array.isArray(executionSnapshot)
    ? (executionSnapshot as Record<string,unknown>).prodatCommonHeaderNegativeWitnessId : null
  if(familyValue==='APERAK'&&input.mode==='send'&&input.messageRow&&commonHeaderWitness){
    try{
      if(!input.companyId||(input.environment!=='test'&&input.environment!=='production')||!input.rawPayload)throw Error('ediel_common_header_negative_witness_required')
      const {evidence}=await readPersistedProdatCommonHeaderNegativeAckBasis({companyId:input.companyId,environment:input.environment,ackMessageId:input.messageRow.id,expectedRawPayload:input.rawPayload})
      return qualifyCommonHeaderNegativeAck({...input,prodatCommonHeaderRejectionEvidence:evidence},result)
    }catch(error){return {...result,ok:false,blocking:true,rulePackSnapshot:null,issues:[...result.issues,issue({severity:'error',code:'CANONICAL_COMMON_HEADER_SOURCE_REQUIRED',title:'Skyddat nationellt meddelandehuvud saknas',description:error instanceof Error?error.message:String(error)})]}}
  }

  if (isSourceBoundAckFamily(familyValue)) {
    // ACK/error messages do not choose a second business rule pack. Outbound
    // ACKs inherit the exact activation/evidence snapshot from the source
    // business message. Inbound parsing is fully source-controlled and does not
    // require a mutable DB row to define protocol meaning.
    if (input.mode !== 'send') {
      if (!input.messageRow) return result
      try {
        const qualification=await readSourceBoundAckRulePackEvidence(input.messageRow),{sourceMessage,evidence}=qualification
        const policy=sourceBoundAckCanonicalPolicy({qualification,policy:result.canonicalPolicy!})
        const own=validateCanonicalAckGuide({policy,rawPayload:input.rawPayload,rawSegments:parsed.rawSegments,una:parsed.una,sourceRawPayload:sourceMessage.raw_payload})
        const inherited=canonicalValidation({...input,parsed},policy)
        const issues=[...inherited.issues,...own],blocking=issues.some(entry=>entry.blocking||entry.severity==='error')
        return {...inherited,canonicalPolicy:policy,ok:!blocking,blocking,issues,fieldRuleSource:'registry',rulePackSnapshot:{profileKey:evidence.profileKey,profileVersionId:evidence.messageProfileId,version:evidence.version,checksum:evidence.sourceHash}}
      }catch(error){
        const issues=[...result.issues,issue({severity:'error',code:'CANONICAL_ACK_SOURCE_EVIDENCE_UNAVAILABLE',title:'Fryst kvittensursprung saknas',description:error instanceof Error?error.message:String(error)})]
        return {...result,ok:false,blocking:true,issues,fieldRuleSource:'static',rulePackSnapshot:null}
      }
    }
    try {
      const qualification=input.messageRow
        ? await readPersistedOutboundAckRulePackEvidence(input.messageRow)
        : sourceQualifiedOutboundAck({qualification:input.ackSourceQualification,companyId:input.companyId,environment:input.environment})
      if(!qualification)throw new Error('ack_source_qualification_required')
      const {sourceMessage,evidence}=qualification
      const policy=sourceBoundAckCanonicalPolicy({qualification,policy:result.canonicalPolicy!})
      const own=validateCanonicalAckGuide({policy,rawPayload:input.rawPayload,rawSegments:parsed.rawSegments,una:parsed.una,sourceRawPayload:sourceMessage.raw_payload})
      const inherited=canonicalValidation({...input,parsed},policy)
      const issues=[...inherited.issues,...own],blocking=issues.some(entry=>entry.blocking||entry.severity==='error')
      return {...inherited,canonicalPolicy:policy,ok:!blocking,blocking,issues,fieldRuleSource:'registry',rulePackSnapshot:{profileKey:evidence.profileKey,profileVersionId:evidence.messageProfileId,version:evidence.version,checksum:evidence.sourceHash}}
    }catch(error){
      const issues = [...result.issues, issue({
        severity: 'error',
        code: 'CANONICAL_ACK_SOURCE_RULE_PACK_EVIDENCE_REQUIRED',
        title: 'Källmeddelandets canonical rule-pack saknas',
        description: error instanceof Error?error.message:String(error),
      })]
      return { ...result, ok: false, blocking: true, issues, fieldRuleSource: 'static', rulePackSnapshot: null }
    }
  }

  if (!isBusinessRulePackFamily(familyValue)) {
    throw new Error(`canonical_rule_pack_family_unreachable:${familyValue}`)
  }

  try {
    const policy = result.canonicalPolicy ?? policyForValidation({ ...input, parsed }, parsed)
    const evidence = await resolveCanonicalRulePack({
      family: familyValue,
      messageCode: policy.code,
      transactionSubtype: policy.subtype,
      applicationReference: policy.applicationReference,
      direction: dir,
      businessDate: policy.referenceDate,
      canonicalPolicy: policy,
      requireBuilder: dir === 'outbound' && input.mode === 'send',
      requireStateMachine: true,
    })
    const snapshot: RegistryRulePackSnapshot = {
      profileKey: evidence.databaseProfileKey ?? evidence.profileKey,
      profileVersionId: evidence.messageProfileId,
      version: evidence.originalVersion,
      originalWitness: evidence.originalSnapshot,
      checksum: evidence.sourceHash,
    }
    return { ...result, fieldRuleSource: 'registry', rulePackSnapshot: snapshot }
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error)
    const issues = [...result.issues, issue({
      severity: 'error',
      code: 'CANONICAL_RULE_PACK_EVIDENCE_NOT_ACTIVE',
      title: 'Canonical runtime-evidence saknas',
      description,
    })]
    return { ...result, ok: false, blocking: true, issues, fieldRuleSource: 'registry', rulePackSnapshot: null }
  }
}

/**
 * Stable synchronous compatibility API used by transport send guards. Every
 * canonical EDIFACT family is validated by this file's policy-first path;
 * legacy validation is reserved for non-canonical formats/families only.
 */
export function validateEdielMessageRowWithRulebook(
  message: EdielMessageRow,
  mode: 'send' | 'parse' | 'test' = 'send',
  dateEventContext?:ProdatDateEventValidationContext,
  reportingContext?:ExpectedContext,
  ackSourceQualification?:SourceQualifiedOutboundAck,
  deathStatusContext?:DeathStatusValidationContext,
  prodatCommonHeaderRejectionEvidence?:ProdatCommonHeaderRejectionEvidence,
  customerMasterdataContext?:CustomerMasterdataValidationContext,
  requestedChangeBasis?:RequestedChangeBasis,
): RulebookValidationResult {
  return validateRulebookMessage({
    messageRow:message,dateEventRow:message,dateEventContext,reportingContext,ackSourceQualification,deathStatusContext,prodatCommonHeaderRejectionEvidence,customerMasterdataContext,requestedChangeBasis,

    family: message.message_family,
    code: String(message.message_code ?? ''),
    processGroup: message.process_type ?? message.route_scope ?? null,
    routeScope: message.route_scope ?? null,
    applicationReference: message.application_reference,
    rawPayload: message.raw_payload,
    parsedPayload: message.parsed_payload ?? null,
    mode,
    direction: message.direction,
    environment: message.environment,
    version: message.message_version,
    companyId: message.company_id,
  })
}
import {canonicalMessageCode} from '@/lib/ediel/core/messageIdentity'
