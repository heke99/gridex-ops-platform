import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,beforeEach,afterEach,afterAll,expect,it} from 'vitest'
const schema=fs.readFileSync('supabase/schema.sql','utf8')
const migration='supabase/migrations/20261102212140_signed_customer_contract_amendment.sql'
const id=(n:number)=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`
let db:PGlite
let effective:string
function actualTable(name:string) {
 const text=schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
 if(!text) throw new Error('actual table missing: '+name)
 return text
}
function actualFunction(name:string) {
 const start=schema.indexOf(`CREATE FUNCTION public.${name}(`)
 if(start<0) throw new Error('actual function missing: '+name)
 const rest=schema.slice(start),tag=/AS (\$[^$]*\$)/.exec(rest)!
 return rest.slice(0,rest.indexOf(tag[1],tag.index+tag[0].length)+tag[1].length)+';'
}
beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
 create function auth.role() returns text language sql as $$select current_setting('test.role',true)$$;
 create table test_permissions(company_id uuid,actor_id uuid,permission text,denied boolean default false);
 create function public.gridex_actor_has_company_permission(a uuid,c uuid,p text) returns boolean language sql as $$
 select exists(select from public.test_permissions where company_id=c and actor_id=a and permission=p and not denied)
 and not exists(select from public.test_permissions where actor_id=a and permission=p and denied)$$;
 create function public.gridex_get_user_permissions_in_company(a uuid,c uuid) returns text[] language sql as $$
 select array_agg(permission) from public.test_permissions where company_id=c and actor_id=a and not denied$$;
 create function public.canonical_json_sha256(value jsonb) returns text language sql immutable strict as $$select encode(sha256(convert_to(value::text,'utf8')),'hex')$$;`)
 for(const name of ['gridex_normalize_org_number','gridex_normalize_personal_number','gridex_normalize_email','gridex_normalize_phone','gridex_normalize_facility_id','gridex_normalize_metering_point_id','gridex_new_public_resource_reference','gridex_new_external_tenant_reference']) await db.exec(actualFunction(name))
 for(const name of ['companies','customers','customer_sites','metering_points','company_memberships','customer_contracts','contract_price_snapshots','customer_contract_signature_requests','billing_underlays','customer_supply_periods','customer_contract_evidence','customer_operation_jobs','supplier_switch_requests']) {
  await db.exec(actualTable(name));await db.exec(`alter table public.${name} add primary key(id)`)
 }
 await db.exec(`create schema gridex_billing_source;create table gridex_billing_source.underlay_bindings(underlay_id uuid primary key);
 create table physical_source_sentinel(id uuid primary key,payload jsonb);
 create schema gridex_received_sources;create table public.test_supply_qualification(ok boolean);
 create schema gridex_bilateral_prodat;create schema gridex_regulated_supply;
 create table public.test_graph_lock_order(stage text);
 create function gridex_bilateral_prodat.lock_supply_v1() returns void language plpgsql as $$begin
 insert into public.test_graph_lock_order values('supply_graph');end$$;
 create function gridex_regulated_supply.lock_graph_v1() returns void language plpgsql as $$begin
 insert into public.test_graph_lock_order values('regulated_graph');end$$;
 -- Declared finite physical-source authority port. No original regulated
 -- source/ground or complete native qualification is claimed by these controls.
 create function gridex_received_sources.billing_supply_basis_v1(c uuid,p uuid,s timestamptz,e timestamptz) returns jsonb
 language sql as $$select case when (select ok from public.test_supply_qualification) then jsonb_build_object(
 'qualified',true,'periodId',sp.id,'companyId',sp.company_id,'customerId',sp.customer_id,'meteringPointId',sp.metering_point_id,'sourceSHA256',repeat('c',64)) end
 from public.customer_supply_periods sp where sp.id=p and sp.company_id=c$$;`)
 await db.exec(fs.readFileSync(migration,'utf8').split('-- BEGIN GUARDED EXISTING NATIVE COUPLING')[0]+'\ncommit;')
 await db.exec(`
 create table public.test_finalizer_calls(args jsonb);
 create function public.gridex_get_customer_contract_signature_receipt_v1(token text) returns jsonb language sql as $$
 select jsonb_build_object('request_id',r.id,'contract_id',c.id,'signed_at',c.signed_at,'signature_snapshot_sha256',c.signature_snapshot_sha256,
 'amendment_context',r.metadata->'amendment_context','amendment_context_sha256',r.metadata->>'amendment_context_sha256')
 from public.customer_contract_signature_requests r join public.customer_contracts c on c.id=r.customer_contract_id and c.company_id=r.company_id where r.token_hash=token$$;
 -- Explicit finite EXISTING-finalizer port: these controls do not qualify the
 -- real canonical v2/POA/legal/retention/source/body patches or whole scenario.
 create function public.gridex_finalize_customer_contract_signature_v2(
 p_token_hash text,p_signed_ip_hash text default null,p_signed_user_agent text default null,p_signer_ip text default null,
 p_poa_accepted boolean default false,p_poa_scopes text[] default '{}',p_poa_terms_version text default null)
 returns jsonb language plpgsql as $$declare r public.customer_contract_signature_requests%rowtype;c public.customer_contracts%rowtype;s jsonb;at timestamptz;h text;
 begin
 select * into r from public.customer_contract_signature_requests where token_hash=p_token_hash for update;
 select * into c from public.customer_contracts where id=r.customer_contract_id for update;
 if r.used_at is not null then return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash)||jsonb_build_object('already_signed',true);end if;
 if r.revoked_at is not null or r.expires_at<=clock_timestamp() then raise exception 'expired finite request';end if;
 insert into public.test_finalizer_calls values(jsonb_build_object('poaAccepted',p_poa_accepted,'userAgent',p_signed_user_agent));
 at:=clock_timestamp();s:=jsonb_build_object('schema','gridex_online_contract_signature_v2','company_id',c.company_id,'customer_id',c.customer_id,
 'contract_id',c.id,'signature_request_id',r.id,'accepted_at',at,'pricing_snapshot_sha256',(select snapshot_hash from public.contract_price_snapshots where id=c.contract_price_snapshot_id),
 'amendment_context',r.metadata->'amendment_context','amendment_context_sha256',r.metadata->>'amendment_context_sha256');
 h:=public.canonical_json_sha256(s);
 insert into public.customer_contract_evidence(company_id,customer_contract_id,evidence_type,evidence_snapshot,evidence_sha256,captured_at)
 values(c.company_id,c.id,'online_acceptance',s,h,at);
 update public.customer_contracts set status='signed',signed_at=at,locked_at=at,signature_snapshot=s,signature_snapshot_sha256=h where id=c.id;
 update public.customer_contract_signature_requests set used_at=at where id=r.id;
 return public.gridex_get_customer_contract_signature_receipt_v1(p_token_hash)||jsonb_build_object('already_signed',false);
 end$$;`)
},30000)
afterAll(async()=>{if(db) await db.close()})
beforeEach(async()=>{
 await db.exec(`begin;set test.role='service_role';
 insert into companies(id,name,is_active,status,lifecycle_status) values('${id(1)}','Synthetic',true,'active','active');
 insert into customers(id,company_id,status) values('${id(2)}','${id(1)}','active');
 insert into customer_sites(id,company_id,customer_id) values('${id(3)}','${id(1)}','${id(2)}');
 insert into metering_points(id,company_id,site_id) values('${id(4)}','${id(1)}','${id(3)}');
 insert into company_memberships(id,company_id,user_id,status,is_active) values('${id(8)}','${id(1)}','${id(7)}','active',true);
 insert into test_permissions select '${id(1)}','${id(7)}',p,false from unnest(array['contracts.write','contracts.create']) p;
 insert into physical_source_sentinel values('${id(50)}','{"supplyContract":"original","ground":"archived"}');`)
 effective=(await db.query<{effective_day:string}>(`select to_char(date_trunc('month',clock_timestamp() at time zone 'Europe/Stockholm')+interval '1 month','YYYY-MM-DD') as effective_day`)).rows[0].effective_day
 await db.exec('insert into test_supply_qualification values(true)')
 for(const [contract,status,snapshot] of [[id(5),'signed',id(15)],[id(6),'draft',id(16)]] as const) {
  await db.query(`insert into customer_contracts(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,status,signed_at,locked_at,starts_at,contract_type,energy_direction,binding_months,notice_months,monthly_fee_sek,vat_rate,contract_price_snapshot_id,price_plan_version_id,contract_offer_id,price_snapshot,signature_snapshot,signature_snapshot_sha256)
   values($1,$2,$3,$4,$4,$5,$6,case when $6='signed' then clock_timestamp() end,case when $6='signed' then clock_timestamp() end,$7::timestamptz,'variable_monthly','consumption',null,1,39,0.25,$8,$9,$10,'{"terms":"canonical"}',case when $6='signed' then '{"accepted":"old"}'::jsonb else '{}'::jsonb end,case when $6='signed' then public.canonical_json_sha256('{"accepted":"old"}') end)`,
   [contract,id(1),id(2),id(3),id(4),status,status==='signed'?'2026-01-01':effective,snapshot,id(20),id(21)])
  await db.query(`insert into contract_price_snapshots(id,company_id,customer_id,contract_id,price_plan_version_id,snapshot_json,snapshot_hash,snapshot_quality,valid_from)
   values($1,$2,$3,$4,$5,'{"terms":"canonical"}',public.canonical_json_sha256('{"terms":"canonical"}'),'canonical',$6::date)`,[snapshot,id(1),id(2),contract,id(20),status==='signed'?'2026-01-01':effective])
 }
})
afterEach(async()=>{await db.exec('rollback')})
async function propose(patch:{company?:string;actor?:string;request?:string;successor?:string;date?:string;reason?:string;ack?:boolean}={}) {
 return (await db.query<{result:Record<string,unknown>}>(`select public.gridex_propose_signed_contract_amendment_v1($1,$2,$3,$4,$5::date,$6,$7,$8,$9) result`,
  [patch.company??id(1),id(2),id(5),patch.successor??id(6),patch.date??effective,patch.actor??id(7),patch.request??id(9),patch.reason??'Kundens nya avtal',patch.ack??true])).rows[0].result
}
async function refused(action:()=>Promise<unknown>,code='23514') {
 await db.exec('savepoint refusal');await expect(action()).rejects.toMatchObject({code});await db.exec('rollback to savepoint refusal')
}
const token='7'.repeat(64)
async function prepare() {
 await propose()
 await db.exec(`insert into customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,start_date,status)
 values('${id(60)}','${id(1)}','${id(2)}','${id(4)}','${id(5)}','2026-01-01','active');
 insert into customer_contract_signature_requests(id,company_id,customer_id,customer_contract_id,token_hash,recipient_email,expires_at,created_by,metadata)
 values('${id(30)}','${id(1)}','${id(2)}','${id(6)}','${token}','synthetic@example.invalid',clock_timestamp()+interval '1 day','${id(7)}','{}')`)
 const row=(await db.query<{metadata:Record<string,unknown>}>(`select metadata from customer_contract_signature_requests where id='${id(30)}'`)).rows[0]
 return String(row.metadata.amendment_context_sha256)
}
async function accept(hash:string,ack=true) {
 return (await db.query<{result:Record<string,unknown>}>(`select public.gridex_finalize_customer_contract_amendment_signature_v1($1,$2,$3,null,'Synthetic Browser',null,false,'{}',null) result`,[token,hash,ack])).rows[0].result
}
it('normal prepare metadata binds exact native context; a staff proposal is not customer acceptance',async()=>{
 const hash=await prepare()
 expect(hash).toMatch(/^[0-9a-f]{64}$/)
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptances')).rows).toEqual([{n:0}])
 expect((await db.query(`select signed_at from customer_contracts where id='${id(6)}'`)).rows).toEqual([{signed_at:null}])
})
it('requires explicit customer context then seals actual NEW signature atomically before commercial selection',async()=>{
 const hash=await prepare(),before=await db.query(`select to_jsonb(c) original from customer_contracts c where id='${id(5)}'`)
 const receipt=await accept(hash)
 expect(receipt.signed_at).toBeTruthy()
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptances')).rows).toEqual([{n:1}])
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptance_intents')).rows).toEqual([{n:1}])
 expect(await db.query(`select to_jsonb(c) original from customer_contracts c where id='${id(5)}'`)).toEqual(before)
 expect((await db.query(`select contract_id from customer_supply_periods where id='${id(60)}'`)).rows).toEqual([{contract_id:id(5)}])
 expect((await db.query(`select gridex_contract_amendment.physical_root_v1('${id(1)}','${id(2)}','${id(4)}','${id(6)}') root`)).rows).toEqual([{root:id(5)}])
})
it('refuses absent consent, wrong digest and generic/native direct signature attempts without side effects',async()=>{
 const hash=await prepare()
 await refused(()=>accept(hash,false),'22023')
 await refused(()=>accept('f'.repeat(64)),'23514')
 await refused(()=>db.query(`select public.gridex_finalize_customer_contract_signature_v2($1)`,[token]),'55000')
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptance_intents')).rows).toEqual([{n:0}])
 expect((await db.query('select count(*)::int n from customer_contract_evidence')).rows).toEqual([{n:0}])
})
it('rechecks actual staff authority and finalized billing overlap before creating consent intent',async()=>{
 const hash=await prepare()
 await db.exec("update test_permissions set denied=true where permission='contracts.write'")
 await refused(()=>accept(hash),'42501')
 await db.exec('update test_permissions set denied=false')
 await db.exec(`insert into billing_underlays(id,company_id,customer_id,metering_point_id,contract_id,billing_period_start,billing_period_end)
 values('${id(40)}','${id(1)}','${id(2)}','${id(4)}','${id(5)}','${effective}','${effective}'::date+interval '1 month');
 insert into gridex_billing_source.underlay_bindings values('${id(40)}')`)
 await refused(()=>accept(hash))
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptance_intents')).rows).toEqual([{n:0}])
})
it('replays exact already-signed customer evidence without a new intent or present staff mutation authority',async()=>{
 const hash=await prepare(),first=await accept(hash)
 await db.exec('delete from test_permissions;delete from company_memberships')
 const replay=await accept(hash)
 expect(replay.signature_snapshot_sha256).toBe(first.signature_snapshot_sha256)
 expect(replay.signed_at).toBe(first.signed_at)
 expect(replay.already_signed).toBe(true)
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptance_intents')).rows).toEqual([{n:1}])
 expect((await db.query('select count(*)::int n from test_finalizer_calls')).rows).toEqual([{n:1}])
})
it('a commercial successor cannot create a physical switch job or switch request',async()=>{
 await prepare()
 await refused(()=>db.exec(`insert into customer_operation_jobs(company_id,customer_id,job_type,status,payload)
 values('${id(1)}','${id(2)}','start_supplier_switch','queued','{"contract_id":"${id(6)}"}')`))
 await refused(()=>db.exec(`insert into supplier_switch_requests(company_id,customer_id,contract_id,status)
 values('${id(1)}','${id(2)}','${id(6)}','ready')`))
 expect((await db.query('select count(*)::int n from customer_operation_jobs')).rows).toEqual([{n:0}])
 expect((await db.query('select count(*)::int n from supplier_switch_requests')).rows).toEqual([{n:0}])
})

it('a restored cancelled request cannot beat its genuinely active replacement proposal',async()=>{
 const hash=await prepare()
 await db.exec(`update customer_contracts set status='cancelled' where id='${id(6)}';
 insert into customer_contracts select * from jsonb_populate_record(null::customer_contracts,
 (select to_jsonb(c)||jsonb_build_object('id','${id(66)}','status','draft','contract_price_snapshot_id','${id(166)}','customer_contract_reference','replacement') from customer_contracts c where id='${id(6)}'));
 insert into contract_price_snapshots select * from jsonb_populate_record(null::contract_price_snapshots,
 (select to_jsonb(p)||jsonb_build_object('id','${id(166)}','contract_id','${id(66)}') from contract_price_snapshots p where id='${id(16)}'))`)
 await propose({successor:id(66),request:id(10)})
 await db.exec(`update customer_contracts set status='pending_signature' where id='${id(6)}'`)
 await refused(()=>accept(hash))
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptance_intents')).rows).toEqual([{n:0}])
})

// Real, unchanged native definitions from the checked-in schema, then the
// actual forward patches. This qualifies installation/profile and real early
// routing guards, not the complete native signing/POA/source execution graph.
async function installActualOriginals() {
 for(const name of ['legal_bundle_versions','legal_bundle_version_documents','tenant_bilateral_agreements','customer_contract_documents','normalized_metering_values','pricing_runs','price_plan_versions']) await db.exec(actualTable(name))
 await db.exec(`drop function public.gridex_finalize_customer_contract_signature_v2(text,text,text,text,boolean,text[],text);
 drop function public.gridex_get_customer_contract_signature_receipt_v1(text)`)
 const names=[
  'public.gridex_finalize_customer_contract_signature_v1','public.gridex_finalize_customer_contract_signature_v2',
  'public.gridex_finalize_signature_before_record_retention_v1','public.gridex_get_customer_contract_signature_receipt_v1',
  'public.gridex_enqueue_signed_contract_operation_v1','public.gridex_finalize_admin_imported_signed_agreement_v1',
  'public.gridex_finalize_website_contract_signature','gridex_regulated_supply.scope_v1',
  'public.gridex_assert_supplier_switch_ready','public.gridex_create_supplier_switch_v1',
  'public.gridex_set_metering_billing_gate','public.gridex_store_billing_underlay','gridex_billing_source.require_underlay_v1',
  'public.gridex_persist_pricing_run','public.gridex_lock_pricing_run',
 ]
 for(const name of names) {
  for(const match of schema.matchAll(new RegExp('CREATE FUNCTION '+name.replaceAll('.','\\.')+'\\(','g'))) {
   const rest=schema.slice(match.index),tag=/AS (\$[^$]*\$)/.exec(rest)!
   await db.exec(rest.slice(0,rest.indexOf(tag[1],tag.index+tag[0].length)+tag[1].length)+';')
  }
 }
 await db.exec(`revoke all on function public.gridex_finalize_customer_contract_signature_v2(text,text,text,text,boolean,text[],text) from public;
 grant execute on function public.gridex_finalize_customer_contract_signature_v2(text,text,text,text,boolean,text[],text) to service_role`)
}
const coupling=fs.readFileSync(migration,'utf8').split('-- BEGIN GUARDED EXISTING NATIVE COUPLING')[1]?.replace(/commit;\s*$/,'')
it('installs all sixteen exact native patches preserving OID, owner, grants and complete execution profiles',async()=>{
 const hash=await prepare();expect(hash).toBeTruthy()
 await installActualOriginals()
 const profiles=`select p.oid,(to_jsonb(p)-'prosrc') profile from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in('public','gridex_regulated_supply') order by p.oid`
 const before=await db.query(profiles)
 expect(coupling).toBeTruthy();await db.exec(coupling)
 expect(await db.query(profiles)).toEqual(before)
 // A plain real v2, v1 and retained helper all reject an amendment BEFORE any
 // old lock/retention/POA code executes; these are actual native definitions.
 for(const name of ['gridex_finalize_customer_contract_signature_v2','gridex_finalize_customer_contract_signature_v1','gridex_finalize_signature_before_record_retention_v1']) {
  await refused(()=>db.query(`select public.${name}($1)`,[token]),'55000')
 }
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptance_intents')).rows).toEqual([{n:0}])
},30000)
it('rejects unknown native source drift atomically instead of silently patching a different original',async()=>{
 await installActualOriginals()
 const original=actualFunction('gridex_finalize_customer_contract_signature_v2')
 await db.exec(original.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION').replace('signature_service_role_required','changed_original_signature_service_role_required'))
 const before=await db.query(`select oid,prosrc from pg_proc where proname='gridex_finalize_customer_contract_signature_v1'`)
 await db.exec('savepoint native_drift')
 await expect(db.exec(coupling)).rejects.toMatchObject({message:expect.stringContaining('signed_amendment_native_original_drift')})
 await db.exec('rollback to savepoint native_drift;release savepoint native_drift')
 expect(await db.query(`select oid,prosrc from pg_proc where proname='gridex_finalize_customer_contract_signature_v1'`)).toEqual(before)
},30000)

async function installActualSigningFixture() {
 await installActualOriginals();await db.exec(coupling)
 for(const name of ['contract_publications','tenant_contract_assignments','contract_product_versions','contract_publication_versions','customer_contract_acceptances','customer_legal_acceptances','powers_of_attorney']) await db.exec(actualTable(name))
 await db.exec(`alter table customer_contract_acceptances add unique(customer_contract_id,acceptance_sha256);
 alter table customer_contract_evidence add unique(customer_contract_id,evidence_type,evidence_sha256);
 create schema extensions;
 create function extensions.digest(value bytea,algorithm text) returns bytea language sql immutable strict as $$select case when algorithm='sha256' then sha256(value) end$$;
 -- Explicit finite retention and event ports. Actual v2/receipt/evidence/acceptance
 -- and actual enqueue are exercised; this is not complete native qualification.
 create function public.ediel_require_contract_records_available_v1(c uuid,contract uuid) returns void language sql as $$select$$;`)
 const event=actualFunction('gridex_record_customer_contract_event_v1'),tag=/AS (\$[^$]*\$)/.exec(event)!
 await db.exec(event.slice(0,tag.index+tag[0].length)+"begin return jsonb_build_object('finite_event_port',true);end"+tag[1]+';')
 await db.exec(actualFunction('gridex_legacy_legal_type_for_module'))
 await db.exec(`create function public.gridex_assert_contract_permission(actor uuid,permission text) returns void language sql as $$select$$;`)
 await db.exec(actualFunction('gridex_prepare_signature_before_record_retention_v1'))
 await db.exec(actualFunction('gridex_prepare_customer_contract_signature_request_v1'))
 // Private-schema functions are not included in the public schema dump; load
 // the actual latest checked-in normalizer definition, not a replacement.
 const normalization=fs.readFileSync('supabase/migrations/20260819070622_pr164_review_remediation_v2.sql','utf8')
 const start=normalization.indexOf('create or replace function private.gridex_normalize_fixed_area_snapshot_v1(')
 const rest=normalization.slice(start),body=rest.indexOf('as $$')+5
 await db.exec('create schema private')
 await db.exec(rest.slice(0,rest.indexOf('$$;',body)+3))

 await db.exec(`
 insert into contract_product_versions(id,contract_product_id,version_number,customer_type,contract_type,pricing_model,content_sha256,status,locked_at,energy_direction,power_of_attorney_required)
 values('${id(72)}','${id(73)}',1,'private','variable_monthly','spot',repeat('d',64),'approved',clock_timestamp(),'consumption',false);
 insert into tenant_contract_assignments(id,company_id,contract_product_version_id) values('${id(74)}','${id(1)}','${id(72)}');
 insert into contract_publications(id,assignment_id,channel) values('${id(75)}','${id(74)}','internal');
 insert into price_plan_versions(id,company_id,price_plan_id,version_number,content_sha256,status,locked_at)
 values('${id(20)}','${id(1)}','${id(76)}',1,repeat('e',64),'published',clock_timestamp());
 insert into legal_bundle_versions(id,company_id,contract_product_version_id,version_number,legal_mode,content_sha256,status,locked_at)
 values('${id(77)}','${id(1)}','${id(72)}',1,'ops_standard',repeat('f',64),'published',clock_timestamp());
 insert into legal_bundle_version_documents(id,legal_bundle_version_id,module_key,title,rendered_body,content_sha256)
 values('${id(78)}','${id(77)}','terms','Synthetic terms','Synthetic finite terms',repeat('a',64));
 insert into contract_publication_versions(id,contract_publication_id,version_number,contract_product_version_id,legal_bundle_version_id,price_plan_version_id,customer_type,channel,content_sha256,status,locked_at,energy_direction)
 values('${id(79)}','${id(75)}',1,'${id(72)}','${id(77)}','${id(20)}','private','internal',repeat('b',64),'published',clock_timestamp(),'consumption');
 update customer_contracts set contract_publication_version_id='${id(79)}',contract_product_version_id='${id(72)}',legal_bundle_version_id='${id(77)}' where id='${id(6)}';
 create trigger actual_signed_enqueue after update of status on customer_contracts for each row execute function public.gridex_enqueue_signed_contract_operation_v1();`)
}
it('actual canonical v2 hashes customer amendment consent into ordinary signature, acceptance and evidence, without a new switch job',async()=>{
 await installActualSigningFixture()
 const hash=await prepare()
 await db.exec(`update customer_contracts set status='pending_signature' where id='${id(6)}'`)
 const receipt=await accept(hash)
 expect(receipt).toMatchObject({contract_id:id(6),amendment_context_sha256:hash,already_signed:false})
 const signed=(await db.query<{signature:Record<string,unknown>;valid:boolean}>(`select signature_snapshot signature,signature_snapshot_sha256=public.canonical_json_sha256(signature_snapshot) valid from customer_contracts where id='${id(6)}'`)).rows[0]
 expect(signed.valid).toBe(true)
 expect(signed.signature).toMatchObject({schema:'gridex_online_contract_signature_v2',amendment_context_sha256:hash,amendment_context:{predecessorContractId:id(5),successorContractId:id(6),effectiveFrom:effective}})
 expect((await db.query(`select count(*)::int n from customer_contract_evidence e join gridex_contract_amendment.acceptances a on a.signature_sha256=e.evidence_sha256 where e.customer_contract_id='${id(6)}' and e.evidence_snapshot=a.signature_snapshot`)).rows).toEqual([{n:1}])
 expect((await db.query('select count(*)::int n from customer_contract_acceptances')).rows).toEqual([{n:1}])
 expect((await db.query('select count(*)::int n from customer_operation_jobs')).rows).toEqual([{n:0}])
 expect((await db.query('select contract_id from customer_supply_periods')).rows).toEqual([{contract_id:id(5)}])
},30000)
it('the actual canonical v2 still requires product-mandated POA consent before amendment acceptance',async()=>{
 await installActualSigningFixture()
 await db.exec(`update contract_product_versions set power_of_attorney_required=true where id='${id(72)}'`)
 const hash=await prepare();await db.exec(`update customer_contracts set status='pending_signature' where id='${id(6)}'`)
 await refused(()=>accept(hash),'22023')
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptance_intents')).rows).toEqual([{n:0}])
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptances')).rows).toEqual([{n:0}])
},30000)

it('replays the original staff proposal after ordinary preparation and genuine customer acceptance without recreating it',async()=>{
 const hash=await prepare()
 const prepared=await propose()
 expect(prepared).toMatchObject({proposalId:id(9),state:'PROPOSED_NOT_ACCEPTED'})
 await accept(hash)
 expect(await propose()).toEqual(prepared)
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.proposals')).rows).toEqual([{n:1}])
 await refused(()=>propose({reason:'Different command'}),'22023')
 await db.exec("update test_permissions set denied=true where permission='contracts.write'")
 await refused(()=>propose(),'42501')
})

it('the actual ordinary prepare → public receipt → actual v2 amendment acceptance path preserves canonical material and predecessor',async()=>{
 await installActualSigningFixture();await propose()
 await db.exec(`insert into customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,start_date,status)
 values('${id(60)}','${id(1)}','${id(2)}','${id(4)}','${id(5)}','2026-01-01','active')`)
 const prepared=(await db.query<{result:Record<string,unknown>}>(`select public.gridex_prepare_customer_contract_signature_request_v1($1,$2,$3,$4,'synthetic@example.invalid',clock_timestamp()+interval '1 day',$5,'internal') result`,[id(1),id(2),id(6),token,id(7)])).rows[0].result
 expect(prepared).toMatchObject({ok:true,contract_id:id(6),status:'pending_signature'})
 const receipt=(await db.query<{result:Record<string,unknown>}>('select public.gridex_get_customer_contract_signature_receipt_v1($1) result',[token])).rows[0].result
 expect(receipt).toMatchObject({amendment_context:{predecessorContractId:id(5),successorContractId:id(6),effectiveFrom:effective}})
 expect(await accept(String(receipt.amendment_context_sha256))).toMatchObject({contract_id:id(6),already_signed:false})
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptances')).rows).toEqual([{n:1}])
 expect((await db.query('select count(*)::int n from customer_operation_jobs')).rows).toEqual([{n:0}])
},30000)

it('freezes a normal draft missing CPS through the REAL existing preparation, revokes its undelivered token, then signs a fresh amendment link',async()=>{
 await installActualSigningFixture()
 await db.exec(`update customers set email='synthetic@example.invalid' where id='${id(2)}';
 update customer_contracts set contract_price_snapshot_id=null where id='${id(6)}'`)
 const proposal=await propose()
 expect(proposal).toMatchObject({state:'PROPOSED_NOT_ACCEPTED',successorContractId:id(6)})
 const frozen=(await db.query<{id:string;source:string;quality:string}>(`select ps.id,ps.source,ps.snapshot_quality quality from customer_contracts ct join contract_price_snapshots ps on ps.id=ct.contract_price_snapshot_id where ct.id='${id(6)}'`)).rows[0]
 expect(frozen).toMatchObject({source:'signature_prepare',quality:'canonical'})
 expect(frozen.id).not.toBe(id(16))
 expect((await db.query('select revoked_at is not null revoked,used_at is null unused from customer_contract_signature_requests')).rows).toEqual([{revoked:true,unused:true}])
 await db.exec(`insert into customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,start_date,status)
 values('${id(60)}','${id(1)}','${id(2)}','${id(4)}','${id(5)}','2026-01-01','active')`)
 await db.query(`select public.gridex_prepare_customer_contract_signature_request_v1($1,$2,$3,$4,'synthetic@example.invalid',clock_timestamp()+interval '1 day',$5,'internal')`,[id(1),id(2),id(6),token,id(7)])
 const receipt=(await db.query<{result:Record<string,unknown>}>('select public.gridex_get_customer_contract_signature_receipt_v1($1) result',[token])).rows[0].result
 expect(receipt).toMatchObject({amendment_context:{successorPriceSnapshotId:frozen.id}})
 expect(await accept(String(receipt.amendment_context_sha256))).toMatchObject({contract_id:id(6),already_signed:false})
 expect((await db.query('select count(*)::int n from customer_operation_jobs')).rows).toEqual([{n:0}])
},30000)

// Optional exact donor original, kept separate from main-profile coverage.
// The original migration is 19f82746d:20261101212734; never execute an unknown
// external fixture or treat this component composition as shared native replay.
it.skipIf(!process.env.T2_REVIEWED_ZERO19_MIGRATION)('preserves the reviewed zero19 persist body while adding independent amendment revalidation',async()=>{
 await installActualOriginals()
 await db.exec(actualFunction('gridex_read_interval_pricing_snapshot_v1'))
 await db.exec(`revoke all on function public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb),public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
 grant execute on function public.gridex_read_interval_pricing_snapshot_v1(uuid,uuid,timestamptz,timestamptz,text,text,jsonb),public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb) to service_role`)
 const original=fs.readFileSync(process.env.T2_REVIEWED_ZERO19_MIGRATION!,'utf8')
 expect(createHash('sha256').update(original).digest('hex')).toBe('fedf3f77c3ce16a8975d59557742c1dfb6e21d37e24818f962a3b36968b232bb')
 await db.exec(original.replace(/^BEGIN;$/m,'').replace(/^COMMIT;$/m,''))
 const before=(await db.query<{oid:number;profile:Record<string,unknown>;body:string}>(`select oid,to_jsonb(p)-'prosrc' profile,prosrc body from pg_proc p where oid='public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure`)).rows[0]
 expect(createHash('sha256').update(before.body).digest('hex')).toBe('0b196e776dc3c83b4edba4172ce3f0399f93eb50f09c43717f6e4d645c02a11b')
 await db.exec(coupling)
 const after=(await db.query<{oid:number;profile:Record<string,unknown>;body:string}>(`select oid,to_jsonb(p)-'prosrc' profile,prosrc body from pg_proc p where oid='public.gridex_persist_pricing_run(uuid,uuid,jsonb,jsonb)'::regprocedure`)).rows[0]
 expect(after.oid).toBe(before.oid);expect(after.profile).toEqual(before.profile)
 // Removing exactly our two bounded insertions must recover the donor bytes.
 const restored=after.body.replace("  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text||':billing-underlay-batch',0));\n PERFORM gridex_bilateral_prodat.lock_supply_v1();PERFORM gridex_regulated_supply.lock_graph_v1();\n",'')
  .replace('\n  IF v_source_bound THEN PERFORM gridex_billing_source.require_underlay_v1(p_company_id,p_billing_underlay_id);END IF;','')
 expect(restored).toBe(before.body)
},30000)

async function nativeCommercialConsumerFixture(acceptAmendment=true) {
 await installActualSigningFixture()
 const hash=await prepare();await db.exec(`update customer_contracts set status='pending_signature' where id='${id(6)}'`)
 if(acceptAmendment) await accept(hash)
 for(const name of ['underlay_bindings','correction_journal']) {
  if(name==='underlay_bindings') await db.exec('drop table gridex_billing_source.underlay_bindings')
  const text=schema.match(new RegExp(`CREATE TABLE gridex_billing_source\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  if(!text) throw new Error('actual private source table missing')
  await db.exec(text)
 }
 await db.exec(`alter table gridex_billing_source.underlay_bindings add primary key(underlay_id);
 create function public.ediel_require_invoice_source_copies_available_v1(c uuid,u uuid) returns void language sql as $$select$$;
 -- Explicit finite source-copy/quality/lock/delegate ports. Real public store,
 -- gate, require-underlay and pricing early validation bodies execute below.
 -- No genuine E66/source-copy/native-producer qualification is claimed.
 create function gridex_billing_source.lock_values_v1(c uuid,ids uuid[],period uuid) returns void language plpgsql as $$begin
 insert into public.test_graph_lock_order values('source_value_rows');end$$;
 create function gridex_billing_source.basis_v1(c uuid,n uuid) returns jsonb language sql as $$
 select jsonb_build_object('qualified',true,'qualityEstablished',true,'quality',null,'productCode','finite-energy','registerCode','finite-register')$$;
 create table public.test_gate_delegate_calls(gate jsonb);
 create function gridex_billing_source.gridex_set_metering_billing_gate_before_source_v2(c uuid,m uuid,n uuid,g jsonb) returns jsonb language plpgsql as $$begin
 insert into public.test_gate_delegate_calls values(g);return g;end$$;
 create function gridex_billing_source.gridex_store_billing_underlay_before_source_v2(c uuid,u jsonb,items jsonb,actor uuid) returns uuid language plpgsql as $$begin
 insert into public.billing_underlays(id,company_id,customer_id,metering_point_id,supply_period_id,contract_id,contract_price_snapshot_id,pricing_snapshot_id,total_kwh,
 billing_period_start,billing_period_end,underlay_year,underlay_month,energy_direction,pricing_snapshot)
 values((u->>'id')::uuid,c,(u->>'customer_id')::uuid,(u->>'metering_point_id')::uuid,(u->>'supply_period_id')::uuid,(u->>'contract_id')::uuid,
 (u->>'contract_price_snapshot_id')::uuid,(u->>'pricing_snapshot_id')::uuid,(u->>'total_kwh')::numeric,
 (u->>'billing_period_start')::timestamptz at time zone 'Europe/Stockholm',(u->>'billing_period_end')::timestamptz at time zone 'Europe/Stockholm',
 (u->>'underlay_year')::int,(u->>'underlay_month')::int,u->>'energy_direction',u->'pricing_snapshot');return (u->>'id')::uuid;end$$;`)
 const times=(await db.query<{start:string;end:string}>(`select gridex_contract_amendment.instant_v1('${effective}'::date::timestamp at time zone 'Europe/Stockholm') start,
 gridex_contract_amendment.instant_v1(('${effective}'::date+interval '1 month') at time zone 'Europe/Stockholm') "end"`)).rows[0]
 await db.query(`insert into normalized_metering_values(id,company_id,customer_id,metering_point_id,supply_period_id,source_metering_value_id,source_message_id,period_start,period_end,quantity_kwh,source_type,billing_status,billing_gate_status)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9,41,'finite_component_port','billable','eligible')`,[id(80),id(1),id(2),id(4),id(60),id(81),id(82),times.start,times.end])
 const assignment=(await db.query<{result:Record<string,unknown>}>(`select public.gridex_read_contract_commercial_segments_v1($1,$2,$3,$4) result`,[id(1),id(60),times.start,times.end])).rows[0].result
 const underlay={id:id(90),customer_id:id(2),metering_point_id:id(4),supply_period_id:id(60),contract_id:id(6),contract_price_snapshot_id:id(16),pricing_snapshot_id:id(16),price_plan_version_id:id(20),
  pricing_snapshot:{terms:'canonical'},status:'validated',readiness_status:'ready',total_kwh:41,underlay_year:Number(effective.slice(0,4)),underlay_month:Number(effective.slice(5,7)),energy_direction:'consumption',billing_period_start:times.start,billing_period_end:times.end}
 const items=[{source_normalized_metering_value_id:id(80),quantity_kwh:41,quantity:41,unit:'kWh',product_code:'finite-energy',register_code:'finite-register',period_start:times.start,period_end:times.end}]
 async function store(patch:Record<string,unknown>={}) {
  await db.exec('set local role service_role')
  const result=await db.query(`select public.gridex_store_billing_underlay($1,$2::jsonb,$3::jsonb,null)`,[id(1),JSON.stringify({...underlay,...patch}),JSON.stringify(items)])
  await db.exec('reset role');return result
 }
 async function gate(patch:Record<string,unknown>={}) {
  const payload={billing_status:'billable',billing_gate_status:'eligible',source_message_id:id(82),supply_period_id:id(60),billing_gate_snapshot:{contract_id:id(6),commercial_assignment:assignment},...patch}
  await db.exec('set local role service_role')
  const result=(await db.query<{result:Record<string,unknown>}>(`select public.gridex_set_metering_billing_gate($1,$2,$3,$4::jsonb) result`,[id(1),id(81),id(80),JSON.stringify(payload)])).rows[0].result
  await db.exec('reset role');return result
 }
 return {store,gate,assignment,times,hash,underlay,items}
}
it('actual native store accepts only the effective commercial child and exact CPS, preserving physical source and revalidating its binding',async()=>{
 const {store,assignment}=await nativeCommercialConsumerFixture()
 // On failure the transaction is aborted until refused rolls back; these
 // direct calls run inside its savepoint with an explicit role reset afterwards.
 await db.exec('savepoint wrong_root')
 await expect(store({contract_id:id(5),contract_price_snapshot_id:id(15),pricing_snapshot_id:id(15)})).rejects.toMatchObject({code:'23514',message:'signed_amendment_commercial_contract_price_mismatch'})
 await db.exec('rollback to savepoint wrong_root;reset role;release savepoint wrong_root')
 await db.exec('savepoint wrong_price')
 await expect(store({contract_price_snapshot_id:id(15),pricing_snapshot_id:id(15)})).rejects.toMatchObject({code:'23514',message:'billing_underlay_supply_contract_price_basis_required'})
 await db.exec('rollback to savepoint wrong_price;reset role;release savepoint wrong_price')
 await store()
 const binding=(await db.query<{basis:Record<string,unknown>}>(`select source_basis basis from gridex_billing_source.underlay_bindings where underlay_id='${id(90)}'`)).rows[0].basis
 expect(binding).toMatchObject({contractId:id(6),supply:{periodId:id(60)},commercialAssignment:assignment})
 await db.query(`select gridex_billing_source.require_underlay_v1($1,$2)`,[id(1),id(90)])
 expect((await db.query('select contract_id from customer_supply_periods')).rows).toEqual([{contract_id:id(5)}])
},30000)
it('actual native eligible gate independently rejects forged old-contract snapshots and retains the recomputed child assignment',async()=>{
 const {gate,assignment}=await nativeCommercialConsumerFixture()
 await db.exec('savepoint wrong_gate')
 await expect(gate({billing_gate_snapshot:{contract_id:id(5)}})).rejects.toMatchObject({code:'23514',message:'billing_gate_commercial_assignment_mismatch'})
 await db.exec('rollback to savepoint wrong_gate;reset role;release savepoint wrong_gate')
 expect((await db.query('select count(*)::int n from test_gate_delegate_calls')).rows).toEqual([{n:0}])
 expect(await gate()).toMatchObject({billing_gate_snapshot:{contract_id:id(6),commercial_assignment:assignment}})
},30000)
it('actual require, persist and lock bodies reject a source-bound stale commercial version before pricing writes or locked replay',async()=>{
 const {store,times}=await nativeCommercialConsumerFixture();await store()
 await db.exec(`update billing_underlays set contract_id='${id(5)}',contract_price_snapshot_id='${id(15)}',pricing_snapshot_id='${id(15)}' where id='${id(90)}'`)
 await refused(()=>db.query(`select gridex_billing_source.require_underlay_v1($1,$2)`,[id(1),id(90)]))
 await refused(()=>db.query(`select public.gridex_persist_pricing_run($1,$2,'{"status":"failed"}','{"terms":"canonical"}')`,[id(1),id(90)]))
 await db.query(`insert into pricing_runs(id,company_id,billing_underlay_id,status,billing_period_start,billing_period_end) values($1,$2,$3,'locked',$4,$5)`,[id(91),id(1),id(90),times.start,times.end])
 await refused(()=>db.query(`select public.gridex_lock_pricing_run($1,$2,null)`,[id(1),id(91)]))
},30000)

it('matches the real old native store hash for an unaccepted legacy root and prevents later amendment over finalized billing',async()=>{
 const {store,hash,underlay,items}=await nativeCommercialConsumerFixture(false)
 await db.exec(actualFunction('gridex_store_billing_underlay').replace('CREATE FUNCTION public.gridex_store_billing_underlay(', 'CREATE FUNCTION public.test_original_unamended_store('))
 const rootUnderlay={...underlay,contract_id:id(5),contract_price_snapshot_id:id(15),pricing_snapshot_id:id(15)}
 await db.exec('set local role service_role')
 await db.query(`select public.test_original_unamended_store($1,$2::jsonb,$3::jsonb,null)`,[id(1),JSON.stringify(rootUnderlay),JSON.stringify(items)])
 await db.exec('reset role')
 const original=await db.query('select source_basis,source_basis_hash,exact_total_kwh from gridex_billing_source.underlay_bindings')
 await store({contract_id:id(5),contract_price_snapshot_id:id(15),pricing_snapshot_id:id(15)})
 expect(await db.query('select source_basis,source_basis_hash,exact_total_kwh from gridex_billing_source.underlay_bindings')).toEqual(original)
 await refused(()=>accept(hash))
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptances')).rows).toEqual([{n:0}])
},30000)

it('rechecks current staff authority at the actual contract transition after canonical evidence callbacks',async()=>{
 await installActualSigningFixture();const hash=await prepare()
 await db.exec(`update customer_contracts set status='pending_signature' where id='${id(6)}';
 create function public.test_revoke_during_evidence() returns trigger language plpgsql as $$begin
 update public.test_permissions set denied=true where permission='contracts.write';return new;end$$;
 create trigger finite_late_permission_change after insert on customer_contract_evidence for each row execute function public.test_revoke_during_evidence()`)
 await refused(()=>accept(hash),'42501')
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptances')).rows).toEqual([{n:0}])
 expect((await db.query('select count(*)::int n from customer_contract_evidence')).rows).toEqual([{n:0}])
},30000)
it('an actual request expiry reached after the signature instant but before the contract transition cannot be accepted',async()=>{
 await installActualSigningFixture();const hash=await prepare()
 await db.exec(`update customer_contracts set status='pending_signature' where id='${id(6)}';
 create function public.test_expire_during_evidence() returns trigger language plpgsql as $$begin
 update public.customer_contract_signature_requests set expires_at=clock_timestamp() where id='${id(30)}';return new;end$$;
 create trigger finite_late_expiry after insert on customer_contract_evidence for each row execute function public.test_expire_during_evidence()`)
 await refused(()=>accept(hash),'55000')
 expect((await db.query('select count(*)::int n from gridex_contract_amendment.acceptances')).rows).toEqual([{n:0}])
},30000)

it('cannot turn an ordinary prepared request into an amendment by adding caller metadata later',async()=>{
 await db.exec(`insert into customer_contract_signature_requests(id,company_id,customer_id,customer_contract_id,token_hash,recipient_email,expires_at,created_by,metadata)
 values('${id(30)}','${id(1)}','${id(2)}','${id(6)}','${token}','synthetic@example.invalid',clock_timestamp()+interval '1 day','${id(7)}','{}')`)
 await refused(()=>db.exec(`update customer_contract_signature_requests set metadata='{"amendment_context":{"fabricated":true},"amendment_context_sha256":"${'f'.repeat(64)}"}' where id='${id(30)}'`))
})
