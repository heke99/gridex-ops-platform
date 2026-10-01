import {beforeEach,describe,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {processInboundUtiltsMessage} from '@/lib/ediel/flows/utiltsDataRequest.part-2'
import {processInboundUtiltsMessageByCanonicalPolicy} from '@/lib/ediel/flows/utiltsInboundPolicyProcessor'
import {persistUtiltsTransactionResults} from '@/lib/ediel/utilts/transactionPersistence'

const io=vi.hoisted(()=>({get:vi.fn(),rpc:vi.fn(),link:vi.fn(),update:vi.fn(),event:vi.fn(),member:true,profile:true,permission:true}))
vi.mock('@/lib/ediel/db',()=>({getEdielMessageById:io.get,linkEdielMessage:io.link,updateEdielMessageStatus:io.update,createEdielMessageEvent:io.event}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:(table:string)=>{
 const filters=new Map<string,unknown>()
 const q={select:()=>q,eq:(k:string,v:unknown)=>{filters.set(k,v);return q},not:()=>q,maybeSingle:async()=>({error:null,data:
  table==='company_memberships'&&io.member?{company_id:filters.get('company_id'),user_id:filters.get('user_id'),status:'active',is_active:true,accepted_at:'2026-10-01T00:00:00Z'}:
  table==='user_profiles'&&io.profile?{id:filters.get('id'),user_status:'active'}:null})}
 return q
}}}))
const actor='77777777-7777-4777-8777-777777777777',company='11111111-1111-4111-8111-111111111111'
const source={id:'22222222-2222-4222-8222-222222222222',company_id:company,message_family:'UTILTS',message_code:'E66',direction:'inbound'} as EdielMessageRow
beforeEach(()=>{
 vi.clearAllMocks();io.member=true;io.profile=true;io.permission=true;io.get.mockResolvedValue(source)
 io.rpc.mockImplementation(async(name,args)=>{
  if(name!=='gridex_actor_has_company_permission')throw Error('unexpected_downstream_port:'+name)
  expect(args).toEqual({p_actor_user_id:actor,p_company_id:company,p_permission:'metering.write'})
  return {error:null,data:io.permission}
 })
})
describe.each([['actual metering',processInboundUtiltsMessage],['canonical dispatcher',processInboundUtiltsMessageByCanonicalPolicy]] as const)('%s preflight uses current tenant authority before any source write',(name,process)=>{
 it.each(['revoked membership','inactive profile','current permission deny'] as const)('denies %s before links, assessments, series and ACKs',async defect=>{
  if(defect==='revoked membership')io.member=false
  if(defect==='inactive profile')io.profile=false
  if(defect==='current permission deny')io.permission=false
  await expect(process({actorUserId:actor,edielMessageId:source.id})).rejects.toThrow(defect==='current permission deny'?'ediel_tenant_permission_forbidden':'ediel_tenant_actor_forbidden')
  expect(io.link).not.toHaveBeenCalled();expect(io.update).not.toHaveBeenCalled();expect(io.event).not.toHaveBeenCalled()
  expect(io.rpc.mock.calls.map(([port])=>port)).toEqual(['gridex_actor_has_company_permission'])
 })
 it('refuses a caller flag/string instead of an actual operator ID',async()=>{
  await expect(process({actorUserId:'verified',edielMessageId:source.id})).rejects.toThrow('ediel_tenant_actor_required')
  expect(io.rpc).not.toHaveBeenCalled();expect(io.link).not.toHaveBeenCalled()
 })
})
it('the persistence adapter cannot reach a service RPC without a real executing actor tuple',async()=>{
 const input={companyId:company,sourceMessageId:source.id,environment:'test' as const,messageCode:'E66',rawPayload:'observed',contracts:[],transactions:[]}
 await expect(persistUtiltsTransactionResults({...input,actorUserId:undefined as unknown as string})).rejects.toThrow('execution_actor_required')
 expect(io.rpc).not.toHaveBeenCalled()
})
