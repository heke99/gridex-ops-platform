// Executes actual route forward with explicit technical-basis/permission fixtures.
// This bounded synthetic PostgreSQL probe is not native or migration replay proof.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db=new PGlite();const uid=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;let checks=0
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema gridex_ediel_technical_ack;
 create table public.company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
 create table public.user_profiles(id uuid,user_status text);
 create table public.communication_routes(id uuid primary key,company_id uuid,is_active boolean,route_scope text,environment_type text,target_email text,route_name text,route_type text,grid_owner_id uuid,target_system text,endpoint text,supported_payload_version text,notes text,auth_config jsonb);
 create table public.ediel_route_profiles(id uuid primary key,communication_route_id uuid,company_id uuid,environment text,is_enabled boolean,is_active boolean,message_standard text,payload_format text,message_family text,business_code text,sender_ediel_id text,receiver_ediel_id text,sender_subaddress text,sender_sub_address text,receiver_subaddress text,receiver_sub_address text,application_reference text,mailbox text,transport_profile_id uuid,smtp_host text,smtp_port integer,notes text);
 create table public.ediel_transport_profiles(id uuid primary key,company_id uuid,environment text,is_active boolean,transport_channel text,direction text,sender_email text,host text,port integer);
 create table public.test_evidence(company_id uuid,message_id uuid,evidence jsonb);
 create function gridex_ediel_technical_ack.require_source_v1(uuid,uuid) returns jsonb language plpgsql as $$declare e jsonb;begin select evidence into e from public.test_evidence where company_id=$1 and message_id=$2;if e is null then raise exception 'ediel_technical_ack_basis_required';end if;return e;end$$;
 create function gridex_ediel_technical_ack.require_current_endpoint_v1(jsonb) returns void language plpgsql as $$begin if $1->>'transportEdielId'<>'LOCAL' then raise exception 'ediel_technical_endpoint_unqualified';end if;end$$;
 create function public.gridex_actor_has_company_permission(uuid,uuid,text) returns boolean language sql as 'select $3=''communication.send''';
 insert into company_memberships values('${uid(1)}','${uid(2)}','active',true,now());insert into user_profiles values('${uid(2)}','active');
 insert into communication_routes(id,company_id,is_active,route_scope,environment_type,target_email,route_name,route_type,target_system,auth_config) values('${uid(3)}','${uid(1)}',true,'ediel_ack','tgt_test','remote@example.test','actual','smtp','remote','{"secret":"masked"}');
 insert into ediel_route_profiles(id,communication_route_id,company_id,environment,is_enabled,is_active,message_standard,payload_format,sender_ediel_id,receiver_ediel_id,sender_subaddress,receiver_subaddress,application_reference,mailbox,smtp_host,smtp_port) values('${uid(4)}','${uid(3)}','${uid(1)}','test',true,true,'edifact','edifact','LOCAL','REMOTE','L','R','','current@example.test','smtp.example.test',465);`)
 const e={companyId:uid(1),sourceMessageId:uid(10),sourceHash:'a'.repeat(64),environment:'test',transportEdielId:'LOCAL',originalUNB:{sender:['REMOTE','14','R'],receiver:['LOCAL','14','L'],applicationReference:''}}
 await db.query('insert into test_evidence values($1,$2,$3)',[uid(1),uid(10),e])
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930203034_ediel_technical_syntax_ack_transport_route.sql',import.meta.url),'utf8'));checks++
 const read=async(c=1,a=2,from='current@example.test',host='smtp.example.test',port=465)=>(await db.query('select gridex_ediel_technical_ack.read_route_v1($1,$2,$3,$4,$5,$6) r',[uid(c),uid(a),uid(10),from,host,port])).rows[0].r
 const r=await read();assert.equal(r.route.id,uid(3));assert.equal(r.routeRuntime.route_profile_id,uid(4));assert.equal(r.applicationReference,'');assert.equal(r.authorizesBusinessEffect,false);assert.deepEqual(r.route.auth_config,{});assert.equal(r.senderSubAddress,'L');assert.equal(r.receiverSubAddress,'R');checks++
 await assert.rejects(read(1,99),/ediel_tenant_actor_forbidden/);checks++
 await assert.rejects(read(99,2),/ediel_tenant_actor_forbidden/);checks++
 for(const update of ["sender_subaddress='WRONG'","receiver_subaddress='WRONG'","sender_sub_address='CONFLICT'","application_reference=NULL","application_reference='DEFAULT'","mailbox='old@example.test'","smtp_host='old.example.test'","smtp_port=25","environment='production'","message_family='PRODAT'","business_code='Z01'","is_enabled=false","payload_format='xml'"]){
  await db.exec('begin');await db.exec('update ediel_route_profiles set '+update);await assert.rejects(read(),/ediel_technical_ack_route_count:0/);await db.exec('rollback');checks++
 }
 for(const update of ["environment_type='production'","target_email='two@example.test,three@example.test'","route_scope='business'","is_active=false"]){await db.exec('begin');await db.exec('update communication_routes set '+update);await assert.rejects(read(),/ediel_technical_ack_route_count:0/);await db.exec('rollback');checks++}
 // A second weaker match must not displace the exact SMTP-account-qualified pair.
 await db.exec(`insert into ediel_route_profiles select '${uid(5)}',communication_route_id,company_id,environment,is_enabled,is_active,message_standard,payload_format,message_family,business_code,sender_ediel_id,receiver_ediel_id,sender_subaddress,sender_sub_address,receiver_subaddress,receiver_sub_address,application_reference,mailbox,transport_profile_id,'other.example.test',25,notes from ediel_route_profiles where id='${uid(4)}'`);assert.equal((await read()).routeRuntime.route_profile_id,uid(4));checks++
 await db.exec(`update ediel_route_profiles set smtp_host='smtp.example.test',smtp_port=465 where id='${uid(5)}'`);await assert.rejects(read(),/ediel_technical_ack_route_count:2/);await db.exec(`delete from ediel_route_profiles where id='${uid(5)}'`);checks++
 await db.exec(`insert into ediel_transport_profiles values('${uid(6)}','${uid(1)}','test',true,'smtp','outbound','current@example.test','smtp.example.test',465);update ediel_route_profiles set transport_profile_id='${uid(6)}',smtp_host=null,smtp_port=null`);assert.equal((await read()).routeRuntime.route_profile_id,uid(4));checks++
 await db.exec("update ediel_transport_profiles set sender_email='old@example.test'");await assert.rejects(read(),/ediel_technical_ack_route_count:0/);await db.exec("update ediel_transport_profiles set sender_email='current@example.test'");checks++
 await assert.rejects(read(1,2,'old@example.test'),/ediel_technical_ack_route_count:0/);checks++
 const acl=(await db.query("select has_function_privilege('authenticated','public.ediel_read_technical_syntax_ack_route_v1(uuid,uuid,uuid,text,text,integer)','execute') user_rpc")).rows[0];assert.equal(acl.user_rpc,false);checks++
 console.log(`Focused technical source-only exact route/account/actor checks: ${checks} PASS`)
}catch(error){console.error(error.message,error.where??'');process.exitCode=1}finally{await db.close()}
