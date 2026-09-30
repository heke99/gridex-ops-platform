// Actual forward common-header/one-use/source binding with explicit journal and
// full native-guide boundary fixtures; this is not native or replay evidence.
import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const nativeGuide=process.env.EDIEL_NATIVE_ACK_GUIDE_FORWARD;const db=new PGlite();const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;let checks=0
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema gridex_utilts_binding;create schema gridex_received_sources;create schema gridex_ediel_inbound_context;create schema gridex_ediel_source_rules;create schema gridex_ediel_wire_namespace;create schema gridex_ediel_transport;
 create table public.ediel_messages(id uuid primary key,company_id uuid,environment text,direction text,message_family text,message_code text,raw_payload text,message_received_at timestamptz,message_sent_at timestamptz,related_message_id uuid,canonical_rule_pack_id uuid,rule_profile_version_id uuid,rule_profile_key text,rule_profile_version text,rule_pack_checksum text,rule_pack_snapshot jsonb,immutable_payload_hash text,immutable_rendered_at timestamptz);
 create table public.tenant_actor_identifiers(id uuid,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 create table public.tenant_counterparty_relations(id uuid,company_id uuid,environment text,counterparty_actor_id uuid,relation_type text,is_enabled boolean,valid_from timestamptz,valid_to timestamptz);
 create table public.platform_actor_identifiers(id uuid,actor_id uuid,identifier_type text,identifier_value text,valid_from date,valid_to date);
 create table public.ediel_message_profiles(id uuid primary key,rule_pack_id uuid,profile_key text,message_code text,transaction_subtype text,direction text,is_enabled boolean,profile jsonb);
 create table public.ediel_rule_packs(id uuid primary key,family text,market text,source_hash text,status text,valid_from date,valid_to date,guide_version text,guide_revision text);
 create table public.ediel_rule_pack_sources(id uuid primary key,rule_pack_id uuid,source_hash text,title text);
 create table public.ediel_rule_pack_snapshots(company_id uuid,ediel_message_id uuid unique,profile_key text,rule_profile_version_id uuid,profile_version text,checksum text,snapshot jsonb);
 create table gridex_received_sources.validation_assessments(id uuid primary key,source_message_id uuid,company_id uuid,environment text,source_payload_hash text,previous_assessment_id uuid,owner text,facts_text text,facts_hash text);
 create table gridex_ediel_source_rules.receipts(source_message_id uuid primary key,company_id uuid,environment text,direction text,payload_sha256 text,canonical_assessment_id uuid,original_source_message_id uuid,evidence jsonb);
 create table gridex_ediel_inbound_context.receipts(source_message_id uuid primary key,context jsonb);
 create function gridex_ediel_inbound_context.require_v1(uuid,uuid) returns jsonb language plpgsql as $$declare c jsonb;begin select context into c from gridex_ediel_inbound_context.receipts where source_message_id=$2;if c is null then raise exception 'ediel_historical_identity_basis_unavailable';end if;return c;end$$;
 create function gridex_ediel_source_rules.require_v1(uuid,uuid) returns jsonb language plpgsql as $$declare e jsonb;begin select evidence into e from gridex_ediel_source_rules.receipts where source_message_id=$2 and company_id=$1;if e is null then raise exception 'ediel_historical_rule_pack_basis_unavailable';end if;return e;end$$;
 create table gridex_ediel_transport.attempts(id uuid primary key,message_id uuid,company_id uuid,environment text,actor_user_id uuid,binding jsonb);
 create table gridex_ediel_transport.reservations(message_id uuid primary key,attempt_id uuid,state text);
 create table public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 create table public.user_profiles(id uuid,user_status text);
 create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select true';
 create function gridex_ediel_transport.mutate_v1(i jsonb) returns jsonb language plpgsql as $$begin
 if i->>'action'='prepare' then insert into gridex_ediel_transport.attempts values((i->>'attemptId')::uuid,(i->>'messageId')::uuid,(i->>'companyId')::uuid,i->>'environment',(i->>'actorUserId')::uuid,i->'binding');insert into gridex_ediel_transport.reservations values((i->>'messageId')::uuid,(i->>'attemptId')::uuid,'prepared');end if;
 return jsonb_build_object('proceed',true);end$$;
 insert into tenant_actor_identifiers values('${uid(4)}','${uid(1)}','test','${uid(2)}','EdielId','LOCAL','2000-01-01',null);
 insert into company_memberships values('${uid(1)}','${uid(7)}','active',true,now());insert into user_profiles values('${uid(7)}','active');
 insert into ediel_rule_packs values('${uid(100)}','UTILTS','electricity',repeat('a',64),'active','2000-01-01',null,'25.A','3');
 insert into ediel_message_profiles values('${uid(101)}','${uid(100)}','DB:E66','E66','','both',true,'{"exact":"source"}');
 insert into ediel_rule_pack_sources values('${uid(102)}','${uid(100)}',repeat('b',64),'actual guide');`)
 const inherited=readFileSync(new URL('../supabase/migrations/20260923135706_ediel_utilts_consumption_binding_v1.sql',import.meta.url),'utf8')
 await db.exec(inherited.slice(inherited.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),inherited.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))

 await db.exec(`alter table ediel_messages add execution_context_snapshot jsonb;alter table ediel_rule_packs add unh_association_code text;
 create schema gridex_ack_authority;create schema gridex_ediel_outbound_owner;
 create table gridex_ediel_outbound_owner.witnesses(id uuid,company_id uuid,environment text,payload_sha256 text,evidence jsonb);create table gridex_ediel_outbound_owner.consumptions(witness_id uuid,source_message_id uuid,company_id uuid,environment text,payload_sha256 text);
 delete from ediel_rule_packs;insert into ediel_rule_packs values('${uid(100)}','PRODAT','electricity',repeat('p',64),'active','2026-04-01',null,'26.A','3','E2SE6A');`)
 const ackOwner=readFileSync(new URL('../supabase/migrations/20260930170932_ediel_inbound_ack_source_atomic_authority.sql',import.meta.url),'utf8');await db.exec(ackOwner.slice(ackOwner.indexOf('CREATE FUNCTION gridex_ack_authority.wire_v1'),ackOwner.indexOf('CREATE TABLE gridex_ack_authority.scope_outcomes')))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930184410_ediel_protected_technical_contrl_source_basis.sql',import.meta.url),'utf8'))
 if(nativeGuide){const actual=readFileSync(nativeGuide,'utf8');await db.exec(`create function gridex_received_sources.reject_mutation()returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;`);await db.exec(actual.slice(0,actual.indexOf('ALTER FUNCTION gridex_ediel_source_rules.capture_v1'))+'COMMIT;')}
 else await db.exec(`create schema gridex_ediel_ack_guide;create table gridex_ediel_ack_guide.calls(kind text,source_id uuid,basis jsonb);create function gridex_ediel_ack_guide.bind_source_v1(public.ediel_messages,text,jsonb)returns void language plpgsql as $$begin insert into gridex_ediel_ack_guide.calls values($2,($1).id,$3);end$$;create function gridex_ediel_ack_guide.require_v1(public.ediel_messages)returns void language plpgsql as $$begin if not exists(select from gridex_ediel_ack_guide.calls where source_id=($1).related_message_id and kind='common')then raise exception 'native_guide_boundary_missing';end if;end$$;`)
 const source=code=>`UNB+UNOC:3+REMOTE:14+LOCAL:14+260930:1200+SRC${code||'NONE'}++23-DDQ-PRODAT++++1'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+${code}+D+9+AB'NAD+FR+REMOTE:160:SVK+++++++SE'NAD+DO+LOCAL:160:SVK+++++++SE'UNT+5+M'UNZ+1+SRC${code||'NONE'}'`
 const insert=async(id,raw,company=1)=>db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,message_received_at)values($1,$2,'test','inbound','PRODAT','UNKNOWN',$3,'2026-09-30T12:00:00Z')",[uid(id),company===null?null:uid(company),raw])
 await insert(9,source('BAD'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930205320_ediel_prodat_common_header_rejection_authority.sql',import.meta.url),'utf8'));checks++
 await db.exec('create trigger test_common_owner_consume after insert on ediel_messages for each row execute function gridex_ediel_outbound_owner.consume();create trigger test_common_snapshot after insert on ediel_messages for each row execute function public.gridex_capture_ediel_rule_pack_snapshot()')
 const read=async(id,c=1)=>(await db.query('select gridex_ediel_common_header.read_v1($1,$2,$3) r',[uid(c),'test',uid(id)])).rows[0].r
 await assert.rejects(read(9),/ediel_historical_common_header_basis_unavailable/);await db.query('update ediel_messages set raw_payload=raw_payload where id=$1',[uid(9)]);await assert.rejects(read(9),/ediel_historical_common_header_basis_unavailable/);checks++
 const syntax=async(id,raw,decision='accepted')=>db.query('select gridex_ediel_technical_ack.record_syntax_v1($1,$2,$3,$4)',[uid(1),uid(id),(await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') h",[raw])).rows[0].h,JSON.stringify({version:1,owner:'canonical-runtime-syntax-v1',syntaxDecision:decision,reasonCodes:[]})])
 await insert(10,source('BAD'));await assert.rejects(read(10),/ediel_common_header_rejection_basis_required/);checks++
 await syntax(10,source('BAD'));const r=await read(10);assert.deepEqual(r.evidence.field202,{fieldCode:'202',ercCode:'42',text:'Felaktigt Meddelandenamn BAD'});assert.equal(r.evidence.authorizesBusinessEffect,false);assert.equal(Object.hasOwn(r.evidence.familyEdition,'messageProfile'),false);checks++
 await assert.rejects(read(10,99),/ediel_common_header_rejection_basis_required/);checks++
 const ack=(code='42',text='Felaktigt Meddelandenamn BAD')=>`UNB+UNOC:3+LOCAL:14+REMOTE:14+260930:1200+ACKI++23-DDQ-PRODAT++++1'UNH+A+APERAK:D:96A:UN:E2SE6A'BGM+APERAK+ACKD+27'DTM+137:202609301200:203'RFF+ACW:D'NAD+FR+LOCAL:160:SVK+++++++SE'NAD+DO+REMOTE:160:SVK+++++++SE'ERC+${code}::260'FTX+AAO++202::260+${text}'UNT+9+A'UNZ+1+ACKI'`
 const prepare=async(raw=ack(),actor=7)=>(await db.query('select gridex_ediel_common_header.prepare_v1($1,$2,$3,$4,$5) r',[uid(1),'test',uid(10),uid(actor),raw])).rows[0].r
 await assert.rejects(prepare(ack(),99),/ediel_tenant_actor_forbidden/);checks++
 for(const raw of [ack('100','OK'),ack().replace('202::260','226::260'),ack().replace('Felaktigt Meddelandenamn BAD','Felaktigt Meddelandenamn OTHER'),ack().replace('BGM+APERAK+ACKD+27','BGM+APERAK+ACKD+34'),ack().replace('NAD+FR+LOCAL','NAD+FR+OTHER'),ack().replace('23-DDQ-PRODAT','DEFAULT'),ack().replace('RFF+ACW:D','RFF+ACW:FOREIGN')]){await assert.rejects(prepare(raw),/ediel_common_header_negative_scope_invalid/);checks++}
 const prepared=await prepare();assert.equal((await db.query(nativeGuide?'select count(*)::int n from gridex_ediel_ack_guide.source_bindings':'select count(*)::int n from gridex_ediel_ack_guide.calls')).rows[0].n,1);checks++
 const save=async(id,raw=ack(),token=prepared.witnessId)=>db.query("insert into ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,related_message_id,execution_context_snapshot,immutable_rendered_at,immutable_payload_hash)values($1,$2,'test','outbound','APERAK','APERAK',$3,$4,$5,now(),encode(sha256(convert_to($3,'UTF8')),'hex'))",[uid(id),uid(1),raw,uid(10),{prodatCommonHeaderNegativeWitnessId:token}])
 await save(20);assert.equal((await db.query('select count(*)::int n from gridex_ediel_common_header.negative_consumptions')).rows[0].n,1);checks++
 await assert.rejects(save(21),/ediel_common_header_negative_witness_already_consumed/);assert.equal((await db.query('select count(*)::int n from ediel_messages where id=$1',[uid(21)])).rows[0].n,0);checks++
 await assert.rejects(save(22,ack().replace('ACKD','CHANGED')),/ediel_common_header_negative_witness_required/);checks++
 const journal={action:'prepare',companyId:uid(1),environment:'test',messageId:uid(20),attemptId:uid(50),actorUserId:uid(7),binding:{originalHash:(await db.query('select immutable_payload_hash h from ediel_messages where id=$1',[uid(20)])).rows[0].h}}
 await assert.rejects(db.query('select gridex_ediel_transport.mutate_before_positive_storage_v1($1)',[journal]),/ediel_common_header_negative_witness_required/);assert.equal((await db.query('select count(*)::int n from gridex_ediel_transport.attempts')).rows[0].n,0);checks++
 journal.binding.prodatCommonHeaderRejectionEvidence=r.evidence;assert.equal((await db.query('select gridex_ediel_transport.mutate_before_positive_storage_v1($1) r',[journal])).rows[0].r.proceed,true);checks++
 await insert(11,source(''),null);await syntax(11,source(''));const missing=await read(11);assert.equal(missing.sourceMessage.company_id,null);assert.deepEqual(missing.evidence.field202,{fieldCode:'202',ercCode:'41',text:'Meddelandenamn saknas'});checks++
 await insert(12,source('Z03'));await assert.rejects(read(12),/ediel_historical_common_header_basis_unavailable/);checks++
 await insert(13,source('BAD').replace('NAD+DO+LOCAL','NAD+DO+FOREIGN'));await assert.rejects(read(13),/ediel_common_header_rejection_basis_required/);checks++
 await insert(14,source('BAD'));await syntax(14,source('BAD'),'rejected');await assert.rejects(read(14),/ediel_common_header_rejection_basis_required/);checks++
 await db.exec("update ediel_rule_packs set guide_revision='999'");assert.equal((await read(10)).evidence.familyEdition.version,'26.A:r3');checks++
 await assert.rejects(db.exec('delete from gridex_ediel_common_header.sources'),/ediel_common_header_basis_immutable/);checks++
 await db.exec("update tenant_actor_identifiers set valid_to=now() where identifier_value='LOCAL'");await assert.rejects(prepare(),/ediel_common_header_current_identity_unavailable/);await db.exec("update tenant_actor_identifiers set valid_to=null");checks++;
 const acl=(await db.query("select has_table_privilege('service_role','gridex_ediel_common_header.negative_witnesses','insert') direct,has_function_privilege('authenticated','public.ediel_prepare_common_header_negative_ack_v1(uuid,text,uuid,uuid,text)','execute') user_rpc")).rows[0];assert.deepEqual(acl,{direct:false,user_rpc:false});checks++
 console.log(`Focused actual common-header namespace/edition/negative one-use/native journal checks: ${checks} PASS (guide boundary ${nativeGuide?'actual native source-generated':'explicit fixture'})`)
}catch(error){console.error(error.message,error.where??'');process.exitCode=1}finally{await db.close()}
