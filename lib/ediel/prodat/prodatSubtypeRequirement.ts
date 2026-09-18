import { findProdatSubtypeRule, type ProdatSubtype } from '@/lib/ediel/rulebook/prodatSubtypeRegistry'

export type ProdatSubtypeRequirement = 'required' | 'optional' | 'forbidden' | 'undetermined'
type DeterminedRequirement = Exclude<ProdatSubtypeRequirement, 'undetermined'>

type SourceRule = Readonly<{
  messageCode: 'Z04' | 'Z06' | 'Z09'
  fieldNumber: string
  page: 17 | 18 | 19 | 20 | 21
  market?: 'electricity'
  outcomes: Readonly<Partial<Record<ProdatSubtype, DeterminedRequirement>>>
}>

/** Bounded source migration: eight of the original 110 numeric D cells.
 * P26.A revision 3, §2.2. No field presence or operator byCell flag supplies a
 * subtype-only condition. Other cells retain their existing unresolved gates.
 */
export const PRODAT_SOURCE_SUBTYPE_REQUIREMENTS: readonly SourceRule[] = [
  { messageCode: 'Z04', fieldNumber: '319', page: 21, outcomes: { D: 'required', L: 'forbidden', LK: 'forbidden', C: 'forbidden', H: 'forbidden', A: 'forbidden' } },
  { messageCode: 'Z06', fieldNumber: '242', page: 20, market: 'electricity', outcomes: { F: 'required', G: 'required', E: 'optional' } },
  { messageCode: 'Z06', fieldNumber: '508', page: 18, outcomes: { F: 'required', E: 'optional', G: 'optional' } },
  { messageCode: 'Z06', fieldNumber: '217', page: 18, outcomes: { F: 'required', E: 'optional', G: 'optional' } },
  { messageCode: 'Z06', fieldNumber: '306', page: 19, outcomes: { F: 'required', G: 'required', E: 'optional' } },
  { messageCode: 'Z06', fieldNumber: '254', page: 20, outcomes: { F: 'required', G: 'required', E: 'optional' } },
  { messageCode: 'Z09', fieldNumber: '216', page: 17, outcomes: { B: 'required', E: 'required', F: 'required', G: 'required', D: 'forbidden' } },
  { messageCode: 'Z09', fieldNumber: '217', page: 19, outcomes: { F: 'required', G: 'required', B: 'forbidden', D: 'forbidden', E: 'forbidden' } },
]

// Runtime immutability matters as well as TypeScript readonly: callers receive
// these very source records, never a mutable protocol-authority escape hatch.
for (const rule of PRODAT_SOURCE_SUBTYPE_REQUIREMENTS) {
  Object.freeze(rule.outcomes)
  Object.freeze(rule)
}
Object.freeze(PRODAT_SOURCE_SUBTYPE_REQUIREMENTS)

export function prodatSourceSubtypeRule(messageCode: string, fieldNumber: string): SourceRule | null {
  return PRODAT_SOURCE_SUBTYPE_REQUIREMENTS.find(rule => rule.messageCode === messageCode && rule.fieldNumber === fieldNumber) ?? null
}

/** Facts use canonical subtype tokens; raw field223 must be decoded and
 * checked against the existing transaction-reason registry by the wire caller.
 * Unknown, coercible objects, and subtypes belonging to another code stay unknown.
 */
export function resolveProdatSourceSubtypeRequirement(input: {
  messageCode: string; fieldNumber: string; subtype: unknown; market?: unknown
}): ProdatSubtypeRequirement | null {
  const rule = prodatSourceSubtypeRule(input.messageCode, input.fieldNumber)
  if (!rule) return null
  // P26.A p20 limits Z06 product requirements to EL. Gas is not an
  // optional branch of this rule, and operator flags cannot activate it.
  if (rule.market && input.market !== rule.market) return 'undetermined'
  if (typeof input.subtype !== 'string') return 'undetermined'
  const subtype = input.subtype.trim().toUpperCase()
  const known = findProdatSubtypeRule(subtype, input.messageCode)
  if (!known || known.subtype !== subtype || !known.allowedMessageCodes.some(code => code === input.messageCode)) return 'undetermined'
  return rule.outcomes[known.subtype] ?? 'undetermined'
}
