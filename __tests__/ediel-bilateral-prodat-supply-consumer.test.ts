// masterplan: AT-Z04H-SUPPLIER
// masterplan: P-13, AT-P-13
// masterplan: P-16, AT-P-16
import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {closureFixture} from './helpers/closureWireFixtures'
import {createHash} from 'node:crypto'
const io=vi.hoisted(()=>({writes:[] as {table:string;row:Record<string,unknown>}[],failSupply:false,failCase:false,supplyRows:[] as Record<string,unknown>[],
 source:null as EdielMessageRow|null,nativeCalls:[] as Record<string,unknown>[],committed:false}))
const validCaseTypes=new Set(['withdrawal','rejected_customer','onboarding_aborted','supplier_switch_aborted','sales_misunderstanding','dual_invoice_concern','binding_period_too_long','incorrect_identity','incorrect_site_data','missing_authorization','credit_risk','technical_blocker','business_rejection','technical_rejection','metering_values_error','supplier_switch_review','other'])
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:(name:string,args:Record<string,unknown>)=>{
 // Finite external native-result transport for the final-work case consumer.
 // It cannot prove native source qualification, RLS or market persistence.
 expect(name).toBe('ediel_apply_supply_source_v1')
 expect(io.source).not.toBeNull()
 expect(args).toEqual({p_company_id:io.source!.company_id,p_source_message_id:io.source!.id,p_actor_user_id:'actor'})
 expect(Object.keys(args)).toHaveLength(3)
 io.nativeCalls.push({...args})
 if(io.failSupply)return {data:null,error:Error('supply unavailable')}
 // No cancellation original or immutable C reversal exists in this fixture.
 if(io.source!.parsed_payload?.nativeHold===true)return {data:{applied:false,reason:'supply_original_unavailable',idempotent:false,periods:[],commits:[]},error:null}
 expect(io.source!.raw_payload).toContain('CAV+Z25')
 expect(createHash('sha256').update(io.source!.raw_payload!).digest('hex')).toHaveLength(64)
 io.committed=true
 return {data:{applied:true,idempotent:false,periods:[{id:'supply',status:io.source!.message_code==='Z04'?'confirmed_by_grid_owner':'ended'}],commits:io.source!.message_code==='Z04'?[{switchRequestId:'native-switch',supplyPeriodId:'supply',customerId:'customer',meteringPointId:'point',siteId:'site'}]:[]},error:null}
},from:(table:string)=>{
 let values:Record<string,unknown>|null=null
 const q={select:()=>q,eq:()=>q,in:()=>q,is:()=>q,order:()=>q,limit:()=>q,
  update:(row:Record<string,unknown>)=>{values=row;io.writes.push({table,row});return q},
  insert:(row:Record<string,unknown>)=>{values=row;io.writes.push({table,row});return q},
  maybeSingle:async()=>({data:{id:'supply'},error:null}),
  single:async()=>({data:{id:'case'},error:io.failCase?Error('case unavailable'):
   values&&'customer_site_id' in values?Error('customer_cases has no customer_site_id'):
   table==='customer_cases'&&!validCaseTypes.has(String(values?.case_type))?Error('customer_cases_type_check'):null}),
  then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:table==='customer_supply_periods'&&values===null?io.supplyRows:[{id:'supply'}],error:io.failSupply?Error('supply unavailable'):null}).then(resolve)}
 return q
}}}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:async()=>null}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
function message(code='Z04',hold=false){const wire=closureFixture({reason:'Z25',minute:'202610150000'}).wire.replace('BGM+Z05','BGM+'+code).replace('DTM+93','DTM+'+(code==='Z04'?'92':'93'));const row={id:'source',company_id:'company',environment:'test',customer_id:'customer',site_id:'site',metering_point_id:'point',message_family:'PRODAT',message_code:code,direction:'inbound',raw_payload:wire,parsed_payload:{subtype:'H',nativeHold:hold,bilateralCapabilityVerified:true}} as unknown as EdielMessageRow;io.source=structuredClone(row);return row}
beforeEach(()=>{io.writes=[];io.failSupply=false;io.failCase=false;io.supplyRows=[{id:'supply',customer_id:'customer',metering_point_id:'point'}];io.source=null;io.nativeCalls=[];io.committed=false})
it('real H start consumer waits for exact external native commit and publishes only its committed scope once',async()=>{
 const observed:unknown[]=[];const result=await applyInboundBusinessStateMachine({message:message(),actorUserId:'actor',onSourceSwitchCommitted:async value=>{observed.push(value)}})
 expect(result).toMatchObject({outcome:'supplier_switch_accepted',reviewRequired:false,updated:['supplier_switch_requests','customer_supply_periods']});expect(io.nativeCalls).toHaveLength(1);expect(observed).toHaveLength(1);expect(observed[0]).toMatchObject({switchRequestId:'native-switch',supplyPeriodId:'supply',message:{customer_id:'customer',site_id:'site',metering_point_id:'point'}});expect(io.writes).toEqual([])
})
it('caller bilateral marker cannot create H success when the actual native owner holds',async()=>{
 const observed:unknown[]=[];const result=await applyInboundBusinessStateMachine({message:message('Z04',true),actorUserId:'actor',onSourceSwitchCommitted:async value=>{observed.push(value)}})
 expect(result).toMatchObject({outcome:'manual_review_required',reviewRequired:true,updated:[]});expect(io.nativeCalls).toHaveLength(1);expect(io.committed).toBe(false);expect(observed).toEqual([]);expect(io.writes).toEqual([])
})
it('real H end consumer creates final-work task only after its exact native period end',async()=>{
 const result=await applyInboundBusinessStateMachine({message:message('Z05'),actorUserId:'actor'})
 expect(result).toMatchObject({outcome:'supply_terminated',reviewRequired:false,updated:['customer_supply_periods','customer_cases']});expect(io.nativeCalls).toHaveLength(1);expect(io.writes).toHaveLength(1);expect(io.writes[0]).toMatchObject({table:'customer_cases',row:{company_id:'company',metering_point_id:'point',reason_category:'final_metering_and_billing'}})
})
it('failed native H commit propagates before any positive consumer scope or case',async()=>{
 io.failSupply=true;await expect(applyInboundBusinessStateMachine({message:message(),actorUserId:'actor'})).rejects.toThrow('supply unavailable');expect(io.writes).toEqual([]);expect(io.committed).toBe(false)
})
