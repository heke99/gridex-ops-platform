import { prodatDateComparisonValue } from '@/lib/ediel/prodat/prodatDateFields'

/** Interpret only explicit portal cell notation, never arbitrary removed text.
 * A period's format qualifier is part of the expected value, not decoration. */
export function prodatDateExpectation(field: string, value: string | null | undefined): string | null {
  if (value == null) return null
  let literal = value.trim()
  if (field === '508') {
    const annotated = literal.match(/^(\d+)\s*\(2379=(801|802|804|806)\)$/)
    if (annotated) literal = `${annotated[1]}:${annotated[2]}`
  } else if (field === '249') {
    literal = literal.replace(/ \(optional\)$/i, '')
  }
  return prodatDateComparisonValue(field, literal)
}
