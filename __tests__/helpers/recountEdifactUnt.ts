import { tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'

/** Count-only repair after an intentional guide/function fixture mutation.
 * Never use for a fixture whose purpose is invalid physical syntax. */
export function recountEdifactUnt(raw: string): string {
  const { segments, una } = tokenizeEdifact(raw)
  const headers = segments.filter(segment => segment.tag === 'UNH')
  const trailers = segments.filter(segment => segment.tag === 'UNT')
  if (headers.length !== 1 || trailers.length !== 1 || trailers[0].index < headers[0].index) {
    throw new Error('fixture_unt_recount_requires_single_message')
  }
  const trailer = trailers[0]
  const separator = una.dataElementSeparator
  const countEnd = trailer.raw.indexOf(separator, 4)
  if (countEnd < 0 || !raw.includes(trailer.raw)) throw new Error('fixture_unt_recount_invalid_trailer')
  const count = trailer.index - headers[0].index + 1
  return raw.replace(trailer.raw, `UNT${separator}${count}${trailer.raw.slice(countEnd)}`)
}
