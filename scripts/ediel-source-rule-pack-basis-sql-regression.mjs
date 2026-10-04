// Focused actual immutable rule-basis SQL. Legal and physical ACK qualifiers are
// explicit boundary fixtures; their own regressions remain separate. Not native/replay.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(); const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema gridex_ediel_inbound_context;create schema gridex_received_sources;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,message_received_at timestamptz,message_sent_at timestamptz,related_message_id uuid,canonical_rule_pack_id uuid,rule_profile_version_id uuid,rule_profile_key text,rule_profile_version text,rule_pack_checksum text,rule_pack_snapshot jsonb);
 create table public.ediel_message_profiles(id uuid primary key,rule_pack_id uuid,profile_key text,message_code text,transaction_subtype text,direction text,is_enabled boolean,profile jsonb);
 create table public.ediel_rule_packs(id uuid primary key,family text,market text,source_hash text,status text,valid_from date,valid_to date,guide_version text,guide_revision text);
 create table public.ediel_rule_pack_sources(id uuid primary key,rule_pack_id uuid,source_hash text,title text);
 create table public.tenant_ediel_profiles(id uuid,company_id uuid,environment text,market text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
 create table public.tenant_actor_identifiers(id uuid,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 create table public.tenant_actor_roles(id uuid,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
 create table public.tenant_counterparty_relations(id uuid,company_id uuid,environment text,counterparty_actor_id uuid,relation_type text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
 create table public.platform_actor_identifiers(id uuid,actor_id uuid,identifier_type text,identifier_value text,valid_from date,valid_to date);
 create table gridex_ediel_inbound_context.receipts(source_message_id uuid,context jsonb,status text,direction text,payload_sha256 text);
 create table gridex_received_sources.validation_assessments(id uuid primary key,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,previous_assessment_id uuid,owner text,facts_text text,facts_hash text);
 create function gridex_ediel_inbound_context.require_v1(uuid,uuid) returns jsonb language plpgsql security definer as $$declare c jsonb;begin select context into c from gridex_ediel_inbound_context.receipts where source_message_id=$2; if c is null then raise exception 'ediel_historical_identity_basis_unavailable';end if;return c;end$$;
 create function public.gridex_read_inbound_ack_source_v1(uuid,text,uuid) returns jsonb language sql security definer as $$select jsonb_build_object('version',1,'sourceMessage',to_jsonb(s)) from public.ediel_messages a join public.ediel_messages s on s.id=a.related_message_id where a.id=$3 and a.company_id=$1 and a.environment=$2$$;
 insert into ediel_rule_packs values('${uid(2)}','UTILTS','electricity',repeat('a',64),'active','2000-01-01',null,'25-A-3','3');
 insert into ediel_message_profiles values('${uid(3)}','${uid(2)}','DB:UTILTS:E73','E73','','outbound',true,'{"actual":"profile"}');
 insert into ediel_rule_pack_sources values('${uid(4)}','${uid(2)}',repeat('b',64),'actual registered guide source');`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930180104_ediel_immutable_source_rule_pack_basis.sql',import.meta.url),'utf8'));checks++
 const snapshot={profileKey:'semantic_utilts_e73',profileVersionId:uid(3),version:'opaque-original-version',checksum:'a'.repeat(64),unchanged:'original'}
 const add=async(id,{company=1,direction='outbound',sent=false,legal=true,related=null,family='UTILTS',code='E73'}={})=>{
  await db.query("insert into ediel_messages values($1,$2,'test',$3,$4,$5,$6,null,$7,$8,$9,$10,$11,$12,$13,$14)",[uid(id),uid(company),direction,family,code,`raw-owned-${id}`,sent?'2026-09-30T12:00:00Z':null,related?uid(related):null,uid(2),uid(3),snapshot.profileKey,snapshot.version,snapshot.checksum,snapshot])
  if(legal)await db.query('insert into gridex_ediel_inbound_context.receipts(source_message_id,context) values($1,$2)',[uid(id),{basisKind:related?'prescribed_outbound_ack':'observed_source_persistence',family,code,subtype:null,sourceEdition:'frozen-identity-edition',originalSourceMessageId:related?uid(related):undefined}])
 }
 const act=async(action,id,company=1)=>{await db.exec('set role service_role');try{return (await db.query(`select public.ediel_${action}_source_rule_pack_basis_v1($1,$2) evidence`,[uid(company),uid(id)])).rows[0].evidence}finally{try{await db.exec('reset role')}catch{/* caller rolls back the intentionally aborted transaction */}}}
 await add(10);const first=await act('capture',10);assert.equal(first.profileKey,'DB:UTILTS:E73');assert.equal(first.version,'opaque-original-version');assert.equal(first.snapshot.originalMessageSnapshot.unchanged,'original');assert.equal(first.snapshot.messageProfile.profile.actual,'profile');assert.equal(first.snapshot.guideSources[0].source_hash,'b'.repeat(64));checks++
 await db.exec(`update ediel_messages set message_sent_at=now(),rule_pack_checksum=repeat('f',64),rule_profile_version='forged' where id='${uid(10)}';update ediel_rule_packs set status='retired',source_hash=repeat('c',64);update ediel_message_profiles set profile='{"actual":"changed"}'`)
 assert.deepEqual(await act('require',10),first);assert.deepEqual(await act('capture',10),first);checks++
 await db.exec(`update ediel_rule_packs set status='active',source_hash=repeat('a',64);update ediel_message_profiles set profile='{"actual":"profile"}'`)
 await add(11,{sent:true});await assert.rejects(act('capture',11),/ediel_historical_rule_pack_basis_unavailable/);await db.exec('reset role');checks++
 await assert.rejects(act('require',11),/ediel_historical_rule_pack_basis_unavailable/);await db.exec('reset role');checks++
 await add(12,{legal:false});await assert.rejects(act('capture',12),/ediel_historical_identity_basis_unavailable/);await db.exec('reset role');checks++
 await add(13);await db.exec(`update ediel_messages set canonical_rule_pack_id='${uid(99)}' where id='${uid(13)}'`);await assert.rejects(act('capture',13),/ediel_source_rule_pack_basis_required/);await db.exec('reset role');checks++
 await add(14);await db.exec(`update ediel_messages set rule_pack_snapshot=jsonb_set(rule_pack_snapshot,'{version}','"forged"') where id='${uid(14)}'`);await assert.rejects(act('capture',14),/ediel_source_rule_pack_basis_required/);await db.exec('reset role');checks++
 await add(15);await assert.rejects(act('capture',15,99),/ediel_source_rule_pack_basis_required/);await db.exec('reset role');checks++
 await add(16);await db.exec(`update ediel_rule_packs set status='future'`);await assert.rejects(act('capture',16),/ediel_source_rule_pack_basis_required/);await db.exec('reset role');await db.exec("update ediel_rule_packs set status='active'");checks++
 await add(17,{direction:'inbound'});await db.exec("update ediel_message_profiles set direction='both'");await assert.rejects(act('capture',17),/ediel_source_rule_pack_basis_required/);await db.exec('reset role');checks++
 const expected={profileKey:'DB:UTILTS:E73',messageProfileId:uid(3),rulePackId:uid(2),sourceHash:'a'.repeat(64)}
 const append=async(id,source,pack=expected)=>{const text=JSON.stringify({owner:'canonical-runtime-with-registry-v1',rulePackEvidence:pack,syntaxDecision:'accepted',applicationDecision:'accepted'});await db.query("insert into gridex_received_sources.validation_assessments values($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),null,'canonical-runtime-with-registry-v1',$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[uid(id),uid(source),uid(1),`raw-owned-${source}`,text])}
 await append(30,17);assert.equal((await act('capture',17)).rulePackId,uid(2));checks++
 await add(18,{direction:'inbound'});await append(31,18,{...expected,profileKey:'FORGED'});await assert.rejects(act('capture',18),/ediel_source_rule_pack_basis_required/);await db.exec('reset role');checks++
 await add(19,{direction:'inbound'});await db.exec('begin');await append(32,19);await assert.rejects(act('capture',19),/ediel_source_rule_pack_basis_required/);await db.exec('rollback;reset role');checks++
 await add(20,{family:'APERAK',code:'312',related:17});assert.deepEqual(await act('capture',20),await act('require',17));checks++
 await add(21,{family:'APERAK',code:'312',related:18});await assert.rejects(act('capture',21),/ediel_historical_rule_pack_basis_unavailable/);await db.exec('reset role');checks++
 await add(22,{family:'APERAK',code:'312',related:17});await db.exec(`update ediel_messages set rule_pack_checksum=repeat('f',64) where id='${uid(22)}'`);await assert.rejects(act('capture',22),/ediel_source_rule_pack_basis_required/);await db.exec('reset role');checks++
 await add(23,{direction:'inbound',family:'APERAK',code:'312',related:10});await db.exec('set role service_role');const read=(await db.query('select public.gridex_read_inbound_ack_source_v1($1,$2,$3) result',[uid(1),'test',uid(23)])).rows[0].result;await db.exec('reset role');assert.deepEqual(read.sourceRulePackEvidence,first);checks++
 await add(24,{direction:'inbound',family:'APERAK',code:'312',related:11});await assert.rejects(db.exec(`set role service_role;select public.gridex_read_inbound_ack_source_v1('${uid(1)}','test','${uid(24)}')`),/ediel_historical_rule_pack_basis_unavailable/);await db.exec('reset role');checks++
 await db.exec(`update ediel_messages set raw_payload='forged wire' where id='${uid(10)}'`);await assert.rejects(act('require',10),/ediel_source_rule_pack_basis_required/);await db.exec('reset role');checks++
 await assert.rejects(db.exec('truncate gridex_ediel_source_rules.receipts'),/ediel_original_rule_pack_basis_immutable/);await assert.rejects(db.exec('delete from gridex_ediel_source_rules.receipts'),/ediel_original_rule_pack_basis_immutable/);checks++
 const acl=(await db.query("select has_function_privilege('authenticated','public.ediel_capture_source_rule_pack_basis_v1(uuid,uuid)','execute') user_rpc,has_table_privilege('service_role','gridex_ediel_source_rules.receipts','insert') direct_write")).rows[0];assert.deepEqual(acl,{user_rpc:false,direct_write:false});checks++
 await add(25,{legal:false});await db.exec('set role service_role');assert.equal((await db.query('select public.ediel_probe_source_rule_pack_capture_v1($1,$2) result',[uid(1),uid(25)])).rows[0].result.status,'historical');await db.exec('reset role');checks++
 console.log(`Focused PostgreSQL immutable original named rule/profile/guide/version/source scope/read-only ACK/ACL checks: ${checks} PASS`)
}catch(e){console.error(e.message,e.where??'');process.exitCode=1}finally{await db.close()}
