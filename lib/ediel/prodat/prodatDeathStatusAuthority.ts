import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna} from '@/lib/ediel/core/una'
import {validateProdatDeathStatus} from '@/lib/ediel/rulebook/prodatDeathStatusPolicy'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
type Row={message_code?:string|null;message_family?:string|null;raw_payload?:string|null;parsed_payload?:unknown}
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
/** Separate producer policy: eligible persisted sources are not qualified.
 * Never use this guard for inbound or pure protocol validation. */
export function deathStatusSendIssue(row:Row):EdielRulebookIssue|null{
 const raw=(row.raw_payload??'').trimStart(),advice=parseUna(raw),literal=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 const r=literal(advice.releaseCharacter),t=literal(advice.segmentTerminator),e=literal(advice.dataElementSeparator)
 const header=new RegExp(`(?:^|(?<!${r})(?:${r}${r})*${t})\\s*(?:UNB|UNH|BGM)${e}`,'i')
 const data=record(row.parsed_payload),policy=record(data.canonicalPolicy),code=String(row.message_code??'').toUpperCase()
 const reason=String(data.reasonForTransaction??data.transactionSubtype??policy.subtype??'').toUpperCase()
 const selected=code==='Z05'&&['LK','Z23','Z05LK'].includes(reason)||['Z06','Z09'].includes(code)&&['E','E34',`${code}E`].includes(reason)
 const hold=():EdielRulebookIssue=>({scope:'prodat_dependent',severity:'error',blocking:true,code:'PRODAT_DEATH_STATUS_SOURCE_UNQUALIFIED',title:'Kundstatus saknar kvalificerad utgående producent',description:'Den valda Z05LK/Z06E-bedömningen eller Z09E-producenten saknar kvalificerad beständig källa. Detta är en sändgräns, inte ett inkommande protokollfel.',fieldPath:'CCI++Z17/CAV'})
 if(selected)return hold()
 if(!raw.toUpperCase().startsWith('UNA')&&!header.test(raw))return null
 const wire=tokenizeEdifact(raw);let family=String(row.message_family??'PRODAT').toUpperCase(),ownCode=code,inCommon=false
 for(const token of wire.segments){
  if(token.tag==='UNH'){family=segmentComposite(token,2,wire.una)[0]??'';ownCode='';inCommon=false}
  if(token.tag==='BGM')ownCode=segmentComposite(token,1,wire.una)[0]??''
  if(token.tag==='LIN')inCommon=true
  if(['RFF','NAD','UNT','UNZ'].includes(token.tag))inCommon=false
  if(family==='PRODAT'&&inCommon&&token.tag==='CCI'&&segmentComposite(token,2,wire.una)[0]==='Z13'){
   const next=wire.segments[token.index+1],value=next?.tag==='CAV'?segmentComposite(next,1,wire.una)[0]:null
   if(ownCode==='Z05'&&value==='Z23'||['Z06','Z09'].includes(ownCode)&&value==='E34')return hold()
  }
 }
 // Invalid own scope and forbidden310 remain protected, without holding all F/G/D.
 return validateProdatDeathStatus({code,rawSegments:wire.segments.map(s=>s.raw),una:wire.una}).find(i=>i.blocking||i.severity==='error')??null
}
export function assertDeathStatusSendBoundary(row:Row){const issue=deathStatusSendIssue(row);if(issue)throw new Error(`${issue.code}: ${issue.description}`)}
