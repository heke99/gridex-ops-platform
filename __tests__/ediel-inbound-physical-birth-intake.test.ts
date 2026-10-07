// Component-only real parser/intake chronology with declared catalog/DB ports.
// Native source admission and whole Z02/H contracts require separate evidence.
import {beforeEach,expect,it,vi} from 'vitest'
import {parseInboundEmailContent} from '@/lib/inbound-mail/edielEmailParser'
import {createInboundEdielMessage} from '@/lib/inbound-mail/inboundStatusUpdater'
import {guideOrderedFixtureRaw} from './helpers/prodatGuideOrderedFixture'
import {characteristic,line,type Parts} from './fixtures/prodat-register'
import {company,actor,mailId,parseId,oldId,newId,receivedAt,inboundReceptionBoundary} from './fixtures/inbound-reception-db'

const io=vi.hoisted(()=>({from:vi.fn(),rpc:vi.fn(),catalog:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:io.from,rpc:io.rpc}}))
vi.mock('@/lib/ediel/rulebook/canonicalRulePackRegistry',()=>({resolveCanonicalRulePack:io.catalog}))
const object=(reason:string,index=1):Parts[]=>[line(String(index),'73599900000000'+index,undefined,'9'),...characteristic('Z13',reason),['RFF',['LI','OWN-'+index]]]
const wire=(code='Z02',reasons=['Z22'])=>guideOrderedFixtureRaw(reasons.flatMap((reason,index)=>object(reason,index+1)),code)
function parsed(payload:string){const p=parseInboundEmailContent({attachmentText:payload});if(!p)throw Error('actual_parser_required');return p}
const evidence=(code:string,profile:string)=>({rulePackId:'declared-pack',messageProfileId:'declared-profile',databaseProfileKey:`PRODAT:${code}:${profile}:26.A:r3`,profileKey:'semantic-alias',originalVersion:'26.A:r3',sourceHash:'a'.repeat(64),unhAssociationCode:'E2SE6A',originalSnapshot:{rulePack:{id:'declared-pack'},messageProfile:{id:'declared-profile'},guideSources:[]}})
let db:ReturnType<typeof inboundReceptionBoundary>
const input=(payload:string)=>({companyId:company,actorUserId:actor,environment:'test',inboundEmailMessageId:mailId,parseResultId:parseId,parsed:parsed(payload)})
function setup(payload:string){db=inboundReceptionBoundary(parsed(payload));db.state.existing=false;io.from.mockImplementation(db.from);io.rpc.mockImplementation(db.rpc)}
beforeEach(()=>{vi.clearAllMocks();setup(wire());io.catalog.mockReset().mockImplementation(async({messageCode,transactionSubtype}:{messageCode:string;transactionSubtype:string})=>{
 expect(db.writes('ediel_messages')).toEqual([])
 return evidence(messageCode,({Z22:'L',Z23:'LK',Z25:'H',Z26:'A',Z70:'D',E34:'E'} as Record<string,string>)[transactionSubtype])
})})

it.each([['Z02','Z22','L'],['Z02','Z23','LK'],['Z04','Z25','H'],['Z04','Z26','A'],['Z04','Z70','D'],['Z04','Z22','L'],['Z04','Z23','LK'],['Z06','E34','E'],['Z05','Z25','H'],['Z05','Z22','L']])('binds %s/%s only before first INSERT and preserves existing selector %s',async(code,reason,profile)=>{
 const payload=wire(code,[reason]);setup(payload)
 expect(await createInboundEdielMessage(input(payload))).toBe(newId)
 expect(io.catalog).toHaveBeenCalledExactlyOnceWith({family:'PRODAT',messageCode:code,transactionSubtype:reason,applicationReference:'23-DDQ-PRODAT',direction:'inbound',businessDate:'2026-09-21'})
 const selected=evidence(code,profile),writes=db.writes('ediel_messages');expect(writes).toHaveLength(1)
 expect(writes[0]).toMatchObject({operation:'insert',payload:{raw_payload:payload,message_received_at:receivedAt,canonical_rule_pack_id:selected.rulePackId,rule_profile_key:selected.databaseProfileKey,rule_profile_version_id:selected.messageProfileId,rule_profile_version:selected.originalVersion,rule_pack_checksum:selected.sourceHash,rule_pack_snapshot:{...selected.originalSnapshot,profileKey:selected.databaseProfileKey,profileVersionId:selected.messageProfileId,version:selected.originalVersion,checksum:selected.sourceHash}}})
 for(const key of ['execution_context_snapshot','bilateral_capability_verified','business_effect_authorized'])expect(writes[0].payload).not.toHaveProperty(key)
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission','ediel_record_inbound_reception_v1'])
 expect(db.writes('outbound_requests')).toEqual([])
})

it.each([['Z02','Z22'],['Z02','Z23'],['Z04','Z25'],['Z05','Z25'],['Z05','Z22']])('keeps existing %s/%s immutable without reselection on replay',async(code,reason)=>{
 const payload=wire(code,[reason]);setup(payload);db.state.existing=true
 const before=structuredClone(db.state.original)
 expect(await createInboundEdielMessage(input(payload))).toBe(oldId)
 expect(io.catalog).not.toHaveBeenCalled();expect(db.writes('ediel_messages')).toEqual([]);expect(db.state.original).toEqual(before)
})

it.each([['Z02',['Z22','Z23']],['Z04',['Z25','Z22']],['Z02',['Z25']],['Z04',['']],['Z05',['Z26']],['Z05',['Z25','Z22']],['Z01',['Z22']]])('does not borrow a sibling profile for %s/%j',async(code,reasons)=>{
 const payload=wire(code,reasons);setup(payload)
 expect(await createInboundEdielMessage(input(payload))).toBe(newId)
 expect(io.catalog).not.toHaveBeenCalled()
 const writes=db.writes('ediel_messages');expect(writes).toHaveLength(1)
 for(const key of ['canonical_rule_pack_id','rule_profile_key','rule_profile_version_id','rule_profile_version','rule_pack_checksum','rule_pack_snapshot'])expect(writes[0].payload).not.toHaveProperty(key)
})

it.each([['Z02','Z22'],['Z02','Z23'],['Z04','Z25'],['Z05','Z25'],['Z05','Z22']])('propagates %s/%s catalog failure before INSERT or reception',async(code,reason)=>{
 const payload=wire(code,[reason]);setup(payload);io.catalog.mockRejectedValue(Error('canonical_rule_pack_evidence_count:0'))
 await expect(createInboundEdielMessage(input(payload))).rejects.toThrow('canonical_rule_pack_evidence_count:0')
 expect(db.writes('ediel_messages')).toEqual([]);expect(db.writes('ediel_message_events')).toEqual([])
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission'])
})

it.each(['actor','permission','environment','parse'] as const)('retains the %s guard before profile lookup or source effects',async(guard)=>{
 const payload=wire('Z04',['Z25']);setup(payload);const request=input(payload)
 if(guard==='actor')db.state.actorActive=false
 if(guard==='permission')db.state.permission=false
 if(guard==='environment')request.environment='foreign'
 if(guard==='parse')request.parseResultId=''
 const errors={actor:'ediel_tenant_actor_forbidden',permission:'ediel_tenant_permission_forbidden',environment:'ediel_inbound_duplicate_scope_required',parse:'ediel_real_reception_actor_and_parse_required'}
 await expect(createInboundEdielMessage(request)).rejects.toThrow(errors[guard])
 expect(io.catalog).not.toHaveBeenCalled();expect(db.writes('ediel_messages')).toEqual([])
 expect(db.state.rpcCalls.filter(c=>c.name==='ediel_record_inbound_reception_v1')).toEqual([])
})

it('rejects a retained-mail environment conflict before selecting a catalog witness',async()=>{
 const payload=wire('Z02',['Z22']);setup(payload);db.state.environment='production'
 await expect(createInboundEdielMessage(input(payload))).rejects.toThrow('ediel_actual_inbound_receipt_clock_required')
 expect(io.catalog).not.toHaveBeenCalled();expect(db.writes('ediel_messages')).toEqual([])
})

// Override only the declared retained-mail result; actual caller filters and
// chronology continue to execute, and no SQL/source authority is supplied.
function patchMail(patch:Record<string,unknown>){
 io.from.mockImplementation((table:string)=>{
  const q=db.from(table)
  if(table==='inbound_email_messages'){
   const original=q.maybeSingle
   q.maybeSingle=async()=>{const result=await original();return {...result,data:result.data?{...result.data,...patch}:result.data}}
  }
  return q
 })
}
it.each([{company_id:'foreign-company'},{received_at:null},{received_at:'invalid-clock'}])('rejects retained-mail %j before catalog or INSERT',async(patch)=>{
 const payload=wire('Z04',['Z25']);setup(payload);patchMail(patch)
 await expect(createInboundEdielMessage(input(payload))).rejects.toThrow('ediel_actual_inbound_receipt_clock_required')
 expect(io.catalog).not.toHaveBeenCalled();expect(db.writes('ediel_messages')).toEqual([])
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission'])
})
it('uses the retained zoned mail instant across the Stockholm date boundary',async()=>{
 const payload=wire('Z04',['Z25']);setup(payload);patchMail({received_at:'2026-09-21T22:30:00Z'})
 expect(await createInboundEdielMessage(input(payload))).toBe(newId)
 expect(io.catalog).toHaveBeenCalledExactlyOnceWith({family:'PRODAT',messageCode:'Z04',transactionSubtype:'Z25',applicationReference:'23-DDQ-PRODAT',direction:'inbound',businessDate:'2026-09-22'})
 expect(db.writes('ediel_messages')[0].payload).toHaveProperty('message_received_at','2026-09-21T22:30:00.000Z')
})
it.each([['Z02','Z22'],['Z02','Z23'],['Z04','Z25'],['Z05','Z25'],['Z05','Z22']])('keeps the race winner %s/%s original immutable after unique conflict',async(code,reason)=>{
 const payload=wire(code,[reason]);setup(payload)
 const winner=inboundReceptionBoundary(parsed(payload)),before=structuredClone(winner.state.original)
 db.state.error={code:'23505',message:'canonical duplicate'}
 io.from.mockImplementation((table:string)=>{
  const q=db.from(table)
  if(table==='ediel_messages'){
   const insert=q.insert
   q.insert=(row)=>{db.state.existing=true;return insert(row)}
  }
  return q
 })
 io.rpc.mockImplementation((name:string,args:Record<string,unknown>)=>name==='ediel_record_inbound_reception_v1'?winner.rpc(name,args):db.rpc(name,args))
 expect(await createInboundEdielMessage(input(payload))).toBe(oldId)
 expect(io.catalog).toHaveBeenCalledTimes(1)
 expect(db.writes('ediel_messages').map(c=>c.operation)).toEqual(['insert'])
 expect(winner.state.original).toEqual(before);expect(db.state.original).toEqual(before)
 expect(winner.state.rpcCalls.map(c=>c.name)).toEqual(['ediel_record_inbound_reception_v1'])
 expect(winner.state.rpcCalls[0].args.p_message_id).toBe(oldId)
 expect(db.writes('outbound_requests')).toEqual([])
})

// The production omission this catches is a Z05 source INSERT without its own
// immutable physical H/L catalog witness. Guard refusals must precede lookup.
it.each(['Z25','Z22'].flatMap(reason=>['actor','permission','environment','parse'].map(guard=>[reason,guard])))('keeps Z05/%s %s refusal before catalog or effects',async(reason,guard)=>{
 const payload=wire('Z05',[reason]);setup(payload);const request=input(payload)
 if(guard==='actor')db.state.actorActive=false
 if(guard==='permission')db.state.permission=false
 if(guard==='environment')request.environment='foreign'
 if(guard==='parse')request.parseResultId=''
 const errors:Record<string,string>={actor:'ediel_tenant_actor_forbidden',permission:'ediel_tenant_permission_forbidden',environment:'ediel_inbound_duplicate_scope_required',parse:'ediel_real_reception_actor_and_parse_required'}
 await expect(createInboundEdielMessage(request)).rejects.toThrow(errors[guard])
 expect(io.catalog).not.toHaveBeenCalled();expect(db.writes('ediel_messages')).toEqual([])
 expect(db.state.rpcCalls.filter(c=>c.name==='ediel_record_inbound_reception_v1')).toEqual([])
})
it.each(['Z25','Z22'])('uses the original retained zoned receipt for Z05/%s across the Stockholm date boundary',async(reason)=>{
 const payload=wire('Z05',[reason]);setup(payload);patchMail({received_at:'2026-09-21T22:30:00Z'})
 expect(await createInboundEdielMessage(input(payload))).toBe(newId)
 expect(io.catalog).toHaveBeenCalledExactlyOnceWith({family:'PRODAT',messageCode:'Z05',transactionSubtype:reason,applicationReference:'23-DDQ-PRODAT',direction:'inbound',businessDate:'2026-09-22'})
 expect(db.writes('ediel_messages')[0].payload).toHaveProperty('message_received_at','2026-09-21T22:30:00.000Z')
})
it.each(['Z25','Z22'].flatMap(reason=>[{company_id:'foreign-company'},{received_at:null},{received_at:'invalid-clock'}].map(patch=>({reason,patch}))))('rejects invalid Z05/$reason retained mail $patch before catalog or source effects',async({reason,patch})=>{
 const payload=wire('Z05',[reason]);setup(payload);patchMail(patch)
 await expect(createInboundEdielMessage(input(payload))).rejects.toThrow('ediel_actual_inbound_receipt_clock_required')
 expect(io.catalog).not.toHaveBeenCalled();expect(db.writes('ediel_messages')).toEqual([])
 expect(db.state.rpcCalls.map(c=>c.name)).toEqual(['gridex_actor_has_company_permission'])
})
