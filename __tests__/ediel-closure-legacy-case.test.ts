import {beforeEach,expect,it,vi} from 'vitest'
import type {EdielMessageRow} from '@/lib/ediel/types'
const io=vi.hoisted(()=>({writes:[] as {table:string;row:Record<string,unknown>}[],failSupply:false,failCase:false}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:(table:string)=>{
 let values:Record<string,unknown>|null=null
 const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,limit:()=>q,
  update:(row:Record<string,unknown>)=>{values=row;io.writes.push({table,row});return q},
  insert:(row:Record<string,unknown>)=>{values=row;io.writes.push({table,row});return q},
  maybeSingle:async()=>({data:{id:'supply'},error:null}),
  single:async()=>({data:{id:'case'},error:io.failCase?Error('case unavailable'):
   values&&'customer_site_id' in values?Error('customer_cases has no customer_site_id'):
   values?.case_type!=='other'?Error('customer_cases_type_check'):null}),
  then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:[{id:'supply'}],error:io.failSupply?Error('supply unavailable'):null}).then(resolve)}
 return q
}}}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:async()=>null}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {applyInboundBusinessStateMachine} from '@/lib/ediel/flows/inboundBusinessStateMachine'
function message(subtype='L'){return {id:'source',company_id:'company',customer_id:'customer',site_id:'site',metering_point_id:'point',message_family:'PRODAT',message_code:'Z05',direction:'inbound',raw_payload:null,parsed_payload:{subtype,end_date:'2026-10-15'}} as unknown as EdielMessageRow}
beforeEach(()=>{io.writes=[];io.failSupply=false;io.failCase=false})
it.each(['L','LK'])('completes %s closure and retains a schema-valid tenant/point-linked final-work case',async subtype=>{
 const result=await applyInboundBusinessStateMachine({message:message(subtype),actorUserId:'actor'})
 expect(result).toMatchObject({outcome:'supply_terminated',updated:['customer_supply_periods','customer_cases']})
 expect(io.writes[0]).toMatchObject({table:'customer_supply_periods',row:{status:'ended',source_message_id:'source',end_date:'2026-10-15'}})
 expect(io.writes[1]).toMatchObject({table:'customer_cases',row:{company_id:'company',customer_id:'customer',site_id:'site',metering_point_id:'point',
  case_type:'other',status:'open',reason_category:'final_metering_and_billing',source:'ediel_inbound_state_machine',
  title:'Leveransen upphör – slutför mätvärden och fakturering',next_action:'Kontrollera slutmätvärden och faktureringsberedskap för leveransens slutdatum.',
  metadata:{source_ediel_message_id:'source',review_intent:'final_metering_and_billing'}}})
 expect(io.writes[1].row).not.toHaveProperty('customer_site_id')
})
it('still propagates a failed supply write before creating a review case',async()=>{
 io.failSupply=true
 await expect(applyInboundBusinessStateMachine({message:message(),actorUserId:'actor'})).rejects.toThrow('supply unavailable')
 expect(io.writes.map(item=>item.table)).toEqual(['customer_supply_periods'])
})
it('does not hide a failed case write after the persisted legacy end',async()=>{
 io.failCase=true
 await expect(applyInboundBusinessStateMachine({message:message(),actorUserId:'actor'})).rejects.toThrow('case unavailable')
 expect(io.writes.map(item=>item.table)).toEqual(['customer_supply_periods','customer_cases'])
})
