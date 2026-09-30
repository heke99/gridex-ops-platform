import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { expect,it } from 'vitest'

const API='http://127.0.0.1:54321', DB='postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote=(value:string)=>`'${value.replaceAll("'","''")}'`
const service=createClient(API,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}})
function sql<T>(command:string):T {
  if(process.env.CI!=='true' || process.env.NEXT_PUBLIC_SUPABASE_URL!==API) throw new Error('ops_effect_local_only')
  return JSON.parse(execFileSync('psql',[DB,'-XAtq','-v','ON_ERROR_STOP=1'],{input:command,encoding:'utf8',timeout:20_000}).trim()) as T
}
async function actor(company:string,tag:string,permissions:string[]) {
  const email=`ops-effect-${tag}-${randomUUID()}@example.invalid`, role=randomUUID(), key=`ops_effect_${randomUUID().replaceAll('-','')}`
  const result=await service.auth.admin.createUser({email,password:process.env.GRIDEX_OPS_EFFECT_PASSWORD!,email_confirm:true})
  expect(result.error).toBeNull(); if(!result.data.user) throw new Error('ops_effect_auth_actor_missing')
  const id=result.data.user.id
  const keys=permissions.map(quote).join(',')
  sql(`INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(id)},${quote(email)},'Synthetic OPS actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.roles(id,key,name,scope) VALUES(${quote(role)},${quote(key)},'Synthetic OPS role','company');
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at) VALUES(${quote(company)},${quote(id)},'member','active',now());
    INSERT INTO public.user_roles(user_id,company_id,role_id,role) VALUES(${quote(id)},${quote(company)},${quote(role)},${quote(key)});
    INSERT INTO public.permissions(key,name,description,category) SELECT key,key,'Synthetic OPS effects','test' FROM unnest(ARRAY[${keys}]::text[]) AS candidate(key) ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key) SELECT ${quote(role)},${quote(key)},id,key FROM public.permissions WHERE key IN(${keys}); SELECT to_jsonb(true);`)
  const client=createClient(API,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}})
  expect((await client.auth.signInWithPassword({email,password:process.env.GRIDEX_OPS_EFFECT_PASSWORD!})).error).toBeNull()
  const context=await client.rpc('canonical_authenticated_tenant_context',{p_selected_company_id:company})
  expect(context.error).toBeNull();expect(context.data).toMatchObject({authorized:true,is_platform_admin:false,selected_company_id:company})
  for(const permission of permissions) expect((context.data as {permissions:string[]}).permissions).toContain(permission)
  return {id,email}
}
function foreignSnapshot(company:string) {
  return sql<unknown>(`SELECT jsonb_build_object(
    'connection',(SELECT to_jsonb(t) FROM public.billing_provider_connections t WHERE company_id=${quote(company)} AND provider='capway_aptic' AND environment='test'),
    'event',(SELECT to_jsonb(t) FROM public.invoice_provider_events t WHERE company_id=${quote(company)}),
    'runs',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.billing_export_runs t WHERE company_id=${quote(company)}),
    'items',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.billing_export_run_items t WHERE company_id=${quote(company)}),
    'metric',(SELECT to_jsonb(t) FROM public.company_monthly_metrics t WHERE company_id=${quote(company)}));`)
}
const billingHeaders=['export_run_item_id','idempotency_key','payload_version','adapter_key','external_reference','billing_underlay_id','contract_id','customer_id','site_id','metering_point_id','status','readiness_status','energy_direction','settlement_type','period_year','period_month','total_kwh','base_amount_sek_ex_vat','calculated_amount_sek_ex_vat','vat_sek','total_sek_inc_vat','pricing_line_items','interval_evidence','invoice_recipient','invoice_email','invoice_reference','billing_level','consolidated_invoice','consolidated_invoice_group_key','invoice_address_snapshot','site_address_snapshot','blocker_reasons'].join(';')

it('seeds isolated OPS effects/download actors or independently checks their actual browser effects',async()=>{
  const temp=process.env.RUNNER_TEMP, path=resolve(process.env.GRIDEX_OPS_EFFECT_FIXTURE_PATH!)
  if(!temp || !path.startsWith(resolve(temp)+sep)) throw new Error('ops_effect_fixture_must_stay_in_runner_temp')
  if(process.env.GRIDEX_OPS_EFFECT_VERIFY_AFTER_BROWSER==='1') {
    const fixture=JSON.parse(readFileSync(path,'utf8')) as {a:string;b:string;writerId:string;foreignBefore:unknown;eventA:string;connectionA:string}
    expect(foreignSnapshot(fixture.b)).toEqual(fixture.foreignBefore)
    const state=sql<Record<string,unknown>>(`SELECT jsonb_build_object(
      'connection',(SELECT jsonb_build_object('status',status,'actor',updated_by,'result',last_test_result) FROM public.billing_provider_connections WHERE id=${quote(fixture.connectionA)}),
      'event',(SELECT jsonb_build_object('status',status,'attempt',attempt_count) FROM public.invoice_provider_events WHERE id=${quote(fixture.eventA)}),
      'audit',(SELECT count(*) FROM public.audit_logs WHERE company_id=${quote(fixture.a)} AND actor_user_id=${quote(fixture.writerId)} AND action='invoice_provider_events_reprocessed'),
      'environments',(SELECT bool_and(operating_environment='test') FROM public.companies WHERE id IN(${quote(fixture.a)},${quote(fixture.b)})));`)
    expect(state).toMatchObject({connection:{status:'incomplete',actor:fixture.writerId,result:{ok:false,environment:'test',billing_activation_allowed:false}},event:{status:'needs_review',attempt:1},environments:true})
    expect(Number(state.audit)).toBeGreaterThanOrEqual(1)
    console.log('OPS_EFFECT_NATIVE_POSTCHECK_PASS connection_failure_persisted=true no_provider_dispatch=true reprocess_correct_company=true foreign_snapshot_unchanged=true')
    return
  }
  const a=randomUUID(),b=randomUUID(),connectionA=randomUUID(),connectionB=randomUUID(),eventA=randomUUID(),eventB=randomUUID(),runA=randomUUID(),runB=randomUUID(),itemA=randomUUID(),itemB=randomUUID()
  sql(`INSERT INTO public.companies(id,name,status,operating_environment) VALUES(${quote(a)},'Synthetic OPS company A','active','test'),(${quote(b)},'Synthetic OPS company B','active','test'); SELECT to_jsonb(true);`)
  const writer=await actor(a,'writer',['billing_underlay.read','pricing.write','reports.read'])
  const reader=await actor(a,'reader',['billing_underlay.read'])
  const denied=await actor(a,'denied',['users.read'])
  sql(`INSERT INTO public.billing_provider_connections(id,company_id,provider,environment,status,display_name,settings) VALUES
    (${quote(connectionA)},${quote(a)},'capway_aptic','test','incomplete','Synthetic disconnected A','{"auth_mode":"apikey","base_url":"http://127.0.0.1:1"}'),
    (${quote(connectionB)},${quote(b)},'capway_aptic','test','incomplete','Synthetic disconnected B','{"auth_mode":"apikey","base_url":"http://127.0.0.1:1"}');
    INSERT INTO public.invoice_provider_events(id,company_id,provider,provider_invoice_guid,event_type,status,payload,environment)
    VALUES(${quote(eventA)},${quote(a)},'capway_aptic',${quote('unmatched-'+randomUUID())},'invoice.paid','needs_review','{}','test'),(${quote(eventB)},${quote(b)},'capway_aptic',${quote('unmatched-'+randomUUID())},'invoice.paid','needs_review','{}','test');
    INSERT INTO public.company_monthly_metrics(company_id,month,actual_kwh,created_at,updated_at) VALUES(${quote(a)},'2026-09-01',100,'2026-09-30T00:00:00Z','2026-09-30T00:00:00Z'),(${quote(b)},'2026-09-01',999,'2026-09-30T00:00:00Z','2026-09-30T00:00:00Z');
    INSERT INTO public.billing_export_runs(id,company_id,period_month,status,export_format,rows_total,rows_blocked) VALUES(${quote(runA)},${quote(a)},'2026-09','blocked','csv',1,1),(${quote(runB)},${quote(b)},'2026-09','blocked','csv',1,1);
    INSERT INTO public.billing_export_run_items(id,company_id,billing_export_run_id,status,readiness_status,invoice_recipient,invoice_email,invoice_reference,payload_snapshot)
    VALUES(${quote(itemA)},${quote(a)},${quote(runA)},'blocked','blocked','Synthetic; A','billing-a@example.invalid','Download A','{"underlay":{"underlay_year":2026,"underlay_month":9,"total_kwh":100,"total_sek_ex_vat":100},"pricing":{"subtotalSekExVat":100,"vatSek":25,"totalSekIncVat":125}}'),
      (${quote(itemB)},${quote(b)},${quote(runB)},'blocked','blocked','Synthetic B','billing-b@example.invalid','Download B','{}'); SELECT to_jsonb(true);`)
  // Missing api_key_header ALWAYS makes the actual resolver fail before any
  // client/token/Ping network operation, even if CI carries default env secrets.
  const connectionSettings=sql<Record<string,unknown>>(`SELECT settings FROM public.billing_provider_connections WHERE id=${quote(connectionA)};`)
  expect(connectionSettings).toMatchObject({auth_mode:'apikey'});expect(connectionSettings.api_key_header).toBeUndefined()
  const metric=sql<Record<string,unknown>>(`SELECT row_to_json(t) FROM public.company_monthly_metrics t WHERE company_id=${quote(a)};`)
  const expectedAnalytics=Object.keys(metric).join(';')+'\n'+Object.values(metric).map(value=>value??'').join(';')
  const expectedBilling=billingHeaders+'\n'+[itemA,'','billing_export_item_v4c','gridex_billing_partner_v1','','','','','','','blocked','blocked','consumption','invoice',2026,9,100,100,100,25,125,'[]','[]','"Synthetic; A"','billing-a@example.invalid','Download A','customer',false,'','{}','{}','[]'].join(';')
  writeFileSync(path,JSON.stringify({a,b,writerId:writer.id,writerEmail:writer.email,readerEmail:reader.email,deniedEmail:denied.email,connectionA,eventA,runA,runB,expectedAnalytics,expectedBilling,foreignBefore:foreignSnapshot(b)}),{mode:0o600})
  console.log('OPS_EFFECT_NATIVE_SEED_PASS real_gotrue=true test_only=true provider_network_precondition_blocked=true isolated_A_B=true')
})
