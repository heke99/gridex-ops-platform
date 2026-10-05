// Embedded execution of the actual forward SQL and genuine common-header,
// physical scope, guide, namespace and atomic owner. Finite unrelated schema
// and later isolated selection boundary are explicit fixtures, never native.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8')
const base=read('./ediel-prodat-common-header-sql-regression.mjs').replace("console.error(error.message,error.where??'')","console.error(error.message,error.where??'',error.position??'',error.internalPosition??'',error.internalQuery??'')")
const replay=read('./ediel-outbound-ack-replay-sql-regression.mjs')
const atomic=read('./ediel-atomic-ack-sql-regression.mjs')
const extension=replay.slice(replay.indexOf('const extension=String.raw`')+27,replay.indexOf('\n`\nconst generated='))
const previous=atomic.slice(atomic.indexOf('const extra=String.raw`')+23,atomic.indexOf('\n`\nconst marker='))
assert.ok(extension.startsWith('\n // Install'));assert.ok(previous.startsWith('\n // Unrelated'))
const own=String.raw`
 const forward=readFileSync(new URL('../supabase/migrations/20261001014735_ediel_protected_prodat_ack_raw_scope_replay_v2.sql',import.meta.url),'utf8')
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930231746_ediel_native_prodat_ack_immutable_scope.sql',import.meta.url),'utf8'))
 // Actual byte-availability predicate over a finite tombstone schema. All
 // unrelated role/storage ports remain unused by the genuine common source.
 await db.exec('create schema gridex_ediel_retention;create table gridex_ediel_retention.blob_tombstones(company_id uuid,message_id uuid)')
 const retention=readFileSync(new URL('../supabase/migrations/20261001000700_ediel_message_content_and_mime_retention.sql',import.meta.url),'utf8');const byteStart=retention.indexOf('CREATE FUNCTION public.ediel_require_source_bytes_available_v1(');await db.exec(retention.slice(byteStart,retention.indexOf('$$;',byteStart)+3))
 // P16 private graph is unrelated to this common-negative scenario and the
 // later isolated selector. This declared no-op fence claims no P16 proof.
 await db.exec('create schema gridex_bilateral_prodat;create function gridex_bilateral_prodat.lock_source_receipts_v1()returns void language sql as $$select$$')
 await db.exec(forward)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001021918_ediel_ack_bilateral_receipt_graph_lock_prefix.sql',import.meta.url),'utf8'))
 await db.exec("update ediel_rule_packs set guide_revision='3'")
 await db.exec("update communication_routes set is_active=true,target_email='reply@example.invalid';update ediel_route_profiles set is_enabled=true,smtp_host='smtp.example.invalid'")
 const scopeRaw=source('BAD').replaceAll('SRCBAD','V2-SOURCE-I').replace('BGM+BAD+D+9','BGM+BAD+V2-SOURCE-D+9')
 await insert(600,scopeRaw);await syntax(600,scopeRaw);await read(600);await db.query('select gridex_ediel_technical_ack.capture_reply_v1($1,$2)',[uid(1),uid(600)])
 const scopeAck=ack().replaceAll('ACKI','V2-ACK-I').replaceAll('ACKD','V2-ACK-D').replace('RFF+ACW:D','RFF+ACW:V2-SOURCE-D')
 const scopeHash=(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[scopeRaw])).rows[0].h
 const body={...draft,rawPayload:scopeAck}
 const fresh=async()=>(await db.query('select public.ediel_create_outbound_ack_scope_atomic_v2($1,$2,$3,$4,$5,$6,$7,$8,$9) r',[uid(1),'test',uid(600),scopeHash,uid(7),'APERAK','negative',body,smtp])).rows[0].r
 const scopedRead=async(raw=scopeAck,hash=scopeHash)=>(await db.query('select public.ediel_read_outbound_ack_scope_replay_v2($1,$2,$3,$4,$5,$6,$7) r',[uid(1),'test',uid(600),hash,uid(7),'APERAK',raw])).rows[0].r
 const scopeEffects=async()=>({...await atomicEffects(),ledger:(await db.query('select count(*)::int n from gridex_ediel_ack_guide.outbound_prodat_scopes')).rows[0].n})
 const beforeScope=await scopeEffects()
 await db.exec("create function scope_fail_event()returns trigger language plpgsql as $$begin raise exception 'scope_last_event_failure';end$$;create trigger scope_fail_event before insert on ediel_message_events for each row execute function scope_fail_event()")
 await assert.rejects(fresh(),/scope_last_event_failure/);assert.deepEqual(await scopeEffects(),beforeScope);await db.exec('drop trigger scope_fail_event on ediel_message_events');checks++
 const made=await fresh();assert.equal(made.version,2);assert.equal(made.replayed,false);assert.equal(made.ackMessage.parsed_payload.ackScope,'message');assert.equal(made.ackMessage.original_transaction_id,null);assert.equal(made.requestedScopes[0].reference,'V2-SOURCE-D');checks++
 const afterScope=await scopeEffects();assert.equal(afterScope.ledger,beforeScope.ledger+1)
 // Independent RED: the previous guide wrapper tries an INSERT even when its
 // ON CONFLICT would leave counts unchanged. A replay must attempt no writes.
 await db.exec("create function reject_scope_effect()returns trigger language plpgsql as $$begin raise exception 'attempted_replay_effect';end$$;create trigger reject_scope_effect before insert or update or delete on gridex_ediel_ack_guide.outbound_prodat_scopes for each row execute function reject_scope_effect()")
 await assert.rejects(db.query('select gridex_ediel_ack_guide.require_v1(m) from ediel_messages m where id=$1',[made.ackMessage.id]),/attempted_replay_effect/);checks++
 for(const table of ['public.ediel_messages','public.ediel_message_events','gridex_ediel_common_header.negative_witnesses','gridex_ediel_ack_replay.creation_receipts'])await db.exec('create trigger reject_scope_effect before insert or update or delete on '+table+' for each row execute function reject_scope_effect()')
 await db.exec("update communication_routes set is_active=false;update ediel_route_profiles set is_enabled=false")
 const retained=await scopedRead();assert.equal(retained.ackMessage.id,made.ackMessage.id);assert.equal((await fresh()).replayed,true);assert.deepEqual(await scopeEffects(),afterScope);checks++
 await assert.rejects(scopedRead(scopeAck,'0'.repeat(64)),/actual_original_mismatch/);assert.deepEqual(await scopeEffects(),afterScope);checks++
 await db.exec('update user_permissions set is_active=false');await assert.rejects(scopedRead(),/actor_not_authorized/);await db.exec('update user_permissions set is_active=true');assert.deepEqual(await scopeEffects(),afterScope);checks++
 for(const table of ['public.ediel_messages','public.ediel_message_events','gridex_ediel_common_header.negative_witnesses','gridex_ediel_ack_replay.creation_receipts','gridex_ediel_ack_guide.outbound_prodat_scopes'])await db.exec('drop trigger reject_scope_effect on '+table)
 // Pure actual physical scopes exercise distinct source LIN indices and mixed
 // own ERC/LI outcomes. Then an explicit finite exact-qualifier boundary tests
 // the actual selection function; this is not full native owner qualification.
 const objectSource="UNB+UNOC:3+REMOTE:14+LOCAL:14+260930:1200+OBJ-SRC++23-DDQ-PRODAT++++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z04+OBJ-DOC+9+S01'NAD+FR+REMOTE:160:SVK+++++++SE'NAD+DO+LOCAL:160:SVK+++++++SE'LIN+1++POINT-A:89'RFF+LI:LI-A'LIN+2++POINT-B:89'RFF+LI:LI-B'UNT+9+M'UNZ+1+OBJ-SRC'"
 const objectAck=groups=>"UNB+UNOC:3+LOCAL:14+REMOTE:14+260930:1201+OBJ-ACK++23-DDQ-PRODAT++++1'UNH+A+APERAK:D:96A:UN:E2SE6A'BGM+APERAK+OBJ-ACK-D+34'RFF+ACW:OBJ-DOC'NAD+FR+LOCAL:160:SVK+++++++SE'NAD+DO+REMOTE:160:SVK+++++++SE'"+groups.map(([li,outcome])=>"ERC+"+(outcome==='positive'?'100':'42')+"::260'RFF+LI:"+li+"'").join('')+"UNT+"+(6+groups.length*2)+"+A'UNZ+1+OBJ-ACK'"
 const project=async raw=>(await db.query('select gridex_ediel_ack_guide.prodat_outcomes_v1($1,$2) r',[raw,objectSource])).rows[0].r
 const positive=objectAck([['LI-A','positive']]),negative=objectAck([['LI-B','negative']]),mixed=objectAck([['LI-A','positive'],['LI-B','negative']])
 const projected=await project(mixed);assert.equal(projected.length,2);assert.deepEqual(projected.map(x=>[x.physicalReference.li,x.outcome]),[['LI-A','positive'],['LI-B','negative']]);checks++
 await assert.rejects(project(objectAck([['FOREIGN','positive']])),/physical_scope_required/);await assert.rejects(project(objectAck([['LI-A','positive'],['LI-A','negative']])),/contradictory/);checks++
 await db.exec('alter function gridex_ediel_ack_replay.read_exact_v2(uuid,text,uuid,uuid,text,uuid) rename to full_owner_read_exact_v2')
 await db.exec("create function gridex_ediel_ack_replay.read_exact_v2(c uuid,env text,source_id uuid,actor uuid,family text,ack_id uuid)returns jsonb language plpgsql as $$declare s public.ediel_messages; a public.ediel_messages;begin select * into s from public.ediel_messages where id=source_id;if ack_id is null then return jsonb_build_object('sourceMessage',to_jsonb(s));end if;select * into a from public.ediel_messages where id=ack_id and company_id=c and environment=env;if a.id is null then raise exception 'finite_qualifier_denied';end if;return jsonb_build_object('sourceMessage',to_jsonb(s),'ackMessage',to_jsonb(a));end$$")
 await db.exec('drop trigger ediel_wire_reference_namespace_before_write on ediel_messages')
 await db.exec('drop trigger test_common_owner_consume on ediel_messages;drop trigger test_common_snapshot on ediel_messages;drop trigger ediel_00_lock_prodat_ack_scope on ediel_messages;drop trigger ediel_z_reserve_prodat_ack_scope on ediel_messages')
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload)values($1,$2,'test','inbound','PRODAT','Z04',$3)",[uid(700),uid(1),objectSource])
 const objectHash=(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[objectSource])).rows[0].h
 const lookup=async raw=>(await db.query('select gridex_ediel_ack_replay.read_scope_v2($1,$2,$3,$4,$5,$6,$7) r',[uid(1),'test',uid(700),objectHash,uid(7),'APERAK',raw])).rows[0].r
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,related_message_id,raw_payload,status,parsed_payload)values($1,$2,'test','outbound','APERAK','APERAK',$3,$4,'failed',$5)",[uid(701),uid(1),uid(700),mixed,{ackScope:'transaction',relatedTransactionReference:'wrong caller alias'}])
 assert.equal((await lookup(positive)).ackMessage.id,uid(701));assert.equal((await lookup(mixed)).ackMessage.id,uid(701));checks++
 await assert.rejects(lookup(objectAck([['LI-A','negative'],['LI-B','negative']])),/conflicting_outcome/);checks++
 await db.query('update ediel_messages set raw_payload=$1 where id=$2',[positive,uid(701)])
 assert.equal(await lookup(negative),null);await assert.rejects(lookup(mixed),/partially_fixed/);checks++
 await db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,related_message_id,raw_payload)values($1,$2,'test','outbound','APERAK','APERAK',$3,$4)",[uid(702),uid(1),uid(700),positive])
 await assert.rejects(lookup(positive),/ambiguous/);checks++
 const scopeAcl=(await db.query("select has_function_privilege('authenticated','public.ediel_read_outbound_ack_scope_replay_v2(uuid,text,uuid,text,uuid,text,text)','execute') user_rpc,has_function_privilege('anon','public.ediel_create_outbound_ack_scope_atomic_v2(uuid,text,uuid,text,uuid,text,text,jsonb,jsonb)','execute') anon_rpc")).rows[0];assert.deepEqual(scopeAcl,{user_rpc:false,anon_rpc:false});checks++
 console.log('Protected raw-scope actual SQL common atomic/read-only-attempt/mixed/partial/opposite/alias/ACL checks: 15 PASS; finite isolated selection port, NOT native race proof')
`
const marker=' console.log(`Focused actual common-header'
const tmp=fileURLToPath(new URL('./.ediel-prodat-protected-scope-bounded.tmp.mjs',import.meta.url))
writeFileSync(tmp,base.replace(marker,()=>extension+previous+own+marker))
try{const run=spawnSync(process.execPath,[tmp],{stdio:'inherit',env:{...process.env,EDIEL_NATIVE_ACK_GUIDE_FORWARD:fileURLToPath(new URL('../supabase/migrations/20260930204944_ediel_source_generated_native_ack_guide_constraints.sql',import.meta.url))}});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(tmp)}
