import {createHash,randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const effects=vi.hoisted(()=>({smtp:vi.fn()}))
// Real local PostgreSQL, GoTrue, signed archive, Storage and production source
// producers. Only external delivery/customer notification ports are bounded.
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:effects.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {createBilateralCustomerSourceFixture,createBilateralSourceOperator} from './helpers/ediel-bilateral-customer-native-fixture'
import {archiveBilateralCustomerSource} from '@/lib/ediel/production/bilateralCustomerSource'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {writeBrowserFixture} from './helpers/browserFixture'
afterEach(()=>{vi.unstubAllEnvs();effects.smtp.mockReset()})
it('genuine received bilateral source is archived reviewed and applied only by actual browser actions',async()=>{
 const path=process.env.GRIDEX_BILATERAL_FIXTURE_PATH
 if(!path||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321'||!process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD)throw Error('owned_disposable_bilateral_fixture_required')
 if(process.env.GRIDEX_BILATERAL_VERIFY_AFTER_BROWSER==='1'){
  const f=JSON.parse(readFileSync(path,'utf8')) as {companyId:string;sourceMessageId:string;sourceHash:string;actorId:string;reviewerId:string;before:unknown}
  expect(sql(`SELECT jsonb_build_object('artifacts',(SELECT count(*) FROM gridex_bilateral_customer_sources.artifacts WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceMessageId)} AND source_hash=${literal(f.sourceHash)}),'origins',(SELECT count(*) FROM gridex_bilateral_customer_sources.origins o JOIN gridex_bilateral_customer_sources.artifacts a ON a.id=o.artifact_id JOIN gridex_bilateral_customer_sources.reviews r ON r.id=o.review_id WHERE o.company_id=${literal(f.companyId)} AND a.source_message_id=${literal(f.sourceMessageId)} AND a.submitted_by=${literal(f.actorId)} AND r.reviewer_user_id=${literal(f.reviewerId)}),'versions',(SELECT count(*) FROM gridex_requested_changes.confirmed_customer_versions WHERE company_id=${literal(f.companyId)} AND source_message_id=${literal(f.sourceMessageId)}),'z09',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z09'),'deathEvents',(SELECT count(*) FROM gridex_requested_changes.events WHERE company_id=${literal(f.companyId)}))`)).toEqual({artifacts:1,origins:1,versions:1,z09:0,deathEvents:0})
  expect(sql(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c JOIN public.ediel_messages m ON m.customer_id=c.id WHERE m.id=${literal(f.sourceMessageId)}),'supply',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.customer_supply_periods p WHERE p.company_id=${literal(f.companyId)}))`)).toEqual(f.before)
  return
 }
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await createBilateralCustomerSourceFixture(email=>effects.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})),foreign=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(foreign)},'Disposable foreign bilateral scope','active')`)
 const outsider=await createBilateralSourceOperator(foreign,['communication.read','customers.read','contracts.read']),bytes=f.pdf('browser bilateral original'),submission=f.submission('BROWSER bilateral original',bytes)
 const readOnlyBytes=f.pdf('private held original'),readOnlyArtifact=await archiveBilateralCustomerSource({...f.submission('READONLY held original',readOnlyBytes,false),companyId:f.companyId,actorUserId:f.uploader.id})
 expect(readOnlyArtifact.status).toBe('archived')
 const before=sql(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE c.id=${literal(f.customerId)}),'supply',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.customer_supply_periods p WHERE p.company_id=${literal(f.companyId)}))`)
 writeBrowserFixture(path,{companyId:f.companyId,sourceMessageId:f.sourceMessageId,periodId:f.period,agreementId:f.agreementId,contractId:f.contractId,actorId:f.uploader.id,actorEmail:f.uploader.email,reviewerId:f.reviewer.id,reviewerEmail:f.reviewer.email,readerEmail:f.reader.email,outsiderEmail:outsider.email,readOnlyArtifactId:readOnlyArtifact.artifactId,readOnlySourceHash:createHash('sha256').update(readOnlyBytes).digest('hex'),readOnlySourceText:readOnlyBytes.toString(),sourceHash:createHash('sha256').update(bytes).digest('hex'),sourceText:bytes.toString(),submission,clause:f.clause,before},{mode:0o600})
},120000)
