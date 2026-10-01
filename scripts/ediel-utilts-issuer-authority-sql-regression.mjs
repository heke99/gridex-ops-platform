// Focused PostgreSQL capture/namespace/ground/fresh-effect/ACL mechanics.
// All registry, mandate, history and decision bytes below are DECLARED
// SYNTHETIC fixtures. They prove no real issuer, legal authority or history.
// Existing canonical owner and retained replay boundaries are modeled ports;
// full native replay, actor proof and multi-session concurrency remain pending.
import fs from 'node:fs'
import assert from 'node:assert/strict'
import {pathToFileURL,fileURLToPath} from 'node:url'
if(!process.env.EDIEL_PGLITE_MODULE)throw new Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const root=fileURLToPath(new URL('..',import.meta.url)),db=new PGlite(),uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const company=uid(1),namespace=uid(2),issuer=uid(3),mandate=uid(4),actor=uid(5)
let checks=0
const sql=file=>fs.readFileSync(root+'/supabase/migrations/'+file,'utf8')
function wire(document,transactions,legal='12345',sender='AGENT',code='E66'){
 const segments=['UNH+M+UTILTS:D:02B:UN:E5SE5A',`BGM+${code}::260+${document}+9+AB`,`NAD+MS+${legal}:160:SVK`,'NAD+MR+54321:160:SVK',...transactions.map(id=>'IDE+24+'+id)]
 return "UNA:+.? 'UNB+UNOC:3+"+sender+"+RECEIVER+261001:0000+I++23-MDDQ-UTILTS++++1'"+segments.join("'")+"'UNT+"+(segments.length+1)+"+M'UNZ+1+I'"
}
async function insert(n,document,transactions,legal='12345',sender='AGENT',tenant=company,code='E66'){
 const id=uid(n),raw=wire(document,transactions,legal,sender,code)
 await db.query("INSERT INTO public.ediel_messages VALUES($1,$2,'test','inbound','edifact','UTILTS',$3)",[id,tenant,raw])
 return id
}
async function read(source,tenant=company){return (await db.query('SELECT gridex_utilts_issuer.read_v1($1,$2) facts',[tenant,source])).rows[0].facts}
async function requireOwn(source,transaction,disposition='accepted',issues=[]){return db.query("SELECT gridex_received_sources.require_utilts_transaction_v1($1,$2,$3,$4,'positive_aperak',$5::jsonb)",[company,source,transaction,disposition,JSON.stringify(issues)])}
async function ground(source,overrides={}){
 const admission=(await db.query('SELECT * FROM gridex_utilts_issuer.source_admissions WHERE source_message_id=$1',[source])).rows[0]
 const columns=['source_message_id','source_payload_hash','namespace_id','issuer_version_id','mandate_version_id','namespace_epoch','scope','identifiers_scope','registry_version','registry_original_uri','registry_original_bytes','registry_sha256','deletion_history_version','deletion_history_original_uri','deletion_history_bytes','deletion_history_sha256','retention_decision_ref','retention_decision_version','retention_decision_bytes','retention_decision_sha256','normalized_issued_identifiers','approval_ref','approval_version','approval_bytes','approval_sha256','approved_at','approved_by']
 const data={...admission,scope:'over_time_all_issuer_applications',identifiers_scope:'other_prior_issued_originals',registry_version:'synthetic-history-v1',registry_original_uri:'fixture:history',registry_original_bytes:'SYNTHETIC REGISTRY',deletion_history_version:'synthetic-deletion-v1',deletion_history_original_uri:'fixture:deletion',deletion_history_bytes:'SYNTHETIC DELETION HISTORY',retention_decision_ref:'fixture-retention',retention_decision_version:'synthetic-retention-v1',retention_decision_bytes:'SYNTHETIC RETENTION DECISION',normalized_issued_identifiers:[],approval_ref:'fixture-approval',approval_version:'synthetic-approval-v1',approval_bytes:'SYNTHETIC APPROVAL',approved_at:'2020-01-01T00:00:00Z',approved_by:actor,...overrides}
 const hashFields={registry_sha256:'registry_original_bytes',deletion_history_sha256:'deletion_history_bytes',retention_decision_sha256:'retention_decision_bytes',approval_sha256:'approval_bytes'}
 const values=[],parameterIndexes=new Map(),parameters=columns.map(name=>{
  if(hashFields[name])return `encode(sha256(convert_to($${parameterIndexes.get(hashFields[name])},'UTF8')),'hex')`
  values.push(name==='normalized_issued_identifiers'?JSON.stringify(data[name]):data[name]);parameterIndexes.set(name,values.length)
  return ['registry_original_bytes','deletion_history_bytes','retention_decision_bytes','approval_bytes'].includes(name)?`convert_to($${values.length},'UTF8')`:`$${values.length}`
 })
 return db.query(`INSERT INTO gridex_utilts_issuer.source_absence_grounds(${columns.join(',')}) SELECT ${parameters.join(',')}`,values)
}
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ack_authority;CREATE SCHEMA gridex_received_sources;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,raw_payload text);
 CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,origin text,received_context jsonb,raw_payload text,payload_hash text,captured_at timestamptz);
 CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY,company_id uuid,source_message_id uuid,facts_text text);
 CREATE TABLE public.fixture_owner_calls(source uuid,transaction_id text);
 CREATE TABLE public.fixture_header_result(value jsonb);
 CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'immutable_source_facet';END$$;
 CREATE FUNCTION gridex_received_sources.require_utilts_transaction_v1(uuid,uuid,text,text,text,jsonb) RETURNS void LANGUAGE sql AS $$INSERT INTO public.fixture_owner_calls VALUES($2,$3)$$;
 CREATE FUNCTION gridex_received_sources.require_utilts_header_v1(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$SELECT value FROM public.fixture_header_result$$;
 CREATE FUNCTION gridex_received_sources.capture_fixture() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN
 INSERT INTO gridex_received_sources.sources VALUES(NEW.id,NEW.company_id,NEW.environment,'database_insert','{"contextOrigin":"database_insert"}',NEW.raw_payload,encode(sha256(convert_to(NEW.raw_payload,'UTF8')),'hex'),clock_timestamp());RETURN NEW;END$$;
 CREATE TRIGGER gridex_capture_received_utilts_source AFTER INSERT ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION gridex_received_sources.capture_fixture();`)
 const binding=sql('20260923135706_ediel_utilts_consumption_binding_v1.sql')
 await db.exec(binding.slice(binding.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),binding.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 const ack=sql('20260930170932_ediel_inbound_ack_source_atomic_authority.sql')
 await db.exec(ack.slice(ack.indexOf('CREATE FUNCTION gridex_ack_authority.wire_v1'),ack.indexOf('CREATE FUNCTION gridex_ack_authority.source_match_v1')))
 await db.exec(sql('20261001015127_ediel_utilts_foreign_issuer_observed_identity_authority.sql'));checks++
 const unknown=await insert(10,'UNKNOWN',['TX-UNKNOWN'])
 assert.equal((await read(unknown)).holdReason,'ediel_utilts_foreign_issuer_basis_unavailable');checks++
 await assert.rejects(requireOwn(unknown,'TX-UNKNOWN'),/first_effect_held/);checks++
 await db.query("INSERT INTO gridex_utilts_issuer.namespaces VALUES($1,'test','DECLARED SYNTHETIC FOREIGN LEGAL ACTOR',clock_timestamp())",[namespace])
 await db.query(`INSERT INTO gridex_utilts_issuer.issuer_versions VALUES($1,$2,'["12345","160","SVK"]','synthetic-registry-v1','fixture:registry',convert_to('SYNTHETIC REGISTRY','UTF8'),encode(sha256(convert_to('SYNTHETIC REGISTRY','UTF8')),'hex'),'fixture-legal-decision','synthetic-legal-v1',convert_to('SYNTHETIC LEGAL DECISION','UTF8'),encode(sha256(convert_to('SYNTHETIC LEGAL DECISION','UTF8')),'hex'),'2020-01-01',NULL,'2020-01-01',$3)`,[issuer,namespace,actor])
 await db.query(`INSERT INTO gridex_utilts_issuer.transport_mandate_versions VALUES($1,$2,'["AGENT"]','fixture-mandate','synthetic-mandate-v1','fixture:mandate',convert_to('SYNTHETIC MANDATE','UTF8'),encode(sha256(convert_to('SYNTHETIC MANDATE','UTF8')),'hex'),'2020-01-01',NULL,'2020-01-01',$3)`,[mandate,issuer,actor]);checks+=2
 assert.equal((await read(unknown)).authorityVersionId,null);checks++ // No historical retrofit.
 const first=await insert(11,'DUP-DOC',['OWN?+A?:B??C'])
 const original=await read(first)
 assert.equal(original.status,'held');assert.equal(original.authorityVersionId,issuer);assert.equal(original.namespaceEpoch,'1');assert.equal(original.messageReferenceCollision,false);assert.deepEqual(original.transactionReferenceCollisions,[]);checks++
 await assert.rejects(requireOwn(first,'OWN+A:B?C'),/first_effect_held/);checks++
 const second=await insert(12,'DUP-DOC',['OTHER','OWN?+A?:B??C'],'12345','AGENT',uid(99),'E31')
 const collision=await read(second,uid(99))
 assert.equal(collision.messageReferenceCollision,true);assert.deepEqual(collision.transactionReferenceCollisions,[{transactionIndex:1,transactionId:'OWN+A:B?C'}]);checks++
 // The actual committed header validator is a modeled port here; this
 // forward must additionally demand native authenticated duplicate203 proof.
 const headerAssessment=uid(50)
 await db.query("INSERT INTO gridex_received_sources.validation_assessments VALUES($1,$2,$3,$4)",[headerAssessment,uid(99),second,JSON.stringify({reasonCodes:['UTILTS_ISSUER_MESSAGE_REFERENCE_DUPLICATE']})])
 await db.query('INSERT INTO public.fixture_header_result VALUES($1)',[JSON.stringify({assessmentId:headerAssessment})])
 await db.query('SELECT gridex_received_sources.require_utilts_header_v1($1,$2)',[uid(99),second]);checks++
 await db.query('UPDATE gridex_received_sources.validation_assessments SET company_id=$1,source_message_id=$2 WHERE id=$3',[company,first,headerAssessment])
 await assert.rejects(()=>db.query('SELECT gridex_received_sources.require_utilts_header_v1($1,$2)',[company,first]),/duplicate_source_proof_required/);checks++
 const wrongLegal=await insert(13,'DUP-DOC',['OWN?+A?:B??C'],'54321'),wrongAgent=await insert(14,'DUP-DOC',['OWN?+A?:B??C'],'12345','OTHERAGENT')
 for(const id of [wrongLegal,wrongAgent]){assert.equal((await read(id)).authorityVersionId,null);assert.equal((await read(id)).messageReferenceCollision,false);checks++}
 const leading=await insert(16,'LEADING-DOC',[' OWN?+A?:B??C'])
 assert.deepEqual((await read(leading)).transactionReferenceCollisions,[]);checks++
 const leadingRepeat=await insert(17,'OTHER-LEADING-DOC',[' OWN?+A?:B??C'])
 assert.deepEqual((await read(leadingRepeat)).transactionReferenceCollisions,[{transactionIndex:0,transactionId:' OWN+A:B?C'}]);checks++
 const mismatched=await insert(15,'FRESH',['FRESH'])
 await assert.rejects(ground(mismatched,{source_payload_hash:'0'.repeat(64)}),/absence_scope_invalid/);checks++
 for(const item of [{reference:'FRESH',originalIssuanceReference:'DECLARED-OTHER-PRIOR-ISSUANCE',originalSourceSha256:'a'.repeat(64),originEvidenceSha256:'b'.repeat(64)},{field:'505',reference:'FRESH',originalIssuanceReference:'DECLARED-OTHER-PRIOR-ISSUANCE',originalSourceSha256:'a'.repeat(64)},{field:'505',reference:'FRESH',originalIssuanceReference:'DECLARED-OTHER-PRIOR-ISSUANCE',originEvidenceSha256:'b'.repeat(64)},{field:null,reference:'FRESH',originalIssuanceReference:'DECLARED-OTHER-PRIOR-ISSUANCE',originalSourceSha256:'a'.repeat(64),originEvidenceSha256:'b'.repeat(64)}]){await assert.rejects(ground(mismatched,{normalized_issued_identifiers:[item]}),/history_projection_invalid/);checks++}
 await assert.rejects(ground(mismatched,{identifiers_scope:'local_rows'}),/check constraint/);checks++
 await assert.rejects(ground(mismatched,{namespace_epoch:999}),/absence_scope_invalid/);checks++
 await ground(first);assert.equal((await read(first)).status,'qualified');await requireOwn(first,'OWN+A:B?C');checks+=2
 await ground(mismatched,{normalized_issued_identifiers:[{field:'505',reference:'FRESH',originalIssuanceReference:'DECLARED-OTHER-PRIOR-ISSUANCE',originalSourceSha256:(await read(mismatched)).sourcePayloadHash,originEvidenceSha256:'b'.repeat(64)}]})
 assert.deepEqual((await read(mismatched)).transactionReferenceCollisions,[{transactionIndex:0,transactionId:'FRESH'}]);checks++
 await assert.rejects(requireOwn(mismatched,'FRESH'),/first_effect_held/);checks++
 await requireOwn(mismatched,'FRESH','guide_rejected',['UTILTS_ISSUER_TRANSACTION_REFERENCE_DUPLICATE']);checks++
 await assert.rejects(requireOwn(first,'OWN+A:B?C','guide_rejected',['UTILTS_ISSUER_TRANSACTION_REFERENCE_DUPLICATE']),/duplicate_source_proof_required/);checks++
 await assert.rejects(()=>read(first,uid(98)),/source_scope_required/);checks++
 await db.exec('SET ROLE service_role');try{
  assert.equal((await db.query('SELECT public.gridex_read_utilts_issuer_identity_authority_v1($1,$2) facts',[company,first])).rows[0].facts.status,'qualified');checks++
  await assert.rejects(()=>db.exec('SELECT * FROM gridex_utilts_issuer.issuer_versions'),/permission denied/);checks++
  await assert.rejects(()=>db.query('SELECT gridex_utilts_issuer.read_v1($1,$2)',[company,first]),/permission denied/);checks++
 }finally{await db.exec('RESET ROLE')}
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);try{await assert.rejects(()=>db.query('SELECT public.gridex_read_utilts_issuer_identity_authority_v1($1,$2)',[company,first]),/permission denied/);checks++}finally{await db.exec('RESET ROLE')}}
 for(const statement of ['UPDATE gridex_utilts_issuer.observed_identifiers SET physical_reference=physical_reference','DELETE FROM gridex_utilts_issuer.source_admissions','TRUNCATE gridex_utilts_issuer.source_absence_grounds']){await assert.rejects(()=>db.exec(statement),/immutable_source_facet/);checks++}
 const otherNamespace=uid(60),otherIssuer=uid(61)
 await db.query("INSERT INTO gridex_utilts_issuer.namespaces VALUES($1,'test','DECLARED COMPETING REGISTRY ACTOR',clock_timestamp())",[otherNamespace])
 await db.query('INSERT INTO gridex_utilts_issuer.issuer_versions SELECT $1,$2,legal_identity,registry_version,registry_original_uri,registry_original_bytes,registry_sha256,legal_decision_ref,legal_decision_version,legal_decision_bytes,legal_decision_sha256,valid_from,valid_until,approved_at,approved_by FROM gridex_utilts_issuer.issuer_versions WHERE id=$3',[otherIssuer,otherNamespace,issuer])
 await db.query('INSERT INTO gridex_utilts_issuer.transport_mandate_versions SELECT $1,$2,transport_sender,mandate_ref,mandate_version,mandate_original_uri,mandate_original_bytes,mandate_sha256,valid_from,valid_until,approved_at,approved_by FROM gridex_utilts_issuer.transport_mandate_versions WHERE id=$3',[uid(62),otherIssuer,mandate])
 const ambiguous=await insert(63,'DUP-DOC',['OWN?+A?:B??C'])
 assert.equal((await read(ambiguous)).holdReason,'ediel_utilts_foreign_issuer_binding_ambiguous');assert.equal((await read(ambiguous)).messageReferenceCollision,false);checks++
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_utilts_issuer.observed_identifiers WHERE source_message_id=$1',[ambiguous])).rows[0].n,0);checks++
 // A current revocation cannot erase the original receipt. Fresh effects are
 // held while old retained public replay remains outside this fresh wrapper.
 await db.query(`INSERT INTO gridex_utilts_issuer.revocations VALUES($1,$2,$3,NULL,'2020-01-01','fixture-revoke','synthetic-revoke-v1',convert_to('SYNTHETIC REVOCATION','UTF8'),encode(sha256(convert_to('SYNTHETIC REVOCATION','UTF8')),'hex'),'2020-01-01',$4)`,[uid(40),namespace,issuer,actor])
 assert.equal((await read(first)).holdReason,'ediel_utilts_foreign_issuer_basis_revoked');checks++
 assert.equal((await read(second,uid(99))).messageReferenceCollision,true);checks++
 await assert.rejects(requireOwn(first,'OWN+A:B?C'),/first_effect_held/);checks++
 assert.equal((await db.query('SELECT message_reference,namespace_epoch FROM gridex_utilts_issuer.source_admissions WHERE source_message_id=$1',[first])).rows[0].message_reference,'DUP-DOC');checks++
 console.log(`PASS ${checks} focused PostgreSQL prospective issuer capture/exact namespace/ground/NULL/fresh-effect/immutability/ACL checks; full native and multi-session checks pending`)
}catch(error){console.error(error.message);if(error.where)console.error(error.where);process.exitCode=1}finally{await db.close()}
