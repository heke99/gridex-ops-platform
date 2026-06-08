// lib/ediel/core/messageBuilder/payloadPreflight.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import { validateRulebookMessage } from '@/lib/ediel/rulebook/validator'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'
import {
  profileForMessage,
  segmentCount as countProfileSegment,
  tagOf,
  type EdielMessageProfile,
} from '@/lib/ediel/core/messageBuilder/segmentSchema'
import { compositeComponent, effectiveEdifactLength, segmentElement } from '@/lib/ediel/core/messageBuilder/fieldFormatter'

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

function issue(input: EdielPayloadPreflightIssue): EdielPayloadPreflightIssue {
  return input
}

function segments(rawPayload: string): string[] {
  // UNA is exactly 9 characters including the segment terminator, e.g. "UNA:+.? '".
  // Do not use trim/split before removing it, because the reserved blank before
  // the terminator is significant in Ediel's default UNA.
  const normalized = rawPayload.toUpperCase().startsWith('UNA')
    ? rawPayload.slice(9)
    : rawPayload
  return normalized.split("'").map((segment) => segment.trim()).filter(Boolean)
}

function element(segment: string | null | undefined, index: number): string | null {
  const value = segment?.split('+')[index]?.trim() ?? ''
  return value.length > 0 ? value : null
}

function first(rawSegments: readonly string[], prefix: string): string | null {
  return rawSegments.find((segment) => segment.toUpperCase().startsWith(prefix.toUpperCase())) ?? null
}

function all(rawSegments: readonly string[], prefix: string): string[] {
  return rawSegments.filter((segment) => segment.toUpperCase().startsWith(prefix.toUpperCase()))
}

function splitComposite(value: string | null | undefined): string[] {
  return String(value ?? '').split(':').map((part) => part.trim())
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
  segment?: string | null
}) {
  if (!params.value) return
  const effectiveLength = params.value.replace(/\?.?/g, (match) => match.startsWith('?') ? match.slice(1) : match).length
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
  segment?: string | null
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

function markers(rawPayload: string): Record<string, boolean> {
  return {
    UNA: /^UNA/.test(rawPayload),
    UNB: rawPayload.includes('UNB+'),
    UNH: rawPayload.includes('UNH+'),
    BGM: rawPayload.includes('BGM+'),
    ERC: rawPayload.includes('ERC+'),
    FTX: rawPayload.includes('FTX+'),
    STS: rawPayload.includes('STS+'),
    RFF: rawPayload.includes('RFF+'),
    DOC: rawPayload.includes('DOC+'),
    UNT: rawPayload.includes('UNT+'),
    UNZ: rawPayload.includes('UNZ+'),
  }
}


function firstTagIndex(rawSegments: readonly string[], tag: string): number | null {
  const index = rawSegments.findIndex((segment) => tagOf(segment) === tag.toUpperCase())
  return index >= 0 ? index : null
}

function textForSegment(segment: string | null | undefined, elementIndex: number, componentIndex?: number | null): string | null {
  const value = segmentElement(segment, elementIndex)
  if (componentIndex === null || componentIndex === undefined) return value
  return compositeComponent(value, componentIndex)
}

function validateFieldLimits(params: {
  profile: EdielMessageProfile
  rawSegments: readonly string[]
  issues: EdielPayloadPreflightIssue[]
}) {
  for (const limit of params.profile.fieldLimits) {
    for (const segment of params.rawSegments.filter((item) => tagOf(item) === limit.segment.toUpperCase())) {
      const value = textForSegment(segment, limit.elementIndex, limit.componentIndex)
      if (!value) continue
      const actual = effectiveEdifactLength(value)
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
  rawSegments: readonly string[]
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
    const count = countProfileSegment(params.rawSegments, requirement.tag)
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
    const count = countProfileSegment(params.rawSegments, forbidden.tag)
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

  const bgm = params.rawSegments.find((segment) => tagOf(segment) === 'BGM') ?? null
  const bgmCode = textForSegment(bgm, 1, 0)?.toUpperCase() ?? null
  const unb = params.rawSegments.find((segment) => tagOf(segment) === 'UNB') ?? null
  const applicationReference = textForSegment(unb, 7)
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
    const index = firstTagIndex(params.rawSegments, tag)
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
    const ercSegments = params.rawSegments.filter((segment) => tagOf(segment) === 'ERC')
    const ftxSegments = params.rawSegments.filter((segment) => tagOf(segment) === 'FTX')
    if (ercSegments.length > ftxSegments.length) {
      params.issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'APERAK_ERC_WITHOUT_FTX',
        title: 'APERAK ERC saknar motsvarande FTX',
        description: 'Varje APERAK-status/felkod ska ha kort FTX-text. Interna långa feltexter ska inte skickas i payload.',
      }))
    }
    const positiveErc = ercSegments.some((segment) => textForSegment(segment, 1, 0) === '100')
    const ftxText = ftxSegments.map((segment) => segment.toUpperCase()).join(' ')
    if (positiveErc && !ftxText.includes('OK')) {
      params.issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'APERAK_POSITIVE_WITHOUT_OK_FTX',
        title: 'Positiv APERAK saknar OK-text',
        description: 'Positiv APERAK med ERC 100 ska ha FTX OK.',
      }))
    }

    const ercCodes = ercSegments.map((segment) => textForSegment(segment, 1, 0)).filter(Boolean)
    const ftxCodes = ftxSegments.map((segment) => textForSegment(segment, 3, 0)).filter(Boolean)
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
        segment: ercSegments.find((segment) => textForSegment(segment, 1, 0) === '40') ?? null,
      }))
    }

    if (isUtiltsE66IntervalAck && ftxCodes.includes('40')) {
      params.issues.push(issue({
        severity: 'error',
        code: 'APERAK_UTILTS_E66_GENERIC_FTX40_BLOCKED',
        title: 'Generisk APERAK-FTX blockerad för UTILTS E66-T',
        description: 'UTILTS E66-T med anvisningsfel får inte skicka FTX-kod 40. Saknad/ogiltig DTM+597 ska skickas som FTX 512 MANDATORY FIELD MISSING.',
        segment: ftxSegments.find((segment) => textForSegment(segment, 3, 0) === '40') ?? null,
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

  validateFieldLimits({ profile: params.profile, rawSegments: params.rawSegments, issues: params.issues })
}

function validateEdifactPayload(params: {
  rawPayload: string
  mimeType?: string | null
  mode: 'send' | 'parse'
}): EdielPayloadPreflightResult {
  const rawPayload = params.rawPayload
  const rawSegments = segments(rawPayload)
  const issues: EdielPayloadPreflightIssue[] = []
  const unb = first(rawSegments, 'UNB+')
  const unh = first(rawSegments, 'UNH+')
  const bgm = first(rawSegments, 'BGM+')
  const unt = first(rawSegments, 'UNT+')
  const unz = first(rawSegments, 'UNZ+')
  const canonical = parseCanonicalEdielPayload({ rawPayload, standardHint: 'edifact' })
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

  const declaredUntCount = numberOrNull(element(unt, 1))
  const declaredUnzCount = numberOrNull(element(unz, 1))
  const messageRef = element(unh, 1)
  const untRef = element(unt, 2)
  const unbRef = element(unb, 5)
  const unzRef = element(unz, 2)
  const unbSyntax = element(unb, 1)
  const messageTypeToken = element(unh, 2)
  const profile = profileForMessage({
    family: String(canonical.family),
    code: canonical.messageCode,
    messageTypeToken,
    rawSegments,
  })

  validateSegmentProfile({
    profile,
    rawSegments,
    canonicalFamily: String(canonical.family),
    canonicalCode: canonical.messageCode,
    messageTypeToken,
    mode: params.mode,
    issues,
  })

  if (String(canonical.family).toUpperCase() === 'PRODAT' && String(canonical.messageCode ?? '').toUpperCase() === 'Z13') {
    const hasHistoricalSubtype = rawSegments.some((segment) => segment.toUpperCase() === 'CAV+S18')
    const hasZ13vSubtype = rawSegments.some((segment) => segment.toUpperCase() === 'CAV+S17')
    const endUserSegment = rawSegments.find((segment) => segment.toUpperCase().startsWith('NAD+UD+')) ?? null
    const hasEndUser = Boolean(endUserSegment)
    const hasEndUserId = Boolean(element(endUserSegment, 2))
    const hasReportStart = rawSegments.some((segment) => segment.toUpperCase().startsWith('DTM+90:'))
    const hasReportEnd = rawSegments.some((segment) => segment.toUpperCase().startsWith('DTM+91:'))
    const contractStart = rawSegments.find((segment) => segment.toUpperCase().startsWith('DTM+92:')) ?? null

    if (hasReportEnd && hasZ13vSubtype) {
      issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PRODAT_Z13VH_REASON_FOR_TRANSACTION_MISMATCH',
        title: 'Z13VH skickas som Z13V',
        description: 'PRODAT Z13 med DTM+91/rapportslut ska använda fält 223/CAV+S18. CAV+S17 hör till Z13V och får inte skickas för historiska mätvärden.',
      }))
    }

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
    const hasEndUser = rawSegments.some((segment) => segment.toUpperCase().startsWith('NAD+UD+'))
    const installationParty = rawSegments.find((segment) => segment.toUpperCase().startsWith('NAD+IT+')) ?? null
    const hasReportEnd = rawSegments.some((segment) => segment.toUpperCase().startsWith('DTM+164:'))
    const hasPermissionCreatedAt = rawSegments.some((segment) => segment.toUpperCase().startsWith('DTM+693:'))
    const hasPermissionId = rawSegments.some((segment) => segment.toUpperCase().startsWith('RFF+Z09:'))

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
    if (!hasPermissionCreatedAt) {
      issues.push(issue({
        severity: params.mode === 'send' ? 'error' : 'warning',
        code: 'PRODAT_Z18_DTM_693_MISSING',
        title: 'Z18 saknar DTM+693',
        description: 'PRODAT Z18 ska ange tillståndets skapandetid i DTM+693.',
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

  const rulebookValidation = validateRulebookMessage({
    family: String(canonical.family),
    code: canonical.messageCode,
    processGroup: canonical.processGroup,
    applicationReference: canonical.applicationReference,
    rawPayload,
    mode: params.mode === 'send' ? 'send' : 'parse',
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
    const unhIndex = rawSegments.indexOf(unh)
    const untIndex = rawSegments.indexOf(unt)
    const actual = unhIndex >= 0 && untIndex >= unhIndex ? untIndex - unhIndex + 1 : null
    if (actual !== null && actual !== declaredUntCount) {
      issues.push(issue({ severity: 'error', code: 'UNT_COUNT_MISMATCH', title: 'UNT-räknare stämmer inte', description: `UNT anger ${declaredUntCount}, faktiskt antal UNH→UNT är ${actual}.`, segment: unt }))
    }
  }
  if (declaredUnzCount !== null) {
    const actualMessages = all(rawSegments, 'UNH+').length
    if (declaredUnzCount !== actualMessages) {
      issues.push(issue({ severity: 'error', code: 'UNZ_COUNT_MISMATCH', title: 'UNZ-räknare stämmer inte', description: `UNZ anger ${declaredUnzCount}, faktiskt antal UNH är ${actualMessages}.`, segment: unz }))
    }
  }

  checkMaxLength({ issues, value: splitComposite(element(unb, 2))[0] ?? null, max: 35, code: 'UNB_SENDER_TOO_LONG', title: 'UNB avsändare för lång', segment: unb })
  checkMaxLength({ issues, value: splitComposite(element(unb, 2))[2] ?? null, max: 14, code: 'UNB_SENDER_SUBADDRESS_TOO_LONG', title: 'UNB avsändar-subadress för lång', segment: unb })
  checkMaxLength({ issues, value: splitComposite(element(unb, 3))[0] ?? null, max: 35, code: 'UNB_RECEIVER_TOO_LONG', title: 'UNB mottagare för lång', segment: unb })
  checkMaxLength({ issues, value: splitComposite(element(unb, 3))[2] ?? null, max: 14, code: 'UNB_RECEIVER_SUBADDRESS_TOO_LONG', title: 'UNB mottagar-subadress för lång', segment: unb })
  checkMaxLength({ issues, value: unbRef, max: 14, code: 'UNB_REFERENCE_TOO_LONG', title: 'UNB interchange reference för lång', segment: unb })
  checkMaxLength({ issues, value: element(unb, 7), max: 14, code: 'UNB_APPLICATION_REFERENCE_TOO_LONG', title: 'Application Reference för lång', segment: unb })
  checkMaxLength({ issues, value: messageRef, max: 14, code: 'UNH_REFERENCE_TOO_LONG', title: 'UNH message reference för lång', segment: unh })

  checkIdentifierCharacters({ issues, value: unbRef, segment: unb, label: 'UNB interchange reference' })
  checkIdentifierCharacters({ issues, value: messageRef, segment: unh, label: 'UNH message reference' })
  for (const segment of rawSegments) {
    const tag = segment.split('+')[0]?.toUpperCase() ?? ''
    if (!IDENTIFIER_QUALIFIERS.has(tag)) continue
    const values = tag === 'NAD' ? segment.split('+').slice(2, 3) : segment.split('+').slice(1)
    for (const value of values) {
      const candidate = splitComposite(value)[0] ?? null
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
    markers: markers(rawPayload),
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

  if (params.messageStandard === 'xml' || rawPayload.startsWith('<')) return validateXmlPayload(rawPayload, params.mimeType ?? null)
  if (params.messageStandard === 'ai_list' || (!rawPayload.includes("'") && rawPayload.includes(';'))) return validateListPayload(rawPayload)
  return validateEdifactPayload({ rawPayload, mimeType: params.mimeType ?? null, mode: params.mode ?? 'parse' })
}

export function preflightEdielMessageRow(message: EdielMessageRow, mode: 'send' | 'parse' = 'send'): EdielPayloadPreflightResult {
  return preflightEdielPayload({
    rawPayload: message.raw_payload,
    mimeType: message.mime_type,
    messageStandard: message.message_standard,
    mode,
  })
}
