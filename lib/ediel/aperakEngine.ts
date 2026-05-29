// lib/ediel/aperakEngine.ts

export type AperakEngineOutcome = 'positive' | 'negative'

export type AperakEngineApplicationError = {
  ercCode: string
  fieldCode?: string | null
  text: string
  referenceQualifier?: string | null
  referenceNumber?: string | null
  lineItemReference?: string | null
}

export type AperakEngineSource = {
  id: string
  rawPayload?: string | null
  messageFamily: string
  messageCode?: string | null
  senderEdielId?: string | null
  receiverEdielId?: string | null
  externalReference?: string | null
  messageReceivedAt?: string | null
}

export type AperakEngineRefs = {
  messageReference?: string | null
  documentReference?: string | null
  interchangeReference?: string | null
  lineItemReference?: string | null
  meteringPointId?: string | null
}

export type AperakEngineResult = {
  segments: string[]
  diagnostics: {
    engine: 'aperak'
    renderer: 'aperakEngine.renderAperakEdiel'
    sourceFamily: string
    outcome: AperakEngineOutcome
    previousMessageReference: string
    errorCount: number
  }
}

function trimOrNull(value?: string | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function sanitizeSegmentText(value?: string | null): string {
  return (value ?? '').replace(/['+]/g, ' ').trim()
}

function sanitizeEdifactToken(value?: string | null, maxLength = 35): string | null {
  const trimmed = trimOrNull(value)
  if (!trimmed) return null

  const sanitized = trimmed
    .replace(/[ÅÄ]/gi, 'A')
    .replace(/[Ö]/gi, 'O')
    .replace(/[åä]/g, 'a')
    .replace(/[ö]/g, 'o')
    .replace(/[^A-Za-z0-9_.\/-]/g, '')
    .slice(0, maxLength)

  return sanitized.length > 0 ? sanitized : null
}

function escapeEdifactText(value?: string | null, maxLength = 70): string {
  const text = sanitizeSegmentText(value).slice(0, maxLength)
  return text.replace(/\?/g, '??').replace(/:/g, '?:')
}

function segmentsFromRawPayload(rawPayload?: string | null): string[] {
  if (!rawPayload) return []

  const normalized = rawPayload
    .replace(/\r\n/g, '')
    .replace(/\n/g, '')
    .replace(/^UNA.{6}'/i, '')

  return normalized
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)
}


function segmentElement(segment: string | null | undefined, index: number): string | null {
  const value = segment?.split('+')[index]?.trim() ?? ''
  return value.length > 0 ? value : null
}

function compositeComponent(value: string | null | undefined, index: number): string | null {
  const component = value?.split(':')[index]?.trim() ?? ''
  return component.length > 0 ? component : null
}

function isRealEdifactDateTime(value: string | null | undefined): boolean {
  const raw = value?.trim() ?? ''
  if (!raw || raw.includes('?')) return false
  if (!/^(\d{8}|\d{10}|\d{12}|\d{14})$/.test(raw)) return false

  const year = Number(raw.slice(0, 4))
  const month = Number(raw.slice(4, 6))
  const day = Number(raw.slice(6, 8))
  const hour = raw.length >= 10 ? Number(raw.slice(8, 10)) : 0
  const minute = raw.length >= 12 ? Number(raw.slice(10, 12)) : 0
  const second = raw.length >= 14 ? Number(raw.slice(12, 14)) : 0
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  if (hour < 0 || hour > 23) return false
  if (minute < 0 || minute > 59) return false
  if (second < 0 || second > 59) return false

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  )
}

function splitUtiltsTransactionGroups(rawPayload?: string | null): Array<{ transactionReference: string | null; segments: string[] }> {
  const groups: Array<{ transactionReference: string | null; segments: string[] }> = []
  let current: { transactionReference: string | null; segments: string[] } | null = null

  for (const segment of segmentsFromRawPayload(rawPayload)) {
    const tag = segment.split('+')[0]?.toUpperCase() ?? ''
    if (tag === 'IDE') {
      if (current) groups.push(current)
      current = {
        transactionReference: compositeComponent(segmentElement(segment, 1), 1) ?? compositeComponent(segmentElement(segment, 1), 0),
        segments: [segment],
      }
      continue
    }

    if (current) current.segments.push(segment)
  }

  if (current) groups.push(current)

  if (groups.length > 0) return groups
  return [{ transactionReference: null, segments: segmentsFromRawPayload(rawPayload) }]
}

function utiltsGroupResolution(group: { segments: string[] }): string | null {
  const segment = group.segments.find((item) => item.toUpperCase().startsWith('DTM+354')) ?? null
  return compositeComponent(segmentElement(segment, 1), 1)
}

function utiltsGroupHasRealRegistrationTime(group: { segments: string[] }): boolean {
  return group.segments.some((segment) => {
    if (!segment.toUpperCase().startsWith('DTM+597')) return false
    return isRealEdifactDateTime(compositeComponent(segmentElement(segment, 1), 1))
  })
}

function inferUtiltsApplicationErrorsFromSource(params: {
  source: AperakEngineSource
  refs: AperakEngineRefs
}): AperakEngineApplicationError[] {
  const family = String(params.source.messageFamily ?? '').toUpperCase()
  const code = String(params.source.messageCode ?? '').toUpperCase()
  if (family !== 'UTILTS' || code !== 'E66') return []

  const errors: AperakEngineApplicationError[] = []
  const seen = new Set<string>()

  for (const group of splitUtiltsTransactionGroups(params.source.rawPayload)) {
    const resolution = utiltsGroupResolution(group)
    const isIntervalGroup = resolution === '15' || resolution === '60'
    if (!isIntervalGroup || utiltsGroupHasRealRegistrationTime(group)) continue

    const reference =
      sanitizeEdifactToken(group.transactionReference, 35) ??
      sanitizeEdifactToken(params.refs.lineItemReference, 35) ??
      sanitizeEdifactToken(params.refs.documentReference, 35) ??
      null
    const key = reference ?? 'message'
    if (seen.has(key)) continue
    seen.add(key)

    errors.push({
      ercCode: '41',
      fieldCode: '512',
      text: 'MANDATORY FIELD MISSING',
      referenceQualifier: 'ACW',
      referenceNumber: reference,
      lineItemReference: reference,
    })
  }

  return errors
}

function swedishDateTime(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${map.year}${map.month}${map.day}${map.hour}${map.minute}`
}

function swedishDateTimeFromEdifactUnb(rawPayload?: string | null): string | null {
  const segments = segmentsFromRawPayload(rawPayload)
  const unb = segments.find((segment) => segment.toUpperCase().startsWith('UNB+'))
  const parts = unb?.split('+') ?? []
  const dateTimeComposite = parts[4]?.trim() ?? ''
  const date = dateTimeComposite.includes(':')
    ? dateTimeComposite.split(':')[0]?.trim() ?? ''
    : dateTimeComposite
  const time = dateTimeComposite.includes(':')
    ? dateTimeComposite.split(':')[1]?.trim() ?? ''
    : parts[5]?.trim() ?? ''

  if (!/^\d{6}$/.test(date) || !/^\d{4}$/.test(time)) {
    return null
  }

  const yearPrefix = Number(date.slice(0, 2)) >= 70 ? '19' : '20'
  return `${yearPrefix}${date}${time}`
}

function normalizeAperakErrors(
  errors?: readonly AperakEngineApplicationError[] | null,
  fallbackText?: string | null
): AperakEngineApplicationError[] {
  const normalized = (errors ?? [])
    .map((error) => ({
      ercCode: sanitizeEdifactToken(error.ercCode, 12) ?? '',
      fieldCode: sanitizeEdifactToken(error.fieldCode ?? null, 12),
      text: escapeEdifactText(error.text, 70),
      referenceQualifier: sanitizeEdifactToken(error.referenceQualifier ?? null, 12),
      referenceNumber: sanitizeEdifactToken(error.referenceNumber ?? null, 35),
      lineItemReference: sanitizeEdifactToken(error.lineItemReference ?? null, 35),
    }))
    .filter((error) => error.ercCode.length > 0 && error.text.length > 0)

  if (normalized.length > 0) return normalized
  return [
    {
      ercCode: '40',
      fieldCode: '40',
      text: escapeEdifactText(fallbackText || 'Applikationen kunde inte bearbeta meddelandet', 70),
      referenceQualifier: null,
      referenceNumber: null,
      lineItemReference: null,
    },
  ]
}

export function renderAperakEdiel(params: {
  source: AperakEngineSource
  refs: AperakEngineRefs
  externalReference: string
  transactionReference: string
  outcome: AperakEngineOutcome
  messageText?: string | null
  applicationErrors?: readonly AperakEngineApplicationError[] | null
  /**
   * For UTILTS b-tests and transaction-scoped acknowledgements, APERAK must
   * acknowledge the individual inbound transaction instead of only BGM/1004.
   */
  utiltsAcknowledgementReference?: string | null
}): AperakEngineResult {
  const isUtiltsSource = params.source.messageFamily === 'UTILTS'
  const utiltsBgmCode = params.outcome === 'positive' ? '312' : '313'
  const bgmFunction = '34'
  const previousMessageReference =
    sanitizeEdifactToken(params.refs.documentReference) ??
    sanitizeEdifactToken(params.refs.messageReference) ??
    sanitizeEdifactToken(params.source.externalReference, 14) ??
    sanitizeEdifactToken(params.refs.interchangeReference, 14) ??
    sanitizeEdifactToken(params.source.id, 14) ??
    sanitizeEdifactToken(params.transactionReference) ??
    'UNKNOWN'

  const segments = isUtiltsSource
    ? [
        'UNH+1+APERAK:D:04A:UN:E5SE5A',
        `BGM+${utiltsBgmCode}+${sanitizeEdifactToken(params.externalReference) ?? 'APERAK'}+9`,
        `DTM+137:${swedishDateTime()}:203`,
        'DTM+735:?+0100:406',
        `DOC+${sanitizeEdifactToken(params.source.messageCode) ?? 'UTILTS'}:SVK:260+${previousMessageReference}`,
        `NAD+MS+${sanitizeEdifactToken(params.source.receiverEdielId) ?? 'UNKNOWN'}:SVK:260`,
        `NAD+MR+${sanitizeEdifactToken(params.source.senderEdielId) ?? 'UNKNOWN'}:SVK:260`,
        'NAD+DDQ',
      ]
    : [
        'UNH+1+APERAK:D:96A:UN:E2SE6A',
        `BGM+++${bgmFunction}`,
        `DTM+137:${swedishDateTime()}:203`,
      ]

  const receivedDateTime =
    swedishDateTimeFromEdifactUnb(params.source.rawPayload) ??
    (params.source.messageReceivedAt
      ? (() => {
          const receivedDate = new Date(params.source.messageReceivedAt as string)
          return Number.isFinite(receivedDate.getTime()) ? swedishDateTime(receivedDate) : null
        })()
      : null)

  if (!isUtiltsSource && receivedDateTime) {
    segments.push(`DTM+178:${receivedDateTime}:203`)
  }

  if (!isUtiltsSource) {
    segments.push(
      `RFF+ACW:${previousMessageReference}`,
      `NAD+FR+${sanitizeEdifactToken(params.source.receiverEdielId) ?? 'UNKNOWN'}:160:SVK+++++++SE`,
      `NAD+DO+${sanitizeEdifactToken(params.source.senderEdielId) ?? 'UNKNOWN'}:160:SVK+++++++SE`
    )
  }

  const inferredUtiltsErrors =
    params.outcome === 'negative' && isUtiltsSource
      ? inferUtiltsApplicationErrorsFromSource({ source: params.source, refs: params.refs })
      : []

  const errors =
    params.outcome === 'positive'
      ? [
          {
            ercCode: '100',
            fieldCode: null,
            text: 'OK',
            referenceQualifier: null,
            referenceNumber: null,
            lineItemReference: null,
          },
        ]
      : normalizeAperakErrors(
          params.applicationErrors && params.applicationErrors.length > 0
            ? params.applicationErrors
            : inferredUtiltsErrors,
          params.messageText ?? null
        )

  for (const error of errors) {
    segments.push(`ERC+${error.ercCode}::260`)
    segments.push(
      error.fieldCode
        ? `FTX+AAO++${error.fieldCode}::260+${error.text}`
        : `FTX+AAO+++${error.text}`
    )

    if (isUtiltsSource) {
      segments.push(`RFF+DM:${sanitizeEdifactToken(params.transactionReference) ?? 'APE'}`)
      const utiltsReference = params.outcome === 'positive'
        ? (sanitizeEdifactToken(params.utiltsAcknowledgementReference) ?? previousMessageReference)
        : (error.lineItemReference ?? error.referenceNumber ?? params.refs.lineItemReference ?? previousMessageReference)
      segments.push(`RFF+ACW:${sanitizeEdifactToken(utiltsReference) ?? previousMessageReference}`)
      continue
    }

    const errorReferenceQualifier = error.referenceQualifier ?? (error.referenceNumber ? 'Z07' : null)
    if (errorReferenceQualifier && error.referenceNumber) {
      segments.push(`RFF+${errorReferenceQualifier}:${error.referenceNumber}`)
    }

    if (error.lineItemReference) {
      segments.push(`RFF+LI:${error.lineItemReference}`)
    }
  }

  const hasPerErrorReference = errors.some((error) => error.referenceNumber)

  if (!isUtiltsSource && !hasPerErrorReference && params.refs.meteringPointId) {
    segments.push(`RFF+Z07:${params.refs.meteringPointId}`)
  }

  if (!isUtiltsSource && !hasPerErrorReference && params.refs.lineItemReference) {
    segments.push(`RFF+LI:${params.refs.lineItemReference}`)
  }

  return {
    segments,
    diagnostics: {
      engine: 'aperak',
      renderer: 'aperakEngine.renderAperakEdiel',
      sourceFamily: params.source.messageFamily,
      outcome: params.outcome,
      previousMessageReference,
      errorCount: errors.length,
    },
  }
}
