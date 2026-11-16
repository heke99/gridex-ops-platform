import {segmentComposite,segmentUntrimmedRaw,tokenizeEdifact,type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import {escapeEdifactValue} from '@/lib/ediel/core/edifactSerializer'
import type {EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {canonicalUtiltsTransactions} from './canonicalObservationScope'

/** Frozen U §3.7.4 pp66–68. Present own transaction values are copied unless
 * an earlier failure made them unavailable; neither sibling nor current-object
 * data can establish that exception. This port also supplies native guards. */
export const UTILTS_ERR_SOURCE_COPY_FIELDS=Object.freeze([
 {fieldNo:'209',tag:'LOC',qualifier:'172'},{fieldNo:'533',tag:'LOC',qualifier:'175'},
 {fieldNo:'260a',tag:'LOC',qualifier:'239'},{fieldNo:'260b',tag:'LOC',qualifier:'232'},{fieldNo:'260c',tag:'LOC',qualifier:'233'},
 {fieldNo:'262',tag:'NAD',qualifier:'DDK'},{fieldNo:'510',tag:'NAD',qualifier:'DDQ'},
 {fieldNo:'524',tag:'NAD',qualifier:'BY'},{fieldNo:'525',tag:'NAD',qualifier:'SE'},{fieldNo:'526',tag:'NAD',qualifier:'EZ'},
 {fieldNo:'511',tag:'PIA',qualifier:'1'},{fieldNo:'245',tag:'DTM',qualifier:'324'},{fieldNo:'223',tag:'STS',qualifier:'7'},
].map(field=>Object.freeze(field)))

export function utiltsDefaultAlphabetSegment(segment:EdifactTokenizedSegment,una:EdifactServiceStringAdvice):string {
 const observed={...segment,raw:segmentUntrimmedRaw(segment)}
 return [segment.tag,...segment.elements.slice(1).map((_,index)=>segmentComposite(observed,index+1,una).map(escapeEdifactValue).join(':'))].join('+')
}
function ownTransactions(raw:string) {
 const wire=tokenizeEdifact(raw),headers=wire.segments.filter(segment=>segment.tag==='UNH')
 if(headers.length!==1 || segmentComposite(headers[0],2,wire.una)[0]!=='UTILTS')throw new Error('utilts_err_source_message_scope_unavailable')
 return {...wire,transactions:canonicalUtiltsTransactions(wire.segments.slice(headers[0].index),wire.una,0)}
}
function header(segments:readonly EdifactTokenizedSegment[]) {
 const firstSequence=segments.findIndex(segment=>segment.tag==='SEQ')
 return firstSequence<0 ? segments : segments.slice(0,firstSequence)
}
function selectedSource(sourceRawPayload:string,transactionReference:string) {
 const wire=ownTransactions(sourceRawPayload),selected=wire.transactions.filter(transaction=>transaction.identityQualifier==='24'&&transaction.transactionId===transactionReference)
 if(selected.length!==1)throw new Error('utilts_err_source_transaction_reference_ambiguous')
 return {...wire,selected:selected[0]}
}
function matchesField(segment:EdifactTokenizedSegment,una:EdifactServiceStringAdvice,field:typeof UTILTS_ERR_SOURCE_COPY_FIELDS[number]) {
 return segment.tag===field.tag && segmentComposite(segment,1,una)[0]===field.qualifier
}
export function utiltsErrOriginalCopySegments(sourceRawPayload:string,transactionReference:string):string[] {
 const wire=selectedSource(sourceRawPayload,transactionReference)
 return header(wire.selected.segments).filter(segment=>UTILTS_ERR_SOURCE_COPY_FIELDS.some(field=>matchesField(segment,wire.una,field)))
  .map(segment=>utiltsDefaultAlphabetSegment(segment,wire.una))
}
/** Observational source-copy check only. It grants no functional outcome,
 * original pack/actor authority or SEND permission. Native facets supply those. */
export function utiltsErrSourceCopyViolations(sourceRawPayload:string,errRawPayload:string):string[] {
 try {
  const err=ownTransactions(errRawPayload),violations=new Set<string>()
  if(!err.transactions.length) return ['SOURCE_SCOPE']
  for(const transaction of err.transactions) {
   const actual=header(transaction.segments),references=actual.filter(segment=>segment.tag==='RFF'&&segmentComposite(segment,1,err.una)[0]==='TN')
   if(references.length!==1)return ['SOURCE_SCOPE']
   const reference=segmentComposite({...references[0],raw:segmentUntrimmedRaw(references[0])},1,err.una)[1]
   if(!reference)return ['SOURCE_SCOPE']
   const source=selectedSource(sourceRawPayload,reference),expected=header(source.selected.segments)
   for(const field of UTILTS_ERR_SOURCE_COPY_FIELDS) {
    const old=expected.filter(segment=>matchesField(segment,source.una,field)).map(segment=>utiltsDefaultAlphabetSegment(segment,source.una))
    const current=actual.filter(segment=>matchesField(segment,err.una,field)).map(segment=>utiltsDefaultAlphabetSegment(segment,err.una))
    if(JSON.stringify(old)!==JSON.stringify(current))violations.add(field.fieldNo)
   }
  }
  return [...violations]
 }catch{return ['SOURCE_SCOPE']}
}
