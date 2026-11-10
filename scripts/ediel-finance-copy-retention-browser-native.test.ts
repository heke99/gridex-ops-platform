import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
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
  const receiptTargets:Record<string,unknown>[]=[]
  const jsonHash=(value:Record<string,unknown>)=>digest(Buffer.from(JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)))))
  for(const target of f.targets){
   expect(target.decisionId).toMatch(/^[a-f0-9-]{36}$/)
   const counts=sql<Record<string,number>>(`SELECT jsonb_build_object('decisions',(SELECT count(*) FROM gridex_ediel_retention.finance_decisions WHERE company_id=${literal(f.companyId)} AND id=${literal(target.decisionId)} AND submitted_by=${literal(f.actorId)} AND document_hash=${literal(target.documentHash)}),'reviews',(SELECT count(*) FROM gridex_ediel_retention.finance_reviews WHERE decision_id=${literal(target.decisionId)} AND actor_user_id=${literal(f.reviewerId)} AND outcome='approved'),'tombstones',(SELECT count(*) FROM gridex_ediel_retention.finance_tombstones WHERE company_id=${literal(f.companyId)} AND retention_class=${literal(target.retentionClass)} AND target_id=${literal(target.targetId)} AND decision_id=${literal(target.decisionId)}),'events',(SELECT count(*) FROM gridex_ediel_retention.finance_events WHERE retention_class=${literal(target.retentionClass)} AND target_id=${literal(target.targetId)}))`)
   expect(counts).toEqual({decisions:1,reviews:1,tombstones:1,events:1})
   const row=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM public.${target.table} r WHERE id::text=${literal(target.targetId)}`);expect(metadata(row,target.columns)).toEqual(target.immutable)
   for(const column of target.columns)expect(typeof row[column]==='string'?JSON.parse(String(row[column])):row[column]).toEqual({retentionUnavailable:true,sourceHash:target.sourceHash,complete:false,authority:'none'})
   // Read the installed decision/review/tombstone/event chain; never export signed receipts or original bodies.
   const bound=sql<Record<string,string>>(`SELECT jsonb_build_object(
    'decisionId',d.id,'companyId',d.company_id,'retentionClass',d.retention_class,'targetId',d.target_id,
    'submittedBy',d.submitted_by,'sourceHash',d.source_hash,'targetHash',d.target_hash,'scopeHash',d.scope_hash,'documentHash',d.document_hash,
    'issuerId',d.issuer_receipt->>'issuerId','policyPayloadSHA256',encode(sha256(decode(d.issuer_receipt->>'payloadBase64','base64')),'hex'),
    'reviewId',r.id,'reviewActorId',r.actor_user_id,'reviewOutcome',r.outcome,
    'tombstoneActorId',t.actor_user_id,'tombstoneSourceHash',t.source_hash,'tombstoneTargetHash',t.target_hash,'tombstoneScopeHash',t.scope_hash,
    'eventId',e.id,'eventActorId',e.actor_user_id)
    FROM gridex_ediel_retention.finance_decisions d
    JOIN gridex_ediel_retention.finance_tombstones t ON t.company_id=d.company_id AND t.decision_id=d.id AND t.retention_class=d.retention_class AND t.target_id=d.target_id
    JOIN gridex_ediel_retention.finance_reviews r ON r.id=t.review_id AND r.decision_id=d.id
    JOIN gridex_ediel_retention.finance_events e ON e.retention_class=d.retention_class AND e.target_id=d.target_id
    WHERE d.company_id=${literal(f.companyId)} AND d.id=${literal(target.decisionId)} AND d.retention_class=${literal(target.retentionClass)} AND d.target_id=${literal(target.targetId)}`)
   const policyBytes=Buffer.from(target.issuerReceipt.payloadBase64,'base64')
   let policy:Record<string,unknown>
   try{policy=JSON.parse(policyBytes.toString('utf8')) as Record<string,unknown>}catch{throw Error('finance_cleanup_policy_json_invalid')}
   for(const id of [bound.reviewId,bound.eventId,target.issuerReceipt.issuerId])expect(typeof id==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id)).toBe(true)
   // Assertions expose only safe identifiers, fixed operation values and hashes on failure.
   for(const key of ['sourceHash','targetHash','scopeHash','documentHash','policyPayloadSHA256'])expect(typeof bound[key]==='string'&&/^[a-f0-9]{64}$/.test(bound[key])).toBe(true)
   expect(jsonHash({companyId:policy.companyId,retentionClass:policy.retentionClass,targetId:policy.targetId,sourceHash:policy.sourceHash,documentHash:policy.documentHash,operation:policy.operation,accessRevocationRequired:policy.accessRevocationRequired})).toBe(jsonHash({companyId:f.companyId,retentionClass:target.retentionClass,targetId:target.targetId,sourceHash:target.sourceHash,documentHash:target.documentHash,operation:'redact_finance_copy_body',accessRevocationRequired:true}))
   expect(jsonHash(bound)).toBe(jsonHash({decisionId:target.decisionId,companyId:f.companyId,retentionClass:target.retentionClass,targetId:target.targetId,submittedBy:f.actorId,sourceHash:target.sourceHash,targetHash:policy.targetHash,scopeHash:policy.scopeHash,documentHash:target.documentHash,issuerId:target.issuerReceipt.issuerId,policyPayloadSHA256:digest(policyBytes),reviewId:bound.reviewId,reviewActorId:f.reviewerId,reviewOutcome:'approved',tombstoneActorId:f.actorId,tombstoneSourceHash:target.sourceHash,tombstoneTargetHash:policy.targetHash,tombstoneScopeHash:policy.scopeHash,eventId:bound.eventId,eventActorId:f.actorId}))
   for(const key of ['issuedAt','expiresAt','retainUntil','journalRetainUntil']){
    const value=policy[key]
    expect(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))).toBe(true)
   }
   const metadataBeforeSHA256=jsonHash(target.immutable),metadataAfterSHA256=jsonHash(metadata(row,target.columns))
   expect(metadataAfterSHA256).toBe(metadataBeforeSHA256)
   receiptTargets.push({retentionClass:target.retentionClass,targetId:target.targetId,decisionId:bound.decisionId,reviewId:bound.reviewId,eventId:bound.eventId,submittedBy:bound.submittedBy,reviewActorId:bound.reviewActorId,purgeActorId:bound.tombstoneActorId,issuerId:bound.issuerId,sourceHash:bound.sourceHash,targetHash:bound.targetHash,scopeHash:bound.scopeHash,documentHash:bound.documentHash,policyPayloadSHA256:bound.policyPayloadSHA256,operation:'redact_finance_copy_body',issuedAt:policy.issuedAt,expiresAt:policy.expiresAt,retainUntil:policy.retainUntil,journalRetainUntil:policy.journalRetainUntil,reviewOutcome:bound.reviewOutcome,status:'redacted',metadataBeforeSHA256,metadataAfterSHA256,bodyAfterSHA256:digest(Buffer.from(JSON.stringify(Object.fromEntries(target.columns.map(column=>[column,row[column]]))))),verifiedCounts:{decisions:counts.decisions,reviews:counts.reviews,tombstones:counts.tombstones,events:counts.events}})
  }
  const totals=sql<Record<string,number>>(`SELECT jsonb_build_object('decisions',(SELECT count(*) FROM gridex_ediel_retention.finance_decisions WHERE company_id=${literal(f.companyId)}),'foreign',(SELECT count(*) FROM gridex_ediel_retention.finance_decisions WHERE company_id=${literal(f.foreignCompanyId)}),'audit',(SELECT count(*) FROM public.portfolio_settlement_audit_log WHERE settlement_id=${literal(f.settlementId)}),'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)}))`)
  expect(totals).toEqual({decisions:2,foreign:0,audit:f.auditCount,originals:0})
  const sourceHead=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',timeout:5000}).trim()
  expect(sourceHead).toMatch(/^[a-f0-9]{40}$/)
  mkdirSync('e2e-artifacts/native',{recursive:true,mode:0o700})
  // Deliberately bypass writeBrowserFixture: that setup helper also mirrors role permissions.
  writeFileSync('e2e-artifacts/native/custody0104-finance-retention-after-browser.safe.json',JSON.stringify({format:'custody0104_finance_cleanup_receipt_v1',sourceHead,sourceTestSHA256:digest(readFileSync('scripts/ediel-finance-copy-retention-browser-native.test.ts')),schemaSHA256:digest(readFileSync('supabase/schema.sql')),scope:'separate_synthetic_settlement_copies',authority:'synthetic_test_only',complete:false,companyId:f.companyId,settlementId:f.settlementId,targets:receiptTargets,preservation:{auditRowsBefore:f.auditCount,auditRowsAfter:totals.audit,foreignDecisions:totals.foreign,receivedOriginals:totals.originals},limits:['not_original_main_invoice_chain','not_external_legal_approval']},null,2)+'\n',{flag:'wx',mode:0o600})
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
