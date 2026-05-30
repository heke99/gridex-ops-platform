// lib/ediel/core/edifactSegments.ts

export type EdifactSegment = {
  tag: string
  raw: string
  elements: string[]
  index: number
}

export type EdifactMessageFacts = {
  segments: EdifactSegment[]
  rawSegments: string[]
  unb: EdifactSegment | null
  unh: EdifactSegment | null
  bgm: EdifactSegment | null
  unt: EdifactSegment | null
  unz: EdifactSegment | null
  messageType: string | null
  messageReference: string | null
  messageCode: string | null
  documentReference: string | null
  interchangeReference: string | null
  senderComposite: string | null
  receiverComposite: string | null
  lineItems: EdifactLineItem[]
}

export type EdifactLineItem = {
  lineNo: string | null
  itemId: string | null
  segments: EdifactSegment[]
  rffLi: string | null
  rffZ05: string | null
  rffMg: string | null
  hasQty31: boolean
  hasConstant: boolean
  hasDigitCount: boolean
  hasMeterNumber: boolean
}

type EdifactServiceChars = {
  component: string
  element: string
  decimal: string
  release: string
  repetition: string
  segment: string
}

const DEFAULT_SERVICE_CHARS: EdifactServiceChars = {
  component: ':',
  element: '+',
  decimal: '.',
  release: '?',
  repetition: ' ',
  segment: "'",
}

function readServiceChars(rawPayload: string): EdifactServiceChars {
  if (!rawPayload.toUpperCase().startsWith('UNA') || rawPayload.length < 9) {
    return DEFAULT_SERVICE_CHARS
  }

  return {
    component: rawPayload[3] ?? DEFAULT_SERVICE_CHARS.component,
    element: rawPayload[4] ?? DEFAULT_SERVICE_CHARS.element,
    decimal: rawPayload[5] ?? DEFAULT_SERVICE_CHARS.decimal,
    release: rawPayload[6] ?? DEFAULT_SERVICE_CHARS.release,
    repetition: rawPayload[7] ?? DEFAULT_SERVICE_CHARS.repetition,
    segment: rawPayload[8] ?? DEFAULT_SERVICE_CHARS.segment,
  }
}

function stripUna(rawPayload: string): string {
  return rawPayload.toUpperCase().startsWith('UNA')
    ? rawPayload.slice(9)
    : rawPayload
}

function splitReleased(value: string, separator: string, release: string): string[] {
  const parts: string[] = []
  let current = ''
  let released = false

  for (const char of value) {
    if (released) {
      current += char
      released = false
      continue
    }

    if (char === release) {
      released = true
      continue
    }

    if (char === separator) {
      parts.push(current)
      current = ''
      continue
    }

    current += char
  }

  parts.push(current)
  return parts
}

function splitSegments(value: string, chars: EdifactServiceChars): string[] {
  const parts: string[] = []
  let current = ''
  let released = false

  for (const char of value) {
    if (released) {
      current += chars.release
      current += char
      released = false
      continue
    }

    if (char === chars.release) {
      released = true
      continue
    }

    if (char === chars.segment) {
      parts.push(current)
      current = ''
      continue
    }

    current += char
  }

  if (released) current += chars.release
  parts.push(current)
  return parts
}

export function splitEdifactElements(rawSegment: string | null | undefined): string[] {
  const chars = DEFAULT_SERVICE_CHARS
  return splitReleased(String(rawSegment ?? ''), chars.element, chars.release)
}

export function splitEdifactComponents(value: string | null | undefined): string[] {
  const chars = DEFAULT_SERVICE_CHARS
  return splitReleased(String(value ?? ''), chars.component, chars.release)
}

export function getEdifactSegments(rawPayload: string | null | undefined): string[] {
  const raw = String(rawPayload ?? '')
  const chars = readServiceChars(raw)
  return splitSegments(
    stripUna(raw).replace(/\r\n/g, '').replace(/\n/g, ''),
    chars
  )
    .map((segment) => segment.trim())
    .filter(Boolean)
}

export function parseEdifactSegments(rawPayload: string | null | undefined): EdifactSegment[] {
  return getEdifactSegments(rawPayload).map((raw, index) => {
    const elements = splitEdifactElements(raw)
    return {
      raw,
      elements,
      tag: String(elements[0] ?? '').toUpperCase(),
      index,
    }
  })
}

export function findSegment(segments: readonly EdifactSegment[], tag: string): EdifactSegment | null {
  const normalized = tag.toUpperCase()
  return segments.find((segment) => segment.tag === normalized) ?? null
}

export function findSegments(segments: readonly EdifactSegment[], tag: string): EdifactSegment[] {
  const normalized = tag.toUpperCase()
  return segments.filter((segment) => segment.tag === normalized)
}

export function firstComponent(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const first = splitEdifactComponents(raw)[0]?.trim() ?? ''
  return first.length > 0 ? first : null
}

export function element(segment: EdifactSegment | null | undefined, index: number): string | null {
  const value = segment?.elements[index]?.trim() ?? ''
  return value.length > 0 ? value : null
}

function segmentsBetween(
  segments: readonly EdifactSegment[],
  startIndex: number,
  endIndexExclusive: number
): EdifactSegment[] {
  return segments.filter((segment) => segment.index >= startIndex && segment.index < endIndexExclusive)
}

function valueAfterPrefix(segment: EdifactSegment, prefix: string): string | null {
  if (!segment.raw.startsWith(prefix)) return null
  const value = segment.raw.slice(prefix.length).trim()
  return value.length > 0 ? value : null
}

function hasCciWithCav(lineSegments: readonly EdifactSegment[], cciCode: string): boolean {
  for (let index = 0; index < lineSegments.length; index += 1) {
    const segment = lineSegments[index]
    if (segment?.raw !== `CCI++${cciCode}`) continue
    const next = lineSegments[index + 1]
    if (!next || next.tag !== 'CAV') return false
    const rawValue = next.raw.replace(/^CAV\+/, '').trim()
    if (!rawValue || rawValue === ':::' || rawValue === ':::0') return false
    return true
  }
  return false
}

function buildLineItems(segments: readonly EdifactSegment[]): EdifactLineItem[] {
  const lineStarts = segments.filter((segment) => segment.tag === 'LIN')

  return lineStarts.map((lin, index) => {
    const nextLin = lineStarts[index + 1]
    const lineSegments = segmentsBetween(segments, lin.index, nextLin?.index ?? Number.POSITIVE_INFINITY)
    const itemComposite = element(lin, 3)
    const itemId = firstComponent(itemComposite)
    const rffLiSegment = lineSegments.find((segment) => segment.raw.startsWith('RFF+LI')) ?? null
    const rffZ05Segment = lineSegments.find((segment) => segment.raw.startsWith('RFF+Z05:')) ?? null
    const rffMgSegment = lineSegments.find((segment) => segment.raw.startsWith('RFF+MG:')) ?? null

    return {
      lineNo: element(lin, 1),
      itemId,
      segments: lineSegments,
      rffLi: rffLiSegment ? valueAfterPrefix(rffLiSegment, 'RFF+LI:') : null,
      rffZ05: rffZ05Segment ? valueAfterPrefix(rffZ05Segment, 'RFF+Z05:') : null,
      rffMg: rffMgSegment ? valueAfterPrefix(rffMgSegment, 'RFF+MG:') : null,
      hasQty31: lineSegments.some((segment) => segment.raw.startsWith('QTY+31:')),
      hasConstant: hasCciWithCav(lineSegments, 'Z02'),
      hasDigitCount: hasCciWithCav(lineSegments, 'Z16'),
      hasMeterNumber: Boolean(rffMgSegment),
    }
  })
}

export function parseEdifactMessageFacts(rawPayload: string | null | undefined): EdifactMessageFacts {
  const segments = parseEdifactSegments(rawPayload)
  const rawSegments = segments.map((segment) => segment.raw)
  const unb = findSegment(segments, 'UNB')
  const unh = findSegment(segments, 'UNH')
  const bgm = findSegment(segments, 'BGM')
  const unt = findSegment(segments, 'UNT')
  const unz = findSegment(segments, 'UNZ')
  const unbDate = element(unb, 4)
  const unbTime = element(unb, 5)

  return {
    segments,
    rawSegments,
    unb,
    unh,
    bgm,
    unt,
    unz,
    messageType: firstComponent(element(unh, 2)),
    messageReference: element(unh, 1),
    messageCode: element(bgm, 1),
    documentReference: element(bgm, 2),
    interchangeReference: element(unb, 5) && !/^\d{4}$/.test(element(unb, 5) ?? '')
      ? element(unb, 5)
      : element(unb, 5) && unbDate && unbTime
        ? element(unb, 5)
        : element(unz, 2),
    senderComposite: element(unb, 2),
    receiverComposite: element(unb, 3),
    lineItems: buildLineItems(segments),
  }
}
