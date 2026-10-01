import {readFileSync,writeFileSync} from 'node:fs'
import {createClient} from '@supabase/supabase-js'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {expect,it,vi} from 'vitest'
const port=vi.hoisted(()=>({smtp:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('nodemailer',()=>({default:{createTransport:()=>({sendMail:port.smtp})}}))
vi.mock('@/lib/customer-notifications/notificationOrchestrator',()=>({enqueueCustomerLifecycleNotification:async()=>null}))
vi.mock('@/lib/website/customerApplicationWorkflowBridge',()=>({transitionCorrelatedCustomerApplicationWorkflow:async()=>null}))
import {supabaseService} from '@/lib/supabase/service'
import {nativeSql as sql,literal} from './helpers/ediel-normal-switch-native-fixture'
import {createRequestedChangeSupplyFixture} from './helpers/ediel-requested-change-native-fixture'
const hash=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex')
async function user(company:string,permissions:string[],password:string){
 const email=randomUUID()+'@example.invalid',created=await supabaseService.auth.admin.createUser({email,password,email_confirm:true});expect(created.error).toBeNull();const id=created.data.user!.id
 sql(`INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(company)},${literal(id)},'member','active',now(),'{}','member',true,now(),'member');UPDATE public.user_profiles SET user_status='active' WHERE id=${literal(id)};INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key) SELECT ${literal(id)},${literal(company)},id,key FROM public.permissions WHERE key=ANY(ARRAY[${permissions.map(literal).join(',')}])`)
 const client=createClient('http://127.0.0.1:54321',process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false}});expect((await client.auth.signInWithPassword({email,password})).error).toBeNull();expect((await client.auth.getUser()).data.user?.id).toBe(id)
 expect(sql(`SELECT to_jsonb(EXISTS(SELECT FROM public.admin_users WHERE user_id=${literal(id)} AND is_active))`)).toBe(false);return{id,email,client}
}
type Target={retentionClass:string;targetId:string;documentBase64:string;documentHash:string;issuerReceipt:Record<string,unknown>;revocationDocumentBase64:string;revocationIssuerReceipt:Record<string,unknown>;decisionId?:string;revokedDecisionId?:string}
type Fixture={companyId:string;actorId:string;actorEmail:string;reviewerId:string;reviewerEmail:string;readonlyEmail:string;foreignCompanyId:string;foreignEmail:string;mimePath:string;sourceMessageId:string;targets:Target[]}
it('genuine local source/archive owners prepare standalone archived-only message/MIME UI data and independently verify physical receipts after browser',async()=>{
 const path=process.env.GRIDEX_BLOB_RETENTION_FIXTURE_PATH,password=process.env.GRIDEX_EDIEL_CASE_TEST_PASSWORD
 if(!path||!password||process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_blob_retention_browser_fixture_required')
 if(process.env.GRIDEX_BLOB_RETENTION_VERIFY_AFTER_BROWSER==='1'){
  const f=JSON.parse(readFileSync(path,'utf8')) as Fixture
  for(const target of f.targets){
   expect(target.decisionId).toBeTruthy();expect(target.revokedDecisionId).toBeTruthy()
   expect(sql(`SELECT jsonb_build_object('decision',(SELECT count(*) FROM gridex_ediel_retention.blob_decisions WHERE company_id=${literal(f.companyId)} AND id=${literal(target.decisionId!)} AND submitted_by=${literal(f.actorId)} AND document_hash=${literal(target.documentHash)}),'review',(SELECT count(*) FROM gridex_ediel_retention.blob_reviews WHERE decision_id=${literal(target.decisionId!)} AND actor_user_id=${literal(f.reviewerId)} AND outcome='approved'),'revocation',(SELECT count(*) FROM gridex_ediel_retention.blob_revocations WHERE decision_id=${literal(target.revokedDecisionId!)} AND actor_user_id=${literal(f.reviewerId)}),'tombstone',(SELECT count(*) FROM gridex_ediel_retention.blob_tombstones WHERE company_id=${literal(f.companyId)} AND retention_class=${literal(target.retentionClass)} AND target_id=${literal(target.targetId)} AND decision_id=${literal(target.decisionId!)}))`)).toEqual({decision:1,review:1,revocation:1,tombstone:1})
  }
  expect(sql(`SELECT to_jsonb(s.raw_payload IS NULL AND s.retention_purged_at IS NOT NULL AND m.raw_payload IS NULL AND m.parsed_payload='{}' AND m.validation_report='{}' AND m.metadata='{}') FROM gridex_received_sources.sources s JOIN public.ediel_messages m ON m.id=s.source_message_id WHERE s.company_id=${literal(f.companyId)} AND s.source_message_id=${literal(f.sourceMessageId)}`)).toBe(true)
  expect((await supabaseService.rpc('ediel_require_source_bytes_available_v1',{p_company_id:f.companyId,p_source_message_id:f.sourceMessageId})).error).not.toBeNull()
  const bytes=await supabaseService.storage.from('ediel-files').download(f.mimePath);expect(bytes.data).toBeNull();expect(String(bytes.error?.statusCode)).toBe('404')
  expect(sql(`SELECT jsonb_build_object('finished',(SELECT count(*) FROM gridex_ediel_retention.blob_events e JOIN gridex_ediel_retention.blob_tombstones t ON t.target_id=e.target_id AND t.retention_class=e.retention_class WHERE t.company_id=${literal(f.companyId)} AND e.kind='physical_bytes_removed'),'foreign',(SELECT count(*) FROM gridex_ediel_retention.blob_decisions WHERE company_id=${literal(f.foreignCompanyId)}))`)).toEqual({finished:1,foreign:0});return
 }
 for(const[k,v]of Object.entries({EDIEL_SHARED_MAILBOX_ADDRESS:'synthetic@example.invalid',EDIEL_APP_DKIM_ENABLED:'false',EMAIL_PROVIDER:'resend',EDIEL_SMTP_FROM:'synthetic@example.invalid',EDIEL_SMTP_USER:'synthetic@example.invalid',EDIEL_SMTP_PASS:'synthetic-only',EDIEL_EMAIL_PROVIDER:'strato'}))vi.stubEnv(k,v)
 const f=await createRequestedChangeSupplyFixture(email=>port.smtp.mockResolvedValue({accepted:[email],rejected:[],messageId:randomUUID(),response:'250 synthetic accepted'}))
 const mime=sql<{id:string;path:string;hash:string}>(`SELECT jsonb_build_object('id',p.id,'path',p.metadata->>'archive_path','hash',p.metadata->>'archived_mime_sha256') FROM public.ediel_message_payloads p JOIN gridex_ediel_transport.attempts a ON a.company_id=p.company_id AND a.message_id=p.ediel_message_id AND a.binding->>'mimePayloadSnapshotId'=p.id::text WHERE p.company_id=${literal(f.companyId)} AND p.ediel_message_id=${literal(f.originalZ03.id)} AND a.classification='accepted' ORDER BY p.created_at DESC LIMIT 1`)
 const actual=await supabaseService.storage.from('ediel-files').download(mime.path);expect(actual.error).toBeNull();expect(hash(Buffer.from(await actual.data!.arrayBuffer()))).toBe(mime.hash)
 const classes=['ediel.retention.original_bytes','ediel.retention.mime_bytes'],actor=await user(f.companyId,['ediel.retention.submit','ediel.retention.purge',...classes],password),reviewer=await user(f.companyId,['ediel.retention.review',...classes],password),readonly=await user(f.companyId,['ediel.retention.read',...classes],password),foreignCompany=randomUUID()
 sql(`UPDATE public.companies SET status='archived' WHERE id=${literal(f.companyId)};INSERT INTO public.companies(id,name,status) VALUES(${literal(foreignCompany)},'Synthetic unrelated archived blob tenant','archived')`)
 const foreign=await user(foreignCompany,['ediel.retention.read',...classes],password),issuer=randomUUID(),key=Buffer.from('SYNTHETIC ONLY byte-class HMAC 01234567890123456789'),legal=Buffer.from('SYNTHETIC mechanism competence, NO authentic legal issuer or actual period')
 sql(`INSERT INTO gridex_ediel_retention.issuers(id,company_id,legal_reference,legal_evidence,legal_hash,signing_key,valid_from,valid_to) VALUES(${literal(issuer)},${literal(f.companyId)},'SYNTHETIC COMPETENCE ONLY',decode('${legal.toString('hex')}','hex'),${literal(hash(legal))},decode('${key.toString('hex')}','hex'),'2020-01-01','2099-01-01')`)
 const targets:Target[]=[]
 for(const [retentionClass,targetId] of [['transport_raw_mime_bytes',mime.id],['received_ediel_message_content',f.source]]){
  const basis=sql<Record<string,unknown>>(`SELECT gridex_ediel_retention.blob_basis_v1(${literal(f.companyId)},${literal(retentionClass)},${literal(targetId)})`)
  const policy=(document:Buffer)=>{const payload=Buffer.from(JSON.stringify({format:'ediel_blob_retention_policy_v1',retentionClass,companyId:f.companyId,targetId,messageId:basis.messageId,sourceHash:basis.sourceHash,targetHash:basis.targetHash,documentHash:hash(document),issuerLegalReference:'SYNTHETIC COMPETENCE ONLY',legalBasisReference:'SYNTHETIC exact byte-class source deadline',issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString()}));return{issuerId:issuer,payloadBase64:payload.toString('base64'),signatureHex:createHmac('sha256',key).update(payload).digest('hex')}}
  const document=Buffer.from('SYNTHETIC browser actual source '+retentionClass),revocationDocument=Buffer.from('SYNTHETIC revoked browser source '+retentionClass)
  targets.push({retentionClass,targetId,documentBase64:document.toString('base64'),documentHash:hash(document),issuerReceipt:policy(document),revocationDocumentBase64:revocationDocument.toString('base64'),revocationIssuerReceipt:policy(revocationDocument)})
 }
 for(const u of [actor,reviewer,readonly,foreign]){const listed=await u.client.rpc('ediel_current_retention_companies_v1',{});expect(listed.error).toBeNull();expect(listed.data.map((c:{companyId:string})=>c.companyId)).toEqual([u===foreign?foreignCompany:f.companyId])}
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_ediel_retention.blob_decisions WHERE company_id=${literal(f.companyId)}`)).toBe(0)
 writeFileSync(path,JSON.stringify({companyId:f.companyId,actorId:actor.id,actorEmail:actor.email,reviewerId:reviewer.id,reviewerEmail:reviewer.email,readonlyEmail:readonly.email,foreignCompanyId:foreignCompany,foreignEmail:foreign.email,mimePath:mime.path,sourceMessageId:f.source,targets} satisfies Fixture),{mode:0o600})
},180000)
