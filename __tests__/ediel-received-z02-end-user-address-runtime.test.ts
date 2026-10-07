// Component integration only. Readonly RPC/catalog rows are finite ports;
// parser, policy, field diagnostics, rulebook and canonical runtime stay real.
import {createHash} from 'node:crypto'
import {beforeEach,expect,it,vi} from 'vitest'
import {source} from './fixtures/prodat-identity'
import {line,characteristic,raw,type Parts} from './fixtures/prodat-register'
import {ownerRulePack} from './helpers/sourceOwnerFixtures'
import {externalZ02Reply,type Z02OmittableField} from '../scripts/helpers/ediel-z02-supplier-native-wire'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {escapeEdifactData} from '@/lib/ediel/core/una'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {validateRulebookMessageWithRegistry} from '@/lib/ediel/rulebook/validator'
import {resolveCanonicalRuntimeDecisionWithRegistry} from '@/lib/ediel/core/runtimeDecision'
import {fetchReceivedZ02EndUserAddressContext,type ReceivedZ02EndUserAddressContext} from '@/lib/ediel/prodat/receivedZ02EndUserAddressContext'
const io=vi.hoisted(()=>({rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const point='735999000000000001',user='199001011234',li='OWN:+?'
function fixture(omitFields:readonly Z02OmittableField[]=[],originalAddress:readonly string[]=['Original street']){
 const body:Parts[]=[['NAD','FR',['12345','160','SVK'],'','','','','','','SE'],['NAD','DO',['54321','160','SVK'],'','','','','','','SE'],
 line('1',point,undefined,'9'),['DTM',['92','202611010000','203']],...characteristic('Z13','Z22'),['RFF',['Z05','NET']],['RFF',['LI',li]],
 ['NAD','UD',[user,'SE2','260'],'','Synthetic',originalAddress,'Town','','12345','SE']]
 const segments=tokenizeEdifact(raw(body,'Z01')).segments.filter(s=>!['UNB','UNH','UNT','UNZ'].includes(s.tag)).map(s=>s.raw)
 const originalRaw=EdifactEnvelopeCodec.encode({sender:'12345',receiver:'54321',senderQualifier:'14',receiverQualifier:'14',interchangeReference:'ORIGINAL',applicationReference:'23-DDQ-PRODAT',environment:'test',acknowledgementRequest:false,createdAt:new Date('2026-10-06T12:00:00Z'),messages:[{messageReference:'ORIGINAL-M',messageTypeToken:'PRODAT:D:97A:UN:E2SE6A',businessSegments:segments}]})
 const reply=externalZ02Reply({source:{rawPayload:originalRaw},interchangeReference:'REPLY',messageReference:'REPLY-M',documentReference:'REPLY-D',documentMinute:'202610061203',createdAt:new Date('2026-10-06T12:03:00Z'),measurementMethod:'Z03',customerAddress:{street:'Changed street',city:'Town',postalCode:'12345',country:'SE'},installationAddress:{street:'Installation',city:'Town',postalCode:'12345',country:'SE'},omitFields})
 const message={...source(reply,'Z02'),id:id(1),company_id:id(2),customer_id:id(3),site_id:id(4),grid_owner_id:id(11),message_received_at:'2026-10-06T12:03:00Z',immutable_payload_hash:hash(reply)}
 const original={...message,id:id(5),direction:'outbound',message_code:'Z01',raw_payload:originalRaw,immutable_payload_hash:hash(originalRaw),immutable_rendered_at:'2026-10-06T12:00:00Z'}
 const object={objectId:point,identityAgency:'9',lineReference:li,reason:'Z22',customerId:user,customerQualifier:'SE2',customerAgency:'260'}
 const proof={status:'z02_address_source_basis',version:1,companyId:id(2),environment:'test',sourceMessageId:id(1),sourcePayloadHash:hash(reply),sourceReceivedAt:message.message_received_at,sourceRawPayload:reply,sourceMessage:message,
 originalMessageId:id(5),originalPayloadHash:hash(originalRaw),originalRenderedAt:original.immutable_rendered_at,originalRawPayload:originalRaw,originalMessage:original,sourceObject:object,originalObject:object,
 request:{id:id(6),company_id:id(2),customer_id:id(3),site_id:id(4),grid_owner_id:id(11),operation_id:id(7),ediel_message_id:id(5)},requestSnapshot:{id:id(8),company_id:id(2),customer_id:id(3),customer_site_id:id(4),operation_id:id(7),request_kind:'customer_data_request',request_reference:id(6),superseded_at:null,grid_owner_id:id(11),site_address_hash:'installation|12345|town'},
 customer:{id:id(3),company_id:id(2),personal_number:user,org_number:null},site:{id:id(4),company_id:id(2),customer_id:id(3),facility_id:point,grid_owner_id:id(11),address_hash:'installation|12345|town'},
 acceptedTransport:{id:id(9),message_id:id(5),company_id:id(2),environment:'test',classification:'accepted',entered_at:'2026-10-06T12:01:00Z',observed_at:'2026-10-06T12:02:00Z',binding:{originalHash:hash(originalRaw)}},acceptedTransportReceipt:{status:'accepted_projection',lane:'generic_journal',companyId:id(2),environment:'test',messageId:id(5),attemptId:id(9),originalHash:hash(originalRaw),observedAt:'2026-10-06T12:02:00Z'}}
 const registry=ownerRulePack(),profileKey='PRODAT:Z02:L:26.A:r3',profile={...registry.profile,messageCode:'Z02'}
 Object.assign(registry,{profile_key:profileKey,profile});Object.assign(registry.original_snapshot.messageProfile,{profile_key:profileKey,profile})
 io.rpc.mockImplementation(async(name:string)=>{
  if(name==='gridex_ediel_received_z02_address_source_basis_v1')return {data:proof,error:null}
  if(name==='resolve_canonical_ediel_rule_pack_with_witness_v1')return {data:[registry],error:null}
  throw Error(`undeclared_runtime_rpc:${name}`)
 })
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:'Z02',subtypeOrReasonCode:'Z22',direction:'inbound',referenceDate:'2026-10-06',associationAssignedCode:'E2SE6A',applicationReference:'23-DDQ-PRODAT',mode:'parse'})
 return {message,proof,policy,context:()=>fetchReceivedZ02EndUserAddressContext({message,actorUserId:id(10)})}
}
function fields(f:ReturnType<typeof fixture>,context?:ReceivedZ02EndUserAddressContext,row=f.message,policy=f.policy){const t=tokenizeEdifact(row.raw_payload!);const input={policy,rawPayload:row.raw_payload,rawSegments:t.segments.map(s=>s.raw),una:t.una,sourceMessage:row,receivedZ02EndUserAddressContext:context};return validateCanonicalPolicyFields(input)}
function rulebookInput(f:ReturnType<typeof fixture>,context?:ReceivedZ02EndUserAddressContext){return {family:'PRODAT',code:'Z02',direction:'inbound' as const,mode:'parse' as const,companyId:f.message.company_id!,environment:'test' as const,rawPayload:f.message.raw_payload!,applicationReference:'23-DDQ-PRODAT',admissionAt:f.message.message_received_at!,messageRow:f.message,receivedZ02EndUserAddressContext:context}}
const missingCode='PRODAT_RECEIVED_Z02_END_USER_ADDRESS_MISSING'
beforeEach(()=>vi.clearAllMocks())
it('positive changed reply survives actual source-bound fields, rulebook and async runtime',async()=>{
 const f=fixture(),context=await f.context();expect(context).toBeDefined();expect(fields(f,context).filter(i=>i.blocking)).toEqual([])
 expect((await validateRulebookMessageWithRegistry(rulebookInput(f,context))).blocking).toBe(false)
 const facts={actorUserId:id(10)},decision=await resolveCanonicalRuntimeDecisionWithRegistry(f.message,facts)
 expect(decision.issues).toEqual([]);expect(decision.applicationDecision).toBe('accepted')
})
it('available original makes physical missing229 a mapped own-field error',async()=>{
 const f=fixture(['229']),context=await f.context();expect(context).toBeDefined()
 expect(fields(f,context)).toEqual(expect.arrayContaining([expect.objectContaining({code:missingCode,blocking:true,prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'229',errorKind:'missing'})})]))
})
it('actual rulebook consumes protected original availability',async()=>{
 const f=fixture(['229']),context=await f.context(),result=await validateRulebookMessageWithRegistry(rulebookInput(f,context))
 expect(result.blocking).toBe(true);expect(result.issues.some(i=>i.code===missingCode)).toBe(true)
})
it('actual async runtime freshly reads availability with current executor and rejects missing229',async()=>{
 const f=fixture(['229']),facts={actorUserId:id(10)},result=await resolveCanonicalRuntimeDecisionWithRegistry(f.message,facts)
 expect(io.rpc).toHaveBeenCalledWith('gridex_ediel_received_z02_address_source_basis_v1',{p_source_message_id:f.message.id,p_actor_user_id:id(10)})
 expect(result.issues.some(i=>i.code===missingCode)).toBe(true);expect(result.applicationDecision).toBe('rejected')
 expect(result.responsePlan).toEqual(expect.arrayContaining([expect.objectContaining({family:'APERAK',outcome:'negative',applicationErrors:expect.arrayContaining([expect.objectContaining({fieldCode:'229',ercCode:'41',referenceNumber:point,lineItemReference:li})])})]))
})
it('source-unavailable address permits omission without upgrading incoming facts',async()=>{
 const f=fixture(['229'],[]),context=await f.context();expect(context).toBeDefined();expect(fields(f,context).filter(i=>i.blocking)).toEqual([])
 expect((await validateRulebookMessageWithRegistry(rulebookInput(f,context))).blocking).toBe(false)
})
it('missing opaque context preserves detached pure-parse behavior',()=>{const f=fixture(['229']);expect(fields(f).filter(i=>i.blocking)).toEqual([])})
it('forged context is a local refusal, never a national229 finding',()=>{
 const f=fixture(['229']),issues=fields(f,{kind:'received_z02_end_user_address'})
 expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_RECEIVED_Z02_END_USER_ADDRESS_SCOPE_UNQUALIFIED',blocking:true,prodatDiagnostic:expect.objectContaining({kind:'local_unknown'})})]))
 expect(issues.some(i=>i.code===missingCode)).toBe(false)
})
it.each(['row','policy'] as const)('opaque source context cannot authorize a foreign %s',async change=>{
 const f=fixture(['229']),context=await f.context(),issues=fields(f,context,change==='row'?{...f.message,id:id(90)}:f.message,change==='policy'?{...f.policy,subtype:'LK'}:f.policy)
 expect(issues.some(i=>i.code==='PRODAT_RECEIVED_Z02_END_USER_ADDRESS_SCOPE_UNQUALIFIED'&&i.blocking)).toBe(true)
 expect(issues.some(i=>i.code===missingCode)).toBe(false)
})
it.each(['null','denied'] as const)('fresh async %s READ is a local hold without fabricated negativeAPERAK',async result=>{
 const f=fixture(),delegate=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,...args:unknown[])=>name==='gridex_ediel_received_z02_address_source_basis_v1'?{data:null,error:result==='denied'?{code:'42501',message:'denied'}:null}:delegate(name,...args))
 const facts={actorUserId:id(10)},decision=await resolveCanonicalRuntimeDecisionWithRegistry(f.message,facts)
 expect(decision.applicationDecision).toBe('manual_review');expect(decision.issues.some(i=>i.code==='RECEIVED_Z02_END_USER_ADDRESS_SOURCE_UNAVAILABLE')).toBe(true)
 expect(decision.responsePlan.some(i=>i.family==='APERAK')).toBe(false)
})

// Additional independent controls; original eleven-case RED is retained in /tmp.
it.each(['null','denied'] as const)('keeps a real qualified R260 negative when source READ is %s',async result=>{
 const f=fixture(['260']),delegate=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,...args:unknown[])=>name==='gridex_ediel_received_z02_address_source_basis_v1'?{data:null,error:result==='denied'?{code:'42501',message:'denied'}:null}:delegate(name,...args))
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(f.message,{actorUserId:id(10)})
 expect(decision.applicationDecision).toBe('rejected');expect(decision.functionalDecision).toBe('manual_review')
 expect(decision.issues.some(i=>i.code==='RECEIVED_Z02_END_USER_ADDRESS_SOURCE_UNAVAILABLE')).toBe(true)
 const errors=decision.responsePlan.filter(i=>i.family==='APERAK').flatMap(i=>i.applicationErrors??[])
 expect(errors).toEqual(expect.arrayContaining([expect.objectContaining({fieldCode:'260',ercCode:'41',referenceNumber:point,lineItemReference:li})]))
 expect(errors.some(i=>i.fieldCode==='229')).toBe(false)
 expect(decision.responsePlan.some(i=>i.family==='APERAK'&&i.outcome==='positive')).toBe(false)
})
it.each(['rawPayload','rawSegments','una'] as const)('rejects detached %s injection before any national229 finding',async key=>{
 const f=fixture(['229']),context=await f.context(),t=tokenizeEdifact(f.message.raw_payload!)
 const input={policy:f.policy,sourceMessage:f.message,receivedZ02EndUserAddressContext:context,rawPayload:f.message.raw_payload,rawSegments:t.segments.map(s=>s.raw),una:t.una}
 if(key==='rawPayload')input.rawPayload=input.rawPayload!.replace('REPLY-D','FOREIGN-D')
 if(key==='rawSegments')input.rawSegments=input.rawSegments.filter(s=>!s.startsWith('NAD+UD'))
 if(key==='una')input.una={...input.una,componentDataElementSeparator:'*'}
 const issues=validateCanonicalPolicyFields(input)
 expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_RECEIVED_Z02_END_USER_ADDRESS_SCOPE_UNQUALIFIED',prodatDiagnostic:expect.objectContaining({kind:'local_unknown'})})]))
 expect(issues.some(i=>i.code===missingCode)).toBe(false)
})
function addressFixture(address:readonly string[]){
 const f=fixture(),replacement='+'+address.map(value=>escapeEdifactData(value)).join(':')+'+'
 const changed=f.message.raw_payload!.replace('+Changed street+',replacement)
 expect(changed).not.toBe(f.message.raw_payload)
 f.message.raw_payload=changed;f.message.immutable_payload_hash=hash(changed)
 f.proof.sourceRawPayload=changed;f.proof.sourcePayloadHash=hash(changed)
 return f
}
it.each([
 {label:'dot followed by BOX',address:['.','BOX 10'],invalid:false},
 {label:'normal three components with escaped separators',address:['Street :+?','c/o Tenant','BOX 10'],invalid:false},
 {label:'blank first component',address:['','BOX 10'],invalid:true},
 {label:'dot without later address',address:['.'],invalid:true},
 {label:'control character',address:['Street'+String.fromCharCode(1)],invalid:true},
 {label:'four components',address:['Street','c/o Tenant','BOX 10','Fourth'],invalid:true},
 {label:'overlong first component',address:['S'.repeat(36)],invalid:true},
 {label:'three components exactly 35 characters',address:['S'.repeat(35),'T'.repeat(35),'U'.repeat(35)],invalid:false},
])('validates physical C059 format: $label',async({address,invalid})=>{
 const f=addressFixture(address),context=await f.context();expect(context).toBeDefined()
 const issues=fields(f,context)
 if(invalid)expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'PRODAT_RECEIVED_Z02_END_USER_ADDRESS_FORMAT_INVALID',blocking:true,prodatDiagnostic:expect.objectContaining({kind:'field',fieldNumber:'229',errorKind:'invalid'})})]))
 else expect(issues.filter(i=>i.blocking)).toEqual([])
})
it('a retained prior READ token cannot supply D229 after the current executor is denied',async()=>{
 const f=fixture(['229']),context=await f.context();expect(context).toBeDefined()
 const delegate=io.rpc.getMockImplementation()!
 io.rpc.mockImplementation(async(name:string,...args:unknown[])=>name==='gridex_ediel_received_z02_address_source_basis_v1'?{data:null,error:{code:'42501',message:'current executor denied'}}:delegate(name,...args))
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(f.message,{actorUserId:id(20),receivedZ02EndUserAddressContext:context})
 expect(io.rpc).toHaveBeenCalledWith('gridex_ediel_received_z02_address_source_basis_v1',{p_source_message_id:f.message.id,p_actor_user_id:id(20)})
 expect(decision.applicationDecision).toBe('manual_review');expect(decision.functionalDecision).toBe('manual_review')
 expect(decision.issues.some(i=>i.code===missingCode)).toBe(false)
 expect(decision.responsePlan.some(i=>i.family==='APERAK')).toBe(false)
})

// Additional syntax boundary only; no new source authority or whole-contract proof.
it.each(['count', 'message reference'] as const)('malformed Z02 physical UNT %s rejects before current-executor address READ', async fault => {
 const f=fixture(),before=f.message.raw_payload!,wire=tokenizeEdifact(before)
 const unhs=wire.segments.filter(segment=>segment.tag==='UNH'),unts=wire.segments.filter(segment=>segment.tag==='UNT')
 expect(unhs).toHaveLength(1);expect(unts).toHaveLength(1)
 const unh=unhs[0]!,unt=unts[0]!,separator=wire.una.dataElementSeparator
 expect(Number(unt.elements[1])).toBe(unt.index-unh.index+1)
 expect(unt.elements[2]).toBe(unh.elements[1])
 const changed=fault==='count'
  ?unt.raw.replace(`UNT${separator}${unt.elements[1]}${separator}`,`UNT${separator}${Number(unt.elements[1])+1}${separator}`)
  :unt.raw.replace(`${separator}${unt.elements[2]}`,`${separator}FOREIGN-M`)
 expect(changed).not.toBe(unt.raw)
 const after=before.replace(unt.raw,changed)
 expect(after).not.toBe(before)
 const mutated=tokenizeEdifact(after)
 expect(mutated.una).toEqual(wire.una)
 expect(mutated.segments.filter(segment=>segment.tag!=='UNT').map(segment=>segment.raw))
  .toEqual(wire.segments.filter(segment=>segment.tag!=='UNT').map(segment=>segment.raw))
 expect(mutated.segments.filter(segment=>segment.tag==='UNT').map(segment=>segment.raw)).toEqual([changed])
 f.message.raw_payload=after;f.message.immutable_payload_hash=hash(after)
 const facts={actorUserId:id(10)},decision=await resolveCanonicalRuntimeDecisionWithRegistry(f.message,facts)
 expect([decision.syntaxDecision,decision.applicationDecision,decision.functionalDecision]).toEqual(['rejected','not_applicable','not_applicable'])
 expect(decision.issues).toEqual(expect.arrayContaining([expect.objectContaining({layer:'syntax',severity:'error',
  code:fault==='count'?'unt_count_mismatch':'unh_unt_reference_mismatch'})]))
 expect(io.rpc.mock.calls.filter(([name])=>name==='gridex_ediel_received_z02_address_source_basis_v1')).toEqual([])
 expect(io.rpc).not.toHaveBeenCalled()
 expect(decision.responsePlan.some(response=>response.family==='APERAK')).toBe(false)
})

// OUTSIDE-GIT finite composition input control; no native/source authority.
it('FINITE composition retains one actual actor observation for valid Z02',async()=>{
 const f=fixture();let reads=0
 const facts=Object.defineProperty({},'actorUserId',{get(){reads++;return id(10)}})
 const decision=await resolveCanonicalRuntimeDecisionWithRegistry(f.message,facts)
 expect(decision.applicationDecision).toBe('accepted')
 expect(reads).toBe(1)
 expect(io.rpc.mock.calls.filter(c=>c[0]==='gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(1)
})
it('FINITE composition does not consume actor getter before physical subtype qualification',async()=>{
 const f=fixture();f.message.raw_payload=f.message.raw_payload!.replace('CAV+Z22','CAV+UNKNOWN');let reads=0
 const facts=Object.defineProperty({},'actorUserId',{get(){reads++;return id(10)}})
 await resolveCanonicalRuntimeDecisionWithRegistry(f.message,facts)
 expect(reads).toBe(0)
 expect(io.rpc.mock.calls.filter(c=>c[0]==='gridex_ediel_received_z02_address_source_basis_v1')).toHaveLength(0)
})
