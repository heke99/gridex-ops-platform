import {segmentComposite,type EdifactTokenizedSegment as Token} from '@/lib/ediel/core/edifactTokenizer'
import type {EdifactServiceStringAdvice} from '@/lib/ediel/core/una'
import {prodatRegisterReadingMarket} from './prodatRegisterReadings'

/** P26.A pp21/65/77/110: causal condition only, never a series value producer. */
export type GasSerialEventEvidence = {key:string;revision:string;reference:string;eventKey:string;eventRevision:string}
export type GasSerialChangeObject = {
  objectKey:string
  installation:{id:string;agency:'9'|'89'}
  lineItemReference:string
  process:{code:'Z06';reason:'E64'|'E32'}|{code:'Z10';reason:'E58'}
  event:{key:string;revision:string;reference:string}
  assessment:{kind:'unknown'}|{kind:'known';dimension:'serial_id_changed_due_to_this_event';changed:boolean;evidence:GasSerialEventEvidence}
}
export type GasSerialChangeSelection = {source:{kind:'caller_selection';reference:string};objects:readonly GasSerialChangeObject[]}
export type GasRequirement = 'required'|'optional'|'forbidden'|'undetermined'
export type GasMarket = 'electricity'|'gas'|null
const invalid=():never=>{throw new Error('prodat_register_evidence_gas_serial_change_invalid')}
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return invalid()
  const row=value as Record<string,unknown>
  if(Reflect.ownKeys(row).some(k=>typeof k!=='string'||!keys.includes(k))||keys.some(k=>!Object.hasOwn(row,k)||row[k]===undefined))return invalid()
  return row
}
function exact(value:unknown):string{
  if(typeof value!=='string'||!value.length||value!==value.trim())return invalid()
  return value
}
function copyObject(value:unknown):GasSerialChangeObject{
  const row=record(value,['objectKey','installation','lineItemReference','process','event','assessment'])
  const installation=record(row.installation,['id','agency']),process=record(row.process,['code','reason']),event=record(row.event,['key','revision','reference'])
  if(installation.agency!=='9'&&installation.agency!=='89')return invalid()
  let ownProcess:GasSerialChangeObject['process']
  if(process.code==='Z06'&&(process.reason==='E64'||process.reason==='E32'))ownProcess={code:'Z06',reason:process.reason}
  else if(process.code==='Z10'&&process.reason==='E58')ownProcess={code:'Z10',reason:'E58'}
  else return invalid()
  const ownEvent={key:exact(event.key),revision:exact(event.revision),reference:exact(event.reference)}
  let assessment:GasSerialChangeObject['assessment']
  if((row.assessment as {kind?:unknown}|null)?.kind==='unknown'){
    record(row.assessment,['kind']);assessment={kind:'unknown'}
  }else{
    const a=record(row.assessment,['kind','dimension','changed','evidence']),e=record(a.evidence,['key','revision','reference','eventKey','eventRevision'])
    if(a.kind!=='known'||a.dimension!=='serial_id_changed_due_to_this_event'||typeof a.changed!=='boolean')return invalid()
    const evidence={key:exact(e.key),revision:exact(e.revision),reference:exact(e.reference),eventKey:exact(e.eventKey),eventRevision:exact(e.eventRevision)}
    if(evidence.eventKey!==ownEvent.key||evidence.eventRevision!==ownEvent.revision)return invalid()
    assessment={kind:'known',dimension:'serial_id_changed_due_to_this_event',changed:a.changed,evidence}
  }
  return {objectKey:exact(row.objectKey),installation:{id:exact(installation.id),agency:installation.agency},lineItemReference:exact(row.lineItemReference),process:ownProcess,event:ownEvent,assessment}
}
export function copyGasSerialChangeSelection(value:unknown):GasSerialChangeSelection{
  const row=record(value,['source','objects']),source=record(row.source,['kind','reference'])
  if(source.kind!=='caller_selection'||!Array.isArray(row.objects)||!row.objects.length)return invalid()
  const objects=row.objects.map(copyObject),identities=new Set<string>(),keys=new Set<string>()
  for(const object of objects){
    const identity=JSON.stringify([object.installation.id,object.installation.agency])
    if(identities.has(identity)||keys.has(object.objectKey))return invalid()
    identities.add(identity);keys.add(object.objectKey)
  }
  return {source:{kind:'caller_selection',reference:exact(source.reference)},objects}
}
export const isGasApplicabilityField=(code:string,field:string):boolean=>field==='320'?['Z04','Z06'].includes(code):field==='240'&&['Z04','Z06','Z10'].includes(code)
/** Pure explicit source context. Wire consumers must resolve their own market/subtype. */
export function gasRequirement(code:string,field:string,market:GasMarket|undefined,subtype?:string|null,changed?:boolean):GasRequirement{
  if(!isGasApplicabilityField(code,field)||!market)return 'undetermined'
  if(market==='electricity')return 'forbidden'
  if(code==='Z04')return 'required'
  if(code==='Z06'&&!['E','F','G'].includes(subtype??'')||code==='Z10'&&subtype!=='M')return 'undetermined'
  if(field==='320')return subtype==='E'?'forbidden':'required'
  if(subtype==='E')return 'optional' // Specific p21 note; bounded reconciliation of general p109.
  return changed===true?'required':changed===false?'optional':'undetermined'
}
export function gasAggregate(code:string,field:string,market:GasMarket|undefined,subtype?:string|null,selection?:GasSerialChangeSelection|null):GasRequirement{
  const checked=selection==null?null:copyGasSerialChangeSelection(selection)
  const initial=gasRequirement(code,field,market,subtype)
  if(initial!=='undetermined'||!market||!checked)return initial
  const reason=code==='Z10'?'E58':subtype==='F'?'E64':subtype==='G'?'E32':null
  const values=checked.objects.map(object=>object.process.code===code&&object.process.reason===reason?gasRequirement(code,field,market,subtype,object.assessment.kind==='known'?object.assessment.changed:undefined):'undetermined')
  return values.includes('undetermined')?'undetermined':values.includes('required')?'required':'optional'
}
export const gasStatus=(requirement:GasRequirement)=>requirement==='undetermined'?'undetermined' as const:requirement==='required'?'required' as const:'not_required' as const

/** Own UNH messages retain their envelope separately; another UNH cannot supply
 * a reason or event. A complete wire never uses the renderer-fragment fallback. */
export function gasWireMessages(tokens:readonly Token[],una:EdifactServiceStringAdvice,applicationReference?:string|null){
  const unbs=tokens.filter(t=>t.tag==='UNB'),hasEnvelope=tokens.some(t=>['UNB','UNH','UNT','UNZ'].includes(t.tag))
  const messages:Token[][]=[];let current:Token[]=[]
  for(const token of tokens){
    if(token.tag==='UNH'&&current.length){messages.push(current);current=[]}
    if(!['UNB','UNZ'].includes(token.tag))current.push(token)
    if(token.tag==='UNT'){messages.push(current);current=[]}
  }
  if(current.length)messages.push(current)
  return messages.filter(message=>message.some(t=>['UNH','BGM','LIN'].includes(t.tag))).map(message=>{
    const unhs=message.filter(t=>t.tag==='UNH'),bgms=message.filter(t=>t.tag==='BGM')
    const header=unhs.length===1?segmentComposite(unhs[0],2,una):[]
    const family=unhs.length?header[0]??null:null
    let market:GasMarket=null
    const completeValid=unbs.length===1&&unhs.length===1&&unbs[0].index<unhs[0].index
    if(!hasEnvelope||completeValid)market=prodatRegisterReadingMarket([...unbs,...message],una,hasEnvelope?null:applicationReference)
    if(hasEnvelope&&(family!=='PRODAT'||header[4]!== (market==='gas'?'E2SE6B':'E2SE6A')))market=null
    const reference=unbs.length===1?segmentComposite(unbs[0],7,una)[0]??null:!hasEnvelope?applicationReference??null:null
    return {segments:message,code:bgms.length===1?segmentComposite(bgms[0],1,una)[0]??null:null,family,market,reference,validCode:bgms.length===1,fragment:!hasEnvelope}
  })
}
