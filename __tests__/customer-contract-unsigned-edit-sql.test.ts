import fs from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest'
import {prePr932UnsignedEditSchema} from './helpers/db05PredecessorSchema'

// Actual transaction SQL in PostgreSQL WASM; permission resolution, legal/
// price materialization and event routing are finite external ports here.
// The existing native owner must qualify those complete real dependencies.
// The forward is applied to the exact pre-PR932 capture, never to a capture
// that already contains it.
const schema=prePr932UnsignedEditSchema(fs.readFileSync('supabase/schema.sql','utf8'))
const forward='supabase/migrations/20261029105939_edit_unsigned_customer_contract_atomic.sql'
const id=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const instant='2026-10-29T10:00:00.123456+00:00'
const tables=['companies','customers','customer_sites','metering_points','customer_contracts','customer_contract_signature_requests',
  'contract_price_snapshots','canonical_command_results','customer_contract_events','contract_offers','contract_product_versions',
  'contract_publication_versions','price_plans','price_plan_versions','price_books','legal_bundle_versions','ediel_business_errors']
const components=[
  {component_code:'invoice_fee',name:'Invoice',unit:'sek_invoice',amount:19,calculation_type:'per_invoice',metadata:{component_key:'invoice_fee',visibility:{invoice:true,website_card:false}},priority:110},
  {component_code:'electricity_certificate',name:'Certificate',unit:'ore_per_kwh',amount:1.7,calculation_type:'per_kwh',metadata:{component_key:'electricity_certificate',untouched:'EXACT'},priority:160},
]
const bases=[{source_type:'spot',label:'Spot',weight_percent:100,price_area:'SE4'}]
const pricing={pricing_model:'spot',contract_type:'variable_monthly',energy_direction:'consumption',vat_rate:0.25,price_areas:['SE4'],
  invoice_fee_sek:19,spot_markup_ore_per_kwh:1,base_components:bases,base_price_components_snapshot:bases,
  price_components:components,price_components_snapshot:components,contract_id:id(3),price_plan_version_id:id(7)}
let db:PGlite
beforeAll(async()=>{
 db=new PGlite()
 await db.exec(`create schema auth;create schema extensions;create role anon;create role authenticated;create role service_role;
  create function auth.role() returns text language sql as $$select current_setting('test.role',true)$$;
  create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
  create function extensions.digest(text,text) returns bytea language sql immutable as $$select sha256(convert_to($1,'UTF8'))$$;
  create function public.canonical_json_sha256(jsonb) returns text language sql immutable as $$select encode(sha256(convert_to($1::text,'UTF8')),'hex')$$;`)
 for(const name of tables){
  const ddl=schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))![0]
  const cols=ddl.split('\n').slice(1,-1).filter(s=>/^    [a-z_][a-z0-9_]* /.test(s)).map(s=>{
   let c=s.trim().replace(/,$/,'').replace(/ NOT NULL/g,'')
   if(c.includes(' GENERATED ALWAYS AS'))c=c.slice(0,c.indexOf(' GENERATED ALWAYS AS'))
   if(/DEFAULT public\./.test(c))c=c.slice(0,c.indexOf(' DEFAULT'))
   return c.startsWith('id uuid')?'id uuid default gen_random_uuid() primary key':c
  })
  await db.exec(`create table public.${name}(${cols.join(',')})`)
 }
 await db.exec(`create unique index command_dedupe on canonical_command_results(company_id,command_type,idempotency_key);
  create table test_permissions(company_id uuid,actor_id uuid,permission text);
  create table test_materialized(payload jsonb,snapshot jsonb);
  create table test_fault(value boolean);
  create function public.gridex_actor_has_company_permission(a uuid,c uuid,p text) returns boolean language sql as $$
    select exists(select from test_permissions where company_id=c and actor_id=a and permission=p)$$;
  create function public.gridex_assert_contract_permission(a uuid,p text) returns void language plpgsql as $$begin
    if not exists(select from test_permissions where actor_id=a and permission=p) then raise exception using errcode='42501',message='contract_permission_denied';end if;end$$;
  create function public.ediel_require_contract_records_available_v1(uuid,uuid) returns void language plpgsql as $$begin return;end$$;
  create function public.gridex_prepare_manual_contract_binding(c uuid,p jsonb,s jsonb,a uuid) returns jsonb language plpgsql as $$
  declare o uuid:=gen_random_uuid();v uuid:=gen_random_uuid();pub uuid:=gen_random_uuid();l uuid:=gen_random_uuid();plan uuid:=gen_random_uuid();ppv uuid:=gen_random_uuid();book uuid:=gen_random_uuid();
  begin
    perform public.gridex_assert_contract_permission(a,'contracts.create');perform public.gridex_assert_contract_permission(a,'pricing.write');
    insert into test_materialized values(p,s);
    insert into price_plans(id,company_id,plan_code) values(plan,c,'synthetic-isolated-'||o::text);
    insert into price_plan_versions(id,company_id,price_plan_id,status,locked_at,snapshot_json) values(ppv,c,plan,'published',clock_timestamp(),s);
    insert into price_books(id,company_id,price_plan_version_id) values(book,c,ppv);
    insert into legal_bundle_versions(id,company_id,status,locked_at,unresolved_variables,rendered_snapshot) values(l,c,'published',clock_timestamp(),'{}','{"terms":"new current terms"}');
    insert into contract_product_versions(id,contract_product_id,status,locked_at,commercial_snapshot) values(v,o,'approved',clock_timestamp(),s);
    insert into contract_publication_versions(id,contract_product_version_id,price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,status,locked_at,offer_reference) values(pub,v,plan,ppv,book,l,'published',clock_timestamp(),'NEW-SYNTHETIC');
    insert into contract_offers(id,company_id,contract_product_id,contract_product_version_id) values(o,c,o,v);
    return jsonb_build_object('contract_offer_id',o,'contract_product_id',o,'contract_product_version_id',v,'contract_publication_version_id',pub,'price_plan_id',plan,'price_plan_version_id',ppv,'price_book_id',book,'legal_bundle_version_id',l,'offer_reference','NEW-SYNTHETIC','commercial_snapshot',s,'legal_snapshot',jsonb_build_object('terms','new current terms'));
  end$$;
  create function public.gridex_record_customer_contract_event_v1(c uuid,k uuid,u uuid,t text,at timestamptz,n text,m jsonb,a uuid,d timestamptz,key text) returns jsonb language plpgsql as $$begin
    if exists(select from test_fault where value) then raise exception 'SYNTHETIC_AUDIT_FAILURE';end if;
    insert into customer_contract_events(company_id,customer_contract_id,customer_id,event_type,metadata,actor_user_id) values(c,k,u,t,m,a);return '{}'::jsonb;end$$;`)
 // Run the real insert-time canonical binder/hash guards: finite materializer
 // ports must not hide mixed old/new graph identities or post-trigger hashes.
 for(const name of ['gridex_fill_contract_price_snapshot_binding_v1','gridex_enforce_contract_price_snapshot_hash_v1','gridex_apply_contract_offer_standard_fees']){
  const body=schema.match(new RegExp(`CREATE FUNCTION public\\.${name}\\(\\) RETURNS trigger[\\s\\S]*?\\$\\$;`))![0]
  await db.exec(body)
 }
 await db.exec(`create trigger aab_binding before insert on contract_price_snapshots for each row execute function gridex_fill_contract_price_snapshot_binding_v1();
  create trigger zzzz_hash before insert on contract_price_snapshots for each row execute function gridex_enforce_contract_price_snapshot_hash_v1();
  create trigger gridex_apply_contract_offer_standard_fees_trg before insert or update of contract_offer_id,source_type on customer_contracts for each row execute function gridex_apply_contract_offer_standard_fees();
  create unique index contract_price_snapshots_contract_valid_from_uidx on contract_price_snapshots(company_id,contract_id,valid_from) where contract_id is not null;`)
 const profile=JSON.parse(fs.readFileSync('scripts/helpers/ediel-poa-contract-trigger-profile.native.json','utf8')) as {functions:Array<{identity:string;ddl:string}>}
 await db.exec(profile.functions.find(f=>f.identity.startsWith('public.gridex_add_months_timestamptz('))!.ddl)
 await db.exec(fs.readFileSync('supabase/migrations/20261028091248_allow_contract_signature_before_supply_start.sql','utf8').split('-- Online signing V2:')[0])
 await db.exec('create trigger trg_gridex_customer_contracts_auto_renew_guard before insert or update on customer_contracts for each row execute function gridex_customer_contracts_auto_renew_guard()')
 await db.exec(schema.match(/CREATE VIEW public\.gridex_billing_launch_readiness_v[\s\S]*?;(?=\n\n--)/)![0])
 await db.exec(fs.readFileSync(forward,'utf8'))
})
afterAll(async()=>{await db.close()})
beforeEach(async()=>{
 await db.exec(`truncate ${tables.join(',')},gridex_unsigned_contract_revision.price_revisions,test_permissions,test_materialized,test_fault;set test.role='service_role';
  insert into companies(id,is_active,lifecycle_status,status) values('${id(1)}',true,'active','active');
  insert into customers(id,company_id,status) values('${id(2)}','${id(1)}','active');
  insert into customer_sites(id,company_id,customer_id,price_area_code,grid_area_code) values('${id(4)}','${id(1)}','${id(2)}','SE4','SKV');
  insert into price_plans(id,company_id) values('${id(8)}','${id(1)}');
  insert into price_plan_versions(id,company_id,price_plan_id,status,locked_at) values('${id(7)}','${id(1)}','${id(8)}','published',now());
  insert into price_books(id,company_id,price_plan_version_id) values('${id(9)}','${id(1)}','${id(7)}');
  insert into legal_bundle_versions(id,company_id,status,locked_at,unresolved_variables) values('${id(12)}','${id(1)}','published',now(),'{}');
  insert into contract_product_versions(id,contract_product_id,status,locked_at) values('${id(10)}','${id(17)}','approved',now());
  insert into contract_publication_versions(id,contract_product_version_id,price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,status,locked_at)
   values('${id(11)}','${id(10)}','${id(8)}','${id(7)}','${id(9)}','${id(12)}','published',now());
  insert into contract_offers(id,company_id,contract_product_id,contract_product_version_id) values('${id(5)}','${id(1)}','${id(17)}','${id(10)}');
  insert into customer_contracts(id,company_id,customer_id,status,contract_name,contract_type,energy_direction,vat_rate,contract_offer_id,contract_price_snapshot_id,price_plan_version_id,price_plan_id,price_book_id,contract_product_version_id,contract_publication_version_id,legal_bundle_version_id,invoice_fee_sek,spot_markup_ore_per_kwh,price_area_used,price_snapshot,campaign_snapshot,actual_start_at,billing_blocker_reasons,updated_at)
  values('${id(3)}','${id(1)}','${id(2)}','pending_signature','Synthetic proposal','variable_monthly','consumption',0.25,'${id(5)}','${id(6)}','${id(7)}','${id(8)}','${id(9)}','${id(10)}','${id(11)}','${id(12)}',19,1,'SE4','{"opaque":"ORIGINAL"}','{"campaign":"KEEP"}','2026-10-01','[{"reason":"KEEP"}]','${instant}');
  insert into customer_contract_signature_requests(id,company_id,customer_id,customer_contract_id,token_hash,expires_at,metadata) values('${id(13)}','${id(1)}','${id(2)}','${id(3)}','old-token',now()+interval '1 day','{"original":"KEEP"}');
  insert into test_permissions select '${id(1)}'::uuid,'${id(14)}'::uuid,p from unnest(array['contracts.write','contracts.create','pricing.write']) p;`)
 await db.exec(`update customer_contracts set contract_product_id='${id(17)}' where id='${id(3)}'`)
 await db.query(`insert into contract_price_snapshots(id,company_id,customer_id,contract_id,price_plan_version_id,snapshot_json,snapshot_hash,price_components_snapshot,base_price_components_snapshot,snapshot_quality,valid_from)
  values($1,$2,$3,$4,$5,$6::jsonb,public.canonical_json_sha256($6::jsonb),$7::jsonb,$8::jsonb,'canonical',current_date)`,[id(6),id(1),id(2),id(3),id(7),JSON.stringify(pricing),JSON.stringify(components),JSON.stringify(bases)])
})
async function edit(patch:Record<string,unknown>,ack=true,editId=id(15),expected=instant){
 try{const {rows}=await db.query<{result:Record<string,unknown>}>(`select public.gridex_edit_unsigned_customer_contract_v1($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::timestamptz,$7::jsonb,$8::boolean) result`,[id(1),id(2),id(3),id(14),editId,expected,JSON.stringify(patch),ack]);return rows[0].result}
 catch(e){return {error:(e as {code:string}).code,message:(e as Error).message}}
}
async function counts(){const {rows}=await db.query<{state:unknown}>(`select jsonb_build_object(${tables.map(t=>`'${t}',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from ${t} r)`).join(',')},'revision_origins',(select coalesce(jsonb_agg(to_jsonb(r) order by r.snapshot_id),'[]') from gridex_unsigned_contract_revision.price_revisions r)) state`);return rows[0].state}
describe('actual atomic unsigned agreement edit transaction',()=>{
 it('updates one charge, appends a ledger, retains the certificate object and both preferred signing aliases, and revokes the old request',async()=>{
  const result=await edit({invoice_fee_sek:25.5,override_reason:'Synthetic fee proposal'})
  expect(result).toMatchObject({ok:true,contract_id:id(3),pricing_revised:true,links_revoked:1})
  const {rows}=await db.query<{invoice:number;old:unknown;fresh:typeof pricing;revoked:boolean;oldRequest:unknown}>(`select c.invoice_fee_sek::float8 invoice,o.snapshot_json old,n.snapshot_json fresh,r.revoked_at is not null revoked,r.metadata "oldRequest" from customer_contracts c join contract_price_snapshots o on o.id='${id(6)}' join contract_price_snapshots n on n.id=c.contract_price_snapshot_id join customer_contract_signature_requests r on r.id='${id(13)}' where c.id='${id(3)}'`)
  expect(rows[0].invoice).toBe(25.5);expect(rows[0].old).toMatchObject(pricing);expect(rows[0].fresh.price_components[0].amount).toBe(25.5)
  expect(rows[0].fresh.price_components[1]).toEqual(components[1]);expect(rows[0].fresh.price_components_snapshot).toEqual(rows[0].fresh.price_components)
  expect(rows[0].fresh.base_price_components_snapshot).toEqual(bases);expect(rows[0].revoked).toBe(true);expect(rows[0].oldRequest).toEqual({original:'KEEP'})
  const {rows:binding}=await db.query<{coherent:boolean}>(`select c.price_snapshot=s.snapshot_json and c.snapshot_hash=s.snapshot_hash
   and (s.snapshot_json->>'contract_product_version_id')::uuid=c.contract_product_version_id
   and (s.snapshot_json->>'contract_publication_version_id')::uuid=c.contract_publication_version_id
   and (s.snapshot_json->>'legal_bundle_version_id')::uuid=c.legal_bundle_version_id coherent
   from customer_contracts c join contract_price_snapshots s on s.id=c.contract_price_snapshot_id where c.id='${id(3)}'`)
  expect(binding[0].coherent).toBe(true)
 })
 it('can revise the same unsigned agreement twice without mutating either previous ledger',async()=>{
  expect(await edit({invoice_fee_sek:25,override_reason:'First'})).toMatchObject({ok:true})
  const first=await counts(),{rows}=await db.query<{stamp:string}>(`select to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') stamp from customer_contracts where id='${id(3)}'`)
  expect(await edit({invoice_fee_sek:26,override_reason:'Second'},true,id(16),rows[0].stamp)).toMatchObject({ok:true,links_revoked:0})
  const {rows:ledgers}=await db.query<{invoices:number[]}>(`select jsonb_agg((snapshot_json->>'invoice_fee_sek')::numeric order by created_at) invoices from contract_price_snapshots`)
  expect(ledgers[0].invoices).toEqual([19,25,26]);expect(await counts()).not.toEqual(first)
 })
 it('refreshes calendar and renewal terms throughout the new proposal without changing operational start facts',async()=>{
  expect(await edit({starts_at:'2026-12-01',ends_at:'2027-12-01',notice_months:2,auto_renew_enabled:true,auto_renew_term_months:12,override_reason:'New complete terms'})).toMatchObject({ok:true})
  const {rows}=await db.query<{coherent:boolean}>(`select c.price_snapshot->>'starts_at'='2026-12-01' and c.price_snapshot->>'ends_at'='2027-12-01'
   and c.price_snapshot->>'notice_months'='2'
   and c.price_snapshot->>'auto_renew_term_months'='12' and s.valid_from=c.starts_at and s.valid_to=c.ends_at
   and c.actual_start_at='2026-10-01' coherent from customer_contracts c join contract_price_snapshots s on s.id=c.contract_price_snapshot_id where c.id='${id(3)}'`)
  expect(rows[0].coherent).toBe(true)
 })
 it('holds campaign/version changes instead of leaving parallel metadata inconsistent',async()=>{
  const before=await counts();expect(await edit({terms_version:'forged-label',override_reason:'Cannot relabel terms'})).toMatchObject({error:'22023',message:'unsigned_contract_edit_campaign_version_requires_template'});expect(await counts()).toEqual(before)
 })
 it('saves a staff-only comment without revoking customer-visible agreement links',async()=>{
  expect(await edit({override_reason:'Staff-only note'},false)).toMatchObject({ok:true,pricing_revised:false,links_revoked:0})
 })
 it('refuses installing the reserved source policy over pre-existing unproven labels',async()=>{
  const other=new PGlite()
  try{
   await other.exec("create table public.contract_price_snapshots(source text);insert into public.contract_price_snapshots values('customer_contract_unsigned_edit');")
   await expect(other.exec(fs.readFileSync(forward,'utf8'))).rejects.toMatchObject({message:'unsigned_contract_edit_reserved_source_already_present'})
   await other.exec('rollback')
   const {rows}=await other.query<{schema:null}>('select to_regnamespace(\'gridex_unsigned_contract_revision\')::text schema')
   expect(rows[0].schema).toBeNull()
  }finally{await other.close()}
 })
 it('freezes the actual derived commercial end date from the installed contract trigger',async()=>{
  expect(await edit({starts_at:'2027-01-01',ends_at:null,binding_months:12,override_reason:'Complete new dated agreement'})).toMatchObject({ok:true})
  const {rows}=await db.query<{coherent:boolean}>(`select c.ends_at='2028-01-01' and s.valid_to=c.ends_at and s.snapshot_json->>'ends_at'='2028-01-01'
   coherent from customer_contracts c join contract_price_snapshots s on s.id=c.contract_price_snapshot_id where c.id='${id(3)}'`)
  expect(rows[0].coherent).toBe(true)
 })
 it('keeps legacy date uniqueness and refuses a forged revision source without private transaction provenance',async()=>{
  const insert=`insert into contract_price_snapshots(id,company_id,customer_id,contract_id,price_plan_version_id,snapshot_json,snapshot_hash,valid_from,source)
   select gen_random_uuid(),company_id,customer_id,contract_id,price_plan_version_id,snapshot_json,snapshot_hash,valid_from,$1 from contract_price_snapshots where id='${id(6)}'`
  await expect(db.query(insert,['signature_prepare'])).rejects.toMatchObject({code:'23505'})
  await expect(db.query(insert,['customer_contract_unsigned_edit'])).rejects.toMatchObject({code:'42501',message:'unsigned_contract_price_revision_origin_required'})
 })
 it('keeps revision provenance private and immutable after a successful save',async()=>{
  expect(await edit({invoice_fee_sek:25,override_reason:'Controlled revision'})).toMatchObject({ok:true})
  const before=await counts()
  await expect(db.query('update gridex_unsigned_contract_revision.price_revisions set edit_id=$1',[id(99)])).rejects.toMatchObject({code:'55000'})
  await expect(db.query('delete from gridex_unsigned_contract_revision.price_revisions')).rejects.toMatchObject({code:'55000'})
  expect(await counts()).toEqual(before)
  const {rows}=await db.query<{closed:boolean}>(`select not has_schema_privilege('service_role','gridex_unsigned_contract_revision','usage')
   and not has_table_privilege('service_role','gridex_unsigned_contract_revision.price_revisions','insert') closed`)
  expect(rows[0].closed).toBe(true)
 })
 it('holds readiness for a missing current pointer instead of choosing a retained unsigned proposal',async()=>{
  expect(await edit({invoice_fee_sek:25,override_reason:'New proposal'})).toMatchObject({ok:true})
  await db.exec(`update customer_contracts set contract_price_snapshot_id=null where id='${id(3)}'`)
  const {rows}=await db.query<{missing:boolean}>(`select blockers @> array['contract_price_snapshot_missing'] missing from gridex_billing_launch_readiness_v where contract_id='${id(3)}'`)
  expect(rows[0].missing).toBe(true)
 })
 it.each([
  ['start_fee_sek','start_fee','sek_contract','fixed_once'],
  ['admin_fee_sek','administration_fee','sek_contract','fixed_once'],
  ['break_fee_sek','break_fee','sek_event','event_only'],
 ] as const)('adds a previously absent %s with its exact canonical lifecycle and keeps the certificate',async(field,code,unit,calculation)=>{
  expect(await edit({[field]:75,override_reason:'New customer-specific fee'})).toMatchObject({ok:true})
  const {rows}=await db.query<{components:Array<Record<string,unknown>>}>(`select s.price_components_snapshot components from customer_contracts c join contract_price_snapshots s on s.id=c.contract_price_snapshot_id where c.id='${id(3)}'`)
  expect(rows[0].components.find(c=>c.component_code===code)).toMatchObject({amount:75,unit,calculation_type:calculation})
  expect(rows[0].components.find(c=>c.component_code==='electricity_certificate')).toEqual(components[1])
 })
 it('keeps opaque commercial JSON and unsubmitted operational dates during a site-only save',async()=>{
  expect(await edit({site_id:id(4)},false)).toMatchObject({ok:true,pricing_revised:false,links_revoked:1})
  const {rows}=await db.query<Record<string,unknown>>(`select price_snapshot,campaign_snapshot,actual_start_at,billing_blocker_reasons,customer_site_id,site_id from customer_contracts where id='${id(3)}'`)
  expect(rows[0]).toMatchObject({price_snapshot:{opaque:'ORIGINAL'},campaign_snapshot:{campaign:'KEEP'},billing_blocker_reasons:[{reason:'KEEP'}],customer_site_id:id(4),site_id:id(4)})
  expect(rows[0].actual_start_at).not.toBeNull()
 })
 it('does not reproject catalog fees while saving only a site or staff comment',async()=>{
  await db.exec(`update contract_offers set invoice_fee_sek=19,vat_rate=0.25 where id='${id(5)}';update customer_contracts set source_type='catalog' where id='${id(3)}';update contract_offers set invoice_fee_sek=99 where id='${id(5)}'`)
  expect(await edit({site_id:id(4)},false)).toMatchObject({ok:true,pricing_revised:false})
  const {rows}=await db.query<{invoice:number}>(`select invoice_fee_sek::float8 invoice from customer_contracts where id='${id(3)}'`)
  expect(rows[0].invoice).toBe(19)
 })
 it('rejects stale compare-and-swap before creating any version or revoking any token',async()=>{
  const before=await counts();expect(await edit({invoice_fee_sek:25,override_reason:'stale'},true,id(15),'2026-10-29T10:00:00.123455+00:00')).toMatchObject({error:'PT409'});expect(await counts()).toEqual(before)
 })
 it('replays an identical command once and refuses different-payload reuse',async()=>{
  const patch={invoice_fee_sek:25,override_reason:'Synthetic revision'},first=await edit(patch);expect(first).toMatchObject({ok:true});const saved=await counts()
  expect(await edit(patch)).toEqual(first);expect(await counts()).toEqual(saved)
  expect(await edit({...patch,invoice_fee_sek:26})).toMatchObject({error:'22023'});expect(await counts()).toEqual(saved)
 })
 it('rolls back versions, audit, price changes, receipt and revocations if the audit fails',async()=>{
  await db.exec('insert into test_fault values(true)');const before=await counts();expect(await edit({invoice_fee_sek:25,override_reason:'Rollback probe'})).toMatchObject({message:'SYNTHETIC_AUDIT_FAILURE'});expect(await counts()).toEqual(before)
 })
 it('requires acknowledgement of the full new proposal and current terms',async()=>{
  const before=await counts();expect(await edit({invoice_fee_sek:25,override_reason:'No acknowledgement'},false)).toMatchObject({error:'22023'});expect(await counts()).toEqual(before)
 })
 it('refuses edits after a signature even when the client posted an unsigned snapshot',async()=>{
  await db.exec(`update customer_contracts set signed_at=now(),locked_at=now(),status='signed' where id='${id(3)}'`);const before=await counts();expect(await edit({invoice_fee_sek:25,override_reason:'Old browser'})).toMatchObject({error:'55000'});expect(await counts()).toEqual(before)
 })
 it('holds inconsistent unsigned rows with an already-used signature request',async()=>{
  await db.exec(`update customer_contract_signature_requests set used_at=now() where id='${id(13)}'`)
  const before=await counts();expect(await edit({invoice_fee_sek:25,override_reason:'Used evidence'})).toMatchObject({error:'55000'});expect(await counts()).toEqual(before)
 })
 it('rejects another tenant customer site and an archived customer before any effects',async()=>{
  await db.exec(`update customer_sites set company_id='${id(99)}' where id='${id(4)}'`)
  let before=await counts();expect(await edit({site_id:id(4)},false)).toMatchObject({error:'22023'});expect(await counts()).toEqual(before)
  await db.exec(`update customers set archived_at=now() where id='${id(2)}'`)
  before=await counts();expect(await edit({invoice_fee_sek:25,override_reason:'Archived'})).toMatchObject({error:'22023'});expect(await counts()).toEqual(before)
 })
 it('rejects a duplicate edited component rather than changing two prices',async()=>{
  // Fixture setup happens before command execution; the actual production
  // immutable ledger guard remains installed in native qualification.
  await db.query(`update contract_price_snapshots set price_components_snapshot=$1::jsonb,snapshot_json=snapshot_json||jsonb_build_object('price_components',$1::jsonb,'price_components_snapshot',$1::jsonb)`,[JSON.stringify([...components,components[0]])])
  await db.exec(`update contract_price_snapshots set snapshot_hash=canonical_json_sha256(snapshot_json)`)
  const before=await counts();expect(await edit({invoice_fee_sek:25,override_reason:'Ambiguous'})).toMatchObject({error:'22023'});expect(await counts()).toEqual(before)
 })
 it('keeps the existing pricing permission instead of treating contracts.write as publishing permission',async()=>{
  await db.exec(`delete from test_permissions where permission='pricing.write'`);const before=await counts();expect(await edit({invoice_fee_sek:25,override_reason:'No pricing authority'})).toMatchObject({error:'42501'});expect(await counts()).toEqual(before)
 })
 it('rejects client-injected identities and signature fields before any effect',async()=>{
  const before=await counts();expect(await edit({company_id:id(99),signed_at:instant})).toMatchObject({error:'22023'});expect(await counts()).toEqual(before)
 })
})
