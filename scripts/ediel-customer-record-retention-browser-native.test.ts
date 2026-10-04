import {readFileSync} from 'node:fs'
import {randomUUID} from 'node:crypto'
import {expect,it,vi} from 'vitest'
const port=vi.hoisted(()=>({smtp:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:port.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {supabaseService} from '@/lib/supabase/service'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {seedCustomerRecordRetentionNativeFixture,createCustomerRecordRetentionNativeUser} from './helpers/ediel-customer-record-retention-native-fixture'
import {writeBrowserFixture} from './helpers/browserFixture'
it('actual disposable source/current class owners qualify a standalone archived-only UI fixture, then verify independent post-browser native receipts',async()=>{
 const path=process.env.GRIDEX_RECORD_RETENTION_FIXTURE_PATH,password=process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD
 if(!path||!password||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_record_retention_browser_fixture_required')
 if(process.env.GRIDEX_RECORD_RETENTION_VERIFY_AFTER_BROWSER==='1'){
  const f=JSON.parse(readFileSync(path,'utf8')) as {companyId:string;targetId:string;reviewerId:string;actorId:string;documentHash:string;foreignCompanyId:string}
  expect(sql(`SELECT jsonb_build_object('decisions',(SELECT count(*) FROM gridex_ediel_retention.record_decisions WHERE company_id=${literal(f.companyId)} AND document_hash=${literal(f.documentHash)}),'reviews',(SELECT count(*) FROM gridex_ediel_retention.record_reviews r JOIN gridex_ediel_retention.record_decisions d ON d.id=r.decision_id WHERE d.company_id=${literal(f.companyId)} AND d.document_hash=${literal(f.documentHash)} AND d.submitted_by=${literal(f.actorId)} AND r.actor_user_id=${literal(f.reviewerId)} AND r.outcome='approved'),'tombstones',(SELECT count(*) FROM gridex_ediel_retention.record_tombstones WHERE company_id=${literal(f.companyId)} AND retention_class='customer_address_history' AND target_id=${literal(f.targetId)}),'events',(SELECT count(*) FROM gridex_ediel_retention.record_events WHERE retention_class='customer_address_history' AND target_id=${literal(f.targetId)} AND kind='personal_fields_redacted'),'foreign',(SELECT count(*) FROM gridex_ediel_retention.record_decisions WHERE company_id=${literal(f.foreignCompanyId)}))`)).toEqual({decisions:1,reviews:1,tombstones:1,events:1,foreign:0})
  expect(sql(`SELECT to_jsonb(street_1 IS NULL AND street_2 IS NULL AND postal_code IS NULL AND city IS NULL AND municipality IS NULL AND metadata='{}') FROM public.customer_addresses WHERE id=${literal(f.targetId)}`)).toBe(true)
  return
 }
 const f=await seedCustomerRecordRetentionNativeFixture({password,provider:email=>port.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})}),readonly=await createCustomerRecordRetentionNativeUser(f.companyId,['ediel.retention.read','ediel.retention.address_history'],password)
 const foreignCompany=randomUUID();sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(foreignCompany)},'Synthetic foreign retention browser','archived')`);const foreign=await createCustomerRecordRetentionNativeUser(foreignCompany,['ediel.retention.read','ediel.retention.address_history'],password)
 for(const u of [f.submitter,f.reviewer,readonly,foreign]){const listed=await u.client.rpc('ediel_current_retention_companies_v1',{});expect(listed.error).toBeNull();expect(listed.data.map((c:{companyId:string})=>c.companyId)).toEqual([u===foreign?foreignCompany:f.companyId])}
 expect((await readonly.client.rpc('ediel_current_retention_session_v1',{p_company_id:f.companyId,p_actor_user_id:readonly.id})).data.permissions.sort()).toEqual(['ediel.retention.address_history','ediel.retention.read'])
 const k='customer_address_history',document=Buffer.from('SYNTHETIC BROWSER exact legal policy source, no real competence'),receipt=f.policy(k,document),claim=JSON.parse(Buffer.from(receipt.payloadBase64,'base64').toString('utf8'))
 // Native precheck: no retention-ready/approved/tombstone source was seeded.
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.record_decisions WHERE company_id=${literal(f.companyId)}`)).toBe(0)
 const profile=await supabaseService.from('user_profiles').select('id,user_status').in('id',[f.submitter.id,f.reviewer.id,readonly.id,foreign.id]);expect(profile.error).toBeNull();expect(profile.data).toHaveLength(4)
 writeBrowserFixture(path,{companyId:f.companyId,companyName:'Synthetic normal switch native',targetId:f.targets[k],retentionClass:k,actorId:f.submitter.id,actorEmail:f.submitter.email,reviewerId:f.reviewer.id,reviewerEmail:f.reviewer.email,readonlyId:readonly.id,readonlyEmail:readonly.email,foreignCompanyId:foreignCompany,foreignEmail:foreign.email,documentBase64:document.toString('base64'),documentHash:claim.documentHash,issuerReceipt:receipt},{mode:0o600})
},180000)
