// masterplan: AT-Z14V-ESCO
// Finite prospective READ transport only: no admitted native original, private
// classification, accepted receipt, business effect or physical ACK is seeded.
import {createHash} from 'node:crypto'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalRuntimeDecision} from '@/lib/ediel/core/runtimeDecision'
import {permissionAckMessage,permissionAckObject} from './fixtures/prodat-permission-ack'
import type {Parts} from './fixtures/prodat-register'

const io=vi.hoisted(()=>({message:{} as EdielMessageRow,basis:null as unknown,error:null as string|null,throwAfterMs:null as number|null,
 reads:[] as {name:string;args:Record<string,unknown>}[],decision:null as CanonicalRuntimeDecision|null}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 from:()=>{throw Error('UNDECLARED_TABLE_IO')},
 rpc:(name:string,args:Record<string,unknown>)=>{
  io.reads.push({name,args})
  if(name!=='gridex_ediel_received_z14_reporting_source_basis_v1')throw Error(`UNDECLARED_RPC:${name}`)
  const result=io.throwAfterMs!==null?Promise.resolve().then(()=>{
   vi.setSystemTime(new Date(Date.now()+io.throwAfterMs!));throw Error('declared_read_timeout')
  }):Promise.resolve({data:structuredClone(io.basis),error:io.error?{message:io.error}:null})
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
import {loadReceivedZ14ReportingContext,receivedZ14ReportingContextForMessage} from '@/lib/ediel/prodat/receivedZ14ReportingContext'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'

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
  // PG jsonb digest remains producer-owned; bind the actual nested value.
  sourceContextHash:'d'.repeat(64),sourceReceivedContext:structuredClone((m.execution_context_snapshot as Record<string,unknown>).receivedProdatContext),actorUserId:actor,
  evaluationUtcMs:Date.parse(received),objects:[{
   scope:{lineIndex:0,objectId:'735123456789012345',identityAgency:'9',
    lineItemReference:'CASE:A+B?C',customer:{id:'001',qualifier:'',agency:'89'},reason:'S17'},
   original:{messageId:id(10),payloadHash:'a'.repeat(64),originIntentId:id(11),
    assignmentId:id(12),permissionId:id(13),scopeBasisVersion:1,acceptedAttemptId:id(14),
    acceptedObservedAt:'2026-09-29T11:00:00.000Z',originCreatedAt:'2026-09-29T09:00:00.000Z',
    sealedAt:'2026-09-29T10:00:00.000Z',evidenceId:id(15),evidenceSha256:'b'.repeat(64),
    evidenceVersion:'revision-1',evidenceReviewedAt:'2026-09-29T08:00:00.000Z',evidenceArchivedAt:'2026-09-29T07:00:00.000Z'},
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
beforeEach(()=>{io.reads=[];io.decision=null;io.basis=null;io.error=null;io.throwAfterMs=null;vi.setSystemTime(new Date(received))})
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers()})
describe('received Z14 known reporting requirements before own APP projection',()=>{
 for(const [path,run]of [['sync',resolveCanonicalRuntimeDecision],['async',resolveCanonicalRuntimeDecisionWithRegistry]]as const){
  it.each(['deathStatusContext','actorUserId','receivedReportingContext']as const)
  (`getter boundary: ${path} rejects syntax before reading caller %s`,async key=>{
   const m=wire();m.raw_payload=m.raw_payload!.replace(/UNT\+[0-9]+/,'UNT+999')
   expect(m.raw_payload).toContain('UNT+999')
   const facts=Object.defineProperty({},key,{enumerable:true,get(){throw Error(`PRE_SYNTAX_GETTER:${key}`)}})
   const d=await run(m,facts)
   expect(d.syntaxDecision).toBe('rejected');expect(d.applicationDecision).toBe('not_applicable')
   noPositive(d);expect(io.reads).toEqual([])
  })
 }
 it('getter boundary: sync ignores a caller reporting-token getter on valid syntax',()=>{
  const facts={get receivedReportingContext():never{throw Error('CALLER_REPORTING_CONTEXT_ACCESS')}}
  expect(resolveCanonicalRuntimeDecision(wire(),facts).applicationDecision).toBe('accepted')
  expect(io.reads).toEqual([])
 })
 it('getter boundary: async noactor ignores a caller reporting-token getter on valid syntax',async()=>{
  const facts={get receivedReportingContext():never{throw Error('CALLER_REPORTING_CONTEXT_ACCESS')}}
  expect((await resolveCanonicalRuntimeDecisionWithRegistry(wire(),facts)).applicationDecision).toBe('accepted')
  expect(io.reads).toEqual([])
 })
 it('getter boundary: async captures actor once and uses only its fresh READ despite a caller token getter',async()=>{
  const m=wire(omitPurpose(permissionAckObject('Z14','S17','A74',null)));io.basis=basis(m);let actorReads=0
  const facts={get actorUserId(){if(++actorReads!==1)throw Error('EXECUTION_ACTOR_RE_READ');return actor},
   get receivedReportingContext():never{throw Error('CALLER_REPORTING_CONTEXT_ACCESS')}}
  refusedField(await resolveCanonicalRuntimeDecisionWithRegistry(m,facts),'323')
  expect(actorReads).toBe(1)
 })
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
  const m=wire();io.basis={...basis(m),[key]:key==='sourceContextHash'?'malformed-opaque-hash':key.endsWith('Hash')?'c'.repeat(64):key==='environment'?'production':id(99)}
  localHold(await canonical(m))
 })
 it('a neighboring known object cannot supply missing own original scope',async()=>{
  const m=wire(),b=basis(m);io.basis={...b,objects:b.objects.map(o=>({...o,scope:{...o.scope,
   lineIndex:1,objectId:'735123456789012352',lineItemReference:'OTHER'}}))}
  localHold(await canonical(m))
 })
 it('a forged JSON context without actual READ/actor does not qualify receiver-local U',()=>{
  const m=wire(omitPurpose(permissionAckObject('Z14','S17','A74',null)))
  const facts={deathStatusContext:undefined,receivedReportingContext:basis(m) as unknown as import('@/lib/ediel/prodat/receivedZ14ReportingContext').ReceivedZ14ReportingContext}
  expect(resolveCanonicalRuntimeDecision(m,facts).applicationDecision).toBe('accepted');expect(io.reads).toEqual([])
 })
 it('unknown full grammar is held before any historical reporting READ',async()=>{
  const m=wire();expect(m.raw_payload).toContain('PRODAT:D:97A:UN')
  m.raw_payload=m.raw_payload!.replace('PRODAT:D:97A:UN','PRODAT:D:99Z:UN')
  expect(m.raw_payload).toContain('PRODAT:D:99Z:UN')
  const d=await canonical(m);expect(d.syntaxDecision).toBe('manual_review');expect(io.reads).toEqual([]);noPositive(d)
 })
 it('binds the actual nested received context despite unrelated public snapshot fields',async()=>{
  const m=wire();m.execution_context_snapshot={...(m.execution_context_snapshot as Record<string,unknown>),
   unrelatedPublicMetadata:{notAuthority:true}}
  io.basis=basis(m);expect((await canonical(m)).applicationDecision).toBe('accepted')
  expect(io.reads).toHaveLength(1)
 })
 it('refuses copied nested birth facts while retaining the producer-owned opaque hash',async()=>{
  const m=wire(),b=basis(m);io.basis={...b,sourceReceivedContext:{...(b.sourceReceivedContext as Record<string,unknown>),companyId:id(99)}}
  localHold(await canonical(m))
 })
 it('compares protected reception instants at microsecond precision',async()=>{
  const m=wire();io.basis={...basis(m),sourceReceivedAt:'2026-09-30T12:00:00.000001Z'}
  localHold(await canonical(m))
 })
 it('accepts equivalent exact UTC timestamp spelling without millisecond truncation',async()=>{
  const m=wire();io.basis={...basis(m),sourceReceivedAt:'2026-09-30T12:00:00+00:00'}
  expect((await canonical(m)).applicationDecision).toBe('accepted')
 })
 it('holds historical accepted-original evidence observed after actual reception',async()=>{
  const m=wire(),b=basis(m);io.basis={...b,objects:b.objects.map(o=>({...o,original:{...o.original,
   acceptedObservedAt:'2026-09-30T12:00:00.000001Z'}}))};localHold(await canonical(m))
 })
 it('does not reuse opaque authority after the immutable original changes',async()=>{
  const m=wire();io.basis=basis(m)
  const context=await loadReceivedZ14ReportingContext(m,actor)
  expect(context).toBeDefined()
  expect(receivedZ14ReportingContextForMessage(context,{...m,id:id(99)},actor)).toBeUndefined()
  expect(receivedZ14ReportingContextForMessage(context,{...m,raw_payload:m.raw_payload+' '},actor)).toBeUndefined()
  expect(receivedZ14ReportingContextForMessage(context,{...m,message_standard:'ai_list'},actor)).toBeUndefined()
  const changedHash={...m,immutable_payload_hash:'c'.repeat(64)}
  expect(receivedZ14ReportingContextForMessage(context,changedHash,actor)).toBeUndefined()
  expect(receivedZ14ReportingContextForMessage(context,m,actor)).toBe(context)
  expect(receivedZ14ReportingContextForMessage(context,m,actor)).toBeUndefined()
 })
 it('a genuine unrelated/nonservice NULL remains receiver-local U',async()=>{
  const m=wire(omitPurpose(permissionAckObject('Z14','S17','A74',null)));io.basis=null
  expect((await canonical(m)).applicationDecision).toBe('accepted');expect(io.reads).toHaveLength(1)
 })
 it('source-valid Z14N never asks for positive reporting facts',async()=>{
  const m={...permissionAckMessage('Z14','Z96','A76',null),company_id:company,status:'received'} as EdielMessageRow
  const d=await canonical(m);expect(d.syntaxDecision).toBe('accepted');expect(d.applicationDecision).toBe('accepted')
  expect(io.reads).toEqual([])
 })
 it('physical gas cannot borrow cached electricity reporting authority',async()=>{
  const m=wire();m.raw_payload=m.raw_payload!.replace('23-DGI-PRODAT','27-DDQ-PRODAT').replace('E2SE6A','E2SE6B')
  expect(m.raw_payload).toContain('27-DDQ-PRODAT');expect(m.raw_payload).toContain('E2SE6B')
  expect(await loadReceivedZ14ReportingContext(m,actor)).toBeUndefined();expect(io.reads).toEqual([])
 })
 it('another PRODAT message cannot inherit received Z14 reporting context',async()=>{
  const m={...permissionAckMessage('Z15','Z24','A74','E37'),company_id:company,status:'received'} as EdielMessageRow
  expect((await canonical(m)).applicationDecision).toBe('accepted');expect(io.reads).toEqual([])
 })
 it('a known sibling cannot satisfy another private own missing323',async()=>{
  const first=permissionAckObject('Z14','S17','A74',null)
  const second=permissionAckObject('Z14','S17','A74',null,'2','SECOND')
  const m=wire([...first,...omitPurpose(second)]),b=basis(m),firstKnown=b.objects[0]
  io.basis={...b,objects:[firstKnown,{...firstKnown,scope:{...firstKnown.scope,lineIndex:1,
   objectId:'735123456789012352',lineItemReference:'SECOND'}}]}
  const d=await canonical(m);expect(d.applicationDecision).toBe('rejected');noPositive(d)
  const failures=d.issues.filter(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='323')
  expect(failures).toHaveLength(1)
  expect(failures[0].prodatDiagnostic).toMatchObject({kind:'field',errorKind:'missing',occurrence:{lineIndex:1,
   objectId:'735123456789012352',lineItemReference:'SECOND'}})
  expect(d.prodatApplicationValidation?.objects.map(o=>o.applicationDecision)).toEqual(['accepted','rejected'])
 })
 it('opaque invocation: standalone noactor cannot reuse a real prior READ token',async()=>{
  const m=wire(omitPurpose(permissionAckObject('Z14','S17','A74',null)));io.basis=basis(m)
  const receivedReportingContext=await loadReceivedZ14ReportingContext(m,actor)
  const d=resolveCanonicalRuntimeDecision(m,{receivedReportingContext})
  expect(d.applicationDecision).toBe('accepted');expect(io.reads).toHaveLength(1)
 })
 it('opaque invocation: fresh async READ refusal cannot be bypassed with a prior token',async()=>{
  const m=wire();io.basis=basis(m)
  const receivedReportingContext=await loadReceivedZ14ReportingContext(m,actor)
  io.error='current_actor_read_revoked'
  localHold(await resolveCanonicalRuntimeDecisionWithRegistry(m,{actorUserId:actor,receivedReportingContext}))
  expect(io.reads).toHaveLength(2)
 })
 it('opaque invocation: prior token expires before a later execution',async()=>{
  const m=wire();io.basis=basis(m)
  const context=await loadReceivedZ14ReportingContext(m,actor)
  vi.setSystemTime(new Date(Date.parse(received)+3000))
  expect(receivedZ14ReportingContextForMessage(context,m,actor)).toBeUndefined()
 })
 it('retains legal incoming optional C889 components four/five with the same original purpose',async()=>{
  const body=permissionAckObject('Z14','S17','A74',null).map((p,i,a)=>
   p[0]==='CAV'&&a[i-1]?.[0]==='CCI'&&a[i-1]?.[2]==='Z24'?['CAV',['B72','','','OPTIONAL','OPTIONAL']] as Parts:p)
  const m=wire(body);io.basis=basis(m)
  expect((await canonical(m)).applicationDecision).toBe('accepted')
 })
 it('joins SQL-shaped text evidence version and Swedish full UD selector to actual physical fields',async()=>{
  const body=permissionAckObject('Z14','S17','A74',null).map(p=>p[0]==='NAD'&&p[1]==='UD'
   ?['NAD','UD',['CUSTOMER','SE1','260'],'','Synthetic','','','','','SE'] as Parts:p)
  const m=wire(body),b=basis(m);io.basis={...b,objects:b.objects.map(o=>({...o,scope:{...o.scope,
   customer:{id:'CUSTOMER',qualifier:'SE1',agency:'260'}}}))}
  expect((await canonical(m)).applicationDecision).toBe('accepted');expect(io.reads).toHaveLength(1)
 })
 it('opaque invocation refuses a different executing actor before one valid redemption',async()=>{
  const m=wire();io.basis=basis(m)
  const context=await loadReceivedZ14ReportingContext(m,actor)
  expect(receivedZ14ReportingContextForMessage(context,m,id(99))).toBeUndefined()
  expect(receivedZ14ReportingContextForMessage(context,m,actor)).toBe(context)
 })
 it('opaque invocation rejects a serialized copy of the real READ capability',async()=>{
  const m=wire();io.basis=basis(m)
  const context=await loadReceivedZ14ReportingContext(m,actor)
  expect(receivedZ14ReportingContextForMessage({...context!},m,actor)).toBeUndefined()
  expect(receivedZ14ReportingContextForMessage(context,m,actor)).toBe(context)
 })
 it('opaque invocation with no async actor drops a prior real READ capability',async()=>{
  const m=wire(omitPurpose(permissionAckObject('Z14','S17','A74',null)));io.basis=basis(m)
  const receivedReportingContext=await loadReceivedZ14ReportingContext(m,actor)
  expect((await resolveCanonicalRuntimeDecisionWithRegistry(m,{receivedReportingContext})).applicationDecision).toBe('accepted')
  expect(io.reads).toHaveLength(1)
 })
 it('opaque invocation is consumed by only one actual full field evaluation',async()=>{
  const m=wire(),decision=resolveCanonicalRuntimeDecision(m);io.basis=basis(m)
  const context=await loadReceivedZ14ReportingContext(m,actor)
  const receivedReportingContext=receivedZ14ReportingContextForMessage(context,m,actor)
  const input={policy:decision.policy!,rawPayload:m.raw_payload,rawSegments:decision.canonical.rawSegments,
   una:decision.canonical.una,receivedReportingContext}
  expect(validateCanonicalPolicyFields(input).some(i=>i.code==='PRODAT_RECEIVED_REPORTING_SOURCE_UNQUALIFIED')).toBe(false)
  expect(validateCanonicalPolicyFields(input)).toContainEqual(expect.objectContaining({
   code:'PRODAT_RECEIVED_REPORTING_SOURCE_UNQUALIFIED',prodatDiagnostic:expect.objectContaining({kind:'local_unknown'})}))
 })
 it('an elapsed thrown READ timeout retains localhold before APP and positive ACK',async()=>{
  const m=wire();io.basis=basis(m);io.throwAfterMs=3000
  localHold(await canonical(m));expect(io.reads).toHaveLength(1)
 })
 it('non-EDIFACT rows cannot read reporting facts through the standalone loader',async()=>{
  expect(await loadReceivedZ14ReportingContext({...wire(),message_standard:'ai_list'},actor)).toBeUndefined()
  expect(io.reads).toEqual([])
 })
 it('a review later than the immutable original origin cannot qualify historical private facts',async()=>{
  const m=wire(),b=basis(m);io.basis={...b,objects:b.objects.map(o=>({...o,original:{...o.original,
   evidenceReviewedAt:'2026-09-29T09:00:00.000001Z'}}))}
  localHold(await canonical(m))
 })
 it.each(['complete','missing323','missing321'] as const)('successful READ authority expiring before the private core cannot become unqualified positive U: %s',async omission=>{
  const m=wire(omission==='missing323'?omitPurpose(permissionAckObject('Z14','S17','A74',null)):undefined)
  io.basis=basis(m,'private',omission==='missing321');let afterReadCalls=0
  vi.spyOn(Date,'now').mockImplementation(()=>Date.parse(received)
   +(io.reads.length&&++afterReadCalls>=4?3000:0))
  localHold(await canonical(m));expect(io.reads).toHaveLength(1)
 })
})
