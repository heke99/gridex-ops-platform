// masterplan: U-19, AT-U-19
// The real UTILTS link caller passes its transaction-resolved point to the
// request correlator, so a unique TN naming another point's request is not
// bound and the own point's request wins.
import {beforeEach,expect,it,vi} from 'vitest'
const db=vi.hoisted(()=>({rows:{} as Record<string,Array<Record<string,unknown>>>,links:[] as Array<Record<string,unknown>>}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 const filters:Array<(r:Record<string,unknown>)=>boolean>=[]
 const rows=()=>(db.rows[table]??[]).filter(r=>filters.every(f=>f(r)))
 const q:Record<string,unknown>={}
 Object.assign(q,{select:()=>q,order:()=>q,or:()=>q,
  eq:(c:string,v:unknown)=>{filters.push(r=>r[c]===v);return q},
  in:(c:string,v:unknown[])=>{filters.push(r=>v.includes(r[c]));return q},
  limit:async(n:number)=>({data:rows().slice(0,n),error:null}),
  maybeSingle:async()=>({data:rows()[0]??null,error:null})})
 return q}}}))
vi.mock('@/lib/ediel/db',async(orig)=>({...(await orig<object>()),linkEdielMessage:async(p:Record<string,unknown>)=>{db.links.push(p)}}))
import {linkInboundUtiltsMessageCanonically} from '@/lib/ediel/flows/utiltsDataRequest.part-1'
import type {EdielMessageRow} from '@/lib/ediel/types'

const message={id:'m1',company_id:'c1',direction:'inbound',message_family:'UTILTS',message_code:'E66',metering_point_id:null,
 grid_owner_data_request_id:null,external_reference:null,transaction_reference:null,
 parsed_payload:{references:{TN:['PRODAT-CASE-1']}}} as unknown as EdielMessageRow
const transactionMatches=[{meteringPointId:'mp-own',externalMeteringPointId:'735999000000000001'}] as never
beforeEach(()=>{db.links=[];db.rows={grid_owner_data_requests:[
 {id:'req-other',company_id:'c1',external_reference:'PRODAT-CASE-1',metering_point_id:'mp-other'},
 {id:'req-own',company_id:'c1',external_reference:'OWN',metering_point_id:'mp-own'}]}})

it('a TN naming another point is not bound when the transaction resolved the own point',async()=>{
 const result=await linkInboundUtiltsMessageCanonically({actorUserId:'u',message,transactionMatches})
 expect(result.meteringPointId).toBe('mp-own')
 expect(result.matchedDataRequest?.id).toBe('req-own')
 expect(db.links[0]).toMatchObject({gridOwnerDataRequestId:'req-own',meteringPointId:'mp-own'})
})
it('a TN naming the same point still binds through the caller',async()=>{
 db.rows.grid_owner_data_requests[0].metering_point_id='mp-own'
 const result=await linkInboundUtiltsMessageCanonically({actorUserId:'u',message,transactionMatches})
 expect(result.matchedDataRequest?.id).toBe('req-other')
})
