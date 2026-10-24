// reality-defects: H3d terminal editing must preserve contract and event atomicity.
import {afterAll,beforeAll,expect,it} from 'vitest'
import {PGlite} from '@electric-sql/pglite'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
const root=fileURLToPath(new URL('..',import.meta.url))
const schema=readFileSync(root+'/supabase/schema.sql','utf8')
const sql=readFileSync(root+'/supabase/migrations/20261024013302_customer_contract_terminal_update_atomic.sql','utf8')
const sourceFunction=(name:string)=>{const a=schema.indexOf('CREATE FUNCTION '+name+'(');if(a<0)throw Error('missing_source:'+name);const m=/\bAS (\$\w*\$)/.exec(schema.slice(a))!;return schema.slice(a,schema.indexOf(m[1]+';',a+m.index+m[0].length)+m[1].length+1)}
const sourceTable=(name:string)=>{const a=schema.indexOf('CREATE TABLE '+name+' (');return schema.slice(a,schema.indexOf('\n);',a)+3)}
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const post=/body text:=\$post\$([\s\S]*?)\$post\$/.exec(sql)![1]
const addition=/\n  if p_event_type in \('terminated', 'cancelled'\) then\n    perform public\.gridex_require_contract_terminal_supply_v1[\s\S]*?\n  end if;/g
const pre=post.replace(addition,'')
 .replace("          CASE WHEN nullif(p_metadata->>'termination_notice_date', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'\n            THEN (p_metadata->>'termination_notice_date')::date\n            ELSE (nullif(p_metadata->>'termination_notice_date', '')::timestamptz AT TIME ZONE 'Europe/Stockholm')::date END,", "          nullif(p_metadata->>'termination_notice_date', '')::timestamptz,")
 .replace("set termination_notice_date = (p_happened_at AT TIME ZONE 'Europe/Stockholm')::date,", "set termination_notice_date = p_happened_at,")
if(hash(pre)!=='bb199ad37956b3e07ce0bee093f024c184d4f7f5e732e901ec7329a54d0558c7')throw Error('unqualified_recorder_predecessor')
let recorder=sourceFunction('public.gridex_record_customer_contract_event_v1')
const installed=/AS \$\$([\s\S]*)\$\$;/.exec(recorder)![1]
if(![hash(pre),hash(post)].includes(hash(installed)))throw Error('unknown_installed_recorder')
recorder=recorder.replace(installed,pre)
let db:PGlite
const company='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',actor='abababab-abab-4bab-8bab-abababababab',customer='55555555-5555-4555-8555-555555555555',contract='88888888-8888-4888-8888-888888888888'
beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;create schema gridex_ediel_retention;
create function auth.role() returns text language sql as $$select coalesce(current_setting('fixture.role',true),'service_role')$$;
create function public.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
create function public.gridex_new_public_resource_reference(text) returns text language sql as $$select 'fixture-'||gen_random_uuid()$$;
create table auth.users(id uuid,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz);
create table user_profiles(id uuid,user_status text,disabled_at timestamptz);
create table companies(id uuid,is_active boolean,status text);
create table company_memberships(company_id uuid,user_id uuid,status text,is_active boolean,accepted_at timestamptz);
create table permissions(id uuid,key text,name text,is_active boolean);
create table roles(id uuid,key text,name text,is_active boolean);
create table user_roles(user_id uuid,company_id uuid,role_id uuid,role text,status text,is_active boolean);
create table role_permissions(role_id uuid,permission_id uuid,effect text);
create table user_permissions(user_id uuid,company_id uuid,permission_id uuid,permission_key text,status text,is_active boolean,effect text);
create table user_permission_overrides(user_id uuid,company_id uuid,permission_key text,effect text,is_active boolean,valid_from timestamptz,valid_to timestamptz);
create table admin_users(user_id uuid,is_active boolean,role text);
create table gridex_ediel_retention.record_class_catalog(retention_class text,source_table text);
create table gridex_ediel_retention.record_tombstones(retention_class text,target_id uuid,company_id uuid,target_hash text);
create table contract_price_snapshots(id uuid,company_id uuid,contract_id uuid,snapshot_hash text);
create table customer_contract_documents(company_id uuid,customer_contract_id uuid,document_type text,document_sha256 text,verified_at timestamptz);
create table customer_sites(id uuid,company_id uuid,customer_id uuid);
create table metering_points(id uuid,company_id uuid,customer_id uuid,site_id uuid);
create table customer_supply_periods(id uuid default gen_random_uuid(),company_id uuid,customer_id uuid,contract_id uuid,customer_contract_id uuid,status text,end_date date,actual_end_date date,market_end_at timestamptz);
create table customer_contract_events(id uuid default gen_random_uuid(),company_id uuid,customer_contract_id uuid,customer_id uuid,event_type text,happened_at timestamptz,note text,metadata jsonb,actor_user_id uuid,created_at timestamptz default clock_timestamp());
create table domain_events(id uuid default gen_random_uuid(),company_id uuid,event_type text,aggregate_type text,aggregate_id uuid,actor_user_id uuid,source text,idempotency_key text unique,payload jsonb);
create table event_outbox(company_id uuid,domain_event_id uuid,destination_type text,destination_key text,payload jsonb);`)
 await db.exec(sourceTable('public.customer_contracts'))
 for(const name of ['public.gridex_normalize_platform_role','public.gridex_get_user_permissions_in_company','public.gridex_actor_has_company_permission','public.ediel_retention_lock_auth_actor_v1','public.ediel_is_qualified_customer_record_transition_v1','gridex_ediel_retention.record_c40a67d5fa7766230451_guard_v1','public.gridex_enforce_customer_contract_state_v1'])await db.exec(sourceFunction(name))
 // Exact original recorder body, verified against the reviewed predecessor hash.
 await db.exec(recorder)
 // Notice helpers are taken from their immutable side-table migration; no notice row is needed in these cases.
 const notice=readFileSync(root+'/supabase/migrations/20261023204000_h3d_contract_notice_days.sql','utf8')
 for(const name of ['gridex_contract_notice_end_v1','gridex_contract_termination_end_v1']){const a=notice.indexOf('create function public.'+name+'(');const b=notice.indexOf('\n$$;',a)+4;await db.exec(notice.slice(a,b))}
 await db.exec('create function public.gridex_customer_contract_notice_days_v1(uuid,uuid) returns integer language sql as $$select 0$$;')
 await db.exec(sql)
 await db.exec(`create trigger customer_contracts_lock_signed before update or delete on customer_contracts for each row execute function gridex_ediel_retention.record_c40a67d5fa7766230451_guard_v1();
create trigger customer_contracts_state_machine_v1 before insert or update of status on customer_contracts for each row execute function gridex_enforce_customer_contract_state_v1();`)
},60000)
afterAll(async()=>{await db?.close()})
const q=async(s:string,args:unknown[]=[]) => (await db.query<Record<string,unknown>>(s,args)).rows
const row=async()=> (await q('select to_jsonb(c) r from customer_contracts c where id=$1',[contract]))[0].r
const sourceHash=async(expected?:unknown)=> expected ? (await q(`select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') h`,[expected]))[0].h : (await q(`select public.gridex_customer_contract_terminal_basis_v1($1,$2,$3,$4) r`,[company,customer,contract,actor]))[0].r as {source_hash:string}
const call=async(patch:Record<string,unknown>,expected?:unknown,tenant=company,who=actor)=> {
 const e=expected??await row(),h=expected?await sourceHash(expected):(await sourceHash() as {source_hash:string}).source_hash
 return (await q(`select public.gridex_update_customer_contract_terminal_v1($1,$2,$3,$4,$5,$6,'2026-10-24T12:00Z',null,$7) r`,[tenant,customer,contract,who,e,patch,h]))[0].r
}
const counts=async()=>q(`select (select count(*)::int from customer_contract_events) events,(select count(*)::int from domain_events) domain,(select count(*)::int from event_outbox) outbox`)
const scenario=async(fn:()=>Promise<void>)=>{await db.exec("begin;set local fixture.role='service_role'");try{
 await q(`insert into auth.users values($1,null,null,now())`,[actor]);await q(`insert into user_profiles values($1,'active',null)`,[actor])
 await q(`insert into companies values($1,true,'active'),($2,true,'active')`,[company,other]);await q(`insert into company_memberships values($1,$2,'active',true,now())`,[company,actor])
 await db.exec(`insert into permissions values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','contracts.write','contracts.write',true)`);await q(`insert into user_permissions values($1,$2,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','contracts.write','active',true,'allow')`,[actor,company])
 await q(`insert into customer_contracts(id,company_id,customer_id,status,starts_at,ends_at,ended_at,status_reason_code,termination_notice_date,signed_at,locked_at,signature_snapshot_sha256,contract_product_version_id,contract_publication_version_id,legal_bundle_version_id,contract_price_snapshot_id)
values($1,$2,$3,'active','2026-09-01','2026-12-01','2026-11-01','activated','2026-10-01',now(),now(),repeat('a',64),$1,$1,$1,$1)`,[contract,company,customer]);await fn()
}finally{await db.exec('rollback')}}
const supply=async(status='active',end:string|null=null,tenant=company)=>q('insert into customer_supply_periods(company_id,customer_id,contract_id,customer_contract_id,status,end_date) values($1,$2,$3,$3,$4,$5)',[tenant,customer,contract,status,end])
const refuse=async(fn:()=>Promise<unknown>,message:RegExp)=>{await db.exec('savepoint refusal');await expect(fn()).rejects.toThrow(message);await db.exec('rollback to savepoint refusal')}
it('reproduces the original field-preserving terminal status write despite open supply',()=>scenario(async()=>{
 await supply();await db.exec(`update customer_contracts set status='cancelled' where id='${contract}'`)
 expect((await row() as {status:string}).status).toBe('cancelled')
}))
for(const status of ['active','confirmed_by_grid_owner','ending'])it(`rolls back the entire edit with ongoing ${status} supply`,()=>scenario(async()=>{
 await supply(status);const before=await row();await refuse(()=>call({status:'cancelled',override_reason:'new note'}),/contract_supply_still_open/)
 expect(await row()).toEqual(before);expect(await counts()).toEqual([{events:0,domain:0,outbox:0}])
}))
it('commits the editable patch and real canonical events/outbox together after supply ends',()=>scenario(async()=>{
 await supply('ending','2026-10-24');const r=await call({status:'cancelled',override_reason:'approved note'}) as {contract:{status:string;override_reason:string};lifecycle_recorded:boolean}
 expect(r).toMatchObject({contract:{status:'cancelled',override_reason:'approved note',updated_by:actor},lifecycle_recorded:true});expect(await counts()).toEqual([{events:2,domain:2,outbox:2}])
}))
it('rolls back the patch and earlier events if a later outbox insert fails',()=>scenario(async()=>{
 await supply('ended','2026-10-23');const before=await row();await db.exec(`alter table event_outbox add constraint injected_failure check(payload->>'event_type'<>'cancelled')`)
 await refuse(()=>call({status:'cancelled',override_reason:'must roll back'}),/injected_failure/)
 expect(await row()).toEqual(before);expect(await counts()).toEqual([{events:0,domain:0,outbox:0}])
}))
it('rejects stale full-row expected state before any patch or event',()=>scenario(async()=>{
 const before=await row();await db.exec(`update customer_contracts set override_reason='concurrent'`)
 await refuse(()=>call({status:'cancelled'},before),/contract_terminal_expected_graph_changed/);expect(await counts()).toEqual([{events:0,domain:0,outbox:0}])
}))
it('refuses unknown patch keys',()=>scenario(async()=>{
 await refuse(()=>call({status:'cancelled',company_id:other}),/contract_terminal_payload_invalid/)
}))
it('refuses another tenant and inactive current actor',()=>scenario(async()=>{
 await refuse(()=>call({status:'cancelled'},undefined,other),/contract_terminal_current_actor_required/)
 await db.exec(`update user_profiles set user_status='inactive'`);await refuse(()=>call({status:'cancelled'}),/contract_terminal_current_actor_required/)
}))
it('uses actual canonical permission deny and ban checks',()=>scenario(async()=>{
 await q(`insert into user_permission_overrides values($1,$2,'contracts.write','deny',true,null,null)`,[actor,company])
 await refuse(()=>call({status:'cancelled'}),/contract_terminal_current_actor_required/);await db.exec('delete from user_permission_overrides;update auth.users set banned_until=now()+interval \'1 day\'')
 await refuse(()=>call({status:'cancelled'}),/contract_terminal_current_actor_required/)
}))
it('preserves signed immutable contract fields',()=>scenario(async()=>{
 await refuse(()=>call({status:'cancelled',contract_name:'forged signed terms'}),/signed_customer_contract_immutable:contract_name/)
}))
it('the direct canonical recorder also refuses an ending period beyond the requested end',()=>scenario(async()=>{
 await supply('ending','2026-11-01');await refuse(()=>q(`select gridex_record_customer_contract_event_v1($1,$2,$3,'cancelled','2026-10-24',null,'{}',$4)`,[company,contract,customer,actor]),/contract_supply_still_open/)
 expect(await counts()).toEqual([{events:0,domain:0,outbox:0}])
}))
it('preserves valid received/manual terminal events when their supply end is not later',()=>scenario(async()=>{
 await supply('ending','2026-11-01');await q(`select gridex_record_customer_contract_event_v1($1,$2,$3,'terminated','2026-11-01',null,'{"termination_reason":"supply_end"}',$4)`,[company,contract,customer,actor])
 expect((await row() as {status:string;termination_reason:string}).termination_reason).toBe('supply_end');expect(await counts()).toEqual([{events:1,domain:1,outbox:1}])
}))
it('refuses non-service invocation at the SQL boundary',()=>scenario(async()=>{
 await db.exec(`set local fixture.role='authenticated'`);await refuse(()=>call({status:'cancelled'}),/contract_terminal_service_role_required/)
}))

it('B3 refuses manual cancellation before a future supplied end even if the requested contract end is later',()=>scenario(async()=>{
 const future=(await q(`select ((clock_timestamp() at time zone 'Europe/Stockholm')::date+7)::text d`))[0].d as string
 const later=(await q(`select clock_timestamp()+interval '30 days' d`))[0].d
 await supply('ending',future)
 const before=await row();await refuse(async()=>q(`select public.gridex_update_customer_contract_terminal_v1($1,$2,$3,$4,$5,$6,$7,null,$8)`,[company,customer,contract,actor,before,{status:'cancelled'},later,await sourceHash(before)]),/contract_supply_still_open/)
 expect(await row()).toEqual(before);expect(await counts()).toEqual([{events:0,domain:0,outbox:0}])
}))
it('refuses an unknown canonical recorder body without changing that body or its metadata',()=>scenario(async()=>{
 const def=(await q(`select pg_get_functiondef('public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text)'::regprocedure) d`))[0].d as string
 await db.exec(def.replace('customer_contract_event_service_role_required','unknown_body_change'))
 const query=`select to_jsonb(p) r from pg_proc p where oid='public.gridex_record_customer_contract_event_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,uuid,timestamptz,text)'::regprocedure`
 const before=await q(query);const guard=/do \$recorder\$[\s\S]*?\$recorder\$;/.exec(sql)![0]
 await refuse(()=>db.exec(guard),/contract_terminal_recorder_source_unqualified/);expect(await q(query)).toEqual(before)
}))

it('preserves the canonical platform super-admin permission path without a company membership',()=>scenario(async()=>{
 await db.exec('delete from company_memberships;delete from user_permissions')
 await q(`insert into admin_users values($1,true,'super_admin')`,[actor])
 const r=await call({status:'cancelled'}) as {contract:{status:string}}
 expect(r.contract.status).toBe('cancelled')
}))

it('refuses a site or metering point outside the contract tenant/customer',()=>scenario(async()=>{
 const id='66666666-6666-4666-8666-666666666666'
 await q('insert into customer_sites values($1,$2,$3)',[id,other,customer])
 await q('insert into metering_points values($1,$2,$3,null)',[id,other,customer])
 await refuse(()=>call({status:'cancelled',site_id:id}),/contract_terminal_site_scope_invalid/)
 await refuse(()=>call({status:'cancelled',metering_point_id:id}),/contract_terminal_meter_scope_invalid/)
 expect(await counts()).toEqual([{events:0,domain:0,outbox:0}])
}))

it('keeps canonical idempotent terminal replay after a later supply correction',()=>scenario(async()=>{
 const args=[company,contract,customer,actor]
 const run=()=>q(`select gridex_record_customer_contract_event_v1($1,$2,$3,'cancelled','2026-10-24',null,'{}',$4,null,'stable-terminal') r`,args)
 const first=(await run())[0].r as {event:{id:string}}
 await supply('ending','2026-11-01')
 const replay=(await run())[0].r as {existing:boolean;event:{id:string}}
 expect(replay.existing).toBe(true);expect(replay.event.id).toBe(first.event.id);expect(await counts()).toEqual([{events:1,domain:1,outbox:1}])
}))
it('the manual event ingress rechecks under the mutex after a stale no-supply application read',()=>scenario(async()=>{
 const future=(await q(`select ((clock_timestamp() at time zone 'Europe/Stockholm')::date+7)::text d`))[0].d as string
 const later=(await q(`select clock_timestamp()+interval '30 days' d`))[0].d
 await supply('ending',future)
 await refuse(()=>q(`select gridex_record_manual_customer_contract_event_v1($1,$2,$3,'cancelled',$4,null,'{}',$5)`,[company,contract,customer,later,actor]),/contract_supply_still_open/)
 expect((await row() as {status:string}).status).toBe('active');expect(await counts()).toEqual([{events:0,domain:0,outbox:0}])
}))
it('server-computed row hash remains exact when JSON clients round high-precision numeric values',()=>scenario(async()=>{
 await db.exec(`update customer_contracts set metadata='{"n":0.12345678901234567890123456789}'`)
 const basis=(await q(`select gridex_customer_contract_terminal_basis_v1($1,$2,$3,$4) r`,[company,customer,contract,actor]))[0].r as {contract:unknown;source_hash:string}
 const r=(await q(`select gridex_update_customer_contract_terminal_v1($1,$2,$3,$4,$5,$6,'2026-10-24',null,$7) r`,[company,customer,contract,actor,basis.contract,{status:'cancelled'},basis.source_hash]))[0].r as {contract:{status:string}}
 expect(r.contract.status).toBe('cancelled')
 expect((await q(`select metadata->>'n' n from customer_contracts`))[0].n).toBe('0.12345678901234567890123456789')
}))
it('preserves completed manual-ingress replay after a later supply correction',()=>scenario(async()=>{
 const args=[company,contract,customer,actor]
 const run=()=>q(`select gridex_record_manual_customer_contract_event_v1($1,$2,$3,'cancelled','2026-10-24',null,'{}',$4,null,'stable-manual-terminal') r`,args)
 const first=(await run())[0].r as {event:{id:string}}
 await supply('ending','2026-11-01')
 const replay=(await run())[0].r as {existing:boolean;event:{id:string}}
 expect(replay.existing).toBe(true);expect(replay.event.id).toBe(first.event.id);expect(await counts()).toEqual([{events:1,domain:1,outbox:1}])
}))

for(const [instant,day] of [['2026-10-23T22:30:00Z','2026-10-24'],['2025-12-31T23:30:00Z','2026-01-01'],['2026-07-01T22:30:00Z','2026-07-02'],['2026-01-01T00:30:00+02:00','2025-12-31'],['2026-10-24','2026-10-24']])it(`canonical notice stores Swedish day and keeps the instant ${instant}`,()=>scenario(async()=>{
 const r=(await q(`select gridex_record_customer_contract_event_v1($1,$2,$3,'termination_notice_received',$4,null,'{}',$5) r`,[company,contract,customer,instant,actor]))[0].r as {event:{happened_at:string}}
 expect((await row() as {termination_notice_date:string}).termination_notice_date).toBe(day)
 expect(Date.parse(r.event.happened_at)).toBe(Date.parse(instant))
}))
it('atomic notice stage derives its plan from the Swedish notice day, before the terminal event',()=>scenario(async()=>{
 const draft='77777777-7777-4777-8777-777777777777'
 await q(`insert into customer_contracts(id,company_id,customer_id,status,starts_at,notice_months) values($1,$2,$3,'draft','2025-01-01',1)`,[draft,company,customer])
 await db.exec(`create table notice_stage(notice date,derived date);
 create function fixture_notice_stage() returns trigger language plpgsql as $$begin if new.event_type='termination_notice_received' then
 insert into notice_stage select termination_notice_date,(ended_at at time zone 'Europe/Stockholm')::date from customer_contracts where id=new.customer_contract_id;end if;return new;end$$;
 create trigger fixture_notice_stage after insert on customer_contract_events for each row execute function fixture_notice_stage();`)
 const basis=(await q(`select gridex_customer_contract_terminal_basis_v1($1,$2,$3,$4) r`,[company,customer,draft,actor]))[0].r as {contract:unknown;source_hash:string}
 await q(`select gridex_update_customer_contract_terminal_v1($1,$2,$3,$4,$5,$6,'2026-10-24','2026-10-23T22:30:00Z',$7)`,[company,customer,draft,actor,basis.contract,{status:'cancelled'},basis.source_hash])
 expect(await q('select notice::text notice,derived::text derived from notice_stage')).toEqual([{notice:'2026-10-24',derived:'2026-11-24'}])
}))
it('terminal metadata notice values normalize instants while preserving literal calendar dates',()=>scenario(async()=>{
 await q(`select gridex_record_customer_contract_event_v1($1,$2,$3,'cancelled','2026-10-24',null,$4,$5)`,[company,contract,customer,{termination_notice_date:'2026-10-23T22:30:00Z'},actor])
 expect((await row() as {termination_notice_date:string}).termination_notice_date).toBe('2026-10-24')
}))
