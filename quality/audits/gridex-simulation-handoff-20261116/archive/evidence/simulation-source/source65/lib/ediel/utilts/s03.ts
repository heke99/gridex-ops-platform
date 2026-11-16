import { parseUtilts, type ParsedUtilts } from '@/lib/ediel/utilts/parseUtilts'

export function parseS03(rawPayload: string): ParsedUtilts {
  const parsed = parseUtilts(rawPayload)
  if (parsed.messageCode !== 'S03') throw new Error('UTILTS payload är inte S03.')
  return parsed
}
