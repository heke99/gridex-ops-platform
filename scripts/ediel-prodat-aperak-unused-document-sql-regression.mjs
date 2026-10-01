// Declared mechanics only: execute the real historical lexer, generated source
// edition and NEW native guard. Existing owner/apply and actor/immutable-reader
// delegates are explicit boundary fixtures, not full native/replay evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema gridex_utilts_binding;create schema gridex_ediel_ack_guide;create schema gridex_ediel_outbound_owner;create schema gridex_ack_authority;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,raw_payload text);
 create table gridex_ediel_ack_guide.editions(source_version text primary key,input_manifest jsonb,projection jsonb);
 create table gridex_ediel_ack_guide.edition_extensions(original_source_version text primary key,extended_source_version text);
 create table gridex_ack_authority.fixture_committed(ack_id uuid primary key,company_id uuid,environment text,original_id uuid,actor_id uuid,result jsonb);
 create table gridex_ack_authority.fixture_calls(port text);
 create function gridex_ediel_outbound_owner.prepare_v1(i jsonb) returns jsonb language plpgsql as $$begin insert into gridex_ack_authority.fixture_calls values('owner');return jsonb_build_object('delegated',true);end$$;
 -- This boundary stands for the unchanged protected committed reader. It
 -- retains exact source/current actor qualification; the new wrapper must
 -- defer to it before the new contemporary predicate.
 create function gridex_ack_authority.read_committed_v1(c uuid,e text,a uuid,u uuid) returns jsonb language plpgsql as $$declare r jsonb;begin
 select result into r from gridex_ack_authority.fixture_committed where ack_id=a and company_id=c and environment=e and actor_id=u;return r;end$$;
 create function gridex_ack_authority.apply_v1(c uuid,e text,a uuid,o uuid,u uuid) returns jsonb language plpgsql as $$declare r jsonb;expected uuid;begin
 insert into gridex_ack_authority.fixture_calls values('apply');select result,original_id into r,expected from gridex_ack_authority.fixture_committed where ack_id=a and company_id=c and environment=e and actor_id=u;
 if r is not null then if expected is distinct from o then raise exception 'fixture_immutable_original_conflict';end if;return r;end if;
 return jsonb_build_object('delegated',true);end$$;`)
 const lexer=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8')
 await db.exec(lexer.slice(lexer.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),lexer.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 const raw=(bgm='BGM+++34',profile='APERAK:D:96A:UN:E2SE6A')=>`UNB+UNOC:3+LOCAL:14+REMOTE:14+260930:1200+OWN++PRODAT++++1'UNH+AP1+${profile}'${bgm}'DTM+137:202609301200:203'UNT+4+AP1'UNZ+1+OWN'`
 const insert=async(id,wire,direction='outbound')=>db.query("insert into ediel_messages values($1,$2,'test',$3,$4)",[uid(id),uid(1),direction,wire])
 // Retained pre-publication original, null-raw prospective original and an
 // already committed inbound outcome. These must not be reinterpreted.
 await insert(10,raw('BGM+APERAK+OLD-DOCUMENT+34'))
 await insert(11,null)
 await insert(20,raw('BGM+APERAK+OLD-DOCUMENT+27'),'inbound')
 await db.query("insert into gridex_ack_authority.fixture_committed values($1,$2,'test',$3,$4,$5)",[uid(20),uid(1),uid(10),uid(7),{frozen:'old-outcome'}])
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001034855_ediel_prodat_aperak_unused_document_fields.sql',import.meta.url),'utf8'))
 const guard=async(wire)=>db.query('select gridex_ediel_ack_guide.require_prodat_unused_document_v1($1)',[wire])
 for(const bgm of ['BGM+++27','BGM+++34']){await guard(raw(bgm));await insert(30+checks,raw(bgm));checks++}
 for(const bgm of ['BGM+APERAK++34','BGM++OWN-DOCUMENT+34','BGM+APERAK+OWN-DOCUMENT+27','BGM+::260++34','BGM++:SECOND+34','BGM++RELEASED?:DOCUMENT+34','BGM++ +34']){
  await assert.rejects(guard(raw(bgm)),/ediel_prodat_aperak_unused_document_element/)
  await assert.rejects(insert(50+checks,raw(bgm)),/ediel_prodat_aperak_unused_document_element/)
  await assert.rejects(db.query('select gridex_ediel_outbound_owner.prepare_v1($1)',[{rawPayload:raw(bgm)}]),/ediel_prodat_aperak_unused_document_element/)
  checks++
 }
 assert.equal((await db.query("select count(*)::int n from gridex_ack_authority.fixture_calls where port='owner'")).rows[0].n,0);checks++
 assert.deepEqual((await db.query('select gridex_ediel_outbound_owner.prepare_v1($1) r',[{rawPayload:raw()}])).rows[0].r,{delegated:true});checks++
 // Alternative UNA is observed by the same lexer. No local split parser.
 const alternate=raw('BGM++OWN-DOCUMENT+34').replaceAll('+',';').replaceAll("'",'~')
 await assert.rejects(guard(`UNA:;.! ~${alternate}`),/ediel_prodat_aperak_unused_document_element/);checks++
 await guard(raw('BGM+312+OWN-DOCUMENT+9','APERAK:D:04A:UN:E5SE5A'));checks++
 await assert.rejects(db.query('update ediel_messages set raw_payload=$1 where id=$2',[raw('BGM++NEW-DOCUMENT+34'),uid(11)]),/ediel_prodat_aperak_unused_document_element/);checks++
 assert.equal((await db.query('select raw_payload from ediel_messages where id=$1',[uid(11)])).rows[0].raw_payload,null);checks++
 await db.query('update ediel_messages set raw_payload=raw_payload where id=$1',[uid(10)]);checks++
 // Incoming raw retention is allowed; new native application must reject it
 // before the unchanged source/effect delegate is entered.
 await insert(21,raw('BGM++NEW-DOCUMENT+34'),'inbound')
 await assert.rejects(db.query('select gridex_ack_authority.apply_v1($1,$2,$3,$4,$5)',[uid(1),'test',uid(21),uid(10),uid(7)]),/ediel_prodat_aperak_unused_document_element/);checks++
 assert.equal((await db.query("select count(*)::int n from gridex_ack_authority.fixture_calls where port='apply'")).rows[0].n,0);checks++
 await insert(22,raw(),'inbound')
 assert.deepEqual((await db.query('select gridex_ack_authority.apply_v1($1,$2,$3,$4,$5) r',[uid(1),'test',uid(22),uid(10),uid(7)])).rows[0].r,{delegated:true});checks++
 assert.deepEqual((await db.query('select gridex_ack_authority.apply_v1($1,$2,$3,$4,$5) r',[uid(1),'test',uid(20),uid(10),uid(7)])).rows[0].r,{frozen:'old-outcome'});checks++
 await assert.rejects(db.query('select gridex_ack_authority.apply_v1($1,$2,$3,$4,$5)',[uid(1),'test',uid(20),uid(99),uid(7)]),/fixture_immutable_original_conflict/);checks++
 const acl=(await db.query("select has_function_privilege('authenticated','gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid)','execute') public_apply,has_function_privilege('service_role','gridex_ediel_ack_guide.require_prodat_unused_document_v1(text)','execute') private_predicate,has_function_privilege('service_role','gridex_ack_authority.apply_before_prodat_unused_document_v1(uuid,text,uuid,uuid,uuid)','execute') delegate_bypass,has_function_privilege('service_role','gridex_ack_authority.apply_v1(uuid,text,uuid,uuid,uuid)','execute') service_apply")).rows[0]
 assert.deepEqual(acl,{public_apply:false,private_predicate:false,delegate_bypass:false,service_apply:true});checks++
 // Fresh transport-specific correction: complete earlier journal behavior is
 // an explicit boundary fixture here, with its immutable-result precedence.
 // Real source/owner/journal-wrapper composition is also exercised separately.
 await db.exec(`create schema gridex_ediel_transport;create schema gridex_outbound_dispatch;
 create table public.fixture_attempts(lane text,message_id uuid,state text,primary key(lane,message_id));
 create function public.fixture_journal(i jsonb,fixture_lane text) returns jsonb language plpgsql as $$declare prior text;mid uuid:=(i->>'messageId')::uuid;begin
 select state into prior from public.fixture_attempts where message_id=mid and fixture_attempts.lane=$2;
 if(i->>'action'='prepare' and prior is not null and prior<>'released') or(i->>'action'='enter' and prior in('entered','observed')) then return jsonb_build_object('proceed',false,'scoped',true,'frozen',prior);end if;
 if i->>'action' in('prepare','enter') then insert into public.fixture_attempts values(fixture_lane,mid,case when i->>'action'='enter' then 'entered' else 'prepared' end) on conflict(lane,message_id) do update set state=excluded.state;end if;
 return jsonb_build_object('proceed',true,'scoped',coalesce(i->>'scoped','true')='true');end$$;
 create function gridex_ediel_transport.mutate_v1(i jsonb) returns jsonb language sql as $$select public.fixture_journal(i,'generic')$$;
 create function gridex_outbound_dispatch.mutate_v1(i jsonb) returns jsonb language sql as $$select public.fixture_journal(i,'h')$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001041455_ediel_prodat_aperak_fresh_transport_document_fields.sql',import.meta.url),'utf8'))
 const journal=async(lane,action,mid=10,extra={})=>db.query(`select ${lane==='generic'?'gridex_ediel_transport':'gridex_outbound_dispatch'}.mutate_v1($1) r`,[{action,companyId:uid(1),environment:'test',messageId:uid(mid),...extra}])
 for(const lane of ['generic','h']){
  await assert.rejects(journal(lane,'prepare'),/ediel_prodat_aperak_unused_document_element/)
  assert.equal((await db.query('select count(*)::int n from public.fixture_attempts where lane=$1',[lane])).rows[0].n,0);checks++
  await db.query("insert into public.fixture_attempts values($1,$2,'prepared')",[lane,uid(10)])
  assert.deepEqual((await journal(lane,'prepare')).rows[0].r,{proceed:false,scoped:true,frozen:'prepared'});checks++
  await assert.rejects(journal(lane,'enter'),/ediel_prodat_aperak_unused_document_element/)
  assert.equal((await db.query('select state from public.fixture_attempts where lane=$1 and message_id=$2',[lane,uid(10)])).rows[0].state,'prepared');checks++
  await db.query("update public.fixture_attempts set state='observed' where lane=$1 and message_id=$2",[lane,uid(10)])
  assert.deepEqual((await journal(lane,'enter')).rows[0].r,{proceed:false,scoped:true,frozen:'observed'});checks++
  assert.equal((await journal(lane,'prepare',30)).rows[0].r.proceed,true);checks++
 }
 const journalAcl=(await db.query("select has_function_privilege('service_role','gridex_ediel_transport.mutate_before_prodat_unused_document_v1(jsonb)','execute') generic_bypass,has_function_privilege('service_role','gridex_outbound_dispatch.mutate_before_prodat_unused_document_v1(jsonb)','execute') h_bypass,has_function_privilege('authenticated','gridex_ediel_transport.mutate_v1(jsonb)','execute') public_entry")).rows[0]
 assert.deepEqual(journalAcl,{generic_bypass:false,h_bypass:false,public_entry:false});checks++
 console.log(`PRODAT APERAK unused-document native guard: ${checks} declared mechanical checks passed; no full native/replay claim`)
}finally{await db.close()}
