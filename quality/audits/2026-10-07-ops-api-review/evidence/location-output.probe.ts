import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import Ajv from 'ajv'
type ResolutionInsertFixture = Record<string, unknown>
type LocationProbeResult = { data: unknown; error: null; count?: number }
type LocationProbeQuery = { select: () => LocationProbeQuery; in: () => LocationProbeQuery; or: () => LocationProbeQuery; eq: () => LocationProbeQuery; order: () => LocationProbeQuery; limit: () => LocationProbeQuery; insert: (value: ResolutionInsertFixture) => LocationProbeQuery; single: () => Promise<LocationProbeResult>; maybeSingle: () => Promise<LocationProbeResult>; then: (f: (result: LocationProbeResult) => unknown) => Promise<unknown> }
const m=vi.hoisted(()=>({stale:false,name:'Synthetic area' as string|null,ambiguous:false,saved:[] as ResolutionInsertFixture[]}))
vi.mock('@/lib/integrations/apiAuth',()=>({requireIntegrationApiAccess:vi.fn(async()=>({ok:true,client:{id:'synthetic-client',company_id:'synthetic-company'}})),logIntegrationApiRequest:vi.fn(async()=>{})}))
vi.mock('@/lib/partner-api/simple',()=>({handleSimplePartnerApi:vi.fn()}))
vi.mock('@/lib/energy/canonicalEnergyEvents',()=>({recordCanonicalEnergyEvent:vi.fn(async()=>{})}))
vi.mock('@/lib/grid-owners/verification',()=>({getGridOwnerVerification:vi.fn(async()=>({verificationStatus:'verified',verifiedForCustomerFlow:true,canUseForProdat:true,reasons:[]}))}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{
 from:(table:string)=>{let inserted: ResolutionInsertFixture | null=null;const area={grid_area_code:'SYN',grid_area_name:m.name,grid_owner_id:'platform-owner',grid_owner_name:'Synthetic owner',price_area:'SE3',platform_grid_owners:{name:'Synthetic owner',ops_grid_owner_id:'ops-owner'}};const result=(single=false): LocationProbeResult=>{
 if(table==='platform_address_lookup_cache')return{data:{address_key:'synthetic',latitude:59,longitude:18,sweref99_x:123,sweref99_y:456,confidence:.98},error:null};
 if(table==='platform_grid_owners')return{data:{ops_grid_owner_id:'ops-owner'},error:null};
 if(table==='energy_geodata_versions')return{data:{version_key:'synthetic',verified_at:m.stale?'2020-01-01T00:00:00Z':new Date().toISOString()},error:null};
 if(table==='customer_site_resolution'){if(inserted)m.saved.push(inserted);return{data:{id:'synthetic-resolution'},error:null}}
 if(table==='platform_postal_code_grid_mappings')return{data:[{postal_code:'12345',city:'Synthetic',grid_area_code:'SYN',price_area:'SE3',confidence:.9},...(m.ambiguous?[{postal_code:'12345',city:'Other',grid_area_code:'SYO',price_area:'SE4',confidence:.9}]:[])],count:m.ambiguous?2:1,error:null};
 if(table==='platform_grid_areas')return{data:single?area:[area,...(m.ambiguous?[{grid_area_code:'SYO',price_area:'SE4'}]:[])],error:null};
 return{data:null,error:null}};const b: LocationProbeQuery={select:()=>b,in:()=>b,or:()=>b,eq:()=>b,order:()=>b,limit:()=>b,insert:(x)=>{inserted=x;return b},single:async()=>result(true),maybeSingle:async()=>result(true),then:(f)=>Promise.resolve(result()).then(f)};return b},
 rpc:async()=>({data:[{grid_area_code:'SYN',grid_area_name:m.name,grid_owner_id:'platform-owner',grid_owner_name:'Synthetic owner',price_area:'SE3',confidence:.98}],error:null})
}}))
import {handleBusinessPartnerApi} from '@/lib/partner-api/business'
import {partnerPublicOpenApi} from '@/lib/partner-api/businessOpenApi'
const ajv=new Ajv({allErrors:true,unknownFormats:'ignore'})
const validate=ajv.compile({...partnerPublicOpenApi.components.schemas.LocationResponse,components:partnerPublicOpenApi.components})
function request(path='location',full=true){return new NextRequest('https://example.invalid/api/partner/v1/'+path+'?postal_code=12345'+(full?'&address=Synthetic%201&city=Synthetic':''))}
beforeEach(()=>{m.stale=false;m.name='Synthetic area';m.ambiguous=false;m.saved=[]})
it('fresh complete address succeeds and validates against published location schema',async()=>{const r=await handleBusinessPartnerApi(request(),'GET',['location']);expect(r?.status).toBe(200);const body=await r!.json();expect(body.location.status).toBe('resolved');expect(validate(body)).toBe(true)})
it('real resolver marks stale polygon unresolved while real location route says resolved verified',async()=>{m.stale=true;const r=await handleBusinessPartnerApi(request(),'GET',['location']);expect(r?.status).toBe(200);const body=await r!.json();expect(m.saved[0].price_area_assurance_status).toBe('unresolved');expect(m.saved[0].automation_allowed).toBe(false);expect(body.location).toMatchObject({status:'resolved',grid_area:{verified:true},grid_owner:{verified:true},warnings:['svk_geodata_stale_or_unverified']})})
it('same stale location is rejected by current-price readiness guard',async()=>{m.stale=true;const r=await handleBusinessPartnerApi(request('price/current'),'GET',['price','current']);expect(r?.status).toBe(422);expect((await r!.json()).error.code).toBe('location_not_resolved')})
it('actual optional missing area name returns null rejected by OpenAPI 3.1 type',async()=>{m.name=null;const r=await handleBusinessPartnerApi(request(),'GET',['location']);expect(r?.status).toBe(200);const body=await r!.json();expect(body.location.grid_area.name).toBe(null);expect(partnerPublicOpenApi.openapi).toBe('3.1.0');expect(validate(body)).toBe(false);expect(validate.errors).toEqual(expect.arrayContaining([expect.objectContaining({keyword:'type',dataPath:'.location.grid_area.name'})]))})
it('postal-only partial response marks owner provisional but null city/name violates published schema',async()=>{const r=await handleBusinessPartnerApi(request('location',false),'GET',['location']);expect(r?.status).toBe(200);const body=await r!.json();expect(body.location).toMatchObject({status:'partial',city:null,grid_owner:{verified:false},grid_area:{verified:false,name:null}});expect(validate(body)).toBe(false)})
it('conflicting postal price areas reject guessing and emit409 with null price area',async()=>{m.ambiguous=true;const r=await handleBusinessPartnerApi(request('location',false),'GET',['location']);expect(r?.status).toBe(409);expect((await r!.json()).error.location).toMatchObject({status:'ambiguous',price_area:null,requires_address:true})})
