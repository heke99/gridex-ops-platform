// masterplan: DB-05, AT-DB-05
// Actual Source6 scope/public-reader SQL and the actual forward run in PGlite.
// Relations, historical completion and identity/time checkpoints are synthetic.
// No GoTrue/PostgREST/concurrency/native/physical erasure/legal proof is claimed.
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest'

const schema=readFileSync('supabase/schema.sql','utf8')
const source6=readFileSync('supabase/migrations/20261018104637_db05_completed_decision_review_reason_retention.sql','utf8')
const nextPath='supabase/migrations/20261018164728_db05_completed_review_witness_consumer_freeze.sql'
const baseline=process.env.DB05_FREEZE_COMPONENT_BASELINE==='1'
const company='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222'
const sourcePolicy='33333333-3333-4333-8333-333333333333',selected='44444444-4444-4444-8444-444444444444'
const policy='55555555-5555-4555-8555-555555555555',retirementReview='66666666-6666-4666-8666-666666666666'
const reviewer='77777777-7777-4777-8777-777777777777',sourceTarget='88888888-8888-4888-8888-888888888888'
const metadataClass='completed_decision_review_reason',originalClass='decision_evidence_policy_original_bytes'
const body='SYNTHETIC independent metadata underlay',retirementReason='SYNTHETIC retirement reviewer narrative'
const digest=(s:string)=>createHash('sha256').update(s).digest('hex')
const literal=(s:string)=>"'"+s.replaceAll("'","''")+"'"
const readerNames=['public.ediel_read_decision_evidence_policy_v1','public.ediel_read_retention_decision_original_v1']
let db:PGlite

function definition(sql:string,name:string){
 const start=sql.indexOf('CREATE FUNCTION '+name+'(')
 if(start<0)throw Error('actual_function_missing:'+name)
 const tail=sql.slice(start),match=/\bAS (\$[^$]*\$)([\s\S]*?)\1;/.exec(tail)
 if(!match)throw Error('actual_function_body_missing:'+name)
 return {text:tail.slice(0,match.index+match[0].length),body:match[2]}
}
function source6Reader(name:string){
 const installed=definition(schema,name)
 const specs=JSON.parse(/\$specs\$([\s\S]*?)\$specs\$/.exec(source6)![1]) as {name:string;before:string;after:string;changes:{old:string;new:string;count:number}[]}[]
 const spec=specs.find(s=>s.name===name)
 if(!spec)return installed.text
 let body=installed.body
 if(digest(body)!==spec.before)throw Error('source6_actual_predecessor_changed:'+name)
 for(const change of spec.changes){
  if(body.split(change.old).length-1!==change.count)throw Error('source6_actual_anchor_changed:'+name)
  body=body.replaceAll(change.old,change.new)
 }
 if(digest(body)!==spec.after)throw Error('source6_actual_postimage_changed:'+name)
 return installed.text.replace(installed.body,body)
}
const forward=()=>readFileSync(nextPath,'utf8').replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,'')
async function snapshot(){
 return (await db.query<{value:unknown}>(`SELECT jsonb_build_object(
 'policies',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM gridex_ediel_retention.decision_evidence_policies x),
 'reviews',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM gridex_ediel_retention.decision_evidence_reviews x),
 'revocations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY policy_id) FROM gridex_ediel_retention.decision_evidence_revocations x),
 'tombstones',(SELECT jsonb_agg(to_jsonb(x) ORDER BY policy_id) FROM gridex_ediel_retention.decision_evidence_tombstones x)) value`)).rows[0].value
}
async function read(port:'policy'|'original',includeBody=false,companyId=company,policyId=policy){
 return port==='policy'
  ? (await db.query<{value:Record<string,unknown>}>('SELECT public.ediel_read_decision_evidence_policy_v1($1,$2,$3,$4) value',[companyId,actor,policyId,includeBody])).rows[0].value
  : (await db.query<{value:Record<string,unknown>}>('SELECT public.ediel_read_retention_decision_original_v1($1,$2,$3,$4,$5) value',[companyId,actor,originalClass,policyId,includeBody])).rows[0].value
}
async function attempt(operation:()=>Promise<unknown>){
 await db.exec('SAVEPOINT read_attempt')
 try{const value=await operation();await db.exec('RELEASE SAVEPOINT read_attempt');return {value,error:undefined}}
 catch(error){await db.exec('ROLLBACK TO SAVEPOINT read_attempt;RELEASE SAVEPOINT read_attempt');return {value:undefined,error:error as Error&{code?:string}}}
}
async function metadata(){
 return (await db.query<{value:unknown}>(`SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) value FROM pg_proc p WHERE p.oid=ANY($1::regprocedure[])`,[['public.ediel_read_decision_evidence_policy_v1(uuid,uuid,uuid,boolean)','public.ediel_read_retention_decision_original_v1(uuid,uuid,text,uuid,boolean)']])).rows[0].value
}

beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE ROLE gridex_ediel_retention_owner NOLOGIN BYPASSRLS;
 CREATE SCHEMA gridex_ediel_retention AUTHORIZATION gridex_ediel_retention_owner;CREATE SCHEMA gridex_ediel_ack_replay;
 CREATE TABLE public.fixture_reader(company_id uuid,actor uuid,kind text,body_allowed boolean DEFAULT true,valid_until timestamptz DEFAULT 'infinity',PRIMARY KEY(company_id,actor,kind));
 CREATE TABLE public.fixture_checkpoint(calls integer NOT NULL);INSERT INTO public.fixture_checkpoint VALUES(0);
 CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE sql AS 'SELECT';
 CREATE FUNCTION gridex_ediel_retention.decision_evidence_lock_v1(uuid) RETURNS void LANGUAGE sql AS 'SELECT';`)
 for(const table of ['decision_evidence_catalog','decision_evidence_policies','decision_evidence_reviews','decision_evidence_revocations','decision_evidence_tombstones','protected_copy_specs']){
  const start=schema.indexOf('CREATE TABLE gridex_ediel_retention.'+table+' ('),end=schema.indexOf('\n);',start)+3
  if(start<0||end<3)throw Error('actual_table_missing:'+table)
  await db.exec(schema.slice(start,end)+`;ALTER TABLE gridex_ediel_retention.${table} OWNER TO gridex_ediel_retention_owner;`)
 }
 // Declared identity/time boundary: same actual public SQL calls it before
 // the target read, then the new guard must repeat it after target locks.
 await db.exec(`CREATE FUNCTION gridex_ediel_retention.decision_evidence_actor_v1(c uuid,a uuid,k text,op text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$BEGIN
 IF current_setting('fixture.actor',true) IS DISTINCT FROM a::text OR NOT EXISTS(SELECT FROM public.fixture_reader WHERE company_id=c AND actor=a AND kind=k AND valid_until>clock_timestamp() AND (op<>'ediel.retention.review' OR body_allowed)) THEN RAISE EXCEPTION 'synthetic_current_reader_denied' USING ERRCODE='42501';END IF;
 END$$;
 CREATE FUNCTION gridex_ediel_retention.decision_evidence_read_actor_v1(c uuid,a uuid,k text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$DECLARE n integer;delay_seconds double precision;BEGIN
 UPDATE public.fixture_checkpoint SET calls=calls+1 RETURNING calls INTO n;
 IF n=2 THEN
  delay_seconds:=coalesce(nullif(current_setting('fixture.last_auth_delay',true),''),'0')::double precision;
  IF delay_seconds>0 THEN PERFORM pg_sleep(delay_seconds);END IF;
  IF current_setting('fixture.fail_last_auth',true)='yes' THEN RAISE EXCEPTION 'synthetic_last_auth_failure' USING ERRCODE='42501';END IF;
 END IF;
 PERFORM gridex_ediel_retention.decision_evidence_actor_v1(c,a,k,'ediel.retention.read');END$$;
 CREATE FUNCTION gridex_ediel_retention.decision_evidence_receipt_v1(gridex_ediel_retention.decision_evidence_policies) RETURNS jsonb LANGUAGE sql AS 'SELECT NULL::jsonb';
 CREATE FUNCTION gridex_ediel_retention.decision_evidence_policy_current_v1(gridex_ediel_retention.decision_evidence_policies) RETURNS boolean LANGUAGE sql AS 'SELECT false';`)
 await db.exec(definition(source6,'gridex_ediel_retention.completed_review_reason_scope_v1').text)
 for(const name of readerNames)await db.exec(source6Reader(name))
},30000)

beforeEach(async()=>{
 await db.exec(`BEGIN;SELECT set_config('fixture.actor',${literal(actor)},true);SELECT set_config('fixture.last_auth_delay','0',true);SELECT set_config('fixture.fail_last_auth','no',true);
 INSERT INTO public.fixture_reader(company_id,actor,kind) VALUES(${literal(company)},${literal(actor)},${literal(metadataClass)}),(${literal(company)},${literal(actor)},${literal(originalClass)});
 INSERT INTO gridex_ediel_retention.decision_evidence_catalog(retention_class,source_table,permission_key,revocation_table,revocation_id_column,receipt_function) VALUES(${literal(originalClass)},'decision_evidence_policies','synthetic.private.original','synthetic','synthetic','synthetic');
 INSERT INTO gridex_ediel_retention.decision_evidence_policies(id,company_id,retention_class,target_id,source_hash,target_metadata_hash,document_bytes,document_hash,document_byte_length,document_purged_at,submitted_by) VALUES
 (${literal(sourcePolicy)},${literal(company)},'blob_retention_decision_original_bytes',${literal(sourceTarget)},repeat('a',64),repeat('b',64),NULL,repeat('c',64),20,clock_timestamp(),${literal(actor)});
 INSERT INTO gridex_ediel_retention.decision_evidence_reviews(id,policy_id,actor_user_id,outcome,reason) VALUES(${literal(selected)},${literal(sourcePolicy)},${literal(reviewer)},'approved','[Retired retention review reason]');
 INSERT INTO gridex_ediel_retention.decision_evidence_tombstones(retention_class,target_id,company_id,policy_id,review_id,source_hash,target_metadata_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference) VALUES('blob_retention_decision_original_bytes',${literal(sourceTarget)},${literal(company)},${literal(sourcePolicy)},${literal(selected)},repeat('a',64),repeat('b',64),20,${literal(actor)},clock_timestamp()-interval '1 day','SYNTHETIC original completion floor');
 INSERT INTO gridex_ediel_retention.decision_evidence_policies(id,company_id,retention_class,target_id,source_hash,target_metadata_hash,document_bytes,document_hash,submitted_by)
 SELECT ${literal(policy)},${literal(company)},${literal(metadataClass)},${literal(selected)},repeat('d',64),gridex_ediel_retention.completed_review_reason_scope_v1(${literal(company)},${literal(selected)})->>'targetMetadataHash',convert_to(${literal(body)},'UTF8'),${literal(digest(body))},${literal(actor)};
 INSERT INTO gridex_ediel_retention.decision_evidence_reviews(id,policy_id,actor_user_id,outcome,reason) VALUES(${literal(retirementReview)},${literal(policy)},${literal(reviewer)},'approved',${literal(retirementReason)});
 INSERT INTO gridex_ediel_retention.decision_evidence_revocations(policy_id,actor_user_id,reason) VALUES(${literal(policy)},${literal(actor)},'Consumed completed-review reason retirement policy');
 INSERT INTO gridex_ediel_retention.decision_evidence_tombstones(retention_class,target_id,company_id,policy_id,review_id,source_hash,target_metadata_hash,byte_length,actor_user_id,journal_retain_until,journal_purpose_reference)
 SELECT retention_class,target_id,company_id,id,${literal(retirementReview)},source_hash,target_metadata_hash,30,${literal(actor)},clock_timestamp()+interval '1 hour','SYNTHETIC separately finite witness purpose' FROM gridex_ediel_retention.decision_evidence_policies WHERE id=${literal(policy)};`)
 if(!baseline)await db.exec(forward())
},30000)
afterEach(async()=>{await db.exec('ROLLBACK')})
afterAll(async()=>{await db.close()})

it.each(['policy','original'] as const)('before W %s read returns the original namespace result without mutating its witness graph',async port=>{
 const before=await snapshot(),result=await read(port,true)
 expect(result.documentBase64).toBe(Buffer.from(body).toString('base64'))
 if(port==='policy')expect(result.reviews).toEqual(expect.arrayContaining([expect.objectContaining({reason:retirementReason})]))
 expect(await snapshot()).toEqual(before)
})
it.each(['policy','original'] as const)('at the first PG observation at-or-after W %s disclosure fails closed and preserves every row',async port=>{
 await db.exec(`UPDATE gridex_ediel_retention.decision_evidence_tombstones SET journal_retain_until=clock_timestamp() WHERE policy_id=${literal(policy)}`)
 const before=await snapshot(),result=await attempt(()=>read(port,true))
 expect(result.error?.code).toBe('42501');expect(result.error?.message).toContain('disclosure_ended');expect(result.value).toBeUndefined()
 expect(await snapshot()).toEqual(before)
})
it.each(['policy','original'] as const)('after W %s metadata and body modes both refuse without disclosure or historical mutation',async port=>{
 await db.exec(`UPDATE gridex_ediel_retention.decision_evidence_tombstones SET journal_retain_until=clock_timestamp()-interval '1 hour' WHERE policy_id=${literal(policy)}`)
 const before=await snapshot()
 for(const includeBody of [false,true]){
  const result=await attempt(()=>read(port,includeBody));expect(result.error?.code).toBe('42501');expect(result.value).toBeUndefined()
 }
 expect(await snapshot()).toEqual(before)
})
it.each(['policy','original'] as const)('%s rereads actual namespace permission after its final synthetic authorization-time checkpoint',async port=>{
 await db.exec(`UPDATE public.fixture_reader SET valid_until=clock_timestamp()+interval '15 milliseconds';SELECT set_config('fixture.last_auth_delay','0.04',true)`)
 const before=await snapshot(),result=await attempt(()=>read(port,true))
 expect(result.error?.code).toBe('42501');expect(result.error?.message).toContain('synthetic_current_reader_denied');expect(await snapshot()).toEqual(before)
})
it.each(['policy','original'] as const)('%s samples W after the final synthetic authorization-time checkpoint, not before it',async port=>{
 await db.exec(`UPDATE gridex_ediel_retention.decision_evidence_tombstones SET journal_retain_until=clock_timestamp()+interval '15 milliseconds' WHERE policy_id=${literal(policy)};SELECT set_config('fixture.last_auth_delay','0.04',true)`)
 const before=await snapshot(),result=await attempt(()=>read(port,true))
 expect(result.error?.code).toBe('42501');expect(result.error?.message).toContain('disclosure_ended');expect(result.value).toBeUndefined();expect(await snapshot()).toEqual(before)
})
it.each(['policy','original'] as const)('%s cannot return bytes when its last authorization checkpoint aborts',async port=>{
 await db.exec("SELECT set_config('fixture.fail_last_auth','yes',true)")
 const before=await snapshot(),result=await attempt(()=>read(port,true))
 expect(result.error?.code).toBe('42501');expect(result.error?.message).toContain('synthetic_last_auth_failure');expect(result.value).toBeUndefined();expect(await snapshot()).toEqual(before)
})
it.each(['policy','original'] as const)('%s preserves wrong-tenant, wrong-actor and body-only-grant refusal',async port=>{
 const before=await snapshot()
 expect((await attempt(()=>read(port,true,'99999999-9999-4999-8999-999999999999'))).error).toBeDefined()
 await db.exec("SELECT set_config('fixture.actor','99999999-9999-4999-8999-999999999999',true)")
 expect((await attempt(()=>read(port,true))).error?.code).toBe('42501')
 await db.exec(`SELECT set_config('fixture.actor',${literal(actor)},true);UPDATE public.fixture_reader SET body_allowed=false`)
 expect((await attempt(()=>read(port,true))).error?.code).toBe('42501');expect((await read(port,false)).documentBase64).toBeNull();expect(await snapshot()).toEqual(before)
})
it.each(['policy','original'] as const)('%s does not borrow another selected policy target completion or accept an unrelated child review',async port=>{
 const before=await snapshot()
 await db.exec(`UPDATE gridex_ediel_retention.decision_evidence_tombstones SET policy_id=${literal(sourcePolicy)} WHERE policy_id=${literal(policy)}`)
 expect((await attempt(()=>read(port,true))).error?.code).toBe('42501')
 await db.exec(`UPDATE gridex_ediel_retention.decision_evidence_tombstones SET policy_id=${literal(policy)},review_id=${literal(selected)} WHERE retention_class=${literal(metadataClass)}`)
 expect((await attempt(()=>read(port,true))).error?.code).toBe('42501')
 await db.exec(`UPDATE gridex_ediel_retention.decision_evidence_tombstones SET review_id=${literal(retirementReview)} WHERE policy_id=${literal(policy)}`)
 expect(await snapshot()).toEqual(before)
})
it.each(['policy','original'] as const)('%s refuses a missing consumed-policy child or original source completion without repairing it',async port=>{
 await db.exec(`DELETE FROM gridex_ediel_retention.decision_evidence_revocations WHERE policy_id=${literal(policy)}`)
 const noRevocation=await snapshot();expect((await attempt(()=>read(port,true))).error?.code).toBe('42501');expect(await snapshot()).toEqual(noRevocation)
 await db.exec(`INSERT INTO gridex_ediel_retention.decision_evidence_revocations(policy_id,actor_user_id,reason) VALUES(${literal(policy)},${literal(actor)},'Consumed completed-review reason retirement policy');DELETE FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=${literal(sourcePolicy)}`)
 const noCompletion=await snapshot();expect((await attempt(()=>read(port,true))).error).toBeDefined();expect(await snapshot()).toEqual(noCompletion)
})
it('uncompleted unqualified intake remains reviewable without trusting a caller deadline',async()=>{
 await db.exec(`DELETE FROM gridex_ediel_retention.decision_evidence_tombstones WHERE policy_id=${literal(policy)};DELETE FROM gridex_ediel_retention.decision_evidence_revocations WHERE policy_id=${literal(policy)};UPDATE gridex_ediel_retention.decision_evidence_policies SET issuer_receipt='{"unsigned":"not authority","journalRetainUntil":"2000-01-01"}' WHERE id=${literal(policy)}`)
 const before=await snapshot();expect((await read('policy',true)).documentBase64).toBe(Buffer.from(body).toString('base64'));expect(await snapshot()).toEqual(before)
})
it('unrelated original classes do not inherit a metadata witness deadline',async()=>{
 await db.exec(`UPDATE gridex_ediel_retention.decision_evidence_policies SET retention_class='unrelated_original' WHERE id=${literal(policy)};INSERT INTO public.fixture_reader(company_id,actor,kind) VALUES(${literal(company)},${literal(actor)},'unrelated_original');UPDATE gridex_ediel_retention.decision_evidence_tombstones SET journal_retain_until=clock_timestamp()-interval '1 day' WHERE policy_id=${literal(policy)}`)
 expect((await read('policy',true)).documentBase64).toBe(Buffer.from(body).toString('base64'))
})
it.skipIf(baseline)('private guard has no public application execute and unknown predecessor aborts both function replacements',async()=>{
 expect((await db.query<{allowed:boolean}>("SELECT has_function_privilege('authenticated','gridex_ediel_retention.require_completed_review_witness_disclosure_v1(uuid,uuid,uuid,text,boolean)','EXECUTE') allowed")).rows[0].allowed).toBe(false)
 await db.exec('DROP FUNCTION gridex_ediel_retention.require_completed_review_witness_disclosure_v1(uuid,uuid,uuid,text,boolean)')
 for(const name of readerNames)await db.exec(source6Reader(name).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'))
 const old=source6Reader(readerNames[1]);await db.exec(old.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('DECLARE tab text','DECLARE unexpected_marker boolean;tab text'))
 const before=await metadata(),bodies=(await db.query<{prosrc:string}>(`SELECT prosrc FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid`,[['public.ediel_read_decision_evidence_policy_v1(uuid,uuid,uuid,boolean)','public.ediel_read_retention_decision_original_v1(uuid,uuid,text,uuid,boolean)']])).rows
 const result=await attempt(()=>db.exec(forward()));expect(result.error?.message).toContain('predecessor_changed');expect(await metadata()).toEqual(before)
 expect((await db.query<{prosrc:string}>(`SELECT prosrc FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid`,[['public.ediel_read_decision_evidence_policy_v1(uuid,uuid,uuid,boolean)','public.ediel_read_retention_decision_original_v1(uuid,uuid,text,uuid,boolean)']])).rows).toEqual(bodies)
})
