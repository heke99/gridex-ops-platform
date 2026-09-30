// Actual preparation/source-owner stack with explicit protected fixture-port
// doubles. This is a bounded SQL regression, not native or authentic-run proof.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
const migration = name => readFileSync(resolve(process.env.EDIEL_SQL_REPOSITORY || new URL('..', import.meta.url).pathname, 'supabase/migrations', name), 'utf8')
import assert from 'node:assert/strict'
if (!process.env.EDIEL_PGLITE_MODULE) throw Error('EDIEL_PGLITE_MODULE required; pinned @electric-sql/pglite@0.3.14')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite(); const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema gridex_ack_authority;create schema gridex_utilts_binding;create schema gridex_received_sources;create schema gridex_ediel_inbound_context;create schema gridex_ediel_source_rules;create schema gridex_ediel_wire_namespace;create schema gridex_ediel_transport;
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
 create table public.fixture_permissions(permission text primary key);insert into fixture_permissions values('communication.write');
 create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select exists(select from public.fixture_permissions where permission=$3)';
 create function gridex_ediel_transport.mutate_v1(i jsonb) returns jsonb language plpgsql as $$begin
 if i->>'action'='prepare' then insert into gridex_ediel_transport.attempts values((i->>'attemptId')::uuid,(i->>'messageId')::uuid,(i->>'companyId')::uuid,i->>'environment',(i->>'actorUserId')::uuid,i->'binding');insert into gridex_ediel_transport.reservations values((i->>'messageId')::uuid,(i->>'attemptId')::uuid,'prepared');end if;
 return jsonb_build_object('proceed',true);end$$;
 insert into tenant_actor_identifiers values('${uid(4)}','${uid(1)}','test','${uid(2)}','EdielId','LOCAL','2000-01-01',null);
 insert into company_memberships values('${uid(1)}','${uid(7)}','active',true,now());insert into user_profiles values('${uid(7)}','active');
 insert into ediel_rule_packs values('${uid(100)}','UTILTS','electricity',repeat('a',64),'active','2000-01-01',null,'25.A','3');
 insert into ediel_message_profiles values('${uid(101)}','${uid(100)}','DB:E66','E66','','both',true,'{"exact":"source"}');
 insert into ediel_rule_pack_sources values('${uid(102)}','${uid(100)}',repeat('b',64),'actual guide');`)
 const inherited=migration('20260923135706_ediel_utilts_consumption_binding_v1.sql')
 await db.exec(inherited.slice(inherited.indexOf('CREATE FUNCTION gridex_utilts_binding.wire_tokens_v1'),inherited.indexOf('REVOKE ALL ON FUNCTION gridex_utilts_binding.wire_tokens_v1')))
 await db.exec(`alter table ediel_messages add column execution_context_snapshot jsonb;
 create function gridex_ediel_inbound_context.derive(m public.ediel_messages,t timestamptz) returns jsonb language plpgsql as $$begin
 if m.company_id is null or m.raw_payload not like '%NAD+MS+LOCAL::9%' then raise exception 'ediel_inbound_legal_context_required';end if;
 if m.message_family='APERAK' then return jsonb_build_object('basisKind','prescribed_outbound_ack','originalSourceMessageId',m.related_message_id);end if;
 return jsonb_build_object('basisKind','observed_source_persistence','family',m.message_family,'code',m.message_code,'subtype',null);end$$;
 create schema gridex_outbound_dispatch;
 create table gridex_outbound_dispatch.attempts(id uuid primary key,message_id uuid,company_id uuid,environment text,actor_user_id uuid,binding jsonb);
 create table gridex_outbound_dispatch.originals(message_id uuid primary key,company_id uuid,environment text,payload_hash text,raw_payload text);
 create table gridex_outbound_dispatch.reservations(message_id uuid primary key,attempt_id uuid,state text);
 create table gridex_outbound_dispatch.events(id uuid primary key,attempt_id uuid,kind text,company_id uuid,environment text,facts jsonb,observed_at timestamptz);
 create table gridex_outbound_dispatch.witnesses(event_id uuid);
 create function gridex_outbound_dispatch.mutate_v1(i jsonb) returns jsonb language plpgsql as $$begin
 if i->>'action'='prepare' then
 insert into gridex_outbound_dispatch.attempts values((i->>'attemptId')::uuid,(i->>'messageId')::uuid,(i->>'companyId')::uuid,i->>'environment',(i->>'actorUserId')::uuid,i->'binding');
 insert into gridex_outbound_dispatch.originals select id,company_id,environment,immutable_payload_hash,raw_payload from public.ediel_messages where id=(i->>'messageId')::uuid;
 insert into gridex_outbound_dispatch.reservations values((i->>'messageId')::uuid,(i->>'attemptId')::uuid,'prepared');end if;
 return jsonb_build_object('scoped',true,'proceed',true);end$$;`)
 await db.exec(migration('20260930184410_ediel_protected_technical_contrl_source_basis.sql'))
 await db.exec(migration('20260930193722_ediel_outbound_canonical_owner_witness.sql'));checks++
 await db.exec(`create schema extensions;create schema gridex_utilts_binding_storage_fixture;
 create function extensions.digest(bytea,text) returns bytea language sql immutable as 'select sha256($1)';
 create table gridex_utilts_binding.receipts(source_message_id uuid primary key,company_id uuid,environment text,message_code text,raw_hash text,source_context jsonb,membership jsonb);
 create table gridex_utilts_binding.contracts(series_id uuid primary key,company_id uuid,environment text,source_message_id uuid,transaction_id text,contract_version integer,contract jsonb,contract_hash text);
 create table public.meter_reading_series(id uuid primary key,company_id uuid,message_code text,source_transaction_reference text,source_ediel_message_id uuid,raw_transaction jsonb,immutable_hash text);
 create table public.ediel_ack_transaction_results(company_id uuid,environment text,source_message_id uuid,source_transaction_id text,disposition text,planned_response_type text,persistence_status text,persisted_series_id uuid,final_response_type text,response_message_id uuid,finalized_at timestamptz);
 -- Contract codec and full consumption source-context are separate tested
 -- boundaries; this harness executes the real U14 persisted joins/ACK scope.
 create function gridex_utilts_binding.source_context_v1(m public.ediel_messages) returns jsonb language sql immutable as $$select jsonb_build_object('id',m.id,'hash',encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex'))$$;
 create function gridex_utilts_binding.validate_contract_v1(c jsonb) returns boolean language sql immutable as $$select c->>'version'='2' and c->>'fixtureBoundary'='contract_codec_separately_tested'$$;`)
 await db.exec(migration('20260930150622_utilts_positive_ack_own_dm_scope.sql'))
 await db.exec(migration('20260930200633_ediel_outbound_witness_ack_scope_and_time_guards.sql'));checks++
 const ackAuthority=migration('20260930170932_ediel_inbound_ack_source_atomic_authority.sql')
 await db.exec(ackAuthority.slice(ackAuthority.indexOf('CREATE FUNCTION gridex_ack_authority.wire_v1'),ackAuthority.indexOf('CREATE TABLE gridex_ack_authority.scope_outcomes')))
 await db.exec(migration('20260930202616_ediel_native_aperak_own_erc_scope.sql'));checks++
 await db.exec(`create schema gridex_ediel_common_header;create function gridex_ediel_common_header.require_ack_v1(public.ediel_messages) returns jsonb language plpgsql as $$begin raise exception 'explicit_common_header_boundary_fixture_unavailable';end$$;create function gridex_received_sources.require_utilts_header_v1(uuid,uuid) returns jsonb language sql as $$select jsonb_build_object('applicationErrors','[ {"ercCode":"42","fieldCode":"505","text":"INCORRECT DATA Bad"} ]'::jsonb)$$`)
 const receivedLedger=migration('20260922095911_ediel_received_source_ledger.sql');await db.exec(receivedLedger.slice(receivedLedger.indexOf('CREATE FUNCTION gridex_received_sources.reject_mutation'),receivedLedger.indexOf('REVOKE ALL ON FUNCTION gridex_received_sources.reject_mutation')))
 await db.exec(migration('20260930204944_ediel_source_generated_native_ack_guide_constraints.sql'));checks++
 await db.exec(`create schema gridex_negative_fixtures;
 create table gridex_negative_fixtures.fixture_ports(token uuid primary key,company_id uuid,actor_id uuid,raw text,kind text);
 create function gridex_negative_fixtures.prepared_positive_fixture_v1(c uuid,w uuid,r text,a uuid) returns jsonb language plpgsql as $$begin
 if not exists(select from gridex_negative_fixtures.fixture_ports where token=w and company_id=c and actor_id=a and raw=r and kind='positive') then raise exception 'fixture_owner_proof_unavailable';end if;
 return jsonb_build_object('companyId',c,'authorizesBusinessEffect',false);end$$;
 create function gridex_negative_fixtures.prepared_negative_fixture_v1(c uuid,w uuid,r text,a uuid) returns jsonb language plpgsql as $$begin
 if not exists(select from gridex_negative_fixtures.fixture_ports where token=w and company_id=c and actor_id=a and raw=r and kind='negative') then raise exception 'fixture_owner_proof_unavailable';end if;
 return jsonb_build_object('companyId',c,'authorizesBusinessEffect',false);end$$;`)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930213848_ediel_draft_owner_preparation_permissions.sql',import.meta.url),'utf8'));checks++
 const raw="UNB+UNOC:3+LOCAL:14+REMOTE:14+260930:1200+PREP++23-DDQ-E66-T++++1'UNH+1+UTILTS:D:04A:UN:E5SE5A'BGM+E66+D+9'NAD+MS+LOCAL::9'IDE+24+T'UNT+5+1'UNZ+1+PREP'"
 const named=(await db.query("select jsonb_build_object('rulePack',(select to_jsonb(p) from ediel_rule_packs p),'messageProfile',(select to_jsonb(p) from ediel_message_profiles p),'guideSources',(select jsonb_agg(to_jsonb(s) order by id) from ediel_rule_pack_sources s)) s")).rows[0].s
 const evidence={profileKey:'DB:E66',messageProfileId:uid(101),rulePackId:uid(100),sourceHash:'a'.repeat(64),version:'25.A:r3',snapshot:named}
 const input={companyId:uid(1),actorUserId:uid(7),environment:'test',rawPayload:raw,rulePackEvidence:evidence}
 const permissions=async(...values)=>{await db.exec('truncate fixture_permissions');for(const p of values)await db.query('insert into fixture_permissions values($1)',[p])}
 const prepare=async(extra={})=>{await db.exec('set role service_role');try{return(await db.query('select public.ediel_prepare_outbound_owner_witness_v1($1) r',[{...input,...extra}])).rows[0].r}finally{await db.exec('reset role')}}
 const held=async(extra={},re=/ediel_outbound_owner_preparation_permission_required/)=>{await assert.rejects(prepare(extra),re);checks++}
 assert.equal((await prepare()).evidence.version,'25.A:r3');checks++
 assert.equal((await prepare({environment:'production'})).evidence.version,'25.A:r3');checks++
 await permissions('communication.send');await held();
 await permissions('ediel.send');await held();
 await permissions('communication.read');await held();
 await permissions('ediel_testing.write');await held();await held({environment:'production'});
 await db.query('insert into gridex_negative_fixtures.fixture_ports values($1,$2,$3,$4,$5)',[uid(501),uid(1),uid(7),raw,'positive'])
 await db.query('insert into gridex_negative_fixtures.fixture_ports values($1,$2,$3,$4,$5)',[uid(502),uid(1),uid(7),raw,'negative'])
 assert.equal((await prepare({sourceQualifiedPositiveFixtureWitnessId:uid(501)})).evidence.version,'25.A:r3');checks++
 assert.equal((await prepare({sourceQualifiedNegativeFixtureWitnessId:uid(502)})).evidence.version,'25.A:r3');checks++
 await held({sourceQualifiedPositiveFixtureWitnessId:uid(501),sourceQualifiedNegativeFixtureWitnessId:uid(502)});
 await held({sourceQualifiedPositiveFixtureWitnessId:uid(501),environment:'production'});
 await held({sourceQualifiedPositiveFixtureWitnessId:uid(503)},/fixture_owner_proof_unavailable/);
 await held({sourceQualifiedPositiveFixtureWitnessId:uid(501),rawPayload:raw.replace('PREP','CHANGED')},/fixture_owner_proof_unavailable/);
 await permissions('communication.write');await held({actorUserId:uid(99)},/ediel_outbound_owner_actor_scope_required/);
 await db.exec(`update company_memberships set accepted_at=null`);await held({},/ediel_outbound_owner_actor_scope_required/);await db.exec(`update company_memberships set accepted_at=now()`)
 await held({companyId:uid(2)},/ediel_outbound_owner_actor_scope_required/);
 await held({rulePackEvidence:{...evidence,version:'forged'}},/ediel_outbound_owner_witness_required/);
 await held({rulePackEvidence:{...evidence,snapshot:{...named,guideSources:[]}}},/ediel_outbound_owner_witness_required/);
 await held({rawPayload:raw.replace('NAD+MS+LOCAL','NAD+MS+FOREIGN')},/ediel_inbound_legal_context_required/);
 const acl=(await db.query("select has_function_privilege('service_role','gridex_ediel_outbound_owner.assert_preparation_v1(jsonb)','execute') private_access,has_function_privilege('authenticated','public.ediel_prepare_outbound_owner_witness_v1(jsonb)','execute') direct_rpc")).rows[0];assert.deepEqual(acl,{private_access:false,direct_rpc:false});checks++
 console.log(JSON.stringify({checks,phase:'bounded SQL preparation permissions and real canonical/source-owner stack; fixture authority ports explicit doubles, no native/replay/real approval proof'}))
}finally{await db.close()}
