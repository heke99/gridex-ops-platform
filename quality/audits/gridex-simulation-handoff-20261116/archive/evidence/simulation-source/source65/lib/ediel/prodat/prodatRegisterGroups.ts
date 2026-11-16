import { segmentComposite, type EdifactTokenizedSegment } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna } from '@/lib/ediel/core/una'
import { prodatRegisterFieldState, prodatRegisterLocalSegments, prodatRegisterTokens, type ProdatRegisterSegment } from '@/lib/ediel/prodat/prodatRegisterFields'
import { prodatRegisterFieldScope } from '@/lib/ediel/prodat/prodat26AFieldMatrix'

export type ProdatRegisterProblem = { fieldNumber: string; lineIndex: number; segmentIndex: number; reason: string }
export type ProdatRegisterGroup = {
  messageIndex: number
  lineIndex: number
  lineNumber: string | null
  itemId: string | null
  identityAgency: string | null
  registerIndex: string | null
  registerCount: number
  registerPosition: number
  firstLineIndex: number | null
  validRegisterChain: boolean
  segments: EdifactTokenizedSegment[]
  /** Semantic projection only, never serialize it; every token retains wire index. */
  effectiveSegments: EdifactTokenizedSegment[]
}

/** Sole register grouping path. Input may be a whole interchange or one LIN.
 * Grouping is message-bound and tuple-keyed by exact decoded identity + agency.
 * Multiple physical meters must have distinct object IDs (P annex2 p114).
 */
export function prodatRegisterGroups(source: readonly ProdatRegisterSegment[], una = parseUna(null), fallbackCode?: string | null) {
  const tokens = prodatRegisterTokens(source, una)
  const groups: ProdatRegisterGroup[] = []
  const problems: ProdatRegisterProblem[] = []
  let messageIndex = -1
  let ordinal = 0
  let code = fallbackCode ?? ''
  let group: ProdatRegisterGroup | null = null
  const codes = new Map<number, string>()
  for (const token of tokens) {
    if (token.tag === 'UNH') { messageIndex++; ordinal = 0; group = null; code = fallbackCode ?? '' }
    if (token.tag === 'BGM') { code = segmentComposite(token, 1, una)[0]; codes.set(messageIndex, code) }
    if (['UNT','UNZ'].includes(token.tag)) { group = null; continue }
    if (token.tag === 'LIN') {
      const c212 = segmentComposite(token, 3, una)
      const sequence = prodatRegisterFieldState('314', [token], una)!
      const register = prodatRegisterFieldState('258', [token], una)!
      group = { messageIndex, lineIndex: groups.length, lineNumber: sequence.value, itemId: c212[0] || null, identityAgency: c212[3] || null,
        registerIndex: register.value, registerCount: 1, registerPosition: 1, firstLineIndex: null, validRegisterChain: true, segments: [], effectiveSegments: [] }
      groups.push(group)
      ordinal++
      if (!sequence.present || sequence.malformed || Number(sequence.value) !== ordinal) problems.push({fieldNumber:'314',lineIndex:group.lineIndex,segmentIndex:token.index,reason:'global_sequence_must_increment_from_one'})
      if (register.malformed) problems.push({fieldNumber:'258',lineIndex:group.lineIndex,segmentIndex:token.index,reason:'invalid_C829_indicator_or_index'})
      codes.set(messageIndex, code)
    }
    if (group) group.segments.push(token)
  }
  const objects = new Map<string, ProdatRegisterGroup[]>()
  for (const group of groups) {
    // Empty identities are never usable inheritance authority.
    const key = JSON.stringify([group.messageIndex,group.itemId,group.identityAgency,group.itemId ? null : group.lineIndex])
    const list = objects.get(key) ?? []
    list.push(group); objects.set(key,list)
  }
  for (const siblings of objects.values()) {
    const first = siblings[0]
    const multi = siblings.length > 1
    const supported = ['Z04','Z06','Z10'].includes(codes.get(first.messageIndex) ?? fallbackCode ?? '')
    for (const [index, current] of siblings.entries()) {
      current.registerCount = siblings.length
      current.registerPosition = index + 1
      const state = prodatRegisterFieldState('258',current.segments,una)!
      if ((state.present && (!multi || !supported)) || (multi && (!supported || !state.present || Number(state.value) !== index + 1))) {
        problems.push({fieldNumber:'258',lineIndex:current.lineIndex,segmentIndex:current.segments[0].index,reason:multi ? 'per_object_register_sequence_invalid' : 'single_register_must_omit_C829'})
      }
      const identity = prodatRegisterFieldState('209',current.segments,una)!
      // Identity may legitimately be absent in Z13/Z14N; only register chains
      // need it here. Its ordinary usage matrix enforces other object contexts.
      if ((multi || state.present) && (!identity.present || identity.malformed)) {
        problems.push({fieldNumber:'209',lineIndex:current.lineIndex,segmentIndex:current.segments[0].index,reason:'register_requires_explicit_object_identity'})
      }
    }
    const invalid = siblings.some(row => problems.some(problem => problem.lineIndex === row.lineIndex))
    const firstLocal = prodatRegisterLocalSegments(first.segments,una)
    const firstNonLocal = first.segments.filter(token => !firstLocal.has(token))
    for (const current of siblings) {
      current.validRegisterChain = !invalid
      current.firstLineIndex = invalid ? null : first.lineIndex
      if (multi && current !== first && !invalid) {
        const own = prodatRegisterLocalSegments(current.segments,una)
        // Keep own LIN/measurement pairs first and first-register common fields
        // in their original relative order, including line RFF before NAD.
        current.effectiveSegments = [...current.segments.filter(token => own.has(token)),...firstNonLocal]
      } else current.effectiveSegments = current.segments.slice()
    }
  }
  return { groups, problems, tokens }
}

/** Field/policy entry points validate one message; another UNH is not an
 * additional register. Canonical AST calls the grouping function per message. */
export function prodatRegisterMessageSegments(source: readonly ProdatRegisterSegment[], una = parseUna(null)): EdifactTokenizedSegment[] {
  const tokens = prodatRegisterTokens(source,una)
  const start = tokens.findIndex(token => token.tag === 'UNH')
  if (start >= 0 && segmentComposite(tokens[start],2,una)[0] !== 'PRODAT') return []
  const selected = tokens.slice(Math.max(0,start))
  const end = selected.findIndex((token,index) => ['UNT','UNZ'].includes(token.tag) || (index > 0 && token.tag === 'UNH'))
  return end < 0 ? selected : selected.slice(0,end)
}

/** Pick actual wire scopes; first-register-only fields are not revalidated in
 * later repeats. Invalid chains have no inheritance/omission privileges. */
export function prodatRegisterRuleScopes(fieldNumberOrKey: string, source: readonly ProdatRegisterSegment[], una = parseUna(null), code?: string | null): EdifactTokenizedSegment[][] | null {
  const scope = prodatRegisterFieldScope(fieldNumberOrKey)
  if (scope === null || scope === 'header') return null
  const result = prodatRegisterGroups(prodatRegisterMessageSegments(source,una),una,code)
  if (!result.groups.length) return [result.tokens.some(t => ['UNH','BGM','UNB'].includes(t.tag)) ? [] : result.tokens]
  return result.groups.filter(group => scope === 'local' || !group.validRegisterChain || group.registerPosition === 1).map(group => group.segments)
}

/** Business-fact projection: only register 1 supplies common SG8 facts. Keep
 * raw tokens separately for syntax, evidence and retransmission. */
export function prodatSemanticMessageSegments(source: readonly ProdatRegisterSegment[], una = parseUna(null)): EdifactTokenizedSegment[] {
  const tokens = prodatRegisterMessageSegments(source,una)
  const {groups} = prodatRegisterGroups(tokens,una)
  if (!groups.length) return tokens
  const firstLine = tokens.findIndex(token => token.tag === 'LIN')
  return [...tokens.slice(0,firstLine), ...groups.flatMap(group => {
    if (!group.validRegisterChain || group.registerPosition === 1) return group.segments
    const local = prodatRegisterLocalSegments(group.segments,una)
    return group.segments.filter(token => local.has(token))
  })]
}
