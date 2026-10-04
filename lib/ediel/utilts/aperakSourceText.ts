import {segmentComposite,segmentUntrimmedRaw,tokenizeEdifact,type EdifactTokenizedSegment} from '@/lib/ediel/core/edifactTokenizer'
import {getUtiltsFieldRules,UTILTS_25_A_3_FIELD_RULES} from '@/lib/ediel/rulebook/utiltsFieldMatrix'
import {canonicalUtiltsTransactions} from './canonicalObservationScope'
import type {UtiltsValidationIssue} from '@/lib/ediel/utiltsEngine.part-1'
import {CANONICAL_ACK_GUIDE_CONSTRAINTS} from '@/lib/ediel/rulebook/ackGuidePolicy'

export function isUtiltsAperakSourceText(code:string,text:string):boolean {
  const guide=CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS
  return typeof text==='string' && Array.from(text).length<=guide.textMax && !/[\x00-\x1f\x7f]/.test(text)
    && (code==='41' ? text===guide.missingText : code==='42' && new RegExp(guide.invalidTextPattern).test(text))
}

export function locateUtiltsSourceOccurrence(input:{raw:string;transactionReference:string;tag:string;qualifier:string;elementIndex:number;componentIndex:number}):UtiltsValidationIssue['aperakInvalidOccurrence'] {
  try {
    const wire=tokenizeEdifact(input.raw),start=wire.segments.findIndex(segment=>segment.tag==='UNH'),transactions=canonicalUtiltsTransactions(wire.segments.slice(start),wire.una,0)
    const own=transactions.filter((transaction,index)=>(transaction.transactionId ?? `transaction-${index+1}`)===input.transactionReference)
    if(own.length!==1) return null
    const tokens=own[0].segments.filter(segment=>segment.tag===input.tag && segmentComposite(segment,input.elementIndex,wire.una)[0]===input.qualifier)
    return tokens.length===1 ? {segmentIndex:tokens[0].index,elementIndex:input.elementIndex,componentIndex:input.componentIndex} : null
  } catch {return null}
}

// EDIFACT composite positions, independent of national field numbers/error
// codes. National locators remain the existing source-owned field matrix.
const composites:Record<string,{element:number;components:readonly string[]}>={
  'UNH/S009':{element:2,components:['0065','0052','0054','0051','0057']},
  'BGM/C002':{element:1,components:['1001','1131','3055','1000']},'BGM/C106':{element:2,components:['1004','1056','1060']},
  'MKS/C332':{element:2,components:['3496','1131','3055']},'NAD/C082':{element:2,components:['3039','1131','3055']},
  'IDE/C206':{element:2,components:['7402','7405','4405']},'LOC/C517':{element:2,components:['3225','1131','3055','3224']},
  'LIN/C212':{element:3,components:['7140','7143','1131','3055']},'PIA/C212':{element:2,components:['7140','7143','1131','3055']},
  'DTM/C507':{element:1,components:['2005','2380','2379']},'STS/C555':{element:2,components:['4405','1131','3055']},'STS/C556':{element:3,components:['9013','1131','3055']},
  'MEA/C174':{element:3,components:['6411','6314','6162','6152','6432']},'RFF/C506':{element:1,components:['1153','1154','1156','4000','1060']},
  'SEQ/C286':{element:2,components:['1050','1159','1131','3055']},'QTY/C186':{element:1,components:['6063','6060','6411']},
  'MOA/C516':{element:1,components:['5025','5004','6345','6343','4405']},'PRI/C509':{element:1,components:['5125','5118','5375','5387','5284','6411']},
  'CAV/C889':{element:1,components:['7111','1131','3055','7110']},
}
const scalars:Record<string,[number,number]>={'UNB/0026':[7,0],'UNH/0062':[1,0],'BGM/1225':[3,0],'BGM/4343':[4,0],'MKS/7293':[1,0],'NAD/3035':[1,0],'NAD/3039':[2,0],'CUX/6345':[1,1],'QTY/6063':[1,0],'DTM/2380':[1,1]}

/** The value is decoded from this exact original and own field occurrence.
 * Ambiguous repeated observations are held unless their real validator records
 * the physical occurrence. No description, parsed metadata or sibling supplies
 * missing failed content, and no bytes are sanitized/truncated for delivery. */
export function utiltsApplicationErrorText(input:{raw:string;issue:UtiltsValidationIssue}):string|null {
  const {issue}=input
  if(issue.aperakErcCode==='41') return issue.aperakText===CANONICAL_ACK_GUIDE_CONSTRAINTS.UTILTS.missingText ? issue.aperakText : null
  if(issue.aperakErcCode!=='42' || !issue.aperakFieldCode) return null
  try {
    const wire=tokenizeEdifact(input.raw),start=wire.segments.findIndex(segment=>segment.tag==='UNH'),end=wire.segments.findIndex(segment=>segment.tag==='IDE'),bgm=wire.segments.find(segment=>segment.tag==='BGM')
    if(start<0 || segmentComposite(wire.segments[start],2,wire.una)[0]!=='UTILTS') return null
    const code=segmentComposite(bgm,1,wire.una)[0],selected=getUtiltsFieldRules(code)
    const rules:Array<{segmentPath:string;scope:string}>=(selected.length ? selected : UTILTS_25_A_3_FIELD_RULES.filter(rule=>rule.scope==='header')).filter(rule=>rule.fieldNo===issue.aperakFieldCode)
    // The frozen guide allows the source EDIFACT element reference when no
    // national field number exists. It selects a physical locator, not a new
    // national error/field mapping.
    if(!rules.length && /^[A-Z]{3}\/(?:C\d{3}\/)?\d{4}$/.test(issue.aperakFieldCode)) rules.push({segmentPath:issue.aperakFieldCode,scope:issue.referenceNumber || issue.lineItemReference ? 'transaction' : 'header'})
    if(!rules.length) return null
    const header=wire.segments.slice(0,end<0 ? wire.segments.findIndex(segment=>segment.tag==='UNT') : end)
    const transactions=canonicalUtiltsTransactions(wire.segments.slice(start),wire.una,0),reference=issue.lineItemReference ?? issue.referenceNumber
    const own=reference ? transactions.filter((transaction,index)=>(transaction.transactionId ?? `transaction-${index+1}`)===reference) : []
    const scope=rules.every(rule=>rule.scope==='header') ? header : own.length===1 ? own[0].segments : []
    if(!scope.length) return null
    if(Object.hasOwn(issue,'aperakInvalidOccurrence') && issue.aperakInvalidOccurrence===null) return null
    const read=(segment:EdifactTokenizedSegment,element:number,component:number)=>segmentComposite({...segment,raw:segmentUntrimmedRaw(segment)},element,wire.una)[component]
    const locatorParts=rules.map(rule=>rule.segmentPath.split('/').filter(part=>!/^SG\d+$/.test(part)&&part!=='<role>'))
    let values:string[]=[]
    if(issue.aperakInvalidOccurrence) {
      const occurrence=issue.aperakInvalidOccurrence,segment=scope.find(token=>token.index===occurrence.segmentIndex)
      if(!segment || !locatorParts.some(parts=>parts.some(part=>{
        if(part.split('+')[0]!==segment.tag) return false
        const qualifier=part.includes('+++') ? part.split('+++')[1] : part.split('+')[1]
        const qualifierElement=part.includes('+++') ? 3 : 1
        return !qualifier || segmentComposite(segment,qualifierElement,wire.una)[0]===qualifier || (occurrence.elementIndex===qualifierElement&&occurrence.componentIndex===0)
      })) || !Number.isInteger(occurrence.elementIndex)||occurrence.elementIndex<1||!Number.isInteger(occurrence.componentIndex)||occurrence.componentIndex<0) return null
      const value=read(segment,occurrence.elementIndex,occurrence.componentIndex)
      if(value!==undefined) values=[value]
    } else for(const parts of locatorParts) {
      const candidates=scope.filter(segment=>{
        const target=parts.find(part=>part.split('+')[0]===segment.tag)
        if(!target) return false
        const qualifier=target.includes('+++') ? target.split('+++')[1] : target.split('+')[1]
        return !qualifier || segmentComposite(segment,target.includes('+++')?3:1,wire.una)[0]===qualifier
      })
      for(const segment of candidates) {
        const composite=parts.find(part=>composites[`${segment.tag}/${part}`]),location=composite ? composites[`${segment.tag}/${composite}`] : null
        const dataElement=parts.at(-1),position=location && dataElement ? location.components.indexOf(dataElement) : -1
        const scalar=dataElement ? scalars[`${segment.tag}/${dataElement}`] : null
        if(position>=0) {const value=read(segment,location!.element,position);if(value!==undefined) values.push(value)}
        else if(scalar) {const value=read(segment,...scalar);if(value!==undefined) values.push(value)}
      }
    }
    values=[...new Set(values)]
    if(values.length!==1 || !values[0] || /[\r\n\x00-\x1f\x7f]/.test(values[0])) return null
    const text=`INCORRECT DATA ${values[0]}`
    return isUtiltsAperakSourceText('42',text) ? text : null
  } catch {return null}
}
