import {
  splitComposite,
  tokenizeEdifact,
  type EdifactTokenizedSegment,
} from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

export type CanonicalEdifactLineGroup = {
  lineIndex: number
  lineNumber: string | null
  itemId: string | null
  segments: EdifactTokenizedSegment[]
  references: Record<string, string[]>
  cciCavCodes: Record<string, string[]>
}

export type CanonicalEdifactMessage = {
  messageIndex: number
  segments: EdifactTokenizedSegment[]
  family: string | null
  messageReference: string | null
  messageCode: string | null
  documentReference: string | null
  lineGroups: CanonicalEdifactLineGroup[]
}

export type CanonicalEdifactAst = {
  una: EdifactServiceStringAdvice
  segments: EdifactTokenizedSegment[]
  messages: CanonicalEdifactMessage[]
  senderEdielId: string | null
  receiverEdielId: string | null
  interchangeReference: string | null
  applicationReference: string | null
  scalarTokens: Set<string>
}

function clean(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim()
  return trimmed ? trimmed : null
}

export function canonicalElement(
  segment: EdifactTokenizedSegment | null | undefined,
  index: number,
): string | null {
  return clean(segment?.elements[index] ?? null)
}

export function canonicalComposite(
  segment: EdifactTokenizedSegment | null | undefined,
  index: number,
  una: EdifactServiceStringAdvice,
): string[] {
  return splitComposite(segment?.elements[index] ?? null, una)
}

export function canonicalFirstComponent(
  segment: EdifactTokenizedSegment | null | undefined,
  index: number,
  una: EdifactServiceStringAdvice,
): string | null {
  return clean(canonicalComposite(segment, index, una)[0] ?? null)
}

function referenceMap(
  segments: readonly EdifactTokenizedSegment[],
  una: EdifactServiceStringAdvice,
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const segment of segments) {
    if (segment.tag !== 'RFF') continue
    const parts = canonicalComposite(segment, 1, una)
    const qualifier = clean(parts[0] ?? null)?.toUpperCase() ?? null
    const value = clean(parts.slice(1).join(una.componentDataElementSeparator))
    if (!qualifier || !value) continue
    result[qualifier] = [...(result[qualifier] ?? []), value]
  }
  return result
}

function cciCavMap(
  segments: readonly EdifactTokenizedSegment[],
  una: EdifactServiceStringAdvice,
): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  let current: string | null = null

  for (const segment of segments) {
    if (segment.tag === 'CCI') {
      current =
        canonicalFirstComponent(segment, 2, una)?.toUpperCase() ??
        canonicalFirstComponent(segment, 3, una)?.toUpperCase() ??
        null
      continue
    }
    if (segment.tag !== 'CAV' || !current) continue
    const components = canonicalComposite(segment, 1, una)
      .map((part) => clean(part)?.toUpperCase() ?? null)
      .filter((part): part is string => Boolean(part))
    const value = components[0] ?? null
    if (value) result[current] = [...(result[current] ?? []), value]
  }

  return result
}

function buildLineGroups(
  segments: readonly EdifactTokenizedSegment[],
  una: EdifactServiceStringAdvice,
): CanonicalEdifactLineGroup[] {
  const starts = segments.filter((segment) => segment.tag === 'LIN')
  return starts.map((line, index) => {
    const next = starts[index + 1]
    const group = segments.filter((segment) =>
      segment.index >= line.index && segment.index < (next?.index ?? Number.POSITIVE_INFINITY),
    )
    return {
      lineIndex: index,
      lineNumber: canonicalElement(line, 1),
      itemId: canonicalFirstComponent(line, 3, una),
      segments: group,
      references: referenceMap(group, una),
      cciCavCodes: cciCavMap(group, una),
    }
  })
}

function messageSlices(segments: readonly EdifactTokenizedSegment[]): EdifactTokenizedSegment[][] {
  const starts = segments.filter((segment) => segment.tag === 'UNH')
  if (!starts.length) return [segments.slice()]
  return starts.map((start, index) => {
    const next = starts[index + 1]
    return segments.filter((segment) =>
      segment.index >= start.index && segment.index < (next?.index ?? Number.POSITIVE_INFINITY),
    )
  })
}

function scalarTokenSet(
  segments: readonly EdifactTokenizedSegment[],
  una: EdifactServiceStringAdvice,
): Set<string> {
  const tokens = new Set<string>()
  for (const segment of segments) {
    tokens.add(segment.tag.toUpperCase())
    for (const value of segment.elements.slice(1)) {
      for (const component of splitComposite(value, una)) {
        const token = clean(component)?.toUpperCase()
        if (token) tokens.add(token)
      }
    }
  }
  return tokens
}

export function parseCanonicalEdifactAst(rawPayload: string | null | undefined): CanonicalEdifactAst {
  const tokenized = tokenizeEdifact(rawPayload)
  const unb = tokenized.segments.find((segment) => segment.tag === 'UNB') ?? null
  const sender = canonicalComposite(unb, 2, tokenized.una)
  const receiver = canonicalComposite(unb, 3, tokenized.una)

  const messages = messageSlices(tokenized.segments).map((segments, messageIndex) => {
    const unh = segments.find((segment) => segment.tag === 'UNH') ?? null
    const bgm = segments.find((segment) => segment.tag === 'BGM') ?? null
    return {
      messageIndex,
      segments,
      family: canonicalFirstComponent(unh, 2, tokenized.una)?.toUpperCase().replace('-', '_') ?? null,
      messageReference: canonicalElement(unh, 1),
      messageCode: canonicalFirstComponent(bgm, 1, tokenized.una)?.toUpperCase() ?? null,
      documentReference: canonicalElement(bgm, 2),
      lineGroups: buildLineGroups(segments, tokenized.una),
    }
  })

  return {
    una: tokenized.una,
    segments: tokenized.segments,
    messages,
    senderEdielId: clean(sender[0] ?? null),
    receiverEdielId: clean(receiver[0] ?? null),
    interchangeReference: canonicalElement(unb, 5),
    applicationReference: canonicalElement(unb, 7),
    scalarTokens: scalarTokenSet(tokenized.segments, tokenized.una),
  }
}

export function canonicalMessageFacts(rawPayload: string | null | undefined): {
  family: string | null
  messageCode: string | null
  applicationReference: string | null
  cciCavCodes: Record<string, string[]>
  dtmValues: Record<string, string[]>
  scalarTokens: Set<string>
} {
  const ast = parseCanonicalEdifactAst(rawPayload)
  const message = ast.messages[0] ?? null
  const cciCavCodes = cciCavMap(message?.segments ?? ast.segments, ast.una)
  const dtmValues: Record<string, string[]> = {}

  for (const segment of message?.segments ?? ast.segments) {
    if (segment.tag !== 'DTM') continue
    const parts = canonicalComposite(segment, 1, ast.una)
    const qualifier = clean(parts[0] ?? null)?.toUpperCase() ?? null
    const value = clean(parts[1] ?? null)?.toUpperCase() ?? null
    if (!qualifier || !value) continue
    dtmValues[qualifier] = [...(dtmValues[qualifier] ?? []), value]
  }

  return {
    family: message?.family ?? null,
    messageCode: message?.messageCode ?? null,
    applicationReference: ast.applicationReference,
    cciCavCodes,
    dtmValues,
    scalarTokens: ast.scalarTokens,
  }
}

export function hasCanonicalScalarToken(
  facts: Pick<ReturnType<typeof canonicalMessageFacts>, 'scalarTokens'>,
  token: string,
): boolean {
  return facts.scalarTokens.has(String(token).trim().toUpperCase())
}
