import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({writes:[] as {table:string;row:Record<string,unknown>}[],rpc:vi.fn(),failSupply:false,failCase:false}))
const validCaseTypes=new Set(['withdrawal','rejected_customer','onboarding_aborted','supplier_switch_aborted','sales_misunderstanding','dual_invoice_concern','binding_period_too_long','incorrect_identity','incorrect_site_data','missing_authorization','credit_risk','technical_blocker','business_rejection','technical_rejection','metering_values_error','supplier_switch_review','other'])
vi.mock('@/lib/supabase/service',()=>({supabaseService:{rpc:io.rpc,from:(table:string)=>{
 let values:Record<string,unknown>|null=null
 const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,limit:()=>q,
  update:(row:Record<string,unknown>)=>{values=row;io.writes.push({table,row});return q},
  insert:(row:Record<string,unknown>)=>{values=row;io.writes.push({table,row});return q},
  maybeSingle:async()=>({data:{id:'supply'},error:null}),
  single:async()=>({data:{id:'case'},error:io.failCase?Error('case unavailable'):
   values&&'customer_site_id' in values?Error('customer_cases has no customer_site_id'):
   table==='customer_cases'&&!validCaseTypes.has(String(values?.case_type))?Error('customer_cases_type_check'):null}),
  then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[{id:'supply'}],error:null}).then(resolve)}
 return q
}}}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:async()=>null}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
function message(subtype='L'){return {id:'source',company_id:'company',customer_id:'customer',site_id:'site',metering_point_id:'point',message_family:'PRODAT',message_code:'Z05',direction:'inbound',raw_payload:null,parsed_payload:{subtype,end_date:'2026-10-15'}} as unknown as EdielMessageRow}
const scope={p_company_id:'company',p_source_message_id:'source',p_actor_user_id:'actor'}
// Synthetic database boundary only: SQL source/owner qualification and durable
// projection require native supply evidence beyond these consumer tests.
const acceptedEnd={applied:true,idempotent:false,periods:[{id:'supply',company_id:'company',customer_id:'customer',metering_point_id:'point',
 status:'ending',source_message_id:'accepted-start',source_end_message_id:'source',end_date:'2026-10-15',market_end_at:'2026-10-14T23:00:00.000Z'}]}
beforeEach(()=>{
 io.writes=[];io.failSupply=false;io.failCase=false;io.rpc.mockReset()
 io.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>{
  expect(name).toBe('ediel_apply_supply_source_v1');expect(args).toEqual(scope)
  return {data:{applied:false,reason:'canonical_supply_source_not_accepted',periods:[]},error:io.failSupply?Error('supply unavailable'):null}
 })
})
const acceptEnd=()=>io.rpc.mockImplementationOnce(async(name:string,args:Record<string,unknown>)=>{
 expect(name).toBe('ediel_apply_supply_source_v1');expect(args).toEqual(scope)
 return {data:acceptedEnd,error:null}
})
it.each(['L','LK'])('completes source-bound %s closure and retains a schema-valid tenant/point-linked final-work case',async subtype=>{
 acceptEnd()
 const result=await applyInboundBusinessStateMachine({message:message(subtype),actorUserId:'actor'})
 expect(result).toMatchObject({outcome:'supply_terminated',reviewRequired:false,updated:['customer_supply_periods','customer_cases'],
  tenantMessage:'Leveransslutet är registrerat och träder i kraft vid nätägarens giltiga sluttid.'})
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1',scope)
 expect(io.writes).toHaveLength(1)
 expect(io.writes[0]).toMatchObject({table:'customer_cases',row:{company_id:'company',customer_id:'customer',site_id:'site',metering_point_id:'point',
  case_type:'other',status:'open',reason_category:'final_metering_and_billing',source:'ediel_inbound_state_machine',
  title:'Leveransen upphör – slutför mätvärden och fakturering',next_action:'Kontrollera slutmätvärden och faktureringsberedskap vid angiven giltig sluttid.',
  metadata:{source_ediel_message_id:'source',review_intent:'final_metering_and_billing'}}})
 expect(io.writes[0].row).not.toHaveProperty('customer_site_id')
})
it('still propagates a failed supply write before creating a review case',async()=>{
 io.failSupply=true
 await expect(applyInboundBusinessStateMachine({message:message(),actorUserId:'actor'})).rejects.toThrow('supply unavailable')
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1',scope)
 expect(io.writes).toEqual([])
})
it('does not hide a failed case write after the accepted source-bound end',async()=>{
 acceptEnd();io.failCase=true
 await expect(applyInboundBusinessStateMachine({message:message(),actorUserId:'actor'})).rejects.toThrow('case unavailable')
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1',scope)
 expect(io.writes.map(item=>item.table)).toEqual(['customer_cases'])
})
it.each(['L','LK','C'])('holds unqualified Z05%s without supply or review-case mutation',async subtype=>{
 const result=await applyInboundBusinessStateMachine({message:message(subtype),actorUserId:'actor'})
 expect(result).toMatchObject({outcome:'manual_review_required',reviewRequired:true,updated:[],
  tenantMessage:'Leveranshändelsen inväntar säker koppling till rätt original, objekt och giltighetstid.'})
 expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1',scope)
 expect(io.writes).toEqual([])
})
it.each([
 ['E64','Z06','masterdata_update_received','masterdata_update_review','Masterdataändring mottagen – granska säker uppdatering','Granska Ediel safe-apply-förslaget innan masterdata ändras.'],
 ['M','Z10','meter_change_received','meter_change_review','Mätarbyte mottaget – granska säker uppdatering','Granska Ediel safe-apply-förslaget innan masterdata ändras.'],
 ['H','Z08','unexpected_direction_review','ediel_unexpected_direction','Ediel-meddelande med oväntad marknadsriktning','Verifiera avsändarroll, meddelandekod, subtype och route innan någon affärseffekt tillåts.'],
] as const)('persists schema-valid %s/%s review with distinct intent and no unauthorized mutation',async(subtype,code,outcome,intent,title,nextAction)=>{
 const source={...message(subtype),message_code:code}
 const result=await applyInboundBusinessStateMachine({message:source,actorUserId:'actor'})
 expect(result).toMatchObject({outcome,reviewRequired:true,updated:['customer_cases']})
 expect(io.writes).toEqual([{table:'customer_cases',row:expect.objectContaining({
  company_id:'company',customer_id:'customer',site_id:'site',metering_point_id:'point',
  case_type:'other',status:'open',reason_category:intent,source:'ediel_inbound_state_machine',title,next_action:nextAction,
  metadata:expect.objectContaining({source_ediel_message_id:'source',message_family:'PRODAT',message_code:code,review_intent:intent}),
 })}])
 expect(io.writes[0].row).not.toHaveProperty('customer_site_id')
})
it.each([['APERAK','business_rejection'],['CONTRL','technical_rejection'],['UTILTS_ERR','metering_values_error']] as const)('preserves supported %s rejection case category',async(family,caseType)=>{
 const source={...message(),message_family:family,message_code:'E01',ack_outcome:'negative' as const}
 const result=await applyInboundBusinessStateMachine({message:source,actorUserId:'actor'})
 expect(result.outcome).toBe(caseType)
 expect(io.writes[0]).toMatchObject({table:'customer_cases',row:{case_type:caseType,reason_category:'ediel_inbound_review'}})
})
