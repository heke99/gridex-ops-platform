import { parseUtiltsRuntimeFacts, normalizeUtiltsRuntimePayload, type UtiltsRuntimeFacts } from '@/lib/ediel/utiltsEngine'

export type UtiltsSubtype = 'E66-KVART' | 'E66-SCH' | 'E31-SCH' | 'S02' | 'S03' | 'UTILTS-ERR' | 'UNKNOWN'

export type ParsedUtilts = UtiltsRuntimeFacts & {
  utiltsSubtype: UtiltsSubtype
}

export function resolveUtiltsSubtype(facts: Pick<UtiltsRuntimeFacts, 'messageCode' | 'resolution' | 'isUtiltsErr' | 'applicationReference'>): UtiltsSubtype {
  const code = String(facts.messageCode ?? '').toUpperCase()
  const appRef = String(facts.applicationReference ?? '').toUpperCase()
  const resolution = String(facts.resolution ?? '').toUpperCase()

  if (facts.isUtiltsErr || code === 'ERR') return 'UTILTS-ERR'
  if (code === 'E66' && (appRef.includes('E66-T') || resolution === '15')) return 'E66-KVART'
  if (code === 'E66') return 'E66-SCH'
  if (code === 'E31') return 'E31-SCH'
  if (code === 'S02') return 'S02'
  if (code === 'S03') return 'S03'
  return 'UNKNOWN'
}

export function parseUtilts(rawPayload: string): ParsedUtilts {
  const facts = parseUtiltsRuntimeFacts(rawPayload)
  return {
    ...facts,
    utiltsSubtype: resolveUtiltsSubtype(facts),
  }
}

export function normalizeParsedUtiltsPayload(parsed: ParsedUtilts): Record<string, unknown> {
  return {
    ...normalizeUtiltsRuntimePayload(parsed),
    utiltsSubtype: parsed.utiltsSubtype,
  }
}
