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
      actual_start_date date, signed_at timestamptz, locked_at timestamptz,
      binding_months integer, notice_months integer, auto_renew_enabled boolean default false,
      auto_renew_term_months integer, termination_reason text, termination_notice_date timestamptz,
      green_fee_mode text default 'none', green_fee_value numeric);
  `)
  await db.exec(fs.readFileSync('supabase/migrations/20260818170213_contract_signature_date_semantics.sql', 'utf8'))
  await db.exec(fs.readFileSync(forward, 'utf8').split('-- Online signing V2:')[0])
  await db.exec(`create trigger lifecycle before insert or update on public.signature_lifecycle_fixture
    for each row execute function public.gridex_customer_contracts_auto_renew_guard()`)
  // Execute two unchanged source guards in their real relative trigger order.
  // Synthetic rows and a conservative false retention exception do not prove
  // the other 23 production triggers, caller/RLS or canonical supply commands.
  const schema = fs.readFileSync('supabase/schema.sql', 'utf8')
  const sourceFunction = (signature: string, delimiter: string) => {
    const start = schema.indexOf(`CREATE FUNCTION ${signature}`)
    const end = schema.indexOf(`\n${delimiter};`, start)
    if (start < 0 || end < start) throw new Error(`Missing source function ${signature}`)
    return schema.slice(start, end + delimiter.length + 2)
  }
  await db.exec(`create schema gridex_ediel_retention;
    create function public.ediel_is_qualified_customer_record_transition_v1(text,jsonb,jsonb)
      returns boolean language sql immutable as $$ select false $$;
    create table public.signature_canonical_guard_fixture
      (like public.signature_lifecycle_fixture including defaults);
    alter table public.signature_canonical_guard_fixture
      add column expected_start_at timestamptz, add column confirmed_start_date date,
      add column signature_snapshot jsonb, add column signature_snapshot_sha256 text,
      add column snapshot_hash text, add column document_sha256 text,
      add column company_id uuid, add column contract_price_snapshot_id uuid,
      add column contract_product_version_id uuid, add column contract_publication_version_id uuid,
      add column legal_bundle_version_id uuid, add column billing_eligible_at timestamptz,
      add column billing_eligibility_source text, add column lifecycle_stage text,
      add column ended_at timestamptz, add column status_reason_code text,
      add column invoice_fee_sek numeric;
  `)
  await db.exec(sourceFunction('gridex_ediel_retention.record_c40a67d5fa7766230451_guard_v1()', '$_$'))
  await db.exec(sourceFunction('public.gridex_enforce_customer_contract_state_v1()', '$$'))
  await db.exec(`
    create trigger customer_contracts_lock_signed before delete or update on public.signature_canonical_guard_fixture
      for each row execute function gridex_ediel_retention.record_c40a67d5fa7766230451_guard_v1();
    create trigger customer_contracts_state_machine_v1 before insert or update on public.signature_canonical_guard_fixture
      for each row execute function public.gridex_enforce_customer_contract_state_v1();
    create trigger trg_gridex_customer_contracts_auto_renew_guard before insert or update on public.signature_canonical_guard_fixture
      for each row execute function public.gridex_customer_contracts_auto_renew_guard();
  `)
})

beforeEach(async () => { await db.exec('truncate public.signature_lifecycle_fixture, public.signature_canonical_guard_fixture') })
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

  it.each(['active'])('still rejects %s without a real operational delivery date', async (status) => {
    await expect(db.query('insert into public.signature_lifecycle_fixture(id,status) values (1,$1)', [status]))
      .rejects.toThrow(/actual_start_date is required/)
    expect((await db.query('select count(*)::int as count from public.signature_lifecycle_fixture')).rows)
      .toEqual([{ count: 0 }])
  })

  it('accepts an operational actual start without rewriting frozen signed dates', async () => {
    await db.exec(`insert into public.signature_lifecycle_fixture(id,status,binding_months) values (1,'signed',12)`)
    await expect(db.exec(`update public.signature_lifecycle_fixture set status='active' where id=1`))
      .rejects.toThrow(/actual_start_date is required/)
    await db.exec(`update public.signature_lifecycle_fixture set actual_start_date='2027-01-31',status='active' where id=1`)
    expect((await db.query(`select status,actual_start_date::text,starts_at,ends_at from public.signature_lifecycle_fixture`)).rows)
      .toEqual([{ status: 'active', actual_start_date: '2027-01-31', starts_at: null, ends_at: null }])
  })

  it('permits pre-delivery termination without inventing a delivery date', async () => {
    await db.exec(`insert into public.signature_lifecycle_fixture(id,status,binding_months) values (1,'signed',12)`)
    await db.exec(`update public.signature_lifecycle_fixture set status='terminated' where id=1`)
    expect((await db.query('select status,starts_at,ends_at,actual_start_date from public.signature_lifecycle_fixture')).rows)
      .toEqual([{ status: 'terminated', starts_at: null, ends_at: null, actual_start_date: null }])
  })

  it.each([null, '2028-01-31'])('keeps a sealed commercial end %s unchanged after receiving notice', async (end) => {
    await db.exec(`insert into public.signature_lifecycle_fixture(id,status,notice_months) values (1,'signed',2)`)
    if (end) await db.query('update public.signature_lifecycle_fixture set ends_at=$1 where id=1', [end])
    await db.exec(`update public.signature_lifecycle_fixture set termination_reason='customer_request',termination_notice_date='2028-01-31' where id=1`)
    expect((await db.query('select ends_at::date::text from public.signature_lifecycle_fixture')).rows)
      .toEqual([{ ends_at: end }])
  })

  it('retains month-end binding derivation before first sealing', async () => {
    await db.exec(`insert into public.signature_lifecycle_fixture(id,status,starts_at,binding_months)
      values (1,'pending_signature','2027-01-31',1)`)
    await db.exec(`update public.signature_lifecycle_fixture set status='signed' where id=1`)
    expect((await db.query('select ends_at::date::text from public.signature_lifecycle_fixture')).rows)
      .toEqual([{ ends_at: '2027-02-28' }])
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

  describe.each(["status='signed'", "signed_at='2026-10-28'", "locked_at='2026-10-28'"])(
    'independent validators before the sealed-row return (%s)', (seal) => {
      it.each([
        ['auto_renew_enabled=true', /auto_renew_term_months or binding_months/],
        ["termination_reason='customer_request'", /termination_notice_date is required/],
        ['green_fee_value=5', /green_fee_value must be null or 0/],
        ["starts_at='2027-02-01',ends_at='2027-01-01'", /ends_at cannot be earlier/],
      ])('rejects %s even when the OLD row is sealed', async (changes, error) => {
        // Isolated date-trigger fixture: immutable trigger interception would
        // otherwise hide whether the date guard validates before returning.
        await db.exec(`insert into public.signature_lifecycle_fixture(id,status) values (1,'pending_signature')`)
        await db.exec(`update public.signature_lifecycle_fixture set ${seal} where id=1`)
        await expect(db.exec(`update public.signature_lifecycle_fixture set ${changes} where id=1`))
          .rejects.toThrow(error)
      })
    },
  )
})

async function sealFixture(changes = '') {
  await db.exec(`insert into public.signature_canonical_guard_fixture(id,status,binding_months,notice_months)
    values (1,'pending_signature',12,2)`)
  if (changes) await db.exec(`update public.signature_canonical_guard_fixture set ${changes} where id=1`)
  // Deliberately synthetic evidence; no real identity, signature, consent or IP.
  await db.exec(`update public.signature_canonical_guard_fixture set status='signed',
    signed_at='2026-10-28T10:00:00Z', locked_at='2026-10-28T10:00:00Z',
    signature_snapshot='{"fixture":true}', signature_snapshot_sha256=repeat('a',64),
    contract_product_version_id='00000000-0000-0000-0000-000000000001',
    contract_publication_version_id='00000000-0000-0000-0000-000000000002',
    legal_bundle_version_id='00000000-0000-0000-0000-000000000003',
    contract_price_snapshot_id='00000000-0000-0000-0000-000000000004' where id=1`)
}

const activationShape = `update public.signature_canonical_guard_fixture set status='active',
  actual_start_date='2027-01-31', confirmed_start_date='2027-01-31',
  billing_eligible_at='2027-01-31', lifecycle_stage='active',
  billing_eligibility_source='activate_customer_supply_v1' where id=1`

describe('three actual source trigger functions on isolated synthetic records', () => {
  it('allows activation-shaped operational writes while signed commercial dates stay frozen', async () => {
    await sealFixture(); await db.exec(activationShape)
    expect((await db.query(`select status,actual_start_date::text,starts_at,ends_at,expected_start_at,
      signature_snapshot_sha256 from public.signature_canonical_guard_fixture`)).rows)
      .toEqual([{ status: 'active', actual_start_date: '2027-01-31', starts_at: null, ends_at: null,
        expected_start_at: null, signature_snapshot_sha256: 'a'.repeat(64) }])
  })

  it('still requires the actual state-machine operational evidence', async () => {
    await sealFixture()
    await expect(db.exec(`update public.signature_canonical_guard_fixture set status='active',
      actual_start_date='2027-01-31' where id=1`)).rejects.toThrow(/activation_requires_supply_graph/)
    expect((await db.query('select status,actual_start_date from public.signature_canonical_guard_fixture')).rows)
      .toEqual([{ status: 'signed', actual_start_date: null }])
  })

  it('does not activate a future confirmation before actual delivery', async () => {
    await sealFixture()
    await db.exec(`update public.signature_canonical_guard_fixture set confirmed_start_date='2027-01-31' where id=1`)
    await expect(db.exec(`update public.signature_canonical_guard_fixture set status='active',
      billing_eligible_at='2027-01-31',lifecycle_stage='active',
      billing_eligibility_source='activate_customer_supply_v1' where id=1`))
      .rejects.toThrow(/activation_requires_supply_graph/)
  })

  it.each(['terminated', 'cancelled'])('permits pre-delivery %s with terminal evidence and no invented start', async (status) => {
    await sealFixture()
    await db.query(`update public.signature_canonical_guard_fixture set status=$1,
      ended_at='2026-10-29',status_reason_code='fixture_terminal' where id=1`, [status])
    expect((await db.query('select status,actual_start_date,starts_at,ends_at from public.signature_canonical_guard_fixture')).rows)
      .toEqual([{ status, actual_start_date: null, starts_at: null, ends_at: null }])
  })

  it('keeps the real terminal-evidence requirement', async () => {
    await sealFixture()
    await expect(db.exec(`update public.signature_canonical_guard_fixture set status='terminated' where id=1`))
      .rejects.toThrow(/terminal_evidence_required/)
  })

  it.each([null, '2028-01-31'])('preserves sealed end %s on a notice update after the immutable trigger', async (end) => {
    await sealFixture(end ? `ends_at='${end}'` : '')
    await db.exec(`update public.signature_canonical_guard_fixture set termination_reason='customer_request',
      termination_notice_date='2028-01-31' where id=1`)
    expect((await db.query('select ends_at::date::text from public.signature_canonical_guard_fixture')).rows)
      .toEqual([{ ends_at: end }])
  })

  it.each(["starts_at='2027-01-31'", "ends_at='2028-01-31'", 'invoice_fee_sek=100'])('rejects signed commercial tampering: %s', async (change) => {
    await sealFixture()
    await expect(db.exec(`update public.signature_canonical_guard_fixture set ${change} where id=1`))
      .rejects.toThrow(/signed_customer_contract_immutable/)
  })

  it.each(['terminated', 'cancelled', 'expired'])('preserves frozen dates when an active fixture becomes %s', async (status) => {
    await sealFixture(); await db.exec(activationShape)
    await db.query(`update public.signature_canonical_guard_fixture set status=$1,
      ended_at='2028-02-01',status_reason_code='fixture_terminal' where id=1`, [status])
    expect((await db.query('select starts_at,ends_at,actual_start_date::text from public.signature_canonical_guard_fixture')).rows)
      .toEqual([{ starts_at: null, ends_at: null, actual_start_date: '2027-01-31' }])
  })
})
