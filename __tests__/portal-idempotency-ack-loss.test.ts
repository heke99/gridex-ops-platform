// ops-api-review: F19 (permanent regression from evidence/idempotency-ack-loss.probe.ts)
import { beforeEach,expect,it,vi } from 'vitest'
import { NextRequest } from 'next/server'
const m=vi.hoisted(()=>({row:null as Record<string,unknown>|null,loseCompletionAck:true,updates:[] as Record<string,unknown>[],mutations:0}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from(table:string){
 if(table!=='customer_portal_write_idempotency')throw Error('unexpected table')
 let action='read',payload:Record<string,unknown>={},filters:Record<string,unknown>={}
 const terminal=async()=>{
  if(action==='insert'){
   if(m.row)return {data:null,error:{code:'23505'}}
   m.row={...payload,id:'ledger_synthetic'};return {data:m.row,error:null}
  }
  if(action==='update'){
   if(!m.row||!Object.entries(filters).every(([k,v])=>m.row![k]===v))return {data:null,error:null}
   Object.assign(m.row,payload);m.updates.push({...payload,filters:{...filters}})
   if(payload.status==='completed'&&m.loseCompletionAck)return {data:null,error:{message:'synthetic transport response lost after committed completion'}}
   return {data:{id:m.row.id},error:null}
  }
  return {data:m.row,error:null}
 }
 const b={insert(p:Record<string,unknown>){action='insert';payload=p;return b},update(p:Record<string,unknown>){action='update';payload=p;return b},select(){return b},eq(k:string,v:unknown){filters[k]=v;return b},is(k:string,v:unknown){filters[k]=v;return b},maybeSingle:terminal,then(resolve:(v:unknown)=>unknown){return terminal().then(resolve)}}
 return b
}}}))
import { executeIdempotentPortalWrite } from '@/lib/api/strictRequest'
beforeEach(()=>{m.row=null;m.loseCompletionAck=true;m.updates=[];m.mutations=0})
function run(){return executeIdempotentPortalWrite({request:new NextRequest('https://example.invalid',{headers:{'idempotency-key':'synthetic_ack_loss'}}),companyId:'company_synthetic',clientId:'client_synthetic',customerId:'customer_synthetic',operation:'/api/partner/v1/customer',payload:{name:'Synthetic'},execute:async()=>{m.mutations++;return {statusCode:201,body:{entity_id:'created_public'}}}})}
it('F19: lost completion acknowledgement keeps the completed ledger and replays it',async()=>{
 const first=await run()
 expect(first).toMatchObject({statusCode:201,replayed:false,body:{entity_id:'created_public'}})
 expect(m.updates.map(p=>p.status)).toEqual(['completed'])
 m.loseCompletionAck=false
 const replay=await run()
 expect(m.row).toMatchObject({status:'completed'})
 expect(replay.statusCode).toBe(201)
 expect(replay.replayed).toBe(true)
 expect(m.mutations).toBe(1)
})
it('business failure marks only a processing ledger failed',async()=>{
 const failing=()=>executeIdempotentPortalWrite({request:new NextRequest('https://example.invalid',{headers:{'idempotency-key':'synthetic_fail'}}),companyId:'company_synthetic',clientId:'client_synthetic',customerId:'customer_synthetic',operation:'/api/partner/v1/customer',payload:{name:'Synthetic'},execute:async()=>{m.mutations++;throw new Error('synthetic business failure')}})
 await expect(failing()).rejects.toBeTruthy()
 expect(m.updates).toHaveLength(1)
 expect(m.updates[0]).toMatchObject({status:'failed',filters:{status:'processing'}})
})
it('successful completion replays normally with no second mutation',async()=>{
 m.loseCompletionAck=false
 expect(await run()).toMatchObject({statusCode:201,replayed:false})
 expect(await run()).toMatchObject({statusCode:201,replayed:true,body:{entity_id:'created_public'}})
 expect(m.row!.status).toBe('completed');expect(m.mutations).toBe(1)
})
