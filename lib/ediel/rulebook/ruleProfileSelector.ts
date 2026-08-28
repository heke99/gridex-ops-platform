import type { EdielMessageRow } from '@/lib/ediel/types'
import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'
import {
  canonicalMessageFacts,
  hasCanonicalScalarToken,
} from '@/lib/ediel/core/canonicalEdifactAst'

export type EdielDecisionContextKind = 'TGT' | 'AGT' | 'bilateral' | 'production' | 'unknown'

export type EdielRuleProfileId =
  | 'prodat_supplier_switch_z01'
  | 'prodat_supplier_switch_z02'
  | 'prodat_supplier_switch_z03'
  | 'prodat_supplier_switch_z04'
  | 'prodat_supplier_switch_z05'
  | 'prodat_masterdata_z06'
  | 'prodat_supplier_switch_z09'
  | 'prodat_meter_change_z10'
  | 'prodat_permission_z13'
  | 'prodat_permission_z14'
  | 'prodat_permission_z15'
  | 'prodat_permission_z18'
  | 'utilts_e66_quarter'
  | 'utilts_e66_hour'
  | 'utilts_e66_sch'
  | 'utilts_e66_energy_service'
  | 'utilts_e31_sch'
  | 'utilts_e31_quarter'
  | 'utilts_s01'
  | 'utilts_s02'
  | 'utilts_s03'
  | 'utilts_s04'
  | 'ack_contrl'
  | 'ack_aperak'
  | 'ack_utilts_err'
  | 'manual_review_unknown'

export type EdielMessageVariant =
  | 'Z13V'
  | 'Z13VH'
  | 'Z14V'
  | 'Z14N'
  | 'Z14VH'
  | 'Z15V'
  | 'Z18V'
  | 'quarter'
  | 'hour'
  | 'sch'
  | 'month'
  | 'unknown'

export type EdielBusinessResult =
  | 'permission_requested'
  | 'permission_approved'
  | 'permission_rejected'
  | 'permission_terminated'
  | 'permission_termination_requested'
  | 'meter_values'
  | 'technical_ack'
  | 'application_ack'
  | 'none'
  | 'unknown'

export type EdielApplicationValidity = 'valid' | 'invalid' | 'uncertain'

export type EdielClassifiedMessage = {
  family: string
  messageCode: string | null
  variant: EdielMessageVariant
  processType: string | null
  actorRole: string | null
  businessResult: EdielBusinessResult
  applicationValidity: EdielApplicationValidity
  confidence: 'high' | 'medium' | 'low'
  manualReviewReason: string | null
  ruleProfileId: EdielRuleProfileId
  requiredFields: string[]
  optionalFields: string[]
  forbiddenFields: string[]
  expectedResponses: Array<'CONTRL' | 'APERAK' | 'UTILTS_ERR'>
  errorMapping: string[]
  matchedSignals: string[]
}

export type ClassifyEdielMessageInput = {
  message?: EdielMessageRow | null
  family?: string | null
  messageCode?: string | null
  rawPayload?: string | null
  applicationReference?: string | null
  processType?: string | null
  actorRole?: string | null
  testKind?: EdielDecisionContextKind | null
}

type CanonicalFacts = ReturnType<typeof canonicalMessageFacts>

function normalize(value: unknown): string {
  return String(value ?? '').trim().toUpperCase()
}

function cleanToken(value: unknown): string | null {
  const token = String(value ?? '').trim()
  return token.length > 0 ? token.toUpperCase() : null
}

function factsFor(rawPayload: string | null): CanonicalFacts {
  return canonicalMessageFacts(rawPayload)
}

function inferFamily(input: ClassifyEdielMessageInput, facts: CanonicalFacts): string {
  const explicit = cleanToken(input.family ?? input.message?.message_family)
  if (explicit) return explicit.replace('-', '_')
  const parsed = cleanToken(facts.family)
  if (parsed) return parsed.replace('-', '_')
  if (facts.messageCode === 'ERR') return 'UTILTS_ERR'
  return 'UNKNOWN'
}

function inferMessageCode(input: ClassifyEdielMessageInput, facts: CanonicalFacts): string | null {
  const explicit = cleanToken(input.messageCode ?? input.message?.message_code)
  if (explicit && explicit !== 'UNKNOWN') return explicit
  return cleanToken(facts.messageCode)
}

function prodatProfileForCode(code: string | null): EdielRuleProfileId {
  switch (code) {
    case 'Z01': return 'prodat_supplier_switch_z01'
    case 'Z02': return 'prodat_supplier_switch_z02'
    case 'Z03': return 'prodat_supplier_switch_z03'
    case 'Z04': return 'prodat_supplier_switch_z04'
    case 'Z05': return 'prodat_supplier_switch_z05'
    case 'Z06': return 'prodat_masterdata_z06'
    case 'Z09': return 'prodat_supplier_switch_z09'
    case 'Z10': return 'prodat_meter_change_z10'
    case 'Z13': return 'prodat_permission_z13'
    case 'Z14': return 'prodat_permission_z14'
    case 'Z15': return 'prodat_permission_z15'
    case 'Z18': return 'prodat_permission_z18'
    default: return 'manual_review_unknown'
  }
}

function utiltsProfileForCode(code: string | null, variant: EdielMessageVariant): EdielRuleProfileId {
  if (code === 'E66') {
    if (variant === 'quarter') return 'utilts_e66_quarter'
    if (variant === 'hour') return 'utilts_e66_hour'
    if (variant === 'sch' || variant === 'month') return 'utilts_e66_sch'
    return 'utilts_e66_energy_service'
  }
  if (code === 'E31') return variant === 'quarter' ? 'utilts_e31_quarter' : 'utilts_e31_sch'
  if (code === 'S01') return 'utilts_s01'
  if (code === 'S02') return 'utilts_s02'
  if (code === 'S03') return 'utilts_s03'
  if (code === 'S04') return 'utilts_s04'
  return 'manual_review_unknown'
}

function prodatPermissionVariant(code: string | null, facts: CanonicalFacts): {
  variant: EdielMessageVariant
  businessResult: EdielBusinessResult
  validity: EdielApplicationValidity
  signals: string[]
  manualReviewReason: string | null
} {
  const statuses = facts.cciCavCodes.Z23 ?? []
  const purposes = facts.cciCavCodes.Z24 ?? []
  const endReasons = facts.cciCavCodes.Z25 ?? []
  const signals: string[] = []
  if (statuses.length > 0) signals.push(`Z23=${statuses.join(',')}`)
  if (purposes.length > 0) signals.push(`Z24=${purposes.join(',')}`)
  if (endReasons.length > 0) signals.push(`Z25=${endReasons.join(',')}`)

  if (code === 'Z13') {
    const historical = hasCanonicalScalarToken(facts, 'Z13VH') || hasCanonicalScalarToken(facts, 'S18')
    return {
      variant: historical ? 'Z13VH' : 'Z13V',
      businessResult: 'permission_requested',
      validity: 'valid',
      signals,
      manualReviewReason: null,
    }
  }

  if (code === 'Z18') {
    return {
      variant: 'Z18V',
      businessResult: 'permission_termination_requested',
      validity: 'valid',
      signals,
      manualReviewReason: null,
    }
  }

  if (code === 'Z14') {
    if (hasCanonicalScalarToken(facts, 'Z14VH') || hasCanonicalScalarToken(facts, 'S18')) {
      return { variant: 'Z14VH', businessResult: 'permission_approved', validity: 'valid', signals, manualReviewReason: null }
    }
    if (hasCanonicalScalarToken(facts, 'Z14N') || statuses.some((status) => ['A75', 'Z96'].includes(status))) {
      return { variant: 'Z14N', businessResult: 'permission_rejected', validity: 'valid', signals, manualReviewReason: null }
    }
    if (hasCanonicalScalarToken(facts, 'Z14V') || hasCanonicalScalarToken(facts, 'S17') || statuses.some((status) => ['A74', 'A13'].includes(status))) {
      return { variant: 'Z14V', businessResult: 'permission_approved', validity: 'valid', signals, manualReviewReason: null }
    }
    return {
      variant: 'unknown',
      businessResult: 'unknown',
      validity: statuses.length > 0 ? 'uncertain' : 'invalid',
      signals,
      manualReviewReason: statuses.length > 0 ? 'Z14-statusen är inte mappad till Z14V/Z14N/Z14VH.' : 'Z14 saknar tydligt tillståndsstatus i CCI/CAV.',
    }
  }

  if (code === 'Z15') {
    const statusValid = statuses.length === 0 || statuses.includes('A75')
    const reasonValid = endReasons.length === 0 || endReasons.some((reason) => ['B79', 'B80'].includes(reason))
    return {
      variant: 'Z15V',
      businessResult: 'permission_terminated',
      validity: statusValid && reasonValid ? 'valid' : 'invalid',
      signals,
      manualReviewReason: statusValid && reasonValid ? null : 'Z15 innehåller ogiltig status eller avslutsorsak.',
    }
  }

  return {
    variant: 'unknown',
    businessResult: 'unknown',
    validity: 'uncertain',
    signals,
    manualReviewReason: null,
  }
}

function utiltsVariant(facts: CanonicalFacts, explicitProcessType?: string | null): EdielMessageVariant {
  const explicit = normalize(explicitProcessType)
  if (['QUARTER', 'KVART', '15', 'PT15M'].includes(explicit)) return 'quarter'
  if (['HOUR', 'TIM', '60', 'PT60M'].includes(explicit)) return 'hour'
  if (['SCH', 'MONTH', 'MÅNAD', 'MANAD'].includes(explicit)) return 'sch'

  const resolution = facts.dtmValues['354'] ?? []
  if (resolution.includes('15')) return 'quarter'
  if (resolution.includes('60')) return 'hour'

  const appRef = normalize(facts.applicationReference)
  if (appRef.includes('E66-T')) return 'quarter'
  if (appRef.includes('E66-S')) return 'sch'
  if (hasCanonicalScalarToken(facts, 'SCH')) return 'sch'
  return 'unknown'
}

export function classifyProdatPermissionMessage(input: ClassifyEdielMessageInput): EdielClassifiedMessage {
  const rawPayload = input.rawPayload ?? input.message?.raw_payload ?? null
  const facts = factsFor(rawPayload)
  const code = inferMessageCode(input, facts)
  const permission = prodatPermissionVariant(code, facts)
  const profile = prodatProfileForCode(code)
  const isPermissionCode = ['Z13', 'Z14', 'Z15', 'Z18'].includes(code ?? '')

  return {
    family: 'PRODAT',
    messageCode: code,
    variant: permission.variant,
    processType: isPermissionCode ? 'permission' : input.processType ?? input.message?.process_type ?? null,
    actorRole: input.actorRole ?? null,
    businessResult: permission.businessResult,
    applicationValidity: permission.validity,
    confidence: profile === 'manual_review_unknown' ? 'low' : permission.validity === 'uncertain' ? 'medium' : 'high',
    manualReviewReason: permission.manualReviewReason,
    ruleProfileId: profile,
    requiredFields: isPermissionCode ? ['BGM', 'DTM+137', 'NAD+FR', 'NAD+DO', 'LIN/RFF+Z07'] : ['BGM', 'DTM+137', 'NAD+FR', 'NAD+DO'],
    optionalFields: isPermissionCode ? ['CCI/CAV Z04', 'CCI/CAV Z12', 'CCI/CAV Z23', 'CCI/CAV Z24', 'CCI/CAV Z25', 'RFF+ACW', 'RFF+LI'] : ['RFF', 'QTY', 'CCI/CAV'],
    forbiddenFields: [],
    expectedResponses: ['CONTRL', 'APERAK'],
    errorMapping: isPermissionCode ? ['facility_not_identified', 'permission_flow_not_found', 'permission_status_invalid', 'permission_end_reason_invalid'] : ['field_matrix_by_profile'],
    matchedSignals: permission.signals,
  }
}

export function classifyUtiltsMessage(input: ClassifyEdielMessageInput): EdielClassifiedMessage {
  const rawPayload = input.rawPayload ?? input.message?.raw_payload ?? null
  const facts = factsFor(rawPayload)
  const code = inferMessageCode(input, facts)
  const variant = utiltsVariant(facts, input.processType ?? input.message?.process_type ?? null)
  const profile = utiltsProfileForCode(code, variant)
  const validity: EdielApplicationValidity = profile === 'manual_review_unknown' ? 'uncertain' : 'valid'

  return {
    family: 'UTILTS',
    messageCode: code,
    variant,
    processType: code === 'E66' || code === 'E31' ? 'meter_values' : 'utilts',
    actorRole: input.actorRole ?? null,
    businessResult: code === 'E66' || code === 'E31' ? 'meter_values' : 'none',
    applicationValidity: validity,
    confidence: variant === 'unknown' ? 'medium' : 'high',
    manualReviewReason: variant === 'unknown' && (code === 'E66' || code === 'E31') ? 'UTILTS-upplösning kunde inte klassificeras säkert.' : null,
    ruleProfileId: profile,
    requiredFields: ['BGM', 'DTM+137', 'NAD+MS', 'NAD+MR'],
    optionalFields: ['IDE+24', 'LIN', 'DTM+163', 'DTM+164', 'DTM+354', 'DTM+597', 'QTY', 'STS'],
    forbiddenFields: [],
    expectedResponses: ['CONTRL', 'APERAK'],
    errorMapping: ['syntax_error_to_contrl', 'application_error_to_aperak', 'functional_error_to_utilts_err'],
    matchedSignals: variant === 'unknown' ? [] : [`variant=${variant}`],
  }
}

export function classifyEdielMessage(input: ClassifyEdielMessageInput): EdielClassifiedMessage {
  const rawPayload = input.rawPayload ?? input.message?.raw_payload ?? null
  const facts = factsFor(rawPayload)
  const family = inferFamily(input, facts)
  const code = inferMessageCode(input, facts)

  if (family === 'PRODAT') return classifyProdatPermissionMessage({ ...input, family, messageCode: code })
  if (family === 'UTILTS') return classifyUtiltsMessage({ ...input, family, messageCode: code })

  if (family === 'CONTRL') {
    return {
      family,
      messageCode: 'CONTRL',
      variant: 'unknown',
      processType: 'ack',
      actorRole: input.actorRole ?? null,
      businessResult: 'technical_ack',
      applicationValidity: 'valid',
      confidence: 'high',
      manualReviewReason: null,
      ruleProfileId: 'ack_contrl',
      requiredFields: ['UNH', 'UCI', 'UNT'],
      optionalFields: ['UCM'],
      forbiddenFields: ['APERAK response'],
      expectedResponses: [],
      errorMapping: [],
      matchedSignals: [],
    }
  }

  if (family === 'APERAK') {
    return {
      family,
      messageCode: 'APERAK',
      variant: 'unknown',
      processType: 'ack',
      actorRole: input.actorRole ?? null,
      businessResult: 'application_ack',
      applicationValidity: 'valid',
      confidence: 'high',
      manualReviewReason: null,
      ruleProfileId: 'ack_aperak',
      requiredFields: ['UNH', 'BGM', 'DTM', 'ERC/FTX when negative'],
      optionalFields: ['RFF', 'DOC'],
      forbiddenFields: ['APERAK response'],
      expectedResponses: ['CONTRL'],
      errorMapping: [],
      matchedSignals: [],
    }
  }

  if (family === 'UTILTS_ERR') {
    return {
      family,
      messageCode: code ?? 'UTILTS_ERR',
      variant: 'unknown',
      processType: 'ack',
      actorRole: input.actorRole ?? null,
      businessResult: 'application_ack',
      applicationValidity: 'valid',
      confidence: 'high',
      manualReviewReason: null,
      ruleProfileId: 'ack_utilts_err',
      requiredFields: ['BGM+ERR', 'STS'],
      optionalFields: ['RFF', 'NAD'],
      forbiddenFields: ['APERAK response'],
      expectedResponses: ['CONTRL'],
      errorMapping: [],
      matchedSignals: [],
    }
  }

  return {
    family,
    messageCode: code,
    variant: 'unknown',
    processType: input.processType ?? input.message?.process_type ?? null,
    actorRole: input.actorRole ?? null,
    businessResult: 'unknown',
    applicationValidity: 'uncertain',
    confidence: 'low',
    manualReviewReason: 'Meddelandefamilj eller BGM-kod kunde inte klassificeras säkert.',
    ruleProfileId: 'manual_review_unknown',
    requiredFields: [],
    optionalFields: [],
    forbiddenFields: [],
    expectedResponses: [],
    errorMapping: [],
    matchedSignals: [],
  }
}

export function selectRuleProfile(input: ClassifyEdielMessageInput): EdielClassifiedMessage {
  return classifyEdielMessage(input)
}

export function compareEngineDecisionWithExpected(params: {
  actualFamily: 'CONTRL' | 'APERAK' | 'UTILTS_ERR'
  actualOutcome?: 'positive' | 'negative' | null
  expectedFamily?: string | null
  expectedOutcome?: 'positive' | 'negative' | null
}): { status: 'match' | 'rule_conflict' | 'no_expected'; reason: string } {
  const expectedFamily = cleanToken(params.expectedFamily)
  const actualFamily = cleanToken(params.actualFamily)
  if (!expectedFamily && !params.expectedOutcome) return { status: 'no_expected', reason: 'Ingen testförväntning angavs.' }
  if (expectedFamily && expectedFamily !== actualFamily) {
    return { status: 'rule_conflict', reason: `Förväntad ACK-familj ${expectedFamily}, men engine valde ${actualFamily}.` }
  }
  if (params.expectedOutcome && params.actualOutcome && params.expectedOutcome !== params.actualOutcome) {
    return { status: 'rule_conflict', reason: `Förväntat outcome ${params.expectedOutcome}, men engine valde ${params.actualOutcome}.` }
  }
  return { status: 'match', reason: 'Engine decision matchar testförväntningen.' }
}

export function summarizeRuleProfile(classification: EdielClassifiedMessage): Record<string, unknown> {
  return {
    family: classification.family,
    messageCode: classification.messageCode,
    variant: classification.variant,
    processType: classification.processType,
    businessResult: classification.businessResult,
    applicationValidity: classification.applicationValidity,
    confidence: classification.confidence,
    ruleProfileId: classification.ruleProfileId,
    manualReviewReason: classification.manualReviewReason,
    requiredFields: classification.requiredFields,
    optionalFields: classification.optionalFields,
    expectedResponses: classification.expectedResponses,
    errorMapping: classification.errorMapping,
    matchedSignals: classification.matchedSignals,
  }
}

export function parseRuleProfileFacts(message: EdielMessageRow): Record<string, unknown> {
  const facts = parseEdifactMessageFacts(message.raw_payload)
  return {
    messageType: facts.messageType,
    messageCode: facts.messageCode,
    lineItemCount: facts.lineItems.length,
    rawSegmentCount: facts.rawSegments.length,
  }
}
