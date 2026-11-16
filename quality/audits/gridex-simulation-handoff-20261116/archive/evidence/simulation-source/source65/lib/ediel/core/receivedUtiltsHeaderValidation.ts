import {segmentComposite,tokenizeEdifact} from './edifactTokenizer'
import {evidenceHash,isEvidenceRecord} from '@/lib/ediel/utilts/durableSourceDiscovery'
import type {UtiltsRuntimeAckPlan} from '@/lib/ediel/utiltsEngine.part-1'
import {isUtiltsAperakSourceText} from '@/lib/ediel/utilts/aperakSourceText'

export type ReceivedUtiltsHeaderValidation=Readonly<{version:1;sourcePayloadHash:string;applicationErrors:readonly Readonly<{
  ercCode:string;fieldCode:string;text:string
}>[]}>

/** Project only the real runtime's physical-header owner marker. An unscoped
 * national error or a caller's message-level ACK flag never supplies it. */
export function buildReceivedUtiltsHeaderValidation(input:{source:{raw_payload:string|null;message_family:string};headerRejection:UtiltsRuntimeAckPlan['utiltsHeaderRejection']}):ReceivedUtiltsHeaderValidation|null {
  if(input.source.message_family!=='UTILTS' || !input.source.raw_payload || !input.headerRejection?.applicationErrors.length
    || input.headerRejection.applicationErrors.some(error=>error.referenceQualifier!=null || error.referenceNumber!=null || error.lineItemReference!=null)) return null
  return bindReceivedUtiltsHeaderValidation({version:1,sourcePayloadHash:evidenceHash(input.source.raw_payload),applicationErrors:input.headerRejection.applicationErrors.map(error=>({
    ercCode:error.ercCode,fieldCode:error.fieldCode,text:error.text,
  }))},input.source.raw_payload)
}

/** Shape and original-byte binding only: no error table, guide selection or
 * rule execution. Text is the exact logical value serialized by the renderer. */
export function bindReceivedUtiltsHeaderValidation(value:unknown,raw:string):ReceivedUtiltsHeaderValidation|null {
  if(!isEvidenceRecord(value) || Object.keys(value).length!==3 || value.version!==1 || value.sourcePayloadHash!==evidenceHash(raw)
    || !Array.isArray(value.applicationErrors) || value.applicationErrors.length===0 || value.applicationErrors.length>128) return null
  try {
    const wire=tokenizeEdifact(raw),headers=wire.segments.filter(segment=>segment.tag==='UNH')
    if(headers.length!==1 || segmentComposite(headers[0],2,wire.una)[0]!=='UTILTS') return null
  } catch {return null}
  for(const error of value.applicationErrors) {
    if(!isEvidenceRecord(error) || Object.keys(error).length!==3 || !['41','42'].includes(String(error.ercCode))
      || typeof error.ercCode!=='string' || typeof error.fieldCode!=='string' || !/^[A-Za-z0-9_./-]{1,17}$/.test(error.fieldCode)
      || typeof error.text!=='string' || !isUtiltsAperakSourceText(error.ercCode,error.text)) return null
  }
  return structuredClone(value) as ReceivedUtiltsHeaderValidation
}
