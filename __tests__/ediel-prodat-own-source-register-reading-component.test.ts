// masterplan: AT-Z03L-SUPPLIER, AT-Z03LK-SUPPLIER
// Finite source component only; whole acceptance and automatic consumer remain unproved.
// These controls execute the real source loader, policy and field validator.
// Only Supabase transport responses are synthetic. They do not prove native
// RBAC, immutable database custody, registry admission, history or effects.
import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {RulebookFieldRule} from '@/lib/ediel/rulebook/fieldMatrix'
import {loadProdatOwnSourceReadingContext,sourceProdatOwnRegisterReadingDeclarations,type ProdatOwnSourceReadingContext} from '@/lib/ediel/core/prodatOwnSourceRegisterReadingDeclarations'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {stockholmBusinessDate} from '@/lib/ediel/core/executionContext'
import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic,line,qty,type Parts} from './fixtures/prodat-register'
import {installProdatOwnSourceReadingFixture,resetProdatOwnSourceReadingSdk,type ProdatOwnSourceReadingSdk} from './helpers/prodatOwnSourceReadingFixture'

const fixtureSdk=vi.hoisted(()=>({value:null as ProdatOwnSourceReadingSdk|null}))
vi.mock('@/lib/supabase/service',async()=>{
 const {createProdatOwnSourceReadingSdk}=await import('./helpers/prodatOwnSourceReadingFixture')
 fixtureSdk.value=createProdatOwnSourceReadingSdk()
 return {supabaseService:{from:fixtureSdk.value.from,rpc:fixtureSdk.value.rpc}}
})
const io=fixtureSdk.value!

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const actor=id(3),point='735123456789012344',otherPoint='735123456789012351'
const received='2026-10-01T12:01:00.123456Z'
const hash=(raw:string)=>createHash('sha256').update(raw,'utf8').digest('hex')
const fields=['214','218','259'] as const
type Variant='L'|'LK'
type FieldState='valid'|'missing'|'invalid'
type Declaration='valid'|'missing'|'duplicate'|'malformed'|'misplaced'|'header'|'other-object'
type FixtureOptions={variant?:Variant;constant?:FieldState;digits?:FieldState;declaration?:Declaration;value259?:string;poison?:boolean}

function reading(field:typeof fields[number],state:FieldState='valid',value?:string):Parts[]{
 if(state==='missing')return []
 const qualifier={214:'Z02',218:'Z05',259:'Z16'}[field]
 // The wrong national C889 component is still legal UNSM CAV syntax. It
 // exercises an invalid supplied field, rather than a grammar rejection.
 return characteristic(qualifier,value??({214:'1',218:'6',259:'111'}[field]),state==='invalid'?0:3)
}

function fixture(options:FixtureOptions={}){
 const variant=options.variant??'L',kind=options.declaration??'valid'
 const bodyFor=(objectId:string,index:number,own259:Declaration):Parts[]=>[
  line(String(index+1),objectId,undefined,'9'),['DTM',['92','202610150000','203']],['DTM',['354','15','806']],qty('1000'),
  ...characteristic('Z13',variant==='L'?'Z22':'Z23'),...characteristic('Z04','Z04'),...characteristic('Z07','Z12'),
  ...characteristic('Z12','D',3),...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
  ...reading('214',options.constant),...reading('218',options.digits),
  ...(own259==='valid'||own259==='duplicate'||own259==='misplaced'?reading('259','valid',options.value259):
    own259==='malformed'?reading('259','invalid'):[]),
  ...(own259==='duplicate'?reading('259'):[]),
  ['RFF',['MG',`METER-${objectId}`]],['RFF',['Z05','TES']],['RFF',['LI',`OWN-${index+1}`]],
  ['NAD','UD',['199001011234','SE2','260'],'','Synthetic Customer','Street','City','','12345','SE'],
  ['NAD','IT',[objectId,'','9'],'','','Street','City','','12345','SE'],['NAD','Z02',['99876','160','SVK']],
 ]
 const body:Parts[]=[['NAD','FR',['54321','160','SVK']],['NAD','DO',['12345','160','SVK']],
  ...(kind==='header'?reading('259'):[]),...bodyFor(point,0,kind),
  ...(kind==='other-object'?bodyFor(otherPoint,1,'valid'):[])]
 let raw=guideOrderedFixtureRaw(body,'Z04').replace('+S+R+','+54321:14+12345:14+')
  .replace("+23-DDQ-PRODAT'","+23-DDQ-PRODAT++1++1'")
 // Preserve the counted wire while moving the pair after its own SG16 RFF.
 // Do this after the synthetic guide-order helper, which otherwise repairs it.
 if(kind==='misplaced')raw=raw.replace("CCI++Z16'CAV+:::111'",'').replace('NAD+UD+',"CCI++Z16'CAV+:::111'NAD+UD+")
 const payloadHash=hash(raw)
 const birth={version:1,contextOrigin:'database_insert',sourceMessageId:id(1),companyId:id(2),environment:'test',
  messageCode:'Z04',payloadHash,sourceReceivedAt:received,capturedAt:received}
 const row={id:id(1),company_id:id(2),environment:'test',direction:'inbound',message_standard:'edifact',message_family:'PRODAT',
  message_code:'Z04',message_version:'E2SE6A',application_reference:'23-DDQ-PRODAT',raw_payload:raw,
  inbound_email_message_id:id(4),message_created_at:'2026-09-17T11:00:00Z',message_received_at:received,created_at:received,
  status:'received',syntax_check_status:'not_checked',failure_reason:null,execution_context_snapshot:{receivedProdatContext:birth},
  parsed_payload:options.poison===undefined?{}:{meterReadingsSentInUtilts:options.poison,
   prodatDependentFacts:{meterReadingsSentInUtilts:options.poison,byCell:{'Z04:214':options.poison,'Z04:218':options.poison,'Z04:259':options.poison}}},
  validation_report:options.poison===undefined?{}:{prodatDependentFacts:{meterReadingsSentInUtilts:options.poison}}} as unknown as EdielMessageRow
 return {row,variant,payloadHash}
}

const install=(row:EdielMessageRow,variant:Variant)=>installProdatOwnSourceReadingFixture(io,row,variant)
beforeEach(()=>resetProdatOwnSourceReadingSdk(io))

// Direct component invocation. Automatic messagePolicy/runtime adoption is separate.
function policy(row:EdielMessageRow,context?:ProdatOwnSourceReadingContext|null,actorUserId=actor){
 const canonical=parseCanonicalMessageRow(row)
 const input={family:'PRODAT' as const,messageCode:'Z04',subtypeOrReasonCode:canonical.subtype,
  direction:'inbound' as const,referenceDate:stockholmBusinessDate(new Date(row.message_received_at!)),
  associationAssignedCode:canonical.version,applicationReference:canonical.applicationReference,mode:'parse' as const}
 const selected=resolveCanonicalEdielPolicy(input)
 const registerObjects=sourceProdatOwnRegisterReadingDeclarations({message:row,actorUserId,context,policy:selected})
 return resolveCanonicalEdielPolicy({...input,prodatDependentFacts:registerObjects?{registerObjects}:null})
}

async function loaded(options:FixtureOptions={}){
 const f=fixture(options);install(f.row,f.variant)
 expect(validateEdifactSyntax(f.row)).toMatchObject({ok:true,grammarQualification:'qualified'})
 const context=await loadProdatOwnSourceReadingContext(f.row,actor)
 expect(context).not.toBeNull()
 return {...f,context:context!}
}
function ownFact(row:EdielMessageRow,context:ProdatOwnSourceReadingContext,actorUserId=actor){
 return sourceProdatOwnRegisterReadingDeclarations({message:row,context,actorUserId,policy:policy(row)})
}

const states=['valid','missing','invalid'] as const
for(const variant of ['L','LK'] as const)for(const constant of states)for(const digits of states){
 it(`${variant}: valid259 TRUE with214 ${constant} and218 ${digits}; typed diagnostics remain`,async()=>{
  const {row,context}=await loaded({variant,constant,digits}),selected=policy(row,context),canonical=parseCanonicalMessageRow(row)
  expect(selected.guide.guideRevision).toBe('26-A')
  expect(selected.prodatDependentFacts?.registerObjects).toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:true}])
  const conditions=selected.prodatDependentConditions.filter(c=>fields.includes(c.fieldNumber as typeof fields[number]))
  expect(conditions).toHaveLength(3)
  expect(conditions.every(c=>c.status==='required')).toBe(true)
  const issues=validateCanonicalPolicyFields({policy:selected,rawPayload:row.raw_payload,rawSegments:canonical.rawSegments,una:canonical.una,scope:'dependent_only'})
  expect(issues.filter(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED'&&['CCI++Z02/CAV','CCI++Z05/CAV','CCI++Z16/CAV'].includes(i.fieldPath??''))).toEqual([])
  for(const [field,state] of [['214',constant],['218',digits]] as const){
   const findings=issues.filter(i=>i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber===field)
   if(state==='valid')expect(findings).toEqual([])
   else expect(findings).toContainEqual(expect.objectContaining({blocking:true,prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:field,errorKind:state==='missing'?'missing':'invalid',occurrence:expect.objectContaining({objectId:point,identityAgency:'9',lineItemReference:'OWN-1'})})}))
  }
 })
}

for(const variant of ['L','LK'] as const)for(const declaration of ['missing','duplicate','malformed','misplaced','header','other-object'] as const){
 it(`${variant}: ${declaration}259 cannot fill the own unknown declaration`,async()=>{
  const f=fixture({variant,declaration});install(f.row,f.variant)
  // SG14 placed after SG16 is invalid full UNSM grammar. That early refusal
  // must remain intact, rather than inventing a valid private context for it.
  expect(validateEdifactSyntax(f.row).ok).toBe(declaration!=='misplaced')
  const context=await loadProdatOwnSourceReadingContext(f.row,actor)
  if(declaration==='misplaced')expect(context).toBeNull()
  else expect(context).not.toBeNull()
  const selected=policy(f.row,context)
  if(context)expect(selected.prodatDependentFacts?.registerObjects?.find(o=>o.meteringPointId===point)).toEqual({meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:null})
  if(declaration==='other-object')expect(selected.prodatDependentFacts?.registerObjects?.find(o=>o.meteringPointId===otherPoint)?.meterReadingsSentInUtilts).toBe(true)
  const conditions=selected.prodatDependentConditions.filter(c=>fields.includes(c.fieldNumber as typeof fields[number]))
  expect(conditions).toHaveLength(3)
  expect(conditions.every(c=>c.status==='undetermined')).toBe(true)
 })
}

for(const variant of ['L','LK'] as const){
 it(`${variant}: current non-enumerated259 accepts own E01 and creates no inventory`,async()=>{
  const {row,context}=await loaded({variant,value259:'E01'}),selected=policy(row,context)
  expect(selected.fieldRules.find((r):r is RulebookFieldRule=>'fieldNumber' in r&&r.fieldNumber==='259')?.allowedValues).toBeUndefined()
  expect(selected.prodatDependentFacts?.registerObjects).toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:true}])
  expect(selected.prodatDependentFacts?.registerObjects?.[0]?.expectedRegisterCount).toBeUndefined()
 })
 for(const poison of [true,false] as const)it(`${variant}: caller root/report/byCell ${poison} cannot fill omitted own259`,async()=>{
  const {row,context}=await loaded({variant,declaration:'missing',poison})
  expect(policy(row,context).prodatDependentFacts?.registerObjects).toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:null}])
 })
 it(`${variant}: physical own TRUE overrides caller FALSE`,async()=>{
  const {row,context}=await loaded({variant,poison:false})
  expect(policy(row,context).prodatDependentFacts?.registerObjects?.[0]?.meterReadingsSentInUtilts).toBe(true)
 })
 it(`${variant}: actorless caller TRUE cannot replace private source context`,()=>{
  const {row}=fixture({variant,declaration:'missing',poison:true})
  expect(policy(row).prodatDependentConditions.filter(c=>fields.includes(c.fieldNumber as typeof fields[number])).every(c=>c.status==='undetermined')).toBe(true)
 })
}

it('the genuine loader performs exact source, legal, reception, mail, parse and actor reads',async()=>{
 const {row,context}=await loaded()
 expect(ownFact(row,context)).toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:true}])
 expect(io.calls).toContainEqual({kind:'table',name:'ediel_messages',args:{id:row.id,company_id:row.company_id}})
 expect(io.calls).toContainEqual({kind:'table',name:'inbound_email_messages',args:{id:id(4),company_id:row.company_id,environment:'test'}})
 expect(io.calls).toContainEqual({kind:'table',name:'inbound_ediel_parse_results',args:{id:id(5),company_id:row.company_id}})
 expect(io.calls).toContainEqual({kind:'rpc',name:'ediel_require_inbound_legal_context_v1',args:{p_company_id:row.company_id,p_message_id:row.id}})
 expect(io.calls).toContainEqual({kind:'rpc',name:'ediel_inbound_reception_request_v1',args:{p_company_id:row.company_id,p_message_id:row.id,p_actor_user_id:actor,p_inbound_email_message_id:id(4)}})
 expect(io.calls.filter(c=>c.kind==='rpc'&&c.name==='gridex_actor_has_company_permission'&&c.args.p_permission==='communication.read')).toHaveLength(2)
 expect(io.calls.filter(c=>c.kind==='rpc'&&c.name==='gridex_actor_has_company_permission'&&c.args.p_permission==='metering.write')).toHaveLength(0)
})

for(const copy of ['spread','structuredClone'] as const)it(`${copy} of a genuine private context is not authority`,async()=>{
 const {row,context}=await loaded(),copied=copy==='spread'?{...context}:structuredClone(context)
 expect(ownFact(row,copied)).toBeNull()
 expect(ownFact(row,context)?.[0]?.meterReadingsSentInUtilts).toBe(true)
})
it('one context is consumed once, while repeated genuine reads can issue another context',async()=>{
 const {row,context}=await loaded()
 expect(ownFact(row,context)?.[0]?.meterReadingsSentInUtilts).toBe(true)
 expect(ownFact(row,context)).toBeNull()
 const next=await loadProdatOwnSourceReadingContext(row,actor)
 expect(next).not.toBeNull();expect(next).not.toBe(context)
 expect(ownFact(row,next!)?.[0]?.meterReadingsSentInUtilts).toBe(true)
})
it('a different actor cannot redeem the genuine context',async()=>{
 const {row,context}=await loaded()
 expect(ownFact(row,context,id(9))).toBeNull()
})

const changedSources=[
 {name:'source identity',change:{id:id(9)}},{name:'company',change:{company_id:id(9)}},
 {name:'environment',change:{environment:'production'}},{name:'raw hash',change:{raw_payload:'HOSTILE'}},
 {name:'receipt microsecond',change:{message_received_at:'2026-10-01T12:01:00.123457Z'}},
] as const
for(const {name,change} of changedSources)it(`${name} mismatch cannot redeem a genuine context`,async()=>{
 const {row,context}=await loaded(),altered={...row,...change} as EdielMessageRow
 const selected=policy(row)
 expect(sourceProdatOwnRegisterReadingDeclarations({message:altered,actorUserId:actor,context,policy:selected})).toBeNull()
})

const readMismatchCases=['stored raw','born hash','mail raw','parse raw','parse status','mail receipt microsecond','legal receipt microsecond','legal reason','legal edition missing','reception hash','reception absent'] as const
for(const name of readMismatchCases)it(`actual ${name} mismatch cannot issue a source context`,async()=>{
 const f=fixture();install(f.row,f.variant)
 if(name==='stored raw')io.rows.ediel_messages[0].raw_payload='HOSTILE'
 if(name==='born hash')(io.rows.ediel_messages[0].execution_context_snapshot as {receivedProdatContext:{payloadHash:string}}).receivedProdatContext.payloadHash='d'.repeat(64)
 if(name==='mail raw')io.rows.inbound_email_messages[0].raw_edifact_payload='HOSTILE'
 if(name==='parse raw')io.rows.inbound_ediel_parse_results[0].raw_payload='HOSTILE'
 if(name==='parse status')io.rows.inbound_ediel_parse_results[0].parse_status='failed'
 if(name==='mail receipt microsecond')io.rows.inbound_email_messages[0].received_at='2026-10-01T12:01:00.123457Z'
 if(name==='legal receipt microsecond')io.legal.sourceReceivedAt='2026-10-01T12:01:00.123457Z'
 if(name==='legal reason')(io.legal.canonicalProjection as Record<string,unknown>).transactionReasonCode='Z23'
 if(name==='legal edition missing')delete io.legal.sourceEdition
 if(name==='reception hash'){io.reception.canonicalPayloadHash='d'.repeat(64);io.reception.receivedPayloadHash='d'.repeat(64)}
 if(name==='reception absent')io.reception={}
 expect(await loadProdatOwnSourceReadingContext(f.row,actor)).toBeNull()
})

it('actor permission loss before issuance remains a security error',async()=>{
 const f=fixture();install(f.row,f.variant);io.revokeAfter=1
 await expect(loadProdatOwnSourceReadingContext(f.row,actor)).rejects.toMatchObject({disposition:{kind:'security_quarantine'}})
})
it('missing communication.read remains a security error',async()=>{
 const f=fixture();install(f.row,f.variant);io.permissions.delete('communication.read')
 await expect(loadProdatOwnSourceReadingContext(f.row,actor)).rejects.toMatchObject({disposition:{kind:'security_quarantine'}})
})
it('communication.read-authorized actor can declare TRUE with metering.write denied',async()=>{
 const f=fixture();install(f.row,f.variant);io.permissions.delete('metering.write')
 const context=await loadProdatOwnSourceReadingContext(f.row,actor)
 expect(context).not.toBeNull()
 expect(ownFact(f.row,context!)?.[0]?.meterReadingsSentInUtilts).toBe(true)
 expect(io.calls.filter(c=>c.kind==='rpc'&&c.name==='gridex_actor_has_company_permission'&&c.args.p_permission==='metering.write')).toHaveLength(0)
})

for(const clock of ['created_at','born capturedAt','legal observedAt'] as const)it(`${clock} before original receipt does not erase a valid source declaration`,async()=>{
 const f=fixture(),earlier='2026-10-01T12:00:00.123456Z'
 const row=structuredClone(f.row)
 if(clock==='created_at')row.created_at=earlier
 if(clock==='born capturedAt')(row.execution_context_snapshot as {receivedProdatContext:{capturedAt:string}}).receivedProdatContext.capturedAt=earlier
 // Install the same source identity on both caller and actual stored READ;
 // source/mail/reception/birth sourceReceivedAt remain the original .123456Z.
 install(row,f.variant)
 if(clock==='legal observedAt')io.legal.observedAt=earlier
 expect(validateEdifactSyntax(row).ok).toBe(true)
 const context=await loadProdatOwnSourceReadingContext(row,actor)
 expect(context).not.toBeNull()
 expect(ownFact(row,context!)?.[0]?.meterReadingsSentInUtilts).toBe(true)
})

it('explicit admission microsecond mismatch is refused by the real consumer',async()=>{
 const {row,context}=await loaded(),selected=policy(row)
 expect(()=>sourceProdatOwnRegisterReadingDeclarations({message:row,actorUserId:actor,context,policy:selected,
  admissionAt:'2026-10-01T12:01:00.123457Z'})).toThrow('prodat_source_readings_admission_clock_mismatch')
})
for(const mismatch of ['guide','fieldRules','referenceDate','association'] as const)it(`actual compiled policy ${mismatch} mismatch is refused by the real consumer`,async()=>{
 const {row,context}=await loaded(),selected=policy(row)
 // A hostile alteration of a genuinely selected policy is a refusal input,
 // not a way to construct private context or claim new policy authority.
 const altered={...selected,
  ...(mismatch==='guide'?{guide:{...selected.guide,guideRevision:'25-A'}}:{}),
  ...(mismatch==='fieldRules'?{fieldRules:selected.fieldRules.filter(rule=>!('fieldNumber' in rule)||rule.fieldNumber!=='259')}:{}),
  ...(mismatch==='referenceDate'?{referenceDate:'2026-10-02'}:{}),
  ...(mismatch==='association'?{associationAssignedCode:'E2SE5A'}:{}),
 }
 expect(()=>sourceProdatOwnRegisterReadingDeclarations({message:row,actorUserId:actor,context,policy:altered}))
  .toThrow('prodat_own_source_readings_policy_unqualified')
})
for(const table of ['ediel_messages','inbound_email_messages','inbound_ediel_parse_results'])it(`${table} schema failure remains an error`,async()=>{
 const f=fixture();install(f.row,f.variant);const error={message:'DECLARED_SCHEMA_FAILURE',code:'42P01'};io.tableErrors[table]=error
 await expect(loadProdatOwnSourceReadingContext(f.row,actor)).rejects.toBe(error)
})
it('legal context RPC failure remains a failure, not an unknown-green fallback',async()=>{
 const f=fixture();install(f.row,f.variant);io.rpcErrors.ediel_require_inbound_legal_context_v1={message:'DECLARED_SCHEMA_FAILURE',code:'42P01'}
 await expect(loadProdatOwnSourceReadingContext(f.row,actor)).rejects.toThrow('ediel_inbound_legal_context_required')
})
it('reception RPC failure remains an error',async()=>{
 const f=fixture();install(f.row,f.variant);const error={message:'DECLARED_SCHEMA_FAILURE',code:'42P01'};io.rpcErrors.ediel_inbound_reception_request_v1=error
 await expect(loadProdatOwnSourceReadingContext(f.row,actor)).rejects.toBe(error)
})

// READ alternatives execute both real issuer guards with declared SDK replies.
// Native reception SQL/catalog and business authority remain separate gates.
const expectReadPermissions=(row:EdielMessageRow,batches:number)=>{
 const permissionCalls=io.calls.filter(c=>c.kind==='rpc'&&c.name==='gridex_actor_has_company_permission')
 expect(permissionCalls).toEqual(Array.from({length:batches},()=>['communication.read','ediel.read'].map(p_permission=>({
  kind:'rpc',name:'gridex_actor_has_company_permission',args:{p_actor_user_id:actor,p_company_id:row.company_id,p_permission},
 }))).flat())
}
for(const variant of ['L','LK'] as const){
 it(`${variant}: ediel.read alone declares physical TRUE once without a metering write grant`,async()=>{
  const f=fixture({variant});install(f.row,variant);io.permissions=new Set(['ediel.read'])
  const context=await loadProdatOwnSourceReadingContext(f.row,actor)
  expect(context).not.toBeNull();expectReadPermissions(f.row,2)
  expect(ownFact(f.row,context!)).toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:true}])
  expect(ownFact(f.row,context!)).toBeNull()
  expect(io.permissions.has('metering.write')).toBe(false)
 })
 it(`${variant}: communication.read alone still performs both current READ alternatives`,async()=>{
  const f=fixture({variant});install(f.row,variant);io.permissions=new Set(['communication.read'])
  const context=await loadProdatOwnSourceReadingContext(f.row,actor)
  expect(context).not.toBeNull();expectReadPermissions(f.row,2)
  expect(ownFact(f.row,context!)).toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:true}])
 })
 it(`${variant}: neither READ permission quarantines before the source or legal/reception reads`,async()=>{
  const f=fixture({variant});install(f.row,variant);io.permissions=new Set(['metering.write'])
  await expect(loadProdatOwnSourceReadingContext(f.row,actor)).rejects.toMatchObject({disposition:{kind:'security_quarantine',code:'EDIEL_TENANT_PERMISSION_FORBIDDEN'}})
  expectReadPermissions(f.row,1)
  expect(io.calls.filter(c=>c.kind==='table').map(c=>c.name).sort()).toEqual(['company_memberships','user_profiles'])
  expect(io.calls.filter(c=>c.kind==='rpc').map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','gridex_actor_has_company_permission'])
 })
 it(`${variant}: a nonwinning ediel.read RPC error remains the exact failure beside communication.read`,async()=>{
  const f=fixture({variant});install(f.row,variant);io.permissions=new Set(['communication.read'])
  const failure={code:'READ_RPC_UNAVAILABLE',message:'Declared READ transport failure'}
  const original=io.rpc.getMockImplementation()!
  io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
   if(name==='gridex_actor_has_company_permission'&&args.p_permission==='ediel.read'){
    io.calls.push({kind:'rpc',name,args:{...args}})
    return {data:null,error:failure}
   }
   return original(name,args)
  })
  await expect(loadProdatOwnSourceReadingContext(f.row,actor)).rejects.toBe(failure)
  expectReadPermissions(f.row,1)
  expect(io.calls.filter(c=>c.kind==='table').map(c=>c.name).sort()).toEqual(['company_memberships','user_profiles'])
 })
 it(`${variant}: losing the only ediel.read grant before issuance quarantines the second READ`,async()=>{
  const f=fixture({variant});install(f.row,variant);io.permissions=new Set(['ediel.read']);io.revokeAfter=2
  await expect(loadProdatOwnSourceReadingContext(f.row,actor)).rejects.toMatchObject({disposition:{kind:'security_quarantine',code:'EDIEL_TENANT_PERMISSION_FORBIDDEN'}})
  expectReadPermissions(f.row,2)
  expect(io.calls).toContainEqual({kind:'table',name:'inbound_ediel_parse_results',args:{id:id(5),company_id:f.row.company_id}})
  expect(io.permissionChecks).toBe(4)
 })
 it(`${variant}: ediel.read with an absent physical259 leaves all three conditions UNKNOWN`,async()=>{
  const f=fixture({variant,declaration:'missing'});install(f.row,variant);io.permissions=new Set(['ediel.read'])
  const context=await loadProdatOwnSourceReadingContext(f.row,actor)
  expect(context).not.toBeNull();expectReadPermissions(f.row,2)
  const selected=policy(f.row,context!)
  expect(selected.prodatDependentFacts?.registerObjects).toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:null}])
  const conditions=selected.prodatDependentConditions.filter(c=>fields.includes(c.fieldNumber as typeof fields[number]))
  expect(conditions).toHaveLength(3);expect(conditions.every(c=>c.status==='undetermined')).toBe(true)
  const canonical=parseCanonicalMessageRow(f.row)
  const issues=validateCanonicalPolicyFields({policy:selected,rawPayload:f.row.raw_payload,rawSegments:canonical.rawSegments,una:canonical.una,scope:'dependent_only'})
  expect(issues.filter(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED'&&['CCI++Z02/CAV','CCI++Z05/CAV','CCI++Z16/CAV'].includes(i.fieldPath??''))).toHaveLength(3)
  expect(ownFact(f.row,context!)).toBeNull()
 })
}

// Returning UNKNOWN after an unauthorized query is insufficient. The first
// real actor guard authorizes A, so no async caller mutation can steer a B READ.
for(const variant of ['L','LK'] as const)it(`${variant}: authorization await cannot redirect the source read to another company`,async()=>{
 const f=fixture({variant});install(f.row,variant)
 const originalRow=structuredClone(f.row),other=structuredClone(f.row)
 other.id=id(91);other.company_id=id(92)
 const birth=(other.execution_context_snapshot as {receivedProdatContext:{sourceMessageId:string;companyId:string}}).receivedProdatContext
 birth.sourceMessageId=other.id;birth.companyId=other.company_id!
 io.rows.ediel_messages.push(other as unknown as Record<string,unknown>)
 const rpc=io.rpc.getMockImplementation()!
 let changed=false
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  const result=await rpc(name,args)
  if(!changed&&name==='gridex_actor_has_company_permission'){
   changed=true;Object.assign(f.row,structuredClone(other))
  }
  return result
 })
 const context=await loadProdatOwnSourceReadingContext(f.row,actor)
 expect(changed).toBe(true)
 const sourceReads=io.calls.filter(c=>c.kind==='table'&&c.name==='ediel_messages')
 expect(sourceReads.some(c=>c.args.company_id===other.company_id||c.args.id===other.id)).toBe(false)
 expect(sourceReads).toEqual([{kind:'table',name:'ediel_messages',args:{id:originalRow.id,company_id:originalRow.company_id}}])
 expect(io.calls.filter(c=>c.kind==='rpc').every(c=>c.args.p_company_id===originalRow.company_id)).toBe(true)
 // Issuance can still use the authenticated original, never the caller's B row.
 expect(context).not.toBeNull()
 expect(ownFact(f.row,context!)).toBeNull()
 expect(ownFact(originalRow,context!)).toBeNull()
 const next=await loadProdatOwnSourceReadingContext(originalRow,actor)
 expect(next).not.toBeNull()
 expect(ownFact(originalRow,next!)).toEqual([{meteringPointId:point,identityAgency:'9',meterReadingsSentInUtilts:true}])
})
