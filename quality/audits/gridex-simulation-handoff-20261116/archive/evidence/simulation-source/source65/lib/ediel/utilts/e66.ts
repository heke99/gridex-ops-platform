import { parseUtilts, type ParsedUtilts } from '@/lib/ediel/utilts/parseUtilts'
import { parseMeteringObservations } from '@/lib/ediel/utilts/meteringObservationParser'

export function parseE66(rawPayload: string): ParsedUtilts {
  const parsed = parseUtilts(rawPayload)
  if (parsed.messageCode !== 'E66') throw new Error('UTILTS payload är inte E66.')
  return parsed
}

export function parseE66Observations(rawPayload: string) {
  return parseMeteringObservations(parseE66(rawPayload))
}
