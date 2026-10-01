// Declared mechanics: SAME historical lexer, prior ENV03 layer and NEW
// generated national UNH predicate/wrappers. Actor, source/registry, journal,
// immutable reader and private fixture registration are named boundary fixtures.
// No native replay, whole UNSM, provider, concurrency or authentic case claim.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite(),uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
const company=uid(1),actor=uid(7),profiles=['PRODAT:D:97A:UN:E2SE6A','APERAK:D:96A:UN:E2SE6A','PRODAT:D:97A:UN:E2SE6B','APERAK:D:96A:UN:E2SE6B']
const raw=(profile=profiles[0],extra='')=>`UNB+UNOC:3+LOCAL:14+REMOTE:14+261001:1200+OWN++PRODAT++++1'UNH+1+${profile}${extra}'BGM+Z01+DOCUMENT+9'UNT+3+1'UNZ+1+OWN'`
const insert=(id,wire,direction='outbound',snapshot={})=>db.query("insert into ediel_messages(id,company_id,environment,direction,message_code,raw_payload,execution_context_snapshot) values($1,$2,'test',$3,'Z01',$4,$5)",[uid(id),company,direction,wire,snapshot])
let checks=0
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema gridex_utilts_binding;create schema gridex_ediel_ack_guide;create schema gridex_ediel_outbound_owner;create schema gridex_ediel_transport;create schema gridex_outbound_dispatch;create schema gridex_received_sources;create schema gridex_ack_authority;create schema gridex_negative_fixtures;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_code text,raw_payload text,execution_context_snapshot jsonb);
 create table gridex_ack_authority.fixture_calls(port text);
 create table gridex_received_sources.fixture_sources(id uuid primary key,company_id uuid,environment text,payload_hash text);
 create table gridex_ack_authority.fixture_committed(ack_id uuid primary key,company_id uuid,environment text,original_id uuid,actor_id uuid,result jsonb);
 create table gridex_negative_fixtures.negative_prepared_witnesses(id uuid primary key,actor_user_id uuid,company_id uuid,raw text,qualification jsonb,current boolean default true,consumed_message uuid);
 create function gridex_negative_fixtures.prepared_negative_fixture_v1(c uuid,w uuid,r text,a uuid) returns jsonb language plpgsql as $$declare q jsonb;begin
 select qualification into q from gridex_negative_fixtures.negative_prepared_witnesses where id=w and company_id=c and actor_user_id=a and raw=r and current and consumed_message is null;
 if q is null then raise exception 'fixture_prepared_current_source_required';end if;return q;end$$;
 create function gridex_negative_fixtures.require_negative_message_v1(c uuid,m uuid,code text) returns jsonb language plpgsql as $$declare q jsonb;begin
 select w.qualification into q from gridex_negative_fixtures.negative_prepared_witnesses w join public.ediel_messages p on p.id=m and p.company_id=c and p.raw_payload=w.raw and p.execution_context_snapshot->>'sourceQualifiedNegativeFixtureWitnessId'=w.id::text where w.company_id=c and w.consumed_message=m and w.current and p.message_code=code;
 if q is null then raise exception 'fixture_consumed_current_source_required';end if;return q;end$$;
 create function gridex_ediel_outbound_owner.prepare_v1(i jsonb) returns jsonb language plpgsql as $$begin insert into gridex_ack_authority.fixture_calls values('owner');return '{"delegated":true}'::jsonb;end$$;
 create function gridex_ediel_transport.mutate_v1(i jsonb) returns jsonb language plpgsql as $$begin
 if i->>'fixed'='true' then return '{"proceed":false,"fixed":"immutable"}'::jsonb;end if;
 insert into gridex_ack_authority.fixture_calls values('generic');return '{"proceed":true}'::jsonb;end$$;
 create function gridex_outbound_dispatch.mutate_v1(i jsonb) returns jsonb language plpgsql as $$begin
 if i->>'fixed'='true' then return '{"scoped":true,"proceed":false,"fixed":"immutable"}'::jsonb;end if;
 if i->>'scoped'='false' then return '{"scoped":false}'::jsonb;end if;
 insert into gridex_ack_authority.fixture_calls values('h');return '{"scoped":true,"proceed":true}'::jsonb;end$$;
 create function gridex_received_sources.append_validation(p_company_id uuid,p_environment text,p_source_message_id uuid,p_source_payload_hash text,p_facts_text text) returns jsonb language plpgsql as $$begin
 if not exists(select from gridex_received_sources.fixture_sources s where s.id=p_source_message_id and s.company_id=p_company_id and s.environment=p_environment and s.payload_hash=p_source_payload_hash)then raise exception 'fixture_retained_source_scope_required';end if;
 insert into gridex_ack_authority.fixture_calls values('append');return '{"assessment":"new"}'::jsonb;end$$;
 create function gridex_ack_authority.read_committed_v1(c uuid,e text,a uuid,u uuid) returns jsonb language sql as $$select result from gridex_ack_authority.fixture_committed where ack_id=a and company_id=c and environment=e and actor_id=u$$;
 create function gridex_ack_authority.apply_v1(c uuid,e text,a uuid,o uuid,u uuid) returns jsonb language plpgsql as $$declare p gridex_ack_authority.fixture_committed%rowtype;begin
 select * into p from gridex_ack_authority.fixture_committed where ack_id=a and company_id=c and environment=e and actor_id=u;
 if p.result is not null then if p.original_id is distinct from o then raise exception 'fixture_immutable_original_conflict';end if;return p.result;end if;
 insert into gridex_ack_authority.fixture_calls values('apply');return '{"applied":"new"}'::jsonb;end$$;`)
 const lexer=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8')
 await db.exec(lexer.slice(lexer.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),lexer.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))

 // Protected old originals/results predate both prospective guards.
 await insert(10,raw(profiles[1],'+COMMON+1:1'));await insert(20,raw(profiles[1],'+COMMON+1:1'),'inbound');await insert(11,null)
 await db.query('insert into gridex_ack_authority.fixture_committed values($1,$2,\'test\',$3,$4,$5)',[uid(20),company,uid(10),actor,{fixed:'old'}])
 for(const migration of ['20261001044856_ediel_source_profile_message_reference_bounds.sql','20261001053253_ediel_source_owned_unused_unh_elements.sql'])await db.exec(readFileSync(new URL('../supabase/migrations/'+migration,import.meta.url),'utf8'))
 const guard=(wire,direction='outbound')=>db.query('select gridex_ediel_ack_guide.require_unused_unh_v1($1,$2)',[wire,direction])
 let next=30
 for(const profile of profiles){
  await guard(raw(profile));await insert(next++,raw(profile));checks++
  for(const extra of ['+COMMON','++1:1','+:COMPONENT','++:1','+ +']){
   await assert.rejects(guard(raw(profile,extra)),/ediel_unh_unused_element/)
   await assert.rejects(insert(next++,raw(profile,extra)),/ediel_unh_unused_element/);checks++
  }
  if(profile.startsWith('PRODAT:')){await guard(raw(profile,'+COMMON+1:1'),'inbound');checks++}
  else{await assert.rejects(guard(raw(profile,'+COMMON+1:1'),'inbound'),/ediel_unh_unused_element/);checks++}
 }
 await guard(raw(profiles[1],'++:'));checks++
 await assert.rejects(guard(`UNA*;.! ~UNB;UNOC*3;LOCAL*14;REMOTE*14;261001*1200;OWN;;PRODAT;;;;1~UNH;1;${profiles[1].replaceAll(':','*')};!+;*1~BGM;Z01;DOCUMENT;9~UNT;3;1~UNZ;1;OWN~`),/ediel_unh_unused_element/);checks++
 for(const type of ['UTILTS:D:02B:UN:E5SE5A','APERAK:D:04A:UN:E5SE5A','CONTRL:2:2:UN:EDIEL2']){await guard(raw(type,'+COMMON+1:1'));checks++}
 await assert.rejects(guard(raw().replace("UNT+3+1'",`UNT+3+1'UNH+2+${profiles[1]}+COMMON'BGM+++27'UNT+3+2'`),'inbound'),/ediel_unh_unused_element/);checks++
 await assert.rejects(db.query('update ediel_messages set raw_payload=$1 where id=$2',[raw(profiles[1],'+COMMON'),uid(11)]),/ediel_unh_unused_element/)
 assert.equal((await db.query('select raw_payload from ediel_messages where id=$1',[uid(11)])).rows[0].raw_payload,null);checks++
 await db.query('update ediel_messages set raw_payload=raw_payload where id=$1',[uid(10)]);checks++
 const bad=raw(profiles[1],'+COMMON'),q={kind:'source_qualified_negative_fixture',expectedOutcome:'negative',authorizesBusinessEffect:false,expectedDiagnosticCodes:['EDIEL_UNH_UNUSED_ELEMENT']}
 const preparedInput={companyId:company,actorUserId:actor,environment:'test',rawPayload:bad,sourceQualifiedNegativeFixtureWitnessId:uid(100)}
 await assert.rejects(db.query('select gridex_ediel_outbound_owner.prepare_v1($1)',[{...preparedInput,qualification:q,rulebookAllowInvalidSend:true}]),/fixture_prepared_current_source_required/);checks++
 await db.query('insert into gridex_negative_fixtures.negative_prepared_witnesses(id,actor_user_id,company_id,raw,qualification) values($1,$2,$3,$4,$5)',[uid(100),actor,company,bad,q])
 assert.deepEqual((await db.query('select gridex_ediel_outbound_owner.prepare_v1($1) r',[preparedInput])).rows[0].r,{delegated:true});checks++
 await insert(101,bad,'outbound',{sourceQualifiedNegativeFixtureWitnessId:uid(100)});checks++
 await db.query('update gridex_negative_fixtures.negative_prepared_witnesses set consumed_message=$1 where id=$2',[uid(101),uid(100)])
 const mutation=(schema,message,fixed=false)=>db.query(`select ${schema}.mutate_v1($1) r`,[{companyId:company,messageId:uid(message),environment:'test',action:'prepare',fixed}])
 for(const schema of ['gridex_ediel_transport','gridex_outbound_dispatch']){
  assert.equal((await mutation(schema,10,true)).rows[0].r.proceed,false);checks++
  const before=(await db.query('select count(*)::int n from gridex_ack_authority.fixture_calls')).rows[0].n
  await assert.rejects(mutation(schema,10),/ediel_unh_unused_element/)
  assert.equal((await db.query('select count(*)::int n from gridex_ack_authority.fixture_calls')).rows[0].n,before);checks++
  assert.equal((await mutation(schema,101)).rows[0].r.proceed,true);checks++
 }
 await db.exec("update gridex_negative_fixtures.negative_prepared_witnesses set qualification=jsonb_set(qualification,'{expectedDiagnosticCodes}','[\"another_error\"]')")
 await assert.rejects(mutation('gridex_ediel_transport',101),/ediel_unh_unused_element/);checks++
 for(const [id,profile] of [[21,profiles[0]],[22,profiles[1]]]){
  await insert(id,raw(profile,'+COMMON+1:1'),'inbound')
  await db.query("insert into gridex_received_sources.fixture_sources select id,$1,environment,encode(sha256(convert_to(raw_payload,'UTF8')),'hex') from public.ediel_messages where id=$2",[company,uid(id)])
 }
 const append=async(message,syntax='accepted',application='accepted')=>db.query('select gridex_received_sources.append_validation($1,$2,$3,$4,$5) r',[company,'test',uid(message),(await db.query('select payload_hash h from gridex_received_sources.fixture_sources where id=$1',[uid(message)])).rows[0].h,JSON.stringify({syntaxDecision:syntax,applicationDecision:application})])
 // P119: ignored received PRODAT X is accepted only by unchanged other owners.
 assert.deepEqual((await append(21)).rows[0].r,{assessment:'new'});checks++
 const before=(await db.query("select count(*)::int n from gridex_ack_authority.fixture_calls where port='append'")).rows[0].n
 await assert.rejects(append(22),/ediel_unh_unused_element/)
 assert.equal((await db.query("select count(*)::int n from gridex_ack_authority.fixture_calls where port='append'")).rows[0].n,before);checks++
 assert.deepEqual((await append(22,'accepted','rejected')).rows[0].r,{assessment:'new'});checks++
 assert.deepEqual((await append(22,'rejected','not_applicable')).rows[0].r,{assessment:'new'});checks++
 const apply=(a,o=10)=>db.query('select gridex_ack_authority.apply_v1($1,$2,$3,$4,$5) r',[company,'test',uid(a),uid(o),actor])
 assert.deepEqual((await apply(20)).rows[0].r,{fixed:'old'});checks++
 await assert.rejects(apply(20,99),/fixture_immutable_original_conflict/);checks++
 await assert.rejects(apply(22),/ediel_unh_unused_element/);checks++
 await insert(23,raw(profiles[1]),'inbound');assert.deepEqual((await apply(23)).rows[0].r,{applied:'new'});checks++
 const acl=(await db.query("select has_function_privilege('service_role','gridex_ediel_transport.mutate_v1(jsonb)','execute') new_port,has_function_privilege('service_role','gridex_ediel_transport.mutate_before_unused_unh_v1(jsonb)','execute') old_bypass,has_function_privilege('service_role','gridex_ediel_ack_guide.require_unused_unh_v1(text,text,jsonb)','execute') predicate_bypass,has_function_privilege('authenticated','gridex_received_sources.append_validation(uuid,text,uuid,text,text)','execute') public_append")).rows[0]
 assert.deepEqual(acl,{new_port:true,old_bypass:false,predicate_bypass:false,public_append:false});checks++
 console.log(`Unused P UNH guide: ${checks} declared composed mechanical checks passed; no full native/replay/authentic fixture claim`)
}finally{await db.close()}
