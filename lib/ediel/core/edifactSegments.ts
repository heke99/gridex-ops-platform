// Compatibility projections over the canonical UNA-aware EDIFACT tokenizer.
// New runtime parsing must use canonicalEdifactAst/edifactTokenizer directly.

import {
  canonicalElement,
  canonicalFirstComponent,
  parseCanonicalEdifactAst,
} from '@/lib/ediel/core/canonicalEdifactAst'
import {
  splitComposite,
  tokenizeEdifact,
  type EdifactTokenizedSegment,
} from '@/lib/ediel/core/edifactTokenizer'

export type EdifactSegment = EdifactTokenizedSegment

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

/** @deprecated Use tokenizeEdifact/parseCanonicalEdifactAst when UNA context matters. */
export function splitEdifactElements(rawSegment: string | null | undefined): string[] {
  return tokenizeEdifact(String(rawSegment ?? '')).segments[0]?.elements ?? []
}

/** @deprecated Use splitComposite with the payload UNA when UNA context matters. */
export function splitEdifactComponents(value: string | null | undefined): string[] {
  return splitComposite(value)
}

export function getEdifactSegments(rawPayload: string | null | undefined): string[] {
  return tokenizeEdifact(rawPayload).segments.map((segment) => segment.raw)
}

export function parseEdifactSegments(rawPayload: string | null | undefined): EdifactSegment[] {
  return tokenizeEdifact(rawPayload).segments
}

export function findSegment(segments: readonly EdifactSegment[], tag: string): EdifactSegment | null {
  const normalized = tag.toUpperCase()
  return segments.find((segment) => segment.tag === normalized) ?? null
}

export function findSegments(segments: readonly EdifactSegment[], tag: string): EdifactSegment[] {
  const normalized = tag.toUpperCase()
  return segments.filter((segment) => segment.tag === normalized)
}

/** @deprecated Use canonicalFirstComponent with the payload UNA when UNA context matters. */
export function firstComponent(value: string | null | undefined): string | null {
  const first = splitComposite(value)[0]?.trim() ?? ''
  return first || null
}

export function element(segment: EdifactSegment | null | undefined, index: number): string | null {
  return canonicalElement(segment, index)
}

export function parseEdifactMessageFacts(rawPayload: string | null | undefined): EdifactMessageFacts {
  const ast = parseCanonicalEdifactAst(rawPayload)
  const segments = ast.segments
  const message = ast.messages[0] ?? null
  const unb = findSegment(segments, 'UNB')
  const unh = findSegment(message?.segments ?? segments, 'UNH')
  const bgm = findSegment(message?.segments ?? segments, 'BGM')
  const unt = findSegment(message?.segments ?? segments, 'UNT')
  const unz = findSegment(segments, 'UNZ')

  const lineItems: EdifactLineItem[] = (message?.lineGroups ?? []).map((group) => ({
    lineNo: group.lineNumber,
    itemId: group.itemId,
    segments: group.segments,
    rffLi: group.references.LI?.[0] ?? null,
    rffZ05: group.references.Z05?.[0] ?? null,
    rffMg: group.references.MG?.[0] ?? null,
    hasQty31: group.segments.some((segment) =>
      segment.tag === 'QTY' && canonicalFirstComponent(segment, 1, ast.una)?.toUpperCase() === '31',
    ),
    hasConstant: Boolean(group.cciCavCodes.Z02?.length),
    hasDigitCount: Boolean(group.cciCavCodes.Z16?.length),
    hasMeterNumber: Boolean(group.references.MG?.length),
  }))

  return {
    segments,
    rawSegments: segments.map((segment) => segment.raw),
    unb,
    unh,
    bgm,
    unt,
    unz,
    messageType: message?.family ?? null,
    messageReference: message?.messageReference ?? null,
    messageCode: message?.messageCode ?? null,
    documentReference: message?.documentReference ?? null,
    interchangeReference: ast.interchangeReference,
    senderComposite: canonicalElement(unb, 2),
    receiverComposite: canonicalElement(unb, 3),
    lineItems,
  }
}
