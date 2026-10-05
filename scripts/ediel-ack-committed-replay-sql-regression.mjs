// Focused embedded PostgreSQL check with minimal inherited schema stubs.
// Synthetic wire proves guards only; no native replay or market/source evidence.
import {pathToFileURL,fileURLToPath} from 'node:url'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const root=fileURLToPath(new URL('..',import.meta.url)),db=new PGlite();let count=0
const company='11111111-1111-1111-1111-111111111111',actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',original='22222222-2222-4222-8222-222222222222',ack1='33333333-3333-4333-8333-333333333333',ack2='44444444-4444-4444-8444-444444444444'
function wire(family,body,reverse=false){const seg=[`UNB+UNOC:3+${reverse?'B:ZZ:R+A:ZZ:S':'A:ZZ:S+B:ZZ:R'}+260930:1200+${reverse?'ACK-I':'SOURCE-I'}++23-DDQ-E66-T++++1`,`UNH+1+${family}`,...body];seg.push(`UNT+${body.length+2}+1`,`UNZ+1+${reverse?'ACK-I':'SOURCE-I'}`);return "UNA:+.? '"+seg.join("'")+"'"}
function source(){return wire('UTILTS:D:02B:UN:E5SE5A',['BGM+E66::260+SOURCE-D+9+AB','NAD+MS+A:SVK:260','NAD+MR+B:SVK:260','IDE+24+FIRST','IDE+24+SECOND'])}
function response(ref,positive=true){return wire('APERAK:D:04A:UN:E5SE5A',[`BGM+${positive?'312':'313'}+ACK-D+9`,'DOC+E66:SVK:260+SOURCE-D','NAD+MS+B:SVK:260','NAD+MR+A:SVK:260',`ERC+${positive?'100':'42'}::260`,`RFF+ACW:${ref}`],true)}
try{
await db.exec(`create role anon;create role authenticated;create role service_role;create schema gridex_utilts_binding;create schema gridex_received_sources;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,message_standard text default 'edifact',raw_payload text,message_received_at timestamptz,message_sent_at timestamptz,immutable_payload_hash text,immutable_rendered_at timestamptz,execution_context_snapshot jsonb default '{}',requires_contrl boolean default false,requires_aperak boolean default true,contrl_status text default 'not_required',aperak_status text default 'pending',utilts_err_status text default 'not_required',status text default 'sent',failure_reason text,failed_at timestamptz,acknowledged_at timestamptz,ack_due_at timestamptz,updated_by uuid,updated_at timestamptz,related_message_id uuid);
 create table public.user_profiles(id uuid primary key,user_status text);create table public.company_memberships(id uuid primary key,company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as $$select true$$;
 create table gridex_received_sources.sources(source_message_id uuid primary key,company_id uuid,environment text,origin text,message_code text,source_received_at timestamptz,captured_at timestamptz,raw_payload text,payload_hash text,received_context jsonb);
 create table gridex_received_sources.validation_assessments(id uuid primary key,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,facts_text text,previous_assessment_id uuid,owner text default 'canonical-runtime-with-registry-v1',facts_hash text);
 create function gridex_received_sources.fixture_hash() returns trigger language plpgsql as $$begin NEW.facts_hash:=encode(sha256(convert_to(NEW.facts_text,'UTF8')),'hex');return NEW;end$$;create trigger fixture_hash before insert on gridex_received_sources.validation_assessments for each row execute function gridex_received_sources.fixture_hash();
 create function gridex_received_sources.reject_mutation() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
 create schema gridex_ediel_inbound_context;create function gridex_ediel_inbound_context.require_ack_v1(public.ediel_messages,public.ediel_messages) returns jsonb language sql as $$select '{}'::jsonb$$;
 create table public.ediel_ack_chains(company_id uuid,source_message_id uuid,ack_message_id uuid,ack_family text,ack_scope text,transaction_reference text,outcome text);
 insert into public.user_profiles values('${actor}','active');insert into public.company_memberships values('${actor}','${company}','${actor}','active',true,now());`)
const old=fs.readFileSync(root+'/supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql','utf8');await db.exec(old.slice(old.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),old.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930170932_ediel_inbound_ack_source_atomic_authority.sql','utf8'))
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930175005_ediel_ack_read_source_admission_authority.sql','utf8'))
await db.exec(fs.readFileSync(root+'/supabase/migrations/20260930203615_ediel_ack_first14_and_committed_replay.sql','utf8'))
await db.query(`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_sent_at,immutable_rendered_at,immutable_payload_hash) values($1,$2,'test','outbound','UTILTS','E66',$3,'2026-09-30T11:00:00Z',now(),encode(sha256(convert_to($3,'UTF8')),'hex'))`,[original,company,source()])
async function receive(id,raw,accepted=true){await db.query(`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at,status) values($1,$2,'test','inbound','APERAK','312',$3,'2026-09-30T12:00:00Z','received')`,[id,company,raw]);if(accepted)await db.query(`insert into gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,previous_assessment_id) select $1,id,company_id,environment,immutable_payload_hash,'{"syntaxDecision":"accepted","applicationDecision":"accepted","functionalDecision":"accepted"}',null from public.ediel_messages where id=$1`,[id])}
async function apply(id=ack1,src=original,cmp=company){await db.exec('set role service_role');try{return(await db.query('select public.gridex_apply_inbound_ack_source_v1($1,$2,$3,$4,$5) result',[cmp,'test',id,src,actor])).rows[0].result}finally{await db.exec('reset role')}}
async function rejects(fn,pattern){await assert.rejects(fn,pattern);count++}
await receive(ack1,response('FIRST'))
await db.exec('set role service_role');try{assert.equal((await db.query('select public.gridex_read_inbound_ack_source_v1($1,$2,$3) result',[company,'test',ack1])).rows[0].result.sourceMessage.id,original);count++}finally{await db.exec('reset role')}
let first=await apply();assert.equal(first.finalAckReached,false);assert.equal(first.sourceAccepted,false);assert.equal(first.sourceMessage.aperak_status,'pending');count++
let retry=await apply();assert.equal(retry.idempotent,true);assert.equal((await db.query('select count(*) c from gridex_ack_authority.source_correlations')).rows[0].c,1);count++
await receive(ack2,response('SECOND'));let complete=await apply(ack2);assert.equal(complete.finalAckReached,true);assert.equal(complete.sourceAccepted,true);assert.equal(complete.sourceMessage.status,'acknowledged');count++
const contradictory='55555555-5555-4555-8555-555555555555';await receive(contradictory,response('FIRST',false));await rejects(()=>apply(contradictory),/immutable_scope_outcome_conflict/)
assert.equal((await db.query('select count(*) c from gridex_ack_authority.source_correlations')).rows[0].c,2);count++
await rejects(()=>db.query("update gridex_ack_authority.source_correlations set ack_outcome='negative'"),/immutable/)
await rejects(()=>db.query("update public.ediel_messages set raw_payload='other' where id=$1",[ack1]),/immutable_received_ack_source/)
const unsupported='66666666-6666-4666-8666-666666666666';await receive(unsupported,response('FIRST'),false);await rejects(()=>apply(unsupported),/current_canonical_acceptance/)
const duplicate='77777777-7777-4777-8777-777777777777';await db.query('insert into public.ediel_messages select $1,company_id,environment,direction,message_family,message_code,message_standard,raw_payload,message_received_at,message_sent_at,immutable_payload_hash,immutable_rendered_at,execution_context_snapshot,requires_contrl,requires_aperak,contrl_status,aperak_status,utilts_err_status,status,failure_reason,failed_at,acknowledged_at,ack_due_at,updated_by,updated_at,related_message_id from public.ediel_messages where id=$2',[duplicate,original]);assert.equal((await apply()).idempotent,true);count++
await db.exec('set role service_role');try{assert.equal((await db.query('select public.gridex_read_inbound_ack_source_v1($1,$2,$3) result',[company,'test',ack1])).rows[0].result,null);count++}finally{await db.exec('reset role')}
const freshDuplicateAck='77777777-aaaa-4777-8777-777777777777';await receive(freshDuplicateAck,response('FIRST'));await rejects(()=>apply(freshDuplicateAck),/physical_original_ambiguous/);
await db.query('delete from public.ediel_messages where id=$1',[duplicate])
const foreign='88888888-8888-4888-8888-888888888888';await receive(foreign,response('ABSENT'));await rejects(()=>apply(foreign),/physical_original_scope_mismatch/)
await rejects(()=>apply(ack1,original,null),/execution_scope_required/)
await db.exec('set role authenticated');try{await rejects(()=>db.query('select public.gridex_apply_inbound_ack_source_v1($1,$2,$3,$4,$5)',[company,'test',ack1,original,actor]),/permission denied/)}finally{await db.exec('reset role')}
const mixedOriginal='99999999-9999-4999-8999-999999999999',mixedAckA='aaaaaaaa-bbbb-4aaa-8aaa-aaaaaaaaaaaa',mixedAckB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const mixedRaw=source().replace('SOURCE-D','MIXED-D')
await db.query(`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_sent_at,immutable_rendered_at,immutable_payload_hash) values($1,$2,'test','outbound','UTILTS','E66',$3,'2026-09-30T11:00:00Z',now(),encode(sha256(convert_to($3,'UTF8')),'hex'))`,[mixedOriginal,company,mixedRaw])
await receive(mixedAckA,response('FIRST',false).replace('SOURCE-D','MIXED-D'));const partial=await apply(mixedAckA,mixedOriginal);assert.equal(partial.wholeSourceRejected,false);assert.equal(partial.finalAckReached,false);assert.equal(partial.sourceMessage.status,'sent');count++
await receive(mixedAckB,response('SECOND').replace('SOURCE-D','MIXED-D'));const answered=await apply(mixedAckB,mixedOriginal);assert.equal(answered.finalAckReached,true);assert.equal(answered.sourceAccepted,false);assert.equal(answered.sourceMessage.aperak_status,'received');assert.equal(answered.sourceMessage.status,'sent');count++
const pSource='cccccccc-cccc-4ccc-8ccc-cccccccccccc',pAck='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const pRaw=wire('PRODAT:D:96A:UN:E2SE6A',['BGM+Z03+P-DOC+9+AB','NAD+FR+A:160:SVK','NAD+DO+B:160:SVK','LIN+1','RFF+LI:P-A','LIN+2','RFF+LI:P-B'])
await db.query(`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_sent_at,immutable_rendered_at,immutable_payload_hash) values($1,$2,'test','outbound','PRODAT','Z03',$3,'2026-09-30T11:00:00Z',now(),encode(sha256(convert_to($3,'UTF8')),'hex'))`,[pSource,company,pRaw])
await receive(pAck,wire('APERAK:D:96A:UN:E2SE6A',['BGM+12+P-ACK+34','RFF+ACW:P-DOC','NAD+FR+B:160:SVK','NAD+DO+A:160:SVK','ERC+100::260','RFF+LI:P-A','ERC+42::260','RFF+LI:P-B'],true));const pMixed=await apply(pAck,pSource);assert.equal(pMixed.finalAckReached,true);assert.equal(pMixed.sourceAccepted,false);assert.equal(pMixed.wholeSourceRejected,false);assert.deepEqual(pMixed.scopeOutcomes,[{reference:'P-A',outcome:'positive'},{reference:'P-B',outcome:'negative'}]);count++
// Source-owned assessed outcome replay remains immutable after a newer leaf;
// no current role/guide decision can silently reinterpret this same receipt.
await db.query(`insert into gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,previous_assessment_id) values('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',$1,$2,'test',(select immutable_payload_hash from public.ediel_messages where id=$1),'{}',$1)`,[ack1,company]);assert.equal((await apply()).idempotent,true);count++

async function readCommitted(id=ack1,cmp=company,usr=actor){await db.exec('set role service_role');try{return(await db.query("select public.gridex_read_committed_inbound_ack_v1($1,'test',$2,$3) r",[cmp,id,usr])).rows[0].r}finally{await db.exec('reset role')}}
const replay=await readCommitted();assert.equal(replay.kind,'exact_receipt');assert.deepEqual(replay.result,first);assert.equal(replay.result.sourceAccepted,false);count++;
// The second sibling completed later. Replaying FIRST must preserve FIRST's
// actual partial result, not replace it with current whole-source approval.
assert.equal((await apply()).sourceAccepted,false);count++;
await rejects(()=>readCommitted(ack1,'99999999-1111-4111-8111-111111111111'),/immutable_correlation_conflict/);
await db.query("update public.user_profiles set user_status='inactive' where id=$1",[actor]);await rejects(()=>readCommitted(),/actor_unqualified/);await db.query("update public.user_profiles set user_status='active' where id=$1",[actor]);
const legacy='ffffffff-ffff-4fff-8fff-ffffffffffff';await receive(legacy,response('FIRST'));
await db.query('insert into gridex_ack_authority.source_correlations select $1,source_message_id,company_id,environment,(select immutable_payload_hash from public.ediel_messages where id=$1),source_payload_hash,$1,ack_family,ack_outcome,ack_scope,acknowledged_references,scope_outcomes,correlated_at,actor_user_id from gridex_ack_authority.source_correlations where ack_message_id=$2',[legacy,ack1]);
const historic=await readCommitted(legacy);assert.equal(historic.kind,'legacy_diagnostic');assert.equal(historic.summaryUnavailable,true);assert.equal('sourceAccepted' in historic,false);count++;
await rejects(()=>db.exec('update gridex_ack_authority.applied_receipts set result=result'),/immutable/);
const match=(await db.query("select gridex_ack_authority.source_match_v1($1,$2) b",[{family:'CONTRL',sender:['B'],receiver:['A'],environment:'test',app:'APP',uciRef:'12345678901234',uciSender:['A'],uciReceiver:['B'],ucm:[]},{family:'PRODAT',sender:['A'],receiver:['B'],environment:'test',app:'APP',interchange:'12345678901234LONG',unhRef:'1'}])).rows[0].b;assert.equal(match,true);count++;

const longSource='abababab-abab-4aba-8aba-abababababab',longAck='bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc',longCollision='cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd',longFreshAck='dededede-dede-4ded-8ded-dededededede';
const longRaw=source().replaceAll('SOURCE-I','12345678901234LONG-A');
await db.query(`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_sent_at,immutable_rendered_at,immutable_payload_hash) values($1,$2,'test','outbound','UTILTS','E66',$3,'2026-09-30T11:00:00Z',now(),encode(sha256(convert_to($3,'UTF8')),'hex'))`,[longSource,company,longRaw]);
async function receiveContrl(id){const raw=wire('CONTRL:2:2:UN',['UCI+12345678901234+A:ZZ:S+B:ZZ:R+1'],true);await db.query(`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at,status) values($1,$2,'test','inbound','CONTRL','CONTRL',$3,'2026-09-30T12:00:00Z','received')`,[id,company,raw]);await db.query(`insert into gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,previous_assessment_id) select id,id,company_id,environment,immutable_payload_hash,'{"syntaxDecision":"accepted","applicationDecision":"accepted","functionalDecision":"accepted"}',null from public.ediel_messages where id=$1`,[id]);}
await receiveContrl(longAck);const own14=await apply(longAck,longSource);assert.equal(own14.scope,'interchange');assert.equal(own14.outcome,'positive');count++;
await db.query(`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_sent_at,immutable_rendered_at,immutable_payload_hash) values($1,$2,'test','outbound','UTILTS','E66',$3,'2026-09-30T11:00:00Z',now(),encode(sha256(convert_to($3,'UTF8')),'hex'))`,[longCollision,'aaaaaaaa-1111-4111-8111-111111111111',longRaw.replaceAll('LONG-A','LONG-B')]);
await receiveContrl(longFreshAck);await rejects(()=>apply(longFreshAck,longSource),/physical_original_ambiguous/);
assert.equal((await readCommitted(longAck)).kind,'exact_receipt');assert.equal((await apply(longAck,longSource)).idempotent,true);count++;
console.log(`Focused PostgreSQL ACK first14/receipt/replay/source/atomic/immutable/ACL checks: ${count} PASS`)
}catch(error){console.error(error.message,error.code);process.exitCode=1}finally{await db.close()}
