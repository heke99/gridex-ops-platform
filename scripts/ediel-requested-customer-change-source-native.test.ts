import {randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const delivery=vi.hoisted(()=>({smtp:vi.fn()}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:delivery.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {createRequestedCustomerChangeNativeFixture} from './helpers/ediel-requested-customer-change-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {archiveRequestedCustomerChangeSource,readRequestedCustomerChangeSourceArtifact,readRequestedCustomerChangeSourceBytes,reviewRequestedCustomerChangeSourceArtifact} from '@/lib/ediel/production/requestedCustomerChangeSource'
import {prepareAndQueueRequestedCustomerChange} from '@/lib/ediel/flows/prodatRequestedCustomerChange'
afterEach(()=>{vi.unstubAllEnvs();delivery.smtp.mockReset()})
async function fixture(){for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v);return createRequestedCustomerChangeNativeFixture(email=>delivery.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}))}
it('actual non-death outgoing mandate archives missing authority, holds separate review and makes no event or queue',async()=>{
 const f=await fixture(),scope={companyId:f.companyId,actorUserId:f.uploader.id},before=sql(`SELECT jsonb_build_object('events',(SELECT count(*) FROM gridex_customer_life_events.events WHERE company_id=${literal(f.companyId)}),'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z09'))`)
 const artifact=await archiveRequestedCustomerChangeSource({...f.submission('SYNTHETIC missing outgoing issuer',f.pdf('held'),false),...scope});expect(artifact.missing).toContain('authentic_current_outgoing_customer_mandate')
 expect(await reviewRequestedCustomerChangeSourceArtifact({...artifact,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic missing actual outgoing authority',clause:f.clause})).toMatchObject({status:'held'})
 expect(await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId})).toMatchObject({status:'held'})
 expect(sql(`SELECT jsonb_build_object('events',(SELECT count(*) FROM gridex_customer_life_events.events WHERE company_id=${literal(f.companyId)}),'messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z09'))`)).toEqual(before)
})
it('actual independent outgoing review publishes exact immutable non-death event; current issuer/reviewer revocation blocks every fresh consumer',async()=>{
 const f=await fixture(),scope={companyId:f.companyId,actorUserId:f.uploader.id},original=f.pdf('actual original'),artifact=await archiveRequestedCustomerChangeSource({...f.submission('SYNTHETIC exact outgoing customer agreement',original),...scope})
 expect(artifact.missing).toEqual([]);expect(Buffer.from((await readRequestedCustomerChangeSourceBytes({...scope,artifactId:artifact.artifactId})).bytes)).toEqual(original)
 await expect(reviewRequestedCustomerChangeSourceArtifact({...artifact,...scope,decision:'approve',reason:'Synthetic self approval',clause:f.clause})).rejects.toThrow()
 const reviewed=await reviewRequestedCustomerChangeSourceArtifact({...artifact,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic separate whole original review',clause:f.clause});expect(reviewed.status).toBe('authorized');if(reviewed.status!=='authorized')throw Error('genuine_outgoing_review_required')
 expect(sql(`SELECT jsonb_build_object('classification',classification,'payload',approved_raw_payload,'death',allowed_customer_fields@>ARRAY['310'])FROM gridex_customer_life_events.events WHERE id=${literal(reviewed.eventId)}`)).toEqual({classification:'other_masterdata',payload:f.rawPayload,death:false})
 const again=await reviewRequestedCustomerChangeSourceArtifact({...artifact,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic current idempotent review',clause:f.clause});expect(again).toMatchObject({eventId:reviewed.eventId})
 sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,is_active,valid_from,valid_to)VALUES(${literal(f.companyId)},${literal(f.reviewer.id)},'ediel.source.review','deny',true,now()-interval '1 day',now()+interval '1 day')`)
 expect((await readRequestedCustomerChangeSourceArtifact({...scope,artifactId:artifact.artifactId})).status).toBe('held');expect(await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId})).toMatchObject({status:'held'})
})
it('actual qualified outgoing source reaches the existing atomic original/intent/outbox gateway and immutable retry',async()=>{
 const f=await fixture(),scope={companyId:f.companyId,actorUserId:f.uploader.id},artifact=await archiveRequestedCustomerChangeSource({...f.submission('SYNTHETIC outgoing original gateway',f.pdf('gateway')),...scope})
 expect(await reviewRequestedCustomerChangeSourceArtifact({...artifact,companyId:f.companyId,actorUserId:f.reviewer.id,decision:'approve',reason:'Synthetic separate outgoing review',clause:f.clause})).toMatchObject({status:'authorized'})
 const result=await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId});expect(result.status).toBe('queued');if(result.status==='held')throw Error('genuine_outgoing_original_gateway_required')
 expect(result.message.raw_payload).toBe(f.rawPayload)
 expect(sql(`SELECT jsonb_build_object('originals',(SELECT count(*) FROM gridex_customer_life_events.originals WHERE company_id=${literal(f.companyId)}),'desired',(SELECT count(*) FROM gridex_customer_life_events.desired_changes WHERE company_id=${literal(f.companyId)}),'outbox',(SELECT count(*) FROM public.ediel_outbox WHERE company_id=${literal(f.companyId)} AND ediel_message_id=${literal(result.message.id)}))`)).toMatchObject({originals:1,desired:1,outbox:1})
 expect(await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId})).toMatchObject({status:'existing',message:{id:result.message.id}})
 sql(`INSERT INTO gridex_requested_customer_changes.revocations(target_kind,target_id,source_reference,source_hash)VALUES('key',${literal(f.keyId)},'SYNTHETIC issuer revoked after original',${literal('b'.repeat(64))})`)
 expect(await prepareAndQueueRequestedCustomerChange({...scope,artifactId:artifact.artifactId})).toMatchObject({status:'held'})
})
