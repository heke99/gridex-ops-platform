import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import type {CanonicalUtiltsObservation,CanonicalUtiltsQuantity,CanonicalUtiltsTransaction} from './canonicalObservationScope'
import {canonicalUtiltsTransactions} from './canonicalObservationScope'
import type {UtiltsValidationIssue} from '@/lib/ediel/utiltsEngine.part-1'

/** U field264: SG5/MEA+AAZ applies to the entire own IDE, before SG8/SEQ.
 * A supplied local unit may not quietly override it or borrow a sibling unit. */
export function utiltsPhysicalQuantityUnit(transaction:CanonicalUtiltsTransaction,observation:CanonicalUtiltsObservation | null,quantity:CanonicalUtiltsQuantity,una:EdifactServiceStringAdvice):string | null {
  const stop=transaction.observations[0]?.segmentIndex ?? Number.POSITIVE_INFINITY
  const header=transaction.segments.filter(segment=>segment.tag==='MEA' && segment.index<stop)
  if(header.length!==1 || segmentComposite(header[0],1,una)[0]!=='AAZ') return null
  const unit=segmentComposite(header[0],3,una)[0]
  if(!unit || unit!==unit.trim()) return null
  if(quantity.components[2] && quantity.components[2]!==unit) return null
  const local=observation?.segments.filter(segment=>segment.tag==='MEA') ?? []
  if(local.some(segment=>segmentComposite(segment,1,una)[0]!=='AAZ' || segmentComposite(segment,3,una)[0]!==unit)) return null
  return unit
}

export function utiltsQuantityUnitGuideIssues(raw:string):UtiltsValidationIssue[] {
  const wire=tokenizeEdifact(raw),start=wire.segments.findIndex(segment=>segment.tag==='UNH')
  if(start<0) return []
  const bgm=wire.segments.find(segment=>segment.tag==='BGM')
  const code=segmentComposite(bgm,1,wire.una)[0]
  const required=['E31','E66','S07','S02','S03','S04'].includes(code)
  const issues:UtiltsValidationIssue[]=[]
  for(const transaction of canonicalUtiltsTransactions(wire.segments.slice(start),wire.una,0)) {
    const stop=transaction.observations[0]?.segmentIndex ?? Number.POSITIVE_INFINITY
    const hasHeader=transaction.segments.some(segment=>segment.tag==='MEA' && segment.index<stop)
    const invalid=transaction.observations.some(observation=>observation.quantities.some(quantity=>utiltsPhysicalQuantityUnit(transaction,observation,quantity,wire.una)===null))
    if(!required && !hasHeader) continue
    if(!hasHeader || invalid) issues.push({severity:'error',kind:'application',code:hasHeader ? 'UTILTS_QUANTITY_UNIT_SCOPE_INVALID' : 'UTILTS_TRANSACTION_UNIT_SCOPE_MISSING',
      title:'Felaktig enhetsscope',description:'Enheten i fält264 ska komma från egen SG5/MEA före SEQ och gälla hela transaktionen.',
      aperakErcCode:hasHeader ? '42' : '41',aperakFieldCode:'264',aperakText:hasHeader ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
      referenceQualifier:transaction.transactionId ? 'ACW' : null,referenceNumber:transaction.transactionId,lineItemReference:transaction.transactionId})
  }
  return issues
}
