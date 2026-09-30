import { segmentComposite, tokenizeEdifact, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import type { EdifactServiceStringAdvice } from '@/lib/ediel/core/una'

export type EdifactEnvelopeIssueCode =
  | 'missing_unb' | 'missing_unh' | 'missing_unt' | 'missing_unz'
  | 'unt_count_mismatch' | 'unt_unh_reference_mismatch' | 'unz_unb_reference_mismatch'
  | 'unz_count_mismatch' | 'envelope_reference_missing' | 'envelope_order_invalid'
  | 'duplicate_envelope_segment' | 'duplicate_message_reference'
  | 'syntax_tokenization_failed' | 'multi_message_interchange'

export type EdifactValidationIssue = {
  severity: 'error' | 'warning'
  /** Also used by callers for their separate family/profile diagnostics. */
  code: string
  message: string
}

export type EdifactValidationResult = {
  ok: boolean
  syntaxOk: boolean
  issues: EdifactValidationIssue[]
  declaredUntCount: number | null
  actualMessageSegmentCount: number | null
}

function scalar(segment: EdifactTokenizedSegment | undefined, index: number, una: EdifactServiceStringAdvice): string | null {
  const parts = segmentComposite(segment, index, una)
  return parts.length === 1 && parts[0] ? parts[0] : null
}

function positiveCount(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const count = Number(value)
  return Number.isSafeInteger(count) && count > 0 ? count : null
}

/** Shared service-envelope syntax authority. Application-directory grammar and
 * national/profile checks remain separate: do not infer their M/R/cardinality
 * from this bounded UNA/UNB/UNH/UNT/UNZ check. All physical messages are checked. */
export function validateEdifactEnvelope(rawPayload: string | null | undefined): EdifactValidationResult {
  const issues: EdifactValidationIssue[] = []
  const fail = (code: EdifactEnvelopeIssueCode, message: string) => issues.push({ severity: 'error', code, message })
  let tokenized: ReturnType<typeof tokenizeEdifact>
  try {
    tokenized = tokenizeEdifact(rawPayload)
  } catch {
    return { ok: false, syntaxOk: false, issues: [{ severity: 'error', code: 'syntax_tokenization_failed',
      message: 'EDIFACT kan inte tokeniseras med angivna separatorer och frisläppningstecken.' }],
      declaredUntCount: null, actualMessageSegmentCount: null }
  }
  const { segments, una } = tokenized
  const unbs = segments.filter(segment => segment.tag === 'UNB')
  const unhs = segments.filter(segment => segment.tag === 'UNH')
  const unts = segments.filter(segment => segment.tag === 'UNT')
  const unzs = segments.filter(segment => segment.tag === 'UNZ')
  if (!unbs.length) fail('missing_unb', 'UNB saknas.')
  if (!unhs.length) fail('missing_unh', 'UNH saknas.')
  if (!unts.length) fail('missing_unt', 'UNT saknas.')
  if (!unzs.length) fail('missing_unz', 'UNZ saknas.')
  if (unbs.length > 1 || unzs.length > 1) fail('duplicate_envelope_segment', 'Interchange måste ha exakt en UNB och en UNZ.')
  if ((unbs.length && segments[0]?.tag !== 'UNB') || (unzs.length && segments.at(-1)?.tag !== 'UNZ')) {
    fail('envelope_order_invalid', 'UNB ska inleda och UNZ ska avsluta interchange.')
  }

  const unbReference = scalar(unbs[0], 5, una)
  const unzReference = scalar(unzs[0], 2, una)
  if (unbs.length && !unbReference) fail('envelope_reference_missing', 'UNB/0020 interchange-referens saknas eller är ogiltig.')
  if (unzs.length && !unzReference) fail('envelope_reference_missing', 'UNZ/0020 interchange-referens saknas eller är ogiltig.')
  if (unbReference && unzReference && unbReference !== unzReference) {
    fail('unz_unb_reference_mismatch', 'UNZ referens matchar inte UNB referensen.')
  }
  const declaredMessages = positiveCount(scalar(unzs[0], 1, una))
  if (unzs.length && (declaredMessages === null || declaredMessages !== unhs.length)) {
    fail('unz_count_mismatch', 'UNZ/0036 ska vara ett positivt heltal och motsvara faktiskt antal UNH–UNT-meddelanden.')
  }

  let openMessage: EdifactTokenizedSegment | undefined
  let declaredUntCount: number | null = null
  let actualMessageSegmentCount: number | null = null
  const references = new Set<string>()
  for (const segment of segments) {
    if (segment.tag === 'UNB') {
      if (segment.index !== 0 || openMessage) fail('envelope_order_invalid', 'UNB får inte förekomma inne i ett meddelande.')
      continue
    }
    if (segment.tag === 'UNH') {
      if (openMessage) fail('envelope_order_invalid', 'UNH förekommer före föregående UNT.')
      const reference = scalar(segment, 1, una)
      if (!reference) fail('envelope_reference_missing', 'UNH/0062 meddelandereferens saknas eller är ogiltig.')
      if (reference && references.has(reference)) fail('duplicate_message_reference', 'UNH/0062 ska vara unik inom interchange.')
      if (reference) references.add(reference)
      openMessage = segment
      continue
    }
    if (segment.tag === 'UNT') {
      if (!openMessage) {
        fail('envelope_order_invalid', 'UNT förekommer utan föregående UNH.')
        continue
      }
      const count = positiveCount(scalar(segment, 1, una))
      const actual = segment.index - openMessage.index + 1
      if (openMessage === unhs[0]) { declaredUntCount = count; actualMessageSegmentCount = actual }
      if (count === null || count !== actual) fail('unt_count_mismatch', 'UNT/0074 ska vara ett positivt heltal och inkludera alla segment från UNH till UNT.')
      const reference = scalar(segment, 2, una)
      if (!reference) fail('envelope_reference_missing', 'UNT/0062 meddelandereferens saknas eller är ogiltig.')
      const originalReference = scalar(openMessage, 1, una)
      if (reference && originalReference && reference !== originalReference) fail('unt_unh_reference_mismatch', 'UNT referens matchar inte UNH referensen.')
      openMessage = undefined
      continue
    }
    if (segment.tag === 'UNZ') {
      if (openMessage) fail('envelope_order_invalid', 'UNZ förekommer före meddelandets UNT.')
      continue
    }
    if (!openMessage) fail('envelope_order_invalid', 'Affärssegment förekommer utanför UNH–UNT.')
  }
  if (openMessage) fail('missing_unt', 'Ett meddelande saknar motsvarande UNT.')
  if (unhs.length > 1) issues.push({ severity: 'warning', code: 'multi_message_interchange',
    message: 'Interchange innehåller fler än ett meddelande; separat nationell profil- och konsumentkontroll krävs.' })
  const syntaxOk = !issues.some(issue => issue.severity === 'error')
  return { ok: syntaxOk, syntaxOk, issues, declaredUntCount, actualMessageSegmentCount }
}
