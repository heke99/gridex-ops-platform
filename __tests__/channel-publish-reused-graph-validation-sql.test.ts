// simulation: TERM01.05; COMPONENT, not whole-scenario acceptance.
// Finite fixture adapted from PR972@739a0bf41d4e0f2a15e9e662c751b71de98a8c3c:
// __tests__/channel-publish-reuses-internal-version-sql.test.ts.
// Runs exact ensure/publish/validator bodies. Permission, readiness, sync and
// finalize are finite ports; no production triggers, Auth/RLS or concurrency proof.
// simulation: 20261029-3f1a8ab1/claude-track2/014b
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

// Runs the real installed bodies of both writers on a finite table fixture:
// - gridex_ensure_internal_contract_publication: canonical 20260716183000 body
//   (prosrc fcb963b3...) upgraded by the forward migration 20261030131300;
// - gridex_publish_contract_channel: current main body taken verbatim from
//   supabase/schema.sql (prosrc sha256 e06f4b77..., = 20260731152000 +
//   20261013112427, pinned by 20261019180400), then 20261030131400.
// Permission/readiness/sync remain finite ports; each graph case installs the
// real validator and its real helpers after the initial fixture bootstrap. The
// finalize helper is a stub that publishes and REWRITES the snapshot/hash, so
// any finalize of a version a contract points at is detected by the asserts.
// PGlite is a single session; real two-session races are not executed here.
const MAIN_PUBLISH_HASH = 'e06f4b770cda17e95553f2297c0db310419022a3e817df01931b6359bfd36c47'
const ENSURE_OLD_HASH = 'fcb963b3d282b1f886cbbc5c90c35b34d8d4647c0f4e4e6d6330a55314659984'
const donor = readFileSync('supabase/migrations/20260716183000_contract_canonical_finalization.sql', 'utf8')
const ensureForward = readFileSync('supabase/migrations/20261030131300_internal_publication_reuse_published_version.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261030131400_channel_publish_reuses_internal_published_version.sql', 'utf8')
const reuseGuard = readFileSync('supabase/migrations/20261101120742_channel_reuse_requires_qualified_publication_graph.sql', 'utf8')
const schema = readFileSync('supabase/schema.sql', 'utf8')

function ensureDonorSql(): string {
  const start = donor.indexOf('create or replace function public.gridex_ensure_internal_contract_publication(')
  const end = donor.indexOf('end $$;', start)
  if (start < 0 || end < 0) throw new Error('donor ensure body not found')
  return donor.slice(start, end + 'end $$;'.length)
}

function publishMainSql(): string {
  const start = schema.indexOf('CREATE FUNCTION public.gridex_publish_contract_channel(p_company_id uuid, p_offer_id uuid, p_channel text, p_actor_user_id uuid) RETURNS jsonb')
  const end = schema.indexOf('\nend $_$;', start)
  if (start < 0 || end < 0) throw new Error('main publish body not found')
  return schema.slice(start, end + '\nend $_$;'.length)
}

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const OFFER = '10000000-0000-4000-8000-000000000001'
const PRODUCT = '20000000-0000-4000-8000-000000000000'
const CPV = '20000000-0000-4000-8000-000000000001'
const PP = '30000000-0000-4000-8000-000000000001'
const PPV = '30000000-0000-4000-8000-000000000002'
const PPV2 = '30000000-0000-4000-8000-000000000003'
const PB = '30000000-0000-4000-8000-000000000004'
const LBV = '40000000-0000-4000-8000-000000000001'
const ACTOR = '50000000-0000-4000-8000-000000000001'
const CONTRACT = '60000000-0000-4000-8000-000000000001'

let db: PGlite

type VersionRow = Record<string, unknown> & { id: string; status: string }

async function versions(): Promise<VersionRow[]> {
  return (await db.query<VersionRow>('select * from contract_publication_versions order by version_number, id')).rows
}

async function publishedCount(): Promise<number> {
  const r = await db.query<{ n: number }>("select count(*)::int n from contract_publication_versions where status='published'")
  return r.rows[0].n
}

async function ensure(company = A, offer = OFFER): Promise<string> {
  const r = await db.query<{ id: string }>(
    'select public.gridex_ensure_internal_contract_publication($1,$2,$3) id', [company, offer, ACTOR])
  return r.rows[0].id
}

async function publish(company = A, offer = OFFER): Promise<Record<string, unknown>> {
  const r = await db.query<{ r: Record<string, unknown> }>(
    "select public.gridex_publish_contract_channel($1,$2,'internal',$3) r", [company, offer, ACTOR])
  return r.rows[0].r
}

// A new price plan version is reached through the locked product version.

// Internal contract creation: ensure + a customer contract bound to the version.
async function createContract(): Promise<string> {
  const id = await ensure()
  await db.query('insert into customer_contracts(id,company_id,contract_publication_version_id) values($1,$2,$3)', [CONTRACT, A, id])
  return id
}

async function errorOf(fn: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  await db.exec('begin')
  try {
    await fn()
  } catch (error) {
    await db.exec('rollback')
    const e = error as { code?: string; message: string }
    return { code: e.code, message: e.message }
  }
  await db.exec('rollback')
  throw new Error('expected an error')
}

async function install(applyForward: boolean, applyGuard = true) {
  if (db && !db.closed) await db.close()
  db = new PGlite()
  await db.exec(`
    create role service_role; create role authenticated; create role anon;
    create schema extensions;
    create function extensions.digest(p text, alg text) returns bytea language sql immutable
      as $$ select sha256(convert_to(p,'UTF8')) $$;
    create table contract_offers(
      id uuid primary key, company_id uuid not null, name text, description text, contract_type text, customer_type text,
      contract_product_id uuid, contract_product_version_id uuid, price_plan_id uuid, price_plan_version_id uuid, price_book_id uuid,
      legal_bundle_version_id uuid, valid_from date, valid_to date, is_active boolean, status text,
      lifecycle_status text, commercial_snapshot jsonb default '{}', vat_rate numeric, version_series_id uuid, version_number integer,
      superseded_at timestamptz, updated_by uuid, updated_at timestamptz);
    create table contract_products(id uuid primary key, company_id uuid, status text, updated_at timestamptz);
    create table contract_product_versions(
      id uuid primary key, contract_product_id uuid, status text, locked_at timestamptz, price_areas text[] default '{}',
      price_plan_id uuid, price_plan_version_id uuid, energy_direction text default 'consumption', commercial_snapshot jsonb);
    create table price_plan_versions(id uuid primary key, company_id uuid, price_plan_id uuid, snapshot_json jsonb);
    create table tenant_contract_assignments(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, contract_product_version_id uuid not null,
      internal_sales_allowed boolean, website_publication_allowed boolean default false, status text, legal_mode text,
      valid_from date, valid_to date, assigned_by uuid, created_at timestamptz default now(), updated_at timestamptz,
      unique(company_id,contract_product_version_id));
    create table tenant_contract_channels(
      id uuid primary key default gen_random_uuid(), assignment_id uuid not null, channel text not null, status text,
      valid_from timestamptz, valid_to timestamptz, marketing_content jsonb, updated_by uuid, updated_at timestamptz,
      unique(assignment_id,channel));
    create table contract_publications(
      id uuid primary key default gen_random_uuid(), assignment_id uuid not null references tenant_contract_assignments(id),
      channel text not null, status text not null, created_by uuid, updated_at timestamptz default now(),
      unique(assignment_id,channel));
    create table contract_publication_versions(
      id uuid primary key default gen_random_uuid(), contract_publication_id uuid not null references contract_publications(id),
      version_number integer not null, contract_product_version_id uuid not null, price_plan_id uuid, price_plan_version_id uuid,
      price_book_id uuid, legal_bundle_version_id uuid not null, legacy_public_contract_offer_id uuid,
      customer_type text not null check (customer_type in ('private','business','both')), channel text not null,
      valid_from timestamptz, valid_to timestamptz, publication_snapshot jsonb not null default '{}', offer_reference text,
      content_sha256 text not null, status text not null default 'draft', published_at timestamptz, locked_at timestamptz,
      created_by uuid, created_at timestamptz not null default now(), energy_direction text not null default 'consumption');
    create unique index contract_publication_versions_one_published_per_publication_uid
      on contract_publication_versions(contract_publication_id) where status='published';
    create table customer_contracts(id uuid primary key, company_id uuid not null, contract_publication_version_id uuid);
    create table customer_contract_acceptances(id uuid primary key default gen_random_uuid(), contract_publication_version_id uuid);
    create table public_contract_offers(id uuid primary key default gen_random_uuid(), company_id uuid,
      contract_publication_version_id uuid, source_contract_offer_id uuid, contract_product_id uuid, lifecycle_status text,
      publication_status text, is_public boolean, website_enabled boolean, website_cta_enabled boolean, created_at timestamptz default now());
    create function public.gridex_contract_readiness_blocker_v2(code text, field text, message text, value jsonb,
      entity_type text default null, entity_id uuid default null) returns jsonb
      language sql as $$ select jsonb_build_object('code',code,'field',field) $$;
    create table audit_logs(id bigserial primary key, company_id uuid, actor_user_id uuid, entity_type text, entity_id text,
      action text, old_values jsonb, new_values jsonb, metadata jsonb);
    create function public.gridex_sync_internal_offer_to_canonical(p uuid) returns uuid language sql as $$ select p $$;
    create function public.gridex_assert_contract_permission(p uuid, perm text) returns void language sql as $$ select $$;
    create function public.gridex_validate_contract_readiness_v2(c uuid, o uuid, op text, ch text) returns jsonb
      language sql as $$ select '{"can_execute":true,"blockers":[]}'::jsonb $$;
    create function public.gridex_validate_publication_graph_v1(v uuid) returns text[] language sql as $$ select '{}'::text[] $$;
    create function public.gridex_new_offer_reference(seed text) returns text language sql
      as $$ select 'GX-'||left(encode(sha256(convert_to(seed||gen_random_uuid()::text,'UTF8')),'hex'),12) $$;
    -- Stub finalize: publishes the version and rewrites its snapshot/hash.
    create function public.gridex_finalize_contract_publication_v1(v uuid, actor uuid, strict boolean) returns jsonb
      language sql as $$
        update contract_publication_versions
        set status='published',published_at=now(),locked_at=now(),
            publication_snapshot=publication_snapshot||'{"finalized":true}'::jsonb,
            content_sha256=encode(sha256(convert_to((publication_snapshot||'{"finalized":true}'::jsonb)::text,'UTF8')),'hex')
        where id=v returning '{}'::jsonb $$;
  `)
  await db.exec(ensureDonorSql())
  await db.exec(`
    alter function public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid) set search_path=public, extensions, pg_temp;
    revoke all on function public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid) from public;
    grant execute on function public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid) to service_role;`)
  const ensureSrc = await db.query<{ prosrc: string }>(
    "select prosrc from pg_proc where oid='public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid)'::regprocedure")
  expect(createHash('sha256').update(ensureSrc.rows[0].prosrc, 'utf8').digest('hex')).toBe(ENSURE_OLD_HASH)
  await db.exec(ensureForward)

  await db.exec(`set check_function_bodies=off; ${publishMainSql()} reset check_function_bodies;
    revoke all on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid) from public,anon,authenticated;
    grant execute on function public.gridex_publish_contract_channel(uuid,uuid,text,uuid) to service_role;`)
  expect(await publishHash()).toBe(MAIN_PUBLISH_HASH)
  if (applyForward) await db.exec(forward)
  if (applyForward && applyGuard) await db.exec(reuseGuard)

  await db.exec(`
    insert into contract_products values('${PRODUCT}','${A}','active',now());
    insert into contract_product_versions(id,contract_product_id,status,locked_at,price_plan_id,price_plan_version_id,commercial_snapshot)
      values('${CPV}','${PRODUCT}','approved',now(),'${PP}','${PPV}','{"vat_rate":0.25}');
    insert into price_plan_versions values('${PPV}','${A}','${PP}','{"vat_rate":0.25}'),('${PPV2}','${A}','${PP}','{"vat_rate":0.25}');
    insert into contract_offers(id,company_id,name,contract_type,customer_type,contract_product_id,contract_product_version_id,
      price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,valid_from,valid_to,is_active,status,
      lifecycle_status,commercial_snapshot,vat_rate,version_series_id,version_number)
    values('${OFFER}','${A}','Fast 12','fixed','private','${PRODUCT}','${CPV}','${PP}','${PPV}','${PB}','${LBV}',
      '2026-11-01',null,true,'active','published','{"vat_rate":0.25}',0.25,'${OFFER}',1);`)
}

async function publishHash(): Promise<string> {
  const r = await db.query<{ prosrc: string }>(
    "select prosrc from pg_proc where oid='public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure")
  return createHash('sha256').update(r.rows[0].prosrc, 'utf8').digest('hex')
}

afterAll(async () => {
  if (db && !db.closed) await db.close()
})


// Diagnostic COMPONENT reproduction. Real validator+helpers; remaining ports
// retain the finite donor fixture and are not native acceptance.
function exactSchemaFunction(name: string, hash: string): string {
  const start = schema.indexOf(`CREATE FUNCTION public.${name}(`)
  if (start < 0) throw new Error(`Missing schema function ${name}`)
  const tail = schema.slice(start)
  const marker = /\bAS (\$[a-zA-Z_0-9]*\$)/.exec(tail)
  if (!marker) throw new Error(`Missing body delimiter ${name}`)
  const end = tail.indexOf(marker[1] + ';', marker.index + marker[0].length)
  if (end < 0) throw new Error(`Missing body end ${name}`)
  const definition = tail.slice(0, end + marker[1].length + 1)
  expect(createHash('sha256').update(definition).digest('hex')).toBe(hash)
  return definition
}
async function realGraph() {
  await db.exec("ALTER TABLE public.tenant_contract_assignments ADD COLUMN api_publication_allowed boolean DEFAULT false;\nALTER TABLE public.contract_product_versions ADD COLUMN contract_type text;\nCREATE TABLE public.contract_price_options (\n id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contract_publication_version_id uuid,\n status text, is_default boolean, selection_required boolean, option_reference text,\n option_code text, customer_type text, contract_type text\n);\nCREATE TABLE public.contract_price_option_area_prices (\n contract_price_option_id uuid, price_area text, status text, amount numeric, unit text\n);\nCREATE TABLE public.legal_bundle_versions (\n id uuid PRIMARY KEY, company_id uuid, status text, locked_at timestamptz, unresolved_variables text[]\n);\nCREATE TABLE public.legal_bundle_version_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), legal_bundle_version_id uuid);\nDROP FUNCTION public.gridex_validate_publication_graph_v1(uuid);\n")
  await db.exec(exactSchemaFunction('gridex_supported_price_areas_v1', '404c9e8f14ff1fd34fc266aba2ee97f7f14bac58ab5d970cb0d0681b81d6d37a'))
  await db.exec(exactSchemaFunction('gridex_invoice_fee_ready_v1', '185bc1266d05b0e5af9afa0ad239716694a6270a06b9c48be7b0368983d071ff'))
  await db.exec(exactSchemaFunction('gridex_validate_publication_graph_v1', '556263aebc155071c9e8f6dec5901f0c722065cf723b43a14dc1876f3088fb36'))
}
async function supportGraph(id: string) {
  await db.exec(`
    update public.contract_product_versions set contract_type='fixed',price_areas=array['SE3'] where id='${CPV}';
    insert into public.legal_bundle_versions values('${LBV}','${A}','published',now(),'{}') on conflict do nothing;
    insert into public.legal_bundle_version_documents(legal_bundle_version_id)
      select '${LBV}' where not exists(select 1 from public.legal_bundle_version_documents where legal_bundle_version_id='${LBV}');
  `)
  await db.query(`insert into public.contract_price_options(contract_publication_version_id,status,is_default,selection_required,
    option_reference,option_code,customer_type,contract_type) values($1,'active',true,false,'FIXTURE-OPT','FIXTURE-OPT','private','fixed')`,[id])
  await db.query(`insert into public.contract_price_option_area_prices(contract_price_option_id,price_area,status,amount,unit)
    select id,'SE3','active',100,'ore_per_kwh' from public.contract_price_options where contract_publication_version_id=$1`,[id])
}
const blockers = async(id:string) => (await db.query<{v:string[]}>('select public.gridex_validate_publication_graph_v1($1) v',[id])).rows[0].v


async function databaseState() {
 const tables=['contract_offers','contract_products','tenant_contract_assignments','tenant_contract_channels',
  'contract_publications','contract_publication_versions','customer_contracts','audit_logs'];
 const result:Record<string,unknown>={};
 for(const table of tables) result[table]=(await db.query(`select * from ${table} order by id`)).rows;
 return result;
}
async function canonicalFixture(includeFee=true) {
 const oldId=await ensure();const old=(await versions()).find(row=>row.id===oldId)!;
 const copy={...old};delete copy.id;delete copy.status;delete copy.version_number;
 const id='70000000-0000-4000-8000-000000000002';
 const commercial={invoice_fee_sek:0,price_components:[{component_code:'invoice_fee',status:'active',amount:0,unit:'sek_invoice',calculation_type:'per_invoice'}]};
 const snapshot={...(old.publication_snapshot as Record<string,unknown>),source_contract_offer_id:OFFER,
  ...(includeFee?{commercial_snapshot:commercial}:{})};
 const row={...copy,id,status:'published',version_number:2,publication_snapshot:snapshot,
  content_sha256:createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')};
 // Synthetic graph setup, before the new version becomes contract-referenced.
 await db.query("update contract_publication_versions set status='ended' where id=$1",[oldId]);
 await db.query('insert into contract_publication_versions select * from jsonb_populate_record(null::contract_publication_versions,$1::jsonb)',[JSON.stringify(row)]);
 await supportGraph(id);
 await db.query('insert into customer_contracts(id,company_id,contract_publication_version_id) values($1,$2,$3)',[CONTRACT,A,id]);
 return id;
}
describe('PR972 proposed fail-closed reuse guard with the real validator',()=>{
 beforeEach(async()=>{await install(true);await realGraph()})
 it('refuses an invalid reused graph and rolls back publication, channel, offer, assignment and audit writes',async()=>{
  const id=await createContract();await supportGraph(id);const before=await databaseState();
  const error=await errorOf(()=>publish());
  expect(error).toMatchObject({code:'23514',message:'PUBLICATION_SOURCE_OFFER_MISMATCH'});
  expect(await databaseState()).toEqual(before);
 });
 it('reuses a qualified immutable version and the repeat reaches the ordinary already-active no-op',async()=>{
  const id=await canonicalFixture();const before=await versions();
  expect(await publish()).toMatchObject({ok:true,changed:true,publication_version_reused:true,contract_publication_version_id:id});
  expect(await blockers(id)).toEqual([]);
  expect(await publishedCount()).toBe(1);
  expect(await versions()).toEqual(before);
  expect(await publish()).toMatchObject({ok:true,changed:false,code:'contract_channel_already_active'});
  expect(await versions()).toEqual(before);
  expect((await db.query<{n:number}>("select count(*)::int n from audit_logs where action='contract.channel.published'")).rows[0].n).toBe(1);
 });
 it('also refuses a matching source whose immutable invoice-fee configuration is unqualified',async()=>{
  await canonicalFixture(false);const before=await databaseState();
  expect(await errorOf(()=>publish())).toMatchObject({code:'23514',message:'INVOICE_FEE_CONFIGURATION_MISSING'});
  expect(await databaseState()).toEqual(before);
 });
 it('refuses a different tenant before any publication mutation',async()=>{
  await canonicalFixture();const before=await databaseState();
  expect(await publish(B)).toMatchObject({ok:false,changed:false,code:'contract_offer_not_found'});
  expect(await databaseState()).toEqual(before);
 });
 it('preserves function metadata and grants, replays idempotently and rejects unknown bodies',async()=>{
  await install(true,false);
  const metadata=async()=> (await db.query<{v:Record<string,unknown>}>(
    "select to_jsonb(p)-'prosrc' v from pg_proc p where oid='public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure")).rows[0].v;
  const before=await metadata();
  await db.exec(reuseGuard);
  expect(await publishHash()).toBe('07d53d270bceab612c0acf5b3b722e85302b660703a843143b8ce6687c7ea049');
  expect(await metadata()).toEqual(before);
  await db.exec(reuseGuard);
  expect(await metadata()).toEqual(before);
  expect(await publishHash()).toBe('07d53d270bceab612c0acf5b3b722e85302b660703a843143b8ce6687c7ea049');
  await db.exec(`create or replace function public.gridex_publish_contract_channel(
    p_company_id uuid,p_offer_id uuid,p_channel text,p_actor_user_id uuid) returns jsonb
    language plpgsql security definer set search_path=public, extensions, pg_temp as $$ begin return null; end $$`);
  await expect(db.exec(reuseGuard)).rejects.toThrow(/channel_reuse_graph_gate_predecessor_required/);
 });

})
