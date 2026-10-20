// FINDINGS F29: the admin register view read every route source in one
// unbounded Promise.all (300 parallel RPCs), exhausting the API gateway.
import {beforeEach,describe,expect,it,vi} from 'vitest'
const rpc=vi.hoisted(()=>vi.fn())
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc}}))
import {readRegistryRouteSources} from '@/lib/actor-registry/registryMarketSource'
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const qualified=(routeId:string)=>({status:'source_qualified',routeId,actorId:id(9999),market:'EL',sourceSha256:'a'.repeat(64),sourceRecordSha256:'b'.repeat(64),countryCode:'SE',legalEdielId:'16700',roles:['grid_owner'],
 wire:{actorId:id(9999),market:'EL',family:'PRODAT',environment:'production',subaddress:null,applicationReference:null,address:'ediel-16700@example.invalid',transport:'smtp',partyId:'16700',interchangePartyId:'16700'}})

describe('readRegistryRouteSources',()=>{
 // Braces: a function returned from beforeEach is run as a cleanup hook.
 beforeEach(()=>{rpc.mockReset()})

 it('reads 300 routes with at most the given number of RPCs in flight, keeping input order',async()=>{
  let inFlight=0,peak=0
  rpc.mockImplementation(async(_name:string,{p_route_id}:{p_route_id:string})=>{
   inFlight++;peak=Math.max(peak,inFlight)
   await new Promise(resolve=>setTimeout(resolve,Number(p_route_id.slice(-3))%7))
   inFlight--
   return {data:Number(p_route_id.slice(-3))%3===0?{status:'held',routeId:p_route_id,reason:'current_exact_registry_market_source_required'}:qualified(p_route_id),error:null}
  })
  const ids=Array.from({length:300},(_,n)=>id(n))
  const sources=await readRegistryRouteSources(ids,{concurrency:6})
  expect(rpc).toHaveBeenCalledTimes(300)
  expect(rpc.mock.calls.every(call=>call[0]==='ediel_registry_route_source_v1')).toBe(true)
  expect(peak).toBe(6)
  expect(sources.map(source=>source.routeId)).toEqual(ids)
  expect(sources.filter(source=>source.status==='held')).toHaveLength(100)
 })

 it('keeps the per-route validation: a malformed result rejects the whole read',async()=>{
  rpc.mockImplementation(async(_name:string,{p_route_id}:{p_route_id:string})=>({data:p_route_id===id(2)?{...qualified(p_route_id),legalEdielId:'other'}:qualified(p_route_id),error:null}))
  await expect(readRegistryRouteSources([id(1),id(2),id(3)])).rejects.toThrow('ediel_registry_route_source_result_invalid')
 })

 it('propagates a database error and rejects a non-UUID route before any call',async()=>{
  rpc.mockResolvedValue({data:null,error:{code:'42501',message:'ediel_registry_service_required'}})
  await expect(readRegistryRouteSources([id(1)])).rejects.toMatchObject({code:'42501'})
  rpc.mockReset()
  await expect(readRegistryRouteSources(['not-a-uuid'])).rejects.toThrow('ediel_registry_route_id_required')
  expect(rpc).not.toHaveBeenCalled()
 })

 it('handles an empty list without calls and refuses an invalid concurrency',async()=>{
  expect(await readRegistryRouteSources([])).toEqual([])
  expect(rpc).not.toHaveBeenCalled()
  await expect(readRegistryRouteSources([id(1)],{concurrency:0})).rejects.toThrow('ediel_registry_route_concurrency_invalid')
 })
})
