import { tokenizeEdifact, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUnb, type ParsedUnb } from '@/lib/ediel/core/unb'
import { parseUnh, type ParsedUnh } from '@/lib/ediel/core/unh'
import { parseUnt, type ParsedUnt } from '@/lib/ediel/core/unt'
import { parseUnz, type ParsedUnz } from '@/lib/ediel/core/unz'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

export type ParsedEdifactInterchange = {
  una: EdifactServiceStringAdvice
  segments: EdifactTokenizedSegment[]
  unb: ParsedUnb | null
  unh: ParsedUnh | null
  bgm: EdifactTokenizedSegment | null
  unt: ParsedUnt | null
  unz: ParsedUnz | null
  messageFamily: string | null
  businessCode: string | null
  rawPayload: string
}

function bgmCode(segment: EdifactTokenizedSegment | null): string | null {
  const composite = segment?.elements[1] ?? ''
  const first = composite.split(':')[0]?.trim() ?? ''
  return first || null
}

export function parseEdifact(rawPayload: string | null | undefined): ParsedEdifactInterchange {
  const raw = String(rawPayload ?? '')
  const tokenized = tokenizeEdifact(raw)
  const unbSegment = tokenized.segments.find((segment) => segment.tag === 'UNB')
  const unhSegment = tokenized.segments.find((segment) => segment.tag === 'UNH')
  const bgm = tokenized.segments.find((segment) => segment.tag === 'BGM') ?? null
  const untSegment = tokenized.segments.find((segment) => segment.tag === 'UNT')
  const unzSegment = tokenized.segments.find((segment) => segment.tag === 'UNZ')
  const unh = parseUnh(unhSegment, tokenized.una)

  return {
    una: tokenized.una,
    segments: tokenized.segments,
    unb: parseUnb(unbSegment, tokenized.una),
    unh,
    bgm,
    unt: parseUnt(untSegment),
    unz: parseUnz(unzSegment),
    messageFamily: unh?.messageType ?? null,
    businessCode: bgmCode(bgm),
    rawPayload: raw,
  }
}
