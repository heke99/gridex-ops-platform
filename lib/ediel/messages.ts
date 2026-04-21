// lib/ediel/messages.ts

export type BuildEdifactEnvelopeInput = {
  senderEdielId: string
  senderSubAddress?: string | null
  receiverEdielId: string
  receiverSubAddress?: string | null
  applicationReference?: string | null
  testFlag?: 0 | 1
  messageTypeToken: string
  segments: string[]
}

export type BuiltEdifactEnvelope = {
  raw: string
  interchangeReference: string
  messageReference: string
}

function sanitize(value?: string | null): string {
  return (value ?? '').replace(/['+]/g, ' ').trim()
}

function utcStampYYMMDDHHMM(date = new Date()): string {
  const yy = String(date.getUTCFullYear()).slice(-2)
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const hh = String(date.getUTCHours()).padStart(2, '0')
  const mi = String(date.getUTCMinutes()).padStart(2, '0')
  return `${yy}${mm}${dd}:${hh}${mi}`
}

function buildInterchangeReference(date = new Date()): string {
  const base = date.toISOString().replace(/[-:TZ.]/g, '').slice(2, 14)
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${base}${suffix}`
}

function ensureSegments(segments: string[]): string[] {
  return segments
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.endsWith("'") ? segment.slice(0, -1) : segment)
}

export function buildEdifactEnvelope(
  input: BuildEdifactEnvelopeInput
): BuiltEdifactEnvelope {
  const messageReference = '1'
  const interchangeReference = buildInterchangeReference()
  const senderSub = sanitize(input.senderSubAddress) || 'GRIDEX'
  const receiverSub = sanitize(input.receiverSubAddress) || 'EDIEL'
  const applicationReference = sanitize(input.applicationReference)
  const testFlag = input.testFlag ?? 1

  const coreSegments = ensureSegments(input.segments)

  const unbParts = [
    'UNB',
    'UNOC:3',
    `${sanitize(input.senderEdielId)}:${senderSub}`,
    `${sanitize(input.receiverEdielId)}:${receiverSub}`,
    utcStampYYMMDDHHMM(),
    interchangeReference,
  ]

  if (applicationReference) {
    while (unbParts.length < 8) {
      unbParts.push('')
    }
    unbParts[7] = applicationReference
  }

  if (typeof testFlag === 'number') {
    while (unbParts.length < 11) {
      unbParts.push('')
    }
    unbParts[10] = String(testFlag)
  }

  const unb = unbParts.join('+')
  const unh = `UNH+${messageReference}+${sanitize(input.messageTypeToken)}`
  const unt = `UNT+${coreSegments.length + 2}+${messageReference}`
  const unz = `UNZ+1+${interchangeReference}`

  const allSegments = [unb, unh, ...coreSegments, unt, unz]
  const raw = `${allSegments.join("'")}'`

  return {
    raw,
    interchangeReference,
    messageReference,
  }
}