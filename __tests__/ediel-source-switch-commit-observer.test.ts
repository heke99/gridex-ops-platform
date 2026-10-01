import {beforeEach, expect, it, vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({writes:[] as string[], supplyPaths:[] as string[], failSupply:false, supplyExists:true,
 storedSwitch:true,storedCustomer:true,receipt:null as Record<string,unknown>|null,rpc:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:(table:string)=>{
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
const resetPersistence=()=>{io.writes=[];io.supplyPaths=[];io.receipt=null}
beforeEach(()=>{
 vi.clearAllMocks();resetPersistence();io.failSupply=false;io.supplyExists=true;io.storedSwitch=true;io.storedCustomer=true
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  expect(name).toBe('gridex_apply_inbound_switch_lifecycle_v1')
  expect(args).toEqual({p_source_message_id:'source',p_actor_user_id:'actor'})
  // Controlled committed-state adapter for the real business wrapper. Missing
  // stored graph and failed period writes return the canonical command error,
  // with no commit receipt or effects. SQL rollback is verified separately.
  if(!io.storedSwitch || !io.storedCustomer)return {data:null,error:new Error('inbound_switch_resource_scope_mismatch')}
  if(io.failSupply)return {data:null,error:new Error('supply failed')}
  if(io.receipt)return {data:{...io.receipt,replayed:true},error:null}
  io.supplyPaths.push(io.supplyExists?'update':'insert')
  io.writes.push('supplier_switch_requests','customer_supply_periods')
  io.receipt={outcome:'supplier_switch_accepted',tenantMessage:'Confirmed',reviewRequired:false,
   updated:['supplier_switch_requests','customer_supply_periods'],metadata:{},switchRequestId:'switch',
   supplyPeriodId:'supply',caseId:null,replayed:false}
  return {data:io.receipt,error:null}
 })
})
it.each([true,false])('observes actual successful Z04 confirmation and supply persistence (existing=%s)',async existing=>{
 io.supplyExists=existing
 const observed=vi.fn(async()=>{expect(io.writes).toEqual(['supplier_switch_requests','customer_supply_periods'])})
 const input={actorUserId:'actor',message:message(),matchedSwitchRequestId:'switch',onSourceSwitchCommitted:observed}
 const result=await applyInboundBusinessStateMachine(input)
 expect(result.outcome).toBe('supplier_switch_accepted')
 expect(io.supplyPaths).toEqual([existing?'update':'insert'])
 expect(observed).toHaveBeenCalledTimes(1)
 expect(observed).toHaveBeenCalledWith({message:input.message,switchRequestId:'switch',supplyPeriodId:'supply'})
})
it('never observes a partially failed business operation',async()=>{
 io.failSupply=true;const observer=vi.fn()
 await expect(applyInboundBusinessStateMachine({actorUserId:'actor',message:message(),matchedSwitchRequestId:'switch',...{onSourceSwitchCommitted:observer}})).rejects.toThrow('supply failed')
 expect(io.writes).toEqual([]);expect(io.receipt).toBeNull()
 expect(observer).not.toHaveBeenCalled()
})
it.each(['no correlation','no customer'])('does not manufacture a committed decision from %s',async reason=>{
 const observer=vi.fn();const row=message();if(reason==='no customer'){row.customer_id=null;io.storedCustomer=false}else io.storedSwitch=false
 await expect(applyInboundBusinessStateMachine({actorUserId:'actor',message:row,matchedSwitchRequestId:reason==='no correlation'?null:'switch',...{onSourceSwitchCommitted:observer}})).rejects.toThrow('inbound_switch_resource_scope_mismatch')
 expect(io.writes).toEqual([]);expect(io.receipt).toBeNull()
 expect(observer).not.toHaveBeenCalled()
})
it('an unavailable evidence sink leaves the original business result unchanged',async()=>{
 const input={actorUserId:'actor',message:message(),matchedSwitchRequestId:'switch'}
 const baseline=await applyInboundBusinessStateMachine(input)
 // Compare two independent fresh persistence scenarios, rather than using a
 // permanent replay to claim a newly issued observer capability.
 resetPersistence()
 const observer=vi.fn(async()=>{throw new Error('unavailable evidence store')})
 const observed=await applyInboundBusinessStateMachine({...input,onSourceSwitchCommitted:observer} as typeof input)
 expect(observer).toHaveBeenCalledTimes(1)
 expect(observed).toEqual(baseline)
})
it('permanent command replay preserves the result without a new transient commit observation',async()=>{
 const observer=vi.fn(),input={actorUserId:'actor',message:message(),matchedSwitchRequestId:'switch',onSourceSwitchCommitted:observer}
 const fresh=await applyInboundBusinessStateMachine(input),replay=await applyInboundBusinessStateMachine(input)
 expect(fresh).toMatchObject({outcome:'supplier_switch_accepted',replayed:false})
 expect(replay).toMatchObject({outcome:'supplier_switch_accepted',replayed:true})
 expect(observer).toHaveBeenCalledTimes(1);expect(io.writes).toEqual(['supplier_switch_requests','customer_supply_periods'])
})
