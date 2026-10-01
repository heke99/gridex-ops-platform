import {type SupabaseClient} from '@supabase/supabase-js'
import {createHash,randomUUID} from 'node:crypto'
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
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {CUSTOMER_RECORD_RETENTION_CLASSES} from '@/lib/ediel/retention/recordClasses.catalog'
import {POST} from '@/app/api/ediel/customer-record-retention/route'
import {requireCustomerRecordAvailable,requireContractRecordsAvailable,requirePortalRetentionAccess} from '@/lib/ediel/retention/customerRecordClasses'
import {seedCustomerRecordRetentionNativeFixture} from './helpers/ediel-customer-record-retention-native-fixture'
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
afterEach(()=>{vi.unstubAllEnvs();ports.smtp.mockReset();ports.client=null;ports.company=''})
async function fixture(){const f=await seedCustomerRecordRetentionNativeFixture({provider:email=>ports.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'})});ports.company=f.companyId;return f}
async function http(client:SupabaseClient,body:unknown){ports.client=client;return POST(new NextRequest('http://localhost/api/ediel/customer-record-retention',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}))}
it('actual signed publication/PDF/POA/Z03, canonical onboarding and own public histories feed all twelve distinct native class owners through scoped HTTP; actual JWT Storage removal has a real unavailable readback',async()=>{
 const f=await fixture()
 for(const k of CUSTOMER_RECORD_RETENTION_CLASSES){
  const document=Buffer.from('SYNTHETIC SOURCE-SPECIFIC POLICY '+k),response=await http(f.submitter.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:f.policy(k,document)});expect(response.status,await response.clone().text()).toBe(200);const submitted=await response.json();expect(submitted).toMatchObject({status:'submitted',issuerQualified:true,retentionClass:k})
  const inspected=await http(f.reviewer.client,{action:'read',decisionId:submitted.decisionId});expect(inspected.status).toBe(200);const bytes=await inspected.json();expect(Buffer.from(bytes.documentBase64,'base64')).toEqual(document);expect(bytes.documentHash).toBe(digest(document))
  const same=await f.submitter.client.rpc('ediel_review_customer_record_retention_v1',{p_company_id:f.companyId,p_actor_user_id:f.submitter.id,p_decision_id:submitted.decisionId,p_outcome:'approve',p_reason:'invalid same writer'});expect(same.error).not.toBeNull()
  const reviewed=await http(f.reviewer.client,{action:'review',decisionId:submitted.decisionId,outcome:'approve',reason:'SYNTHETIC separate exact-source mechanism review'});expect(reviewed.status,await reviewed.clone().text()).toBe(200);expect((await reviewed.json()).status).toBe('approved')
  const beforePdf=k==='contract_signed_pdf_bytes'?sql<{path:string;hash:string}>(`SELECT jsonb_build_object('path',storage_path,'hash',document_sha256) FROM public.customer_contract_documents WHERE id=${literal(f.targets[k])}`):null
  if(beforePdf){const before=await supabaseService.storage.from('customer-contract-documents').download(beforePdf.path);expect(before.error).toBeNull();expect(digest(Buffer.from(await before.data!.arrayBuffer()))).toBe(beforePdf.hash)}
  const purged=await http(f.submitter.client,{action:'purge',decisionId:submitted.decisionId});expect(purged.status,await purged.clone().text()).toBe(200);const receipt=await purged.json();expect(receipt).toMatchObject({retentionClass:k,targetId:f.targets[k],status:beforePdf?'storage_object_absent':'redacted'})
  if(beforePdf){expect(receipt.physicalBytesObservedUnavailable).toBe(true);const unavailable=await supabaseService.storage.from('customer-contract-documents').download(beforePdf.path);expect(unavailable.data).toBeNull();expect(['404','400']).toContain(String(unavailable.error?.statusCode));expect(unavailable.error?.message).toMatch(/not found|does not exist/i)}
  else{const spec=sql<{table:string;redaction:Record<string,unknown>}>(`SELECT jsonb_build_object('table',source_table,'redaction',redaction) FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=${literal(k)}`),row=sql<Record<string,unknown>>(`SELECT to_jsonb(r) FROM public.${spec.table} r WHERE id=${literal(f.targets[k])}`);for(const [field,value]of Object.entries(spec.redaction))expect(row[field],k+'.'+field).toEqual(value==='RETENTION_EMAIL'?`retained-signature-${f.targets[k]}@example.invalid`:value)}
  await expect(requireCustomerRecordAvailable({companyId:f.companyId,retentionClass:k,targetId:f.targets[k]})).rejects.toBeDefined()
  expect((await (await http(f.submitter.client,{action:'purge',decisionId:submitted.decisionId})).json()).replay).toBe(true)
 }
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.record_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(12)
 await expect(requireContractRecordsAvailable({companyId:f.companyId,contractId:f.contractId})).rejects.toBeDefined();await expect(requirePortalRetentionAccess({companyId:f.companyId,customerId:f.customerId})).rejects.toBeDefined()
},180000)
it('missing legal competence, hostile tenant selectors and committed current reviewer class DENY hold actual source bytes and histories without partial tombstone or provider effects',async()=>{
 const f=await fixture(),k='customer_address_history',document=Buffer.from('SYNTHETIC negative scope decision')
 const unqualified=await http(f.submitter.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:document.toString('base64'),issuerReceipt:null});const u=await unqualified.json();expect(u.issuerQualified).toBe(false);expect((await http(f.reviewer.client,{action:'review',decisionId:u.decisionId,outcome:'approve',reason:'SYNTHETIC no issuer must hold'})).status).toBe(409)
 expect((await http(f.submitter.client,{action:'purge',decisionId:u.decisionId,companyId:randomUUID()})).status).toBe(400)
 const qualifiedDoc=Buffer.from('SYNTHETIC exact negative class policy'),created=await http(f.submitter.client,{action:'submit',retentionClass:k,targetId:f.targets[k],documentBase64:qualifiedDoc.toString('base64'),issuerReceipt:f.policy(k,qualifiedDoc)}),decision=(await created.json()).decisionId;expect((await http(f.reviewer.client,{action:'review',decisionId:decision,outcome:'approve',reason:'SYNTHETIC separate'})).status).toBe(200)
 const before=sql<Record<string,unknown>>(`SELECT to_jsonb(a) FROM public.customer_addresses a WHERE id=${literal(f.targets[k])}`)
 sql(`INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,effect,is_active) VALUES(${literal(f.reviewer.id)},${literal(f.companyId)},'ediel.retention.address_history','deny',true)`)
 expect((await http(f.submitter.client,{action:'purge',decisionId:decision})).status).toBe(409);expect(sql(`SELECT to_jsonb(a) FROM public.customer_addresses a WHERE id=${literal(f.targets[k])}`)).toEqual(before);expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.record_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(0)
 sql(`DELETE FROM public.user_permission_overrides WHERE user_id=${literal(f.reviewer.id)} AND company_id=${literal(f.companyId)}`)
 const trigger='native_record_retention_late_'+randomUUID().replaceAll('-','');sql(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.company_id=${literal(f.companyId)}::uuid AND NEW.action='ediel.retention.record_tombstoned' THEN RAISE EXCEPTION 'actual final retention audit blocked';END IF;RETURN NEW;END$$;CREATE TRIGGER ${trigger} BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.${trigger}()`)
 try{expect((await http(f.submitter.client,{action:'purge',decisionId:decision})).status).toBe(403);expect(sql(`SELECT to_jsonb(a) FROM public.customer_addresses a WHERE id=${literal(f.targets[k])}`)).toEqual(before);expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.record_tombstones WHERE company_id=${literal(f.companyId)}`)).toBe(0)}finally{sql(`DROP TRIGGER ${trigger} ON public.audit_logs;DROP FUNCTION public.${trigger}()`)}
},180000)
