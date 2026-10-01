import {segmentComposite,tokenizeEdifact,type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import type {EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import type {UtiltsValidationIssue} from '@/lib/ediel/utiltsEngine.part-1'
import {canonicalUtiltsTransactions} from './canonicalObservationScope'
import {utiltsE30StandardEnergyUnit,utiltsPhysicalQuantityUnit} from './quantityUnitScope'

export type UtiltsDecimalGuideViolation={code:string;field:string;description:string;transactionId:string|null;missing:boolean;occurrence:{segmentIndex:number;elementIndex:number;componentIndex:number}}
function decimals(value:string,una:EdifactServiceStringAdvice):number|null {
  const mark=una.decimalMark
  if(!['.',','].includes(mark) || !new RegExp(`^-?[0-9]+(?:\\${mark}[0-9]+)?$`).test(value)) return null
  return value.includes(mark) ? value.length-value.indexOf(mark)-1 : 0
}

/** U p36 and SG8/MOA p92, SG10/PRI p93. These are own supplied fields,
 * never a required monetary branch or a functional energy precision decision. */
export function utiltsDecimalGuideViolations(segments:readonly EdifactTokenizedSegment[],una:EdifactServiceStringAdvice):UtiltsDecimalGuideViolation[] {
  const start=segments.findIndex(segment=>segment.tag==='UNH')
  const issues:UtiltsDecimalGuideViolation[]=[]
  if(start<0) return issues
  for(const transaction of canonicalUtiltsTransactions(segments.slice(start),una,0)) for(const observation of transaction.observations) {
    const report=(field:string,value:string|undefined,maximum:number|null,length:number,segmentIndex:number)=>{
      if(value==='NULL' && ['516','517'].includes(field)) return
      const count=value ? decimals(value,una) : null
      if(count!==null && value!.length<=length && (maximum===null || count<=maximum)) return
      issues.push({code:'UTILTS_DECIMAL_FIELD_INVALID',field,description:`Eget fält ${field} kräver ett ursprungligt decimaltal${maximum===null ? '' : ` med högst ${maximum} decimaler`} enligt U §3.6.4.`,transactionId:transaction.transactionId,missing:!value,occurrence:{segmentIndex,elementIndex:1,componentIndex:1}})
    }
    for(const quantity of observation.quantities) {
      const field=quantity.qualifier==='135' ? '515' : quantity.qualifier==='136' ? '516' : quantity.qualifier==='220' ? '517' : quantity.qualifier==='42' ? '521' : null
      if(field) report(field,quantity.value ?? undefined,null,35,quantity.segmentIndex)
    }
    for(const segment of observation.segments) {
      const parts=segmentComposite(segment,1,una)
      if(segment.tag==='MOA' && parts[0]==='9') report('522',parts[1],2,35,segment.index)
      if(segment.tag==='PRI' && parts[0]==='CAL') report('523',parts[1],6,15,segment.index)
    }
  }
  return issues
}

export function utiltsDecimalGuideIssues(raw:string):UtiltsValidationIssue[] {
  const wire=tokenizeEdifact(raw)
  return utiltsDecimalGuideViolations(wire.segments,wire.una).map(issue=>({severity:'error',kind:'application',code:issue.code,title:'Felaktigt numeriskt fält',description:issue.description,
    aperakErcCode:issue.missing ? '41' : '42',aperakFieldCode:issue.field,aperakText:issue.missing ? 'MANDATORY FIELD MISSING' : 'INCORRECT DATA',
    aperakInvalidOccurrence:issue.occurrence,
    referenceQualifier:issue.transactionId ? 'ACW' : null,referenceNumber:issue.transactionId,lineItemReference:issue.transactionId}))
}

/** Frozen CV-U-FN-DEC, authentic U §3.6.4 / appendix2 p132: decimal
 * precision is functional E51 only after this whole own IDE passed the guide.
 * No unqualified metadata asserts a bilateral exception or meter resolution. */
export function utiltsPrecisionFunctionalIssues(raw:string,eligible:ReadonlySet<string>):UtiltsValidationIssue[] {
  const wire=tokenizeEdifact(raw),start=wire.segments.findIndex(segment=>segment.tag==='UNH')
  const code=segmentComposite(wire.segments.find(segment=>segment.tag==='BGM'),1,wire.una)[0]
  const issues:UtiltsValidationIssue[]=[]
  if(start<0) return issues
  for(const transaction of canonicalUtiltsTransactions(wire.segments.slice(start),wire.una,0)) {
    if(!transaction.transactionId || !eligible.has(transaction.transactionId)) continue
    const header=transaction.segments.filter(segment=>segment.index<(transaction.observations[0]?.segmentIndex ?? Infinity))
    const resolutions=header.filter(segment=>segment.tag==='DTM' && segmentComposite(segment,1,wire.una)[0]==='354')
    const [,resolution,format]=resolutions.length===1 ? segmentComposite(resolutions[0],1,wire.una) : []
    const monthly=['801','802'].includes(format) && resolution==='1'
    const short=(format==='806' && resolution==='15') || (format==='805' && resolution==='1')
    const products=header.filter(segment=>segment.tag==='LIN').map(segment=>segmentComposite(segment,3,wire.una)[0])
    const report=(errorCode:'E51'|'E73',description:string)=>issues.push({severity:'error',kind:'functional',code:errorCode==='E51' ? 'UTILTS_QUANTITY_PRECISION_INVALID' : 'UTILTS_STANDARD_ENERGY_UNIT_REQUIRED',title:errorCode==='E51' ? 'Fel decimalprecision' : 'Fel energienhet',description,utiltsErrCode:errorCode,
      referenceQualifier:'TN',referenceNumber:transaction.transactionId,lineItemReference:transaction.transactionId})
    for(const observation of transaction.observations) for(const quantity of observation.quantities) {
      if(!quantity.value || quantity.value==='NULL') continue
      const unit=code==='E30' ? utiltsE30StandardEnergyUnit(transaction,quantity,wire.una) : utiltsPhysicalQuantityUnit(transaction,observation,quantity,wire.una)
      const energy=['135','136'].includes(quantity.qualifier ?? '')
      if(energy && products.length===1 && products[0]==='8716867000030' && unit && unit!=='KWH') {
        report('E73','Aktiv energi ska enligt U §3.6.4 skickas i kWh; annan enhet kräver ett autentiskt tillämpligt undantagsunderlag.');continue
      }
      const maximum=unit==='P1' ? 3 : quantity.qualifier==='220' && monthly ? 0 : energy && unit==='KWH' ? monthly ? 0 : short ? 3 : null : null
      const count=decimals(quantity.value,wire.una)
      if(maximum!==null && count!==null && count>maximum) report('E51',`Egen kvantitet ${quantity.qualifier} har ${count} decimaler; U §3.6.4 och bilaga2 tillåter högst ${maximum} för egen upplösning ${resolution}:${format}.`)
    }
  }
  return issues
}
