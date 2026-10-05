// masterplan: TR-05, AT-TR-05, SC-040
// Actual immutable validation owner and public invoker facade; finite upstream
// physical-original/witness ports and direct probe grants are declared here.
// Genuine received ACK/recovery execution remains mandatory in native tests.
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
const inheritedUrl=new URL('./ediel-original-rule-witness-sql-regression.mjs',import.meta.url)
let base=readFileSync(inheritedUrl,'utf8')
const marker=' const ack=await validAppend(facts,31)'
const stop=base.indexOf(marker);assert(stop>0)
base=base.slice(0,stop).replaceAll('import.meta.url',JSON.stringify(inheritedUrl.href))
const upstreamDDL=String.raw`CREATE FUNCTION gridex_ediel_source_rules.read_ack_source_before_basis_v1(company uuid,environment text,msg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$BEGIN
 IF current_user<>'service_role' AND session_user<>'service_role' AND coalesce(current_setting('role',true),'')<>'service_role' THEN RAISE EXCEPTION 'service_role_required' USING ERRCODE='42501';END IF;
 RETURN(SELECT jsonb_build_object('sourceMessage',jsonb_build_object('id','00000000-0000-4000-8000-000000000030')) FROM public.synthetic_original_ack WHERE company_id=company AND source_message_id=msg AND environment='test');END$$;
 CREATE FUNCTION gridex_ediel_source_rules.require_v1(company uuid,msg uuid) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT evidence FROM public.synthetic_original_ack WHERE company_id=company AND msg='00000000-0000-4000-8000-000000000030'$$;
 REVOKE ALL ON ALL FUNCTIONS IN SCHEMA gridex_ediel_source_rules FROM PUBLIC,anon,authenticated,service_role;
 GRANT USAGE ON SCHEMA gridex_ediel_source_rules,gridex_received_sources TO service_role;
 GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA gridex_ediel_source_rules TO service_role;
 GRANT EXECUTE ON FUNCTION gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text) TO service_role;`
const phase=String.raw`
 const baselineChecks=checks;
 await db.exec('CREATE SCHEMA gridex_ediel_source_rules;DROP FUNCTION public.gridex_read_inbound_ack_source_v1(uuid,text,uuid);ALTER FUNCTION gridex_received_sources.append_validation(uuid,text,uuid,text,text) RENAME TO append_validation_before_reference_profile_v1;');
 // Only these upstream physical-global qualifier and sealed witness ports are
 // synthetic. The public current_user guard and actual append body are real.
 await db.exec(${JSON.stringify(upstreamDDL)}); const wrapperMigration=readFileSync(new URL('../supabase/migrations/20260930180104_ediel_immutable_source_rule_pack_basis.sql',${JSON.stringify(inheritedUrl.href)}),'utf8');
 const publicStart=wrapperMigration.indexOf('CREATE FUNCTION public.gridex_read_inbound_ack_source_v1(');
 const publicEnd=wrapperMigration.indexOf('REVOKE ALL ON ALL FUNCTIONS',publicStart);
 await db.exec(wrapperMigration.slice(publicStart,publicEnd));
 await db.exec('REVOKE ALL ON FUNCTION public.gridex_read_inbound_ack_source_v1(uuid,text,uuid) FROM PUBLIC,anon,authenticated;GRANT EXECUTE ON FUNCTION public.gridex_read_inbound_ack_source_v1(uuid,text,uuid) TO service_role;');
 const signature='gridex_received_sources.append_validation_before_reference_profile_v1(uuid,text,uuid,text,text)';
 const catalog=async()=>(await db.query('SELECT to_jsonb(p) metadata FROM pg_proc p WHERE p.oid=$1::regprocedure',[signature])).rows[0].metadata;
 const before=await catalog();
 const call=async(value=facts,id=31,company=100)=>(await db.query('SELECT gridex_received_sources.append_validation_before_reference_profile_v1($1,\'test\',$2,encode(sha256(convert_to(\'exact raw\',\'UTF8\')),\'hex\'),$3) result',[uid(company),uid(id),JSON.stringify(value)])).rows[0].result;
 await db.exec('SET ROLE service_role');
 assert.deepEqual((await db.query('SELECT public.gridex_read_inbound_ack_source_v1($1,\'test\',$2) result',[uid(100),uid(31)])).rows[0].result.sourceRulePackEvidence,pack);checks++;
 await assert.rejects(call(),{code:'42501',message:'service_role_required'});checks++;
 await db.exec('RESET ROLE');
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.validation_assessments')).rows[0].n,1);checks++;
 const forward=readFileSync(new URL('../supabase/migrations/20261004214144_ediel_received_ack_validation_private_original_read.sql',${JSON.stringify(inheritedUrl.href)}),'utf8');
 await db.exec(forward);checks++;
 const after=await catalog(),{prosrc:oldBody,...oldMetadata}=before,{prosrc:newBody,...newMetadata}=after;
 assert.deepEqual(newMetadata,oldMetadata);assert.notEqual(newBody,oldBody);checks+=2;
 await db.exec('SET ROLE service_role');
 const accepted=await call();assert.ok(accepted.assessmentId);assert.equal(accepted.sourceDisposition,'not_established');checks++;
 const forged=structuredClone(facts);forged.rulePackEvidence.version='25-A-3:r999';
 await assert.rejects(call(forged),/received_validation_rule_evidence_unavailable/);checks++;
 await assert.rejects(call(facts,31,101),/received_validation_source_unavailable/);checks++;
 await db.exec('RESET ROLE');
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_received_sources.validation_assessments')).rows[0].n,2);checks++;
 await db.exec('DELETE FROM public.synthetic_original_ack');
 await db.exec('SET ROLE service_role');await assert.rejects(call(),/received_validation_rule_evidence_unavailable/);checks++;
 await db.exec('RESET ROLE');
 for(const role of ['anon','authenticated']){
  await db.exec('SET ROLE '+role);await assert.rejects(db.query('SELECT public.gridex_read_inbound_ack_source_v1(NULL,NULL,NULL)'),/permission denied/);checks++;
  await db.exec('RESET ROLE');
 }
 await db.exec('BEGIN');await assert.rejects(db.exec(forward),/received_ack_validation_existing_owner_review_required/);await db.exec('ROLLBACK');
 assert.deepEqual(await catalog(),after);checks+=2;
 console.log(JSON.stringify({status:'PASS',checks,baselineChecks,scope:'actual definer→public guard RED; private original+witness GREEN; immutable historical witness, forged/missing/foreign refusal, public ACL and entire pg_proc metadata preserved; upstream original ports finite'}));
}catch(error){console.error(JSON.stringify({status:'FAIL',checks,message:error.message,code:error.code,where:error.where}));process.exitCode=1}finally{await db.close()}
`
try{await import('data:text/javascript;base64,'+Buffer.from(base+phase).toString('base64'))}catch(error){console.error(error.message);process.exitCode=1}
