/** P26.A pp65/71/109/112: source decisions, never persisted authority. */
export type DeathRef = {key:string;revision:string;eventKey:string;reference:string}
export type DeathActor = {id:string;qualifier:string;agency:string}
export type DeathCustomer = DeathActor & ({kind:'domain_customer';key:string;revision:string}|{kind:'test_customer';workbookSha256:string;sheet:string;entityLabel:string;blockIndex:number;columnName:string;columnIndex:number})
export type DeathAssessment = {kind:'unknown'}|{kind:'known';value:'death'|'not_death';evidence:DeathRef}
export type DeathEventObject = {
 objectKey:string;installation:{id:string;agency:'9'|'89'};customer:DeathCustomer;
 legalSupplier:DeathActor;legalGridOwner:DeathActor;
 process:{code:'Z05';reason:'Z23'}|{code:'Z06';reason:'E34'};
 event:DeathRef;assessment:DeathAssessment;lineItemReference:string;
}
export type DeathSelection = {source:{kind:'caller_selection';reference:string};objects:DeathEventObject[]}
const invalid=():never=>{throw new Error('prodat_register_evidence_death_status_invalid')}
function rec(v:unknown,keys:string[]):Record<string,unknown>{
 if(!v||typeof v!=='object'||Array.isArray(v))return invalid()
 const r=v as Record<string,unknown>
 if(Object.keys(r).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(r,k)||r[k]===undefined))return invalid()
 return r
}
function text(v:unknown,max=200,empty=false):string{if(typeof v!=='string'||(!empty&&!v.length)||v!==v.trim()||v.length>max||/[\x00-\x1f\x7f]/.test(v))return invalid();return v}
function choice<T extends string>(v:unknown,values:readonly T[]):T{return typeof v==='string'&&values.includes(v as T)?v as T:invalid()}
function index(v:unknown):number{return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:invalid()}
function ref(v:unknown):DeathRef{const r=rec(v,['key','revision','eventKey','reference']);return {key:text(r.key),revision:text(r.revision),eventKey:text(r.eventKey),reference:text(r.reference)}}
function actor(v:unknown):DeathActor{const r=rec(v,['id','qualifier','agency']);return {id:text(r.id,35),qualifier:text(r.qualifier,3,true),agency:text(r.agency,3)}}
function customer(v:unknown):DeathCustomer{
 const kind=(v as {kind?:unknown}|null)?.kind
 const common=['kind','id','qualifier','agency']
 const r=rec(v,kind==='domain_customer'?[...common,'key','revision']:[...common,'workbookSha256','sheet','entityLabel','blockIndex','columnName','columnIndex'])
 const a=actor({id:r.id,qualifier:r.qualifier,agency:r.agency})
 if(!['89','260'].includes(a.agency))return invalid()
 if(kind==='domain_customer')return {...a,kind,key:text(r.key),revision:text(r.revision)}
 choice(r.kind,['test_customer']);const hash=text(r.workbookSha256,64);if(!/^[a-f0-9]{64}$/.test(hash))return invalid()
 return {...a,kind:'test_customer',workbookSha256:hash,sheet:text(r.sheet),entityLabel:text(r.entityLabel),blockIndex:index(r.blockIndex),columnName:text(r.columnName),columnIndex:index(r.columnIndex)}
}
function object(v:unknown):DeathEventObject{
 const r=rec(v,['objectKey','installation','customer','legalSupplier','legalGridOwner','process','event','assessment','lineItemReference'])
 const i=rec(r.installation,['id','agency']),p=rec(r.process,['code','reason']),event=ref(r.event)
 const code=choice(p.code,['Z05','Z06']);if(p.reason!==(code==='Z05'?'Z23':'E34')||event.key!==event.eventKey)return invalid()
 let assessment:DeathAssessment
 if((r.assessment as {kind?:unknown}|null)?.kind==='unknown'){rec(r.assessment,['kind']);assessment={kind:'unknown'}}else{
  const a=rec(r.assessment,['kind','value','evidence']);choice(a.kind,['known']);const evidence=ref(a.evidence)
  if(evidence.eventKey!==event.eventKey||evidence.revision!==event.revision)return invalid()
  assessment={kind:'known',value:choice(a.value,['death','not_death']),evidence}
 }
 return {objectKey:text(r.objectKey),installation:{id:text(i.id,25),agency:choice(i.agency,['9','89'])},customer:customer(r.customer),legalSupplier:actor(r.legalSupplier),legalGridOwner:actor(r.legalGridOwner),process:code==='Z05'?{code,reason:'Z23'}:{code,reason:'E34'},event,assessment,lineItemReference:text(r.lineItemReference,35)}
}
export function copyDeathSelection(v:unknown):DeathSelection{
 const r=rec(v,['source','objects']),s=rec(r.source,['kind','reference']);choice(s.kind,['caller_selection'])
 if(!Array.isArray(r.objects))return invalid()
 const objects=r.objects.map(object),keys=new Set<string>(),objectKeys=new Set<string>()
 for(const o of objects){const k=JSON.stringify([o.installation.id,o.installation.agency]);if(keys.has(k)||objectKeys.has(o.objectKey))return invalid();keys.add(k);objectKeys.add(o.objectKey)}
 return {source:{kind:'caller_selection',reference:text(s.reference)},objects}
}
export const isDeathStatusField=(code:string,field:string)=>['Z05','Z06','Z09'].includes(code)&&field==='310'
/** Valid own Z09E is intrinsically death; no local event is required. */
export function deathCondition(code:string,subtype:string|null|undefined,assessment?:DeathAssessment):boolean|null{
 const allowed:Record<string,string[]>={Z05:['L','LK','C','H'],Z06:['E','F','G'],Z09:['B','D','E','F','G']}
 if(!subtype||!allowed[code]?.includes(subtype))return null
 if(code==='Z09')return subtype==='E'
 if(subtype!==(code==='Z05'?'LK':'E'))return false
 return assessment?.kind==='known'?assessment.value==='death':null
}
export function deathAggregate(code:string,subtype:string|null|undefined,selection?:DeathSelection|null):boolean|null{
 const own=deathCondition(code,subtype);if(own!==null)return own
 if(!selection?.objects.length)return null
 let result=false
 for(const o of copyDeathSelection(selection).objects){if(o.process.code!==code)return null;const value=deathCondition(code,subtype,o.assessment);if(value===null)return null;result ||= value}
 return result
}

/** Projection uses source input only. Full policy then checks all object/party/LI bindings. */
export function projectDeathStatus(input:{code:string;reason:string|null|undefined;installation:{id:string;agency:string};selection?:DeathSelection|null}):string[]{
 const selected=input.selection==null?[]:copyDeathSelection(input.selection).objects
 const subtype=input.code==='Z09'&&input.reason==='E34'?'E':input.code==='Z06'&&input.reason==='E34'?'E':input.code==='Z05'&&input.reason==='Z23'?'LK':null
 const own=selected.find(o=>o.installation.id===input.installation.id&&o.installation.agency===input.installation.agency&&o.process.code===input.code&&o.process.reason===input.reason)
 return deathCondition(input.code,subtype,own?.assessment)===true?['CCI++Z17','CAV+Z41']:[]
}
