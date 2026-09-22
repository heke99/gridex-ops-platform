import {beforeEach, expect, it, vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({writes:[] as string[], failSupply:false, supplyExists:true}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 let write=false
 const q={select:()=>q,eq:()=>q,lte:()=>q,or:()=>q,limit:()=>q,
 update:()=>{write=true;io.writes.push(table);return q},insert:()=>{write=true;io.writes.push(table);return q},
 maybeSingle:async()=>({data:io.supplyExists?{id:'supply'}:null,error:null}),
 single:async()=>({data:{id:'supply'},error:io.failSupply?{message:'supply failed'}:null}),
 then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data:[{id:table==='supplier_switch_requests'?'switch':'supply'}],error:write&&table==='customer_supply_periods'&&io.failSupply?new Error('supply failed'):null}).then(resolve)}
 return q
}}}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:async()=>null}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
const message=()=>({id:'source',company_id:'company',customer_id:'customer',metering_point_id:'point',site_id:'site',message_family:'PRODAT',message_code:'Z04',direction:'inbound',parsed_payload:{subtype:'L',start_date:'2026-10-01'},raw_payload:null} as unknown as EdielMessageRow)
beforeEach(()=>{io.writes=[];io.failSupply=false;io.supplyExists=true})
it.each([true,false])('observes actual successful Z04 confirmation and supply persistence (existing=%s)',async existing=>{
 io.supplyExists=existing
 const observed=vi.fn(async()=>{expect(io.writes).toEqual(['supplier_switch_requests','customer_supply_periods'])})
 const input={actorUserId:'actor',message:message(),matchedSwitchRequestId:'switch',onSourceSwitchCommitted:observed}
 const result=await applyInboundBusinessStateMachine(input)
 expect(result.outcome).toBe('supplier_switch_accepted')
 expect(observed).toHaveBeenCalledTimes(1)
 expect(observed).toHaveBeenCalledWith({message:input.message,switchRequestId:'switch',supplyPeriodId:'supply'})
})
it('never observes a partially failed business operation',async()=>{
 io.failSupply=true;const observer=vi.fn()
 await expect(applyInboundBusinessStateMachine({actorUserId:'actor',message:message(),matchedSwitchRequestId:'switch',...{onSourceSwitchCommitted:observer}})).rejects.toThrow('supply failed')
 expect(observer).not.toHaveBeenCalled()
})
it.each(['no correlation','no customer'])('does not manufacture a committed decision from %s',async reason=>{
 const observer=vi.fn();const row=message();if(reason==='no customer')row.customer_id=null
 await applyInboundBusinessStateMachine({actorUserId:'actor',message:row,matchedSwitchRequestId:reason==='no correlation'?null:'switch',...{onSourceSwitchCommitted:observer}})
 expect(observer).not.toHaveBeenCalled()
})
it('an unavailable evidence sink leaves the original business result unchanged',async()=>{
 const input={actorUserId:'actor',message:message(),matchedSwitchRequestId:'switch'}
 const baseline=await applyInboundBusinessStateMachine(input)
 const observer=vi.fn(async()=>{throw new Error('unavailable evidence store')})
 const observed=await applyInboundBusinessStateMachine({...input,onSourceSwitchCommitted:observer} as typeof input)
 expect(observer).toHaveBeenCalledTimes(1)
 expect(observed).toEqual(baseline)
})
