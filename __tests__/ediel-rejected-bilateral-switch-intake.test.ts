// masterplan: AT-Z03H-SUPPLIER, AT-Z04H-SUPPLIER
// Component-only first-reception proof. External catalog/DB ports are declared
// finite IO; native SQL/private negative ACK and whole H require separate proof.
import {beforeEach,expect,it,vi} from 'vitest'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {parseInboundEmailContent} from '@/lib/inbound-mail/edielEmailParser'
import {resolveBilateralSwitchBirthProfile} from '@/lib/inbound-mail/bilateralSwitchBirthProfile'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {prodatRegisterGroups} from '@/lib/ediel/prodat/prodatRegisterGroups'
import {ownerRulePack} from './helpers/sourceOwnerFixtures'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {line,characteristic} from './fixtures/prodat-register'
import {company,actor,mailId,parseId,newId,receivedAt,inboundReceptionBoundary} from './fixtures/inbound-reception-db'

const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
const point='735999000000001',key='PRODAT:Z04:H:26.A:r3'
const witnessColumns=['canonical_rule_pack_id','rule_profile_key','rule_profile_version_id','rule_profile_version','rule_pack_checksum','rule_pack_snapshot']
const payload=()=>guideOrderedFixtureRaw([line('1',point,'1','9'),...characteristic('Z13','Z25'),['RFF',['LI','OWN']],line('2',point,'','9')],'Z04')
function registry(){
 const row=ownerRulePack();Object.assign(row,{profile_key:key,profile:{...row.profile,transactionSubtype:'H',reasonForTransaction:'Z25'}})
 Object.assign(row.original_snapshot.messageProfile,{profile_key:key,profile:row.profile});return row
}
function parse(rawPayload:string){const p=parseInboundEmailContent({attachmentText:rawPayload});if(!p)throw Error('actual_parser_required');return p}
let db:ReturnType<typeof inboundReceptionBoundary>
function setup(rawPayload:string){
 db=inboundReceptionBoundary(parse(rawPayload));db.state.existing=false
 io.from.mockImplementation((table:string)=>{
  const q=db.from(table)
  if(table==='ediel_messages'){
   const insert=q.insert
   q.insert=(row:Record<string,unknown>)=>{
    // Declared model of the existing SQL trigger's code-only catalog ambiguity.
    // This is not a claim of executing PostgreSQL or admitting business facts.
    db.state.error=witnessColumns.every(k=>row[k]!==undefined)?null:{code:'23514',message:'canonical_rule_pack_evidence_count:6:PRODAT:Z04'}
    return insert(row)
   }
  }
  return q
 })
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='resolve_canonical_ediel_rule_pack_with_witness_v1'?{data:[registry()],error:null}:db.rpc(name,args))
}
const input=(rawPayload:string)=>({companyId:company,actorUserId:actor,environment:'test',inboundEmailMessageId:mailId,parseResultId:parseId,parsed:parse(rawPayload)})
beforeEach(()=>{vi.clearAllMocks();setup(payload())})
it('binds a recognizable rejected second258 source before its first INSERT without validating the register chain',async()=>{
 const rawPayload=payload(), t=tokenizeEdifact(rawPayload),grouping=prodatRegisterGroups(t.segments,t.una,'Z04')
 expect(grouping.problems.map(p=>[p.fieldNumber,p.lineIndex,p.reason])).toEqual([
  ['258',1,'invalid_C829_indicator_or_index'],['258',1,'per_object_register_sequence_invalid'],
 ])
 expect(grouping.groups.map(g=>[g.validRegisterChain,g.firstLineIndex])).toEqual([[false,null],[false,null]])
 expect(await resolveBilateralSwitchBirthProfile({rawPayload,receivedAt})).toBeNull()
 expect(await createInboundEdielMessage(input(rawPayload))).toBe(newId)
 const writes=db.writes('ediel_messages');expect(writes).toHaveLength(1)
 expect(writes[0].payload).toMatchObject({raw_payload:rawPayload,message_received_at:receivedAt,
  canonical_rule_pack_id:'00000000-0000-4000-8000-000000000012',rule_profile_key:key,
  rule_profile_version_id:'00000000-0000-4000-8000-000000000011',rule_profile_version:'26.A:r3',rule_pack_checksum:'a'.repeat(64),
  rule_pack_snapshot:{...registry().original_snapshot,profileKey:key,profileVersionId:'00000000-0000-4000-8000-000000000011',version:'26.A:r3',checksum:'a'.repeat(64)}})
 for(const k of ['execution_context_snapshot','bilateral_capability_verified','business_effect_authorized'])expect(writes[0].payload).not.toHaveProperty(k)
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
 expect(db.writes('outbound_requests')).toEqual([])
})

it('keeps an existing rejected source immutable and returns before catalog reselection',async()=>{
 const rawPayload=payload();db.state.existing=true;const before=structuredClone(db.state.original)
 expect(await createInboundEdielMessage(input(rawPayload))).toBe('00000000-0000-4000-8000-000000000005')
 expect(io.rpc.mock.calls.filter(c=>c[0]==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toEqual([])
 expect(db.writes('ediel_messages')).toEqual([]);expect(db.state.original).toEqual(before)
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
})
it('preserves the healthy positive bilateral selector and original source bytes',async()=>{
 const rawPayload=guideOrderedFixtureRaw([line('1',point,'1','9'),...characteristic('Z13','Z25'),['RFF',['LI','OWN']],line('2',point,'2','9')],'Z04');setup(rawPayload)
 expect(await createInboundEdielMessage(input(rawPayload))).toBe(newId)
 expect(db.writes('ediel_messages')[0].payload).toMatchObject({raw_payload:rawPayload,rule_profile_key:key,processing_status:'manual_review'})
 expect(io.rpc.mock.calls.filter(c=>c[0]==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toHaveLength(1)
})
function patchMail(patch:Record<string,unknown>){
 const originalFrom=io.from.getMockImplementation()!
 io.from.mockImplementation((table:string)=>{
  const q=originalFrom(table)
  if(table==='inbound_email_messages'){
   const original=q.maybeSingle
   q.maybeSingle=async()=>{const result=await original();return {...result,data:result.data?{...result.data,...patch}:result.data}}
  }
  return q
 })
}
it('uses the actual retained mailbox instant at the Stockholm calendar boundary before INSERT',async()=>{
 patchMail({received_at:'2026-10-06T22:30:00.123Z'})
 expect(await createInboundEdielMessage(input(payload()))).toBe(newId)
 expect(io.rpc.mock.calls.find(c=>c[0]==='resolve_canonical_ediel_rule_pack_with_witness_v1')?.[1]).toMatchObject({p_business_date:'2026-10-07',p_transaction_subtype:'H'})
 expect(db.writes('ediel_messages')[0].payload).toHaveProperty('message_received_at','2026-10-06T22:30:00.123Z')
})
it.each([{company_id:'foreign-company'},{environment:'production'},{received_at:null},{received_at:'invalid-clock'}])('refuses retained mailbox %j before catalog and source effects',async patch=>{
 patchMail(patch)
 await expect(createInboundEdielMessage(input(payload()))).rejects.toThrow('ediel_actual_inbound_receipt_clock_required')
 expect(io.rpc.mock.calls.filter(c=>c[0]==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toEqual([])
 expect(db.writes('ediel_messages')).toEqual([])
})
it.each(['actor','permission','environment','parse'] as const)('preserves the existing %s guard before rejected catalog selection',async guard=>{
 const request=input(payload())
 if(guard==='actor')db.state.actorActive=false
 if(guard==='permission')db.state.permission=false
 if(guard==='environment')request.environment='foreign'
 if(guard==='parse')request.parseResultId=''
 const errors={actor:'ediel_tenant_actor_forbidden',permission:'ediel_tenant_permission_forbidden',environment:'ediel_inbound_duplicate_scope_required',parse:'ediel_real_reception_actor_and_parse_required'}
 await expect(createInboundEdielMessage(request)).rejects.toThrow(errors[guard])
 expect(io.rpc.mock.calls.filter(c=>c[0]==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toEqual([])
 expect(db.writes('ediel_messages')).toEqual([])
})
it('propagates dated catalog refusal before any source INSERT or reception observation',async()=>{
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='resolve_canonical_ediel_rule_pack_with_witness_v1'?{data:[],error:null}:db.rpc(name,args))
 await expect(createInboundEdielMessage(input(payload()))).rejects.toThrow('canonical_rule_pack_evidence_count:0:PRODAT:Z04:H')
 expect(db.writes('ediel_messages')).toEqual([]);expect(db.writes('ediel_message_events')).toEqual([])
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission'])
})

// Exact missing314 wire, finite DB/catalog ports only; not PostgreSQL/private proof.
const missingSequencePayload=()=>guideOrderedFixtureRaw([line('',point,undefined,'9'),...characteristic('Z13','Z25'),['RFF',['LI','OWN']]],'Z04')
const missingApplicationPayload=()=>guideOrderedFixtureRaw([line('1',point,undefined,'9'),...characteristic('Z13','Z25'),['RFF',['LI','OWN']]],'Z04').replace('23-DDQ-PRODAT','')
it('retains a physically missing311 source at first INSERT without repairing its application or borrowing point authority',async()=>{
 const rawPayload=missingApplicationPayload();setup(rawPayload)
 const request=input(rawPayload),parsedBefore=structuredClone(request.parsed),t=tokenizeEdifact(rawPayload),grouping=prodatRegisterGroups(t.segments,t.una,'Z04')
 expect(request.parsed.applicationReference).toBeNull()
 expect(grouping.problems).toEqual([])
 expect(grouping.groups.map(g=>[g.lineNumber,g.validRegisterChain,g.firstLineIndex,g.registerPosition])).toEqual([['1',true,0,1]])
 expect(await resolveBilateralSwitchBirthProfile({rawPayload,receivedAt})).toBeNull()
 expect(await createInboundEdielMessage(request)).toBe(newId)
 const writes=db.writes('ediel_messages');expect(writes).toHaveLength(1)
 expect(writes[0].payload).toMatchObject({raw_payload:rawPayload,application_reference:null,metering_point_id:null,
  processing_status:'manual_review',rule_profile_key:key,parsed_payload:{applicationReference:null}})
 for(const column of witnessColumns)expect(writes[0].payload).toHaveProperty(column)
 for(const column of ['execution_context_snapshot','bilateral_capability_verified','business_effect_authorized'])expect(writes[0].payload).not.toHaveProperty(column)
 expect(db.writes('outbound_requests')).toEqual([])
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
 expect(request.parsed).toEqual(parsedBefore)
})
it('retains a recognizable missing314 source at first INSERT without repairing its sequence or borrowing point authority',async()=>{
 const rawPayload=missingSequencePayload();setup(rawPayload)
 const request=input(rawPayload),parsedBefore=structuredClone(request.parsed),t=tokenizeEdifact(rawPayload),before=prodatRegisterGroups(t.segments,t.una,'Z04')
 expect(before.problems).toEqual([{fieldNumber:'314',lineIndex:0,segmentIndex:t.segments.find(s=>s.tag==='LIN')!.index,reason:'global_sequence_must_increment_from_one'}])
 expect(before.groups.map(g=>[g.lineNumber,g.validRegisterChain,g.firstLineIndex,g.effectiveSegments])).toEqual([[null,false,null,before.groups[0].segments]])
 expect(await resolveBilateralSwitchBirthProfile({rawPayload,receivedAt})).toBeNull()
 expect(await createInboundEdielMessage(request)).toBe(newId)
 const writes=db.writes('ediel_messages');expect(writes).toHaveLength(1)
 expect(writes[0].operation).toBe('insert')
 expect(writes[0].payload).toMatchObject({company_id:company,environment:'test',direction:'inbound',message_family:'PRODAT',message_code:'Z04',
  raw_payload:rawPayload,message_received_at:receivedAt,inbound_email_message_id:mailId,processing_status:'manual_review',
  outbound_request_id:null,metering_point_id:null,customer_id:null,site_id:null,
  canonical_rule_pack_id:'00000000-0000-4000-8000-000000000012',rule_profile_key:key,
  rule_profile_version_id:'00000000-0000-4000-8000-000000000011',rule_profile_version:'26.A:r3',rule_pack_checksum:'a'.repeat(64),
  rule_pack_snapshot:{...registry().original_snapshot,profileKey:key,profileVersionId:'00000000-0000-4000-8000-000000000011',version:'26.A:r3',checksum:'a'.repeat(64)}})
 for(const k of ['execution_context_snapshot','bilateral_capability_verified','business_effect_authorized'])expect(writes[0].payload).not.toHaveProperty(k)
 expect(db.writes('outbound_requests')).toEqual([])
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
 expect(prodatRegisterGroups(t.segments,t.una,'Z04')).toEqual(before);expect(request.parsed).toEqual(parsedBefore)
})

it('returns existing missing314 immutable source before catalog reselection or source rewrite',async()=>{
 const rawPayload=missingSequencePayload();setup(rawPayload);db.state.existing=true;const before=structuredClone(db.state.original)
 expect(await createInboundEdielMessage(input(rawPayload))).toBe('00000000-0000-4000-8000-000000000005')
 expect(db.state.original).toEqual(before);expect(db.writes('ediel_messages')).toEqual([])
 expect(io.rpc.mock.calls.filter(c=>c[0]==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toEqual([])
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
})
it.each(['actor','permission','environment','parse','mailtenant','clock','catalog'] as const)('refuses missing314 %s before INSERT/observation',async guard=>{
 const rawPayload=missingSequencePayload();setup(rawPayload);const request=input(rawPayload)
 if(guard==='actor')db.state.actorActive=false
 if(guard==='permission')db.state.permission=false
 if(guard==='environment')request.environment='foreign'
 if(guard==='parse')request.parseResultId=''
 if(guard==='mailtenant')patchMail({company_id:'foreign'})
 if(guard==='clock')patchMail({received_at:'invalid'})
 if(guard==='catalog')io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='resolve_canonical_ediel_rule_pack_with_witness_v1'?{data:[],error:null}:db.rpc(name,args))
 const errors={actor:'ediel_tenant_actor_forbidden',permission:'ediel_tenant_permission_forbidden',environment:'ediel_inbound_duplicate_scope_required',parse:'ediel_real_reception_actor_and_parse_required',mailtenant:'ediel_actual_inbound_receipt_clock_required',clock:'ediel_actual_inbound_receipt_clock_required',catalog:'canonical_rule_pack_evidence_count:0:PRODAT:Z04:H'}
 await expect(createInboundEdielMessage(request)).rejects.toThrow(errors[guard])
 expect(db.writes('ediel_messages')).toEqual([]);expect(db.writes('outbound_requests')).toEqual([])
 expect(db.state.rpcCalls.filter(c=>c.name==='ediel_record_inbound_reception_v1')).toEqual([])
})

it('keeps missing314 rejected even when a sole owned request supplies a point candidate',async()=>{
 const rawPayload=missingSequencePayload();setup(rawPayload)
 const requestId='00000000-0000-4000-8000-000000000031',customerId='00000000-0000-4000-8000-000000000032',siteId='00000000-0000-4000-8000-000000000033',pointId='00000000-0000-4000-8000-000000000034'
 const request={...input(rawPayload),outboundMatch:{status:'matched' as const,entityType:'outbound_request',entityId:requestId,confidence:1,reasons:[],
  candidates:[{id:requestId,company_id:company,customer_id:customerId,site_id:siteId,metering_point_id:pointId,request_type:'supplier_switch'}]},
  meteringPointMatch:{status:'missing' as const,entityType:null,entityId:null,confidence:0,reasons:[],candidates:[]}}
 expect(await createInboundEdielMessage(request)).toBe(newId)
 expect(db.writes('ediel_messages')).toHaveLength(1)
 expect(db.writes('ediel_messages')[0].payload).toMatchObject({raw_payload:rawPayload,outbound_request_id:requestId,customer_id:customerId,site_id:siteId,metering_point_id:null,rule_profile_key:key})
 expect(db.state.calls.filter(c=>['outbound_requests','metering_points','customers','customer_sites'].includes(c.table))).toEqual([])
 for(const name of ['bilateral_capability_verified','business_effect_authorized','execution_context_snapshot'])expect(db.writes('ediel_messages')[0].payload).not.toHaveProperty(name)
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
})

it('returns existing missing311 immutable source before catalog reselection or source rewrite',async()=>{
 const rawPayload=missingApplicationPayload();setup(rawPayload);db.state.existing=true;const before=structuredClone(db.state.original)
 expect(await createInboundEdielMessage(input(rawPayload))).toBe('00000000-0000-4000-8000-000000000005')
 expect(db.state.original).toEqual(before);expect(db.writes('ediel_messages')).toEqual([])
 expect(io.rpc.mock.calls.filter(c=>c[0]==='resolve_canonical_ediel_rule_pack_with_witness_v1')).toEqual([])
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
})
it.each(['actor','permission','environment','parse','mailtenant','clock','catalog'] as const)('refuses missing311 %s before INSERT/observation',async guard=>{
 const rawPayload=missingApplicationPayload();setup(rawPayload);const request=input(rawPayload)
 if(guard==='actor')db.state.actorActive=false
 if(guard==='permission')db.state.permission=false
 if(guard==='environment')request.environment='foreign'
 if(guard==='parse')request.parseResultId=''
 if(guard==='mailtenant')patchMail({company_id:'foreign'})
 if(guard==='clock')patchMail({received_at:'invalid'})
 if(guard==='catalog')io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='resolve_canonical_ediel_rule_pack_with_witness_v1'?{data:[],error:null}:db.rpc(name,args))
 const errors={actor:'ediel_tenant_actor_forbidden',permission:'ediel_tenant_permission_forbidden',environment:'ediel_inbound_duplicate_scope_required',parse:'ediel_real_reception_actor_and_parse_required',mailtenant:'ediel_actual_inbound_receipt_clock_required',clock:'ediel_actual_inbound_receipt_clock_required',catalog:'canonical_rule_pack_evidence_count:0:PRODAT:Z04:H'}
 await expect(createInboundEdielMessage(request)).rejects.toThrow(errors[guard])
 expect(db.writes('ediel_messages')).toEqual([]);expect(db.writes('outbound_requests')).toEqual([])
 expect(db.state.rpcCalls.filter(c=>c.name==='ediel_record_inbound_reception_v1')).toEqual([])
})
it('binds missing311 to the retained mailbox date without filling its physical application',async()=>{
 const rawPayload=missingApplicationPayload();setup(rawPayload);patchMail({received_at:'2026-10-06T22:30:00.123Z'})
 expect(await createInboundEdielMessage(input(rawPayload))).toBe(newId)
 expect(io.rpc.mock.calls.find(c=>c[0]==='resolve_canonical_ediel_rule_pack_with_witness_v1')?.[1]).toMatchObject({p_business_date:'2026-10-07',p_transaction_subtype:'H'})
 expect(db.writes('ediel_messages')[0].payload).toMatchObject({application_reference:null,raw_payload:rawPayload,message_received_at:'2026-10-06T22:30:00.123Z'})
})
it('keeps missing311 rejected when a sole owned request supplies a point candidate',async()=>{
 const rawPayload=missingApplicationPayload();setup(rawPayload)
 const requestId='00000000-0000-4000-8000-000000000031',customerId='00000000-0000-4000-8000-000000000032',siteId='00000000-0000-4000-8000-000000000033',pointId='00000000-0000-4000-8000-000000000034'
 const request={...input(rawPayload),outboundMatch:{status:'matched' as const,entityType:'outbound_request',entityId:requestId,confidence:1,reasons:[],
  candidates:[{id:requestId,company_id:company,customer_id:customerId,site_id:siteId,metering_point_id:pointId,request_type:'supplier_switch'}]},
  meteringPointMatch:{status:'missing' as const,entityType:null,entityId:null,confidence:0,reasons:[],candidates:[]}}
 expect(await createInboundEdielMessage(request)).toBe(newId)
 expect(db.writes('ediel_messages')).toHaveLength(1)
 expect(db.writes('ediel_messages')[0].payload).toMatchObject({raw_payload:rawPayload,application_reference:null,outbound_request_id:requestId,
  customer_id:customerId,site_id:siteId,metering_point_id:null,rule_profile_key:key,parsed_payload:{applicationReference:null}})
 expect(db.state.calls.filter(c=>['outbound_requests','metering_points','customers','customer_sites'].includes(c.table))).toEqual([])
 for(const name of ['bilateral_capability_verified','business_effect_authorized','execution_context_snapshot'])expect(db.writes('ediel_messages')[0].payload).not.toHaveProperty(name)
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
})
