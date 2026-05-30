export type ParsedEdifactEnvelope = {
  rawPayload: string
  messageFamily: 'PRODAT' | 'UTILTS' | 'CONTRL' | 'APERAK' | 'UTILTS_ERR' | 'OTHER'
  messageCode: string | null
  interchangeReference: string | null
  transactionReference: string | null
  senderEdielId: string | null
  senderSubAddress: string | null
  receiverEdielId: string | null
  receiverSubAddress: string | null
  applicationReference: string | null
  bgmReference: string | null
  references: Record<string, string[]>
  parties: Record<string, string[]>
  dates: Record<string, string[]>
  quantities: Array<{ qualifier: string | null; value: number | null; rawValue: string | null; unit: string | null }>
  errorCodes: string[]
  freeText: string[]
  segments: string[]
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function splitParty(value: string | null): { edielId: string | null; subAddress: string | null } {
  if (!value) return { edielId: null, subAddress: null }
  const first = value.split('+')[0] ?? value
  const parts = first.split(':')
  return {
    edielId: cleanText(parts[0]),
    // UNB S002/S003 component 0007 is an ID qualifier (for example ZZ),
    // while component 0008 is the reverse routing/subaddress.
    subAddress: cleanText(parts[2] ?? null),
  }
}

function pushRecord(record: Record<string, string[]>, key: string | null, value: string | null) {
  if (!key || !value) return
  record[key] = [...(record[key] ?? []), value]
}

function normalizeMimeText(input: string): string {
  return input
    .replace(/=\r?\n/g, '')
    .replace(/=27/g, "'")
    .replace(/=2B/gi, '+')
    .replace(/=3A/gi, ':')
    .replace(/=0D=0A/gi, '\n')
}

export function extractEdifactPayload(input: string | null | undefined): string | null {
  const raw = cleanText(input)
  if (!raw) return null

  const candidates = [raw, normalizeMimeText(raw)]

  for (const candidate of candidates) {
    const unaIndex = candidate.indexOf('UNA')
    const unbIndex = candidate.indexOf('UNB')
    const start = unaIndex >= 0 ? unaIndex : unbIndex

    if (start < 0) continue

    const fromStart = candidate.slice(start)
    const unzIndex = fromStart.lastIndexOf('UNZ+')
    if (unzIndex < 0) return fromStart.trim()

    const afterUnz = fromStart.slice(unzIndex)
    const endQuote = afterUnz.indexOf("'")
    if (endQuote < 0) return fromStart.trim()

    return fromStart.slice(0, unzIndex + endQuote + 1).trim()
  }

  return null
}

function parseNumeric(value: string | null): number | null {
  if (!value) return null
  const normalized = value.replace(',', '.')
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseEdifactPayload(rawPayload: string): ParsedEdifactEnvelope {
  const payload = rawPayload.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  const normalized = payload.startsWith('UNA') ? payload.slice(9) : payload
  const segments = normalized
    .split("'")
    .map((segment) => segment.trim())
    .filter(Boolean)

  const references: Record<string, string[]> = {}
  const parties: Record<string, string[]> = {}
  const dates: Record<string, string[]> = {}
  const quantities: ParsedEdifactEnvelope['quantities'] = []
  const errorCodes: string[] = []
  const freeText: string[] = []
  let messageFamily: ParsedEdifactEnvelope['messageFamily'] = 'OTHER'
  let messageCode: string | null = null
  let interchangeReference: string | null = null
  let transactionReference: string | null = null
  let senderEdielId: string | null = null
  let senderSubAddress: string | null = null
  let receiverEdielId: string | null = null
  let receiverSubAddress: string | null = null
  let applicationReference: string | null = null
  let bgmReference: string | null = null

  for (const segment of segments) {
    const elements = segment.split('+')
    const tag = elements[0]

    if (tag === 'UNB') {
      const sender = splitParty(elements[2] ?? null)
      const receiver = splitParty(elements[3] ?? null)
      senderEdielId = sender.edielId
      senderSubAddress = sender.subAddress
      receiverEdielId = receiver.edielId
      receiverSubAddress = receiver.subAddress
      interchangeReference = cleanText(elements[5])
      applicationReference = cleanText(elements[7]) ?? applicationReference
    }

    if (tag === 'UNH') {
      transactionReference = cleanText(elements[1]) ?? transactionReference
      const typeParts = String(elements[2] ?? '').split(':')
      const family = cleanText(typeParts[0])?.toUpperCase() ?? 'OTHER'
      messageFamily = family === 'PRODAT' || family === 'UTILTS' || family === 'CONTRL' || family === 'APERAK'
        ? family
        : family === 'UTILTS_ERR'
          ? 'UTILTS_ERR'
          : 'OTHER'
    }

    if (tag === 'BGM') {
      const code = cleanText(elements[1]?.split(':')[0] ?? null)
      messageCode = code ?? messageCode
      bgmReference = cleanText(elements[2]) ?? bgmReference
      if (code === 'ERR') messageFamily = 'UTILTS_ERR'
    }

    if (tag === 'RFF') {
      const [qualifier, value] = String(elements[1] ?? '').split(':')
      pushRecord(references, cleanText(qualifier), cleanText(value))
    }

    if (tag === 'DTM') {
      const [qualifier, value] = String(elements[1] ?? '').split(':')
      pushRecord(dates, cleanText(qualifier), cleanText(value))
    }

    if (tag === 'QTY') {
      const [qualifier, value, unit] = String(elements[1] ?? '').split(':')
      quantities.push({ qualifier: cleanText(qualifier), rawValue: cleanText(value), value: parseNumeric(cleanText(value)), unit: cleanText(unit) })
    }

    if (tag === 'ERC') {
      const code = cleanText(String(elements[1] ?? '').split(':')[0] ?? null)
      if (code) errorCodes.push(code)
    }

    if (tag === 'FTX') {
      const text = elements
        .slice(3)
        .join(' ')
        .split(':')
        .map((part) => cleanText(part))
        .filter((part): part is string => Boolean(part))
        .join(' ')
      if (text) freeText.push(text)
    }

    if (tag === 'NAD') {
      const qualifier = cleanText(elements[1])
      const value = cleanText(elements[2]?.split(':')[0] ?? null)
      pushRecord(parties, qualifier, value)
    }
  }

  return {
    rawPayload,
    messageFamily,
    messageCode,
    interchangeReference,
    transactionReference,
    senderEdielId,
    senderSubAddress,
    receiverEdielId,
    receiverSubAddress,
    applicationReference,
    bgmReference,
    references,
    parties,
    dates,
    quantities,
    errorCodes,
    freeText,
    segments,
  }
}

export function parseInboundEmailContent(input: {
  rawEmail?: string | null
  bodyText?: string | null
  attachmentText?: string | null
}): ParsedEdifactEnvelope | null {
  const payload =
    extractEdifactPayload(input.attachmentText) ??
    extractEdifactPayload(input.bodyText) ??
    extractEdifactPayload(input.rawEmail)

  if (!payload) return null
  return parseEdifactPayload(payload)
}
