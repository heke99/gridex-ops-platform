// reality-defects: H3d
// H3d D11 / owner decision 28, slice 1: a break fee exists only as an approved, traceable charge
// (public.break_fee_charges) created by public.gridex_approve_break_fee_v1 from an open break_fee_review task. These
// tests run migration 20261025110000 in embedded PostgreSQL over minimal tables and stubs for auth and permissions,
// and prove each rule of the decision: actor and permission, binding, customer category, fixed-price share, the
// computed loss as ceiling, no monthly or administrative fees, a verified VAT classification, a contract rule for
// large businesses, one fee per review and contract (idempotent), and the recorded contract version and approver.
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(path.resolve(__dirname, '../supabase/migrations/20261025110000_d11_break_fee_charges.sql'), 'utf8')
const C = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999'
const CU = '22222222-2222-4222-8222-222222222222', ACTOR = '33333333-3333-4333-8333-333333333333', STRANGER = '44444444-4444-4444-8444-444444444444'
let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

let db: PGlite
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions;
    create function auth.role() returns text language sql as $$ select coalesce(current_setting('test.role', true), 'authenticated') $$;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.companies(id uuid primary key);
    create table public.customer_contracts(id uuid primary key, company_id uuid, customer_id uuid, contract_type text, fixed_price_ore_per_kwh numeric,
      binding_months int, contract_version text, terms_version text, signed_version text, snapshot_hash text, signature_snapshot_sha256 text);
    create table public.customer_operation_tasks(id uuid primary key, company_id uuid, customer_id uuid, task_type text, status text, metadata jsonb,
      resolved_at timestamptz, updated_at timestamptz, updated_by uuid);
    create table public.billing_underlays(id uuid primary key);
    create function public.gridex_actor_has_company_permission(a uuid, c uuid, p text) returns boolean language sql as $$ select a = '${ACTOR}'::uuid and p = 'billing_underlay.export' $$;
    create function public.gridex_can_write_company(c uuid) returns boolean language sql as $$ select true $$;
    insert into public.companies values ('${C}'), ('${OTHER}');
  `)
  await db.exec(migration)
  await db.exec(`select set_config('test.uid', '${ACTOR}', false)`)
})

async function review(contract: Record<string, unknown> = {}, meta: Record<string, unknown> = {}, company = C) {
  const ct = uuid(), task = uuid()
  const row = { contract_type: 'fixed', fixed_price_ore_per_kwh: 120, binding_months: 12, ...contract }
  await db.query(`insert into public.customer_contracts values($1,$2,$3,$4,$5,$6,'v3','t2','s1','hash-1','sig-1')`, [ct, company, CU, row.contract_type, row.fixed_price_ore_per_kwh, row.binding_months])
  await db.query(`insert into public.customer_operation_tasks(id,company_id,customer_id,task_type,status,metadata) values($1,$2,$3,'break_fee_review','open',$4)`,
    [task, company, CU, JSON.stringify({ contract_id: ct, binding_ends_at: '2027-09-01', supply_end_date: '2026-10-23', ...meta })])
  return { ct, task }
}
const VAT = { code: 'early_termination_compensation', vat_rate: 0.25, account: '3990', verified_by: 'accountant-1', verified_at: '2026-10-25', source: 'tax-advice-2026-10' }
const input = (patch: Record<string, unknown> = {}) => ({ customer_category: 'consumer', category_basis: { type: 'private_person' }, amount_ex_vat: 300,
  calculation: { method: 'price_difference', components: ['price_difference'], fixed_price_ore_per_kwh: 120, replacement_price_ore_per_kwh: 90, remaining_expected_kwh: 1500 },
  loss_basis: { forward_price_source: 'nasdaq-2026-10-25', expected_volume_source: 'last-12-months' }, vat_classification: VAT, ...patch })
const approve = async (task: string, body: Record<string, unknown>, actor = ACTOR, company = C) =>
  (await db.query<{ r: Record<string, unknown> }>('select public.gridex_approve_break_fee_v1($1,$2,$3,$4) r', [company, task, JSON.stringify(body), actor])).rows[0].r
const refused = async (task: string, body: Record<string, unknown>, actor = ACTOR, company = C) => {
  try { await approve(task, body, actor, company); return 'ok' } catch (e) { return (e as Error).message }
}

describe('D11 a break fee is an approved, traceable charge with the decision\'s rules', () => {
  it('approves a consumer fixed-price fee up to the computed loss and records version, basis, calculation, VAT and approver', async () => {
    const { ct, task } = await review()
    expect(await approve(task, input())).toMatchObject({ applied: true, status: 'approved', computedLossSek: 450 })
    const row = (await db.query<Record<string, unknown>>('select * from public.break_fee_charges')).rows[0]
    expect(row).toMatchObject({ customer_contract_id: ct, review_task_id: task, customer_category: 'consumer', contract_basis: 'consumer_fixed_term_fixed_price',
      approved_by: ACTOR, status: 'approved' })
    expect(row.contract_version).toMatchObject({ contract_version: 'v3', terms_version: 't2', snapshot_hash: 'hash-1', contract_type: 'fixed', binding_months: 12 })
    expect(row.calculation).toMatchObject({ computed_loss_sek: 450 })
    expect(row.vat_classification).toEqual(VAT)
    expect((await db.query('select status, metadata from public.customer_operation_tasks where id=$1', [task])).rows[0]).toMatchObject({ status: 'done', metadata: { decision: 'approved', charged_automatically: false } })
  })

  it('is charged once: a repeated approval returns the existing charge, a second review of the same contract is refused', async () => {
    const { ct, task } = await review()
    await approve(task, input())
    expect(await approve(task, input())).toMatchObject({ applied: false, reason: 'already_approved' })
    const second = uuid()
    await db.query(`insert into public.customer_operation_tasks(id,company_id,customer_id,task_type,status,metadata) values($1,$2,$3,'break_fee_review','open',$4)`,
      [second, C, CU, JSON.stringify({ contract_id: ct, binding_ends_at: '2027-09-01', supply_end_date: '2026-10-23' })])
    expect(await refused(second, input())).toMatch(/break_fee_charges_customer_contract_id_key|duplicate key/)
    expect((await db.query<{ n: number }>('select count(*)::int n from public.break_fee_charges')).rows[0].n).toBe(1)
  })

  it('never for variable price or a portfolio without a fixed part (consumer and small business)', async () => {
    for (const contract of [{ contract_type: 'variable_monthly', fixed_price_ore_per_kwh: null }, { contract_type: 'spot', fixed_price_ore_per_kwh: null },
      { contract_type: 'portfolio', fixed_price_ore_per_kwh: null }, { contract_type: 'mixed', fixed_price_ore_per_kwh: null }]) {
      for (const category of ['consumer', 'small_business']) {
        const { task } = await review(contract)
        expect(await refused(task, input({ customer_category: category }))).toBe('break_fee_requires_fixed_price_share')
      }
    }
    const { task } = await review({ contract_type: 'portfolio', fixed_price_ore_per_kwh: 110 })
    expect(await approve(task, input({ calculation: { ...input().calculation as object, fixed_price_ore_per_kwh: 110 } }))).toMatchObject({ applied: true })
  })

  it('the amount never exceeds the loss, and the calculation never includes monthly or administrative fees', async () => {
    const a = await review()
    expect(await refused(a.task, input({ amount_ex_vat: 450.01 }))).toBe('break_fee_exceeds_loss')
    const b = await review()
    expect(await refused(b.task, input({ calculation: { ...input().calculation as object, components: ['price_difference', 'monthly_fee'] } }))).toBe('break_fee_component_not_allowed')
    const c = await review()
    expect(await refused(c.task, input({ calculation: { ...input().calculation as object, components: ['admin_switch_fee'] } }))).toBe('break_fee_component_not_allowed')
    const d = await review()
    expect(await refused(d.task, input({ calculation: { method: 'price_difference', replacement_price_ore_per_kwh: 90 } }))).toBe('break_fee_calculation_incomplete')
  })

  it('a large business needs an explicit contract rule, not the consumer calculation', async () => {
    const a = await review({ contract_type: 'variable_monthly', fixed_price_ore_per_kwh: null })
    expect(await refused(a.task, input({ customer_category: 'large_business' }))).toBe('break_fee_contract_rule_required')
    expect(await approve(a.task, input({ customer_category: 'large_business', contract_rule_reference: 'Avtal 2026-03 §12.4', amount_ex_vat: 5000 }))).toMatchObject({ applied: true })
    expect((await db.query('select contract_basis, contract_rule_reference from public.break_fee_charges where review_task_id=$1', [a.task])).rows[0])
      .toEqual({ contract_basis: 'large_business_contract_rule', contract_rule_reference: 'Avtal 2026-03 §12.4' })
  })

  it('requires category basis, loss basis and a verified VAT classification', async () => {
    const t = await review()
    expect(await refused(t.task, input({ category_basis: {} }))).toBe('break_fee_category_basis_required')
    expect(await refused(t.task, input({ loss_basis: {} }))).toBe('break_fee_loss_basis_required')
    for (const vat of [{}, { ...VAT, verified_by: null }, { ...VAT, vat_rate: 0.3 }, { ...VAT, source: null }])
      expect(await refused(t.task, input({ vat_classification: vat }))).toBe('break_fee_vat_classification_unverified')
  })

  it('only inside the binding, only for an open review of the tenant, only by a permitted actor who is the caller', async () => {
    const outside = await review({}, { binding_ends_at: '2026-10-20' })
    expect(await refused(outside.task, input())).toBe('break_fee_not_inside_binding')
    const unbound = await review({ binding_months: 0 })
    expect(await refused(unbound.task, input())).toBe('break_fee_not_inside_binding')
    const foreign = await review({}, {}, OTHER)
    expect(await refused(foreign.task, input())).toBe('break_fee_review_not_found_for_tenant')
    const t = await review()
    expect(await refused(t.task, input(), STRANGER)).toBe('break_fee_actor_mismatch')
    await db.exec(`select set_config('test.uid', '${STRANGER}', false)`)
    expect(await refused(t.task, input(), STRANGER)).toBe('break_fee_approval_not_allowed')
    await db.exec(`select set_config('test.uid', '${ACTOR}', false)`)
    await db.query("update public.customer_operation_tasks set status='cancelled' where id=$1", [t.task])
    expect(await refused(t.task, input())).toBe('break_fee_review_not_open')
  })

  it('closes the table to direct writes from API roles', async () => {
    const { rows } = await db.query<{ r: string; p: boolean }>(`select r, has_table_privilege(r,'public.break_fee_charges','insert,update,delete') p from unnest(array['anon','authenticated','service_role']) r`)
    expect(rows.every(row => !row.p)).toBe(true)
  })
})
