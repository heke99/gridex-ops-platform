// reality-defects: D11-G1
// D11-G1 / owner decision 33 (migration 20261026120000): an invoiced break fee is credited, fully or partially, through
// the existing invoice engine: gridex_request_break_fee_credit_v1 creates the adjustment case, a credit underlay and the
// credit row; the credit invoice is the normal customer_invoices row of that underlay, refused twice or for another
// amount, stamped with the original invoice and fee line; the charge's cumulative credit never exceeds its debit. The
// invoice readiness basis (pre-image = the body after 20261025120000) qualifies a credit underlay only through its own
// credit row. Embedded PostgreSQL with minimal tables and stubs.
import { beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const slice1 = read('supabase/migrations/20261025110000_d11_break_fee_charges.sql')
const slice2 = read('supabase/migrations/20261025120000_d11_break_fee_underlay_invoice.sql')
const g1 = read('supabase/migrations/20261026120000_d11g1_break_fee_credit.sql')
const C = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999'
const CU = '22222222-2222-4222-8222-222222222222', ACTOR = '33333333-3333-4333-8333-333333333333'
const CT = '44444444-4444-4444-8444-444444444444', TASK = '55555555-5555-4555-8555-555555555555', SNAP = '66666666-6666-4666-8666-666666666666'
const MP = '77777777-7777-4777-8777-777777777777'

function basisPreImage() {
  const schema = read('supabase/schema.sql')
  const start = schema.indexOf('CREATE FUNCTION public.gridex_read_billing_underlay_source_basis_v1(')
  const body = /AS (\$[^$]*\$)([\s\S]*?)\1;/.exec(schema.slice(start))![2]
  expect(createHash('sha256').update(body, 'utf8').digest('hex')).toBe('496d105d3460b02556c830318043efd3cb8939b97475690729b325b50787cbb7')
  return body
}

let db: PGlite
async function setup(withG1 = true) {
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
    create unique index billing_underlays_company_segment_uidx on public.billing_underlays(company_id, customer_id, metering_point_id, underlay_year,
      underlay_month, billing_period_start, billing_period_end, energy_direction);
    create table public.customer_invoices(id uuid primary key default gen_random_uuid(), company_id uuid, customer_id uuid, billing_underlay_id uuid,
      amount_ex_vat numeric, vat_amount numeric, amount_inc_vat numeric, metadata jsonb not null default '{}');
    create table public.billing_adjustment_cases(id uuid primary key default gen_random_uuid(), company_id uuid not null, original_billing_underlay_id uuid not null,
      corrected_billing_underlay_id uuid, original_invoice_id uuid, credit_invoice_id uuid, reason text not null, status text not null default 'detected',
      difference_minor_units bigint, currency character(3) not null, approval_required boolean not null default true, approved_by uuid, approved_at timestamptz,
      metadata jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.contract_charge_ledger(id uuid primary key default gen_random_uuid(), company_id uuid, customer_contract_id uuid, component_key text,
      event_key text, pricing_run_id uuid, amount_ex_vat numeric, unique (customer_contract_id, component_key, event_key));
    create table gridex_billing_source.underlay_bindings(underlay_id uuid, company_id uuid, source_basis_hash text);
    create table gridex_billing_source.correction_journal(underlay_id uuid);
    create function gridex_billing_source.require_underlay_v1(c uuid, u uuid) returns void language plpgsql as $$
      begin raise exception using errcode='23514', message='no metering source'; end $$;
    create function gridex_utilts_binding.canonical_decimal_v2(v text) returns text language sql as $$ select v $$;
    create function public.gridex_actor_has_company_permission(a uuid, c uuid, p text) returns boolean language sql as $$ select a = '${ACTOR}'::uuid and c = '${C}'::uuid $$;
    create function public.gridex_can_write_company(c uuid) returns boolean language sql as $$ select true $$;
    insert into public.companies values ('${C}'), ('${OTHER}');
    insert into public.customer_contracts values ('${CT}','${C}','${CU}','fixed',120,12,'v3','t2','s1','h','sig',null,null,'${MP}');
    insert into public.customer_operation_tasks(id,company_id,customer_id,task_type,status,metadata) values ('${TASK}','${C}','${CU}','break_fee_review','open',
      '{"contract_id":"${CT}","binding_ends_at":"2027-09-01","supply_end_date":"2026-10-23"}');
    insert into public.contract_price_snapshots values ('${SNAP}','${C}','${CT}','2026-09-01',null,'{"price_area":"SE3"}');
  `)
  await db.exec(`CREATE FUNCTION public.gridex_read_billing_underlay_source_basis_v1(p_company_id uuid, p_underlay_ids uuid[]) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog' AS $pre$${basisPreImage()}$pre$;`)
  await db.exec(slice1)
  await db.exec(slice2)
  if (withG1) await db.exec(g1)
}

const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows
const fails = async (sql: string, params: unknown[] = []) => { try { await db.query(sql, params); return 'ok' } catch (e) { return (e as Error).message } }
/** An approved 300 SEK fee, underlaid, locked (one ledger event) and invoiced through its own underlay. */
async function invoicedCharge() {
  const charge = (await q<{ r: { chargeId: string } }>(`select public.gridex_approve_break_fee_v1($1,$2,$3,$4) r`, [C, TASK, JSON.stringify({
    customer_category: 'consumer', category_basis: { type: 'private' }, amount_ex_vat: 300, loss_basis: { source: 'x' },
    calculation: { components: ['price_difference'], fixed_price_ore_per_kwh: 120, replacement_price_ore_per_kwh: 90, remaining_expected_kwh: 1500 },
    vat_classification: { code: 'etc', vat_rate: 0.25, account: '3990', verified_by: 'a', verified_at: '2026-10-25', source: 's' } }), ACTOR]))[0].r.chargeId
  const underlay = (await q<{ r: { billingUnderlayId: string } }>('select public.gridex_underlay_break_fee_v1($1,$2,$3) r', [C, charge, ACTOR]))[0].r.billingUnderlayId
  await q(`insert into public.contract_charge_ledger(company_id,customer_contract_id,component_key,event_key,amount_ex_vat) values ($1,$2,'break_fee',$3,300)`, [C, CT, charge])
  const invoice = (await q<{ id: string }>(`insert into public.customer_invoices(company_id,customer_id,billing_underlay_id,amount_ex_vat,vat_amount,amount_inc_vat)
    values ($1,$2,$3,300,75,375) returning id`, [C, CU, underlay]))[0].id
  return { charge, underlay, invoice }
}
const request = async (charge: string, input: Record<string, unknown>, actor = ACTOR, company = C) =>
  (await q<{ r: { creditId: string; billingUnderlayId: string; adjustmentCaseId: string; amountExVat: number } }>(
    'select public.gridex_request_break_fee_credit_v1($1,$2,$3,$4) r', [company, charge, JSON.stringify(input), actor]))[0].r
const requestFails = (charge: string, input: Record<string, unknown>, actor = ACTOR, company = C) =>
  fails('select public.gridex_request_break_fee_credit_v1($1,$2,$3,$4)', [company, charge, JSON.stringify(input), actor])
const creditInvoice = (underlay: string, exVat: number) => q<{ id: string; metadata: Record<string, unknown> }>(
  `insert into public.customer_invoices(company_id,customer_id,billing_underlay_id,amount_ex_vat,vat_amount,amount_inc_vat)
   values ($1,$2,$3,$4,$5,$6) returning id, metadata`, [C, CU, underlay, exVat, exVat * 0.25, exVat * 1.25])
const charge = async (id: string) => (await q('select status, credited_amount_ex_vat::float8 credited, credit_invoice_id from public.break_fee_charges where id=$1', [id]))[0]
const basis = async (u: string) => {
  await db.exec('set role service_role')
  try { return (await q<{ r: Array<{ qualified: boolean }> }>("select public.gridex_read_billing_underlay_source_basis_v1($1, array[$2]::uuid[]) r", [C, u]))[0].r[0] }
  finally { await db.exec('reset role') }
}
/** The same-day guard keeps one credit underlay per day; a later partial credit is a later day. */
const moveCreditToYesterday = (underlay: string) => q(`update public.billing_underlays set billing_period_start=billing_period_start-1, billing_period_end=billing_period_end-1 where id=$1`, [underlay])

describe('D11-G1 an invoiced break fee is credited through the existing invoice engine', () => {
  beforeEach(async () => { await setup() })

  it('before the migration there is no credit path for a break fee', async () => {
    await setup(false)
    const { charge: id } = await invoicedCharge()
    expect(await requestFails(id, { reason: 'Kunden bestred avgiften' })).toMatch(/gridex_request_break_fee_credit_v1.*does not exist/)
  })

  it('a full credit: adjustment case, credit underlay and one credit invoice referencing the original invoice and fee line', async () => {
    const { charge: id, underlay, invoice } = await invoicedCharge()
    const credit = await request(id, { reason: 'Kunden bestred avgiften' })
    expect(credit).toMatchObject({ amountExVat: 300 })
    expect((await q('select kind, status, amount_ex_vat::float8 amount, original_invoice_id, vat_classification->>\'vat_rate\' vat, original_fee_line->>\'component_key\' line from public.break_fee_credits where id=$1', [credit.creditId]))[0])
      .toEqual({ kind: 'full', status: 'underlaid', amount: 300, original_invoice_id: invoice, vat: '0.25', line: 'break_fee' })
    expect((await q('select status, original_invoice_id, original_billing_underlay_id, corrected_billing_underlay_id, approved_by, reason, difference_minor_units::int diff, metadata->>\'reason\' why from public.billing_adjustment_cases where id=$1', [credit.adjustmentCaseId]))[0])
      .toEqual({ status: 'credit_queued', original_invoice_id: invoice, original_billing_underlay_id: underlay, corrected_billing_underlay_id: credit.billingUnderlayId,
        approved_by: ACTOR, reason: 'break_fee_credit', diff: -30000, why: 'Kunden bestred avgiften' })
    expect((await q('select energy_direction, settlement_type, total_kwh::int kwh, readiness_status, payload->>\'charge_kind\' kind, payload->>\'break_fee_credit_id\' cr from public.billing_underlays where id=$1', [credit.billingUnderlayId]))[0])
      .toEqual({ energy_direction: 'consumption_correction', settlement_type: 'credit_invoice', kwh: 0, readiness_status: 'blocked', kind: 'break_fee_credit', cr: credit.creditId })
    expect((await basis(credit.billingUnderlayId)).qualified).toBe(true)
    const [inv] = await creditInvoice(credit.billingUnderlayId, -300)
    expect(inv.metadata).toMatchObject({ credit_of_invoice_id: invoice, credit_of_billing_underlay_id: underlay, break_fee_charge_id: id, break_fee_credit_id: credit.creditId,
      credited_fee_lines: [{ component_key: 'break_fee', event_key: id, amount_ex_vat: 300 }], credit_reason: 'Kunden bestred avgiften' })
    expect(await charge(id)).toEqual({ status: 'credited', credited: 300, credit_invoice_id: inv.id })
    expect((await q('select status, credit_invoice_id from public.billing_adjustment_cases where id=$1', [credit.adjustmentCaseId]))[0]).toEqual({ status: 'credited', credit_invoice_id: inv.id })
    // Never invoiced twice, never credited beyond the debit.
    expect(await fails(`insert into public.customer_invoices(company_id,customer_id,billing_underlay_id,amount_ex_vat) values ($1,$2,$3,-300)`, [C, CU, credit.billingUnderlayId])).toBe('break_fee_credit_already_invoiced')
    expect(await requestFails(id, { reason: 'igen' })).toBe('break_fee_charge_not_invoiced')
  })

  it('partial credits accumulate up to the debited amount, never above it', async () => {
    const { charge: id } = await invoicedCharge()
    const first = await request(id, { amount_ex_vat: 100, reason: 'Delvis bestriden' })
    expect((await q('select kind from public.break_fee_credits where id=$1', [first.creditId]))[0]).toEqual({ kind: 'partial' })
    // One credit at a time: a second request waits for the first credit invoice.
    expect(await requestFails(id, { amount_ex_vat: 50, reason: 'x' })).toBe('break_fee_credit_pending')
    await creditInvoice(first.billingUnderlayId, -100)
    expect(await charge(id)).toMatchObject({ status: 'partially_credited', credited: 100 })
    expect(await requestFails(id, { amount_ex_vat: 50, reason: 'samma dag' })).toBe('break_fee_credit_same_day')
    await moveCreditToYesterday(first.billingUnderlayId)
    expect(await requestFails(id, { amount_ex_vat: 200.01, reason: 'för mycket' })).toBe('break_fee_credit_exceeds_debit')
    const rest = await request(id, { reason: 'Resten' })
    expect(rest.amountExVat).toBe(200)
    await creditInvoice(rest.billingUnderlayId, -200)
    expect(await charge(id)).toMatchObject({ status: 'credited', credited: 300 })
  })

  it('the cap holds in the database even for a direct insert, and the invoice amount must be minus the credit', async () => {
    const { charge: id, underlay, invoice } = await invoicedCharge()
    const credit = await request(id, { amount_ex_vat: 250, reason: 'Delvis' })
    const caseId = credit.adjustmentCaseId
    expect(await fails(`insert into public.break_fee_credits(company_id,break_fee_charge_id,original_invoice_id,original_billing_underlay_id,original_fee_line,adjustment_case_id,
      credit_underlay_id,amount_ex_vat,currency,vat_classification,kind,reason,requested_by) values ($1,$2,$3,$4,'{}',$5,$4,51,'SEK','{}','partial','x',$6)`,
      [C, id, invoice, underlay, caseId, ACTOR])).toBe('break_fee_credit_exceeds_debit')
    expect(await fails(`insert into public.customer_invoices(company_id,customer_id,billing_underlay_id,amount_ex_vat) values ($1,$2,$3,-300)`, [C, CU, credit.billingUnderlayId])).toBe('break_fee_credit_amount_mismatch')
    expect(await charge(id)).toMatchObject({ status: 'invoiced', credited: 0 })
  })

  it('refuses without permission, reason, an invoiced charge or the own tenant; nobody writes the credit rows directly', async () => {
    const { charge: id } = await invoicedCharge()
    expect(await requestFails(id, { reason: 'x' }, '88888888-8888-4888-8888-888888888888')).toBe('break_fee_credit_not_allowed')
    expect(await requestFails(id, { reason: ' ' })).toBe('break_fee_credit_reason_required')
    expect(await requestFails(id, { reason: 'x', amount_ex_vat: 0 })).toBe('break_fee_credit_amount_invalid')
    expect(await requestFails(id, { reason: 'x' }, ACTOR, OTHER)).toBe('break_fee_credit_not_allowed')
    await q(`update public.break_fee_charges set status='underlaid', invoice_id=null where id=$1`, [id])
    expect(await requestFails(id, { reason: 'x' })).toBe('break_fee_charge_not_invoiced')
    const rows = await q<{ p: boolean }>(`select bool_or(has_table_privilege(r,'public.break_fee_credits','insert,update,delete')) p from unnest(array['anon','authenticated','service_role']) r`)
    expect(rows[0].p).toBe(false)
  })

  it('refuses another basis-reader pre-image', async () => {
    await setup(false)
    await db.exec(`create or replace function public.gridex_read_billing_underlay_source_basis_v1(p_company_id uuid, p_underlay_ids uuid[]) returns jsonb language sql as $$ select '[]'::jsonb $$`)
    await expect(db.exec(g1)).rejects.toThrow('d11g1_underlay_source_basis_pre_image_changed')
  })
})
