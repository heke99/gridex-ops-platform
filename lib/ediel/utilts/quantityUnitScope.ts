import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import type {CanonicalUtiltsObservation,CanonicalUtiltsQuantity,CanonicalUtiltsTransaction} from './canonicalObservationScope'
import {canonicalUtiltsTransactions} from './canonicalObservationScope'
import type {UtiltsValidationIssue} from '@/lib/ediel/utiltsEngine.part-1'
import {getUtiltsFieldRequirement} from '@/lib/ediel/rulebook/utiltsFieldMatrix'

/** U p36 standard energy units; p85 excludes SG5/MEA in E30. Never infer
 * reading/power units, unsupported resolutions or a bilateral exception. */
export function utiltsE30StandardEnergyUnit(transaction:CanonicalUtiltsTransaction,quantity:CanonicalUtiltsQuantity,una:EdifactServiceStringAdvice):'KWH' | null {
  const stop=transaction.observations[0]?.segmentIndex ?? Number.POSITIVE_INFINITY
  const header=transaction.segments.filter(segment=>segment.index<stop)
  if(quantity.qualifier!=='136' || quantity.components[2] || header.some(segment=>segment.tag==='MEA')) return null
  const resolutions=header.filter(segment=>segment.tag==='DTM' && segmentComposite(segment,1,una)[0]==='354')
  if(resolutions.length!==1) return null
  const [,value,format]=segmentComposite(resolutions[0],1,una)
  return (value==='15' && format==='806') || (value==='1' && ['801','802'].includes(format)) ? 'KWH' : null
}

export function utiltsMissingQuantityHasOwnQuality(observation:CanonicalUtiltsObservation,quantity:CanonicalUtiltsQuantity,una:EdifactServiceStringAdvice):boolean {
  const next=observation.quantities.find(candidate=>candidate.segmentIndex>quantity.segmentIndex)?.segmentIndex ?? Number.POSITIVE_INFINITY
  return observation.segments.some(segment=>segment.index>quantity.segmentIndex && segment.index<next && segment.tag==='STS'
    && segmentComposite(segment,1,una)[0]==='8' && segmentComposite(segment,2,una)[0]==='46')
}

/** U field264: SG5/MEA+AAZ applies to the entire own IDE, before SG8/SEQ.
 * A supplied local unit may not quietly override it or borrow a sibling unit. */
export function utiltsPhysicalQuantityUnit(transaction:CanonicalUtiltsTransaction,observation:CanonicalUtiltsObservation | null,quantity:CanonicalUtiltsQuantity,una:EdifactServiceStringAdvice):string | null {
  const stop=transaction.observations[0]?.segmentIndex ?? Number.POSITIVE_INFINITY
  const header=transaction.segments.filter(segment=>segment.tag==='MEA' && segment.index<stop)
  if(header.length!==1 || segmentComposite(header[0],1,una)[0]!=='AAZ') return null
  const unit=segmentComposite(header[0],3,una)[0]
  if(!unit || unit!==unit.trim()) return null
  // U p95 marks QTY/C186/6411 N, even if its supplied unit matches SG5.
  if(quantity.components[2]) return null
  const local=observation?.segments.filter(segment=>segment.tag==='MEA') ?? []
  if(local.some(segment=>segmentComposite(segment,1,una)[0]!=='AAZ' || segmentComposite(segment,3,una)[0]!==unit)) return null
  return unit
}

export function utiltsQuantityUnitGuideIssues(raw:string):UtiltsValidationIssue[] {
  const wire=tokenizeEdifact(raw),start=wire.segments.findIndex(segment=>segment.tag==='UNH')
  if(start<0) return []
  const bgm=wire.segments.find(segment=>segment.tag==='BGM')
  const code=segmentComposite(bgm,1,wire.una)[0]
  const unitRequirement=getUtiltsFieldRequirement(code,'264','unit')
  const issues:UtiltsValidationIssue[]=[]
  for(const transaction of canonicalUtiltsTransactions(wire.segments.slice(start),wire.una,0)) {
    const stop=transaction.observations[0]?.segmentIndex ?? Number.POSITIVE_INFINITY
    const hasHeader=transaction.segments.some(segment=>segment.tag==='MEA' && segment.index<stop)
    const required=unitRequirement==='R' || (unitRequirement==='D' && transaction.observations.some(observation=>observation.quantities.length>0))
    const report=(issueCode:string,field:string,description:string,missing=false)=>issues.push({severity:'error',kind:'application',code:issueCode,title:'Felaktig kvantitetsscope',description,
      aperakErcCode:missing ? '41' : '42',aperakFieldCode:field,aperakText:missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',referenceQualifier:transaction.transactionId ? 'ACW' : null,referenceNumber:transaction.transactionId,lineItemReference:transaction.transactionId})
    for(const observation of transaction.observations) for(const quantity of observation.quantities) {
      if(quantity.components[2]) report('UTILTS_QUANTITY_UNIT_NOT_USED','QTY/C186/6411','QTY/C186/6411 används inte enligt U s95; enheten får inte välja eller ändra transaktionens mått.')
      if(quantity.value==='NULL' && (quantity.qualifier==='136' || (quantity.qualifier==='220' && code==='E30')) && !utiltsMissingQuantityHasOwnQuality(observation,quantity,wire.una)) {
        report('UTILTS_MISSING_QUANTITY_QUALITY_REQUIRED','520','Saknad energi eller E30-mätarställning med NULL kräver egen efterföljande STS+8+46 enligt U s95.',true)
      }
    }
    if(code==='E30' && hasHeader) {report('UTILTS_E30_UNIT_NOT_USED','264','SG5/MEA används inte i E30 enligt U s85.');continue}
    const invalid=transaction.observations.some(observation=>observation.quantities.some(quantity=>utiltsPhysicalQuantityUnit(transaction,observation,quantity,wire.una)===null))
    if(!required && !hasHeader) continue
    if(!hasHeader || invalid) issues.push({severity:'error',kind:'application',code:hasHeader ? 'UTILTS_QUANTITY_UNIT_SCOPE_INVALID' : 'UTILTS_TRANSACTION_UNIT_SCOPE_MISSING',
      title:'Felaktig enhetsscope',description:'Enheten i fält264 ska komma från egen SG5/MEA före SEQ och gälla hela transaktionen.',
      aperakErcCode:hasHeader ? '42' : '41',aperakFieldCode:'264',aperakText:hasHeader ? 'INCORRECT DATA' : 'MANDATORY FIELD MISSING',
      referenceQualifier:transaction.transactionId ? 'ACW' : null,referenceNumber:transaction.transactionId,lineItemReference:transaction.transactionId})
  }
  return issues
}
