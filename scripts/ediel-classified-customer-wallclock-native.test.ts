import {randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const external=vi.hoisted(()=>({smtp:vi.fn()}))
// Genuine local PostgreSQL/GoTrue/Storage/source owners. Only disposable remote
// issuer/representation facts, SMTP and notifications are synthetic boundaries.
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:external.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {createBilateralCustomerSourceFixture} from './helpers/ediel-bilateral-customer-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {archiveBilateralCustomerSource,reviewBilateralCustomerSourceArtifact as reviewBilateralCustomerSource} from '@/lib/ediel/production/bilateralCustomerSource'
import type {BilateralCustomerSourceSubmission} from '@/lib/ediel/production/bilateralCustomerSource'
afterEach(()=>{vi.unstubAllEnvs();external.smtp.mockReset()})
async function fixture(){for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v);return createBilateralCustomerSourceFixture(email=>external.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}))}
function signSyntheticReceipt(input:BilateralCustomerSourceSubmission,patch:Record<string,unknown>){if(!input.issuerReceipt)throw Error('synthetic_issuer_fixture_required');const payload={...JSON.parse(Buffer.from(input.issuerReceipt.payloadBase64,'base64').toString('utf8')),...patch},bytes=Buffer.from(JSON.stringify(payload));return{...input,issuerReceipt:{...input.issuerReceipt,payloadBase64:bytes.toString('base64'),signatureHex:sql<string>(`SELECT to_jsonb(encode(gridex_requested_changes.receipt_hmac_sha256_v1(decode(${literal(bytes.toString('base64'))},'base64'),(SELECT receipt_signing_key FROM gridex_bilateral_customer_sources.issuer_keys WHERE id=${literal(input.issuerReceipt.keyId)})),'hex'))`)}}}
it('actual public archive and separate native review hold signed receipts with missing clocks and publish no qualified owner',async()=>{
 const f=await fixture(),before=sql(`SELECT jsonb_build_object('classifications',(SELECT count(*) FROM gridex_customer_life_events.inbound_classifications WHERE company_id=${literal(f.companyId)}),'origins',(SELECT count(*) FROM gridex_bilateral_customer_sources.life_event_classification_origins WHERE company_id=${literal(f.companyId)}))`)
 for(const patch of[{issuedAt:null},{expiresAt:null},{issuedAt:null,expiresAt:null}]){
  const input=signSyntheticReceipt(f.submission('SYNTHETIC null receipt clock '+randomUUID(),f.pdf('null clock '+randomUUID())),patch)
  const artifact=await archiveBilateralCustomerSource({...input,companyId:f.companyId,actorUserId:f.uploader.id});expect(artifact.missing).toContain('authentic_current_bilateral_dso_receipt_and_representation')
  expect(await reviewBilateralCustomerSource({...artifact,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic separate review cannot create absent temporal authority',clause:f.clause})).toMatchObject({status:'held'})
 }
 expect(sql(`SELECT jsonb_build_object('classifications',(SELECT count(*) FROM gridex_customer_life_events.inbound_classifications WHERE company_id=${literal(f.companyId)}),'origins',(SELECT count(*) FROM gridex_bilateral_customer_sources.life_event_classification_origins WHERE company_id=${literal(f.companyId)}))`)).toEqual(before)
})
it('actual public archive review classification expires under the native wall clock within an older transaction; old owner remains STABLE and private helpers inaccessible',async()=>{
 const f=await fixture(),expires=sql<string>(`SELECT to_jsonb(clock_timestamp()+interval '6 seconds')`),input=signSyntheticReceipt(f.submission('SYNTHETIC current native expiry',f.pdf('current expiry')),{expiresAt:expires})
 const artifact=await archiveBilateralCustomerSource({...input,companyId:f.companyId,actorUserId:f.uploader.id});expect(artifact.missing).toEqual([])
 expect(await reviewBilateralCustomerSource({...artifact,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic actual independent current review',clause:f.clause})).toMatchObject({status:'authorized'})
 expect(sql(`SELECT to_jsonb(gridex_bilateral_customer_sources.classification_current_v1(${literal(f.companyId)},${literal(f.sourceMessageId)},clock_timestamp()) IS NOT NULL)`)).toBe(true)
 expect(sql(`BEGIN;DO $wait$BEGIN PERFORM pg_sleep(greatest(0,extract(epoch FROM ${literal(expires)}::timestamptz-clock_timestamp()))+0.1);END$wait$;SELECT jsonb_build_object('nativeExpired',clock_timestamp()>${literal(expires)}::timestamptz,'transactionStillBeforeExpiry',now()<${literal(expires)}::timestamptz,'qualified',gridex_bilateral_customer_sources.classification_current_v1(${literal(f.companyId)},${literal(f.sourceMessageId)},clock_timestamp()) IS NOT NULL,'oldOwnerVolatility',(SELECT provolatile FROM pg_proc WHERE oid='gridex_customer_life_events.owner_proof_consistent_v1(jsonb,jsonb,uuid)'::regprocedure),'directPrivateExecute',has_function_privilege('service_role','gridex_bilateral_customer_sources.classified_receipt_wallclock_v1(gridex_bilateral_customer_sources.artifacts)','EXECUTE'));ROLLBACK;`)).toEqual({nativeExpired:true,transactionStillBeforeExpiry:true,qualified:false,oldOwnerVolatility:'s',directPrivateExecute:false})
})
