// Source/projection component contract only. SDK transport responses below are
// synthetic; no native RBAC, immutable PostgreSQL custody, admission or effects.
// The loader/redeemer and existing DB/auth/legal/reception functions are NEVER
// mocked. Original26 oracles remain; review regressions use declared SDK IO.
// Overlay runs frozen old production for RED, then the repaired candidate for GREEN.
import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import type {CanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {loadProdatZ10OwnSourceReadingContext,sourceProdatZ10OwnRegisterReadingDeclarations,
 type ProdatZ10OwnSourceReadingContext} from '@/lib/ediel/core/prodatZ10OwnSourceRegisterReadingDeclarations'
import {getEdielMessageById} from '@/lib/ediel/db'
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
import {requireEdielInboundLegalContext} from '@/lib/ediel/tenant/sourceLegalContext'
import {readInboundReceptionRequest} from '@/lib/ediel/inbound/receptions'
import {supabaseService} from '@/lib/supabase/service'
import {parseCanonicalMessageRow} from '@/lib/ediel/core/canonicalMessage'
import {validateEdifactSyntax} from '@/lib/ediel/core/syntaxValidator'
import {stockholmBusinessDate} from '@/lib/ediel/core/executionContext'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {prodatRegisterReadingState} from '@/lib/ediel/prodat/prodatRegisterReadings'
import {characteristic,line,raw,type Parts} from '@/__tests__/fixtures/prodat-register'

type Call={kind:'table'|'rpc';name:string;args:Record<string,unknown>}
type Row=Record<string,unknown>
const io=vi.hoisted(()=>({
 rpc:vi.fn(),from:vi.fn(),rows:{} as Record<string,Row[]>,legal:{} as Row,reception:{} as Row,
 calls:[] as Call[],permissions:new Set<string>(),tableErrors:{} as Record<string,unknown>,
 rpcErrors:{} as Record<string,unknown>,afterRead:undefined as undefined|((call:Call)=>void|Promise<void>),
}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const company=id(2),actor=id(3),mail=id(4),parse=id(5),source=id(1)
const point='735123456789012344',other='735123456789012351'
const received='2026-10-01T12:01:00.123456Z'
const sha=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex')
const truth=(p=point)=>({meteringPointId:p,identityAgency:'9' as const,meterReadingsSentInUtilts:true})
const unknown=(p=point)=>({...truth(p),meterReadingsSentInUtilts:null})
type Declaration='valid'|'missing-first'|'duplicate-first'|'wrong-component-first'|'header'|'nonlocal-first'
type Options={declaration?:Declaration;missing?:'214'|'218'|'later259';secondObject?:boolean;poison?:boolean}
function fixture(options:Options={}):EdielMessageRow{
 const kind=options.declaration??'valid'
 const readings=(register:number,first:boolean):Parts[]=>[
  ...(options.missing==='214'&&first?[]:characteristic('Z02','1',3)),
  ...(options.missing==='218'&&first?[]:characteristic('Z05','6',3)),
  ...(first&&(kind==='missing-first'||kind==='nonlocal-first')||!first&&options.missing==='later259'?[]:
   characteristic('Z16',String(register),first&&kind==='wrong-component-first'?0:3)),
  ...(first&&kind==='duplicate-first'?characteristic('Z16',String(register),3):[]),
 ]
 const object=(p:string,sequence:number,declared:boolean):Parts[]=>[
  line(String(sequence),p,'1','9'),['DTM',['157','202610270000','203']],['DTM',['354','15','806']],
  ...characteristic('Z13','E58'),...characteristic('Z04','Z04'),...characteristic('Z12','D',3),
  ...characteristic('Z15','Z32'),...characteristic('Z14','L639Q',3),
  ...(declared?readings(101,true):[...characteristic('Z02','1',3),...characteristic('Z05','6',3)]),
  ['RFF',['MG','NEW-METER']],['RFF',['Z02','OLD-METER']],['RFF',['Z05','TES']],['RFF',['LI','M-OWN-'+String(sequence)]],
  ...(declared&&kind==='nonlocal-first'?characteristic('Z16','101',3):[]),
  ['NAD','Z02',['99876','160','SVK']],
  line(String(sequence+1),p,'2','9'),...readings(102,false),
 ]
 const body:Parts[]=[
  ['NAD','FR',['54321','160','SVK']],['NAD','DO',['12345','160','SVK']],
  ...(kind==='header'?characteristic('Z16','101',3):[]),
  ...object(point,1,true),...(options.secondObject?object(other,3,false):[]),
 ]
 const wire=raw(body,'Z10').replace('+S+R+','+54321:14+12345:14+')
  .replace("+23-DDQ-PRODAT'","+23-DDQ-PRODAT++1++1'")
 const birth={version:1,contextOrigin:'database_insert',sourceMessageId:source,companyId:company,
  environment:'test',messageCode:'Z10',payloadHash:sha(wire),sourceReceivedAt:received,capturedAt:received}
 return {process_type:null,test_flag:1,transport_type:'smtp',mailbox:null,mailbox_message_id:null,
  sender_ediel_id:'54321',sender_name:null,sender_sub_address:null,receiver_ediel_id:'12345',
  receiver_name:null,receiver_sub_address:null,sender_email:null,receiver_email:null,subject:null,
  file_name:null,mime_type:null,interchange_reference:'I',external_reference:null,correlation_reference:null,
  transaction_reference:null,original_message_id:null,original_transaction_id:null,original_message_code:null,
  related_message_id:null,communication_route_id:null,outbound_request_id:null,switch_request_id:null,
  grid_owner_data_request_id:null,partner_export_id:null,customer_id:null,site_id:null,metering_point_id:null,
  grid_owner_id:null,requires_contrl:false,requires_aperak:false,contrl_status:null,aperak_status:null,
  utilts_err_status:null,ack_outcome:null,functional_check_status:null,message_sent_at:null,parsed_at:null,
  validated_at:null,acknowledged_at:null,failed_at:null,ack_due_at:null,updated_at:received,created_by:null,
  updated_by:null,id:source,company_id:company,environment:'test',direction:'inbound',message_standard:'edifact',
  message_family:'PRODAT',message_code:'Z10',message_version:'E2SE6A',application_reference:'23-DDQ-PRODAT',
  raw_payload:wire,inbound_email_message_id:mail,created_at:received,message_received_at:received,
  message_created_at:'2026-09-17T11:00:00Z',status:'received',syntax_check_status:'not_checked',failure_reason:null,
  execution_context_snapshot:{receivedProdatContext:birth},
  parsed_payload:options.poison===undefined?{}:{meterReadingsSentInUtilts:options.poison,
   prodatDependentFacts:{meterReadingsSentInUtilts:options.poison,
    byCell:{'Z10:214':options.poison,'Z10:218':options.poison,'Z10:259':options.poison}}},
  validation_report:options.poison===undefined?{}:{prodatDependentFacts:{meterReadingsSentInUtilts:options.poison}},
 }
}
function install(row:EdielMessageRow){
 io.rows={
  ediel_messages:[structuredClone(row) as unknown as Row],
  user_profiles:[{id:actor,user_status:'active'}],
  company_memberships:[{company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:received}],
  inbound_email_messages:[{id:mail,company_id:company,environment:'test',received_at:received,raw_edifact_payload:row.raw_payload}],
  inbound_ediel_parse_results:[{id:parse,company_id:company,inbound_email_message_id:mail,raw_payload:row.raw_payload,parse_status:'parsed'}],
 }
 io.legal={basisKind:'observed_source_persistence',companyId:company,environment:'test',direction:'inbound',
  family:'PRODAT',code:'Z10',subtype:'M',legalActorId:id(8),legalEdielId:'12345',actorRole:'electricity_supplier',
  transportActorId:id(9),transportEdielId:'12345',applicationReference:'23-DDQ-PRODAT',sourceEdition:'c'.repeat(64),
  canonicalProjection:{family:'PRODAT',code:'Z10',subtype:'M',transactionReasonCode:'E58',direction:'inbound',
   senderRoles:['grid_owner'],receiverRoles:['supplier'],applicationReferences:['23-DDQ-PRODAT']},
  observedAt:received,sourceReceivedAt:received}
 io.reception={companyId:company,sourceMessageId:source,inboundEmailMessageId:mail,parseResultId:parse,receptionId:id(6),
  classification:'first_reception',isReplay:true,receivedAt:received,canonicalPayloadHash:sha(row.raw_payload!),
  receivedPayloadHash:sha(row.raw_payload!),responseRequestId:null,status:'observed',reason:null,businessEffectAuthorized:false}
}
beforeEach(()=>{
 io.from.mockReset();io.rpc.mockReset();io.rows={};io.calls=[];io.permissions=new Set(['communication.read'])
 io.tableErrors={};io.rpcErrors={};io.afterRead=undefined
 io.from.mockImplementation((name:string)=>{
  if(!Object.hasOwn(io.rows,name))throw Error('UNEXPECTED_COMPONENT_TABLE:'+name)
  const filters:Record<string,unknown>={},notNull:string[]=[]
  const read=async()=>{
   const matches=io.rows[name].filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v)&&notNull.every(k=>r[k]!=null))
   const data=matches.length===1?structuredClone(matches[0]):null
   const call:Call={kind:'table',name,args:{...filters}};io.calls.push(call);await io.afterRead?.(call)
   return {data,error:io.tableErrors[name]??null}
  }
  const q={select:(_columns:string)=>q,eq:(key:string,value:unknown)=>{filters[key]=value;return q},
   not:(key:string,op:string,value:unknown)=>{if(op!=='is'||value!==null)throw Error('UNEXPECTED_COMPONENT_NOT');notNull.push(key);return q},
   maybeSingle:read,single:read}
  return q
 })
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  const call:Call={kind:'rpc',name,args:{...args}};io.calls.push(call)
  let data:unknown
  if(name==='gridex_actor_has_company_permission')data=args.p_company_id===company&&args.p_actor_user_id===actor&&io.permissions.has(String(args.p_permission))
  else if(name==='ediel_require_inbound_legal_context_v1')data=args.p_company_id===company&&args.p_message_id===source?structuredClone(io.legal):null
  else if(name==='ediel_inbound_reception_request_v1')data=args.p_company_id===company&&args.p_message_id===source&&args.p_actor_user_id===actor&&args.p_inbound_email_message_id===mail?structuredClone(io.reception):null
  else throw Error('UNEXPECTED_COMPONENT_RPC:'+name)
  await io.afterRead?.(call)
  return {data,error:io.rpcErrors[name]??null}
 })
})
function policy(row:EdielMessageRow,registerObjects?:ReturnType<typeof sourceProdatZ10OwnRegisterReadingDeclarations>){
 const canonical=parseCanonicalMessageRow(row)
 return resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z10',subtypeOrReasonCode:canonical.subtype,
  direction:'inbound',referenceDate:stockholmBusinessDate(new Date(row.message_received_at!)),
  associationAssignedCode:canonical.version,applicationReference:canonical.applicationReference,mode:'parse',
  ...(registerObjects?{prodatDependentFacts:{market:'electricity',registerObjects}}:{})})
}
function redeem(row:EdielMessageRow,context?:ProdatZ10OwnSourceReadingContext|null,selected=policy(row),who=actor,admissionAt?:string){
 return sourceProdatZ10OwnRegisterReadingDeclarations({message:row,actorUserId:who,context,policy:selected,admissionAt})
}
async function loaded(options:Options={}){
 const row=fixture(options);install(row)
 expect(validateEdifactSyntax(row)).toMatchObject({ok:true,grammarQualification:'qualified'})
 const context=await loadProdatZ10OwnSourceReadingContext(row,actor)
 return {row,context}
}
function findings(row:EdielMessageRow,facts:NonNullable<ReturnType<typeof redeem>>){
 const canonical=parseCanonicalMessageRow(row)
 return validateCanonicalPolicyFields({policy:policy(row,facts),rawPayload:row.raw_payload,
  rawSegments:canonical.rawSegments,una:canonical.una,scope:'dependent_only'})
}

it('CONTROL actual SDK wrappers and independent original wire are internally coherent',async()=>{
 const row=fixture();install(row)
 expect(validateEdifactSyntax(row)).toMatchObject({ok:true,grammarQualification:'qualified'})
 expect(parseCanonicalMessageRow(row)).toMatchObject({family:'PRODAT',messageCode:'Z10',subtype:'E58',version:'E2SE6A'})
 await assertEdielTenantActor({companyId:company,actorUserId:actor,permission:'communication.read'})
 expect(await getEdielMessageById(source,{companyId:company})).toEqual(row)
 expect(await requireEdielInboundLegalContext(company,source)).toMatchObject({companyId:company,actorRole:'electricity_supplier'})
 expect(await readInboundReceptionRequest({companyId:company,messageId:source,inboundEmailMessageId:mail,actorUserId:actor})).toMatchObject({classification:'first_reception',businessEffectAuthorized:false})
 const rawMail=await supabaseService.from('inbound_email_messages').select('*').eq('id',mail).eq('company_id',company).eq('environment','test').maybeSingle()
 const parsed=await supabaseService.from('inbound_ediel_parse_results').select('*').eq('id',parse).eq('company_id',company).maybeSingle()
 expect(rawMail.data?.raw_edifact_payload).toBe(row.raw_payload);expect(parsed.data?.raw_payload).toBe(row.raw_payload)
 const w=tokenizeEdifact(row.raw_payload!);const g=prodatRegisterGroups(w.segments,w.una,'Z10')
 expect(g.groups).toHaveLength(2)
 for(const group of g.groups)for(const field of ['214','218','259'])expect(prodatRegisterReadingState(field,group.segments,w.una)).toMatchObject({present:true,malformed:false})
 expect(policy(row).guide).toMatchObject({guideRevision:'26-A',associationAssignedCode:'E2SE6A',fieldMatrixStatus:'certified'})
 expect(findings(row,[truth()]).filter(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toEqual([])
})
it('genuine READ factory declares own physically supplied two-register M readings TRUE',async()=>{
 const {row,context}=await loaded({poison:false})
 expect(redeem(row,context,policy(row),actor,received)).toEqual([truth()])
 expect(io.calls.filter(c=>c.kind==='table'&&c.name==='ediel_messages')).toHaveLength(2)
 expect(io.calls.filter(c=>c.name==='gridex_actor_has_company_permission')).toHaveLength(2)
 for(const c of io.calls.filter(c=>c.kind==='table'&&['ediel_messages','inbound_email_messages','inbound_ediel_parse_results'].includes(c.name)))expect(c.args.company_id).toBe(company)
})
it('no context/default cannot use caller TRUE or FALSE/byCell/report as authority',()=>{
 for(const poison of [true,false])expect(redeem(fixture({poison}))).toBeNull()
})
it.each(['214','218'] as const)('valid own259 keeps TRUE and real validator identifies missing%s',async missing=>{
 const {row,context}=await loaded({missing})
 const facts=redeem(row,context);expect(facts).toEqual([truth()])
 const issues=findings(row,facts!)
 expect(issues.some(i=>i.blocking&&i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber===missing)).toBe(true)
 expect(issues.some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(false)
})
it('first valid259 stays TRUE while later register missing259 gets the real required-field refusal',async()=>{
 const {row,context}=await loaded({missing:'later259'});const facts=redeem(row,context)
 expect(facts).toEqual([truth()])
 const issues=findings(row,facts!)
 expect(issues.some(i=>i.blocking&&i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber==='259')).toBe(true)
 expect(issues.some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(false)
})
it.each(['missing-first','duplicate-first','wrong-component-first','header'] as const)(
 '%s own259 remains UNKNOWN; later supplied259 cannot fill it',async declaration=>{
  const {row,context}=await loaded({declaration,poison:true})
  expect(redeem(row,context)).toEqual([unknown()])
 })
it('nonlocal259 after RFF is an actual grammar refusal and cannot mint authority',async()=>{
 const row=fixture({declaration:'nonlocal-first'});install(row)
 expect(validateEdifactSyntax(row)).toMatchObject({ok:false,grammarQualification:'qualified'})
 const wire=tokenizeEdifact(row.raw_payload!),group=prodatRegisterGroups(wire.segments,wire.una,'Z10').groups[0]
 expect(prodatRegisterReadingState('259',group.segments,wire.una)).toMatchObject({present:true,malformed:true})
 expect(await loadProdatZ10OwnSourceReadingContext(row,actor)).toBeNull()
})
it('CONTROL real dependent validator preserves default UNKNOWN and typed missing214/218/later259',()=>{
 const normal=fixture(),c=parseCanonicalMessageRow(normal)
 const defaults=validateCanonicalPolicyFields({policy:policy(normal),rawPayload:normal.raw_payload,rawSegments:c.rawSegments,una:c.una,scope:'dependent_only'})
 expect(defaults.filter(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toHaveLength(6)
 for(const missing of ['214','218','later259'] as const){
  const row=fixture({missing}),field=missing==='later259'?'259':missing
  expect(validateEdifactSyntax(row)).toMatchObject({ok:true,grammarQualification:'qualified'})
  const issues=findings(row,[truth()]) // Independent validator oracle, not source qualification.
  expect(issues.some(i=>i.blocking&&i.prodatDiagnostic?.kind==='field'&&i.prodatDiagnostic.fieldNumber===field)).toBe(true)
  expect(issues.some(i=>i.code==='PRODAT_DEPENDENT_CONDITION_UNDETERMINED')).toBe(false)
 }
})
it('another own object does not borrow first object TRUE or wire register inventory',async()=>{
 const {row,context}=await loaded({secondObject:true})
 expect(redeem(row,context)).toEqual([truth(),unknown(other)])
})
it('copy/clone cannot redeem a private token; genuine original token still works',async()=>{
 const {row,context}=await loaded();expect(context).not.toBeNull()
 expect(redeem(row,{...context!})).toBeNull()
 expect(redeem(row,structuredClone(context!))).toBeNull()
 expect(redeem(row,context)).toEqual([truth()])
})
it('wrong actor exhausts a genuine token even though failed redemption returns null',async()=>{
 const {row,context}=await loaded();expect(context).not.toBeNull()
 expect(redeem(row,context,policy(row),id(11))).toBeNull()
 expect(redeem(row,context)).toBeNull()
})
it('genuine redemption is single-use and a new genuine READ can mint another token',async()=>{
 const {row,context}=await loaded()
 expect(redeem(row,context)).toEqual([truth()]);expect(redeem(row,context)).toBeNull()
 const next=await loadProdatZ10OwnSourceReadingContext(row,actor)
 expect(redeem(row,next)).toEqual([truth()])
})
it('source mismatch consumes token; restoring the original cannot repair redemption',async()=>{
 const {row,context}=await loaded();expect(context).not.toBeNull()
 expect(redeem({...row,raw_payload:row.raw_payload!.replace('NEW-METER','OTHER-METER')},context)).toBeNull()
 expect(redeem(row,context)).toBeNull()
})
it('compiled guide/rule/policy forgery cannot select semantics and exhausts the token',async()=>{
 const row=fixture();install(row)
 const selected=policy(row)
 const forged:CanonicalEdielPolicy[]=[
  {...selected,applicationReference:'23-DGI-PRODAT'},
  {...selected,referenceDate:'2026-10-02'},
  {...selected,transactionReasonCode:'Z25'},
  {...selected,direction:'outbound'},
  {...selected,guide:{...selected.guide,associationAssignedCode:'E2SE6B'}},
  {...selected,fieldRules:selected.fieldRules.filter(r=>!('fieldNumber'in r)||r.fieldNumber!=='259')},
 ]
 for(const candidate of forged){
  const context=await loadProdatZ10OwnSourceReadingContext(row,actor);expect(context).not.toBeNull()
  expect(()=>redeem(row,context,candidate)).toThrow('prodat_z10_own_source_readings_policy_unqualified')
  expect(redeem(row,context)).toBeNull()
 }
})
it('microsecond admission mismatch cannot replace receipt time and exhausts the context',async()=>{
 const {row,context}=await loaded();expect(context).not.toBeNull()
 expect(()=>redeem(row,context,policy(row),actor,'2026-10-01T12:01:00.123457Z')).toThrow('prodat_source_readings_admission_clock_mismatch')
 expect(redeem(row,context)).toBeNull()
})
it('wrong input company/env/function/version/application/clock/birth cannot acquire declaration authority',async()=>{
 for(const change of [{company_id:id(12)},{environment:'production' as const},{direction:'outbound' as const},{message_code:'Z04'},{message_version:'E2SE6B'},
  {application_reference:'23-DGI-PRODAT'},{message_received_at:'2026-10-01T12:01:00.123457Z'},
  {execution_context_snapshot:{receivedProdatContext:{...(fixture().execution_context_snapshot as {receivedProdatContext:Row}).receivedProdatContext,extra:true}}}]){
  const row=fixture();install(row)
  expect(await loadProdatZ10OwnSourceReadingContext({...row,...change},actor)).toBeNull()
 }
})
it('stored source/legal/reception/mail/parse mismatches cannot mint context',async()=>{
 const changes:((row:EdielMessageRow)=>void)[]=[
  ()=>{io.rows.ediel_messages[0].raw_payload=String(io.rows.ediel_messages[0].raw_payload)+' ';},
  ()=>{io.legal.actorRole='grid_owner';},
  ()=>{io.legal.sourceEdition='not-an-edition';},
  ()=>{io.legal.sourceReceivedAt='2026-10-01T12:01:00.123457Z';},
  ()=>{(io.legal.canonicalProjection as Row).transactionReasonCode='Z25';},
  ()=>{io.reception.canonicalPayloadHash='d'.repeat(64);io.reception.receivedPayloadHash='d'.repeat(64);},
  ()=>{io.rows.inbound_email_messages[0].received_at='2026-10-01T12:01:00.123457Z';},
  ()=>{io.rows.inbound_ediel_parse_results[0].inbound_email_message_id=id(13);},
 ]
 for(const change of changes){const row=fixture();install(row);change(row);expect(await loadProdatZ10OwnSourceReadingContext(row,actor)).toBeNull()}
})
it('READ permission cannot be substituted by metering.write or communication.write',async()=>{
 const row=fixture();install(row);io.permissions=new Set(['metering.write','communication.write'])
 await expect(loadProdatZ10OwnSourceReadingContext(row,actor)).rejects.toThrow('ediel_tenant_permission_forbidden')
})
it('actual permission revocation during an awaited legal READ is observed before mint',async()=>{
 const row=fixture();install(row)
 io.afterRead=call=>{if(call.name==='ediel_require_inbound_legal_context_v1')io.permissions.clear()}
 await expect(loadProdatZ10OwnSourceReadingContext(row,actor)).rejects.toThrow('ediel_tenant_permission_forbidden')
})
it('SDK legal-read failure is propagated, not converted to unknown success',async()=>{
 const row=fixture();install(row);io.rpcErrors.ediel_require_inbound_legal_context_v1={code:'UNIT_IO_FAILURE',message:'declared unit IO failure'}
 await expect(loadProdatZ10OwnSourceReadingContext(row,actor)).rejects.toThrow('ediel_inbound_legal_context_required')
})
it('stored source changing across awaited READs is caught by the final scoped source re-read',async()=>{
 const row=fixture();install(row);let changed=false
 io.afterRead=call=>{if(call.name==='ediel_require_inbound_legal_context_v1'){
  io.rows.ediel_messages[0].raw_payload=String(row.raw_payload).replace('NEW-METER','CHANGED-METER');changed=true
 }}
 expect(await loadProdatZ10OwnSourceReadingContext(row,actor)).toBeNull()
 expect(changed).toBe(true)
 expect(io.calls.filter(c=>c.name==='ediel_messages')).toHaveLength(2)
})
it('primitive input identity is copied before awaits; mutable caller cannot switch the stored selector',async()=>{
 const row=fixture();const original=structuredClone(row);install(row)
 io.afterRead=call=>{if(call.name==='gridex_actor_has_company_permission')row.company_id=id(14)}
 const context=await loadProdatZ10OwnSourceReadingContext(row,actor)
 expect(redeem(original,context)).toEqual([truth()])
 for(const call of io.calls.filter(c=>c.name==='ediel_messages'))expect(call.args.company_id).toBe(company)
})

it('REVIEW SDK read errors preserve identity across each declared table boundary',async()=>{
 for(const name of ['ediel_messages','company_memberships','user_profiles','inbound_email_messages','inbound_ediel_parse_results']){
  const row=fixture();install(row);const error=Error('independent_'+name);io.tableErrors={[name]:error}
  await expect(loadProdatZ10OwnSourceReadingContext(row,actor)).rejects.toBe(error)
 }
})
it('REVIEW legal nested projection does not retain aliases across later READs',async()=>{
 const row=fixture();install(row)
 const originalRpc=io.rpc.getMockImplementation()!;let legalReturned:Row|undefined
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  const result=await originalRpc(name,args)
  if(name==='ediel_require_inbound_legal_context_v1')legalReturned=result.data as Row
  if(name==='ediel_inbound_reception_request_v1'){
   const projection=legalReturned!.canonicalProjection as Row
   ;(projection.applicationReferences as string[])[0]='wrong'
   ;(projection.receiverRoles as string[])[0]='wrong'
  }
  return result
 })
 const context=await loadProdatZ10OwnSourceReadingContext(row,actor)
 expect(redeem(row,context)).toEqual([truth()])
})
it('REVIEW invalid mail response cannot be repaired while parallel parse READ is pending',async()=>{
 const row=fixture();install(row)
 const originalFrom=io.from.getMockImplementation()!;let mailResponse:{data:Row,error:unknown}|undefined
 let notify!:()=>void;const mailReady=new Promise<void>(resolve=>{notify=resolve})
 io.from.mockImplementation((name:string)=>{
  const q=originalFrom(name);const originalRead=q.maybeSingle
  if(name==='inbound_email_messages')q.maybeSingle=async()=>{
   const result=await originalRead();mailResponse=result as {data:Row,error:unknown}
   mailResponse.data.received_at='2026-10-01T12:01:00.123457Z';notify();return result
  }
  if(name==='inbound_ediel_parse_results')q.maybeSingle=async()=>{
   await mailReady;await new Promise(resolve=>setTimeout(resolve,0))
   mailResponse!.data.received_at=received
   return originalRead()
  }
  return q
 })
 const context=await loadProdatZ10OwnSourceReadingContext(row,actor)
 const facts=redeem(row,context)
 expect(facts).toBeNull()
})
it('REVIEW fixed admission error also covers invalid Date and burns token',async()=>{
 const {row,context}=await loaded()
 let failure:unknown
 try{sourceProdatZ10OwnRegisterReadingDeclarations({message:row,actorUserId:actor,context,policy:policy(row),admissionAt:new Date(NaN)})}catch(error){failure=error}
 expect(redeem(row,context)).toBeNull()
 expect(failure).toMatchObject({message:'prodat_source_readings_admission_clock_mismatch'})
})
