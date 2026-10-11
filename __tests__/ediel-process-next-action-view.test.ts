import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const io=vi.hoisted(()=>({permissions:['communication.read','cases.write','customers.write','communication.send'],requestStatus:'waiting_for_z02',
  watchStatus:'pending',readDenied:false,active:true,requestSentAt:'2026-10-01T12:00:00Z' as string|null,rpc:vi.fn()}))
vi.mock('@/lib/admin/guards',()=>({requireAdminPageKeyAccess:async()=>({userId:'actor',companyId:'own',email:'operator@example.invalid',permissions:io.permissions})}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:{id:'actor'}}})}})}))
vi.mock('@/lib/tenant/scope',()=>({getOperationalCompanyScope:async()=>({companyId:'own',memberships:[{companyId:'own',status:io.active?'active':'inactive',companyStatus:'active'}]})}))
vi.mock('@/components/admin/AdminHeader',()=>({default:({title}:{title:string})=>React.createElement('header',null,title)}))
vi.mock('@/app/admin/customer-info-requests/actions',()=>Object.fromEntries(['applyZ14SnapshotAction','createAuthorizationScopeAction','createCustomerInfoRequestAction','createMeteringPermissionDraftAction','queueCustomerInfoRequestAction','queueMeteringPermissionZ13Action'].map(name=>[name,()=>{throw Error('No view may execute '+name)}])))
vi.mock('@/lib/onboarding/infoRequests',()=>({
  listCustomersForInfoRequestSelector:async()=>[],listAuthorizationScopes:async()=>[],listMeteringPermissions:async()=>[],
  listCustomerInfoRequestResourceOptions:async()=>({sites:[],meteringPoints:[],gridOwners:[]}),
  listCustomerInfoRequests:async()=>[{id:'own-request',company_id:'own',customer_id:'own-customer',status:io.requestStatus,request_type:'z01_customer_masterdata',
    target_party_type:'grid_owner',target_party_name:'Synthetic DSO',ediel_message_id:'own-source',sent_at:io.requestSentAt}],
}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc}}))
vi.mock('@/lib/supabase/tenantDb',()=>({tenantDb:(company:string)=>{
  if(company!=='own')throw Error('foreign page read')
  return {from:(table:string)=>{if(table!=='ediel_messages')throw Error('Unexpected table:'+table);return {select:()=>({in:async()=>({error:null,data:[{
    id:'own-source',company_id:'own',environment:'test',direction:'outbound',message_family:'PRODAT',message_code:'Z01',status:'sent',
    requires_contrl:true,contrl_status:'received',contrl_due_at:null,requires_aperak:false,aperak_status:'not_required',
  }]})})}}}
}}))
import Page from '@/app/admin/customer-info-requests/page'
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-01T12:20:00Z'))
  io.permissions=['communication.read','cases.write','customers.write','communication.send'];io.requestStatus='waiting_for_z02';io.watchStatus='pending';io.readDenied=false;io.active=true;io.requestSentAt='2026-10-01T12:00:00Z';io.rpc.mockReset()
  io.rpc.mockImplementation(async(name,args)=>{
    expect(['gridex_ediel_business_expectations_v1','gridex_ediel_metering_method_expectations_v1']).toContain(name);expect(args.p_input).toMatchObject({companyId:'own',actorUserId:'actor',messageId:'own-source',action:'read'})
    if(name==='gridex_ediel_metering_method_expectations_v1')return {error:null,data:[]}
    return io.readDenied?{error:Error('ediel_expectation_actor_not_authorized'),data:null}:{error:null,data:args.p_input.environment==='test'?[{
      id:'own-watch',source_message_id:'own-source',expected_code:'Z02',due_at:'2026-10-01T12:30:00Z',status:io.watchStatus,metadata:{anchorType:'actual_accepted_smtp_observed_at',anchorAt:'2026-10-01T12:00:00Z',timerKind:'internal_sender_watch',remoteReceiptKnown:false},
    }]:[]}
  })
})
afterEach(()=>vi.useRealTimers())
describe('OPS02 actual customer-info server view',()=>{
  it('renders independently qualified business wait after CONTRL and suppresses repeated Z01 preparation',async()=>{
    const html=renderToStaticMarkup(await Page())
    expect(html).toContain('Nästa processåtgärd');expect(html).toContain('Z02 eller negativ APERAK');expect(html).toContain('Ansvar');expect(html).toContain('Tidsgrund');expect(html).toContain('Hinder');expect(html).toContain('Tillåtna åtgärder')
    expect(html).not.toContain('Kontrollera fullmakt och förbered Z01');expect(io.rpc).toHaveBeenCalledTimes(4)
  })
  it('actual fulfilled/rejected outcome changes displayed next action without following the old waiting status',async()=>{
    io.watchStatus='fulfilled';let html=renderToStaticMarkup(await Page());expect(html).toContain('Affärssvaret är kvalificerat.')
    io.watchStatus='rejected';html=renderToStaticMarkup(await Page());expect(html).toContain('negativa affärssvaret');expect(html).toContain('Granska manuellt');expect(html).not.toContain('Kontrollera fullmakt och förbered Z01')
  })
  it('denied actual private owner read stays held and cannot fall back to stale waiting/ready metadata',async()=>{
    io.readDenied=true;const html=renderToStaticMarkup(await Page())
    expect(html).toContain('Processbeslutet kunde inte hämtas');expect(html).not.toContain('Nästa processåtgärd');expect(html).not.toContain('Kontrollera fullmakt och förbered Z01')
  })
  it('no current communication read does not load source facts or offer operations for a sent request',async()=>{
    io.permissions=['customers.read'];const html=renderToStaticMarkup(await Page())
    expect(html).toContain('Läsbehörighet till kommunikation krävs');expect(io.rpc).not.toHaveBeenCalled();expect(html).not.toContain('Kontrollera fullmakt och förbered Z01')
  })
})
