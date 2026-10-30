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
// Permission/readiness/graph helpers are stubs that allow the call. The
// finalize helper is a stub that publishes and REWRITES the snapshot/hash, so
// any finalize of a version a contract points at is detected by the asserts.
// PGlite is a single session; real two-session races are not executed here.
const MAIN_PUBLISH_HASH = 'e06f4b770cda17e95553f2297c0db310419022a3e817df01931b6359bfd36c47'
const ENSURE_OLD_HASH = 'fcb963b3d282b1f886cbbc5c90c35b34d8d4647c0f4e4e6d6330a55314659984'
const donor = readFileSync('supabase/migrations/20260716183000_contract_canonical_finalization.sql', 'utf8')
const ensureForward = readFileSync('supabase/migrations/20261030131300_internal_publication_reuse_published_version.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261030131400_channel_publish_reuses_internal_published_version.sql', 'utf8')
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
const OTHER_OFFER = '10000000-0000-4000-8000-000000000002'
const PRODUCT = '20000000-0000-4000-8000-000000000000'
const CPV = '20000000-0000-4000-8000-000000000001'
const PP = '30000000-0000-4000-8000-000000000001'
const PPV = '30000000-0000-4000-8000-000000000002'
const PPV2 = '30000000-0000-4000-8000-000000000003'
const PB = '30000000-0000-4000-8000-000000000004'
const LBV = '40000000-0000-4000-8000-000000000001'
const LBV2 = '40000000-0000-4000-8000-000000000002'
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
async function changeOffer(change: string) {
  await db.exec(`update contract_offers set ${change} where id='${OFFER}'`)
  if (change.startsWith('price_plan_version_id')) {
    await db.exec(`update contract_product_versions set price_plan_version_id='${PPV2}' where id='${CPV}'`)
  }
}

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

async function install(applyForward: boolean) {
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

describe('gridex_publish_contract_channel after an internal contract publication (finding 014b)', () => {
  beforeEach(async () => {
    await install(true)
  })

  it('unchanged terms: reuses the contract version as a no-op; exactly one published; frozen snapshot/hash', async () => {
    const contractVersion = await createContract()
    const before = await versions()
    expect(before).toHaveLength(1)
    const result = await publish()
    expect(result).toMatchObject({
      ok: true, changed: true, mode: 'published', channel: 'internal',
      publication_version_reused: true, affected_publication_versions: 0,
      contract_publication_version_id: contractVersion,
      offer_reference: `internal_${OFFER.replaceAll('-', '')}_v1`,
    })
    expect(await versions()).toEqual(before)
    expect(await publishedCount()).toBe(1)
    const channel = await db.query<{ status: string }>("select status from tenant_contract_channels where channel='internal'")
    expect(channel.rows).toEqual([{ status: 'active' }])
    const audit = await db.query<{ entity_id: string; metadata: Record<string, unknown> }>(
      "select entity_id,metadata from audit_logs where action='contract.channel.published'")
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0].entity_id).toBe(contractVersion)
    expect(audit.rows[0].metadata).toMatchObject({ publication_version_reused: true })
    // Later internal contracts still bind the same version.
    expect(await ensure()).toBe(contractVersion)
    expect(await versions()).toEqual(before)
  })

  it.each([
    ['price_plan_version_id', `price_plan_version_id='${PPV2}'`],
    ['legal_bundle_version_id', `legal_bundle_version_id='${LBV2}'`],
    ['price_book_id', 'price_book_id=null'],
    ['customer_type', "customer_type='business'"],
    ['valid_from', "valid_from='2026-12-01'"],
    ['valid_to', "valid_to='2027-12-31'"],
  ])('changed %s: old version ended, new one published, contract still on the frozen old version', async (_f, change) => {
    const contractVersion = await createContract()
    const [old] = await versions()
    await changeOffer(change)
    const result = await publish()
    expect(result).toMatchObject({ ok: true, changed: true, publication_version_reused: false, affected_publication_versions: 1 })
    expect(result.contract_publication_version_id).not.toBe(contractVersion)
    const after = await versions()
    expect(after).toHaveLength(2)
    const ended = after.find((v) => v.id === contractVersion)!
    expect(ended.status).toBe('ended')
    expect({ ...ended, status: old.status, valid_to: old.valid_to }).toEqual(old)
    expect(ended.publication_snapshot).toEqual(old.publication_snapshot)
    expect(ended.content_sha256).toBe(old.content_sha256)
    const fresh = after.find((v) => v.id === result.contract_publication_version_id)!
    expect(fresh.status).toBe('published')
    expect(await publishedCount()).toBe(1)
    const contract = await db.query<{ v: string }>(`select contract_publication_version_id v from customer_contracts where id='${CONTRACT}'`)
    expect(contract.rows[0].v).toBe(contractVersion)
  })

  it('published version of another offer on the same publication is ended, not reused', async () => {
    await createContract()
    await db.exec(`insert into contract_offers(id,company_id,name,contract_type,customer_type,contract_product_id,contract_product_version_id,
      price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,valid_from,valid_to,is_active,status,lifecycle_status,
      commercial_snapshot,vat_rate,version_series_id,version_number)
      select '${OTHER_OFFER}',company_id,name,contract_type,customer_type,contract_product_id,contract_product_version_id,price_plan_id,
      price_plan_version_id,price_book_id,legal_bundle_version_id,valid_from,valid_to,true,'active','published',commercial_snapshot,
      vat_rate,'${OTHER_OFFER}',1 from contract_offers where id='${OFFER}'`)
    const result = await publish(A, OTHER_OFFER)
    expect(result).toMatchObject({ ok: true, publication_version_reused: false })
    const rows = await versions()
    expect(rows.map((v) => v.status).sort()).toEqual(['ended', 'published'])
    expect(await publishedCount()).toBe(1)
  })

  it('publish first, then ensure (finding 014 order) still reuses the channel version', async () => {
    // Channel permission setup creates the assignment before the first publish.
    await db.exec(`insert into tenant_contract_assignments(company_id,contract_product_version_id,internal_sales_allowed,status)
      values('${A}','${CPV}',true,'active')`)
    const result = await publish()
    expect(result).toMatchObject({ ok: true, publication_version_reused: false })
    const channelVersion = result.contract_publication_version_id as string
    const before = await versions()
    expect(await ensure()).toBe(channelVersion)
    expect(await versions()).toEqual(before)
    // A repeated publish reuses the published channel version unchanged.
    await db.exec("update tenant_contract_channels set status='paused'")
    expect(await publish()).toMatchObject({ ok: true, publication_version_reused: true, contract_publication_version_id: channelVersion })
    expect(await versions()).toEqual(before)
    expect(await publishedCount()).toBe(1)
  })

  it('other tenant is refused and writes nothing', async () => {
    await createContract()
    const before = await versions()
    const result = await publish(B)
    expect(result).toMatchObject({ ok: false, changed: false, code: 'contract_offer_not_found' })
    expect(await versions()).toEqual(before)
    const channels = await db.query<{ n: number }>('select count(*)::int n from tenant_contract_channels')
    expect(channels.rows[0].n).toBe(0)
  })

  it('never two published versions across ensure/publish orders and term changes', async () => {
    await createContract()
    await publish()
    expect(await publishedCount()).toBe(1)
    await changeOffer(`price_plan_version_id='${PPV2}'`)
    await db.exec("update tenant_contract_channels set status='paused'")
    await publish()
    expect(await publishedCount()).toBe(1)
    const v = await ensure()
    expect(await publishedCount()).toBe(1)
    const row = await db.query<{ status: string }>(`select status from contract_publication_versions where id='${v}'`)
    expect(row.rows[0].status).toBe('published')
  })

  it('migration keeps SECURITY DEFINER, search_path and ACL; replay is a no-op; unknown body is refused', async () => {
    const meta = await db.query<{ prosecdef: boolean; proconfig: string[]; acl: string }>(
      "select prosecdef,proconfig,proacl::text acl from pg_proc where oid='public.gridex_publish_contract_channel(uuid,uuid,text,uuid)'::regprocedure")
    expect(meta.rows[0].prosecdef).toBe(true)
    expect(meta.rows[0].proconfig).toEqual(['search_path=public, extensions, pg_temp'])
    expect(meta.rows[0].acl).toContain('service_role=X')
    expect(meta.rows[0].acl).not.toMatch(/(^|[{,])(authenticated|anon)?=X/)
    const own = await publishHash()
    await db.exec(forward)
    expect(await publishHash()).toBe(own)
    await db.exec(`create or replace function public.gridex_publish_contract_channel(
      p_company_id uuid,p_offer_id uuid,p_channel text,p_actor_user_id uuid) returns jsonb
      language plpgsql security definer set search_path=public, extensions, pg_temp as $$ begin return null; end $$`)
    await expect(db.exec(forward)).rejects.toThrow(/channel_publish_reuse_source_changed/)
  })
})

describe('current main publish body (reproduction)', () => {
  it('ensure first, then publish hits the one-published unique index (23505)', async () => {
    await install(false)
    await createContract()
    const err = await errorOf(() => publish())
    expect(err.code).toBe('23505')
  })
})
