// Actual new readonly RPC SQL against a synthetic protected-receipt boundary.
// This proves scoped reads/locks/ACL/no capture, not native migration replay.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(), uid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let checks = 0
try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE SCHEMA gridex_ediel_source_rules;GRANT USAGE ON SCHEMA gridex_ediel_source_rules TO service_role;
 CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,environment text,direction text,message_family text,raw_payload text,related_message_id uuid);
 CREATE TABLE gridex_ediel_source_rules.receipts(source_message_id uuid PRIMARY KEY,company_id uuid,payload_sha256 text,evidence jsonb);
 CREATE FUNCTION gridex_ediel_source_rules.require_v1(company uuid,msg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
 DECLARE m public.ediel_messages%rowtype;r gridex_ediel_source_rules.receipts%rowtype;BEGIN
 SELECT * INTO m FROM public.ediel_messages WHERE id=msg AND company_id=company FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;
 SELECT * INTO r FROM gridex_ediel_source_rules.receipts WHERE source_message_id=msg AND company_id=company;
 IF NOT FOUND THEN RAISE EXCEPTION 'ediel_historical_rule_pack_basis_unavailable';END IF;
 IF r.payload_sha256 IS DISTINCT FROM encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex') THEN RAISE EXCEPTION 'ediel_source_rule_pack_basis_required';END IF;RETURN r.evidence;END $$;
 INSERT INTO public.ediel_messages VALUES('${uid(1)}','${uid(100)}','test','inbound','UTILTS','exact-original',NULL),('${uid(2)}','${uid(100)}','test','outbound','APERAK','exact-ack','${uid(1)}'),('${uid(3)}','${uid(100)}','test','inbound','UTILTS','old-original',NULL);
 INSERT INTO gridex_ediel_source_rules.receipts VALUES('${uid(1)}','${uid(100)}',encode(sha256(convert_to('exact-original','UTF8')),'hex'),' {"version":"opaque-original","snapshot":{"exact":"frozen"}}');`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930190015_ediel_atomic_ack_original_rule_pack_read.sql',import.meta.url),'utf8')); checks++
 const rpc = async (name,args) => { await db.exec('set role service_role');try{return (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result}finally{await db.exec('reset role')} }
 const read = (id=1,company=100) => rpc('ediel_read_source_rule_pack_basis_v1',[uid(company),uid(id)])
 const ack = (id=2,company=100,env='test') => rpc('ediel_read_outbound_ack_source_rule_pack_basis_v1',[uid(company),env,uid(id)])
 const original = await read();assert.equal(original.version,1);assert.equal(original.sourceMessage.raw_payload,'exact-original');assert.equal(original.sourceRulePackEvidence.version,'opaque-original');checks++
 const actual = await ack();assert.deepEqual(actual.sourceRulePackEvidence,original.sourceRulePackEvidence);assert.equal(actual.ackMessage.raw_payload,'exact-ack');assert.equal(actual.ackMessage.related_message_id,uid(1));checks++
 for(const run of [()=>read(1,101),()=>read(2),()=>read(999),()=>ack(2,101),()=>ack(2,100,'production'),()=>ack(1)]){await assert.rejects(run(),/actual_original_unavailable/);checks++}
 await assert.rejects(read(3),/historical_rule_pack_basis_unavailable/);checks++
 assert.equal((await db.query('select count(*)::int n from gridex_ediel_source_rules.receipts')).rows[0].n,1);checks++
 await db.exec(`update public.ediel_messages set related_message_id='${uid(3)}' where id='${uid(2)}'`);await assert.rejects(ack(),/historical_rule_pack_basis_unavailable/);checks++
 await db.exec(`update public.ediel_messages set related_message_id='${uid(1)}' where id='${uid(2)}';update public.ediel_messages set raw_payload='changed-original' where id='${uid(1)}'`);await assert.rejects(read(),/source_rule_pack_basis_required/);await assert.rejects(ack(),/source_rule_pack_basis_required/);checks++
 await db.exec(`update public.ediel_messages set raw_payload='exact-original',environment='production' where id='${uid(1)}'`);await assert.rejects(ack(),/actual_original_unavailable/);checks++
 const acl = (await db.query("select has_function_privilege('authenticated','public.ediel_read_source_rule_pack_basis_v1(uuid,uuid)','execute') as original_read,has_function_privilege('anon','public.ediel_read_outbound_ack_source_rule_pack_basis_v1(uuid,text,uuid)','execute') as ack_read,has_function_privilege('authenticated','gridex_ediel_source_rules.read_outbound_ack_v1(uuid,text,uuid)','execute') as private_read")).rows[0]
 assert.deepEqual(acl,{original_read:false,ack_read:false,private_read:false});checks++
 console.log(`Focused actual atomic ACK original/rule-basis readonly RPC scope/hash/ACL/no-capture checks: ${checks} PASS`)
} catch (error) { console.error(error);process.exitCode=1 } finally { await db.close() }
