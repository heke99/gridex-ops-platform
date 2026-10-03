import {readFileSync} from 'node:fs'
import {createHash,randomUUID} from 'node:crypto'
import {expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {createCustomerRecordRetentionNativeUser} from './helpers/ediel-customer-record-retention-native-fixture'
import {seedFinanceCopyRetentionNativeFixture} from './helpers/ediel-finance-copy-retention-native-fixture'
import {writeBrowserFixture} from './helpers/browserFixture'
type Target={retentionClass:'settlement_calculation_body'|'settlement_audit_body';targetId:string;table:string;columns:string[];documentBase64:string;documentHash:string;sourceHash:string;issuerReceipt:Record<string,string>;immutable:Record<string,unknown>;decisionId?:string}
type Fixture={companyId:string;actorId:string;actorEmail:string;reviewerId:string;reviewerEmail:string;readonlyEmail:string;foreignCompanyId:string;foreignEmail:string;settlementId:string;auditCount:number;targets:Target[]}
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex'),metadata=(row:Record<string,unknown>,columns:string[])=>Object.fromEntries(Object.entries(row).filter(([key])=>!columns.includes(key)))
it('genuine installed manual finance owners produce two separately bound archived UI scopes and post-browser receipts preserve each immutable class identity and money hash without copying removed bytes',async()=>{
 const path=process.env.GRIDEX_FINANCE_RETENTION_FIXTURE_PATH,password=process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD
 if(!path||!password||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_finance_retention_browser_fixture_required')
 if(process.env.GRIDEX_FINANCE_RETENTION_VERIFY_AFTER_BROWSER==='1'){
  const f=JSON.parse(readFileSync(path,'utf8')) as Fixture
  expect(f.targets).toHaveLength(2)
  for(const target of f.targets){
   expect(target.decisionId).toMatch(/^[a-f0-9-]{36}$/)
   expect(sql(`SELECT jsonb_build_object('decisions',(SELECT count(*) FROM gridex_ediel_retention.finance_decisions WHERE company_id=${literal(f.companyId)} AND id=${literal(target.decisionId)} AND submitted_by=${literal(f.actorId)} AND document_hash=${literal(target.documentHash)}),'reviews',(SELECT count(*) FROM gridex_ediel_retention.finance_reviews WHERE decision_id=${literal(target.decisionId)} AND actor_user_id=${literal(f.reviewerId)} AND outcome='approved'),'tombstones',(SELECT count(*) FROM gridex_ediel_retention.finance_tombstones WHERE company_id=${literal(f.companyId)} AND retention_class=${literal(target.retentionClass)} AND target_id=${literal(target.targetId)} AND decision_id=${literal(target.decisionId)}),'events',(SELECT count(*) FROM gridex_ediel_retention.finance_events WHERE retention_class=${literal(target.retentionClass)} AND target_id=${literal(target.targetId)}))`)).toEqual({decisions:1,reviews:1,tombstones:1,events:1})
   const row=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM public.${target.table} r WHERE id::text=${literal(target.targetId)}`);expect(metadata(row,target.columns)).toEqual(target.immutable)
   for(const column of target.columns)expect(typeof row[column]==='string'?JSON.parse(String(row[column])):row[column]).toEqual({retentionUnavailable:true,sourceHash:target.sourceHash,complete:false,authority:'none'})
  }
  expect(sql(`SELECT jsonb_build_object('decisions',(SELECT count(*) FROM gridex_ediel_retention.finance_decisions WHERE company_id=${literal(f.companyId)}),'foreign',(SELECT count(*) FROM gridex_ediel_retention.finance_decisions WHERE company_id=${literal(f.foreignCompanyId)}),'audit',(SELECT count(*) FROM public.portfolio_settlement_audit_log WHERE settlement_id=${literal(f.settlementId)}),'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)}))`)).toEqual({decisions:2,foreign:0,audit:f.auditCount,originals:0})
  return
 }
 const f=await seedFinanceCopyRetentionNativeFixture(password),foreignCompany=randomUUID();sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(foreignCompany)},'Synthetic foreign finance browser','archived')`);const foreign=await createCustomerRecordRetentionNativeUser(foreignCompany,['ediel.retention.read','ediel.retention.settlement_copy_evidence'],password)
 for(const u of [f.writer,f.reviewer,f.readonly,foreign]){const listed=await u.client.rpc('ediel_current_retention_companies_v1',{});expect(listed.error).toBeNull();expect(listed.data.map((c:{companyId:string})=>c.companyId)).toEqual([u===foreign?foreignCompany:f.companyId])}
 const targets:Target[]=[]
 for(const [retentionClass,targetId,table,columns]of [['settlement_calculation_body',f.target,'portfolio_monthly_settlements',['calculation_snapshot']],['settlement_audit_body',f.audit,'portfolio_settlement_audit_log',['old_values','new_values','reason']]] as const){
  const basis=await f.writer.client.rpc('ediel_finance_copy_retention_basis_v1',{p_company_id:f.companyId,p_actor_user_id:f.writer.id,p_retention_class:retentionClass,p_target_id:targetId});expect(basis.error).toBeNull();expect(basis.data).toMatchObject({sourceBound:true,allIncludedScopesClosed:true,complete:false,authority:'none'})
  const document=Buffer.from('SYNTHETIC BROWSER own financial copy '+retentionClass),row=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM public.${table} r WHERE id::text=${literal(targetId)}`)
  targets.push({retentionClass,targetId,table,columns:[...columns],documentBase64:document.toString('base64'),documentHash:digest(document),sourceHash:basis.data.sourceHash,issuerReceipt:f.policy(basis.data,document),immutable:metadata(row,[...columns])})
 }
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.finance_decisions WHERE company_id=${literal(f.companyId)}`)).toBe(0)
 writeBrowserFixture(path,{companyId:f.companyId,actorId:f.writer.id,actorEmail:f.writer.email,reviewerId:f.reviewer.id,reviewerEmail:f.reviewer.email,readonlyEmail:f.readonly.email,foreignCompanyId:foreignCompany,foreignEmail:foreign.email,settlementId:f.target,auditCount:sql<number>(`SELECT to_jsonb(count(*)) FROM public.portfolio_settlement_audit_log WHERE settlement_id=${literal(f.target)}`),targets} satisfies Fixture,{mode:0o600})
},240000)
