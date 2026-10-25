// reality-defects: H3d
// H3d D11 / owner decision 28, slice 2 (SQL, migration 20261025120000): an approved break fee becomes one billing
// underlay of its own segment (gridex_underlay_break_fee_v1), is invoiced once (trigger on customer_invoices) and a
// credit is linked only through billing_adjustment_cases (gridex_record_break_fee_credit_v1). The invoice readiness
// source basis (gridex_read_billing_underlay_source_basis_v1, pre-image from supabase/schema.sql) qualifies a break-fee
// underlay only through its own bound charge. Embedded PostgreSQL with minimal tables and stubs.
import { beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const slice1 = read('supabase/migrations/20261025110000_d11_break_fee_charges.sql')
const slice2 = read('supabase/migrations/20261025120000_d11_break_fee_underlay_invoice.sql')
const C = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999'
const CU = '22222222-2222-4222-8222-222222222222', ACTOR = '33333333-3333-4333-8333-333333333333'
const CT = '44444444-4444-4444-8444-444444444444', TASK = '55555555-5555-4555-8555-555555555555', SNAP = '66666666-6666-4666-8666-666666666666'

function basisPreImage() {
  const schema = read('supabase/schema.sql')
  const start = schema.indexOf('CREATE FUNCTION public.gridex_read_billing_underlay_source_basis_v1(')
  const body = /AS (\$[^$]*\$)([\s\S]*?)\1;/.exec(schema.slice(start))![2]
  expect(createHash('sha256').update(body, 'utf8').digest('hex')).toBe('496d105d3460b02556c830318043efd3cb8939b97475690729b325b50787cbb7')
  return body
}

let db: PGlite
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions;
    create schema gridex_billing_source; create schema gridex_utilts_binding;
    create function auth.role() returns text language sql as $$ select 'service_role' $$;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table public.companies(id uuid primary key);
    create table public.customer_contracts(id uuid primary key, company_id uuid, customer_id uuid, contract_type text, fixed_price_ore_per_kwh numeric,
      binding_months int, contract_version text, terms_version text, signed_version text, snapshot_hash text, signature_snapshot_sha256 text,
      site_id uuid, customer_site_id uuid, metering_point_id uuid);
    create table public.customer_operation_tasks(id uuid primary key, company_id uuid, customer_id uuid, task_type text, status text, metadata jsonb,
      resolved_at timestamptz, updated_at timestamptz, updated_by uuid);
    create table public.contract_price_snapshots(id uuid primary key, company_id uuid, contract_id uuid, valid_from date, valid_to date, snapshot_json jsonb);
    create table public.billing_underlays(id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, site_id uuid, customer_site_id uuid,
      metering_point_id uuid, contract_id uuid, customer_contract_id uuid, contract_price_snapshot_id uuid, pricing_snapshot_id uuid, underlay_year int,
      underlay_month int, billing_period_start date, billing_period_end date, status text, readiness_status text, total_kwh numeric, currency text,
      source_system text, energy_direction text, settlement_type text, payload jsonb, metadata jsonb, created_by uuid, updated_by uuid);
    create table public.customer_invoices(id uuid primary key default gen_random_uuid(), company_id uuid, billing_underlay_id uuid);
    create table public.billing_adjustment_cases(id uuid primary key default gen_random_uuid(), company_id uuid, original_invoice_id uuid, credit_invoice_id uuid);
    create table gridex_billing_source.underlay_bindings(underlay_id uuid, company_id uuid, source_basis_hash text);
    create table gridex_billing_source.correction_journal(underlay_id uuid);
    create function gridex_billing_source.require_underlay_v1(c uuid, u uuid) returns void language plpgsql as $$
      begin raise exception using errcode='23514', message='no metering source'; end $$;
    create function gridex_utilts_binding.canonical_decimal_v2(v text) returns text language sql as $$ select v $$;
    create function public.gridex_actor_has_company_permission(a uuid, c uuid, p text) returns boolean language sql as $$ select a = '${ACTOR}'::uuid $$;
    create function public.gridex_can_write_company(c uuid) returns boolean language sql as $$ select true $$;
    insert into public.companies values ('${C}'), ('${OTHER}');
    insert into public.customer_contracts values ('${CT}','${C}','${CU}','fixed',120,12,'v3','t2','s1','h','sig',null,null,null);
    insert into public.customer_operation_tasks(id,company_id,customer_id,task_type,status,metadata) values ('${TASK}','${C}','${CU}','break_fee_review','open',
      '{"contract_id":"${CT}","binding_ends_at":"2027-09-01","supply_end_date":"2026-10-23"}');
    insert into public.contract_price_snapshots values ('${SNAP}','${C}','${CT}','2026-09-01',null,'{"price_area":"SE3"}');
  `)
  await db.exec(`CREATE FUNCTION public.gridex_read_billing_underlay_source_basis_v1(p_company_id uuid, p_underlay_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $pre$${basisPreImage()}$pre$;`)
  await db.exec(slice1)
  await db.exec(slice2)
  await db.exec("set role service_role; reset role")
})

const approve = async () => (await db.query<{ r: { chargeId: string } }>(`select public.gridex_approve_break_fee_v1($1,$2,$3,$4) r`, [C, TASK, JSON.stringify({
  customer_category: 'consumer', category_basis: { type: 'private' }, amount_ex_vat: 300, loss_basis: { source: 'x' },
  calculation: { components: ['price_difference'], fixed_price_ore_per_kwh: 120, replacement_price_ore_per_kwh: 90, remaining_expected_kwh: 1500 },
  vat_classification: { code: 'c', vat_rate: 0.25, account: '3990', verified_by: 'a', verified_at: '2026-10-25', source: 's' } }), ACTOR])).rows[0].r.chargeId
const underlay = async (charge: string) => (await db.query<{ r: Record<string, unknown> }>('select public.gridex_underlay_break_fee_v1($1,$2,$3) r', [C, charge, ACTOR])).rows[0].r
const charge = async (id: string) => (await db.query<Record<string, unknown>>('select * from public.break_fee_charges where id=$1', [id])).rows[0]
// The basis reader runs only for service_role, as the app calls it.
const basis = async (u: string) => {
  await db.exec('set role service_role')
  try { return (await db.query<{ r: Array<{ qualified: boolean }> }>("select public.gridex_read_billing_underlay_source_basis_v1($1, array[$2]::uuid[]) r", [C, u])).rows[0].r[0] }
  finally { await db.exec('reset role') }
}
const fails = async (sql: string, params: unknown[]) => { try { await db.query(sql, params); return 'ok' } catch (e) { return (e as Error).message } }

describe('D11 an approved break fee becomes its own underlay and invoice, once, with a traceable credit', () => {
  it('creates one underlay on the supply-end day with the contract, snapshot and charge; repeated calls return it', async () => {
    const id = await approve()
    const first = await underlay(id)
    expect(first).toMatchObject({ applied: true, status: 'underlaid' })
    expect(await underlay(id)).toMatchObject({ applied: false, reason: 'already_underlaid', billingUnderlayId: first.billingUnderlayId })
    const row = (await db.query<Record<string, unknown>>('select * from public.billing_underlays')).rows
    expect(row).toHaveLength(1)
    expect(row[0]).toMatchObject({ contract_id: CT, customer_contract_id: CT, contract_price_snapshot_id: SNAP, pricing_snapshot_id: SNAP, underlay_year: 2026,
      underlay_month: 10, status: 'validated', readiness_status: 'blocked', energy_direction: 'consumption', settlement_type: 'invoice',
      payload: expect.objectContaining({ charge_kind: 'break_fee', break_fee_charge_id: id, billing_period_end_exclusive: true }) })
    expect(String(row[0].billing_period_start).slice(0, 10)).not.toBe(String(row[0].billing_period_end).slice(0, 10))
    expect(await charge(id)).toMatchObject({ status: 'underlaid', billing_underlay_id: first.billingUnderlayId })
  })

  it('the source basis qualifies a break-fee underlay only through its own bound charge; energy underlays are unchanged', async () => {
    const id = await approve()
    const { billingUnderlayId } = await underlay(id) as { billingUnderlayId: string }
    expect(await basis(billingUnderlayId)).toMatchObject({ qualified: true })
    await db.query("update public.break_fee_charges set status='credited' where id=$1", [id])
    expect(await basis(billingUnderlayId)).toMatchObject({ qualified: false })
    const energy = (await db.query<{ id: string }>("insert into public.billing_underlays(company_id,payload) values($1,'{}') returning id", [C])).rows[0].id
    expect(await basis(energy)).toMatchObject({ qualified: false }) // still the metering source rule (stub refuses)
    const forged = (await db.query<{ id: string }>("insert into public.billing_underlays(company_id,payload) values($1,$2) returning id", [C, JSON.stringify({ charge_kind: 'break_fee', break_fee_charge_id: id })])).rows[0].id
    expect(await basis(forged)).toMatchObject({ qualified: false }) // a charge bound to another underlay never qualifies it
  })

  it('is invoiced once; the invoice is linked to the charge', async () => {
    const id = await approve()
    const { billingUnderlayId } = await underlay(id) as { billingUnderlayId: string }
    const inv = (await db.query<{ id: string }>('insert into public.customer_invoices(company_id,billing_underlay_id) values($1,$2) returning id', [C, billingUnderlayId])).rows[0].id
    expect(await charge(id)).toMatchObject({ status: 'invoiced', invoice_id: inv })
    expect(await fails('insert into public.customer_invoices(company_id,billing_underlay_id) values($1,$2)', [C, billingUnderlayId])).toBe('break_fee_already_invoiced')
    expect(await fails('select public.gridex_underlay_break_fee_v1($1,$2,$3)', [C, id, ACTOR])).toBe('ok') // returns the existing underlay
    expect((await db.query<{ n: number }>('select count(*)::int n from public.billing_underlays')).rows[0].n).toBe(1)
  })

  it('a credit is linked only when an adjustment case names the original and the credit invoice', async () => {
    const id = await approve()
    const { billingUnderlayId } = await underlay(id) as { billingUnderlayId: string }
    expect(await fails('select public.gridex_record_break_fee_credit_v1($1,$2,$3,$4)', [C, id, '77777777-7777-4777-8777-777777777777', ACTOR])).toBe('break_fee_charge_not_invoiced')
    const inv = (await db.query<{ id: string }>('insert into public.customer_invoices(company_id,billing_underlay_id) values($1,$2) returning id', [C, billingUnderlayId])).rows[0].id
    const credit = (await db.query<{ id: string }>('insert into public.customer_invoices(company_id) values($1) returning id', [C])).rows[0].id
    expect(await fails('select public.gridex_record_break_fee_credit_v1($1,$2,$3,$4)', [C, id, credit, ACTOR])).toBe('break_fee_credit_not_traceable')
    await db.query('insert into public.billing_adjustment_cases(company_id,original_invoice_id,credit_invoice_id) values($1,$2,$3)', [C, inv, credit])
    expect((await db.query<{ r: unknown }>('select public.gridex_record_break_fee_credit_v1($1,$2,$3,$4) r', [C, id, credit, ACTOR])).rows[0].r).toMatchObject({ applied: true, status: 'credited' })
    expect(await charge(id)).toMatchObject({ status: 'credited', invoice_id: inv, credit_invoice_id: credit })
    expect((await db.query<{ r: unknown }>('select public.gridex_record_break_fee_credit_v1($1,$2,$3,$4) r', [C, id, credit, ACTOR])).rows[0].r).toMatchObject({ applied: false, reason: 'already_credited' })
  })

  it('refuses an unapproved, foreign or unpermitted charge', async () => {
    const id = await approve()
    expect(await fails('select public.gridex_underlay_break_fee_v1($1,$2,$3)', [OTHER, id, ACTOR])).toBe('break_fee_charge_not_found_for_tenant')
    expect(await fails('select public.gridex_underlay_break_fee_v1($1,$2,$3)', [C, id, '88888888-8888-4888-8888-888888888888'])).toBe('break_fee_underlay_not_allowed')
    await db.query("update public.break_fee_charges set status='cancelled' where id=$1", [id])
    expect(await fails('select public.gridex_underlay_break_fee_v1($1,$2,$3)', [C, id, ACTOR])).toBe('break_fee_charge_not_approved')
  })
})
