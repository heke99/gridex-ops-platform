import { segmentComposite, segmentElementCount } from '@/lib/ediel/core/edifactTokenizer'
import { parseUna, type EdifactServiceStringAdvice } from '@/lib/ediel/core/una'
import { prodatRegisterMessageSegments } from '@/lib/ediel/prodat/prodatRegisterGroups'
import type { ProdatDependentConditionFacts } from '@/lib/ediel/prodat/prodatDependentConditionEngine'

export type ProdatRegisterEvidence = {
  version: 1
  code: string
  /** Decoded message body, without transport envelope. Integrity binding only,
   * NOT authorization or a signature. Facts require a server-owned row. */
  bodyBinding: string
  facts: Pick<ProdatDependentConditionFacts, 'market' | 'meterReadingsSentInUtilts' | 'registerObjects'>
}
const record = (value: unknown): Record<string,unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : null
const invalid = (): never => { throw new Error('prodat_register_evidence_invalid') }
const optionalBoolean = (value: unknown): boolean | null => value == null ? null : typeof value === 'boolean' ? value : invalid()

/** Only factual register inputs are copied; statuses or field presence cannot
 * prove that meter readings will be sent. */
export function copyProdatRegisterFacts(value: unknown): ProdatRegisterEvidence['facts'] {
  const source = record(value)
  if (!source) return invalid()
  const market = source.market
  if (market != null && market !== 'electricity' && market !== 'gas') return invalid()
  const facts: ProdatRegisterEvidence['facts'] = {market:market ?? null,meterReadingsSentInUtilts:optionalBoolean(source.meterReadingsSentInUtilts)}
  if (Object.hasOwn(source,'registerObjects') && source.registerObjects !== undefined) {
    if (!Array.isArray(source.registerObjects)) return invalid()
    const seen = new Set<string>()
    facts.registerObjects = source.registerObjects.map(value => {
      const row = record(value)
      if (!row || typeof row.meteringPointId !== 'string' || !row.meteringPointId.trim() || row.meteringPointId.length > 25 || typeof row.identityAgency !== 'string' || !['9','89'].includes(row.identityAgency)) return invalid()
      const key=JSON.stringify([row.meteringPointId,row.identityAgency])
      if (seen.has(key)) return invalid()
      seen.add(key)
      const count=row.expectedRegisterCount
      if (count != null && (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 999999)) return invalid()
      return {meteringPointId:row.meteringPointId,identityAgency:row.identityAgency as '9'|'89',
        ...(count === undefined ? {} : {expectedRegisterCount:count as number|null}),
        ...(row.meterReadingsSentInUtilts === undefined ? {} : {meterReadingsSentInUtilts:optionalBoolean(row.meterReadingsSentInUtilts)})}
    })
  }
  return facts
}
function bodyBinding(rawSegments: readonly string[], una: EdifactServiceStringAdvice): string {
  return JSON.stringify(prodatRegisterMessageSegments(rawSegments,una)
    .filter(segment=>!['UNB','UNH','UNT','UNZ'].includes(segment.tag))
    .map(segment=>[segment.tag,...Array.from({length:segmentElementCount(segment,una)},(_,i)=>segmentComposite(segment,i+1,una))]))
}
export function createProdatRegisterEvidence(input:{code:string;rawSegments:readonly string[];una?:EdifactServiceStringAdvice;facts?:ProdatDependentConditionFacts}):ProdatRegisterEvidence {
  return {version:1,code:input.code,bodyBinding:bodyBinding(input.rawSegments,input.una ?? parseUna(null)),facts:copyProdatRegisterFacts(input.facts ?? {})}
}
export function readProdatRegisterEvidence(input:{code:string;rawSegments:readonly string[];una?:EdifactServiceStringAdvice;parsedPayload?:unknown}):ProdatRegisterEvidence['facts']|undefined {
  const engine=record(record(input.parsedPayload)?.prodatEngine)
  if (!engine || !Object.hasOwn(engine,'registerEvidence')) return undefined
  const evidence=record(engine.registerEvidence)
  if (!evidence || evidence.version!==1 || evidence.code!==input.code || evidence.bodyBinding!==bodyBinding(input.rawSegments,input.una ?? parseUna(null))) return invalid()
  return copyProdatRegisterFacts(evidence.facts)
}

/** Snapshot overrides are authoritative, including an explicit clear. Keep the
 * existing non-register facts intact; validate/copy the register subset before
 * composing the one canonical policy. */
export function resolveProdatRegisterConditionFacts(contextFacts:ProdatDependentConditionFacts|null|undefined, snapshot?:Record<string,unknown>|null):ProdatDependentConditionFacts {
  const supplied=snapshot && Object.hasOwn(snapshot,'dependentConditionFacts') && snapshot.dependentConditionFacts!==undefined
  const value=supplied ? snapshot.dependentConditionFacts : contextFacts
  if (value == null) return {}
  const data=record(value)
  if (!data) return invalid()
  const checked=copyProdatRegisterFacts(data)
  return {...data,
    ...(Object.hasOwn(data,'market') ? {market:checked.market} : {}),
    ...(Object.hasOwn(data,'meterReadingsSentInUtilts') ? {meterReadingsSentInUtilts:checked.meterReadingsSentInUtilts} : {}),
    ...(Object.hasOwn(data,'registerObjects') ? {registerObjects:checked.registerObjects} : {}),
  } as ProdatDependentConditionFacts
}
