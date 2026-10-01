import {randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {createTenantSupportCase} from '@/lib/customer-cases/support'
import {createCustomerCase,updateCustomerCaseStatus} from '@/lib/customer-cases/db'
import {enqueue} from '@/lib/customer-operations/automation.part-1'

type SupportBoundaryNativeDependencies={
 sql:<T>(query:string)=>T
 literal:(value:unknown)=>string
 limitedActor:(companyIds:string[])=>string
 seed:()=>Promise<{companyId:string}>
}
// Registration occurs at the original caller's position. SQL/auth/seed helpers
// and the contiguous original proof body are preserved without mocks.
export function registerLegacySupportBoundaryNative({sql,literal,limitedActor,seed}:SupportBoundaryNativeDependencies){
// Generic support is private intake. Dedicated withdrawal remains the explicit
// business stop writer; recording a support case never grants economic authority.
function supportOpsActor(companyId:string,canWrite=true){
 const userId=limitedActor([companyId]),sessionId=randomUUID()
 sql(`INSERT INTO auth.sessions(id,user_id,created_at,updated_at,not_after)
  VALUES(${literal(sessionId)},${literal(userId)},now(),now(),clock_timestamp()+interval '1 hour');
  ${canWrite?`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
   SELECT ${literal(userId)},${literal(companyId)},id,key FROM public.permissions WHERE key='cases.write';`:''}`)
 expect(sql(`SELECT to_jsonb(private.gridex_profile_session_active_v1(${literal(userId)},${literal(sessionId)}))`)).toBe(true)
 expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(userId)},${literal(companyId)},'cases.write'))`)).toBe(canWrite)
 return {kind:'ops' as const,userId,sessionId}
}
function supportBusinessFixture(companyId:string){
 const customerId=randomUUID(),contractId=randomUUID(),underlayId=randomUUID(),invoiceId=randomUUID()
 const infoId=randomUUID(),permissionId=randomUUID(),outboundId=randomUUID(),exportId=randomUUID(),switchId=randomUUID(),priorJobId=randomUUID()
 sql(`INSERT INTO public.customers(id,company_id,first_name,last_name)
  VALUES(${literal(customerId)},${literal(companyId)},'Synthetic','Support boundary');
  INSERT INTO public.customer_contracts(id,company_id,customer_id,status)
  VALUES(${literal(contractId)},${literal(companyId)},${literal(customerId)},'draft');
  INSERT INTO public.billing_underlays(id,company_id,customer_id,contract_id,customer_contract_id,total_kwh,total_sek_ex_vat,underlay_month,underlay_year)
  VALUES(${literal(underlayId)},${literal(companyId)},${literal(customerId)},${literal(contractId)},${literal(contractId)},100,125,9,2026);
  INSERT INTO public.customer_invoices(id,company_id,customer_id,customer_contract_id,billing_underlay_id,status,amount_ex_vat,vat_amount,amount_inc_vat)
  VALUES(${literal(invoiceId)},${literal(companyId)},${literal(customerId)},${literal(contractId)},${literal(underlayId)},'draft',125,31.25,156.25);
  INSERT INTO public.customer_invoice_lines(company_id,customer_id,invoice_id,description,quantity,unit_price,amount_ex_vat,vat_amount,amount_inc_vat)
  VALUES(${literal(companyId)},${literal(customerId)},${literal(invoiceId)},'Synthetic existing billed energy',100,1.25,125,31.25,156.25);
  INSERT INTO public.customer_info_requests(id,company_id,customer_id,status)
  VALUES(${literal(infoId)},${literal(companyId)},${literal(customerId)},'draft');
  INSERT INTO public.metering_permissions(id,company_id,customer_id,status)
  VALUES(${literal(permissionId)},${literal(companyId)},${literal(customerId)},'draft');
  INSERT INTO public.outbound_requests(id,company_id,customer_id,request_type,status)
  VALUES(${literal(outboundId)},${literal(companyId)},${literal(customerId)},'z01_customer_masterdata','queued');
  INSERT INTO public.partner_exports(id,company_id,customer_id,billing_underlay_id,target_system,status)
  VALUES(${literal(exportId)},${literal(companyId)},${literal(customerId)},${literal(underlayId)},'synthetic_native_no_provider','queued');
  INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,status)
  VALUES(${literal(switchId)},${literal(companyId)},${literal(customerId)},'draft');
  INSERT INTO public.customer_operation_jobs(id,company_id,customer_id,job_type,idempotency_key,status)
  VALUES(${literal(priorJobId)},${literal(companyId)},${literal(customerId)},'request_customer_data',${literal(priorJobId)},'queued');`)
 return {customerId,contractId,underlayId,invoiceId,infoId,permissionId,outboundId,exportId,switchId,priorJobId}
}
const supportBusinessTables=['customers','customer_contracts','customer_supply_periods','billing_underlays',
 'customer_invoices','customer_invoice_lines','invoice_documents','customer_info_requests','metering_permissions',
 'outbound_requests','partner_exports','supplier_switch_requests','supplier_switch_events','customer_operation_jobs',
 'customer_operation_events','customer_operation_tasks','customer_lifecycle_decisions','canonical_domain_events','canonical_event_outbox'] as const
function supportBusinessSnapshot(companyId:string){
 return sql<Record<string,unknown[]>>(`SELECT jsonb_build_object(${supportBusinessTables.map(table=>
  `${literal(table)},(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) FROM public.${table} t WHERE company_id=${literal(companyId)})`).join(',')})`)
}
it('generic private support preserves the prior financial lifecycle and operation graph while capturing one canonical case command',async()=>{
 const f=await seed(),business=supportBusinessFixture(f.companyId),key=randomUUID(),actor=supportOpsActor(f.companyId)
 const readonly=supportOpsActor(f.companyId,false),before=supportBusinessSnapshot(f.companyId)
 for(const table of ['billing_underlays','customer_invoices','customer_invoice_lines','customer_contracts','supplier_switch_requests','customer_operation_jobs']) expect(before[table]).toHaveLength(1)
 const input={companyId:f.companyId,customerId:business.customerId,title:'Synthetic native support case',channel:'admin' as const,
  idempotencyKey:key,actorUserId:actor.userId,actor}
 await expect(createTenantSupportCase({...input,actor:readonly,actorUserId:readonly.userId})).rejects.toMatchObject({code:'support_actor_forbidden',status:403})
 expect(supportBusinessSnapshot(f.companyId)).toEqual(before)
 expect(sql(`SELECT jsonb_build_object(
  'cases',(SELECT count(*) FROM public.customer_cases WHERE company_id=${literal(f.companyId)}),
  'messages',(SELECT count(*) FROM public.customer_support_messages WHERE company_id=${literal(f.companyId)}),
  'audits',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${literal(f.companyId)} AND event_type='CUSTOMER_SUPPORT_COMMAND'),
  'results',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${literal(f.companyId)} AND command_type='customer.support.command.v1'))`))
 .toEqual({cases:0,messages:0,audits:0,results:0})
 const created=await createTenantSupportCase(input)
 expect(created.reused).toBe(false)
 expect((await createTenantSupportCase(input)).reused).toBe(true)
 const caseId=created.case.id
 expect(created.case).toMatchObject({status:'open',billing_blocked:false,billing_manual_review:false,support_revision:1})
 expect(supportBusinessSnapshot(f.companyId)).toEqual(before)
 expect(sql(`SELECT jsonb_agg(jsonb_build_object('table',table_name,'operation',operation,
  'company',company_id,'customer',new_fact->>'customer_id','eventType',new_fact->>'event_type') ORDER BY id)
  FROM gridex_correction_process.facts WHERE table_name IN ('customer_cases','customer_case_events')
  AND (row_id=${literal(caseId)} OR new_fact->>'customer_case_id'=${literal(caseId)})`))
 .toEqual([{table:'customer_cases',operation:'INSERT',company:f.companyId,customer:business.customerId,eventType:null},
  {table:'customer_case_events',operation:'INSERT',company:f.companyId,customer:business.customerId,eventType:'support_create'}])
 expect(sql(`SELECT jsonb_build_object(
  'audits',(SELECT count(*) FROM public.canonical_audit_events WHERE company_id=${literal(f.companyId)} AND aggregate_id=${literal(caseId)} AND event_type='CUSTOMER_SUPPORT_COMMAND'),
  'results',(SELECT count(*) FROM public.canonical_command_results WHERE company_id=${literal(f.companyId)} AND command_type='customer.support.command.v1' AND result_payload->>'caseId'=${literal(caseId)}),
  'internalMessages',(SELECT count(*) FROM public.customer_support_messages WHERE company_id=${literal(f.companyId)} AND customer_case_id=${literal(caseId)} AND visibility='internal'),
  'customerPublications',(SELECT count(*) FROM public.customer_case_publications WHERE company_id=${literal(f.companyId)} AND customer_case_id=${literal(caseId)}))`))
 .toEqual({audits:1,results:1,internalMessages:1,customerPublications:0})
 await expect(updateCustomerCaseStatus({caseId,companyId:f.companyId,status:'action_required',actorUserId:readonly.userId}))
  .rejects.toThrow(/customer_case_status_actor_not_authorized/)
 expect(sql(`SELECT to_jsonb(status) FROM public.customer_cases WHERE id=${literal(caseId)}`)).toBe('open')
 const changed=await updateCustomerCaseStatus({caseId,companyId:f.companyId,status:'action_required',message:'Synthetic follow up',actorUserId:actor.userId})
 expect(changed.status).toBe('action_required')
 expect(supportBusinessSnapshot(f.companyId)).toEqual(before)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_correction_process.facts
  WHERE table_name='customer_cases' AND row_id=${literal(caseId)} AND operation='UPDATE' AND new_fact->>'status'='action_required'`)).toBe(1)
 const jobInput={companyId:f.companyId,customerId:business.customerId,actorUserId:actor.userId,
  jobType:'request_customer_data' as const,idempotencyKey:`native:${key}`,payload:{caseId}}
 const job=await enqueue(jobInput)
 expect(job.duplicate).toBe(false)
 expect(await enqueue(jobInput)).toMatchObject({id:job.id,duplicate:true})
 expect(sql(`SELECT jsonb_build_object('operation',operation,'company',company_id,'customer',new_fact->>'customer_id','jobType',new_fact->>'job_type')
  FROM gridex_correction_process.facts WHERE table_name='customer_operation_jobs' AND row_id=${literal(job.id)} AND operation='INSERT'`))
 .toEqual({operation:'INSERT',company:f.companyId,customer:business.customerId,jobType:'request_customer_data'})
 expect(sql(`SELECT to_jsonb(t) FROM public.customer_operation_jobs t WHERE id=${literal(business.priorJobId)}`)).toEqual(before.customer_operation_jobs[0])
 console.log('SUPPORT_PRIVATE_FINANCIAL_LIFECYCLE_BOUNDARY_NATIVE_PASS nonempty_prior_graph_unchanged=true live_session=true readonly_denied=true one_private_command=true no_implicit_stop=true')
})
it('the separate explicit withdrawal writer retains business stops and immutable lifecycle evidence',async()=>{
 const f=await seed(),business=supportBusinessFixture(f.companyId),actor=supportOpsActor(f.companyId)
 const before=supportBusinessSnapshot(f.companyId),now=sql<string>('SELECT to_jsonb(clock_timestamp())')
 // Exercise the real legacy domain writer, separate from generic support.
 // This is producer/effect proof, not acceptance of its non-atomic caller gate.
 const created=await createCustomerCase({companyId:f.companyId,customerId:business.customerId,customerContractId:business.contractId,
  caseType:'withdrawal',title:'Synthetic explicitly requested withdrawal',agreementChannel:'phone',isDistanceAgreement:true,
  agreementCreatedAt:now,withdrawalInformationSentAt:now,withdrawalRequestedAt:now,actorUserId:actor.userId})
 expect(created).toMatchObject({case_type:'withdrawal',status:'billing_blocked',billing_blocked:true,withdrawal_scenario:'before_prodat_sent',cancellation_required:false})
 expect(sql(`SELECT jsonb_build_object(
  'info',(SELECT status FROM public.customer_info_requests WHERE id=${literal(business.infoId)}),
  'metering',(SELECT status FROM public.metering_permissions WHERE id=${literal(business.permissionId)}),
  'outbound',(SELECT status FROM public.outbound_requests WHERE id=${literal(business.outboundId)}),
  'export',(SELECT status FROM public.partner_exports WHERE id=${literal(business.exportId)}),
  'billing',(SELECT readiness_status FROM public.billing_underlays WHERE id=${literal(business.underlayId)}),
  'billingCase',(SELECT billing_blocked_by_case_id FROM public.billing_underlays WHERE id=${literal(business.underlayId)}),
  'contract',(SELECT status FROM public.customer_contracts WHERE id=${literal(business.contractId)}),
  'switch',(SELECT status FROM public.supplier_switch_requests WHERE id=${literal(business.switchId)}),
  'switchBlocked',(SELECT lifecycle_blocked FROM public.supplier_switch_requests WHERE id=${literal(business.switchId)}),
  'decisions',(SELECT count(*) FROM public.customer_lifecycle_decisions WHERE company_id=${literal(f.companyId)} AND source_customer_case_id=${literal(created.id)} AND decision_type='withdrawal' AND billing_blocked))`))
 .toEqual({info:'cancelled',metering:'cancelled',outbound:'cancelled',export:'cancelled',billing:'blocked',billingCase:created.id,
  contract:'cancelled_by_customer',switch:'cancelled_before_start',switchBlocked:true,decisions:1})
 const after=supportBusinessSnapshot(f.companyId)
 expect(after.customer_invoices).toEqual(before.customer_invoices);expect(after.customer_invoice_lines).toEqual(before.customer_invoice_lines)
 expect(after.invoice_documents).toEqual(before.invoice_documents);expect(after.customer_operation_jobs).toEqual(before.customer_operation_jobs)
 expect(sql(`SELECT jsonb_agg(new_fact->>'event_type' ORDER BY id) FROM gridex_correction_process.facts
  WHERE table_name='customer_case_events' AND new_fact->>'customer_case_id'=${literal(created.id)}`))
  .toEqual(expect.arrayContaining(['created','operational_stop_applied','supplier_switches_paused']))
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_correction_process.facts WHERE operation='UPDATE'
  AND row_id=${literal(business.switchId)} AND new_fact->>'status'='cancelled_before_start'`)).toBe(1)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_correction_process.facts WHERE table_name='supplier_switch_events'
  AND new_fact->>'switch_request_id'=${literal(business.switchId)} AND new_fact->>'event_type'='lifecycle_blocked'`)).toBe(1)
 console.log('EXPLICIT_WITHDRAWAL_OPERATIONAL_STOP_NATIVE_PASS real_legacy_writer=true actual_stop_graph=true immutable_switch_and_case_facts=true invoices_and_existing_jobs_retained=true')
})
}
