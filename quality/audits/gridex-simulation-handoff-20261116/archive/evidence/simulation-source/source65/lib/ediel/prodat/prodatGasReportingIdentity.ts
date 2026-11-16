import type {GasSerialChangeObject} from './prodatGasApplicability'

/** P26.A p77: reporting identity is independent of the causal changed boolean.
 * Caller selections are pure inputs, never persisted send authority. */
export type GasReportingIdentityObject = {
  objectKey:string
  installation:{id:string;agency:'9'|'89'}
  lineItemReference:string
  process:{code:'Z04';reason:'Z22'|'Z23'|'Z24'|'Z25'|'Z26'|'Z70'}|{code:'Z06';reason:'E34'|'E64'|'E32'}|{code:'Z10';reason:'E58'}
  source:{reference:string;revision:string}
  event:{key:string;revision:string}|null
  assessment:{kind:'unknown'}|{kind:'TIM';seriesId:string;evidence:{sourceReference:string;sourceRevision:string}}|{kind:'SCH';evidence:{sourceReference:string;sourceRevision:string}}
}
export type GasReportingIdentitySelection={source:{kind:'caller_selection';reference:string};objects:readonly GasReportingIdentityObject[]}
const invalid=():never=>{throw new Error('prodat_register_evidence_gas_reporting_identity_invalid')}
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
function copyObject(value:unknown):GasReportingIdentityObject{
  const row=record(value,['objectKey','installation','lineItemReference','process','source','event','assessment'])
  const installation=record(row.installation,['id','agency']),process=record(row.process,['code','reason']),source=record(row.source,['reference','revision'])
  if(installation.agency!=='9'&&installation.agency!=='89')return invalid()
  let ownProcess:GasReportingIdentityObject['process']
  if(process.code==='Z04'&&typeof process.reason==='string'&&['Z22','Z23','Z24','Z25','Z26','Z70'].includes(process.reason))ownProcess={code:'Z04',reason:process.reason as Extract<GasReportingIdentityObject['process'],{code:'Z04'}>['reason']}
  else if(process.code==='Z06'&&(process.reason==='E34'||process.reason==='E64'||process.reason==='E32'))ownProcess={code:'Z06',reason:process.reason}
  else if(process.code==='Z10'&&process.reason==='E58')ownProcess={code:'Z10',reason:'E58'}
  else return invalid()
  const ownSource={reference:exact(source.reference),revision:exact(source.revision)}
  let event:GasReportingIdentityObject['event']=null
  if(ownProcess.code==='Z10'||ownProcess.code==='Z06'&&ownProcess.reason!=='E34'){
    const e=record(row.event,['key','revision']);event={key:exact(e.key),revision:exact(e.revision)}
  }else if(row.event!==null)return invalid()
  let assessment:GasReportingIdentityObject['assessment']
  if((row.assessment as {kind?:unknown}|null)?.kind==='unknown'){
    record(row.assessment,['kind']);assessment={kind:'unknown'}
  }else{
    const kind=(row.assessment as {kind?:unknown}|null)?.kind
    if(kind!=='TIM'&&kind!=='SCH')return invalid()
    const a=record(row.assessment,kind==='TIM'?['kind','seriesId','evidence']:['kind','evidence'])
    const e=record(a.evidence,['sourceReference','sourceRevision'])
    const evidence={sourceReference:exact(e.sourceReference),sourceRevision:exact(e.sourceRevision)}
    if(evidence.sourceReference!==ownSource.reference||evidence.sourceRevision!==ownSource.revision)return invalid()
    assessment=kind==='TIM'?{kind,seriesId:exact(a.seriesId),evidence}:{kind,evidence}
  }
  return {objectKey:exact(row.objectKey),installation:{id:exact(installation.id),agency:installation.agency},lineItemReference:exact(row.lineItemReference),process:ownProcess,source:ownSource,event,assessment}
}
export function copyGasReportingIdentitySelection(value:unknown):GasReportingIdentitySelection{
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
/** Called only after the wire owner establishes supplied R/O, never for X,
 * omitted O, missing R, unknown causal condition or incoming gray240. */
export function gasReportingIdentityValue(selection:GasReportingIdentitySelection|null,context:{id:string|null;agency:string|null;lineItemReference:string|null;code:string;reason:string|null;unique:boolean;causal?:GasSerialChangeObject}):string|null{
  if(!context.unique||!context.lineItemReference)return null
  const own=selection?.objects.find(o=>o.installation.id===context.id&&o.installation.agency===context.agency)
  if(!own||own.lineItemReference!==context.lineItemReference||own.process.code!==context.code||own.process.reason!==context.reason||own.assessment.kind==='unknown')return null
  if(context.causal&&(own.objectKey!==context.causal.objectKey||own.event?.key!==context.causal.event.key||own.event?.revision!==context.causal.event.revision))return null
  const expected=own.assessment.kind==='TIM'?own.assessment.seriesId:own.installation.id
  return expected.length<=35&&!/[åäöÅÄÖ]/.test(expected)?expected:null
}
