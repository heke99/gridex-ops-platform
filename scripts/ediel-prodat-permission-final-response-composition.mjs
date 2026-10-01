/** Optional EDIEL_PERMISSION_PROBE_MODULE hook. Real permission source writes,
 * partition and committed-effect getter compose with the real final materializer.
 * The canonical national-response and original guide below are declared test
 * boundaries, not authentic/native/RLS/replay acceptance evidence. */
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'

export default async function composePermissionFinalResponse({db,id,source,scopes,company,effects}){
 let checks=0
 const check=(actual,expected)=>{assert.deepEqual(actual,expected);checks++}
 const generated=readFileSync(new URL('../supabase/migrations/20261001034855_ediel_prodat_aperak_unused_document_fields.sql',import.meta.url),'utf8')
 const edition=JSON.parse(generated.match(/FROM \(SELECT '((?:[^']|'')*)'::jsonb value\) edition;/)[1].replaceAll("''","'"))
 const m=(await db.query('SELECT * FROM public.ediel_messages WHERE id=$1',[source])).rows[0]
 const payloadHash=(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') h",[m.raw_payload])).rows[0].h
 const assessmentId=id(1030)
 // A has a real permission effect. B is rejected by its own APP source and C
 // remains independently held despite its initial national positive response.
 const facet={version:1,sourcePayloadHash:payloadHash,objects:scopes.map((scope,index)=>({
  lineIndex:scope.registers[0].segmentIndex,registerLineIndices:scope.registers.map(r=>r.segmentIndex),
  id:scope.objectId,li:'LI-A',outcome:index===1?'negative':'positive',
 })),responses:scopes.map((scope,index)=>({scope:'object',lineIndex:scope.registers[0].segmentIndex,
  ercCode:index===1?'41':'100',fieldCode:index===1?'217':null,
  text:index===1?'DECLARED NATIONAL SOURCE DIAGNOSTIC':edition.projection.constraints.common.positiveText,
  id:scope.objectId,li:'LI-A'}))}
 await db.query("UPDATE gridex_received_sources.prodat_response_facets SET response_facts_text=$1,response_facts_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE assessment_id=$2",[JSON.stringify(facet),assessmentId])
 await db.exec(`CREATE SCHEMA gridex_ediel_ack_guide;
 CREATE TABLE gridex_ediel_ack_guide.source_bindings(source_message_id uuid,kind text,company_id uuid,environment text,payload_sha256 text,source_version text);
 CREATE TABLE gridex_ediel_ack_guide.synthetic_original_guide(source_version text PRIMARY KEY,projection jsonb);
 CREATE FUNCTION gridex_ediel_ack_guide.projection_for_original_v1(v text) RETURNS jsonb LANGUAGE sql AS $$SELECT projection FROM gridex_ediel_ack_guide.synthetic_original_guide WHERE source_version=$1$$;
 -- Same named canonical national-response witness is an explicit fixture.
 CREATE FUNCTION gridex_received_sources.read_prodat_response_assessment_v1(c uuid,s uuid,a uuid) RETURNS jsonb LANGUAGE plpgsql AS $$DECLARE f gridex_received_sources.prodat_response_facets%rowtype;BEGIN
 SELECT * INTO f FROM gridex_received_sources.prodat_response_facets WHERE assessment_id=a AND company_id=c AND source_message_id=s;
 IF f.assessment_id IS NULL OR f.response_facts_hash IS DISTINCT FROM encode(sha256(convert_to(f.response_facts_text,'UTF8')),'hex') THEN RAISE EXCEPTION 'declared_national_response_fixture_required';END IF;
 RETURN f.response_facts_text::jsonb||jsonb_build_object('assessmentId',f.assessment_id);END$$;
 CREATE FUNCTION gridex_received_sources.prodat_response_before_domain_effects_v1(uuid,uuid,integer[] DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$SELECT NULL::jsonb$$;
 CREATE FUNCTION gridex_received_sources.committed_supply_effects_v1(uuid,uuid,integer[] DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$SELECT '[]'::jsonb$$;`)
 await db.query('INSERT INTO gridex_ediel_ack_guide.synthetic_original_guide VALUES($1,$2)',[edition.sourceVersion,edition.projection])
 await db.query("INSERT INTO gridex_ediel_ack_guide.source_bindings VALUES($1,'national',$2,$3,$4,$5)",[source,company,m.environment,payloadHash,edition.sourceVersion])
 const forward=readFileSync(new URL('../supabase/migrations/20261001043602_ediel_committed_domain_prodat_final_responses.sql',import.meta.url),'utf8')
 const start=forward.indexOf('CREATE FUNCTION gridex_received_sources.prodat_structural_response_v1('),end=forward.indexOf('END $$;',start)
 assert.ok(start>=0&&end>start)
 await db.exec(forward.slice(start,end+7))
 const read=async requested=>(await db.query('SELECT gridex_received_sources.prodat_structural_response_v1($1,$2,$3) final',[company,source,requested])).rows[0].final
 const final=await read(null)
 check(final.objects.map(o=>o.outcome),['positive','negative','held'])
 check(final.responses.filter(r=>r.ercCode==='100').map(r=>r.lineIndex),[scopes[0].registers[0].segmentIndex])
 check(final.responses.find(r=>r.lineIndex===scopes[1].registers[0].segmentIndex),facet.responses[1])
 check(final.effectScopes.map(e=>e.effectReceiptId),effects.map(e=>e.receiptId))
 check(final.effectScopes.map(e=>e.effectFactsHash),effects.map(e=>e.effectFactsHash))
 check(final.effectScopes.every(e=>e.objectAssessmentId===null&&e.effectKind==='metering_permission'),true)
 check((await read([scopes[0].registers[0].segmentIndex])).effectScopes.length,1)
 await assert.rejects(read([scopes[1].registers[0].segmentIndex]),/uncommitted/);checks++
 await assert.rejects(read([scopes[2].registers[0].segmentIndex]),/uncommitted/);checks++
 await assert.rejects(read([scopes[0].registers[0].segmentIndex,scopes[0].registers[0].segmentIndex]),/scope_required/);checks++
 // Current mutable application/legal fixtures cannot replace the proof of
 // the real source's already committed, admitted permission effect.
 await db.exec('BEGIN')
 await db.query('DELETE FROM legal_fixture WHERE source=$1',[source])
 await db.query('DELETE FROM application_fixture WHERE source=$1',[source])
 check((await read(null)).effectScopes.map(e=>e.effectReceiptId),effects.map(e=>e.receiptId))
 await db.exec('ROLLBACK')
 console.log(`PASS ${checks} composed real permission receipt -> final own response criteria; national/witness fixtures declared, native/authentic/RLS/replay NOT RUN`)
}
