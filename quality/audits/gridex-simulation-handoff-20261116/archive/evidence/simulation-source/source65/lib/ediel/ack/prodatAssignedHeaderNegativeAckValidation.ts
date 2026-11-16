import {commonHeaderOriginalSource,commonHeaderRejectionField,commonHeaderReplyApplicationReference,prodatCommonHeaderRejectionQualification,
 type ProdatCommonHeaderRejectionEvidence} from './prodatCommonHeaderRejectionAuthority'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import {stockholmBusinessDate} from '@/lib/ediel/core/executionContext'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import type {RulebookValidationInput,RulebookValidationResult} from '@/lib/ediel/rulebook/validator'

/** Extension for independently source-owned negative311/223 only. The legacy
 * field202 validator keeps its existing guide and scope checks unchanged. */
export function qualifyAssignedProdatHeaderNegativeAck(input:RulebookValidationInput,result:RulebookValidationResult,
 supplied:ProdatCommonHeaderRejectionEvidence|null):RulebookValidationResult|null{
 const field=supplied?commonHeaderRejectionField(supplied):null
 if(!field||field.fieldCode==='202')return null
 const unavailable=()=>({...result,ok:false,blocking:true,rulePackSnapshot:null,issues:[...result.issues,{
  severity:'error' as const,blocking:true,code:'CANONICAL_COMMON_HEADER_NEGATIVE_SCOPE_INVALID',title:'Negativ nationell originalomfattning avviker',
  description:'Negativ311/223 kräver sitt privata faktiska original, frysta P-anvisning och exakta fysiska fel.'}]})
 const evidence=supplied?prodatCommonHeaderRejectionQualification({evidence:supplied,companyId:input.companyId??'',environment:supplied.environment}):null
 if(!evidence||input.environment!==evidence.environment||input.direction!=='outbound'||input.mode!=='send'||result.family!=='APERAK'
  ||!input.rawPayload||!result.parsed||field.ercCode!=='41')return unavailable()
 const source=commonHeaderOriginalSource(evidence)
 if(!source?.raw_payload||source.company_id!==evidence.companyId)return unavailable()
 const template=resolveCanonicalEdielPolicy({family:'APERAK',messageCode:'APERAK',direction:'outbound',
  referenceDate:stockholmBusinessDate(new Date(evidence.sourceReceivedAt)),associationAssignedCode:evidence.guide.associationAssignedCode,
  applicationReference:commonHeaderReplyApplicationReference(evidence),mode:'parse'})
 const expectedGuide={...template.guide,family:'PRODAT'}
 if(JSON.stringify(Object.keys(expectedGuide).sort())!==JSON.stringify(Object.keys(evidence.guide).sort())
  ||Object.entries(expectedGuide).some(([key,value])=>JSON.stringify(value)!==JSON.stringify(evidence.guide[key as keyof typeof evidence.guide])))return unavailable()
 const policy=Object.freeze({...template,guide:evidence.guide}),wire=tokenizeEdifact(input.rawPayload)
 const all=(tag:string)=>wire.segments.filter(row=>row.tag===tag),errors=all('ERC'),texts=all('FTX'),bgms=all('BGM')
 const same=(a:readonly string[],b:readonly string[])=>JSON.stringify(a)===JSON.stringify(b)
 let exact=errors.length===1&&texts.length===1&&bgms.length===1&&segmentComposite(bgms[0],3,wire.una)[0]===(field.fieldCode==='223'?'34':'27')
  &&same(segmentComposite(errors[0],1,wire.una),['41','','260'])&&same(segmentComposite(texts[0],3,wire.una),[field.fieldCode,'','260'])
  &&same(segmentComposite(texts[0],4,wire.una),[field.text])
 if(field.fieldCode==='223'){
  const original=tokenizeEdifact(source.raw_payload),groups=prodatRegisterGroups(original.segments,original.una,'Z04').groups
  const own=groups.length===1?groups[0]:null,refs=(tokens:typeof original.segments,una:typeof original.una,qualifier:string)=>
   tokens.filter(row=>row.tag==='RFF'&&segmentComposite(row,1,una)[0]===qualifier).map(row=>segmentComposite(row,1,una))
  const actualLi=own?refs(own.segments,original.una,'LI'):[],li=refs(wire.segments,wire.una,'LI'),z07=refs(wire.segments,wire.una,'Z07')
  exact=Boolean(exact&&own?.validRegisterChain&&own.registerPosition===1&&own.itemId&&actualLi.length===1&&actualLi[0].length===2
   &&actualLi[0][1]&&li.length===1&&z07.length===1&&same(li[0],actualLi[0])&&same(z07[0],['Z07',own.itemId]))
 }
 if(!exact)return unavailable()
 const syntax=validateEdifactEnvelope(input.rawPayload).issues.map(entry=>({severity:entry.severity,blocking:entry.severity==='error',
  code:entry.code,title:'EDIFACT-kuvert',description:entry.message}))
 const guide=validateCanonicalAckGuide({policy,rawPayload:input.rawPayload,rawSegments:result.parsed.rawSegments,una:result.parsed.una,
  sourceRawPayload:source.raw_payload,commonHeaderOriginal:evidence})
 const issues=[...result.issues,...syntax,...guide],blocking=issues.some(entry=>entry.blocking||entry.severity==='error')
 return {...result,ok:!blocking,blocking,issues,canonicalPolicy:policy,fieldRuleSource:'common_header_source',rulePackSnapshot:null,
  prodatCommonHeaderRejectionEvidence:evidence}
}
