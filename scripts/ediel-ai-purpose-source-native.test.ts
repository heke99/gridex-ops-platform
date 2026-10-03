import {createHash,randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {afterEach,expect,it,vi} from 'vitest'
const effects=vi.hoisted(()=>({smtp:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:effects.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {supabaseService} from '@/lib/supabase/service'
import {attachNetworkRegistrySourceFixture} from './helpers/ediel-network-registry-native-fixture'
import {archiveNetworkRegistrySource,reviewNetworkRegistrySource} from '@/lib/ediel/production/networkRegistrySource'
import {createAiPurposeSourceFixture} from './helpers/ediel-ai-purpose-native-fixture'
import {createBilateralSourceOperator} from './helpers/ediel-bilateral-customer-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {archiveAiPurposeSource,reviewAiPurposeSource,readAiPurposeSourceArtifact,readAiPurposeSourceBytes} from '@/lib/ediel/production/aiPurposeSource'
import {writeBrowserFixture} from './helpers/browserFixture'
afterEach(()=>{vi.unstubAllEnvs();effects.smtp.mockReset()})
it('actual immutable purpose archive, separate scoped original review and current issuer authority, with source/DENY/revocation continuity',async()=>{
 const path=process.env.GRIDEX_AI_PURPOSE_FIXTURE_PATH
 if(process.env.GRIDEX_AI_PURPOSE_VERIFY_AFTER_BROWSER==='1'){
  if(!path)throw Error('local_browser_fixture_path_required')
  const f=JSON.parse(readFileSync(path,'utf8')) as {companyId:string;browserSourceHash:string;reviewerId:string;nativeArtifactId:string;nativeAiMessageId:null;networkBrowserSourceHash:string;networkReviewerId:string;fixtureStage:string}
  expect(f.fixtureStage).toBe('legal_contract_before_received_z04');expect(f.nativeAiMessageId).toBeNull()
  const rows=sql<{submittedBy:string;reviewedBy:string;hash:string;decisionId:string}[]>(`SELECT jsonb_agg(jsonb_build_object('submittedBy',a.submitted_by,'reviewedBy',r.reviewer_user_id,'hash',encode(sha256(a.source_bytes),'hex'),'decisionId',o.decision_id)) FROM gridex_ai_purpose_sources.artifacts a JOIN gridex_ai_purpose_sources.origins o ON o.artifact_id=a.id JOIN gridex_ai_purpose_sources.reviews r ON r.id=o.review_id WHERE a.company_id=${literal(f.companyId)} AND a.source_hash=${literal(f.browserSourceHash)}`)
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({reviewedBy:f.reviewerId,hash:f.browserSourceHash});expect(rows[0].submittedBy).not.toBe(rows[0].reviewedBy)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_family='AI_LIST'`)).toBe(0)
  const network=sql<{hash:string;reviewer:string}[]>(`SELECT jsonb_agg(jsonb_build_object('hash',encode(sha256(a.source_bytes),'hex'),'reviewer',r.reviewer_user_id)) FROM gridex_network_registry_sources.artifacts a JOIN gridex_network_registry_sources.origins o ON o.artifact_id=a.id JOIN gridex_network_registry_sources.reviews r ON r.id=o.review_id WHERE a.company_id=${literal(f.companyId)} AND a.source_hash=${literal(f.networkBrowserSourceHash)}`);expect(network).toHaveLength(1);expect(network[0]).toEqual({hash:f.networkBrowserSourceHash,reviewer:f.networkReviewerId})
  expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ai_processing.outbound_origins WHERE company_id=${literal(f.companyId)}`)).toBe(0)
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}`)).toBe(0)
  return
 }
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await createAiPurposeSourceFixture(email=>effects.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})),scope={companyId:f.companyId,actorUserId:f.uploader.id},reviewScope={companyId:f.companyId,actorUserId:f.reviewer.id}
 const current=async()=>{const r=await supabaseService.rpc('ediel_ai_export_decision_v2',{p_company_id:f.companyId,p_actor_user_id:f.uploader.id,p_environment:'test'});expect(r.error).toBeNull();return r.data}
 expect((await current()).status).toBe('held')
 const pending=await archiveAiPurposeSource({...f.submission('SYNTHETIC missing legal issuer',f.pdf('held original'),false),...scope});expect(pending.missing).toContain('authentic_current_purpose_issuer_and_representation');expect((await reviewAiPurposeSource({...pending,...reviewScope,decision:'approve',reason:'Synthetic separate missing legal evidence review',clause:f.clause})).status).toBe('held')
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ai_processing.decisions WHERE company_id=${literal(f.companyId)}`)).toBe(0)
 const bytes=f.pdf('actual native signed legal source'),artifact=await archiveAiPurposeSource({...f.submission('SYNTHETIC actual native purpose',bytes),...scope});expect(artifact.missing).toEqual([])
 await expect(reviewAiPurposeSource({...artifact,...scope,decision:'approve',reason:'Synthetic self-review forbidden',clause:f.clause})).rejects.toBeTruthy();expect((await reviewAiPurposeSource({...artifact,...reviewScope,decision:'approve',reason:'Synthetic invented clause',clause:{...f.clause,quote:'invented'}})).status).toBe('held')
 expect(Buffer.from((await readAiPurposeSourceBytes({...scope,artifactId:artifact.artifactId})).bytes)).toEqual(bytes)
 const approved=await reviewAiPurposeSource({...artifact,...reviewScope,decision:'approve',reason:'Synthetic separate scoped actual original review',clause:f.clause});expect(approved.status).toBe('authorized');if(approved.status!=='authorized')throw Error('synthetic_purpose_mechanism_not_authorized')
 expect((await current()).decision).toMatchObject({id:approved.decisionId,environment:'test',purpose:'ediel_list_export',sourceSha256:artifact.sourceHash,retentionUntil:f.policy.retentionUntil});expect((await readAiPurposeSourceArtifact({...scope,artifactId:artifact.artifactId})).status).toBe('authorized')
 const retry=await reviewAiPurposeSource({...artifact,...reviewScope,decision:'approve',reason:'Synthetic idempotent reread',clause:f.clause});expect(retry).toEqual(approved)
 const foreign=randomUUID();sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(foreign)},'Disposable foreign AI purpose company','active')`);const outsider=await createBilateralSourceOperator(foreign,['communication.read','customers.read','contracts.read'])
 await expect(readAiPurposeSourceBytes({companyId:foreign,actorUserId:outsider.id,artifactId:artifact.artifactId})).rejects.toBeTruthy()
 let networkBrowser:Record<string,unknown>|undefined
 if(path){
  const network=await attachNetworkRegistrySourceFixture(f),registry=await archiveNetworkRegistrySource({...network.submission('SYNTHETIC actual browser network registry',network.pdf('browser network')),companyId:f.companyId,actorUserId:network.uploader.id})
  expect((await reviewNetworkRegistrySource({...registry,companyId:f.companyId,actorUserId:network.reviewer.id,decision:'approve',reason:'Synthetic actual browser registry independent review',clause:network.clause})).status).toBe('authorized')
  const networkBytes=network.pdf('interactive network original');networkBrowser={networkBrowser:network.submission('SYNTHETIC BROWSER NETWORK REGISTRY',networkBytes,'2'),networkSourceText:networkBytes.toString(),networkBrowserSourceHash:createHash('sha256').update(networkBytes).digest('hex'),networkNativeArtifactId:registry.artifactId,networkSubmitterEmail:network.uploader.email,networkReviewerEmail:network.reviewer.email,networkReviewerId:network.reviewer.id,networkClause:network.clause}
 }
 if(path){const browserBytes=f.pdf('interactive browser legal original'),browser=f.submission('SYNTHETIC BROWSER LEGAL PURPOSE',browserBytes);writeBrowserFixture(path,{companyId:f.companyId,fixtureStage:'legal_contract_before_received_z04',downstreamEvidence:{status:'not_executed',reason:'This fixture qualifies independent source producers only; actual canonical Z04/ACK and supply/customer/AI chain remain a separate native test.'},submitterEmail:f.uploader.email,reviewerEmail:f.reviewer.email,reviewerId:f.reviewer.id,readerEmail:f.reader.email,outsiderEmail:outsider.email,nativeArtifactId:artifact.artifactId,nativeAiMessageId:null,...networkBrowser,browserSourceHash:createHash('sha256').update(browserBytes).digest('hex'),browser,clause:f.clause,sourceText:browserBytes.toString()},{mode:0o600})}
 sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,valid_from,valid_to,is_active) VALUES(NULL,${literal(f.reviewer.id)},'ediel.ai_purpose.review','deny',now()-interval '1 day',now()+interval '1 day',true)`);expect((await current()).status).toBe('held')
 sql(`UPDATE public.user_permission_overrides SET valid_to=now()-interval '1 second' WHERE user_id=${literal(f.reviewer.id)} AND permission_key='ediel.ai_purpose.review'`);expect((await current()).status).toBe('authorized')
 // Browser fixture must remain current; ordinary native execution separately
 // proves immutable source revocation blocks every new consumer.
 if(!path){sql(`INSERT INTO gridex_ai_purpose_sources.revocations(target_kind,target_id,source_reference,source_hash) VALUES('representation',${literal(f.representationId)},'SYNTHETIC legal representation revocation',${literal(createHash('sha256').update('SYNTHETIC revocation').digest('hex'))})`);expect((await current()).status).toBe('held');expect((await readAiPurposeSourceArtifact({...scope,artifactId:artifact.artifactId})).status).toBe('held')}
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ai_processing.decisions WHERE company_id=${literal(f.companyId)}`)).toBe(1)
 // Browser uses the actual distinct network archive/review producer; ordinary
 // purpose-only execution leaves it absent. Neither calls a real destination.
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_family='AI_LIST'`)).toBe(0)
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}`)).toBe(0)
},120000)
