import {readFileSync,writeFileSync} from 'node:fs'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {expect,it,vi} from 'vitest'
vi.mock('server-only',()=>({}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {nativeSql as sql,literal,seedNormalSwitchNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {createCustomerRecordRetentionNativeUser} from './helpers/ediel-customer-record-retention-native-fixture'
import {mixedProdatNativeWire} from './helpers/ediel-mixed-prodat-native-wire'
import {PROCESS_JOURNAL_RETENTION_CLASSES,type ProcessJournalRetentionClass} from '@/lib/ediel/retention/processJournalRetention'
type Target={retentionClass:ProcessJournalRetentionClass;targetId:string;documentBase64:string;documentHash:string;sourceHash:string;issuerReceipt:Record<string,string>;immutable:Record<string,unknown>;decisionId?:string}
type Fixture={companyId:string;actorId:string;actorEmail:string;reviewerId:string;reviewerEmail:string;readonlyEmail:string;foreignCompanyId:string;foreignEmail:string;targets:Target[]}
const digest=(b:Buffer)=>createHash('sha256').update(b).digest('hex')
const table=(k:ProcessJournalRetentionClass)=>k==='correction_process_fact_body'?'facts':k==='correction_process_readset_body'?'readsets':'combined_snapshots'
const stable=(k:ProcessJournalRetentionClass,row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).filter(([key])=>k==='correction_process_fact_body'?!['old_fact','new_fact'].includes(key):key!=='readset_text'))
it('genuine pre-market contract/signature/PDF/POA and installed prospective owners create archived UI scopes without accepted market seeds; post-browser native checks all three exact class receipts',async()=>{
 const path=process.env.GRIDEX_PROCESS_RETENTION_FIXTURE_PATH,password=process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD
 if(!path||!password||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_process_retention_browser_fixture_required')
 if(process.env.GRIDEX_PROCESS_RETENTION_VERIFY_AFTER_BROWSER==='1'){
  const f=JSON.parse(readFileSync(path,'utf8')) as Fixture
  expect(f.targets).toHaveLength(3)
  for(const target of f.targets){
   expect(target.decisionId).toMatch(/^[a-f0-9-]{36}$/)
   expect(sql(`SELECT jsonb_build_object('decisions',(SELECT count(*) FROM gridex_ediel_retention.process_decisions WHERE company_id=${literal(f.companyId)} AND id=${literal(target.decisionId)} AND submitted_by=${literal(f.actorId)} AND document_hash=${literal(target.documentHash)}),'reviews',(SELECT count(*) FROM gridex_ediel_retention.process_reviews WHERE decision_id=${literal(target.decisionId)} AND actor_user_id=${literal(f.reviewerId)} AND outcome='approved'),'tombstones',(SELECT count(*) FROM gridex_ediel_retention.process_tombstones WHERE company_id=${literal(f.companyId)} AND retention_class=${literal(target.retentionClass)} AND target_id=${literal(target.targetId)} AND decision_id=${literal(target.decisionId)}),'events',(SELECT count(*) FROM gridex_ediel_retention.process_events WHERE retention_class=${literal(target.retentionClass)} AND target_id=${literal(target.targetId)}))`)).toEqual({decisions:1,reviews:1,tombstones:1,events:1})
   const row=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM gridex_correction_process.${table(target.retentionClass)} r WHERE id=${target.retentionClass==='correction_process_fact_body'?target.targetId:literal(target.targetId)}`)
   expect(stable(target.retentionClass,row)).toEqual(target.immutable)
   expect(target.retentionClass==='correction_process_fact_body'?row.new_fact:JSON.parse(String(row.readset_text))).toEqual({retentionUnavailable:true,sourceHash:target.sourceHash,complete:false,authority:'none'})
  }
  expect(sql(`SELECT jsonb_build_object('decisions',(SELECT count(*) FROM gridex_ediel_retention.process_decisions WHERE company_id=${literal(f.companyId)}),'foreign',(SELECT count(*) FROM gridex_ediel_retention.process_decisions WHERE company_id=${literal(f.foreignCompanyId)}),'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(f.companyId)}),'supply',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(f.companyId)}))`)).toEqual({decisions:3,foreign:0,originals:0,supply:0})
  return
 }
 // This source producer reaches actual signed internal evidence before the
 // protected first-original gate. It does not evade a held market boundary.
 const f=await seedNormalSwitchNativeFixture({deferOriginal:true})
 const fact=sql<{id:string;hash:string}>(`SELECT jsonb_build_object('id',id::text,'hash',facts_hash) FROM gridex_correction_process.facts WHERE company_id=${literal(f.companyId)} AND table_name='customer_contracts' AND row_id=${literal(f.contractId)} ORDER BY id DESC LIMIT 1`)
 expect(fact.id).toMatch(/^\d+$/);expect(fact.hash).toMatch(/^[a-f0-9]{64}$/)
 const readset=sql<{snapshotId:string;readsetHash:string;readsetText:string}>(`SET ROLE service_role;SELECT public.gridex_open_correction_process_readset_v1(${literal(f.companyId)},'test',${literal(f.actorUserId)},clock_timestamp(),${literal(f.customerId)},NULL,NULL)`)
 expect(digest(Buffer.from(readset.readsetText))).toBe(readset.readsetHash);expect(JSON.parse(readset.readsetText)).toMatchObject({complete:false,authority:'none'})
 let raw=mixedProdatNativeWire({external:f.external,sender:f.sender,receiver:f.receiver,customerIdentity:f.customerIdentity,caseReference:'SYNTHETIC-'+randomUUID(),startMinute:f.requestedStartDate.replaceAll('-','')+'0000',negativePoint:'735999123456789019'})
 raw=raw.replace(/UNB\+[^']*'/,segment=>{const parts=segment.slice(0,-1).split('+');while(parts.length<12)parts.push('');parts[9]='1';parts[11]='1';return parts.join('+')+"'"})
 const source=randomUUID()
 sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,customer_id,site_id,metering_point_id,message_received_at,sender_ediel_id,receiver_ediel_id,canonical_rule_pack_id,rule_profile_key,rule_profile_version_id,rule_profile_version,rule_pack_checksum,rule_pack_snapshot) SELECT ${literal(source)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z04','received',${literal(raw)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},clock_timestamp(),${literal(f.receiver)},${literal(f.sender)},pack.id,profile.profile_key,profile.id,pack.guide_version||':r'||pack.guide_revision,pack.source_hash,profile.profile FROM public.ediel_message_profiles profile JOIN public.ediel_rule_packs pack ON pack.id=profile.rule_pack_id WHERE profile.profile_key='PRODAT:Z04:L:26.A:r3' AND profile.is_enabled`)
 const combined=sql<{snapshotId:string;readsetHash:string;readsetText:string}>(`SET ROLE service_role;SELECT public.gridex_correction_combined_snapshot_v1(${literal(f.companyId)},'test',${literal(source)},clock_timestamp())`)
 expect(digest(Buffer.from(combined.readsetText))).toBe(combined.readsetHash);expect(JSON.parse(combined.readsetText)).toMatchObject({complete:false,authority:'none'})
 // Only explicit synthetic legal competence and public closed-customer facts
 // form external fixture boundaries. No private decision/review is inserted.
 sql(`UPDATE public.customers SET status='archived' WHERE company_id=${literal(f.companyId)};UPDATE public.companies SET status='archived' WHERE id=${literal(f.companyId)}`)
 const shared=['ediel.retention.read','ediel.retention.legal_history'],writer=await createCustomerRecordRetentionNativeUser(f.companyId,[...shared,'ediel.retention.submit','ediel.retention.review','ediel.retention.purge'],password),reviewer=await createCustomerRecordRetentionNativeUser(f.companyId,[...shared,'ediel.retention.review'],password),readonly=await createCustomerRecordRetentionNativeUser(f.companyId,shared,password)
 const foreignCompany=randomUUID();sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(foreignCompany)},'Synthetic foreign process journal browser','archived')`);const foreign=await createCustomerRecordRetentionNativeUser(foreignCompany,shared,password)
 for(const u of [writer,reviewer,readonly,foreign]){const listed=await u.client.rpc('ediel_current_retention_companies_v1',{});expect(listed.error).toBeNull();expect(listed.data.map((c:{companyId:string})=>c.companyId)).toEqual([u===foreign?foreignCompany:f.companyId])}
 const issuer=randomUUID(),key=Buffer.from(randomUUID()+randomUUID()),legal=Buffer.from('SYNTHETIC ONLY separate process-journal issuer competence')
 sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to) VALUES(${literal(issuer)},${literal(f.companyId)},'SYNTHETIC PROCESS BROWSER ONLY',decode(${literal(legal.toString('hex'))},'hex'),${literal(digest(legal))},decode(${literal(key.toString('hex'))},'hex'),now()-interval '1 day',now()+interval '1 day')`)
 const ids:Record<ProcessJournalRetentionClass,string>={correction_process_fact_body:fact.id,correction_process_readset_body:readset.snapshotId,correction_process_combined_readset_body:combined.snapshotId},targets:Target[]=[]
 for(const retentionClass of PROCESS_JOURNAL_RETENTION_CLASSES){
  const reply=await writer.client.rpc('ediel_process_journal_retention_basis_v1',{p_company_id:f.companyId,p_actor_user_id:writer.id,p_retention_class:retentionClass,p_target_id:ids[retentionClass]});expect(reply.error).toBeNull();expect(reply.data).toMatchObject({allIncludedScopesClosed:true,complete:false,authority:'none'})
  const document=Buffer.from('SYNTHETIC BROWSER exact separate '+retentionClass),documentHash=digest(document),operation={correction_process_fact_body:'redact_process_fact_body',correction_process_readset_body:'redact_process_readset_body',correction_process_combined_readset_body:'redact_process_combined_readset_body'}[retentionClass]
  const bytes=Buffer.from(JSON.stringify({format:'ediel_process_journal_retention_policy_v1',...reply.data,operation,companyId:f.companyId,documentHash,issuerLegalReference:'SYNTHETIC PROCESS BROWSER ONLY',legalBasisReference:'SYNTHETIC exact class deadline only',journalPurposeReference:'SYNTHETIC finite immutable source identity purpose',accessRevocationRequired:true,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),journalRetainUntil:new Date(Date.now()+3600000).toISOString()}))
  const row=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM gridex_correction_process.${table(retentionClass)} r WHERE id=${retentionClass==='correction_process_fact_body'?ids[retentionClass]:literal(ids[retentionClass])}`)
  targets.push({retentionClass,targetId:ids[retentionClass],documentBase64:document.toString('base64'),documentHash,sourceHash:reply.data.sourceHash,issuerReceipt:{issuerId:issuer,payloadBase64:bytes.toString('base64'),signatureHex:createHmac('sha256',key).update(bytes).digest('hex')},immutable:stable(retentionClass,row)})
 }
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.process_decisions WHERE company_id=${literal(f.companyId)}`)).toBe(0)
 writeFileSync(path,JSON.stringify({companyId:f.companyId,actorId:writer.id,actorEmail:writer.email,reviewerId:reviewer.id,reviewerEmail:reviewer.email,readonlyEmail:readonly.email,foreignCompanyId:foreignCompany,foreignEmail:foreign.email,targets} satisfies Fixture),{mode:0o600})
},180000)
