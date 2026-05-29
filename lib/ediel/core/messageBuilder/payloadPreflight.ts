// lib/ediel/core/messageBuilder/payloadPreflight.ts

import type { EdielMessageRow } from '@/lib/ediel/types'
import { parseCanonicalEdielPayload } from '@/lib/ediel/core/canonicalMessage'

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
  const normalized = rawPayload.replace(/^UNA.{6}'/i, '')
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
    for (const value of segment.split('+').slice(1)) {
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
