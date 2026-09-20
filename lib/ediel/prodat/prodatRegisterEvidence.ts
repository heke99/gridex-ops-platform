import {copyGasReportingIdentitySelection} from './prodatGasReportingIdentity'
import {copyGasSerialChangeSelection} from './prodatGasApplicability'
import {copyDeathSelection} from './prodatDeathStatus'
import {copyMeterChangeSelection} from './prodatMeterChangeFacts'
import {assertReportingAuthority} from './prodatReportingPermissionAuthority'
import type {ExpectedContext,PureSelection,TgtEvidence} from './prodatReportingPermissionContext'
import {copyReportingSelection} from './prodatReportingPermissionContext'
import {assertProdatDateEventAuthority,type ProdatDateEventRow,type TgtDateEventValidationContext} from './prodatDateEventAuthority'
import {copyProdatDateEventObjects,copyProdatDateEventSource} from './prodatDateEvents'
import {copyProdatInvoiceeObjects,assertInvoiceeOwnership} from './prodatInvoicee'
import {copyProdatEndUserAddressObjects,assertProdatAddressOwnership} from './prodatEndUserAddress'
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
  facts: Pick<ProdatDependentConditionFacts, 'market' | 'meterReadingsSentInUtilts' | 'registerObjects' | 'endUserAddressObjects' | 'invoiceeObjects' | 'dateEventObjects' | 'dateEventSource' | 'meterChange' | 'deathStatus' | 'gasSerialChange' | 'gasReportingIdentity'> & {reportingPermission?:TgtEvidence|Omit<PureSelection,'evaluationUtcMs'>|null}
}
const record = (value: unknown): Record<string,unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : null
const invalid = (): never => { throw new Error('prodat_register_evidence_invalid') }
const optionalBoolean = (value: unknown): boolean | null => value == null ? null : typeof value === 'boolean' ? value : invalid()

/** Only factual register inputs are copied; statuses or field presence cannot
 * prove that meter readings will be sent. */
export function copyProdatRegisterFacts(value: unknown): ProdatDependentConditionFacts {
  const source = record(value)
  if (!source) return invalid()
  const market = source.market
  if (market != null && market !== 'electricity' && market !== 'gas') return invalid()
  const facts: ProdatDependentConditionFacts = {market:market ?? null,meterReadingsSentInUtilts:optionalBoolean(source.meterReadingsSentInUtilts)}
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
  if(Object.hasOwn(source,'endUserAddressObjects') && source.endUserAddressObjects!==undefined) facts.endUserAddressObjects=copyProdatEndUserAddressObjects(source.endUserAddressObjects)
  if(Object.hasOwn(source,'invoiceeObjects') && source.invoiceeObjects!==undefined) facts.invoiceeObjects=copyProdatInvoiceeObjects(source.invoiceeObjects)
  if(source.dateEventObjects!==undefined)facts.dateEventObjects=copyProdatDateEventObjects(source.dateEventObjects)
  if(source.dateEventSource!==undefined)facts.dateEventSource=copyProdatDateEventSource(source.dateEventSource)
  if(Object.hasOwn(source,'reportingPermission') && source.reportingPermission!==undefined) facts.reportingPermission=source.reportingPermission===null?null:copyReportingSelection(source.reportingPermission)
  if(Object.hasOwn(source,'deathStatus') && source.deathStatus!==undefined) facts.deathStatus=source.deathStatus===null?null:copyDeathSelection(source.deathStatus)
  if(Object.hasOwn(source,'meterChange') && source.meterChange!==undefined) facts.meterChange=source.meterChange===null?null:copyMeterChangeSelection(source.meterChange)
  if(Object.hasOwn(source,'gasSerialChange'))facts.gasSerialChange=source.gasSerialChange==null?null:copyGasSerialChangeSelection(source.gasSerialChange)
  if(Object.hasOwn(source,'gasReportingIdentity'))facts.gasReportingIdentity=source.gasReportingIdentity==null?null:copyGasReportingIdentitySelection(source.gasReportingIdentity)
  return facts
}
function bodyBinding(rawSegments: readonly string[], una: EdifactServiceStringAdvice): string {
  return JSON.stringify(prodatRegisterMessageSegments(rawSegments,una)
    .filter(segment=>!['UNB','UNH','UNT','UNZ'].includes(segment.tag))
    .map(segment=>[segment.tag,...Array.from({length:segmentElementCount(segment,una)},(_,i)=>segmentComposite(segment,i+1,una))]))
}
export function createProdatRegisterEvidence(input:{code:string;rawSegments:readonly string[];una?:EdifactServiceStringAdvice;facts?:ProdatDependentConditionFacts}):ProdatRegisterEvidence {
  const copied=copyProdatRegisterFacts(input.facts ?? {}), selection=copied.reportingPermission
  const facts:ProdatRegisterEvidence['facts']={...copied,...(selection?.source.kind==='caller_selection'?{reportingPermission:{source:selection.source,objects:selection.objects}}:{})}
  return {version:1,code:input.code,bodyBinding:bodyBinding(input.rawSegments,input.una ?? parseUna(null)),facts}
}
export function readProdatRegisterEvidence(input:{code:string;rawSegments:readonly string[];una?:EdifactServiceStringAdvice;parsedPayload?:unknown;companyId?:string|null;runId?:string|null;stepNo?:number|null;dateEventRow?:ProdatDateEventRow;dateEventContext?:TgtDateEventValidationContext;reportingContext?:ExpectedContext}):ProdatDependentConditionFacts|undefined {
  const engine=record(record(input.parsedPayload)?.prodatEngine)
  if (!engine || !Object.hasOwn(engine,'registerEvidence')) return undefined
  const evidence=record(engine.registerEvidence)
  if (!evidence || evidence.version!==1 || evidence.code!==input.code || evidence.bodyBinding!==bodyBinding(input.rawSegments,input.una ?? parseUna(null))) return invalid()
  if(record(evidence.facts)?.gasReportingIdentity != null) return invalid() // No persisted reporting identity adapter is qualified.
  if(record(evidence.facts)?.gasSerialChange != null) return invalid() // No persisted GAS event producer is qualified.
  if(record(evidence.facts)?.deathStatus != null) return invalid() // No persisted death assessment producer is qualified.
  if(record(evidence.facts)?.meterChange != null) return invalid() // No persisted Z10 producer is qualified.
  if(record(record(record(evidence.facts)?.reportingPermission)?.source)?.kind==='caller_selection')return invalid()
  const facts=copyProdatRegisterFacts(evidence.facts)
  assertProdatAddressOwnership(facts.endUserAddressObjects,input)
  assertInvoiceeOwnership(facts.invoiceeObjects,input)
  if(facts.reportingPermission && facts.reportingPermission.source.kind==='caller_selection') return invalid()
  assertReportingAuthority({...input,facts,row:input.dateEventRow,expected:input.reportingContext})
  assertProdatDateEventAuthority({...input,facts,row:input.dateEventRow,expected:input.dateEventContext})
  return facts
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
    ...(Object.hasOwn(data,'gasReportingIdentity') ? {gasReportingIdentity:checked.gasReportingIdentity} : {}),
    ...(Object.hasOwn(data,'gasSerialChange') ? {gasSerialChange:checked.gasSerialChange} : {}),
    ...(Object.hasOwn(data,'deathStatus') ? {deathStatus:checked.deathStatus} : {}),
    ...(Object.hasOwn(data,'meterChange') ? {meterChange:checked.meterChange} : {}),
    ...(Object.hasOwn(data,'reportingPermission') ? {reportingPermission:checked.reportingPermission} : {}),
    ...(Object.hasOwn(data,'dateEventObjects') ? {dateEventObjects:checked.dateEventObjects} : {}),
    ...(Object.hasOwn(data,'dateEventSource') ? {dateEventSource:checked.dateEventSource} : {}),
    ...(Object.hasOwn(data,'market') ? {market:checked.market} : {}),
    ...(Object.hasOwn(data,'meterReadingsSentInUtilts') ? {meterReadingsSentInUtilts:checked.meterReadingsSentInUtilts} : {}),
    ...(Object.hasOwn(data,'registerObjects') ? {registerObjects:checked.registerObjects} : {}),
    ...(Object.hasOwn(data,'invoiceeObjects') ? {invoiceeObjects:checked.invoiceeObjects} : {}),
    ...(Object.hasOwn(data,'endUserAddressObjects') ? {endUserAddressObjects:checked.endUserAddressObjects} : {}),
  } as ProdatDependentConditionFacts
}
