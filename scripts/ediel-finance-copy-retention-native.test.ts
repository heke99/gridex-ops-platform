import {type SupabaseClient} from '@supabase/supabase-js'
import {randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const ports=vi.hoisted(()=>({client:null as SupabaseClient|null,company:''}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{if(!ports.client)throw Error('actual_native_jwt_required');return ports.client}}))
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:ports.company})})}))
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {seedFinanceCopyRetentionNativeFixture} from './helpers/ediel-finance-copy-retention-native-fixture'
import {FINANCE_COPY_CATALOG} from '@/lib/ediel/retention/financeCopies.catalog'
import {POST} from '@/app/api/ediel/finance-copy-retention/route'
async function http(client:SupabaseClient,body:unknown){ports.client=client;return POST(new NextRequest('http://localhost/api/ediel/finance-copy-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))}
afterEach(()=>{ports.client=null;ports.company='';vi.unstubAllEnvs()})
it('all sixteen native finance copy classes match actual installed source columns and private decisions cannot be forged by app roles',()=>{
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.finance_class_catalog`)).toBe(16)
 for(const spec of FINANCE_COPY_CATALOG)for(const col of spec.bodyColumns)expect(sql(`SELECT to_jsonb(EXISTS(SELECT FROM pg_attribute WHERE attrelid=${literal(spec.sourceTable)}::regclass AND attname=${literal(col)} AND NOT attisdropped AND atttypid IN('jsonb'::regtype,'text'::regtype)))`),`${spec.sourceTable}.${col}`).toBe(true)
 for(const role of ['anon','authenticated','service_role'])for(const table of ['finance_decisions','finance_reviews','finance_tombstones','finance_events'])expect(()=>sql(`SET ROLE ${role};SELECT * FROM gridex_ediel_retention.${table}`)).toThrow(/permission denied/)
},120000)
it('real manual financial draft/calculate/review/approve/lock owners produce separate snapshot and audit classes; real GoTrue HTTP independently reviews/redacts each without repeating the old audit body or changing money/hash/status metadata',async()=>{
 const f=await seedFinanceCopyRetentionNativeFixture();ports.company=f.companyId
 for(const [k,target,table,cols]of [['settlement_calculation_body',f.target,'portfolio_monthly_settlements',['calculation_snapshot']],['settlement_audit_body',f.audit,'portfolio_settlement_audit_log',['old_values','new_values','reason']]] as const){
  const inspected=await http(f.writer.client,{action:'basis',retentionClass:k,targetId:target});expect(inspected.status,await inspected.clone().text()).toBe(200);const basis=await inspected.json();expect(basis).toMatchObject({sourceBound:true,allIncludedScopesClosed:true,complete:false,authority:'none'})
  const doc=Buffer.from('SYNTHETIC separate finance source '+k),submitted=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:target,documentBase64:doc.toString('base64'),issuerReceipt:f.policy(basis,doc)});expect(submitted.status,await submitted.clone().text()).toBe(200);const decision=await submitted.json();expect(decision.issuerQualified).toBe(true)
  expect((await http(f.writer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'same actor denied'})).status).toBe(403)
  const reviewed=await http(f.reviewer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'SYNTHETIC separate actual finite native period'});expect(reviewed.status,await reviewed.clone().text()).toBe(200)
  const before=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM public.${table} r WHERE id::text=${literal(target)}`),auditBefore=sql<number>(`SELECT to_jsonb(count(*)) FROM public.portfolio_settlement_audit_log WHERE settlement_id=${literal(f.target)}`)
  expect((await http(f.readonly.client,{action:'purge',decisionId:decision.decisionId})).status).toBe(403)
  const result=await http(f.writer.client,{action:'purge',decisionId:decision.decisionId});expect(result.status,await result.clone().text()).toBe(200);expect(await result.json()).toMatchObject({status:'redacted',replay:false,sourceHash:basis.sourceHash});expect((await (await http(f.writer.client,{action:'purge',decisionId:decision.decisionId})).json()).replay).toBe(true)
  const after=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM public.${table} r WHERE id::text=${literal(target)}`),metadata=(row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>!cols.some(col=>col===key)))
  expect(metadata(after)).toEqual(metadata(before));expect(sql(`SELECT to_jsonb(count(*)) FROM public.portfolio_settlement_audit_log WHERE settlement_id=${literal(f.target)}`)).toBe(auditBefore)
  for(const col of cols){const value=typeof after[col]==='string'?JSON.parse(String(after[col])):after[col];expect(value).toEqual({retentionUnavailable:true,sourceHash:basis.sourceHash,complete:false,authority:'none'})}
  expect(()=>sql(`UPDATE public.${table} SET ${cols[0]}='{}' WHERE id::text=${literal(target)}`)).toThrow(/immutable|tombstoned|append_only/)
 }
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.finance_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(2);expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)}`)).toBe(0)
},240000)
it('actual financial scope hash/source/current reviewer DENY and native late audit failure hold all unchanged bytes with no partial tombstone; hostile company selectors and read-only writes cannot reach the producer',async()=>{
 const f=await seedFinanceCopyRetentionNativeFixture();ports.company=f.companyId
 const basis=await (await http(f.writer.client,{action:'basis',retentionClass:'settlement_calculation_body',targetId:f.target})).json(),doc=Buffer.from('SYNTHETIC final rollback finance')
 const sub=await http(f.writer.client,{action:'submit',retentionClass:'settlement_calculation_body',targetId:f.target,documentBase64:doc.toString('base64'),issuerReceipt:f.policy(basis,doc)}),d=(await sub.json()).decisionId
 expect((await http(f.reviewer.client,{action:'review',decisionId:d,outcome:'approve',reason:'SYNTHETIC own exact source'})).status).toBe(200)
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES(${literal(f.reviewer.id)},${literal(f.companyId)},'ediel.retention.settlement_copy_evidence','deny',true)`);expect((await http(f.writer.client,{action:'purge',decisionId:d})).status).toBe(409);sql(`DELETE FROM public.user_permission_overrides WHERE user_id=${literal(f.reviewer.id)} AND company_id=${literal(f.companyId)}`)
 const trigger='finance_late_'+randomUUID().replaceAll('-','');sql(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.company_id=${literal(f.companyId)}::uuid AND NEW.action='ediel.retention.finance_redacted' THEN RAISE EXCEPTION 'native late finance audit rollback';END IF;RETURN NEW;END$$;CREATE TRIGGER ${trigger} BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`)
 try{expect((await http(f.writer.client,{action:'purge',decisionId:d})).status).toBe(403);expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.finance_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(0);expect((await http(f.writer.client,{action:'basis',retentionClass:'settlement_calculation_body',targetId:f.target})).status).toBe(200)}finally{sql(`DROP TRIGGER ${trigger} ON public.audit_logs;DROP FUNCTION public.${trigger}()`)}
 expect((await http(f.writer.client,{action:'basis',retentionClass:'settlement_calculation_body',targetId:f.target,companyId:randomUUID()})).status).toBe(400)
 const foreign=await seedFinanceCopyRetentionNativeFixture();ports.company=foreign.companyId;expect((await http(f.writer.client,{action:'read',decisionId:d})).status).toBe(403)
},240000)
