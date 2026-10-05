// masterplan: TR-05, AT-TR-05, SC-040
// Exact captured guard and retention helpers; upstream message/source/tombstone
// rows and a public caller policy are finite fixtures, not native admission.
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks=0
const signature='gridex_received_sources.switch_original_message_immutable_v1()'
const catalog=async()=>(await db.query('SELECT to_jsonb(p) metadata FROM pg_proc p WHERE p.oid=$1::regprocedure',[signature])).rows[0].metadata
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA gridex_received_sources;CREATE SCHEMA gridex_ediel_retention;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_standard text,message_family text,message_code text,intent_id uuid,outbound_request_id uuid,source_operation_id uuid,switch_request_id uuid,customer_id uuid,site_id uuid,metering_point_id uuid,raw_payload text,immutable_payload_hash text,immutable_rendered_at timestamptz,original_message_id text,status text,parsed_payload jsonb DEFAULT '{}',validation_report jsonb DEFAULT '{}',metadata jsonb DEFAULT '{}',updated_at timestamptz DEFAULT now());
 CREATE TABLE gridex_received_sources.switch_originals(message_id uuid PRIMARY KEY);
 CREATE TABLE gridex_ediel_retention.blob_tombstones(retention_class text,target_id uuid,company_id uuid,source_hash text,public_content_hash text);
 ALTER TABLE gridex_received_sources.switch_originals ENABLE ROW LEVEL SECURITY;ALTER TABLE gridex_received_sources.switch_originals FORCE ROW LEVEL SECURITY;
 REVOKE ALL ON gridex_received_sources.switch_originals,gridex_ediel_retention.blob_tombstones FROM PUBLIC,anon,authenticated,service_role;
 GRANT USAGE ON SCHEMA gridex_received_sources TO service_role;
 GRANT SELECT,UPDATE ON public.ediel_messages TO service_role,authenticated;
 ALTER TABLE public.ediel_messages ENABLE ROW LEVEL SECURITY;ALTER TABLE public.ediel_messages FORCE ROW LEVEL SECURITY;
 CREATE POLICY synthetic_current_company ON public.ediel_messages TO authenticated USING(company_id='${id(1)}') WITH CHECK(company_id='${id(1)}');
 INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload,immutable_payload_hash,status) VALUES
 ('${id(2)}','${id(1)}','test','inbound','edifact','CONTRL','CONTRL','synthetic received ACK','ackhash','parsed'),
 ('${id(3)}','${id(1)}','test','outbound','edifact','PRODAT','Z03','synthetic immutable original','originalhash','sent'),
 ('${id(4)}','${id(9)}','test','inbound','edifact','APERAK','27','synthetic foreign ACK','foreignhash','parsed');
 INSERT INTO gridex_received_sources.switch_originals VALUES('${id(3)}');`)
 const ddl=readFileSync(new URL('./fixtures/ediel-switch-original-guard-captured-functions.sql',import.meta.url),'utf8')
 assert.equal(createHash('sha256').update(ddl).digest('hex'),'55e089193b06973b26fa8b221ae5ba25e8fea573514fcc7c7c18a601137ea0b9');checks++
 await db.exec(ddl)
 await db.exec(`REVOKE ALL ON FUNCTION ${signature},gridex_ediel_retention.public_content_v1(public.ediel_messages),public.ediel_is_qualified_retention_transition_v1(public.ediel_messages,public.ediel_messages) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.ediel_is_qualified_retention_transition_v1(public.ediel_messages,public.ediel_messages) TO authenticated,service_role;
 CREATE TRIGGER ediel_switch_original_message_immutable BEFORE UPDATE ON public.ediel_messages FOR EACH ROW EXECUTE FUNCTION ${signature};`)
 const before=await catalog()
 assert.equal(before.prosecdef,false);checks++
 const pointers=`UPDATE public.ediel_messages SET customer_id='${id(10)}',site_id='${id(11)}',outbound_request_id='${id(12)}' WHERE id='${id(2)}'`
 await db.exec('SET ROLE service_role')
 // A status-only row can short-circuit before private lookup. The actual ACK
 // linker changes pointers and exposes the real invoker ownership defect.
 await db.exec(`UPDATE public.ediel_messages SET status='parsed' WHERE id='${id(2)}'`);checks++
 await assert.rejects(db.exec(pointers),{code:'42501',message:'permission denied for table switch_originals'});checks++
 await db.exec('RESET ROLE')
 assert.deepEqual((await db.query(`SELECT customer_id,site_id,outbound_request_id FROM public.ediel_messages WHERE id='${id(2)}'`)).rows[0],{customer_id:null,site_id:null,outbound_request_id:null});checks++
 const forward=readFileSync(new URL('../supabase/migrations/20261004220429_ediel_switch_original_guard_private_owner.sql',import.meta.url),'utf8')
 await db.exec(forward);checks++
 const after=await catalog(),{prosecdef:oldDefiner,...oldMetadata}=before,{prosecdef:newDefiner,...newMetadata}=after
 assert.equal(newDefiner,true);assert.equal(oldDefiner,false);assert.deepEqual(newMetadata,oldMetadata);checks+=3
 await db.exec('SET ROLE service_role');await db.exec(pointers);checks++
 assert.deepEqual((await db.query(`SELECT customer_id,site_id,outbound_request_id FROM public.ediel_messages WHERE id='${id(2)}'`)).rows[0],{customer_id:id(10),site_id:id(11),outbound_request_id:id(12)});checks++
 for(const [field,value] of Object.entries({id:`'${id(20)}'`,company_id:`'${id(9)}'`,environment:"'production'",direction:"'inbound'",message_standard:"'other'",message_family:"'APERAK'",message_code:"'Z04'",intent_id:`'${id(20)}'`,outbound_request_id:`'${id(20)}'`,source_operation_id:`'${id(20)}'`,switch_request_id:`'${id(20)}'`,customer_id:`'${id(20)}'`,site_id:`'${id(20)}'`,metering_point_id:`'${id(20)}'`,raw_payload:"'changed'",immutable_payload_hash:"'changed'",immutable_rendered_at:'now()',original_message_id:"'changed'"})){
  await assert.rejects(db.exec(`UPDATE public.ediel_messages SET ${field}=${value} WHERE id='${id(3)}'`),/switch_original_bound_message_immutable/);checks++
 }
 await assert.rejects(db.exec(`UPDATE public.ediel_messages SET raw_payload=NULL WHERE id='${id(3)}'`),/switch_original_bound_message_immutable/);checks++
 await assert.rejects(db.query('SELECT * FROM gridex_received_sources.switch_originals'),/permission denied/);checks++
 await db.exec('RESET ROLE')
 // An explicitly supplied qualified tombstone exercises the ACTUAL existing
 // retention helper, not a fabricated true/false erasure helper.
 await db.exec(`INSERT INTO gridex_ediel_retention.blob_tombstones SELECT 'received_ediel_message_content',m.id,m.company_id,encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'),encode(sha256(convert_to(gridex_ediel_retention.public_content_v1(m)::text,'UTF8')),'hex') FROM public.ediel_messages m WHERE m.id='${id(3)}'`)
 await db.exec('SET ROLE service_role');await db.exec(`UPDATE public.ediel_messages SET raw_payload=NULL,parsed_payload='{}',validation_report='{}',metadata='{}' WHERE id='${id(3)}'`);checks++
 await db.exec('RESET ROLE');assert.equal((await db.query(`SELECT raw_payload FROM public.ediel_messages WHERE id='${id(3)}'`)).rows[0].raw_payload,null);checks++
 await db.exec('SET ROLE authenticated')
 assert.equal((await db.query(`UPDATE public.ediel_messages SET status='validated' WHERE id='${id(4)}' RETURNING id`)).rows.length,0);checks++
 await assert.rejects(db.exec(`UPDATE public.ediel_messages SET company_id='${id(9)}' WHERE id='${id(2)}'`),/row-level security/);checks++
 await db.exec(`UPDATE public.ediel_messages SET status='validated' WHERE id='${id(2)}'`);checks++
 await db.exec('RESET ROLE')
 for(const role of ['anon','authenticated','service_role']){
  assert.equal((await db.query("SELECT has_function_privilege($1,$2,'EXECUTE') permitted",[role,signature])).rows[0].permitted,false);checks++
  assert.equal((await db.query("SELECT has_table_privilege($1,'gridex_received_sources.switch_originals','SELECT') permitted",[role])).rows[0].permitted,false);checks++
 }
 await db.exec('BEGIN');await assert.rejects(db.exec(forward),/switch_original_guard_existing_owner_review_required/);await db.exec('ROLLBACK');checks++
 assert.deepEqual(await catalog(),after);checks++
 console.log(JSON.stringify({status:'PASS',checks,scope:'actual captured ACK pointer-link role RED→GREEN; exact guard body/catalog/tableACL preserved, all18 original fields immutable, actual tombstone qualifier and caller RLS retained; finite upstream rows'}))
}catch(error){console.error(JSON.stringify({status:'FAIL',checks,message:error.message,code:error.code,where:error.where}));process.exitCode=1}finally{await db.close()}
