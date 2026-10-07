// Component-only route-context proof: three actual consumers, a finite Supabase
// readiness-view row port, and a separate profile-checker port. These rows do
// not prove native view materialization, certification or production approval.
import { beforeEach, describe, expect, it, vi } from 'vitest'
const io=vi.hoisted(()=>({rows:[] as Record<string,unknown>[],queries:[] as Array<{filters:[string,unknown][];orders:[string,unknown][];limit:number|null}>,
  profile:vi.fn(),event:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
  expect(table).toBe('gridex_company_route_readiness_v')
  const observed={filters:[] as [string,unknown][],orders:[] as [string,unknown][],limit:null as number|null}
  io.queries.push(observed)
  const query={
    select:(columns:string)=>{expect(columns).toBe('*');return query},
    eq:(key:string,value:unknown)=>{observed.filters.push([key,value]);return query},
    order:(key:string,options:unknown)=>{observed.orders.push([key,options]);return query},
    limit:(value:number)=>{observed.limit=value;return query},
    maybeSingle:async()=>{
      const rows=io.rows.filter(row=>observed.filters.every(([key,value])=>row[key]===value))
      expect(rows.length).toBeLessThanOrEqual(1)
      return {data:rows[0]??null,error:null}
    },
  }
  return query
}}}))
vi.mock('@/lib/ediel/routeProfileProductionReadiness',()=>({evaluateRouteProfileProductionReadiness:io.profile}))
vi.mock('@/lib/customer-operations/customerProcessEvents',()=>({emitCustomerProcessEvent:io.event}))
import { evaluateCustomerProcessRouteReadiness } from '@/lib/customer-operations/customerProcessRouteReadiness'
import type { CompanyRouteReadinessRow } from '@/lib/ediel/companyRouteReadiness'

const scope={companyId:'own-company',gridOwnerId:'own-grid',customerId:'own-customer',siteId:'own-site',actorUserId:'own-actor',
  process:'supplier_switch' as const,emitEvents:false}
function row(environment:'test'|'production',overrides:Partial<CompanyRouteReadinessRow>={}):CompanyRouteReadinessRow {
  return {company_id:scope.companyId,grid_owner_id:scope.gridOwnerId,grid_owner_name:'Synthetic Electricity Network',grid_owner_ediel_id:'67890',
    platform_market_actor_id:'network-actor',platform_actor_route_id:'network-route',message_family:'PRODAT',message_code:'Z03',environment,
    actor_registry_ready:true,platform_route_ready:true,operational_route_ready:true,send_ready:true,blocker_code:null,readiness_message:null,
    communication_route_id:environment+'-route',ediel_route_profile_id:environment+'-profile',company_market_party_route_id:environment+'-party-route',
    sender_settings_id:'own-sender',production_send_lock_status:environment==='production'?'approved':'not_required',...overrides}
}
function queried(environment:'test'|'production') {
  expect(io.queries).toEqual([{filters:[['company_id',scope.companyId],['grid_owner_id',scope.gridOwnerId],['message_family','PRODAT'],
    ['message_code','Z03'],['environment',environment]],orders:[['operational_route_ready',{ascending:false}],['send_ready',{ascending:false}]],limit:1}])
  expect(io.event).not.toHaveBeenCalled()
}
function checked(environment:'test'|'production') {
  expect(io.profile).toHaveBeenCalledExactlyOnceWith({routeProfileId:environment+'-profile',actorUserId:scope.actorUserId,applyFixes:true})
  expect(io.profile.mock.calls[0][0]).not.toHaveProperty('approveProduction')
}
beforeEach(()=>{
  io.rows.length=0;io.queries.length=0;io.profile.mockReset();io.event.mockReset()
  io.profile.mockResolvedValue({routeProfileId:'port-selected-profile',ready:true,status:'ready',blockers:[],warnings:[],updates:{},evidence:{}})
})

describe('actual Z03 customer route-context consumers with declared view/profile ports',()=>{
  it('uses the explicitly selected test route while a separate production route remains a decoy',async()=>{
    io.rows.push({...row('production')},{...row('test')})
    // The prospective public parameter is intentionally on a variable so this
    // RED compiles before the consumer gains its environment parameter.
    const input={...scope,environment:'test' as const}
    const result=await evaluateCustomerProcessRouteReadiness(input)
    expect(result).toMatchObject({ready:true,blockers:[],family:'PRODAT',code:'Z03',routeProfileId:'test-profile',communicationRouteId:'test-route'})
    queried('test');checked('test')
  })

  it('allows a qualified test-only view row through the explicit test context',async()=>{
    io.rows.push({...row('test')})
    const input={...scope,environment:'test' as const}
    const result=await evaluateCustomerProcessRouteReadiness(input)
    expect(result).toMatchObject({ready:true,blockers:[],routeProfileId:'test-profile',communicationRouteId:'test-route'})
    queried('test');checked('test')
  })

  for (const selection of ['omitted','null','production'] as const) {
    it(`keeps ${selection} environment on production and cannot borrow the test route`,async()=>{
      io.rows.push({...row('test')})
      const input=selection==='omitted'?scope:{...scope,environment:selection==='null'?null:'production' as const}
      const result=await evaluateCustomerProcessRouteReadiness(input)
      expect(result).toMatchObject({ready:false,routeProfileId:null,communicationRouteId:null})
      expect(result.blockers.map(b=>b.code)).toEqual(['route_readiness_missing'])
      queried('production');expect(io.profile).not.toHaveBeenCalled()
    })
  }

  it('retains the production checker and its unchanged fix-only options',async()=>{
    io.rows.push({...row('test')},{...row('production')})
    const result=await evaluateCustomerProcessRouteReadiness(scope)
    expect(result).toMatchObject({ready:true,routeProfileId:'production-profile',communicationRouteId:'production-route'})
    queried('production');checked('production')
  })

  for (const foreign of ['missing','company_id','grid_owner_id','message_family','message_code','environment'] as const) {
    it(`refuses a ${foreign} test view row through the actual scoped query`,async()=>{
      if(foreign!=='missing')io.rows.push({...row('test'),[foreign]:foreign==='environment'?'production':'foreign-'+foreign})
      const input={...scope,environment:'test' as const}
      const result=await evaluateCustomerProcessRouteReadiness(input)
      expect(result).toMatchObject({ready:false,routeProfileId:null,communicationRouteId:null})
      expect(result.blockers.map(b=>b.code)).toEqual(['route_readiness_missing'])
      queried('test');expect(io.profile).not.toHaveBeenCalled()
    })
  }

  it('retains disabled test-route blockers projected by the declared view port',async()=>{
    io.rows.push({...row('test',{operational_route_ready:false,send_ready:false,blocker_code:'ediel_route_profile_inactive',readiness_message:'Synthetic disabled profile'})})
    const input={...scope,environment:'test' as const}
    const result=await evaluateCustomerProcessRouteReadiness(input)
    expect(result.ready).toBe(false)
    expect(result.blockers.map(b=>b.code)).toEqual(['ediel_route_profile_inactive','route_not_send_ready'])
    queried('test');checked('test')
  })

  it('retains a production send lock without borrowing an unlocked test row or approving production',async()=>{
    io.rows.push({...row('test')},{...row('production',{send_ready:false,blocker_code:'production_send_locked',production_send_lock_status:'locked'})})
    const input={...scope,environment:'production' as const}
    const result=await evaluateCustomerProcessRouteReadiness(input)
    expect(result.ready).toBe(false)
    expect(result.blockers.map(b=>b.code)).toEqual(['production_send_locked','route_not_send_ready'])
    queried('production');checked('production')
  })

  for (const environment of ['test','production'] as const) {
    it(`retains the separate profile checker's ${environment} blockers and warnings`,async()=>{
      io.rows.push({...row(environment)})
      io.profile.mockResolvedValue({ready:false,blockers:[{code:'certificate_missing',message:'Synthetic missing certificate',severity:'blocking',metadata:{port:'profile'}}],
        warnings:[{code:'synthetic_profile_warning',message:'Synthetic profile warning',severity:'warning'}]})
      const input={...scope,environment}
      const result=await evaluateCustomerProcessRouteReadiness(input)
      expect(result.ready).toBe(false)
      expect(result.blockers).toEqual([{code:'certificate_missing',message:'Synthetic missing certificate',source:'route_profile_production_readiness',metadata:{port:'profile'}}])
      expect(result.warnings).toEqual([{code:'synthetic_profile_warning',message:'Synthetic profile warning',source:'route_profile_production_readiness',metadata:undefined}])
      queried(environment);checked(environment)
    })
  }
})
