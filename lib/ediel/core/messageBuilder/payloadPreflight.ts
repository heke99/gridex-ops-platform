import { prodatFreeTextSendIssues } from '@/lib/ediel/prodat/prodatFreeText'
import {gasApplicabilitySendIssue} from '@/lib/ediel/prodat/prodatGasAuthority'
import {validateProdatGasApplicability} from '@/lib/ediel/rulebook/prodatGasApplicabilityPolicy'
import type {GasSerialChangeSelection} from '@/lib/ediel/prodat/prodatGasApplicability'
import {deathStatusSendIssue} from '@/lib/ediel/prodat/prodatDeathStatusAuthority'
import {validateProdatDeathStatus} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import type {DeathSelection} from '@/lib/ediel/prodat/prodatDeathStatus'
import type {MeterChangeSelection} from '@/lib/ediel/prodat/prodatMeterChangeFacts'
import {meterChangeSendIssue} from '@/lib/ediel/prodat/prodatMeterChangeAuthority'
import {validateProdatMeterChange} from '@/lib/ediel/rulebook/prodatMeterChangePolicy'
import {reportingAuthorityIssue} from '@/lib/ediel/prodat/prodatReportingPermissionAuthority'
import type {ExpectedContext} from '@/lib/ediel/prodat/prodatReportingPermissionContext'
import {validateProdatReportingPermission} from '@/lib/ediel/rulebook/prodatReportingPermissionPolicy'
import {prodatDateEventAuthorityIssue} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import {validateProdatDateEvents} from '@/lib/ediel/rulebook/prodatDateEventPolicy'
import type {TgtDateEventValidationContext,ProdatDateEventRow} from '@/lib/ediel/prodat/prodatDateEventAuthority'
import {validateProdatInvoicee} from '@/lib/ediel/rulebook/prodatInvoiceePolicy'
import {validateProdatEndUserAddress} from '@/lib/ediel/rulebook/prodatEndUserAddressPolicy'
import { prodatSendMessageScopeIssue } from '@/lib/ediel/prodat/prodatSendMessageScope'
import { validateProdatSubtypePayload } from '@/lib/ediel/rulebook/prodatSubtypePolicy'
import { readProdatRegisterEvidence } from '@/lib/ediel/prodat/prodatRegisterEvidence'
import { validateProdatRegisterPayload } from '@/lib/ediel/rulebook/prodatRegisterPolicy'
import { validateProdatDateFields } from '@/lib/ediel/prodat/prodatDateValidation'
import { prodatDateValue } from '@/lib/ediel/prodat/prodatDateFields'
import { readProdatParty, prodatPartySyntaxIssues } from '@/lib/ediel/prodat/prodatPartyFields'
import { prodatDocumentValue } from '@/lib/ediel/prodat/prodatDocumentFields'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { prodatReferenceValue } from '@/lib/ediel/prodat/prodatReferenceFields'
import { misplacedProdatEnergyProducts, prodatCharacteristicValue } from '@/lib/ediel/prodat/prodatCharacteristicFields'
import { tokenizeEdifact, segmentComposite, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
// lib/ediel/core/messageBuilder/payloadPreflight.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import {
  profileForMessage,
  type EdielMessageProfile,
} from '@/lib/ediel/core/messageBuilder/segmentSchema'

export type EdielPayloadPreflightIssue = {
  severity: 'info' | 'warning' | 'error'
  code: string
  title: string
  description: string
  segment?: string | null
}

export type EdielPayloadPreflightResult = {
  ok: boolean
  blocking: boolean
  family: string | null
  code: string | null
  segmentCount: number | null
  declaredUntCount: number | null
  declaredUnzCount: number | null
  payloadSizeBytes: number
  mimeType: string | null
  issues: EdielPayloadPreflightIssue[]
  markers: Record<string, boolean>
}

const RECOMMENDED_MAX_BYTES = 10 * 1024 * 1024
const IDENTIFIER_QUALIFIERS = new Set(['UNB', 'UNH', 'BGM', 'RFF', 'LIN', 'LOC', 'NAD', 'IDE'])
const IDENTIFIER_FORBIDDEN_CHARS = /[ÅÄÖåäö\s]/

type SourceSegment = EdifactTokenizedSegment

/** Keep diagnostics tied to original wire bytes while validating decoded data. */
function issue(input: Omit<EdielPayloadPreflightIssue, 'segment'> & { segment?: string | SourceSegment | null }): EdielPayloadPreflightIssue {
  const { segment, ...details } = input
  return { ...details, ...(segment !== undefined ? { segment: typeof segment === 'object' && segment !== null ? segment.raw : segment } : {}) }
}

/** Read one flat element; a composite must not masquerade as a reference. */
function element(segment: SourceSegment | null | undefined, index: number, una: EdifactServiceStringAdvice): string | null {
  const parts = segmentComposite(segment, index, una)
  return parts.length === 1 ? parts[0]?.trim() || null : null
}

function first(segments: readonly SourceSegment[], tag: string): SourceSegment | null {
  return segments.find(segment => segment.tag === tag) ?? null
}

function numberOrNull(value: string | null): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function checkMaxLength(params: {
  issues: EdielPayloadPreflightIssue[]
  value: string | null
  max: number
  code: string
  title: string
  segment?: string | SourceSegment | null
}) {
  if (!params.value) return
  const effectiveLength = params.value.length
  if (effectiveLength > params.max) {
    params.issues.push(issue({
      severity: 'error',
      code: params.code,
      title: params.title,
      description: `Värdet är ${effectiveLength} tecken men max är ${params.max}.`,
      segment: params.segment ?? null,
    }))
  }
}

function checkIdentifierCharacters(params: {
  issues: EdielPayloadPreflightIssue[]
  value: string | null
  segment?: string | SourceSegment | null
  label: string
}) {
  if (!params.value) return
  if (IDENTIFIER_FORBIDDEN_CHARS.test(params.value)) {
    params.issues.push(issue({
      severity: 'error',
      code: 'IDENTIFIER_INVALID_CHARACTERS',
      title: `${params.label} innehåller otillåtna tecken`,
      description: 'Identifierare får inte innehålla å/ä/ö eller blanksteg.',
      segment: params.segment ?? null,
    }))
  }
}

function markers(rawPayload: string, segments: readonly SourceSegment[]): Record<string, boolean> {
  const tags = new Set(segments.map(segment => segment.tag))
  return { UNA: /^UNA/i.test(rawPayload), ...Object.fromEntries(
    ['UNB', 'UNH', 'BGM', 'ERC', 'FTX', 'STS', 'RFF', 'DOC', 'UNT', 'UNZ'].map(tag => [tag, tags.has(tag)]),
  ) }
}

function firstTagIndex(segments: readonly SourceSegment[], tag: string): number | null {
  const index = segments.findIndex(segment => segment.tag === tag.toUpperCase())
  return index >= 0 ? index : null
}

function textForSegment(segment: SourceSegment | null | undefined, elementIndex: number, componentIndex: number | null | undefined, una: EdifactServiceStringAdvice): string | null {
  if (componentIndex === null || componentIndex === undefined) return element(segment, elementIndex, una)
  return segmentComposite(segment, elementIndex, una)[componentIndex]?.trim() || null
}

function validateFieldLimits(params: {
  profile: EdielMessageProfile
  segments: readonly SourceSegment[]
  una: EdifactServiceStringAdvice
  issues: EdielPayloadPreflightIssue[]
}) {
  for (const limit of params.profile.fieldLimits) {
    for (const segment of params.segments.filter(item => item.tag === limit.segment.toUpperCase())) {
      const prodatDocument = params.profile.family === 'PRODAT' && limit.segment === 'BGM' && limit.elementIndex === 2
      const value = prodatDocument ? prodatDocumentValue('203', params.segments, params.una)
        : textForSegment(segment, limit.elementIndex, limit.componentIndex, params.una)
      if (!value) continue
      const actual = value.length
      if (actual > limit.max) {
        params.issues.push(issue({
          severity: limit.severity ?? 'error',
          code: 'PROFILE_FIELD_LENGTH_EXCEEDED',
          title: `${limit.label} är för långt`,
          description: `${params.profile.key}: värdet är ${actual} tecken men max är ${limit.max}.`,
          segment,
        }))
      }
    }
  }
}

function validateSegmentProfile(params: {
  profile: EdielMessageProfile | null
  segments: readonly SourceSegment[]
  una: EdifactServiceStringAdvice
  canonicalFamily: string | null
  canonicalCode: string | null
  messageTypeToken: string | null
  mode: 'send' | 'parse'
  issues: EdielPayloadPreflightIssue[]
}) {
  if (!params.profile) {
    params.issues.push(issue({
      severity: params.mode === 'send' ? 'error' : 'warning',
      code: 'MESSAGE_PROFILE_MISSING',
      title: 'Meddelandeprofil saknas',
      description: `Ingen certifierad segmentprofil hittades för ${params.canonicalFamily ?? 'okänd'} ${params.canonicalCode ?? ''}.`,
    }))
    return
  }

  for (const requirement of params.profile.requiredSegments) {
    const count = params.segments.filter(segment => segment.tag === requirement.tag).length
    if (typeof requirement.min === 'number' && count < requirement.min) {
      params.issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PROFILE_REQUIRED_SEGMENT_MISSING',
        title: `${requirement.tag} saknas enligt ${params.profile.key}`,
        description: requirement.description,
      }))
    }
    if (typeof requirement.max === 'number' && count > requirement.max) {
      params.issues.push(issue({
        severity: 'error',
        code: 'PROFILE_SEGMENT_REPEATED_TOO_MANY_TIMES',
        title: `${requirement.tag} förekommer för många gånger`,
        description: `${params.profile.key}: ${requirement.tag} får förekomma max ${requirement.max} gånger men finns ${count} gånger.`,
      }))
    }
  }

  for (const forbidden of params.profile.forbiddenSegments ?? []) {
    const count = params.segments.filter(segment => segment.tag === forbidden.tag).length
    if (count > 0) {
      params.issues.push(issue({
        severity: 'error',
        code: 'PROFILE_FORBIDDEN_SEGMENT_PRESENT',
        title: `${forbidden.tag} får inte finnas i ${params.profile.key}`,
        description: forbidden.description,
      }))
    }
  }

  if (params.messageTypeToken && params.profile.expectedUnhTokens.length > 0) {
    const normalizedToken = params.messageTypeToken.toUpperCase()
    const matches = params.profile.expectedUnhTokens.some((token) => token.toUpperCase() === normalizedToken)
    if (!matches) {
      params.issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PROFILE_UNH_TOKEN_MISMATCH',
        title: 'UNH-version matchar inte certifierad profil',
        description: `${params.profile.key} förväntar ${params.profile.expectedUnhTokens.join(' eller ')}, payload anger ${params.messageTypeToken}.`,
      }))
    }
  }

  const bgm = params.segments.find(segment => segment.tag === 'BGM') ?? null
  const bgmCode = params.profile.family === 'PRODAT'
    ? prodatDocumentValue('202', params.segments, params.una)?.toUpperCase() ?? null
    : textForSegment(bgm, 1, 0, params.una)?.toUpperCase() ?? null
  const unb = params.segments.find(segment => segment.tag === 'UNB') ?? null
  const applicationReference = textForSegment(unb, 7, null, params.una)
  if (params.profile.family !== 'CONTRL' && !applicationReference && params.mode === 'send') {
    params.issues.push(issue({
      severity: 'error',
      code: 'PROFILE_APPLICATION_REFERENCE_MISSING',
      title: 'Application Reference saknas',
      description: `${params.profile.key} kräver Application Reference i UNB. Värdet ska komma från route/rulebook, inte från generator-gissning.`,
      segment: unb,
    }))
  }
  if (bgmCode && params.profile.allowedBgmCodes !== '*' && !params.profile.allowedBgmCodes.includes(bgmCode)) {
    params.issues.push(issue({
      severity: params.mode === 'send' ? 'error' : 'warning',
      code: 'PROFILE_BGM_CODE_NOT_ALLOWED',
      title: 'BGM-kod matchar inte meddelandeprofil',
      description: `${params.profile.key} tillåter ${params.profile.allowedBgmCodes.join(', ')}, payload anger ${bgmCode}.`,
      segment: bgm,
    }))
  }
  if (params.profile.family === 'PRODAT' && bgmCode && /^Z\d{2}[A-Z]+$/i.test(bgmCode)) {
    params.issues.push(issue({
      severity: 'error',
      code: 'PRODAT_COMPOSITE_BGM_BLOCKED',
      title: 'PRODAT undertyp får inte ligga i BGM',
      description: 'BGM ska vara huvudfunktion, t.ex. Z03/Z13/Z14. Undertyp/status ska ligga i rätt segment/fält.',
      segment: bgm,
    }))
  }

  let previousIndex = -1
  for (const tag of params.profile.orderedTags) {
    const index = firstTagIndex(params.segments, tag)
    if (index === null) continue
    if (index < previousIndex) {
      params.issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PROFILE_SEGMENT_ORDER_WARNING',
        title: 'Segmentordningen avviker från profilen',
        description: `${tag} ligger tidigare än förväntat enligt ${params.profile.key}.`,
      }))
      break
    }
    previousIndex = index
  }

  if (params.profile.family === 'APERAK') {
    const ercSegments = params.segments.filter(segment => segment.tag === 'ERC')
    const ftxSegments = params.segments.filter(segment => segment.tag === 'FTX')
    if (ercSegments.length > ftxSegments.length) {
      params.issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'APERAK_ERC_WITHOUT_FTX',
        title: 'APERAK ERC saknar motsvarande FTX',
        description: 'Varje APERAK-status/felkod ska ha kort FTX-text. Interna långa feltexter ska inte skickas i payload.',
      }))
    }
    const positiveErc = ercSegments.some((segment) => textForSegment(segment, 1, 0, params.una) === '100')
    const ftxText = ftxSegments.map(segment => segmentComposite(segment, 4, params.una).join(' ').toUpperCase()).join(' ')
    if (positiveErc && !ftxText.includes('OK')) {
      params.issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'APERAK_POSITIVE_WITHOUT_OK_FTX',
        title: 'Positiv APERAK saknar OK-text',
        description: 'Positiv APERAK med ERC 100 ska ha FTX OK.',
      }))
    }

    const ercCodes = ercSegments.map((segment) => textForSegment(segment, 1, 0, params.una)).filter(Boolean)
    const ftxCodes = ftxSegments.map((segment) => textForSegment(segment, 3, 0, params.una)).filter(Boolean)
    const isUtiltsE66IntervalAck =
      params.profile.key === 'APERAK_UTILTS_E5SE5A' &&
      String(applicationReference ?? '').toUpperCase().includes('E66-T') &&
      bgmCode === '313'

    if (isUtiltsE66IntervalAck && ercCodes.includes('40')) {
      params.issues.push(issue({
        severity: 'error',
        code: 'APERAK_UTILTS_E66_GENERIC_ERC40_BLOCKED',
        title: 'Generisk APERAK-felkod blockerad för UTILTS E66-T',
        description: 'UTILTS E66-T med anvisningsfel får inte skickas med generisk ERC 40. Saknad/ogiltig DTM+597 ska skickas som ERC 41 och FTX 512 enligt runtime-beslut.',
        segment: ercSegments.find((segment) => textForSegment(segment, 1, 0, params.una) === '40') ?? null,
      }))
    }

    if (isUtiltsE66IntervalAck && ftxCodes.includes('40')) {
      params.issues.push(issue({
        severity: 'error',
        code: 'APERAK_UTILTS_E66_GENERIC_FTX40_BLOCKED',
        title: 'Generisk APERAK-FTX blockerad för UTILTS E66-T',
        description: 'UTILTS E66-T med anvisningsfel får inte skicka FTX-kod 40. Saknad/ogiltig DTM+597 ska skickas som FTX 512 MANDATORY FIELD MISSING.',
        segment: ftxSegments.find((segment) => textForSegment(segment, 3, 0, params.una) === '40') ?? null,
      }))
    }
  }

  if (params.profile.family === 'UTILTS_ERR') {
    const bgmErr = bgmCode === 'ERR'
    if (!bgmErr) {
      params.issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'UTILTS_ERR_BGM_NOT_ERR',
        title: 'UTILTS_ERR ska ha BGM+ERR',
        description: 'UTILTS_ERR-profilen kräver BGM+ERR för funktions-/processfel.',
        segment: bgm,
      }))
    }
  }

  validateFieldLimits({ profile: params.profile, segments: params.segments, una: params.una, issues: params.issues })
}

function validateEdifactPayload(params: {
  rawPayload: string
  mimeType?: string | null
  mode: 'send' | 'parse'
  parsedPayload?: unknown
  dateEventRow?:ProdatDateEventRow
  dateEventContext?:TgtDateEventValidationContext
  gasSerialChange?:GasSerialChangeSelection
  deathStatus?:DeathSelection
  meterChange?:MeterChangeSelection
  reportingContext?:ExpectedContext
  companyId?: string | null
}): EdielPayloadPreflightResult {
  const rawPayload = params.rawPayload
  const canonical = parseCanonicalEdielPayload({ rawPayload, standardHint: 'edifact' })
  // Source document identities also occur in APERAK ACW. Preserve released
  // terminators for every EDIFACT family instead of splitting literal quotes.
  const tokens = tokenizeEdifact(rawPayload)
  const { segments, una } = tokens
  const rawSegments = segments.map(segment => segment.raw)
  const issues: EdielPayloadPreflightIssue[] = []
  if (params.mode === 'send') for (const failure of prodatFreeTextSendIssues({ raw_payload: rawPayload })) issues.push(issue({ severity: failure.severity, code: failure.code, title: failure.title, description: failure.description, segment: failure.fieldPath }))
  const gasBoundary=params.mode==='send'?gasApplicabilitySendIssue({raw_payload:rawPayload,parsed_payload:params.parsedPayload}):null
  if(gasBoundary)issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${gasBoundary.code}`,title:gasBoundary.title,description:gasBoundary.description}))
  const deathBoundary=params.mode==='send'?deathStatusSendIssue({message_family:'PRODAT',raw_payload:rawPayload,parsed_payload:params.parsedPayload}):null
  if(deathBoundary)issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${deathBoundary.code}`,title:deathBoundary.title,description:deathBoundary.description}))
  const meterBoundary=params.mode==='send'?meterChangeSendIssue({message_family:'PRODAT',raw_payload:rawPayload}):null
  if(meterBoundary)issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${meterBoundary.code}`,title:meterBoundary.title,description:meterBoundary.description}))
  const unb = first(segments, 'UNB')
  const unh = first(segments, 'UNH')
  const bgm = first(segments, 'BGM')
  const unt = first(segments, 'UNT')
  const unz = first(segments, 'UNZ')
  const payloadSizeBytes = new TextEncoder().encode(rawPayload).length

  if (!rawPayload.startsWith('UNA:+.? ')) {
    issues.push(issue({ severity: 'warning', code: 'UNA_NOT_STANDARD', title: 'UNA saknas eller avviker', description: "EDIFACT bör byggas med UNA:+.? '." }))
  }
  if (!unb) issues.push(issue({ severity: 'error', code: 'MISSING_UNB', title: 'UNB saknas', description: 'Interchange header måste finnas.' }))
  if (!unh) issues.push(issue({ severity: 'error', code: 'MISSING_UNH', title: 'UNH saknas', description: 'Message header måste finnas.' }))
  if (!unt) issues.push(issue({ severity: 'error', code: 'MISSING_UNT', title: 'UNT saknas', description: 'Message trailer måste finnas.' }))
  if (!unz) issues.push(issue({ severity: 'error', code: 'MISSING_UNZ', title: 'UNZ saknas', description: 'Interchange trailer måste finnas.' }))
  if (canonical.family !== 'CONTRL' && !bgm) {
    issues.push(issue({ severity: 'error', code: 'MISSING_BGM', title: 'BGM saknas', description: 'BGM krävs för PRODAT, UTILTS, APERAK och UTILTS_ERR.' }))
  }

  if (/\r|\n/.test(rawPayload)) {
    issues.push(issue({ severity: params.mode === 'send' ? 'error' : 'warning', code: 'EDIFACT_LINEBREAKS', title: 'Radbrytningar i EDIFACT', description: 'EDIFACT-payload ska skickas utan radbrytningstecken.' }))
  }
  if (/^\uFEFF/.test(rawPayload)) {
    issues.push(issue({ severity: 'error', code: 'BOM_NOT_ALLOWED', title: 'BOM/styrtecken', description: 'Payload får inte börja med BOM eller styrtecken.' }))
  }
  if (payloadSizeBytes > RECOMMENDED_MAX_BYTES) {
    issues.push(issue({ severity: 'error', code: 'PAYLOAD_TOO_LARGE', title: 'Payload är för stor', description: 'Rekommenderad maxstorlek är 10 MB. Dela på applikationsnivå före EDI-konvertering.' }))
  }

  const declaredUntCount = numberOrNull(element(unt, 1, una))
  const declaredUnzCount = numberOrNull(element(unz, 1, una))
  const messageRef = element(unh, 1, una)
  const untRef = element(unt, 2, una)
  const unbRef = element(unb, 5, una)
  const unzRef = element(unz, 2, una)
  const unbSyntax = segmentComposite(unb, 1, una).join(':')
  const messageTypeToken = segmentComposite(unh, 2, una).join(':')
  const profile = profileForMessage({
    family: String(canonical.family),
    code: canonical.messageCode,
    messageTypeToken,
    rawSegments,
    una,
  })

  validateSegmentProfile({
    profile,
    segments,
    una,
    canonicalFamily: String(canonical.family),
    canonicalCode: canonical.messageCode,
    messageTypeToken,
    mode: params.mode,
    issues,
  })

  if (String(canonical.family).toUpperCase() === 'PRODAT') {
    for (const failure of validateProdatDateFields(String(canonical.messageCode), tokens.segments, tokens.una, params.mode === 'parse' ? 'inbound' : 'outbound')) {
      const qualifier = failure.fieldPath?.split('+')[1]
      const source = tokens.segments.find(row => row.tag === 'DTM' && segmentComposite(row, 1, tokens.una)[0] === qualifier)
      issues.push(issue({ severity: 'error', code: failure.code, title: failure.title,
        description: failure.description, segment: source?.raw }))
    }
    for (const failure of prodatPartySyntaxIssues(tokens.segments, tokens.una)) {
      issues.push(issue({
        severity: 'error',
        code: failure.kind === 'length' ? 'PROFILE_FIELD_LENGTH_EXCEEDED' : 'FIELD_MATRIX_FIELD_FORMAT_INVALID',
        title: 'PRODAT NAD-fält följer inte källspecifikationen',
        description: `Fält ${failure.fieldNumber ?? 'NAD'} har fel komponent, part, kodlista, längd eller placering (26.A s.45–46,79–83).`,
        segment: failure.raw,
      }))
    }

    for (const cav of params.mode === 'send' ? misplacedProdatEnergyProducts(String(canonical.messageCode), tokens.segments, tokens.una) : []) {
      issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PRODAT_ENERGY_PRODUCT_CAV_COMPONENT_MISMATCH',
        title: 'Energiprodukt ligger i fel CAV-komponent',
        description: 'PRODAT fält 506 Energiprodukt i CCI++Z14 ska renderas som CAV+::::<produkt-id>. CAV+:::<värde> placerar värdet som produktkod/fält 242 och valideras fel av Edielportalen.',
        segment: cav,
      }))
    }
  }

  if (String(canonical.family).toUpperCase() === 'PRODAT' && String(canonical.messageCode ?? '').toUpperCase() === 'Z13') {
    const hasHistoricalSubtype = prodatCharacteristicValue('223', segments, una) === 'S18'
    const endUser = readProdatParty('UD', rawSegments, una)
    const endUserSegment = endUser.raw
    const hasEndUser = Boolean(endUser.raw)
    const hasEndUserId = Boolean(endUser.id)
    const hasReportStart = Boolean(prodatDateValue('302', segments, una))
    const hasReportEnd = Boolean(prodatDateValue('321', segments, una))
    const contractStart = segments.find(segment => segment.tag === 'DTM' && segmentComposite(segment, 1, una)[0] === '92') ?? null

    if (hasHistoricalSubtype) {
      if (!hasReportStart) {
        issues.push(issue({
          severity: params.mode === 'send' ? 'error' : 'warning',
          code: 'PRODAT_Z13VH_DTM_90_MISSING',
          title: 'Z13VH saknar DTM+90',
          description: 'PRODAT Z13VH ska ange historiskt rapportstartdatum i DTM+90.',
        }))
      }
      if (!hasReportEnd) {
        issues.push(issue({
          severity: params.mode === 'send' ? 'error' : 'warning',
          code: 'PRODAT_Z13VH_DTM_91_MISSING',
          title: 'Z13VH saknar DTM+91',
          description: 'PRODAT Z13VH ska ange historiskt rapportslutdatum i DTM+91.',
        }))
      }
      if (contractStart) {
        issues.push(issue({
          severity: params.mode === 'send' ? 'error' : 'warning',
          code: 'PRODAT_Z13VH_DTM_92_FORBIDDEN',
          title: 'Z13VH får inte använda DTM+92',
          description: 'Historiska mätvärden ska använda rapportperioden DTM+90/DTM+91, inte avtalstart DTM+92.',
          segment: contractStart,
        }))
      }
    }

    if (!hasEndUser) {
      issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PRODAT_Z13_NAD_UD_MISSING',
        title: 'Z13 saknar slutkund',
        description: 'PRODAT Z13 ska innehålla SG17 NAD+UD med elanvändaren/slutkunden.',
      }))
    } else if (!hasEndUserId) {
      issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PRODAT_Z13_NAD_UD_ID_MISSING',
        title: 'Z13 saknar kund-id i NAD+UD',
        description: 'PRODAT Z13 ska innehålla kund-id i SG17 NAD+UD/C082.',
        segment: endUserSegment,
      }))
    }
  }

  if (String(canonical.family).toUpperCase() === 'PRODAT' && String(canonical.messageCode ?? '').toUpperCase() === 'Z18') {
    const hasEndUser = Boolean(readProdatParty('UD', rawSegments, una).id)
    const installationParty = segments.find(segment => segment.tag === 'NAD' && element(segment, 1, una) === 'IT') ?? null
    const hasReportEnd = Boolean(prodatDateValue('327', segments, una))
    const hasPermissionId = Boolean(prodatReferenceValue('325', rawSegments, una))

    if (!hasEndUser) {
      issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PRODAT_Z18_NAD_UD_MISSING',
        title: 'Z18 saknar slutkund',
        description: 'PRODAT Z18 ska innehålla SG17 NAD+UD. SG17 NAD+IT ersätter inte slutkundsgruppen.',
      }))
    }
    if (installationParty) {
      issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PRODAT_Z18_NAD_IT_FORBIDDEN',
        title: 'Z18 får inte innehålla NAD+IT',
        description: 'PRODAT Z18 ska använda SG17 NAD+UD. Edielportalen markerar SG17[IT] som används inte för Z18.',
        segment: installationParty,
      }))
    }
    if (!hasReportEnd) {
      issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PRODAT_Z18_DTM_164_MISSING',
        title: 'Z18 saknar DTM+164',
        description: 'PRODAT Z18 ska ange när tjänsten/rapporteringen upphör i DTM+164.',
      }))
    }
    if (!hasPermissionId) {
      issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PRODAT_Z18_RFF_Z09_MISSING',
        title: 'Z18 saknar RFF+Z09',
        description: 'PRODAT Z18 ska innehålla tillståndets id i RFF+Z09.',
      }))
    }
  }

  if(canonical.family==='PRODAT')for(const failure of validateProdatGasApplicability({code:canonical.messageCode??'',rawSegments,una,direction:params.mode==='send'?'outbound':'inbound',facts:{gasSerialChange:params.mode==='send'?undefined:params.gasSerialChange}}))issues.push(issue({severity:failure.severity,code:params.mode==='send'?`PRODAT_DEPENDENT_PREFLIGHT_${failure.code}`:failure.code,title:failure.title,description:failure.description}))
  if(params.mode==='parse'&&canonical.family==='PRODAT')for(const failure of validateProdatDeathStatus({code:canonical.messageCode??'',rawSegments,una,direction:'inbound',facts:{deathStatus:params.deathStatus}}))issues.push(issue({severity:failure.severity,code:failure.code,title:failure.title,description:failure.description}))
  if(params.mode==='parse'&&canonical.family==='PRODAT')for(const failure of validateProdatMeterChange({code:canonical.messageCode??'',rawSegments,una,direction:'inbound',facts:{meterChange:params.meterChange}}))issues.push(issue({severity:failure.severity,code:failure.code,title:failure.title,description:failure.description}))
  if(params.mode==='parse'&&canonical.family==='PRODAT')for(const failure of validateProdatDateEvents({code:canonical.messageCode??'',rawSegments,una,direction:'inbound'}))issues.push(issue({severity:'error',code:failure.code,title:failure.title,description:failure.description}))

  const rulebookValidation = validateRulebookMessage({
    family: String(canonical.family),
    code: canonical.messageCode,
    processGroup: canonical.processGroup,
    applicationReference: canonical.applicationReference,
    rawPayload,
    companyId: params.companyId,
    dateEventRow:params.dateEventRow,dateEventContext:params.dateEventContext,reportingContext:params.reportingContext,gasSerialChange:params.gasSerialChange,deathStatus:params.deathStatus,meterChange:params.meterChange,
    ...(params.mode==='send'?{environment:params.dateEventRow?.environment,direction:params.dateEventRow?.direction}:{}),
    mode: params.mode === 'send' ? 'send' : 'parse',
    parsedPayload: params.parsedPayload && typeof params.parsedPayload === 'object' && !Array.isArray(params.parsedPayload)
      ? params.parsedPayload as Record<string, unknown> : null,
  })

  for (const rulebookIssue of rulebookValidation.issues) {
    const duplicate = issues.some((existing) => existing.code === rulebookIssue.code && existing.description === rulebookIssue.description)
    if (duplicate) continue
    issues.push(issue({
      severity: rulebookIssue.severity,
      code: rulebookIssue.code,
      title: rulebookIssue.title,
      description: rulebookIssue.description,
      segment: rulebookIssue.fieldPath ?? null,
    }))
  }

  if (unbSyntax && unbSyntax.toUpperCase() !== 'UNOC:3') {
    issues.push(issue({ severity: 'warning', code: 'UNB_SYNTAX_NOT_UNOC3', title: 'Kontrollera syntaxidentifierare', description: `PRODAT/UTILTS/APERAK ska normalt använda UNOC:3, payload anger ${unbSyntax}.`, segment: unb }))
  }

  if (messageRef && untRef && messageRef !== untRef) {
    issues.push(issue({ severity: 'error', code: 'UNH_UNT_REFERENCE_MISMATCH', title: 'UNH/UNT referens matchar inte', description: `${messageRef} ≠ ${untRef}.`, segment: unt }))
  }
  if (unbRef && unzRef && unbRef !== unzRef) {
    issues.push(issue({ severity: 'error', code: 'UNB_UNZ_REFERENCE_MISMATCH', title: 'UNB/UNZ referens matchar inte', description: `${unbRef} ≠ ${unzRef}.`, segment: unz }))
  }

  if (declaredUntCount !== null && unh && unt) {
    const unhIndex = segments.indexOf(unh)
    const untIndex = segments.indexOf(unt)
    const actual = unhIndex >= 0 && untIndex >= unhIndex ? untIndex - unhIndex + 1 : null
    if (actual !== null && actual !== declaredUntCount) {
      issues.push(issue({ severity: 'error', code: 'UNT_COUNT_MISMATCH', title: 'UNT-räknare stämmer inte', description: `UNT anger ${declaredUntCount}, faktiskt antal UNH→UNT är ${actual}.`, segment: unt }))
    }
  }
  if (declaredUnzCount !== null) {
    const actualMessages = segments.filter(segment => segment.tag === 'UNH').length
    if (declaredUnzCount !== actualMessages) {
      issues.push(issue({ severity: 'error', code: 'UNZ_COUNT_MISMATCH', title: 'UNZ-räknare stämmer inte', description: `UNZ anger ${declaredUnzCount}, faktiskt antal UNH är ${actualMessages}.`, segment: unz }))
    }
  }

  checkMaxLength({ issues, value: segmentComposite(unb, 2, una)[0] ?? null, max: 35, code: 'UNB_SENDER_TOO_LONG', title: 'UNB avsändare för lång', segment: unb })
  checkMaxLength({ issues, value: segmentComposite(unb, 2, una)[2] ?? null, max: 14, code: 'UNB_SENDER_SUBADDRESS_TOO_LONG', title: 'UNB avsändar-subadress för lång', segment: unb })
  checkMaxLength({ issues, value: segmentComposite(unb, 3, una)[0] ?? null, max: 35, code: 'UNB_RECEIVER_TOO_LONG', title: 'UNB mottagare för lång', segment: unb })
  checkMaxLength({ issues, value: segmentComposite(unb, 3, una)[2] ?? null, max: 14, code: 'UNB_RECEIVER_SUBADDRESS_TOO_LONG', title: 'UNB mottagar-subadress för lång', segment: unb })
  checkMaxLength({ issues, value: unbRef, max: 14, code: 'UNB_REFERENCE_TOO_LONG', title: 'UNB interchange reference för lång', segment: unb })
  checkMaxLength({ issues, value: element(unb, 7, una), max: 14, code: 'UNB_APPLICATION_REFERENCE_TOO_LONG', title: 'Application Reference för lång', segment: unb })
  checkMaxLength({ issues, value: messageRef, max: 14, code: 'UNH_REFERENCE_TOO_LONG', title: 'UNH message reference för lång', segment: unh })

  checkIdentifierCharacters({ issues, value: unbRef, segment: unb, label: 'UNB interchange reference' })
  checkIdentifierCharacters({ issues, value: messageRef, segment: unh, label: 'UNH message reference' })
  for (const segment of segments) {
    const tag = segment.tag
    if (!IDENTIFIER_QUALIFIERS.has(tag)) continue
    // PRODAT NAD identifiers are checked against their source C082 definition
    // above, not against a generic normalization/character heuristic.
    if (tag === 'NAD' && canonical.family === 'PRODAT') continue
    const indices = tag === 'NAD' ? [2] : segment.elements.slice(1).map((_, index) => index + 1)
    for (const index of indices) {
      const candidate = segmentComposite(segment, index, una)[0] ?? null
      if (candidate && /^[A-Za-z0-9ÅÄÖåäö _.-]{4,}$/.test(candidate)) {
        checkIdentifierCharacters({ issues, value: candidate, segment, label: `${tag} identifierare` })
      }
    }
  }

  const mime = params.mimeType ?? null
  if (params.mode === 'send' && mime && !mime.toLowerCase().includes('application/edifact')) {
    issues.push(issue({ severity: 'error', code: 'MIME_TYPE_NOT_EDIFACT', title: 'Fel MIME-typ', description: `EDIFACT ska skickas som application/EDIFACT, inte ${mime}.` }))
  }

  const blocking = issues.some((item) => item.severity === 'error')
  return {
    ok: !blocking,
    blocking,
    family: String(canonical.family),
    code: canonical.messageCode,
    segmentCount: rawSegments.length,
    declaredUntCount,
    declaredUnzCount,
    payloadSizeBytes,
    mimeType: mime,
    issues,
    markers: markers(rawPayload, segments),
  }
}

function validateListPayload(rawPayload: string): EdielPayloadPreflightResult {
  const canonical = parseCanonicalEdielPayload({ rawPayload, standardHint: 'ai_list' })
  const lines = rawPayload.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const issues: EdielPayloadPreflightIssue[] = []
  const payloadSizeBytes = new TextEncoder().encode(rawPayload).length
  if (!rawPayload.includes(';')) {
    issues.push(issue({ severity: 'warning', code: 'AI_BI_NOT_SEMICOLON', title: 'Separator', description: 'AI/BI-lista ska vara semikolonseparerad även när filen är .csv.' }))
  }
  if (!rawPayload.includes('Ver20140401')) {
    issues.push(issue({ severity: 'warning', code: 'AI_BI_VERSION_MISSING', title: 'Versionsmärke saknas', description: 'Aktuell AI/BI-version ska vara Ver20140401.' }))
  }
  return {
    ok: !issues.some((item) => item.severity === 'error'),
    blocking: issues.some((item) => item.severity === 'error'),
    family: String(canonical.family),
    code: canonical.messageCode,
    segmentCount: lines.length,
    declaredUntCount: null,
    declaredUnzCount: null,
    payloadSizeBytes,
    mimeType: 'text/csv',
    issues,
    markers: { AI_BI: true },
  }
}

function validateXmlPayload(rawPayload: string, mimeType?: string | null): EdielPayloadPreflightResult {
  const canonical = parseCanonicalEdielPayload({ rawPayload, standardHint: 'xml' })
  const issues: EdielPayloadPreflightIssue[] = []
  const payloadSizeBytes = new TextEncoder().encode(rawPayload).length
  if (mimeType && !mimeType.toLowerCase().includes('xml')) {
    issues.push(issue({ severity: 'warning', code: 'XML_MIME_WARNING', title: 'MIME för XML', description: 'XML bör skickas som application/xml; charset="utf-8".' }))
  }
  if (/^\uFEFF/.test(rawPayload)) {
    issues.push(issue({ severity: 'error', code: 'XML_BOM_NOT_ALLOWED', title: 'BOM/styrtecken', description: 'XML-filer ska inte ha inledande BOM.' }))
  }
  return {
    ok: !issues.some((item) => item.severity === 'error'),
    blocking: issues.some((item) => item.severity === 'error'),
    family: String(canonical.family),
    code: canonical.messageCode,
    segmentCount: 1,
    declaredUntCount: null,
    declaredUnzCount: null,
    payloadSizeBytes,
    mimeType: mimeType ?? 'application/xml; charset="utf-8"',
    issues,
    markers: { XML: true },
  }
}

export function preflightEdielPayload(params: {
  rawPayload: string | null | undefined
  mimeType?: string | null
  messageStandard?: EdielMessageRow['message_standard'] | null
  mode?: 'send' | 'parse'
  /** Optional persisted renderer metadata. PRODAT register facts are accepted
   * only through their body-bound evidence envelope in the rulebook validator. */
  parsedPayload?: unknown
  dateEventRow?:ProdatDateEventRow
  dateEventContext?:TgtDateEventValidationContext
  gasSerialChange?:GasSerialChangeSelection
  deathStatus?:DeathSelection
  meterChange?:MeterChangeSelection
  reportingContext?:ExpectedContext
  companyId?: string | null
}): EdielPayloadPreflightResult {
  const rawPayload = String(params.rawPayload ?? '').trim()
  const payloadSizeBytes = new TextEncoder().encode(rawPayload).length
  if (!rawPayload) {
    return {
      ok: false,
      blocking: true,
      family: null,
      code: null,
      segmentCount: null,
      declaredUntCount: null,
      declaredUnzCount: null,
      payloadSizeBytes,
      mimeType: params.mimeType ?? null,
      issues: [issue({ severity: 'error', code: 'EMPTY_PAYLOAD', title: 'Payload saknas', description: 'Meddelandet saknar payload.' })],
      markers: {},
    }
  }

  // Actual Z10 must reach its EDIFACT send boundary before caller format hints
  // can select XML/list early returns. Preserve ordinary syntax validation there.
  if (params.mode === 'send' && (prodatFreeTextSendIssues({ raw_payload: rawPayload }).length > 0 || gasApplicabilitySendIssue({raw_payload:rawPayload,parsed_payload:params.parsedPayload}) || deathStatusSendIssue({raw_payload:rawPayload,parsed_payload:params.parsedPayload}) || meterChangeSendIssue({raw_payload:rawPayload}))) {
    return validateEdifactPayload({...params,rawPayload,mode:'send'})
  }
  if (params.messageStandard === 'xml' || rawPayload.startsWith('<')) return validateXmlPayload(rawPayload, params.mimeType ?? null)
  const edifactDeclared = params.messageStandard === 'edifact' || rawPayload.startsWith('UNA')
  if (params.messageStandard === 'ai_list' || (!edifactDeclared && !rawPayload.includes("'") && rawPayload.includes(';'))) return validateListPayload(rawPayload)
  return validateEdifactPayload({ rawPayload, mimeType: params.mimeType ?? null, mode: params.mode ?? 'parse', parsedPayload:params.parsedPayload,companyId:params.companyId,dateEventRow:params.dateEventRow,dateEventContext:params.dateEventContext,reportingContext:params.reportingContext,gasSerialChange:params.gasSerialChange,deathStatus:params.deathStatus,meterChange:params.meterChange })
}

export function preflightEdielMessageRow(message: EdielMessageRow, mode: 'send' | 'parse' = 'send', dateEventContext?:TgtDateEventValidationContext,reportingContext?:ExpectedContext): EdielPayloadPreflightResult {
  const result = preflightEdielPayload({
    rawPayload: message.raw_payload,
    mimeType: message.mime_type,
    messageStandard: message.message_standard,
    mode,
    parsedPayload:message.parsed_payload,
    companyId:message.company_id,dateEventRow:message,dateEventContext,reportingContext,
  })
  const gasBoundary=mode==='send'?gasApplicabilitySendIssue(message):null
  if(gasBoundary){result.issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${gasBoundary.code}`,title:gasBoundary.title,description:gasBoundary.description}));result.ok=false;result.blocking=true}
  const deathBoundary=mode==='send'?deathStatusSendIssue(message):null
  if(deathBoundary){result.issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${deathBoundary.code}`,title:deathBoundary.title,description:deathBoundary.description}));result.ok=false;result.blocking=true}
  const meterBoundary=mode==='send'?meterChangeSendIssue(message):null
  if(meterBoundary){result.issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${meterBoundary.code}`,title:meterBoundary.title,description:meterBoundary.description}));result.ok=false;result.blocking=true}
  if (!message.raw_payload || (result.family !== 'PRODAT' && message.message_family !== 'PRODAT' && !/^(?:UNA|UNB|UNH)/.test(message.raw_payload.trimStart()))) return result
  try {
    const tokens = tokenizeEdifact(message.raw_payload)
    const scopeFailure = mode === 'send' ? prodatSendMessageScopeIssue(tokens) : null
    if (scopeFailure) {
      result.issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${scopeFailure.code}`,title:scopeFailure.title,description:scopeFailure.description}))
      return {...result, ok:false, blocking:true}
    }
    if (result.family !== 'PRODAT' && message.message_family !== 'PRODAT') return result
    // A row label cannot hide a real PRODAT header or turn another family into
    // PRODAT. Detached fragments retain their explicit row-family fallback.
    const header = tokens.segments.find(segment => segment.tag === 'UNH')
    if (header && segmentComposite(header, 2, tokens.una)[0]?.trim().toUpperCase() !== 'PRODAT') return result
    const rawSegments = tokens.segments.map(segment => segment.raw)
    const code = result.code ?? String(message.message_code ?? '')
    if (mode === 'send') {
      for (const failure of validateProdatSubtypePayload({family:'PRODAT', code, rawSegments, una:tokens.una})) {
        result.issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${failure.code}`,title:failure.title,description:failure.description}))
      }
    }
    const facts = mode === 'send' ? readProdatRegisterEvidence({dateEventRow:message,dateEventContext,reportingContext,code,rawSegments,una:tokens.una,parsedPayload:message.parsed_payload,companyId:message.company_id,runId:typeof message.parsed_payload?.testRunId==='string'?message.parsed_payload.testRunId:null,stepNo:typeof message.parsed_payload?.stepNo==='number'?message.parsed_payload.stepNo:null}) : undefined
    if(mode==='send')for(const failure of validateProdatReportingPermission({code,rawSegments,una:tokens.una,facts,requireAuthority:true,reportingContext}))result.issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${failure.code}`,title:failure.title,description:failure.description}))
    if(mode==='send')for(const failure of validateProdatDateEvents({code,rawSegments,una:tokens.una,facts,requireAuthority:true,dateEventContext}))result.issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${failure.code}`,title:failure.title,description:failure.description}))
    if(mode==='send')for(const failure of validateProdatInvoicee({code,rawSegments,una:tokens.una,facts}))result.issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${failure.code}`,title:failure.title,description:failure.description}))
    if(mode==='send')for(const failure of validateProdatEndUserAddress({code,rawSegments,una:tokens.una,facts}))result.issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${failure.code}`,title:failure.title,description:failure.description}))
    for (const failure of validateProdatRegisterPayload({code,rawSegments,una:tokens.una,facts,requireConditions:mode === 'send',applicationReference:message.application_reference})) {
      result.issues.push(issue({severity:'error',code:`PRODAT_REGISTER_PREFLIGHT_${failure.code}`,title:failure.title,description:failure.description}))
    }
  } catch (error) {
    const authorityIssue=reportingAuthorityIssue(error)??prodatDateEventAuthorityIssue(error)
    if(authorityIssue)result.issues.push(issue({severity:'error',code:`PRODAT_DEPENDENT_PREFLIGHT_${authorityIssue.code}`,title:authorityIssue.title,description:authorityIssue.description}))
    result.issues.push(issue({severity:'error',code:'PRODAT_REGISTER_EVIDENCE_INVALID',title:'Ogiltigt registerunderlag',description:'Registerunderlaget är ogiltigt eller hör till en annan meddelandeversion. Bygg om med verifierade objektfakta.'}))
  }
  result.blocking = result.issues.some(issue => issue.severity === 'error')
  result.ok = !result.blocking
  return result
}
