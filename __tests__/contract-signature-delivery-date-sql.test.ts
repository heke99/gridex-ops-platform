import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const forward = 'supabase/migrations/20261028091248_allow_contract_signature_before_supply_start.sql'
let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  // Isolated trigger execution, not hosted signing, RLS or market qualification.
  // This unchanged date helper is the production catalog's current definition.
  await db.exec(`
    create schema auth; create schema extensions;
    create function public.gridex_add_months_timestamptz(base_value timestamptz, months_int integer)
      returns timestamptz language sql stable set search_path to public,auth,extensions as $$
      select case when base_value is null then null when months_int is null then null
        when months_int <= 0 then base_value else (
          date_trunc('month',base_value at time zone 'UTC') + make_interval(months => months_int)
          + make_interval(days => least(extract(day from base_value at time zone 'UTC')::int,
            extract(day from (date_trunc('month',base_value at time zone 'UTC')
              + make_interval(months => months_int + 1) - interval '1 day'))::int) - 1)
        ) at time zone 'UTC' end $$;
    create table public.signature_lifecycle_fixture (
      id integer primary key, status text, starts_at timestamptz, ends_at timestamptz,
      binding_months integer, notice_months integer, auto_renew_enabled boolean default false,
      auto_renew_term_months integer, termination_reason text, termination_notice_date timestamptz,
      green_fee_mode text default 'none', green_fee_value numeric);
  `)
  await db.exec(fs.readFileSync('supabase/migrations/20260818170213_contract_signature_date_semantics.sql', 'utf8'))
  await db.exec(fs.readFileSync(forward, 'utf8').split('-- Online signing V2:')[0])
  await db.exec(`create trigger lifecycle before insert or update on public.signature_lifecycle_fixture
    for each row execute function public.gridex_customer_contracts_auto_renew_guard()`)
})

beforeEach(async () => { await db.exec('truncate public.signature_lifecycle_fixture') })
afterAll(async () => { await db.close() })

describe('agreement signing before network-owner delivery information arrives', () => {
  it('persists signed evidence without inventing a delivery date or binding end', async () => {
    await db.exec(`insert into public.signature_lifecycle_fixture(id,status,binding_months) values (1,'signed',12)`)
    const result = await db.query('select status,starts_at,ends_at from public.signature_lifecycle_fixture')
    expect(result.rows).toEqual([{ status: 'signed', starts_at: null, ends_at: null }])
  })

  it('allows the existing pending-signature record to become signed with its start still unknown', async () => {
    await db.exec(`insert into public.signature_lifecycle_fixture(id,status) values (1,'pending_signature')`)
    await db.exec(`update public.signature_lifecycle_fixture set status='signed' where id=1`)
    expect((await db.query('select status,starts_at from public.signature_lifecycle_fixture')).rows)
      .toEqual([{ status: 'signed', starts_at: null }])
  })

  it.each(['active', 'terminated'])('still rejects %s without a real delivery date', async (status) => {
    await expect(db.query('insert into public.signature_lifecycle_fixture(id,status) values (1,$1)', [status]))
      .rejects.toThrow(/starts_at is required/)
    expect((await db.query('select count(*)::int as count from public.signature_lifecycle_fixture')).rows)
      .toEqual([{ count: 0 }])
  })

  it('keeps activation blocked until the actual start is recorded, then derives binding from that date', async () => {
    await db.exec(`insert into public.signature_lifecycle_fixture(id,status,binding_months) values (1,'signed',12)`)
    await expect(db.exec(`update public.signature_lifecycle_fixture set status='active' where id=1`))
      .rejects.toThrow(/starts_at is required/)
    await db.exec(`update public.signature_lifecycle_fixture set starts_at='2027-01-31T00:00:00Z',status='active' where id=1`)
    expect((await db.query(`select status,starts_at::date::text,ends_at::date::text from public.signature_lifecycle_fixture`)).rows)
      .toEqual([{ status: 'active', starts_at: '2027-01-31', ends_at: '2028-01-31' }])
  })

  it.each([
    ["auto_renew_enabled=true", /auto_renew_term_months or binding_months/],
    ["termination_reason='customer_request'", /termination_notice_date is required/],
    ["green_fee_value=5", /green_fee_value must be null or 0/],
    ["starts_at='2027-02-01',ends_at='2027-01-01'", /ends_at cannot be earlier/],
  ])('preserves the independent guard for %s', async (changes, error) => {
    await db.exec(`insert into public.signature_lifecycle_fixture(id,status) values (1,'pending_signature')`)
    await expect(db.exec(`update public.signature_lifecycle_fixture set ${changes} where id=1`)).rejects.toThrow(error)
  })
})
