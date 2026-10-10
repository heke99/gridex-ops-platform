import fs from 'node:fs'

import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Executes the real forward migration in PostgreSQL. The three unchanged
// upstream commands (save, publish, publication mirror) are finite stand-ins
// that follow production semantics: save yields a draft, inactive offer, and
// only a successful publish yields a locked chain and an active channel. The
// complete real chain is executed by scripts/one-off-offer-binding-native.test.ts.
const MIGRATION = 'supabase/migrations/20261010230000_one_off_offer_contract_binding.sql'
const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'

let db: PGlite

async function bind(company = T1, payload: Record<string, unknown> = {}) {
  const { rows } = await db.query<{ b: { contract_offer_id: string; contract_product_version_id: string } }>(
    `select public.gridex_prepare_manual_contract_binding($1::uuid, $2::jsonb, '{}'::jsonb, null) as b`,
    [company, JSON.stringify(payload)],
  )
  return rows[0].b
}

async function insertContract(company: string, status: string, offerId: string | null, id?: string) {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.customer_contracts(id, company_id, status, contract_offer_id)
     values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4) returning id`,
    [id ?? null, company, status, offerId],
  )
  return rows[0].id
}

async function reservation(offerId: string) {
  const { rows } = await db.query<{ consumed_contract_id: string | null }>(
    'select consumed_contract_id from gridex_one_off_offer_binding.reservations where offer_id = $1',
    [offerId],
  )
  return rows[0]
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.companies(id uuid primary key);
    create table public.contract_offers(
      id uuid primary key default gen_random_uuid(), company_id uuid, status text default 'draft',
      is_active boolean default false, lifecycle_status text default 'draft', valid_from date, valid_to date,
      version_number int default 1, version_series_id uuid default gen_random_uuid(), contract_product_id uuid,
      contract_product_version_id uuid, max_customers int, archived_at timestamptz, updated_at timestamptz, updated_by uuid);
    create table public.tenant_contract_assignments(id uuid primary key default gen_random_uuid(), company_id uuid,
      contract_product_version_id uuid, status text, internal_sales_allowed boolean, website_publication_allowed boolean);
    create table public.tenant_contract_channels(assignment_id uuid, channel text, status text,
      valid_from timestamptz, valid_to timestamptz);
    create table public.contract_publication_versions(id uuid primary key, status text, locked_at timestamptz,
      contract_product_version_id uuid, price_plan_id uuid, price_plan_version_id uuid, price_book_id uuid,
      legal_bundle_version_id uuid, offer_reference text);
    create table public.contract_product_versions(id uuid primary key, contract_product_id uuid, status text,
      locked_at timestamptz, commercial_snapshot jsonb);
    create table public.legal_bundle_versions(id uuid primary key, status text, locked_at timestamptz,
      unresolved_variables text[], rendered_snapshot jsonb);
    create table public.customer_contracts(id uuid primary key default gen_random_uuid(), company_id uuid, status text,
      contract_offer_id uuid, contract_product_id uuid, contract_product_version_id uuid);

    -- Mirrors production: saving is always a draft, inactive offer; only the
    -- publish command promotes it and opens its internal channel.
    create function public.gridex_upsert_internal_contract_offer(p_company uuid, p_id uuid, p_payload jsonb, p_snap jsonb, p_actor uuid)
    returns jsonb language plpgsql as $$
    declare v_pv uuid := gen_random_uuid(); v_id uuid;
    begin
      insert into public.contract_product_versions values (v_pv, gen_random_uuid(), 'draft', null, '{}');
      insert into public.contract_offers(company_id, status, is_active, lifecycle_status, valid_from, contract_product_version_id)
      values (p_company, 'draft', false, 'draft', nullif(p_payload->>'valid_from', '')::date, v_pv) returning id into v_id;
      return jsonb_build_object('offer', jsonb_build_object('id', v_id));
    end $$;
    create table public.publish_refusals(company_id uuid primary key, code text);
    create function public.gridex_publish_internal_contract_version(p_company uuid, p_offer uuid, p_actor uuid)
    returns jsonb language plpgsql as $$
    declare v_pv uuid; v_a uuid; v_code text;
    begin
      select code into v_code from public.publish_refusals where company_id = p_company;
      if v_code is not null then
        return jsonb_build_object('ok', false, 'code', v_code, 'blockers', jsonb_build_array(jsonb_build_object('code', v_code)));
      end if;
      update public.contract_offers set lifecycle_status = 'published', status = 'active', is_active = true
      where id = p_offer and company_id = p_company returning contract_product_version_id into v_pv;
      update public.contract_product_versions set status = 'approved', locked_at = now() where id = v_pv;
      insert into public.tenant_contract_assignments(company_id, contract_product_version_id, status, internal_sales_allowed, website_publication_allowed)
      values (p_company, v_pv, 'active', true, false) returning id into v_a;
      insert into public.tenant_contract_channels values (v_a, 'internal', 'active', null, null);
      return jsonb_build_object('ok', true, 'mode', 'published');
    end $$;
    create function public.gridex_ensure_internal_contract_publication(p_company uuid, p_offer uuid, p_actor uuid)
    returns uuid language plpgsql as $$
    declare v uuid := gen_random_uuid(); l uuid := gen_random_uuid();
    begin
      insert into public.legal_bundle_versions values (l, 'published', now(), '{}', '{}');
      -- Like production, an inactive/draft offer only yields a draft, unlocked version.
      insert into public.contract_publication_versions
      select v, case when o.is_active then 'published' else 'draft' end, case when o.is_active then now() end,
        o.contract_product_version_id, null, null, null, l, 'REF'
      from public.contract_offers o where o.id = p_offer;
      return v;
    end $$;
  `)
  await db.exec(fs.readFileSync(MIGRATION, 'utf8'))
  await db.exec(`
    create trigger customer_contracts_contract_availability
    before insert or update of status, contract_offer_id, contract_product_id, contract_product_version_id
    on public.customer_contracts for each row execute function public.gridex_enforce_contract_availability_and_capacity();
    insert into public.companies values ('${T1}'), ('${T2}');
  `)
})

afterAll(async () => {
  await db?.close()
})

describe('one-off offer contract binding', () => {
  it('still archives the materialized offer so it never appears as a catalog offer', async () => {
    const b = await bind()
    const { rows } = await db.query<{ is_active: boolean; status: string }>(
      'select is_active, status from public.contract_offers where id = $1', [b.contract_offer_id])
    expect(rows[0]).toEqual({ is_active: false, status: 'inactive' })
    expect(await reservation(b.contract_offer_id)).toEqual({ consumed_contract_id: null })
  })

  it('prepare path: a draft contract binds the reserved offer and moves through signing', async () => {
    const b = await bind()
    const id = await insertContract(T1, 'draft', null)
    await db.query(
      `update public.customer_contracts set contract_offer_id = $1, contract_product_version_id = $2,
       status = 'pending_signature' where id = $3`, [b.contract_offer_id, b.contract_product_version_id, id])
    await db.query(`update public.customer_contracts set status = 'signed' where id = $1`, [id])
    await db.query(`update public.customer_contracts set status = 'active' where id = $1`, [id])
    expect(await reservation(b.contract_offer_id)).toEqual({ consumed_contract_id: id })
  })

  it('customer-card create path: a direct non-draft INSERT binds a fresh reservation', async () => {
    const b = await bind()
    const id = await insertContract(T1, 'pending_signature', b.contract_offer_id)
    expect(await reservation(b.contract_offer_id)).toEqual({ consumed_contract_id: id })
  })

  it('a future start date on the one-off offer does not block binding', async () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const b = await bind(T1, { valid_from: future })
    await expect(insertContract(T1, 'pending_signature', b.contract_offer_id)).resolves.toBeTruthy()
  })

  it('refuses a second contract on an already consumed one-off offer', async () => {
    const b = await bind()
    await insertContract(T1, 'pending_signature', b.contract_offer_id)
    await expect(insertContract(T1, 'pending_signature', b.contract_offer_id))
      .rejects.toThrow('contract_offer_not_available')
  })

  it('refuses another tenant binding the reserved offer', async () => {
    const b = await bind(T1)
    await expect(insertContract(T2, 'pending_signature', b.contract_offer_id))
      .rejects.toThrow('contract_offer_not_available')
    expect(await reservation(b.contract_offer_id)).toEqual({ consumed_contract_id: null })
  })

  it('still refuses an archived catalog offer without a materializer reservation', async () => {
    const { rows } = await db.query<{ id: string }>(
      `insert into public.contract_offers(company_id, status, is_active, lifecycle_status)
       values ($1, 'inactive', false, 'archived') returning id`, [T1])
    await expect(insertContract(T1, 'pending_signature', rows[0].id)).rejects.toThrow('contract_offer_not_available')
  })

  it('keeps the channel check and does not consume the reservation when it fails', async () => {
    const b = await bind()
    await db.query(
      `update public.tenant_contract_channels set status = 'inactive' where assignment_id in
       (select id from public.tenant_contract_assignments where contract_product_version_id = $1)`,
      [b.contract_product_version_id])
    await expect(insertContract(T1, 'pending_signature', b.contract_offer_id))
      .rejects.toThrow('contract_channel_not_available')
    expect(await reservation(b.contract_offer_id)).toEqual({ consumed_contract_id: null })
  })

  it('raises a publish refusal and leaves no reservation or archived offer', async () => {
    const T3 = '33333333-3333-4333-8333-333333333333'
    await db.query('insert into public.companies values ($1)', [T3])
    await db.query(`insert into public.publish_refusals values ($1, 'contract_version_not_publishable')`, [T3])
    await expect(bind(T3)).rejects.toThrow('one_off_publication_refused')
    const { rows } = await db.query<{ n: number }>(
      `select (select count(*) from gridex_one_off_offer_binding.reservations where company_id = $1)::int
            + (select count(*) from public.contract_offers where company_id = $1)::int as n`, [T3])
    expect(rows[0].n).toBe(0)
  })

  it('denies API roles any access to the reservation registry', async () => {
    await db.exec('set role service_role')
    try {
      await expect(db.query(
        'insert into gridex_one_off_offer_binding.reservations(offer_id, company_id) values (gen_random_uuid(), gen_random_uuid())',
      )).rejects.toThrow('permission denied for schema gridex_one_off_offer_binding')
    } finally {
      await db.exec('reset role')
    }
  })
})
