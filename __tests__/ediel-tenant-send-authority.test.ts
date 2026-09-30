import {beforeEach,describe,expect,it,vi} from 'vitest'
const io=vi.hoisted(()=>({membership:null as unknown,profile:null as unknown,permissions:new Map<string,boolean>(),error:null as unknown,rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
  from:(table:string)=>{
    const query={select:()=>query,eq:()=>query,not:()=>query,maybeSingle:async()=>({data:table==='company_memberships'?io.membership:io.profile,error:null})}
    return query
  },rpc:io.rpc,
}}))
import {assertEdielTenantActor} from '@/lib/ediel/services/authorization'
const company='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002'
beforeEach(()=>{
  io.membership={company_id:company,user_id:actor,status:'active',is_active:true,accepted_at:'2026-09-30T12:00:00Z'}
  io.profile={id:actor,user_status:'active'};io.permissions.clear();io.error=null
  io.rpc.mockReset().mockImplementation(async(_name:string,input:{p_permission:string})=>({data:io.permissions.get(input.p_permission)??false,error:io.error}))
})
describe('current scoped external-send authority',()=>{
  it.each(['ediel.send','communication.send'])('accepts the scoped %s grant on an active tenant member',async(permission)=>{
    io.permissions.set(permission,true)
    await expect(assertEdielTenantActor({companyId:company,actorUserId:actor,permissionAnyOf:['ediel.send','communication.send']})).resolves.toBeUndefined()
  })
  it('holds a write-only actor before external send',async()=>{
    io.permissions.set('communication.write',true);io.permissions.set('ediel_testing.write',true)
    await expect(assertEdielTenantActor({companyId:company,actorUserId:actor,permissionAnyOf:['ediel.send','communication.send']})).rejects.toThrow('ediel_tenant_permission_forbidden')
  })
  it('holds a global permission result without actual current tenant membership',async()=>{
    io.permissions.set('ediel.send',true);io.membership=null
    await expect(assertEdielTenantActor({companyId:company,actorUserId:actor,permissionAnyOf:['ediel.send','communication.send']})).rejects.toThrow('ediel_tenant_actor_forbidden')
  })
  it('does not hide a permission-read error behind another positive grant',async()=>{
    io.permissions.set('ediel.send',true);io.error=Error('permission read unavailable')
    await expect(assertEdielTenantActor({companyId:company,actorUserId:actor,permissionAnyOf:['ediel.send','communication.send']})).rejects.toThrow('permission read unavailable')
  })
})
