import { parseUtilts, type ParsedUtilts } from '@/lib/ediel/utilts/parseUtilts'

export function parseS02(rawPayload: string): ParsedUtilts {
  const parsed = parseUtilts(rawPayload)
  if (parsed.messageCode !== 'S02') throw new Error('UTILTS payload är inte S02.')
  return parsed
}
