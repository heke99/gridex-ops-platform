/** Declared synthetic mechanical probe, not native replay or business approval.
 * The preexisting canonical append owner below is a test-only stand-in; this
 * checks the new wrapper's atomicity, physical scope and protected read joins. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
if(!process.env.PGLITE_MODULE_URL)throw Error('PGLITE_MODULE_URL required')
const {PGlite}=await import(process.env.PGLITE_MODULE_URL),db=new PGlite()
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_received_sources;
CREATE TABLE gridex_received_sources.sources(source_message_id uuid PRIMARY KEY,company_id uuid,environment text,raw_payload text,payload_hash text);
CREATE TABLE gridex_received_sources.validation_assessments(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),company_id uuid,environment text,source_message_id uuid,source_payload_hash text,facts_text text,facts_hash text);
CREATE TABLE gridex_received_sources.object_selection_snapshots(id uuid PRIMARY KEY,company_id uuid,environment text,cutoff_at timestamptz,readset_text text,readset_hash text);
CREATE TABLE public.user_profiles(id uuid,user_status text);CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS boolean LANGUAGE sql AS $$SELECT true$$;
CREATE FUNCTION gridex_received_sources.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'received_source_evidence_is_append_only';END$$;
CREATE FUNCTION gridex_received_sources.append_validation(c uuid,e text,s uuid,h text,f text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$DECLARE aid uuid;BEGIN
 IF NOT EXISTS(SELECT FROM gridex_received_sources.sources x WHERE x.company_id=c AND x.environment=e AND x.source_message_id=s AND x.payload_hash=h) THEN RAISE EXCEPTION 'synthetic_canonical_source_mismatch';END IF;
 INSERT INTO gridex_received_sources.validation_assessments(company_id,environment,source_message_id,source_payload_hash,facts_text,facts_hash)VALUES(c,e,s,h,f,encode(sha256(convert_to(f,'UTF8')),'hex')) RETURNING id INTO aid;
 RETURN jsonb_build_object('version',1,'assessmentId',aid,'companyId',c,'environment',e,'sourceMessageId',s,'sourcePayloadHash',h,'factsHash',encode(sha256(convert_to(f,'UTF8')),'hex'),'sourceDisposition','not_established');END$$;`)
const decoder=readFileSync(new URL('../supabase/migrations/20260930144205_ediel_permission_source_atomic_transitions.sql',import.meta.url),'utf8')
await db.exec(decoder.slice(0,decoder.indexOf('CREATE FUNCTION gridex_received_sources.permission_wire_v1'))+'\nCOMMIT;')
await db.exec(readFileSync(new URL('../supabase/migrations/20260930215244_ediel_prodat_ignored_field_source_projection.sql',import.meta.url),'utf8'))
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,company=id(1),source=id(2),actor=id(3),snap=id(4)
const raw="UNB+UNOC:3+12345:14+54321:14+261001:1200+I'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z06+D+9'LIN+1++735123456789012345:::9'CCI++Z14'CAV+:::EXTRA'UNT+6+M'UNZ+1+I'"
const sha=async text=>(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') AS hash",[text])).rows[0].hash
const hash=await sha(raw),facts=JSON.stringify({messageReference:'M',registerValidation:{owner:'validateProdatRegisterPolicy'}})
const fields=[{fieldNumber:'242',sourceRule:'PRODAT26A:P119',occurrence:{scope:'object',messageReference:'M',lineIndex:0,lineNumber:'1',objectId:'735123456789012345',identityAgency:'9'}}]
await db.query("INSERT INTO gridex_received_sources.sources VALUES($1,$2,'test',$3,$4)",[source,company,raw,hash])
await db.query("INSERT INTO public.user_profiles VALUES($1,'active')",[actor]);await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())",[company,actor])
await db.exec('GRANT USAGE ON SCHEMA public,gridex_received_sources TO service_role;SET ROLE service_role;')
const record=(values=fields)=>db.query("SELECT public.gridex_record_prodat_source_validation_v2($1,'test',$2,$3,$4,$5) AS receipt",[company,source,hash,facts,values===null?null:JSON.stringify(values)])
const result=(await record()).rows[0].receipt
assert.equal(result.version,2);assert.equal(result.ignoredFieldsHash,await sha(JSON.stringify(fields)))
await db.exec('RESET ROLE;')
assert.equal((await db.query('SELECT fields_text FROM gridex_received_sources.prodat_ignored_field_facets')).rows[0].fields_text,JSON.stringify(fields))
const count=(await db.query('SELECT count(*)::int AS n FROM gridex_received_sources.validation_assessments')).rows[0].n
await db.exec('SET ROLE service_role;')
await assert.rejects(()=>record([{...fields[0],occurrence:{...fields[0].occurrence,identityAgency:'89'}}]),/prodat_ignored_field_physical_scope_invalid/)
await db.exec('RESET ROLE;')
assert.equal((await db.query('SELECT count(*)::int AS n FROM gridex_received_sources.validation_assessments')).rows[0].n,count,'invalid optional facet rolls back the canonical append in the same transaction')
const text=JSON.stringify({complete:true,sources:[{sourceMessageId:source,payloadHash:hash,assessments:[{id:id(5),canonicalAssessmentId:result.assessmentId,assessedAt:'2026-09-30T00:00:00Z',previousAssessmentId:null}]}]})
const readHash=await sha(text)
await db.query("INSERT INTO gridex_received_sources.object_selection_snapshots VALUES($1,$2,'test','2026-10-01',$3,$4)",[snap,company,text,readHash])
await db.exec('SET ROLE service_role;')
const read=(c=company)=>db.query("SELECT public.gridex_read_prodat_ignored_fields_v1($1,'test',$2,$3,$4) AS result",[c,actor,snap,readHash])
assert.equal((await read()).rows[0].result.facets[0].fieldsText,JSON.stringify(fields))
await assert.rejects(()=>read(id(99)),/ediel_tenant_actor_forbidden/)
await db.exec('RESET ROLE;')
await assert.rejects(()=>db.exec("UPDATE gridex_received_sources.prodat_ignored_field_facets SET fields_text='[]'"),/received_source_evidence_is_append_only/)
assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.gridex_read_prodat_ignored_fields_v1(uuid,text,uuid,uuid,text)','EXECUTE') AS allowed")).rows[0].allowed,false)
await db.close()
console.log('PASS: declared synthetic P119 same-canonical facet atomic append/rollback, exact physical object/agency, immutable protected snapshot linkage and tenant read gate. Native/replay/authentic-source semantics NOT RUN.')
