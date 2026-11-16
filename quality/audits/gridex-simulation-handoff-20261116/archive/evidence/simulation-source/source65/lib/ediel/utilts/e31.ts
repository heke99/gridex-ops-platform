import { parseUtilts, type ParsedUtilts } from '@/lib/ediel/utilts/parseUtilts'

export function parseE31(rawPayload: string): ParsedUtilts {
  const parsed = parseUtilts(rawPayload)
  if (parsed.messageCode !== 'E31') throw new Error('UTILTS payload är inte E31.')
  return parsed
}
