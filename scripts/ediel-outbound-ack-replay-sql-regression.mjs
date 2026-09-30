// Bounded embedded execution of real common-header/technical/wire namespace,
// current permission resolver and replay SQL. The enclosing synthetic schema
// and unrelated transport journal are fixtures: this is not native replay proof.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const base=readFileSync(new URL('./ediel-prodat-common-header-sql-regression.mjs',import.meta.url),'utf8')
const marker=' console.log(`Focused actual common-header'
assert.equal(base.split(marker).length,2,'exact bounded runner insertion point')
const extension=String.raw`
 // Install the real current grant functions over declared synthetic tables.
 const extract=(file,name)=>{const sql=readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8');const start=sql.indexOf('create or replace function public.'+name+'(');assert.notEqual(start,-1);const end=sql.indexOf('$function$;',sql.indexOf('as $function$',start));assert.notEqual(end,-1);return sql.slice(start,end+11)}
 await db.exec('create schema auth;create table auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz);create table public.companies(id uuid,status text,is_active boolean);create table public.admin_users(user_id uuid,is_active boolean,role text);create table public.roles(id uuid,is_active boolean,key text,name text);create table public.user_roles(user_id uuid,role_id uuid,company_id uuid,is_active boolean,status text,role text);create table public.permissions(id uuid,key text,name text);create table public.role_permissions(role_id uuid,permission_id uuid,effect text);create table public.user_permissions(user_id uuid,permission_id uuid,company_id uuid,status text,is_active boolean,effect text);alter table public.ediel_messages add message_standard text default '+"'edifact'"+';alter table public.ediel_messages add status text default '+"'draft'"+';alter table public.ediel_messages add ack_outcome text;alter table public.ediel_messages add parsed_payload jsonb default '+"'{}'"+';')
 const normalizer=readFileSync(new URL('../supabase/migrations/20260727010000_contract_flow_integrity_completion.sql',import.meta.url),'utf8');const normStart=normalizer.indexOf('create or replace function public.gridex_normalize_platform_role(');const normEnd=normalizer.indexOf('$$;',normStart);assert.notEqual(normEnd,-1);await db.exec(normalizer.slice(normStart,normEnd+3));
 await db.exec(extract('20260924003724_company_direct_permission_scope_repair.sql','gridex_get_user_permissions_in_company'))
 await db.exec('drop function public.gridex_actor_has_company_permission(uuid,uuid,text)');await db.exec(extract('20260902100000_rpc_surface_and_permission_scope_corrections.sql','gridex_actor_has_company_permission'))
 await db.query('insert into auth.users values($1,null,null)',[uid(7)]);await db.query('insert into companies values($1,$2,true)',[uid(1),'active'])
 await db.query('insert into permissions values($1,$2,$2),($3,$4,$4)',[uid(200),'communication.write',uid(201),'communication.send'])
 await db.query('insert into user_permissions values($1,$2,$3,$4,true,$5),($1,$6,$3,$4,true,$5)',[uid(7),uid(200),uid(1),'active','allow',uid(201)])
 // PGlite lacks the pgcrypto extension; bridge its SHA-256 API to the actual
 // PostgreSQL built-in sha256, without changing digest semantics.
 await db.exec("create function public.digest(bytea,text) returns bytea language sql immutable as $$select case when $2='sha256' then sha256($1) else null end$$");
 // Prospective reservation/capture owns the new ACK bytes; do not retroactively
 // declare the earlier synthetic ACK protected from its public row alone.
 let namespace=readFileSync(new URL('../supabase/migrations/20260930171116_ediel_wire_reference_namespace.sql',import.meta.url),'utf8').replace('CREATE SCHEMA gridex_ediel_wire_namespace;','CREATE SCHEMA IF NOT EXISTS gridex_ediel_wire_namespace;').replace('CREATE FUNCTION gridex_ediel_wire_namespace.keys','CREATE OR REPLACE FUNCTION gridex_ediel_wire_namespace.keys');await db.exec(namespace)
 const ownRaw=ack().replaceAll('ACKI','REPLAY-OWN-I').replaceAll('ACKD','REPLAY-OWN-D');const ownPrepared=await prepare(ownRaw);await save(30,ownRaw,ownPrepared.witnessId)
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930224443_ediel_outbound_ack_protected_replay.sql',import.meta.url),'utf8'))
 // The earlier unprotected fixture is explicitly cancelled; exact same own
 // source/scope must have one active response, regardless of attempted outcome.
 await db.query('update ediel_messages set status=$1 where id=$2',['cancelled',uid(20)])
 const replay=async(c=1,actor=7,env='test',sequenceField=null,sequenceValue=null)=>(await db.query('select gridex_ediel_ack_replay.read_v1($1,$2,$3,$4,$5,$6,$7) r',[uid(c),env,uid(10),uid(actor),'APERAK',sequenceField,sequenceValue])).rows[0].r
 const effects=async()=>(await db.query('select (select count(*) from ediel_messages) messages,(select count(*) from gridex_ediel_common_header.negative_witnesses) witnesses,(select count(*) from gridex_ediel_common_header.negative_consumptions) consumptions,(select count(*) from gridex_ediel_transport.attempts) attempts,(select count(*) from gridex_ediel_wire_namespace.reservations) reservations')).rows[0]
 const before=await effects();const got=await replay();assert.equal(got.sourceMessage.id,uid(10));assert.equal(got.ackMessage.id,uid(30));assert.equal(got.ackMessage.ack_outcome,'negative');assert.deepEqual(await replay(),got);assert.deepEqual(await effects(),before);checks++
 await assert.rejects(replay(99),/actor_not_authorized/);await assert.rejects(replay(1,99),/actor_not_authorized/);await assert.rejects(replay(1,7,'production'),/actual_source_unavailable/);checks++
 await db.exec('update user_permissions set is_active=false');await assert.rejects(replay(),/actor_not_authorized/);await db.exec('update user_permissions set is_active=true');checks++
 await db.exec('update company_memberships set is_active=false');await assert.rejects(replay(),/actor_not_authorized/);await db.exec('update company_memberships set is_active=true');checks++
 await db.exec('update auth.users set banned_until=now()+interval '+"'1 day'" );await assert.rejects(replay(),/actor_not_authorized/);await db.exec('update auth.users set banned_until=null');checks++
 await db.exec('update tenant_actor_identifiers set valid_to=now()');await assert.rejects(replay(),/current_identity_unavailable/);await db.exec('update tenant_actor_identifiers set valid_to=null');checks++
 await db.query('insert into tenant_actor_identifiers values($1,$2,$3,$4,$5,$6,$7,null)',[uid(210),uid(211),'test',uid(212),'EdielId','LOCAL','2000-01-01']);await assert.rejects(replay(),/current_identity_unavailable/);await db.query('delete from tenant_actor_identifiers where id=$1',[uid(210)]);checks++
 await db.query('update ediel_messages set ack_outcome=$1 where id=$2',['positive',uid(30)]);await assert.rejects(replay(),/own_outcome_mismatch/);await db.query('update ediel_messages set ack_outcome=null where id=$1',[uid(30)]);checks++
 await assert.rejects(replay(1,7,'test','unsupported','X'),/scope_required/);assert.deepEqual(await effects(),before);assert.deepEqual(await replay(),got);checks++
 await db.exec('set role service_role');assert.equal((await db.query('select public.ediel_read_outbound_ack_replay_v1($1,$2,$3,$4,$5,null,null) r',[uid(1),'test',uid(10),uid(7),'APERAK'])).rows[0].r.ackMessage.id,uid(30));await db.exec('reset role');checks++
 const replayAcl=(await db.query("select has_function_privilege('authenticated','public.ediel_read_outbound_ack_replay_v1(uuid,text,uuid,uuid,text,text,text)','execute') authenticated,has_function_privilege('anon','public.ediel_read_outbound_ack_replay_v1(uuid,text,uuid,uuid,text,text,text)','execute') anon")).rows[0];assert.deepEqual(replayAcl,{authenticated:false,anon:false});checks++
 console.log('Actual outbound ACK private replay/current-grant/common legal namespace/no-effect SQL: 11 PASS; bounded synthetic schema, not native qualification')
`
const generated=base.replace(marker,()=>extension+marker)
const temp=fileURLToPath(new URL('./.ediel-outbound-ack-replay-bounded.tmp.mjs',import.meta.url))
writeFileSync(temp,generated)
try{
 const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:{...process.env,EDIEL_NATIVE_ACK_GUIDE_FORWARD:fileURLToPath(new URL('../supabase/migrations/20260930204944_ediel_source_generated_native_ack_guide_constraints.sql',import.meta.url))}})
 if(run.error)throw run.error
 process.exitCode=run.status??1
}finally{unlinkSync(temp)}
