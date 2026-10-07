// masterplan: AT-Z14V-ESCO
// Finite prospective READ transport only: no admitted native original, private
// classification, accepted receipt, business effect or physical ACK is seeded.
import {createHash} from 'node:crypto'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {permissionAckMessage,permissionAckObject} from './fixtures/prodat-permission-ack'
import type {Parts} from './fixtures/prodat-register'

const io=vi.hoisted(()=>({message:{} as EdielMessageRow,basis:null as unknown,error:null as string|null,
 reads:[] as {name:string;args:Record<string,unknown>}[],decision:null as CanonicalRuntimeDecision|null}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 from:()=>{throw Error('UNDECLARED_TABLE_IO')},
 rpc:(name:string,args:Record<string,unknown>)=>{
  io.reads.push({name,args})
  if(name!=='gridex_ediel_received_z14_reporting_source_basis_v1')throw Error(`UNDECLARED_RPC:${name}`)
  const result=Promise.resolve({data:structuredClone(io.basis),error:io.error?{message:io.error}:null})
  return Object.assign(result,{abortSignal:()=>result})
 }
}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',async original=>({
 ...await original<Record<string,unknown>>(),resolveCanonicalRulePack:async()=>
  (await import('./helpers/prodatInboundSourceFixture')).prodatFixtureRegistryResolution
}))
// The public receiver and actual canonical validator run. Tenant/technical
// lookup are finite READ ports; the first source-validation WRITE is trapped
// before recording authority, projection, domain effects or ACK creation.
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:async()=>io.message,
 createEdielMessageEvent:()=>{throw Error('UNEXPECTED_EVENT_WRITE')}}))
vi.mock('@/lib/ediel/core/tenantResolver',()=>({resolveInboundTenantForMessage:async()=>({
 status:'tenant_resolved',companyId:io.message.company_id,message:io.message,evidence:{companyId:io.message.company_id}
})}))
vi.mock('@/lib/ediel/ack/technicalSyntaxAuthority',async original=>({
 ...await original<Record<string,unknown>>(),readEdielTechnicalSourceEndpoint:async()=>null
}))
vi.mock('@/lib/ediel/core/receivedSourceValidationLedger',()=>({
 recordReceivedSourceValidation:async(p:{decision:CanonicalRuntimeDecision})=>{
  io.decision=p.decision
  throw Error('STOP_BEFORE_SOURCE_VALIDATION_WRITE')
 }
}))
import {resolveCanonicalRuntimeDecision,resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {processInboundEdielMessage} from '@/lib/ediel/flows/inboundProcessing'

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const actor=id(2),company=id(3),received='2026-09-30T12:00:00.000000Z'
const digest=(text:string)=>createHash('sha256').update(text).digest('hex')
function wire(body:Parts[]=permissionAckObject('Z14','S17','A74',null)){
 const m=permissionAckMessage('Z14','S17','A74',null,undefined,body)
 return {...m,id:id(1),company_id:company,status:'received',message_received_at:received,
  execution_context_snapshot:{receivedProdatContext:{version:1,contextOrigin:'database_insert',
   sourceMessageId:id(1),companyId:company,environment:m.environment,messageCode:'Z14',
   payloadHash:digest(m.raw_payload!),sourceReceivedAt:received,capturedAt:received}}} as EdielMessageRow
}
function omitPurpose(body:Parts[]){
 return body.filter((part,i)=>!(part[0]==='CCI'&&part[2]==='Z24'
  ||part[0]==='CAV'&&body[i-1]?.[0]==='CCI'&&body[i-1]?.[2]==='Z24'))
}
function basis(m:EdielMessageRow,classification:'private'|'nonprivate'='private',bounded=false){
 return {status:'qualified',companyId:company,sourceMessageId:m.id,environment:m.environment,
  sourcePayloadHash:digest(m.raw_payload!),sourceReceivedAt:received,
  sourceContextHash:digest(JSON.stringify(m.execution_context_snapshot)),actorUserId:actor,
  evaluationUtcMs:Date.parse(received),objects:[{
   scope:{lineIndex:0,objectId:'735123456789012345',identityAgency:'9',
    lineItemReference:'CASE:A+B?C',customer:{id:'001',qualifier:'',agency:'89'},reason:'S17'},
   original:{messageId:id(10),payloadHash:'a'.repeat(64),originIntentId:id(11),
    assignmentId:id(12),permissionId:id(13),scopeBasisVersion:1,acceptedAttemptId:id(14),
    acceptedObservedAt:'2026-09-29T11:00:00.000Z',originCreatedAt:'2026-09-29T09:00:00.000Z',
    sealedAt:'2026-09-29T10:00:00.000Z',evidenceId:id(15),evidenceSha256:'b'.repeat(64),
    evidenceVersion:1,evidenceReviewedAt:'2026-09-29T08:00:00.000Z',archivedAt:'2026-09-29T07:00:00.000Z'},
   classification,term:bounded?{kind:'bounded',endMinute:'202611010000'}:{kind:'indefinite'},
   purpose:{kind:'present',code:'B72'}
  }],heldObjects:[]}
}
async function canonical(m:EdielMessageRow){
 io.message=m
 // Actor is an execution input, not caller-supplied classification/readiness.
 // Existing source-facts common member keeps the pre-repair call type-valid.
 const facts={deathStatusContext:undefined,actorUserId:actor}
 return resolveCanonicalRuntimeDecisionWithRegistry(m,facts)
}
async function receiver(m:EdielMessageRow){
 io.message=m
 await expect(processInboundEdielMessage({actorUserId:actor,edielMessageId:m.id}))
  .rejects.toThrow(/^STOP_BEFORE_SOURCE_VALIDATION_WRITE$/)
 expect(io.decision).not.toBeNull()
 return io.decision!
}
function refusedField(d:CanonicalRuntimeDecision,field:string){
 console.info('received-reporting-observation',JSON.stringify({field,syntax:d.syntaxDecision,
  application:d.applicationDecision,issues:d.issues.map(i=>i.code),readCount:io.reads.length}))
 expect(d.syntaxDecision).toBe('accepted')
 expect(d.issues).toContainEqual(expect.objectContaining({layer:'application',severity:'error',
  prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field,errorKind:'missing'})}))
 expect(d.applicationDecision).toBe('rejected')
 expect(d.responsePlan.some(p=>p.family==='APERAK'&&p.outcome==='positive')).toBe(false)
 expect(io.reads).toEqual([{name:'gridex_ediel_received_z14_reporting_source_basis_v1',
  args:{p_source_message_id:id(1),p_actor_user_id:actor}}])
}
function noPositive(d:CanonicalRuntimeDecision){
 expect(d.responsePlan.some(p=>p.family==='APERAK'&&p.outcome==='positive')).toBe(false)
}
function localHold(d:CanonicalRuntimeDecision){
 expect(d.syntaxDecision).toBe('accepted')
 expect(d.applicationDecision).toBe('manual_review')
 expect(d.prodatProcessingDisposition?.kind).toBe('internal_review')
 noPositive(d)
 expect(d.issues.some(i=>i.prodatDiagnostic?.kind==='field'
  &&['321','323'].includes(i.prodatDiagnostic.fieldNumber)&&i.prodatDiagnostic.errorKind==='missing')).toBe(false)
}
function end(body:Parts[],minute:string){
 const at=body.findIndex(p=>p[0]==='DTM'&&Array.isArray(p[1])&&p[1][0]==='90')
 return [...body.slice(0,at+1),['DTM',['91',minute,'203']] as Parts,...body.slice(at+1)]
}
beforeEach(()=>{io.reads=[];io.decision=null;io.basis=null;io.error=null;vi.setSystemTime(new Date(received))})
afterEach(()=>vi.useRealTimers())
describe('received Z14 known reporting requirements before own APP projection',()=>{
 it('standalone no-actor keeps receiver-local U absence unqualified',()=>{
  const d=resolveCanonicalRuntimeDecision(wire(omitPurpose(permissionAckObject('Z14','S17','A74',null))))
  expect(d.syntaxDecision).toBe('accepted');expect(d.applicationDecision).toBe('accepted')
  expect(io.reads).toEqual([])
 })
 it('standalone no-actor admits the unchanged complete positive wire',()=>{
  expect(resolveCanonicalRuntimeDecision(wire()).applicationDecision).toBe('accepted')
  expect(io.reads).toEqual([])
 })
 for(const [path,run]of [['canonical',canonical],['public receiver',receiver]]as const){
  it(`${path}: independently known private missing323 is rejected before projection`,async()=>{
   const m=wire(omitPurpose(permissionAckObject('Z14','S17','A74',null)))
   io.basis=basis(m)
   refusedField(await run(m),'323')
  })
  it(`${path}: independently known bounded missing321 is rejected before projection`,async()=>{
   const m=wire();io.basis=basis(m,'private',true)
   refusedField(await run(m),'321')
  })
 }
 it.each(['202610150000','202611010000'])('admits declared bounded end %s within the independent bound',async minute=>{
  const m=wire(end(permissionAckObject('Z14','S17','A74',null),minute));io.basis=basis(m,'private',true)
  expect((await canonical(m)).applicationDecision).toBe('accepted')
  expect(io.reads).toHaveLength(1)
 })
 it('refuses a genuine bounded end beyond the independent upper bound',async()=>{
  const m=wire(end(permissionAckObject('Z14','S17','A74',null),'202611020000'));io.basis=basis(m,'private',true)
  const d=await canonical(m)
  expect(d.applicationDecision).toBe('rejected');noPositive(d)
  expect(d.issues).toContainEqual(expect.objectContaining({layer:'application',severity:'error',
   prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'321',errorKind:'invalid'})}))
 })
 it('admits genuine nonprivate purpose absence only when actual original purpose is also absent',async()=>{
  const m=wire(omitPurpose(permissionAckObject('Z14','S17','A74',null))),b=basis(m,'nonprivate')
  io.basis={...b,objects:b.objects.map(o=>({...o,purpose:{kind:'absent'}}))}
  expect((await canonical(m)).applicationDecision).toBe('accepted');expect(io.reads).toHaveLength(1)
 })
 it.each(['private','nonprivate']as const)('refuses actual original B72 versus incoming B71 for %s',async classification=>{
  const body=permissionAckObject('Z14','S17','A74',null).map((p,i,a)=>
   p[0]==='CAV'&&a[i-1]?.[0]==='CCI'&&a[i-1]?.[2]==='Z24'?['CAV',['B71']] as Parts:p)
  const m=wire(body);expect(m.raw_payload).toContain('CAV+B71');io.basis=basis(m,classification)
  const d=await canonical(m);expect(d.applicationDecision).toBe('rejected');noPositive(d)
  expect(d.issues).toContainEqual(expect.objectContaining({layer:'application',severity:'error',
   prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'323',errorKind:'invalid'})}))
 })
 it('holds unavailable historical own authority locally without inventing national mandatory fields',async()=>{
  const m=wire();io.basis={...basis(m),status:'held',objects:[],
   heldObjects:[{scope:basis(m).objects[0].scope,missing:['historical_classification_unknown']}]}
  localHold(await canonical(m))
 })
 it('holds failed READ locally without converting private unknown into mandatory323',async()=>{
  const m=wire();io.error='declared_read_unavailable';localHold(await canonical(m))
 })
 it.each(['sourceMessageId','companyId','environment','sourcePayloadHash','sourceContextHash','actorUserId']as const)
 ('refuses copied READ authority with wrong %s',async key=>{
  const m=wire();io.basis={...basis(m),[key]:key.endsWith('Hash')?'c'.repeat(64):key==='environment'?'production':id(99)}
  localHold(await canonical(m))
 })
 it('a neighboring known object cannot supply missing own original scope',async()=>{
  const m=wire(),b=basis(m);io.basis={...b,objects:b.objects.map(o=>({...o,scope:{...o.scope,
   lineIndex:1,objectId:'735123456789012352',lineItemReference:'OTHER'}}))}
  localHold(await canonical(m))
 })
 it('a forged JSON context without actual READ/actor does not qualify receiver-local U',()=>{
  const m=wire(omitPurpose(permissionAckObject('Z14','S17','A74',null)))
  const facts={deathStatusContext:undefined,receivedReportingContext:basis(m)}
  expect(resolveCanonicalRuntimeDecision(m,facts).applicationDecision).toBe('accepted');expect(io.reads).toEqual([])
 })
 it('unknown full grammar is rejected before any historical reporting READ',async()=>{
  const m=wire();expect(m.raw_payload).toContain('PRODAT:D:97A:UN')
  m.raw_payload=m.raw_payload!.replace('PRODAT:D:97A:UN','PRODAT:D:99Z:UN')
  expect(m.raw_payload).toContain('PRODAT:D:99Z:UN')
  const d=await canonical(m);expect(d.syntaxDecision).toBe('rejected');expect(io.reads).toEqual([]);noPositive(d)
 })
})
