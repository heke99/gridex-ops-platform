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
it('completion acknowledgement loss overwrites a completed ledger with failed, then blocks replay',async()=>{
 await expect(run()).rejects.toMatchObject({message:'synthetic transport response lost after committed completion'})
 expect(m.mutations).toBe(1)
 expect(m.updates.map(p=>p.status)).toEqual(['completed','failed'])
 expect(m.updates[0].filters).toHaveProperty('status','processing')
 expect(m.updates[1].filters).not.toHaveProperty('status')
 expect(m.row).toMatchObject({status:'failed',response_status:201,response_body:{entity_id:'created_public'}})
 m.loseCompletionAck=false
 await expect(run()).rejects.toMatchObject({status:409,code:'idempotency_previous_attempt_failed'})
 expect(m.mutations).toBe(1)
})
it('successful completion replays normally with no second mutation',async()=>{
 m.loseCompletionAck=false
 expect(await run()).toMatchObject({statusCode:201,replayed:false})
 expect(await run()).toMatchObject({statusCode:201,replayed:true,body:{entity_id:'created_public'}})
 expect(m.row!.status).toBe('completed');expect(m.mutations).toBe(1)
})
