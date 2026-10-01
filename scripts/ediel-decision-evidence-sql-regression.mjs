// Actual new PostgreSQL bodies and published predecessor receipt/immutable
// bodies; explicitly synthetic authorization/schema/issuer boundary. This is
// bounded mechanism evidence, never Supabase native ACL or legal competence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createHash,createHmac} from 'node:crypto'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,q=v=>`'${String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")}'`,hash=b=>createHash('sha256').update(b).digest('hex')
const own=new URL('../supabase/migrations/',import.meta.url),source=(file,name)=>{
 const s=readFileSync(new URL(file,own),'utf8'),match=new RegExp('CREATE(?: OR REPLACE)? FUNCTION '+name.replaceAll('.','\\.')+'\\(').exec(s)
 if(!match)throw Error('missing source function '+name);const end=s.indexOf('$$;',match.index);if(end<0)throw Error('unbounded function '+name);return s.slice(match.index,end+3)
}
const processSource=process.env.GRIDEX_PROCESS_RETENTION_DDL?new URL('file://'+process.env.GRIDEX_PROCESS_RETENTION_DDL):new URL('20261001015945_ediel_process_journal_class_retention.sql',own)
const rows=[['artifact_retention_decision_original_bytes','decisions','receipt_v1','20261001000500_ediel_artifact_retention_decision_and_purge.sql','revocations'],['blob_retention_decision_original_bytes','blob_decisions','blob_receipt_v1','20261001000700_ediel_message_content_and_mime_retention.sql','blob_revocations'],['record_retention_decision_original_bytes','record_decisions','record_receipt_v1','20261001012305_ediel_customer_record_class_retention.sql','record_revocations'],['process_retention_decision_original_bytes','process_decisions','process_receipt_v1',processSource,'process_revocations']]
const permissions=['ediel.retention.source_bytes','ediel.retention.customer_fields','ediel.retention.original_bytes','ediel.retention.mime_bytes','ediel.retention.read','ediel.retention.submit','ediel.retention.review','ediel.retention.purge','ediel.retention.artifact_decision_evidence','ediel.retention.blob_decision_evidence','ediel.retention.record_decision_evidence','ediel.retention.process_decision_evidence','ediel.retention.decision_policy_evidence']
let checks=0
const check=(value,expected)=>{assert.deepEqual(value,expected);checks++},call=async(name,args)=>{const r=await db.query(`SELECT public.${name}(${args.map(q).join(',')}) AS result`);return r.rows[0].result},actor=async n=>db.exec(`SELECT set_config('synthetic.actor',${q(id(n))},false)`)
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE ROLE gridex_ediel_retention_owner NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,deleted_at timestamptz,banned_until timestamptz);CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_requested_changes;CREATE SCHEMA gridex_ediel_retention AUTHORIZATION gridex_ediel_retention_owner;
 CREATE TABLE public.companies(id uuid PRIMARY KEY,name text,status text);CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text,disabled_at timestamptz);CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 CREATE TABLE public.permissions(id uuid DEFAULT gen_random_uuid(),key text UNIQUE,name text,category text,description text,is_active boolean);
 CREATE TABLE public.roles(id uuid DEFAULT gen_random_uuid(),key text,is_active boolean);CREATE TABLE public.user_roles(id uuid DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,role_id uuid,is_active boolean,status text);CREATE TABLE public.role_permissions(id uuid DEFAULT gen_random_uuid(),role_id uuid,permission_id uuid,permission_key text,effect text);
 CREATE TABLE public.user_permissions(id uuid DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,permission_id uuid,permission_key text,is_active boolean,status text,effect text);CREATE TABLE public.user_permission_overrides(id uuid DEFAULT gen_random_uuid(),user_id uuid,company_id uuid,permission_key text,is_active boolean,effect text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE public.synthetic_grants(company uuid,actor uuid,permission text,allowed boolean,PRIMARY KEY(company,actor,permission));CREATE TABLE public.audit_logs(id uuid DEFAULT gen_random_uuid(),actor_user_id uuid,company_id uuid,entity_type text,entity_id uuid,action text,metadata jsonb);
 CREATE FUNCTION public.ediel_retention_session_actor_v1() RETURNS uuid LANGUAGE sql AS $$SELECT current_setting('synthetic.actor',true)::uuid$$;
 CREATE FUNCTION public.ediel_retention_lock_auth_actor_v1(a uuid) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT EXISTS(SELECT FROM auth.users WHERE id=a AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))$$;
 CREATE FUNCTION gridex_requested_changes.scoped_permission_v1(c uuid,a uuid,k text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT EXISTS(SELECT FROM public.synthetic_grants WHERE company=c AND actor=a AND permission=k AND allowed)$$;
 CREATE FUNCTION public.gridex_actor_has_company_permission(a uuid,c uuid,k text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$SELECT gridex_requested_changes.scoped_permission_v1(c,a,k)$$;


 CREATE TABLE gridex_ediel_retention.record_class_catalog(retention_class text,permission_key text,operation text);
 CREATE TABLE gridex_ediel_retention.process_class_catalog(retention_class text,operation text);

 CREATE TABLE gridex_ediel_retention.issuers(id uuid PRIMARY KEY,company_id uuid,legal_reference text,legal_evidence bytea,legal_hash text,signing_key bytea,valid_from timestamptz,valid_to timestamptz);CREATE TABLE gridex_ediel_retention.issuer_revocations(issuer_id uuid,reference text);
 GRANT USAGE ON SCHEMA gridex_requested_changes,gridex_received_sources TO gridex_ediel_retention_owner;GRANT SELECT,UPDATE ON public.user_profiles,public.company_memberships TO gridex_ediel_retention_owner;GRANT INSERT ON public.audit_logs TO gridex_ediel_retention_owner;`)
 // Use the actual published archived-class resolver, adapted exactly at the
 // separately declared synthetic auth bridge. No generic class-allow DTO.
 const permissionSource=source('20261001000710_ediel_archived_tenant_retention_class_authority.sql','gridex_ediel_retention.permission_v1')
  .replace('EXISTS(SELECT FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))','public.ediel_retention_lock_auth_actor_v1(actor)')
  .replace("user_status='active'","user_status='active' AND disabled_at IS NULL")
 await db.exec(permissionSource)
 const actorSource=source('20261001000500_ediel_artifact_retention_decision_and_purge.sql','gridex_ediel_retention.actor_v1')
  .replaceAll('auth.uid()','public.ediel_retention_session_actor_v1()')
  .replace('PERFORM id FROM auth.users WHERE id=actor FOR SHARE;','PERFORM public.ediel_retention_lock_auth_actor_v1(actor);')
  .replace('EXISTS(SELECT FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))','public.ediel_retention_lock_auth_actor_v1(actor)')
  .replace("user_status='active'","user_status='active' AND disabled_at IS NULL")
 await db.exec(actorSource)
 const recordPermissionSource=source('20261001012305_ediel_customer_record_class_retention.sql','gridex_ediel_retention.record_permission_v1')
  .replace(' SELECT permission_key INTO wanted FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;'," IF k='__read_scope__' THEN wanted:='ediel.retention.read';ELSE SELECT permission_key INTO wanted FROM gridex_ediel_retention.record_class_catalog WHERE retention_class=k;END IF;")
  .replace('EXISTS(SELECT FROM auth.users WHERE id=actor AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now()))','public.ediel_retention_lock_auth_actor_v1(actor)')
  .replace("user_status='active'","user_status='active' AND disabled_at IS NULL")
 await db.exec(recordPermissionSource)

 const readActorSource=source('20261001015940_ediel_retention_workspace_scope.sql','gridex_ediel_retention.record_read_actor_v1')
  .replaceAll('auth.uid()','public.ediel_retention_session_actor_v1()')
  .replace('PERFORM id FROM auth.users WHERE id=actor FOR SHARE;','PERFORM public.ediel_retention_lock_auth_actor_v1(actor);')
 await db.exec(readActorSource)


 await db.exec(source('20260922095911_ediel_received_source_ledger.sql','gridex_received_sources.reject_mutation'))
 await db.exec(source('20260930232100_ediel_requested_change_source_intake_and_review.sql','gridex_requested_changes.receipt_hmac_sha256_v1'))
 for(const [,table,receipt,file,revocations] of rows){
  await db.exec(`CREATE TABLE gridex_ediel_retention.${table}(id uuid PRIMARY KEY,company_id uuid,artifact_id uuid,retention_class text,target_id uuid,message_id uuid,customer_id uuid,contract_id uuid,source_hash text,target_hash text,scope_hash text,claims_hash text,document_bytes bytea NOT NULL,document_hash text,issuer_receipt jsonb,submitted_by uuid,created_at timestamptz DEFAULT clock_timestamp());ALTER TABLE gridex_ediel_retention.${table} OWNER TO gridex_ediel_retention_owner;
  CREATE TABLE gridex_ediel_retention.${revocations}(decision_id uuid PRIMARY KEY,actor_user_id uuid,reason text);ALTER TABLE gridex_ediel_retention.${revocations} OWNER TO gridex_ediel_retention_owner;CREATE TRIGGER ${table==='process_decisions'?'immutable':table+'_immutable'} BEFORE UPDATE OR DELETE ON gridex_ediel_retention.${table} FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();`)
  await db.exec(source(file,'gridex_ediel_retention.'+receipt))
 }
 const sessionSource=source('20261001012305_ediel_customer_record_class_retention.sql','public.ediel_current_retention_session_v1').replaceAll('auth.uid()','public.ediel_retention_session_actor_v1()').replaceAll("'ediel.retention.submit','ediel.retention.review','ediel.retention.purge'","'ediel.retention.read','ediel.retention.submit','ediel.retention.review','ediel.retention.purge'")
 await db.exec(sessionSource);await db.exec(`CREATE FUNCTION public.ediel_current_retention_companies_v1() RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE actor uuid:=public.ediel_retention_session_actor_v1();company record;session jsonb;BEGIN FOR company IN SELECT id FROM public.companies LOOP session:=public.ediel_current_retention_session_v1(company.id,actor);END LOOP;RETURN '[]';END$$;`)
 // The actual session body locks the complete named registry. These synthetic
 // tables contain no bypass approval, and are never claimed as native RBAC.
 await db.exec('GRANT SELECT,UPDATE ON public.companies TO gridex_ediel_retention_owner;')
 for(const name of ['record_class_catalog','process_class_catalog','issuers','issuer_revocations'])await db.exec(`ALTER TABLE gridex_ediel_retention.${name} OWNER TO gridex_ediel_retention_owner`)
 await db.exec(`INSERT INTO public.companies VALUES(${q(id(1))},'Synthetic archived own company','archived'),(${q(id(99))},'Synthetic foreign company','active');INSERT INTO auth.users(id) VALUES(${q(id(2))}),(${q(id(3))});INSERT INTO public.user_profiles(id,user_status) VALUES(${q(id(2))},'active'),(${q(id(3))},'active');INSERT INTO public.company_memberships SELECT ${q(id(1))},id,'active',true,now() FROM auth.users;`)
 for(const permission of permissions)await db.exec(`INSERT INTO public.permissions(key,is_active) VALUES(${q(permission)},true) ON CONFLICT(key) DO NOTHING`)
 for(const a of [2,3])for(const permission of permissions)await db.exec(`INSERT INTO public.synthetic_grants VALUES(${q(id(1))},${q(id(a))},${q(permission)},true);INSERT INTO public.user_permissions(user_id,company_id,permission_key,is_active,status,effect) VALUES(${q(id(a))},${q(id(1))},${q(permission)},true,'active','allow')`)
 await actor(2)
 await assert.rejects(()=>call('ediel_submit_decision_evidence_retention_v1',[id(1),id(2),rows[0][0],id(10),'U1lOVEhFVElD',null]),/does not exist/);checks++
 await db.exec(readFileSync(new URL('20261001064500_ediel_retention_decision_original_class_workflows.sql',own),'utf8'))
 check((await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.decision_evidence_catalog')).rows[0].n,5)
 const permissionProbe=async(company=id(1),a=id(2))=>(await db.query(`SELECT gridex_ediel_retention.permission_v1(${q(company)},${q(a)},'ediel.retention.blob_decision_evidence') qualified`)).rows[0].qualified
 check(await permissionProbe(),true);check(await permissionProbe(id(99)),false)
 await db.exec(`UPDATE public.user_permissions SET company_id=NULL WHERE user_id=${q(id(2))} AND permission_key='ediel.retention.blob_decision_evidence'`);check(await permissionProbe(),false)
 await db.exec(`UPDATE public.user_permissions SET company_id=${q(id(1))} WHERE user_id=${q(id(2))} AND permission_key='ediel.retention.blob_decision_evidence';INSERT INTO public.user_permission_overrides(user_id,company_id,permission_key,is_active,effect) VALUES(${q(id(2))},NULL,'ediel.retention.blob_decision_evidence',true,'deny')`);check(await permissionProbe(),false)
 await db.exec(`DELETE FROM public.user_permission_overrides;UPDATE public.user_profiles SET disabled_at=now() WHERE id=${q(id(2))}`);check(await permissionProbe(),false)
 await db.exec(`UPDATE public.user_profiles SET disabled_at=NULL WHERE id=${q(id(2))};UPDATE public.company_memberships SET accepted_at=NULL WHERE user_id=${q(id(2))}`);check(await permissionProbe(),false)
 await db.exec(`UPDATE public.company_memberships SET accepted_at=now() WHERE user_id=${q(id(2))}`);check(await permissionProbe(),true)
 check((await db.query(`SELECT has_table_privilege('authenticated','gridex_ediel_retention.decision_evidence_policies','SELECT') allowed`)).rows[0].allowed,false)
 check((await db.query(`SELECT has_function_privilege('service_role','public.ediel_purge_decision_evidence_retention_v1(uuid,uuid,uuid)','EXECUTE') allowed`)).rows[0].allowed,false)

 const key=Buffer.from('SYNTHETIC ONLY exact policy HMAC key 01234567890123456789'),legal=Buffer.from('SYNTHETIC issuer competence boundary, not actual legal authority')
 await db.exec(`INSERT INTO gridex_ediel_retention.issuers VALUES(${q(id(9))},${q(id(1))},'SYNTHETIC COMPETENCE',decode('${legal.toString('hex')}','hex'),${q(hash(legal))},decode('${key.toString('hex')}','hex'),'2020-01-01','2099-01-01')`)
 const signed=(basis,document,delta={})=>{const bytes=Buffer.from(JSON.stringify({format:'ediel_retention_decision_original_policy_v1',operation:'erase_retention_decision_original_bytes',companyId:id(1),retentionClass:basis.retentionClass,targetId:basis.targetId,sourceHash:basis.sourceHash,targetMetadataHash:basis.targetMetadataHash,documentHash:hash(document),issuerLegalReference:'SYNTHETIC COMPETENCE',legalBasisReference:'SYNTHETIC exact original-byte policy',journalPurposeReference:'SYNTHETIC minimal hash witness',issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString(),retainUntil:new Date(Date.now()-1000).toISOString(),journalRetainUntil:new Date(Date.now()+86400000).toISOString(),...delta}));return{issuerId:id(9),payloadBase64:bytes.toString('base64'),signatureHex:createHmac('sha256',key).update(bytes).digest('hex')}}
 const firstPolicies=[]
 for(const [index,[kind,table,receipt]] of rows.entries()){
  const target=id(10+index),bytes=Buffer.from('SYNTHETIC archived '+table+' original'),document=Buffer.from('SYNTHETIC separate '+kind+' signed original policy')
  await db.exec(`INSERT INTO gridex_ediel_retention.${table}(id,company_id,document_bytes,document_hash,submitted_by) VALUES(${q(target)},${q(id(1))},decode('${bytes.toString('hex')}','hex'),${q(hash(bytes))},${q(id(2))})`)
  await assert.rejects(()=>db.exec(`UPDATE gridex_ediel_retention.${table} SET document_bytes=NULL WHERE id=${q(target)}`),e=>e.code==='23514'&&e.message==='received_source_evidence_is_append_only');checks++
  const basis=(await db.query(`SELECT gridex_ediel_retention.decision_evidence_basis_v1(${q(id(1))},${q(kind)},${q(target)}) b`)).rows[0].b
  const pending=await call('ediel_submit_decision_evidence_retention_v1',[id(1),id(2),kind,target,document.toString('base64'),signed(basis,document)]);check(pending.issuerQualified,true);firstPolicies.push(pending.policyId)
  check((await call('ediel_read_decision_evidence_policy_v1',[id(1),id(2),pending.policyId,false])).currentQualified,false)
  await assert.rejects(()=>call('ediel_review_decision_evidence_retention_v1',[id(1),id(2),pending.policyId,'approve','SYNTHETIC self']),/separate_reviewer/);checks++
  await actor(3);check((await call('ediel_review_decision_evidence_retention_v1',[id(1),id(3),pending.policyId,'approve','SYNTHETIC independent reviewer'])).status,'approved')
  await db.exec(`UPDATE public.user_permissions SET effect='deny' WHERE user_id=${q(id(3))} AND permission_key='ediel.retention.review'`);await actor(2)
  await assert.rejects(()=>call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),pending.policyId]),/current_reviewer/);checks++
  check((await db.query(`SELECT document_bytes IS NOT NULL b FROM gridex_ediel_retention.${table} WHERE id=${q(target)}`)).rows[0].b,true)
  await db.exec(`UPDATE public.user_permissions SET effect='allow' WHERE user_id=${q(id(3))} AND permission_key='ediel.retention.review'`)
  const completed=await call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),pending.policyId]);check(completed,{status:'purged',retentionClass:kind,targetId:target,sourceHash:hash(bytes),byteLength:bytes.length,bytesAvailable:false,authority:'none',replay:false})
  check((await call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),pending.policyId])).replay,true)
  check((await db.query(`SELECT gridex_ediel_retention.${receipt}(d) q FROM gridex_ediel_retention.${table} d WHERE id=${q(target)}`)).rows[0].q,null)
  const original=await call('ediel_read_retention_decision_original_v1',[id(1),id(2),kind,target,false]);check([original.bytesAvailable,original.documentBase64,original.documentHash,original.documentByteLength],[false,null,hash(bytes),bytes.length])
  await assert.rejects(()=>db.exec(`DELETE FROM gridex_ediel_retention.${table} WHERE id=${q(target)}`),e=>e.code==='23514'&&e.message==='received_source_evidence_is_append_only');checks++
  await assert.rejects(()=>db.exec(`UPDATE gridex_ediel_retention.${table} SET document_bytes=decode('${bytes.toString('hex')}','hex') WHERE id=${q(target)}`),e=>e.code==='23514'&&e.message==='received_source_evidence_is_append_only');checks++
  await assert.rejects(()=>call('ediel_read_retention_decision_original_v1',[id(99),id(2),kind,target,false]),/current_actor_forbidden|current_read_actor_required|class_grant/);checks++
 }
 const kind='decision_evidence_policy_original_bytes',target=firstPolicies[0],document=Buffer.from('SYNTHETIC subsequent own policy-original deadline'),basis=(await db.query(`SELECT gridex_ediel_retention.decision_evidence_basis_v1(${q(id(1))},${q(kind)},${q(target)}) b`)).rows[0].b
 const finalPolicy=await call('ediel_submit_decision_evidence_retention_v1',[id(1),id(2),kind,target,document.toString('base64'),signed(basis,document)]);await actor(3);check((await call('ediel_review_decision_evidence_retention_v1',[id(1),id(3),finalPolicy.policyId,'approve','SYNTHETIC separate subsequent policy review'])).status,'approved');await actor(2)
 check((await call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),finalPolicy.policyId])).bytesAvailable,false)
 check((await call('ediel_read_decision_evidence_policy_v1',[id(1),id(2),target,false])).currentQualified,false)
 check((await call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),target])).replay,true)
 check((await db.query(`SELECT count(*)::int n FROM public.audit_logs WHERE action='ediel.retention.decision_original_bytes_removed'`)).rows[0].n,5)

 // Finance original custody is installed only after its actual published
 // predecessor exists. These are explicitly unapproved synthetic originals.
 const financeSource=process.env.GRIDEX_FINANCE_RETENTION_DDL?new URL('file://'+process.env.GRIDEX_FINANCE_RETENTION_DDL):new URL('20261001070000_ediel_finance_copy_class_retention.sql',own)
 const financeDdl=readFileSync(financeSource,'utf8'),tableStart=financeDdl.indexOf('CREATE TABLE gridex_ediel_retention.finance_decisions('),tableEnd=financeDdl.indexOf(';',tableStart)
 await db.exec(`CREATE TABLE gridex_ediel_retention.finance_class_catalog(retention_class text PRIMARY KEY,operation text,source_schema text,source_table text);${financeDdl.slice(tableStart,tableEnd+1)}CREATE TABLE gridex_ediel_retention.finance_revocations(decision_id uuid PRIMARY KEY REFERENCES gridex_ediel_retention.finance_decisions(id),actor_user_id uuid,reason text);ALTER TABLE gridex_ediel_retention.finance_decisions OWNER TO gridex_ediel_retention_owner;ALTER TABLE gridex_ediel_retention.finance_revocations OWNER TO gridex_ediel_retention_owner;CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON gridex_ediel_retention.finance_decisions FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.reject_mutation();`)
 await db.exec(source(financeSource,'gridex_ediel_retention.finance_receipt_v1'))
 await db.exec(readFileSync(new URL('20261001070700_ediel_finance_retention_decision_original_class.sql',own),'utf8'))
 check((await db.query('SELECT count(*)::int n FROM gridex_ediel_retention.decision_evidence_catalog')).rows[0].n,6)
 for(const a of [2,3])await db.exec(`INSERT INTO public.user_permissions(user_id,company_id,permission_key,is_active,status,effect) VALUES(${q(id(a))},${q(id(1))},'ediel.retention.finance_decision_evidence',true,'active','allow')`)
 const financeTarget=id(14),financeBytes=Buffer.from('SYNTHETIC actual finance archived decision original'),financeDocument=Buffer.from('SYNTHETIC separate finance original policy')
 await db.exec(`INSERT INTO gridex_ediel_retention.finance_class_catalog VALUES('synthetic_unapproved_original','synthetic','public','synthetic');INSERT INTO gridex_ediel_retention.finance_decisions(id,company_id,retention_class,target_id,source_hash,target_hash,scope_hash,document_bytes,document_hash,submitted_by) VALUES(${q(financeTarget)},${q(id(1))},'synthetic_unapproved_original','synthetic-source',${q('a'.repeat(64))},${q('b'.repeat(64))},${q('c'.repeat(64))},decode('${financeBytes.toString('hex')}','hex'),${q(hash(financeBytes))},${q(id(2))})`)
 const financeBasis=(await db.query(`SELECT gridex_ediel_retention.decision_evidence_basis_v1(${q(id(1))},'finance_retention_decision_original_bytes',${q(financeTarget)}) b`)).rows[0].b,financePolicy=await call('ediel_submit_decision_evidence_retention_v1',[id(1),id(2),'finance_retention_decision_original_bytes',financeTarget,financeDocument.toString('base64'),signed(financeBasis,financeDocument)])
 await actor(3);check((await call('ediel_review_decision_evidence_retention_v1',[id(1),id(3),financePolicy.policyId,'approve','SYNTHETIC separate finance original review'])).status,'approved');await actor(2)
 check((await call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),financePolicy.policyId])).bytesAvailable,false)
 check((await db.query(`SELECT gridex_ediel_retention.finance_receipt_v1(d) q FROM gridex_ediel_retention.finance_decisions d WHERE id=${q(financeTarget)}`)).rows[0].q,null)
 check((await call('ediel_read_retention_decision_original_v1',[id(1),id(2),'finance_retention_decision_original_bytes',financeTarget,false])).documentHash,hash(financeBytes))
 check((await call('ediel_purge_decision_evidence_retention_v1',[id(1),id(2),financePolicy.policyId])).replay,true)
 console.log(JSON.stringify({status:'PASS',checks,scope:'six actual original-byte namespaces, exact SHA/HMAC/deadline/separate current review, revocation before erase, immutable metadata, old receipt NULL, replay, own policy closure',authority:'Explicitly synthetic boundary schema/auth/issuer and seeded unapproved original decisions; NOT native Supabase, browser, real legal authority or whole DB05'}))
}finally{await db.close()}
