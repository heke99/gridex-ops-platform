import { prodatFreeTextSendIssues } from '@/lib/ediel/prodat/prodatFreeText'
import {gasApplicabilitySendIssue} from '@/lib/ediel/prodat/prodatGasAuthority'
import {validateProdatGasApplicability} from './prodatGasApplicabilityPolicy'
import type {GasSerialChangeSelection} from '@/lib/ediel/prodat/prodatGasApplicability'
import {deathStatusSendIssue} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {validateProdatDeathStatus} from './prodatDeathStatusPolicy'
import type {DeathSelection} from '@/lib/ediel/prodat/prodatDeathStatus'
import type {MeterChangeSelection} from '@/lib/ediel/prodat/prodatMeterChangeFacts'
import {meterChangeSendIssue} from '@/lib/ediel/prodat/prodatMeterChangeAuthority'
import {validateProdatMeterChange} from './prodatMeterChangePolicy'
import {reportingAuthorityIssue} from '@/lib/ediel/prodat/prodatReportingPermissionAuthority'
import type {ExpectedContext} from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import {validateProdatReportingPermission} from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import {prodatDateEventAuthorityIssue} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import {validateProdatDateEvents} from './prodatDateEventPolicy'
import type {ProdatDateEventRow,TgtDateEventValidationContext} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import {validateProdatInvoicee} from '@/lib/ediel/rulebook/prodatInvoiceePolicy'
import {validateProdatEndUserAddress} from './prodatEndUserAddressPolicy'
import { validateProdatRegisterPayload } from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import { prodatSendMessageScopeIssue } from '@/lib/ediel/prodat/prodatSendMessageScope'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { readProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { tokenizeEdifact, segmentComposite } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna } from '@/lib/ediel/core/una'
import type { EdielDirection, EdielMessageRow } from '@/lib/ediel/types'
import { parseRulebookListPayload, parseRulebookMessage, type ParsedRulebookMessage } from '@/lib/ediel/rulebook/messageParser'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'
import { resolveCanonicalEdielPolicy, type CanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
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

export type RulebookValidationInput = LegacyRulebookValidationInput & {
  /** Explicit pure receiver knowledge, never incoming parsed metadata. */
  gasSerialChange?:GasSerialChangeSelection
  deathStatus?:DeathSelection
  meterChange?:MeterChangeSelection
  /** Draft metadata from the canonical renderer. Used to verify that production
   * PRODAT D-conditions were already resolved with the original business facts. */
  dateEventRow?:ProdatDateEventRow
  dateEventContext?:TgtDateEventValidationContext
  reportingContext?:ExpectedContext
  parsedPayload?: Record<string, unknown> | null
}

export type RulebookValidationResult = LegacyRulebookValidationResult

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
  if (input.parsed) return input.parsed
  if (!input.rawPayload) return null
  return input.rawPayload.startsWith('UNA') || input.rawPayload.includes("'")
    ? parseRulebookMessage(input.rawPayload)
    : parseRulebookListPayload(input.rawPayload)
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

function businessDate(input: RulebookValidationInput, parsed: ParsedRulebookMessage | null): string {
  const explicit = String(input.businessDate ?? '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit
  const una = parsed?.una ?? parseUna(input.rawPayload)
  const tokens = tokenizeEdifact(`${una.raw}${(parsed?.rawSegments ?? []).join(una.segmentTerminator)}${una.segmentTerminator}`)
  const segment = tokens.segments.find(segment => segment.tag === 'DTM' && segmentComposite(segment, 1, una)[0] === '137')
  const raw = segmentComposite(segment, 1, una)[1] ?? ''
  if (raw.length >= 8) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
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

function canonicalMessageCode(family: ActiveCanonicalFamily, code: string): string {
  if (family === 'UTILTS_ERR') return 'ERR'
  if (family === 'APERAK') return 'APERAK'
  if (family === 'CONTRL') return 'CONTRL'
  return code
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

function inheritedSourceRulePackSnapshot(input: RulebookValidationInput): RegistryRulePackSnapshot | null {
  const payload = record(input.parsedPayload)
  const snapshot = record(payload?.canonicalSourceRulePackSnapshot)
  if (!snapshot) return null

  const profileKey = String(snapshot.profileKey ?? '').trim()
  const profileVersionId = String(snapshot.profileVersionId ?? '').trim()
  const version = String(snapshot.version ?? '').trim()
  const checksum = String(snapshot.checksum ?? '').trim()
  const inherited = snapshot.inheritedFromSourceMessage === true
  const sourceMessageId = String(snapshot.sourceMessageId ?? '').trim()
  if (!profileKey || !profileVersionId || !version || !checksum || !inherited || !sourceMessageId) return null
  return { profileKey, profileVersionId, version, checksum }
}

function policyForValidation(input: RulebookValidationInput, parsed: ParsedRulebookMessage): CanonicalEdielPolicy {
  const familyValue = normalize(input.family ?? parsed.family)
  if (!isActiveCanonicalFamily(familyValue)) {
    throw new Error(`canonical_policy_family_required:${familyValue || 'missing'}`)
  }
  const code = canonicalMessageCode(familyValue, normalize(input.code ?? parsed.code))
  const dir = direction(input)
  if (!dir) throw new Error(`canonical_policy_direction_required:${familyValue}:${code}`)
  const referenceDate = businessDate(input, parsed)
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
    messageCode: code,
    subtypeOrReasonCode: parsed.subtype,
    prodatDependentFacts: familyValue === 'PRODAT' && input.mode === 'send'
      ? readProdatRegisterEvidence({dateEventRow:input.dateEventRow,dateEventContext:input.dateEventContext,reportingContext:input.reportingContext,code,rawSegments:parsed.rawSegments,una:parseUna(input.rawPayload),parsedPayload:input.parsedPayload,companyId:input.companyId,runId:typeof input.parsedPayload?.testRunId==='string'?input.parsedPayload.testRunId:null,stepNo:typeof input.parsedPayload?.stepNo==='number'?input.parsedPayload.stepNo:null})
      : {meterChange:input.meterChange,deathStatus:input.deathStatus,gasSerialChange:input.gasSerialChange},
    direction: dir,
    referenceDate,
    // Runtime guide aliases such as PRODAT 26A and CONTRL aliases are not UNH
    // association codes. APERAK is the exception: its source-bound association
    // is required to select the correct P- or U-family guide.
    associationAssignedCode,
    applicationReference: input.applicationReference ?? parsed.applicationReference ?? null,
    mode: input.mode === 'send' ? 'catalog_evidence' : 'parse',
  })

  if (sourceBoundAck) {
    assertAckFamilyRuntimeVersion({
      family: familyValue,
      providedVersion,
      referenceDate,
      policy,
      sourceMessageFamily,
    })
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
  if (production && snapshot.some((condition) => condition.status === 'undetermined')) {
    const ids = snapshot.filter((condition) => condition.status === 'undetermined').map((condition) => condition.id)
    throw new Error(`prodat_dependent_condition_undetermined:${ids.join(',')}`)
  }
  return { ...policy, prodatDependentConditions: snapshot }
}

function canonicalValidation(input: RulebookValidationInput): RulebookValidationResult {
  const parsed = parse(input)
  const family = normalize(input.family ?? parsed?.family)
  const code = normalize(input.code ?? parsed?.code)
  const parserIssues: EdielRulebookIssue[] = [
    ...(parsed?.errors ?? []).map((description) => issue({ severity: 'error', code: 'PARSER_ERROR', title: 'Parserfel', description })),
    ...(parsed?.warnings ?? []).map((description) => issue({ severity: 'warning', code: 'PARSER_WARNING', title: 'Parser-varning', description })),
  ]

  if (!parsed) {
    const issues = [...parserIssues, issue({ severity: 'error', code: 'CANONICAL_PAYLOAD_REQUIRED', title: 'Payload saknas', description: `${family} ${code} kan inte valideras utan payload.` })]
    return { ok: false, blocking: true, family: family || null, code: code || null, processGroup: 'unknown', expectedApplicationReference: null, parsed: null, issues, fieldRuleSource: 'static', rulePackSnapshot: null }
  }

  try {
    const policy = policyForValidation(input, parsed)
    if (input.processGroup && policy.processGroup && String(input.processGroup).trim() !== policy.processGroup) {
      parserIssues.push(issue({
        severity: 'error',
        code: 'CANONICAL_PROCESS_GROUP_MISMATCH',
        title: 'Processgrupp matchar inte canonical policy',
        description: `${family} ${code} tillhör ${policy.processGroup}, men anropet anger ${input.processGroup}.`,
      }))
    }

    let fieldIssues = validateCanonicalPolicyFields({reportingContext:input.reportingContext, policy, rawSegments: parsed.rawSegments, una: parseUna(input.rawPayload) })
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
      parsed,
      issues,
      fieldRuleSource: 'static',
      rulePackSnapshot: null,
    }
  } catch (error) {
    const description = error instanceof Error ? error.message : String(error)
    // Missing/invalid root policy metadata must not hide source-derived D
    // defects behind the legacy intentional-invalid-test escape hatch.
    const protectedDependentIssues = family === 'PRODAT' && input.mode === 'send'
      ? validateProdatSubtypePayload({family, code, rawSegments:parsed.rawSegments, una:parsed.una ?? parseUna(input.rawPayload)}) : []
    // A missing/stale production snapshot cannot bypass the same protected
    // register structure and policy used on the normal path. Body-bound facts are re-read;
    // snapshot statuses and intentional-invalid labels supply no authority.
    const gasIssues=family==='PRODAT'?validateProdatGasApplicability({code:parsed.code??code,rawSegments:parsed.rawSegments,una:parsed.una??parseUna(input.rawPayload),direction:input.mode==='send'?'outbound':'inbound',facts:{gasSerialChange:input.gasSerialChange}}):[]
    const deathIssues = family==='PRODAT'?validateProdatDeathStatus({code:parsed.code??code,rawSegments:parsed.rawSegments,una:parsed.una??parseUna(input.rawPayload),direction:input.mode==='send'?'outbound':'inbound',facts:{deathStatus:input.deathStatus}}):[]
    const protectedRegisterIssues: EdielRulebookIssue[] = input.mode==='parse'&&family==='PRODAT'?validateProdatMeterChange({code:parsed.code??code,rawSegments:parsed.rawSegments,una:parsed.una??parseUna(input.rawPayload),direction:'inbound',applicationReference:parsed.applicationReference,facts:{meterChange:input.meterChange}}):[]
    if (family === 'PRODAT' && input.mode === 'send' && !description.startsWith('prodat_register_evidence_')) {
      try {
        const wireCode = parsed.code ?? code
        const una = parsed.una ?? parseUna(input.rawPayload)
        const facts = readProdatRegisterEvidence({dateEventRow:input.dateEventRow,dateEventContext:input.dateEventContext,reportingContext:input.reportingContext,code:wireCode,rawSegments:parsed.rawSegments,una,parsedPayload:input.parsedPayload,companyId:input.companyId,runId:typeof input.parsedPayload?.testRunId==='string'?input.parsedPayload.testRunId:null,stepNo:typeof input.parsedPayload?.stepNo==='number'?input.parsedPayload.stepNo:null})
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
    const issues = [...parserIssues, ...gasIssues, ...deathIssues, ...protectedDependentIssues, ...protectedRegisterIssues, ...(authorityIssue?[authorityIssue]:[]), issue({
      severity: 'error',
      code: description.startsWith('prodat_register_evidence_') ? 'PRODAT_REGISTER_EVIDENCE_INVALID' : 'CANONICAL_POLICY_VALIDATION_FAILED',
      ...(description.startsWith('prodat_register_evidence_') ? {scope:'prodat_register' as const} : {}),
      title: 'Canonical Ediel-policy blockerade validering',
      description,
    })]
    return { ok: false, blocking: true, family: family || null, code: code || null, processGroup: 'unknown', expectedApplicationReference: null, parsed, issues, fieldRuleSource: 'static', rulePackSnapshot: null }
  }
}

export function validateRulebookMessage(input: RulebookValidationInput): RulebookValidationResult {
  const freeText = input.mode === 'send' && input.direction !== 'inbound' ? prodatFreeTextSendIssues({ raw_payload: input.rawPayload, message_family: input.family, message_code: input.code }) : []
  const gasBoundary=input.mode==='send'&&input.direction!=='inbound'?gasApplicabilitySendIssue({message_code:input.code,message_family:input.family,raw_payload:input.rawPayload,parsed_payload:input.parsedPayload,application_reference:input.applicationReference}):null
  const deathBoundary=input.mode==='send'?deathStatusSendIssue({message_code:input.code,message_family:input.family,raw_payload:input.rawPayload,parsed_payload:input.parsedPayload}):null
  const protect=(result:RulebookValidationResult):RulebookValidationResult=>deathBoundary||gasBoundary||freeText.length?{...result,ok:false,blocking:true,issues:[...result.issues,...freeText.filter(entry => !result.issues.some(old => old.code === entry.code && old.description === entry.description)),...(deathBoundary?[deathBoundary]:[]),...(gasBoundary?[gasBoundary]:[])]}:result
  const meterBoundary=input.mode==='send'?meterChangeSendIssue({message_code:input.code,message_family:input.family,raw_payload:input.rawPayload}):null
  if(meterBoundary)return protect({ok:false,blocking:true,family:'PRODAT',code:'Z10',processGroup:'unknown',expectedApplicationReference:null,parsed:null,issues:[meterBoundary],fieldRuleSource:'static',rulePackSnapshot:null})
  const source = sourceBoundProdatInput(input)
  if (source.failure) return protect(source.failure)
  input = source.input
  const parsed = parse(input)
  const family = normalize(input.family ?? parsed?.family)
  if (!isActiveCanonicalFamily(family)) return protect(validateLegacyRulebookMessage(input))
  return protect(canonicalValidation({ ...input, parsed }))
}

export async function validateRulebookMessageWithRegistry(input: RulebookValidationInput): Promise<RulebookValidationResult> {
  if (input.mode === 'send' && input.direction !== 'inbound' && prodatFreeTextSendIssues({ raw_payload: input.rawPayload, message_family: input.family, message_code: input.code }).length) return validateRulebookMessage(input)
  const gasBoundary=input.mode==='send'&&input.direction!=='inbound'?gasApplicabilitySendIssue({message_code:input.code,message_family:input.family,raw_payload:input.rawPayload,parsed_payload:input.parsedPayload,application_reference:input.applicationReference}):null
  const deathBoundary=input.mode==='send'?deathStatusSendIssue({message_code:input.code,message_family:input.family,raw_payload:input.rawPayload,parsed_payload:input.parsedPayload}):null
  if(deathBoundary||gasBoundary)return validateRulebookMessage(input) // Preserve existing protected diagnostics without registry I/O.
  const meterBoundary=input.mode==='send'?meterChangeSendIssue({message_code:input.code,message_family:input.family,raw_payload:input.rawPayload}):null
  if(meterBoundary)return {ok:false,blocking:true,family:'PRODAT',code:'Z10',processGroup:'unknown',expectedApplicationReference:null,parsed:null,issues:[meterBoundary],fieldRuleSource:'static',rulePackSnapshot:null}
  const source = sourceBoundProdatInput(input)
  if (source.failure) return source.failure
  input = source.input
  const parsed = parse(input)
  const familyValue = normalize(input.family ?? parsed?.family)
  if (!isActiveCanonicalFamily(familyValue)) return validateLegacyRulebookMessageWithRegistry(input)

  const result = canonicalValidation({ ...input, parsed })
  if (!parsed || result.blocking) return result
  const dir = direction(input)
  if (!dir) return { ...result, ok: false, blocking: true, issues: [...result.issues, issue({ severity: 'error', code: 'CANONICAL_EVIDENCE_DIRECTION_REQUIRED', title: 'Riktning saknas', description: 'Rule-pack evidence kräver explicit inbound/outbound-riktning.' })] }

  if (isSourceBoundAckFamily(familyValue)) {
    // ACK/error messages do not choose a second business rule pack. Outbound
    // ACKs inherit the exact activation/evidence snapshot from the source
    // business message. Inbound parsing is fully source-controlled and does not
    // require a mutable DB row to define protocol meaning.
    if (input.mode !== 'send') return result
    const inherited = inheritedSourceRulePackSnapshot(input)
    if (!inherited) {
      const issues = [...result.issues, issue({
        severity: 'error',
        code: 'CANONICAL_ACK_SOURCE_RULE_PACK_EVIDENCE_REQUIRED',
        title: 'Källmeddelandets canonical rule-pack saknas',
        description: `${familyValue} ska ärva exakt rule-pack evidence från meddelandet som kvitteras; ett separat ACK-regelpaket får inte väljas.`,
      })]
      return { ...result, ok: false, blocking: true, issues, fieldRuleSource: 'static', rulePackSnapshot: null }
    }
    return { ...result, fieldRuleSource: 'registry', rulePackSnapshot: inherited }
  }

  if (!isBusinessRulePackFamily(familyValue)) {
    throw new Error(`canonical_rule_pack_family_unreachable:${familyValue}`)
  }

  try {
    const policy = policyForValidation({ ...input, parsed }, parsed)
    const evidence = await resolveCanonicalRulePack({
      family: familyValue,
      messageCode: policy.code,
      transactionSubtype: policy.subtype,
      applicationReference: policy.applicationReference,
      direction: dir,
      businessDate: policy.referenceDate,
      requireBuilder: dir === 'outbound' && input.mode === 'send',
      requireStateMachine: true,
    })
    const snapshot: RegistryRulePackSnapshot = {
      profileKey: evidence.profileKey,
      profileVersionId: evidence.messageProfileId,
      version: `${evidence.guideVersion}:r${evidence.guideRevision}`,
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
  dateEventContext?:TgtDateEventValidationContext,
  reportingContext?:ExpectedContext,
): RulebookValidationResult {
  return validateRulebookMessage({
    dateEventRow:message,dateEventContext,reportingContext,
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
