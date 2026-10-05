import { segmentComposite, segmentElementCount, tokenizeEdifact, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { PRODAT_26A_FIELD_MATRIX, canonicalProdat26AFieldRules } from './prodat26AFieldMatrix'
import { prodatRegisterGroups, prodatRegisterMessageSegments } from './prodatRegisterGroups'
import { prodatRegisterTokens, type ProdatRegisterSegment } from './prodatRegisterFields'
import type { EdielRulebookIssue } from '@/lib/ediel/rulebook/rulebook'

export type ProdatFreeTextField = '301' | '303'
export type ProdatFreeTextOccurrence = {
  raw: string
  segmentIndex: number
  field: ProdatFreeTextField | null
  /** Later-register common duplicates stay raw, never become semantic input. */
  semantic: boolean
  values: readonly string[]
  malformed: readonly string[]
}

/** The canonical matrix owns field identity and usage; this reader owns its
 * source-qualified FTX locator, not a second requirements table. */
export function prodatFreeTextField(fieldNumberOrKey: string): ProdatFreeTextField | null {
  const field = PRODAT_26A_FIELD_MATRIX.find(row => row.fieldNumber === fieldNumberOrKey || row.fieldKey === fieldNumberOrKey)
  return field?.fieldNumber === '301' || field?.fieldNumber === '303' ? field.fieldNumber : null
}

/** Select the first actual PRODAT before applying the existing message/register
 * owner. Other leading families and later messages are never FTX authority.
 * Header-free LIN fragments retain the existing scoped-reader behavior. */
function firstProdatFreeTextMessage(source: readonly ProdatRegisterSegment[], una: EdifactServiceStringAdvice): EdifactTokenizedSegment[] {
  const tokens = prodatRegisterTokens(source, una)
  const start = tokens.findIndex(token => token.tag === 'UNH' && segmentComposite(token, 2, una)[0] === 'PRODAT')
  return prodatRegisterMessageSegments(start < 0 ? tokens : tokens.slice(start), una)
}

/** P26.A r3 pp44/53: decode C108 once, after splitting released wire structure.
 * Raw segments are preserved independently; incoming business validation does
 * not promote these local construction findings to national APERAK errors. */
export function readProdatFreeText(source: readonly ProdatRegisterSegment[], una = parseUna(null), code?: string | null): ProdatFreeTextOccurrence[] {
  const tokens = firstProdatFreeTextMessage(source, una)
  const scope = new Map<EdifactTokenizedSegment, { field: ProdatFreeTextField; semantic: boolean }>()
  for (const token of tokens) {
    // FTX301 precedes SG4 NAD and SG8 LIN. A party's data is not header FTX.
    if (['NAD', 'LIN'].includes(token.tag)) break
    if (token.tag === 'FTX') scope.set(token, { field: '301', semantic: true })
  }
  for (const group of prodatRegisterGroups(tokens, una, code).groups) {
    for (const token of group.segments.slice(1)) {
      // SG8 FTX follows its dates, before measurements/characteristics/parties.
      if (!['DTM', 'FTX'].includes(token.tag)) break
      if (token.tag === 'FTX') scope.set(token, { field: '303', semantic: !group.validRegisterChain || group.registerPosition === 1 })
    }
  }
  return tokens.filter(token => token.tag === 'FTX').map(token => {
    const own = scope.get(token), qualifier = segmentComposite(token, 1, una)
    const expected = own?.field === '301' ? 'AAI' : own?.field === '303' ? 'ACB' : null
    const field = expected !== null && qualifier.length === 1 && qualifier[0] === expected ? own!.field : null
    const values = segmentComposite(token, 4, una), malformed: string[] = []
    if (!field) malformed.push('qualifier_or_scope')
    if (!values[0]?.trim()) malformed.push('first_literal_missing')
    if (values.length > 5) malformed.push('too_many_literals')
    if (values.some(value => [...value].length > 70)) malformed.push('literal_too_long')
    if ([2, 3, 5].some(index => segmentComposite(token, index, una).some(value => value !== '')) || segmentElementCount(token, una) > 5) malformed.push('unused_element_supplied')
    return { raw: token.raw, segmentIndex: token.index, field, semantic: Boolean(own?.semantic), values, malformed }
  })
}

/** Called inside the existing first-register scopes. Qualifiers, another
 * object/message, and malformed empty text cannot manufacture field presence. */
export function prodatFreeTextPresent(field: ProdatFreeTextField, source: readonly ProdatRegisterSegment[], options: { una?: EdifactServiceStringAdvice; code?: string | null; forbidden?: boolean } = {}): boolean {
  return readProdatFreeText(source, options.una, options.code).some(entry => entry.field === field && entry.semantic && (options.forbidden || entry.malformed.length === 0))
}

/** Outbound conformance only. Appendix4 p119 requires incoming extra X/gray
 * text to be ignored for business rejection; no ERC41/42 mapping is created. */
export function validateProdatFreeText(input: { code: string; rawSegments: readonly ProdatRegisterSegment[]; una?: EdifactServiceStringAdvice }): EdielRulebookIssue[] {
  const rules = canonicalProdat26AFieldRules(input.code)
  return readProdatFreeText(input.rawSegments, input.una, input.code).flatMap((entry): EdielRulebookIssue[] => {
    const forbidden = entry.field && rules.some(rule => rule.fieldNumber === entry.field && ['forbidden', 'not_used'].includes(rule.requirement))
    if (!forbidden && !entry.malformed.length) return []
    const reason = [...entry.malformed, ...(forbidden ? ['field_unused_for_function'] : [])].join(', ')
    return [{ severity: 'error', blocking: true, code: 'PRODAT_FTX_SEND_CONFORMANCE', title: 'Ogiltig utgående PRODAT-fritext',
      description: `FTX segment ${entry.segmentIndex}: ${reason}.`, fieldPath: entry.field === '301' ? 'FTX[AAI]/C108' : entry.field === '303' ? 'SG8/FTX[ACB]/C108' : 'FTX',
      prodatDiagnostic: { kind: 'internal', sourceRule: 'PRODAT26A:P44/53:local-outbound-conformance', reason } }]
  })
}

type WireInput = { raw_payload?: string | null; message_family?: string | null; message_code?: string | null }
/** Select actual wire family/code before stale row labels or format hints can
 * hide a PRODAT send. Unsupported/ambiguous messages retain their other gates. */
export function prodatFreeTextSendIssues(input: WireInput): EdielRulebookIssue[] {
  // Without UNA, only '+' introduces an EDIFACT data element. 'UNH;' is a
  // list column, not a header; its literal '?' must never reach this codec.
  // Keep UNA/custom alphabets and real malformed EDIFACT on the existing
  // tokenizer path, independently of row labels or alternate-format hints.
  if (!input.raw_payload || !/^(?:UNA(?:[^a-zA-Z0-9]|$)|(?:UNB|UNH|BGM|LIN|FTX)\+)/.test(input.raw_payload.trimStart())) return []
  const parsed = tokenizeEdifact(input.raw_payload)
  const tokens = firstProdatFreeTextMessage(parsed.segments, parsed.una)
  const header = tokens.find(token => token.tag === 'UNH')
  const family = header ? segmentComposite(header, 2, parsed.una)[0] : input.message_family
  if (family !== 'PRODAT') return []
  const code = segmentComposite(tokens.find(token => token.tag === 'BGM'), 1, parsed.una)[0] || input.message_code || ''
  return validateProdatFreeText({ code, rawSegments: tokens, una: parsed.una })
}

/** Pure pre-I/O hold, independent of intentional-invalid labels and metadata. */
export function assertProdatFreeTextSendBoundary(input: WireInput): void {
  const issues = prodatFreeTextSendIssues(input)
  if (issues.length) throw new Error(issues.map(issue => `${issue.code}: ${issue.description}`).join(' | '))
}
