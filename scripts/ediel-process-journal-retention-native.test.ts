import {type SupabaseClient} from '@supabase/supabase-js'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {afterEach,expect,it,vi} from 'vitest'
import {NextRequest} from 'next/server'
const ports=vi.hoisted(()=>({smtp:vi.fn(),client:null as SupabaseClient|null,company:''}))
vi.mock('server-only',()=>({}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:ports.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
vi.mock('@/lib/supabase/server',()=>({createSupabaseServerClient:async()=>{if(!ports.client)throw Error('actual_native_jwt_client_required');return ports.client}}))
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:ports.company})})}))
import {supabaseService} from '@/lib/supabase/service'
import {nativeSql as sql,literal,seedNormalSwitchNativeFixture} from './helpers/ediel-normal-switch-native-fixture'
import {createCustomerRecordRetentionNativeUser} from './helpers/ediel-customer-record-retention-native-fixture'
import {mixedProdatNativeWire} from './helpers/ediel-mixed-prodat-native-wire'
import {PROCESS_JOURNAL_RETENTION_CLASSES,type ProcessJournalRetentionClass} from '@/lib/ediel/retention/processJournalRetention'
import {POST} from '@/app/api/ediel/process-journal-retention/route'
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
afterEach(()=>{vi.unstubAllEnvs();ports.smtp.mockReset();ports.client=null;ports.company=''})
async function http(client:SupabaseClient,body:unknown){ports.client=client;return POST(new NextRequest('http://localhost/api/ediel/process-journal-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))}
async function fixture(){
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await seedNormalSwitchNativeFixture({provider:email=>ports.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})})
 const common=['ediel.retention.read','ediel.retention.legal_history'],writer=await createCustomerRecordRetentionNativeUser(f.companyId,[...common,'ediel.retention.submit','ediel.retention.review','ediel.retention.purge']),reviewer=await createCustomerRecordRetentionNativeUser(f.companyId,[...common,'ediel.retention.review']),readonly=await createCustomerRecordRetentionNativeUser(f.companyId,common)
 const fact=sql<{id:string;hash:string}>(`SELECT jsonb_build_object('id',id::text,'hash',facts_hash) FROM gridex_correction_process.facts WHERE company_id=${literal(f.companyId)} AND table_name='customer_contracts' AND row_id=${literal(f.contractId)} ORDER BY id DESC LIMIT 1`)
 expect(fact.id).toMatch(/^\d+$/);expect(fact.hash).toMatch(/^[a-f0-9]{64}$/)
 const visibility=sql<{witnessId:string;factsHash:string;authority:string}>(`SET ROLE service_role;SELECT public.gridex_witness_correction_process_fact_v1(${literal(f.companyId)},${fact.id},${literal(fact.hash)},${literal(f.actorUserId)})`)
 expect(visibility.factsHash).toBe(fact.hash);expect(visibility.authority).toBe('none')
 // The real installed owner captures and serializes its own process population.
 const readset=sql<{snapshotId:string;readsetHash:string;readsetText:string}>(`SET ROLE service_role;SELECT public.gridex_open_correction_process_readset_v1(${literal(f.companyId)},'test',${literal(f.actorUserId)},clock_timestamp(),${literal(f.customerId)},NULL,NULL)`)
 expect(createHash('sha256').update(readset.readsetText).digest('hex')).toBe(readset.readsetHash);expect(JSON.parse(readset.readsetText)).toMatchObject({complete:false,authority:'none'})
 // Received raw original uses genuine own physical tenant/point facts. There
 // is no canonical/accepted/business-source seed or market effect: E035 reader
 // remains a hold-only prospective snapshot even for unqualified originals.
 let raw=mixedProdatNativeWire({external:f.external,sender:f.sender,receiver:f.receiver,customerIdentity:f.customerIdentity,caseReference:f.caseReference,startMinute:f.requestedStartDate.replaceAll('-','')+'0000',negativePoint:'735999123456789019'})
 raw=raw.replace(/UNB\+[^']*'/,segment=>{const parts=segment.slice(0,-1).split('+');while(parts.length<12)parts.push('');parts[9]='1';parts[11]='1';return parts.join('+')+"'"})
 const sourceId=randomUUID()
 sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,status,raw_payload,customer_id,site_id,metering_point_id,message_received_at,sender_ediel_id,receiver_ediel_id) VALUES(${literal(sourceId)},${literal(f.companyId)},'test','inbound','edifact','PRODAT','Z04','received',${literal(raw)},${literal(f.customerId)},${literal(f.siteId)},${literal(f.pointId)},clock_timestamp(),${literal(f.receiver)},${literal(f.sender)})`)
 const combined=sql<{snapshotId:string;readsetHash:string;readsetText:string}>(`SET ROLE service_role;SELECT public.gridex_correction_combined_snapshot_v1(${literal(f.companyId)},'test',${literal(sourceId)},clock_timestamp())`)
 expect(createHash('sha256').update(combined.readsetText).digest('hex')).toBe(combined.readsetHash)
 const targets:Record<ProcessJournalRetentionClass,string>={correction_process_fact_body:fact.id,correction_process_readset_body:readset.snapshotId,correction_process_combined_readset_body:combined.snapshotId}
 // Explicit test-only external legal competence and customer closure boundaries.
 // No runtime issuer/default policy or business source approval is manufactured.
 const issuer=randomUUID(),key=Buffer.from(randomUUID()+randomUUID())
 sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to) VALUES(${literal(issuer)},${literal(f.companyId)},'SYNTHETIC JOURNAL COMPETENCE ONLY',decode('53594e544845544943','hex'),encode(sha256(decode('53594e544845544943','hex')),'hex'),decode(${literal(key.toString('hex'))},'hex'),now()-interval '1 day',now()+interval '1 day');UPDATE public.customers SET status='archived' WHERE company_id=${literal(f.companyId)})`)
 ports.company=f.companyId
 const policy=async(k:ProcessJournalRetentionClass,document:Buffer,extra:Record<string,unknown>={})=>{
  const response=await http(writer.client,{action:'basis',retentionClass:k,targetId:targets[k]});expect(response.status,await response.clone().text()).toBe(200);const basis=await response.json()
  const payload=Buffer.from(JSON.stringify({format:'ediel_process_journal_retention_policy_v1',...basis,operation:({correction_process_fact_body:'redact_process_fact_body',correction_process_readset_body:'redact_process_readset_body',correction_process_combined_readset_body:'redact_process_combined_readset_body'})[k],companyId:f.companyId,documentHash:digest(document),issuerLegalReference:'SYNTHETIC JOURNAL COMPETENCE ONLY',legalBasisReference:'SYNTHETIC only exact process copy deadline',journalPurposeReference:'SYNTHETIC finite hash and identity purpose',accessRevocationRequired:true,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),journalRetainUntil:new Date(Date.now()+3600000).toISOString(),...extra}))
  return {issuerId:issuer,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}
 }
 return {...f,writer,reviewer,readonly,targets,policy,visibility}
}
it('actual publication/signature/PDF/POA/native SMTP and prospective process/readset/combined owners feed three independent class decisions through real GoTrue/scoped HTTP; all hashes and immutable metadata survive only their own qualified redaction',async()=>{
 const f=await fixture()
 for(const k of PROCESS_JOURNAL_RETENTION_CLASSES){
  const document=Buffer.from('SYNTHETIC distinct exact '+k),submitted=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:await f.policy(k,document)});expect(submitted.status,await submitted.clone().text()).toBe(200);const decision=await submitted.json();expect(decision.issuerQualified).toBe(true)
  const read=await http(f.readonly.client,{action:'read',decisionId:decision.decisionId});expect(read.status).toBe(200);expect(Buffer.from((await read.json()).documentBase64,'base64')).toEqual(document)
  expect((await http(f.writer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'same actor forbidden'})).status).toBe(403)
  const reviewed=await http(f.reviewer.client,{action:'review',decisionId:decision.decisionId,outcome:'approve',reason:'SYNTHETIC separate exact source mechanism'});expect(reviewed.status,await reviewed.clone().text()).toBe(200);expect((await reviewed.json()).status).toBe('approved')
  const sourceTable=k==='correction_process_fact_body'?'facts':k==='correction_process_readset_body'?'readsets':'combined_snapshots',nativeTarget=k==='correction_process_fact_body'?f.targets[k]:literal(f.targets[k]),before=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM gridex_correction_process.${sourceTable} r WHERE id=${nativeTarget}`)
  const result=await http(f.writer.client,{action:'purge',decisionId:decision.decisionId});expect(result.status,await result.clone().text()).toBe(200);expect(await result.json()).toMatchObject({status:'redacted',retentionClass:k,targetId:f.targets[k],sourceHash:decision.sourceHash,replay:false});expect((await (await http(f.writer.client,{action:'purge',decisionId:decision.decisionId})).json()).replay).toBe(true)
  const spec=sql<{table:string}>(`SELECT jsonb_build_object('table',source_table) FROM gridex_ediel_retention.process_class_catalog WHERE retention_class=${literal(k)}`),row=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM gridex_correction_process.${spec.table} r WHERE id=${k==='correction_process_fact_body'?f.targets[k]:literal(f.targets[k])}`),body=k==='correction_process_fact_body'?row.new_fact:JSON.parse(String(row.readset_text))
  const immutable=(entry:Record<string,unknown>)=>Object.fromEntries(Object.entries(entry).filter(([key])=>k==='correction_process_fact_body'?!['old_fact','new_fact'].includes(key):key!=='readset_text'))
  expect(immutable(row)).toEqual(immutable(before))
  if(k==='correction_process_fact_body'){
   const past=sql<{witnessId:string;retentionUnavailable:boolean;bytesAvailable:boolean;authority:string}>(`SET ROLE service_role;SELECT public.gridex_witness_correction_process_fact_v1(${literal(f.companyId)},${f.targets[k]},${literal(decision.sourceHash)},${literal(f.actorUserId)})`);expect(past).toMatchObject({witnessId:f.visibility.witnessId,retentionUnavailable:true,bytesAvailable:false,authority:'none'})
   expect(()=>sql(`INSERT INTO gridex_correction_process.witnesses(fact_id,company_id,facts_hash) VALUES(${f.targets[k]},${literal(f.companyId)},${literal(decision.sourceHash)})`)).toThrow(/tombstoned/)
  }
  expect(body).toEqual({retentionUnavailable:true,sourceHash:decision.sourceHash,complete:false,authority:'none'});expect(k==='correction_process_fact_body'?row.facts_hash:row.readset_hash).toBe(decision.sourceHash)
  const held=await supabaseService.rpc('ediel_require_process_journal_available_v1',{p_company_id:f.companyId,p_retention_class:k,p_target_id:f.targets[k]});expect(held.error?.message).toContain('tombstoned')
 }
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.process_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(3)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.process_events e JOIN gridex_ediel_retention.process_tombstones t USING(retention_class,target_id) WHERE t.company_id=${literal(f.companyId)}`)).toBe(3)
},180000)
it('actual all-included customer scope, current reviewer DENY, hostile company/actor, no issuer and late native audit failure hold the unchanged copies with no partial tombstone or provider side effect',async()=>{
 const f=await fixture(),k='correction_process_combined_readset_body',document=Buffer.from('SYNTHETIC whole-scope-only')
 const missing=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:null});expect((await missing.json()).issuerQualified).toBe(false)
 expect((await http(f.readonly.client,{action:'purge',decisionId:randomUUID()})).status).toBe(403);expect((await http(f.writer.client,{action:'basis',retentionClass:k,targetId:f.targets[k],companyId:randomUUID()})).status).toBe(400)
 const created=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:await f.policy(k,document)}),decision=(await created.json()).decisionId
 // Actual newly committed independent open scope changes the qualified native
 // company's complete scope hash; no caller closure boolean can suppress it.
 const customer=randomUUID();sql(`INSERT INTO public.customers(id,company_id,customer_number,status,first_name,last_name) VALUES(${literal(customer)},${literal(f.companyId)},${literal('J-'+randomUUID())},'active','Synthetic','Journal scope')`)
 const held=await http(f.reviewer.client,{action:'review',decisionId:decision,outcome:'approve',reason:'SYNTHETIC active included scope'});expect(held.status).toBe(409)
 sql(`UPDATE public.customers SET status='archived' WHERE id=${literal(customer)}`)
 const doc2=Buffer.from('SYNTHETIC changed native scope needs new exact policy'),next=await http(f.writer.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:doc2.toString('base64'),issuerReceipt:await f.policy(k,doc2)}),id=(await next.json()).decisionId;expect((await http(f.reviewer.client,{action:'review',decisionId:id,outcome:'approve',reason:'SYNTHETIC now exact closed native scope'})).status).toBe(200)
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES(${literal(f.reviewer.id)},${literal(f.companyId)},'ediel.retention.legal_history','deny',true)`);expect((await http(f.writer.client,{action:'purge',decisionId:id})).status).toBe(409);sql(`DELETE FROM public.user_permission_overrides WHERE user_id=${literal(f.reviewer.id)} AND company_id=${literal(f.companyId)}`)
 const trigger='journal_late_'+randomUUID().replaceAll('-','');sql(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.company_id=${literal(f.companyId)}::uuid AND NEW.action='ediel.retention.process_redacted' THEN RAISE EXCEPTION 'native late journal audit rollback';END IF;RETURN NEW;END$$;CREATE TRIGGER ${trigger} BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`)
 try{expect((await http(f.writer.client,{action:'purge',decisionId:id})).status).toBe(403);expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.process_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(0);expect((await http(f.writer.client,{action:'basis',retentionClass:k,targetId:f.targets[k]})).status).toBe(200)}finally{sql(`DROP TRIGGER ${trigger} ON public.audit_logs;DROP FUNCTION public.${trigger}()`)}
 expect(ports.smtp).toHaveBeenCalledTimes(1)
 for(const role of ['anon','authenticated','service_role'])expect(()=>sql(`SET ROLE ${role};SELECT * FROM gridex_ediel_retention.process_decisions`)).toThrow(/permission denied/)
},180000)
