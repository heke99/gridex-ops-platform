// simulation: 20261029-3f1a8ab1/claude-track2/014
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Installs the immutable canonical ensure body (20260716183000, prosrc sha
// fcb963b3...) on a finite table fixture, then applies the forward migration
// through its own sha256 guard. Channel publication is reproduced with the
// exact version columns gridex_publish_contract_channel writes (different
// snapshot/hash, status 'published'); its readiness/finalize graph is not
// installed. PGlite is a single session: true two-session concurrency is not
// executable here and is covered by the publication row lock reasoning in the
// migration header plus the sequential "second caller" case below.
const OLD_HASH = 'fcb963b3d282b1f886cbbc5c90c35b34d8d4647c0f4e4e6d6330a55314659984'
const donor = readFileSync('supabase/migrations/20260716183000_contract_canonical_finalization.sql', 'utf8')
const forward = readFileSync('supabase/migrations/20261030131300_internal_publication_reuse_published_version.sql', 'utf8')

function ensureDonorSql(): string {
  const start = donor.indexOf('create or replace function public.gridex_ensure_internal_contract_publication(')
  const end = donor.indexOf('end $$;', start)
  if (start < 0 || end < 0) throw new Error('donor ensure body not found')
  return donor.slice(start, end + 'end $$;'.length)
}

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
const OFFER = '10000000-0000-4000-8000-000000000001'
const CPV = '20000000-0000-4000-8000-000000000001'
const PP = '30000000-0000-4000-8000-000000000001'
const PPV = '30000000-0000-4000-8000-000000000002'
const PPV2 = '30000000-0000-4000-8000-000000000003'
const PB = '30000000-0000-4000-8000-000000000004'
const LBV = '40000000-0000-4000-8000-000000000001'
const LBV2 = '40000000-0000-4000-8000-000000000002'
const ACTOR = '50000000-0000-4000-8000-000000000001'

let db: PGlite

async function counts() {
  const r = await db.query<{ versions: number; published: number; publications: number; assignments: number }>(`
    select (select count(*)::int from contract_publication_versions) versions,
           (select count(*)::int from contract_publication_versions where status='published') published,
           (select count(*)::int from contract_publications) publications,
           (select count(*)::int from tenant_contract_assignments) assignments`)
  return r.rows[0]
}

async function ensure(company: string, offer = OFFER): Promise<string> {
  const r = await db.query<{ id: string }>(
    'select public.gridex_ensure_internal_contract_publication($1,$2,$3) id', [company, offer, ACTOR])
  return r.rows[0].id
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

// Mirrors gridex_publish_contract_channel's internal-channel insert: own v6
// snapshot (other content hash), customer_type=o.customer_type, published.
async function publishChannel(): Promise<string> {
  await db.exec(`
    insert into tenant_contract_assignments(company_id,contract_product_version_id,internal_sales_allowed,status,valid_from,valid_to)
    select company_id,contract_product_version_id,true,'active',valid_from,valid_to from contract_offers where id='${OFFER}'
    on conflict do nothing;
    insert into contract_publications(assignment_id,channel,status)
    select id,'internal','published' from tenant_contract_assignments where company_id='${A}'
    on conflict(assignment_id,channel) do update set status='published';`)
  const r = await db.query<{ id: string }>(`
    insert into contract_publication_versions(contract_publication_id,version_number,contract_product_version_id,
      price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,customer_type,channel,valid_from,valid_to,
      publication_snapshot,offer_reference,content_sha256,status,published_at,locked_at)
    select cp.id,1,o.contract_product_version_id,o.price_plan_id,o.price_plan_version_id,o.price_book_id,o.legal_bundle_version_id,
      o.customer_type,'internal',o.valid_from::timestamptz,o.valid_to::timestamptz,
      jsonb_build_object('schema','gridex_contract_publication_v6','source_contract_offer_id',o.id),
      'GX-CHANNEL-1',encode(sha256(convert_to('channel-v6','UTF8')),'hex'),'published',now(),now()
    from contract_offers o join tenant_contract_assignments ta on ta.company_id=o.company_id
    join contract_publications cp on cp.assignment_id=ta.id and cp.channel='internal'
    where o.id='${OFFER}' returning id`)
  return r.rows[0].id
}

async function install(applyForward: boolean) {
  if (db && !db.closed) await db.close()
  db = new PGlite()
  await db.exec(`
    create role service_role;
    create schema extensions;
    create function extensions.digest(p text, alg text) returns bytea language sql immutable
      as $$ select sha256(convert_to(p,'UTF8')) $$;
    create table contract_offers(
      id uuid primary key, company_id uuid not null, name text, contract_type text, customer_type text,
      contract_product_version_id uuid, price_plan_id uuid, price_plan_version_id uuid, price_book_id uuid,
      legal_bundle_version_id uuid, valid_from date, valid_to date, is_active boolean, status text);
    create table tenant_contract_assignments(
      id uuid primary key default gen_random_uuid(), company_id uuid not null, contract_product_version_id uuid not null,
      internal_sales_allowed boolean, website_publication_allowed boolean default false, status text, legal_mode text,
      valid_from date, valid_to date, assigned_by uuid, created_at timestamptz default now(),
      unique(company_id,contract_product_version_id));
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
    create function public.gridex_sync_internal_offer_to_canonical(p uuid) returns uuid language sql as $$ select p $$;
  `)
  await db.exec(ensureDonorSql())
  await db.exec(`
    alter function public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid) set search_path=public, extensions, pg_temp;
    revoke all on function public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid) from public;
    grant execute on function public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid) to service_role;`)
  const src = await db.query<{ prosrc: string }>(
    "select prosrc from pg_proc where oid='public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid)'::regprocedure")
  expect(createHash('sha256').update(src.rows[0].prosrc, 'utf8').digest('hex')).toBe(OLD_HASH)
  if (applyForward) await db.exec(forward)
  await db.exec(`insert into contract_offers values(
    '${OFFER}','${A}','Fast 12','fixed','private','${CPV}','${PP}','${PPV}','${PB}','${LBV}','2026-11-01',null,true,'active')`)
}

afterAll(async () => {
  if (db && !db.closed) await db.close()
})

describe('gridex_ensure_internal_contract_publication reuses a published channel version (finding 014)', () => {
  beforeEach(async () => {
    await install(true)
  })

  it('reuses the channel-published version after gridex_publish_contract_channel; never two published', async () => {
    const channelVersion = await publishChannel()
    const before = await counts()
    expect(await ensure(A)).toBe(channelVersion)
    expect(await ensure(A)).toBe(channelVersion)
    expect(await counts()).toEqual(before)
    expect((await counts()).published).toBe(1)
  })

  it.each([
    ['price_plan_version_id', `price_plan_version_id='${PPV2}'`],
    ['legal_bundle_version_id', `legal_bundle_version_id='${LBV2}'`],
    ['price_book_id', 'price_book_id=null'],
    ['customer_type', "customer_type='business'"],
    ['valid_from', "valid_from='2026-12-01'"],
    ['valid_to', "valid_to='2027-12-31'"],
  ])('offer changed after publication (%s) -> internal_publication_republish_required, no writes', async (_f, change) => {
    const channelVersion = await publishChannel()
    await db.exec(`update contract_offers set ${change} where id='${OFFER}'`)
    const before = await counts()
    const snapshotBefore = (await db.query('select * from contract_publication_versions order by id')).rows
    const err = await errorOf(() => ensure(A))
    expect(err).toEqual({ code: 'P0001', message: 'internal_publication_republish_required' })
    expect(await counts()).toEqual(before)
    expect((await db.query('select * from contract_publication_versions order by id')).rows).toEqual(snapshotBefore)
    const pub = await db.query<{ status: string }>(`select status from contract_publication_versions where id='${channelVersion}'`)
    expect(pub.rows[0].status).toBe('published')
  })

  it('other tenant is refused with internal_contract_offer_not_found and writes nothing', async () => {
    await publishChannel()
    const before = await counts()
    expect(await errorOf(() => ensure(B))).toEqual({ code: 'P0002', message: 'internal_contract_offer_not_found' })
    expect(await counts()).toEqual(before)
  })

  it('without a published version keeps creating a new published version; a second caller reuses it', async () => {
    const first = await ensure(A)
    const row = await db.query<{ status: string; offer_reference: string; snapshot_schema: string }>(
      `select status,offer_reference,publication_snapshot->>'schema' snapshot_schema from contract_publication_versions where id='${first}'`)
    expect(row.rows[0]).toEqual({
      status: 'published',
      offer_reference: `internal_${OFFER.replaceAll('-', '')}_v1`,
      snapshot_schema: 'gridex_internal_publication_v1',
    })
    expect(await ensure(A)).toBe(first)
    expect(await counts()).toMatchObject({ versions: 1, published: 1, publications: 1, assignments: 1 })
  })

  it('inactive offer keeps the previous draft path unchanged', async () => {
    await db.exec(`update contract_offers set is_active=false,status='inactive' where id='${OFFER}'`)
    const id = await ensure(A)
    const row = await db.query<{ status: string }>(`select status from contract_publication_versions where id='${id}'`)
    expect(row.rows[0].status).toBe('draft')
  })

  it('migration guard refuses an unexpected installed body and keeps SECURITY DEFINER, search_path and ACL', async () => {
    const meta = await db.query<{ prosecdef: boolean; proconfig: string[]; acl: string }>(
      "select prosecdef,proconfig,proacl::text acl from pg_proc where oid='public.gridex_ensure_internal_contract_publication(uuid,uuid,uuid)'::regprocedure")
    expect(meta.rows[0].prosecdef).toBe(true)
    expect(meta.rows[0].proconfig).toEqual(['search_path=public, extensions, pg_temp'])
    expect(meta.rows[0].acl).toContain('service_role=X')
    expect(meta.rows[0].acl).not.toMatch(/(^|[{,])=X/)
    // Replay over its own body is accepted.
    await db.exec(forward)
    await db.exec(`create or replace function public.gridex_ensure_internal_contract_publication(
      p_company_id uuid,p_contract_offer_id uuid,p_actor_user_id uuid default null) returns uuid
      language plpgsql security definer set search_path=public, extensions, pg_temp as $$ begin return null; end $$`)
    await expect(db.exec(forward)).rejects.toThrow(/internal_publication_reuse_source_changed/)
  })
})

describe('pre-fix canonical body (reproduction)', () => {
  beforeAll(async () => {
    await install(false)
  })

  it('old body publishes a second version and hits the one-published unique index (23505)', async () => {
    await publishChannel()
    const err = await errorOf(() => ensure(A))
    expect(err.code).toBe('23505')
  })
})
