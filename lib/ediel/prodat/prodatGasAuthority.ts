import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {parseUna} from '@/lib/ediel/core/una'
import {gasWireMessages} from './prodatGasApplicability'
import type {EdielRulebookIssue} from '@/lib/ediel/rulebook/rulebook'
import {validateProdatGasApplicability} from '@/lib/ediel/rulebook/prodatGasApplicabilityPolicy'
type Row={message_code?:string|null;message_family?:string|null;direction?:string|null;raw_payload?:string|null;application_reference?:string|null;parsed_payload?:unknown;routeApplicationReference?:string|null}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
const selected=(code:string|null|undefined)=>['Z04','Z06','Z10'].includes(code??'')
/** Capability hold only for selected outbound PRODAT functions. No source facts,
 * row profile or test bypass can activate a persisted GAS producer. */
export function gasApplicabilitySendIssue(row:Row):EdielRulebookIssue|null{
  if(row.direction==='inbound')return null
  const claimed=String(row.message_family??'').toUpperCase()==='PRODAT'&&selected(String(row.message_code??'').toUpperCase())
  const raw=row.raw_payload??''
  let wire:ReturnType<typeof tokenizeEdifact>,syntaxInvalid=false
  try{wire=tokenizeEdifact(raw)}catch{
    // A dangling release must not conceal an actual selected header. Complete
    // the release pair for classification only; syntaxInvalid always holds it.
    syntaxInvalid=true
    try{wire=tokenizeEdifact(raw+parseUna(raw).releaseCharacter)}catch{return claimed?hold():null}
  }
  const messages=gasWireMessages(wire.segments,wire.una)
  const actual=messages.filter(m=>m.family==='PRODAT'&&m.segments.some(t=>t.tag==='BGM'&&selected(segmentComposite(t,1,wire.una)[0])))
  if(!claimed&&!actual.length)return null
  if(syntaxInvalid||actual.length!==1||messages.length!==1)return hold()
  if(row.message_family&&row.message_family.toUpperCase()!=='PRODAT'||row.message_code&&actual.some(m=>m.code!==row.message_code!.toUpperCase()))return hold()
  const data=record(row.parsed_payload),routing=record(data.routing),policy=record(data.canonicalPolicy)
  const references=[row.application_reference,row.routeApplicationReference,data.applicationReference,data.application_reference,routing.applicationReference,policy.applicationReference]
  if(actual.some(m=>m.market!=='electricity'||references.some(ref=>ref!=null&&ref!==''&&ref!==m.reference)))return hold()
  // A claimed selected code cannot be hidden behind a different own BGM/family.
  if(claimed&&(messages.length!==1||actual[0].code!==String(row.message_code).toUpperCase()))return hold()
  // Invalid/nonunique UNH/BGM never gains authority from a row label.
  if(wire.segments.filter(t=>t.tag==='UNB').length!==1||actual.some(m=>m.segments.filter(t=>t.tag==='BGM').length!==1||segmentComposite(m.segments.find(t=>t.tag==='UNH'),2,wire.una)[0]!=='PRODAT'))return hold()
  return null
}
function hold():EdielRulebookIssue{return {scope:'prodat_dependent',severity:'error',blocking:true,code:'PRODAT_GAS_SOURCE_UNQUALIFIED',title:'PRODAT saknar kvalificerad marknadskälla',description:'Vald Z04/Z06/Z10 kräver en sammanhängande EL-envelope och källa. GAS eller okänd/motstridig marknad saknar kvalificerad beständig sändbehörighet; detta är ingen inkommande protokollregel.',fieldPath:'UNB/0026;UNH/0057'}}
export function assertGasApplicabilitySendBoundary(row:Row):void{const issue=gasApplicabilitySendIssue(row);if(issue)throw new Error(`${issue.code}: ${issue.description}`)}
/** Coherent EL authority still requires selected field exclusion at final SMTP.
 * Malformed/unknown/GAS wire remains the separate capability hold above. */
export function gasApplicabilitySendFieldIssues(row:Row):EdielRulebookIssue[]{
  if(row.direction==='inbound')return []
  let wire:ReturnType<typeof tokenizeEdifact>
  try{wire=tokenizeEdifact(row.raw_payload??'')}catch{return []}
  if(!gasWireMessages(wire.segments,wire.una).some(m=>m.family==='PRODAT'&&selected(m.code)&&m.market==='electricity'))return []
  return validateProdatGasApplicability({code:'',rawSegments:wire.segments.map(t=>t.raw),una:wire.una,direction:'outbound'})
    .filter(i=>i.code==='PRODAT_GAS_320_FORBIDDEN'||i.code==='PRODAT_GAS_240_FORBIDDEN')
}
