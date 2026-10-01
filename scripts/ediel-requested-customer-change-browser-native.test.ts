import {createHash,randomUUID} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const external=vi.hoisted(()=>({smtp:vi.fn()}))
// PostgreSQL, GoTrue, Storage, signed contract and market source owners remain
// actual. Only disposable external legal facts, delivery and notification are
// synthetic controls. The browser must archive/review/queue the positive source.
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:external.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {createRequestedCustomerChangeNativeFixture} from './helpers/ediel-requested-customer-change-native-fixture'
import {createBilateralSourceOperator} from './helpers/ediel-bilateral-customer-native-fixture'
import {archiveRequestedCustomerChangeSource} from '@/lib/ediel/production/requestedCustomerChangeSource'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
afterEach(()=>{vi.unstubAllEnvs();external.smtp.mockReset()})
it('actual non-death source archive independent review and atomic original are produced by interactive browser actions',async()=>{
 const path=process.env.GRIDEX_REQUESTED_CUSTOMER_CHANGE_FIXTURE_PATH
 if(!path||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321'||!process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD)throw Error('owned_disposable_requested_customer_change_fixture_required')
 if(process.env.GRIDEX_REQUESTED_CUSTOMER_CHANGE_VERIFY_AFTER_BROWSER==='1'){
  const f=JSON.parse(readFileSync(path,'utf8')) as {companyId:string;actorId:string;reviewerId:string;sourceHash:string;rawPayload:string;before:unknown}
  expect(sql(`SELECT jsonb_build_object('artifacts',(SELECT count(*) FROM gridex_requested_customer_changes.artifacts WHERE company_id=${literal(f.companyId)}),'origins',(SELECT count(*) FROM gridex_requested_customer_changes.origins o JOIN gridex_requested_customer_changes.artifacts a ON a.id=o.artifact_id JOIN gridex_requested_customer_changes.reviews r ON r.id=o.review_id WHERE o.company_id=${literal(f.companyId)} AND a.source_hash=${literal(f.sourceHash)} AND a.submitted_by=${literal(f.actorId)} AND r.reviewer_user_id=${literal(f.reviewerId)}),'events',(SELECT count(*) FROM gridex_customer_life_events.events WHERE company_id=${literal(f.companyId)} AND classification='other_masterdata' AND approved_raw_payload=${literal(f.rawPayload)} AND NOT allowed_customer_fields@>ARRAY['310']),'originals',(SELECT count(*) FROM gridex_customer_life_events.originals WHERE company_id=${literal(f.companyId)}),'desired',(SELECT count(*) FROM gridex_customer_life_events.desired_changes WHERE company_id=${literal(f.companyId)}),'z09',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z09'))`)).toEqual({artifacts:2,origins:1,events:1,originals:1,desired:1,z09:1})
  expect(sql(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE c.company_id=${literal(f.companyId)} ORDER BY id LIMIT 1),'supply',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.customer_supply_periods p WHERE p.company_id=${literal(f.companyId)}))`)).toEqual(f.before)
  return
 }
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await createRequestedCustomerChangeNativeFixture(email=>external.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})),foreign=randomUUID()
 sql(`INSERT INTO public.companies(id,name,status)VALUES(${literal(foreign)},'Disposable foreign requested customer scope','active')`)
 const outsider=await createBilateralSourceOperator(foreign,['communication.read','customers.read','contracts.read']),bytes=f.pdf('browser original outgoing mandate'),submission=f.submission('BROWSER exact outgoing customer mandate',bytes),heldBytes=f.pdf('read only held outgoing mandate')
 const held=await archiveRequestedCustomerChangeSource({...f.submission('READONLY held outgoing original',heldBytes,false),companyId:f.companyId,actorUserId:f.uploader.id})
 expect(held.missing).toContain('authentic_current_outgoing_customer_mandate')
 const before=sql(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE c.company_id=${literal(f.companyId)} ORDER BY id LIMIT 1),'supply',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.customer_supply_periods p WHERE p.company_id=${literal(f.companyId)}))`)
 writeFileSync(path,JSON.stringify({companyId:f.companyId,periodId:f.period,agreementId:f.agreementId,actorId:f.uploader.id,actorEmail:f.uploader.email,reviewerId:f.reviewer.id,reviewerEmail:f.reviewer.email,readerEmail:f.reader.email,outsiderEmail:outsider.email,readOnlyArtifactId:held.artifactId,readOnlySourceText:heldBytes.toString(),readOnlySourceHash:held.sourceHash,sourceHash:createHash('sha256').update(bytes).digest('hex'),sourceText:bytes.toString(),rawPayload:f.rawPayload,submission,clause:f.clause,before}),{mode:0o600})
},120000)
