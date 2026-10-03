import {futureNativeSupplyDate} from './helpers/ediel-normal-switch-native-fixture'
import {createHash,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const effects=vi.hoisted(()=>({smtp:vi.fn()}))
// Only actual external delivery/notification ports are bounded. PostgreSQL,
// canonical guide, Storage, contract/signature and GoTrue are not mocked.
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:effects.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {supabaseService} from '@/lib/supabase/service'
import {createBilateralCustomerSourceFixture,createBilateralSourceOperator,customerChangeMinute} from './helpers/ediel-bilateral-customer-native-fixture'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {archiveBilateralCustomerSource,reviewBilateralCustomerSourceArtifact,readBilateralCustomerSourceArtifact,readBilateralCustomerSourceBytes} from '@/lib/ediel/production/bilateralCustomerSource'
import {approveSafeMasterdataChanges} from '@/lib/ediel/safeApplyReview'
import {applyConfirmedCustomerSource} from '@/lib/ediel/production/confirmedCustomerSource'
import {readConfirmedCustomerHistory,isConfirmedCustomerHistoryQualified} from '@/lib/ediel/production/confirmedCustomerHistory'
import {inspectStructuralReadset} from '@/lib/ediel/sources/structuralSourceReadset'
import {projectAiListHistory,type AiListSupplyPeriod} from '@/lib/ediel/aiListHistory'
import {buildAiListCsv} from '@/lib/ediel/aiList'
afterEach(()=>{vi.unstubAllEnvs();effects.smtp.mockReset()})
function smtp(){for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)}
type Fixture=Awaited<ReturnType<typeof createBilateralCustomerSourceFixture>>
async function snapshot(f:Fixture){
 const cutoffAt=sql<string>('SELECT to_jsonb(clock_timestamp())'),scope={companyId:f.companyId,environment:'test' as const,customerId:f.customerId,siteId:f.siteId,meteringPointId:f.pointId,legalSupplier:f.sender,legalNetwork:f.receiver,fromDate:futureNativeSupplyDate(),toDate:futureNativeSupplyDate(21),cutoffAt}
 const saved=await supabaseService.rpc('gridex_source_object_snapshot_v1',{p_company_id:f.companyId,p_environment:'test',p_cutoff:cutoffAt});expect(saved.error).toBeNull()
 const readset=inspectStructuralReadset(scope,saved.data);expect(readset.timeline).toMatchObject({status:'inspected',boundedReadComplete:true});expect(readset.unresolvedSources).toBe(false)
 const periods=await supabaseService.from('customer_supply_periods').select('id,company_id,customer_id,metering_point_id,start_date,end_date,actual_start_date,actual_end_date').eq('company_id',f.companyId).eq('id',f.period);expect(periods.error).toBeNull()
 const customers=await readConfirmedCustomerHistory({scope,readset,actorUserId:f.reviewer.id})
 return {scope,readset,customers,periods:periods.data as AiListSupplyPeriod[],receipt:saved.data as {readsetText:string}}
}
function unchanged(f:Fixture){return sql(`SELECT jsonb_build_object('customer',(SELECT to_jsonb(c) FROM public.customers c WHERE id=${literal(f.customerId)}),'supply',(SELECT to_jsonb(p) FROM public.customer_supply_periods p WHERE id=${literal(f.period)}),'point',(SELECT to_jsonb(p) FROM public.metering_points p WHERE id=${literal(f.pointId)}),'site',(SELECT to_jsonb(s) FROM public.customer_sites s WHERE id=${literal(f.siteId)}),'deathEvents',(SELECT count(*) FROM gridex_requested_changes.events WHERE company_id=${literal(f.companyId)}),'z09',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(f.companyId)} AND message_code='Z09'),'requests',(SELECT count(*) FROM public.outbound_requests WHERE company_id=${literal(f.companyId)}))`)}
it('genuine current company producer commits non-death customer/invoicee facet and separate availability; same native snapshot supplies dated AI with immutable originals and current revocation',async()=>{
 smtp();const f=await createBilateralCustomerSourceFixture(email=>effects.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})),before=unchanged(f)
 const nativeScope={companyId:f.companyId,actorUserId:f.uploader.id},reviewScope={companyId:f.companyId,actorUserId:f.reviewer.id}
 const early=await snapshot(f);expect(early.customers.versions).toEqual([])
 expect(()=>projectAiListHistory(early.scope,early.periods,early.readset,early.customers)).toThrow('dated_customer_change_owner_missing')
 const pending=await archiveBilateralCustomerSource({...f.submission('SYNTHETIC missing counterparty authentication',f.pdf('held bytes'),false),...nativeScope})
 expect(pending.missing).toContain('authentic_current_bilateral_dso_receipt_and_representation')
 const held=await reviewBilateralCustomerSourceArtifact({...pending,...reviewScope,decision:'approve',reason:'Synthetic separate missing-source review',clause:f.clause});expect(held.status).toBe('held')
 await expect(approveSafeMasterdataChanges({actorUserId:f.reviewer.id,edielMessageId:f.sourceMessageId})).rejects.toThrow('reviewed_bilateral_ground_missing')
 expect(unchanged(f)).toEqual(before)
 const bytes=f.pdf('actual signed native source'),artifact=await archiveBilateralCustomerSource({...f.submission('SYNTHETIC qualified local source',bytes,true,'bankruptcy'),...nativeScope})
 expect(artifact.missing).toEqual([])
 expect(Buffer.from((await readBilateralCustomerSourceBytes({...nativeScope,artifactId:artifact.artifactId})).bytes)).toEqual(bytes)
 await expect(reviewBilateralCustomerSourceArtifact({...artifact,...nativeScope,decision:'approve',reason:'Synthetic self review forbidden',clause:f.clause})).rejects.toThrow()
 expect((await reviewBilateralCustomerSourceArtifact({...artifact,...reviewScope,decision:'approve',reason:'Synthetic wrong original clause',clause:{...f.clause,quote:'invented words'}})).status).toBe('held')
 const approved=await reviewBilateralCustomerSourceArtifact({...artifact,...reviewScope,decision:'approve',reason:'Synthetic separate native scoped review',clause:f.clause});expect(approved).toMatchObject({status:'authorized',sourceMessageId:f.sourceMessageId})
 expect((await readBilateralCustomerSourceArtifact({...reviewScope,artifactId:artifact.artifactId})).status).toBe('authorized')
 expect(await approveSafeMasterdataChanges({actorUserId:f.reviewer.id,edielMessageId:f.sourceMessageId})).toMatchObject({status:'applied',appliedCount:1})
 const result=await applyConfirmedCustomerSource({companyId:f.companyId,sourceMessageId:f.sourceMessageId,actorUserId:f.reviewer.id});expect(result).toMatchObject({applied:true,eventId:null,authority:{kind:'bilateral',artifactId:artifact.artifactId}})
 expect(sql(`SELECT jsonb_build_object('versions',(SELECT count(*) FROM gridex_requested_changes.confirmed_customer_versions WHERE source_message_id=${literal(f.sourceMessageId)}),'witnesses',(SELECT count(*) FROM gridex_requested_changes.customer_version_availability WHERE source_message_id=${literal(f.sourceMessageId)}),'invoicee',(SELECT party->'invoicee' FROM gridex_requested_changes.confirmed_customer_versions WHERE source_message_id=${literal(f.sourceMessageId)}),'death',(SELECT party ? 'deathStatus' FROM gridex_requested_changes.confirmed_customer_versions WHERE source_message_id=${literal(f.sourceMessageId)}))`)).toMatchObject({versions:1,witnesses:1,death:false,invoicee:expect.any(Array)})
 expect(unchanged(f)).toEqual(before)
 const after=await snapshot(f);expect(after.customers.versions).toHaveLength(1);expect(after.customers.versions[0]).toMatchObject({sourceMessageId:f.sourceMessageId,authorityKind:'bilateral',party:{name:'SYNTHETIC DATED CUSTOMER'}})
 const projection=projectAiListHistory(after.scope,after.periods,after.readset,after.customers);expect(projection.details).toHaveLength(2)
 expect(projection.details[0].tillDatum).toBe(customerChangeMinute(f.requestedStartDate).slice(0,8));expect(projection.details[1]).toMatchObject({elanvandarNamn:'SYNTHETIC DATED CUSTOMER',franDatum:customerChangeMinute(f.requestedStartDate).slice(0,8),tillDatum:null})
 expect(projection.evidence.rowSources[1].customerSourceMessageId).toBe(f.sourceMessageId)
 expect(isConfirmedCustomerHistoryQualified(structuredClone(after.customers),after.scope,after.readset)).toBe(false)
 expect(()=>projectAiListHistory(after.scope,after.periods,after.readset,structuredClone(after.customers))).toThrow('dated_customer_change_owner_missing')
 const old=await readConfirmedCustomerHistory({scope:early.scope,readset:early.readset,actorUserId:f.reviewer.id});expect(old.versions).toEqual([])
 const csv=buildAiListCsv({listType:'AI',senderEdielId:f.sender,senderName:'SYNTHETIC SUPPLIER',receiverEdielId:f.receiver,receiverName:'SYNTHETIC NETWORK',fromDate:after.scope.fromDate,toDate:after.scope.toDate,details:projection.details}),nativeInput={company_id:f.companyId,environment:'test',customer_id:f.customerId,customer_site_id:f.siteId,metering_point_id:f.pointId,sender_ediel_id:f.sender,receiver_ediel_id:f.receiver}
 // Exercise the ACTUAL complete native CSV fence with an ephemeral typed
 // scope input. No intent, purpose decision, origin or approval is seeded.
 const guard=(raw=csv,refs=projection.evidence.rowSources)=>sql(`SELECT gridex_ai_processing.require_original_row_sources_v1(${literal(after.receipt.readsetText)}::jsonb,${literal(after.scope.cutoffAt)}::timestamptz,jsonb_populate_record(NULL::public.ediel_message_intents,${literal(nativeInput)}::jsonb),${literal(raw)},${literal(JSON.stringify(refs))})`)
 expect(guard()).toEqual(projection.evidence.rowSources)
 expect(()=>guard(csv.replace('SYNTHETIC DATED CUSTOMER','FORGED TODAY NAME'))).toThrow('ai_list_original_row_source_mismatch')
 expect(()=>guard(csv.split('\n').slice(0,2).join('\n'),projection.evidence.rowSources.slice(0,1))).toThrow(/epoch_omitted|source_mismatch|dated_source_owner/)
 const foreign=randomUUID();sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(foreign)},'Disposable foreign bilateral company','active')`);const outsider=await createBilateralSourceOperator(foreign)
 await expect(readBilateralCustomerSourceBytes({companyId:foreign,actorUserId:outsider.id,artifactId:artifact.artifactId})).rejects.toThrow()
 sql(`INSERT INTO public.user_permission_overrides(company_id,user_id,permission_key,effect,valid_from,valid_to,is_active) VALUES(NULL,${literal(f.reviewer.id)},'ediel.source.review','deny',now()-interval '1 day',now()+interval '1 day',true)`)
 expect((await applyConfirmedCustomerSource({companyId:f.companyId,sourceMessageId:f.sourceMessageId,actorUserId:f.uploader.id})).applied).toBe(false)
 expect((await readConfirmedCustomerHistory({scope:after.scope,readset:after.readset,actorUserId:f.uploader.id})).versions).toEqual([]);expect(()=>guard()).toThrow()
 sql(`UPDATE public.user_permission_overrides SET valid_to=now()-interval '1 second' WHERE user_id=${literal(f.reviewer.id)} AND permission_key='ediel.source.review';UPDATE public.tenant_bilateral_agreements SET is_enabled=false WHERE id=${literal(f.agreementId)}`)
 expect((await applyConfirmedCustomerSource({companyId:f.companyId,sourceMessageId:f.sourceMessageId,actorUserId:f.reviewer.id})).applied).toBe(false);expect(()=>guard()).toThrow()
 sql(`UPDATE public.tenant_bilateral_agreements SET is_enabled=true WHERE id=${literal(f.agreementId)};INSERT INTO gridex_bilateral_customer_sources.revocations(target_kind,target_id,source_reference,source_hash) VALUES('representation',${literal(f.representationId)},'SYNTHETIC native revocation only',${literal(createHash('sha256').update('SYNTHETIC revocation').digest('hex'))})`)
 expect((await readConfirmedCustomerHistory({scope:after.scope,readset:after.readset,actorUserId:f.reviewer.id})).versions).toEqual([]);expect(()=>guard()).toThrow()
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_requested_changes.confirmed_customer_versions WHERE source_message_id=${literal(f.sourceMessageId)}`)).toBe(1);expect(unchanged(f)).toEqual(before)
},120000)
