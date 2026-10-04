import {createHash,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
const effects=vi.hoisted(()=>({smtp:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:effects.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {createLegalSourceStageFixture} from './helpers/ediel-legal-source-stage-native-fixture'
import {attachNetworkRegistrySourceFixture} from './helpers/ediel-network-registry-native-fixture'
import {createBilateralSourceOperator} from './helpers/ediel-bilateral-customer-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {archiveNetworkRegistrySource,readNetworkRegistrySourceArtifact,readNetworkRegistrySourceBytes,reviewNetworkRegistrySource,revokeNetworkRegistrySource} from '@/lib/ediel/production/networkRegistrySource'

afterEach(()=>{vi.unstubAllEnvs();effects.smtp.mockReset()})
it('independent original network producer qualifies actual company/issuer/review/current header without received Z04, supply or AI origin',async()=>{
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await createLegalSourceStageFixture(email=>effects.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})),n=await attachNetworkRegistrySourceFixture(f),scope={companyId:f.companyId,actorUserId:n.uploader.id},reviewScope={companyId:f.companyId,actorUserId:n.reviewer.id}
 // The normal-switch seed already qualified one network original for its Z03.
 const seededOrigins=sql(`SELECT to_jsonb(count(*)) FROM gridex_network_registry_sources.origins WHERE company_id=${literal(f.companyId)}`)
 const basis=()=>sql<{status:string;basis?:{artifactId:string;sourceSha256:string;registryVersionId:string}}>(`SELECT gridex_network_registry_sources.network_for_company_v1(${literal(f.companyId)},${literal(f.receiver)},'test')`)
 expect(basis().status).toBe('held')
 const missing=await archiveNetworkRegistrySource({...n.submission('SYNTHETIC absent genuine network issuer',n.pdf('missing'), 'pending',false),...scope});expect(missing.missing).toContain('authentic_current_network_registry_issuer_and_representation')
 expect((await reviewNetworkRegistrySource({...missing,...reviewScope,decision:'approve',reason:'Synthetic actual independent missing-source review',clause:n.clause})).status).toBe('held');expect(basis().status).toBe('held')
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_network_registry_sources.origins WHERE company_id=${literal(f.companyId)}`)).toBe(seededOrigins)
 const bytes=n.pdf('native independent network original'),artifact=await archiveNetworkRegistrySource({...n.submission('SYNTHETIC actual network original',bytes),...scope});expect(artifact.missing).toEqual([]);expect(artifact.sourceHash).toBe(createHash('sha256').update(bytes).digest('hex'))
 await expect(reviewNetworkRegistrySource({...artifact,...scope,decision:'approve',reason:'Synthetic prohibited self-review',clause:n.clause})).rejects.toBeTruthy()
 expect((await reviewNetworkRegistrySource({...artifact,...reviewScope,decision:'approve',reason:'Synthetic substituted clause must hold',clause:{...n.clause,quote:'invented source clause'}})).status).toBe('held');expect(basis().status).toBe('held')
 const approved=await reviewNetworkRegistrySource({...artifact,...reviewScope,decision:'approve',reason:'Synthetic actual separate review of original network clause',clause:n.clause});expect(approved.status).toBe('authorized');if(approved.status!=='authorized')throw Error('native_network_source_producer_not_authorized')
 expect(basis()).toMatchObject({status:'authorized',basis:{artifactId:artifact.artifactId,sourceSha256:artifact.sourceHash,registryVersionId:approved.registryVersionId}})
 expect(sql(`SELECT gridex_ai_processing.header_company_basis_v1(${literal(f.companyId)},'test',${literal(f.sender)},${literal(f.receiver)})`)).toMatchObject({companyId:f.companyId,environment:'test',legalSupplier:f.sender,network:{status:'authorized'}})
 expect((await readNetworkRegistrySourceArtifact({...scope,artifactId:artifact.artifactId})).status).toBe('authorized');expect(Buffer.from((await readNetworkRegistrySourceBytes({...scope,artifactId:artifact.artifactId})).bytes)).toEqual(bytes)
 expect(await reviewNetworkRegistrySource({...artifact,...reviewScope,decision:'approve',reason:'Synthetic actual idempotent reread',clause:n.clause})).toEqual(approved)
 expect(sql(`SELECT gridex_network_registry_sources.network_for_company_v1(${literal(f.companyId)},${literal(f.receiver)},'production')`)).toMatchObject({status:'held'})
 const foreign=randomUUID();sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(foreign)},'Disposable foreign network source company','active')`);const outsider=await createBilateralSourceOperator(foreign,['communication.read','customers.read','contracts.read'])
 await expect(readNetworkRegistrySourceBytes({companyId:foreign,actorUserId:outsider.id,artifactId:artifact.artifactId})).rejects.toBeTruthy()
 sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,valid_from,valid_to,is_active) VALUES(NULL,${literal(n.reviewer.id)},'ediel.network_registry.review','deny',now()-interval '1 day',now()+interval '1 day',true)`);expect(basis().status).toBe('held')
 sql(`UPDATE public.user_permission_overrides SET valid_to=now()-interval '1 second' WHERE user_id=${literal(n.reviewer.id)} AND permission_key='ediel.network_registry.review'`);expect(basis().status).toBe('authorized')
 sql(`UPDATE public.platform_actor_roles SET is_active=false WHERE actor_id=${literal(n.networkActorId)} AND actor_role='grid_owner'`);expect(basis().status).toBe('held')
 sql(`UPDATE public.platform_actor_roles SET is_active=true WHERE actor_id=${literal(n.networkActorId)} AND actor_role='grid_owner'`);expect(basis().status).toBe('authorized')
 expect((await revokeNetworkRegistrySource({...artifact,...reviewScope,reason:'Synthetic actual withdrawal of archived network source'})).status).toBe('held');expect(basis().status).toBe('held');expect((await readNetworkRegistrySourceArtifact({...scope,artifactId:artifact.artifactId})).status).toBe('held')
 expect(Buffer.from((await readNetworkRegistrySourceBytes({...scope,artifactId:artifact.artifactId})).bytes)).toEqual(bytes)
 expect(sql(`SELECT jsonb_build_object('received',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND direction='inbound'),'supply',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}),'ai',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_family='AI_LIST'),'origins',(SELECT count(*) FROM gridex_ai_processing.outbound_origins WHERE company_id=${literal(f.companyId)}))`)).toEqual({received:0,supply:0,ai:0,origins:0})
},120000)
