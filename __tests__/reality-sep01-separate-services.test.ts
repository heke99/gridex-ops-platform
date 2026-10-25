// reality-defects: SEP-01
// SEP-01 / owner decision 29: separately agreed services are registered per service (public.contract_separate_services)
// with content, price, agreement reference and version, acceptance, start, termination terms, end and supply dependency.
// The marker alone never gives a right to keep billing (gridex_separate_service_billable_v1): the service must be active
// and inside its agreement, actually provided, a supply-dependent service stops with the supply, an independent one
// continues after the supply end only with a documented review, and no electricity-trade fee can be registered as one.
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(path.resolve(__dirname, '../supabase/migrations/20261025130000_sep01_contract_separate_services.sql'), 'utf8')
const C = '11111111-1111-4111-8111-111111111111', OTHER = '99999999-9999-4999-8999-999999999999'
const CU = '22222222-2222-4222-8222-222222222222', ACTOR = '33333333-3333-4333-8333-333333333333', CT = '44444444-4444-4444-8444-444444444444'

let db: PGlite
beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth; create schema extensions;
    create function auth.role() returns text language sql as $$ select 'service_role' $$;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table public.companies(id uuid primary key);
    create table public.customers(id uuid primary key, company_id uuid);
    create table public.customer_contracts(id uuid primary key, company_id uuid, customer_id uuid);
    create table public.customer_supply_periods(id serial, company_id uuid, customer_contract_id uuid, status text, start_date date, end_date date, actual_start_date date, actual_end_date date);
    create function public.gridex_actor_has_company_permission(a uuid, c uuid, p text) returns boolean language sql as $$ select a = '${ACTOR}'::uuid and p = 'billing_underlay.export' $$;
    create function public.gridex_can_write_company(c uuid) returns boolean language sql as $$ select true $$;
    insert into public.companies values ('${C}'), ('${OTHER}');
    insert into public.customers values ('${CU}', '${C}');
    insert into public.customer_contracts values ('${CT}', '${C}', '${CU}');
    -- Supply under the contract from 1 Sep until 23 Oct (the period's own end date).
    insert into public.customer_supply_periods(company_id,customer_contract_id,status,start_date,end_date) values ('${C}','${CT}','ended','2026-09-01','2026-10-23');
  `)
  await db.exec(migration)
})

const service = (patch: Record<string, unknown> = {}) => ({ customer_id: CU, customer_contract_id: CT, service_code: 'solar_monitoring',
  description: 'Övervakning av solcellsanläggning', price: { amount: 49, unit: 'sek_month', vat_rate: 0.25 }, agreement_reference: 'Tjänsteavtal SOL-1',
  agreement_version: '2026-08', customer_acceptance: { accepted_at: '2026-08-20', method: 'bankid', evidence: 'sig-1' }, starts_on: '2026-09-01',
  termination_terms: { notice_months: 1 }, supply_dependency: 'independent', ...patch })
const register = async (body: Record<string, unknown>, actor = ACTOR, company = C) =>
  (await db.query<{ r: { serviceId: string } }>('select public.gridex_register_separate_service_v1($1,$2,$3) r', [company, JSON.stringify(body), actor])).rows[0].r.serviceId
const fails = async (sql: string, params: unknown[]) => { try { await db.query(sql, params); return 'ok' } catch (e) { return (e as Error).message } }
const provide = (id: string, through: string, evidence: Record<string, unknown> = { report: 'monitoring-log' }) =>
  db.query('select public.gridex_record_separate_service_provision_v1($1,$2,$3,$4,$5)', [C, id, through, JSON.stringify(evidence), ACTOR])
const billable = async (id: string, start: string, end: string) =>
  (await db.query<{ r: { billable: boolean; reasons: string[] } }>('select public.gridex_separate_service_billable_v1($1,$2,$3,$4) r', [C, id, start, end])).rows[0].r

describe('SEP-01 a separate service bills only under its own agreement, actually provided, never as a relabelled fee', () => {
  it('records the agreement facts per service', async () => {
    const id = await register(service())
    expect((await db.query('select service_code, agreement_reference, agreement_version, supply_dependency, starts_on::text, customer_acceptance from public.contract_separate_services where id=$1', [id])).rows[0])
      .toMatchObject({ service_code: 'solar_monitoring', agreement_reference: 'Tjänsteavtal SOL-1', agreement_version: '2026-08', supply_dependency: 'independent', starts_on: '2026-09-01', customer_acceptance: { method: 'bankid' } })
  })

  it('never accepts an electricity-trade fee as a separate service', async () => {
    for (const code of ['fixed_monthly_fee', 'invoice_fee', 'markup_ore_per_kwh', 'energy', 'admin_fee', 'green_energy_fee', 'monthly_fee', 'break_fee'])
      expect(await fails('select public.gridex_register_separate_service_v1($1,$2,$3)', [C, JSON.stringify(service({ service_code: code })), ACTOR])).toMatch(/contract_separate_services_service_code_check/)
  })

  it('the marker alone is not billable: it must be provided, and inside its agreement', async () => {
    const id = await register(service())
    expect(await billable(id, '2026-09-01', '2026-10-01')).toEqual({ billable: false, reasons: ['not_provided'], supplied: true })
    await provide(id, '2026-09-30')
    expect(await billable(id, '2026-09-01', '2026-10-01')).toMatchObject({ billable: true, reasons: [] })
    const ended = await register(service({ ends_on: '2026-09-15' }))
    await provide(ended, '2026-09-15')
    expect((await billable(ended, '2026-09-01', '2026-10-01')).reasons).toContain('outside_agreement')
  })

  it('a supply-dependent service stops with the supply (default), whatever is recorded', async () => {
    const id = await register(service({ service_code: 'smart_meter_app', supply_dependency: 'supply_dependent' }))
    await provide(id, '2026-11-30')
    expect(await billable(id, '2026-10-01', '2026-10-23')).toMatchObject({ billable: true })
    expect(await billable(id, '2026-11-01', '2026-12-01')).toMatchObject({ billable: false, reasons: ['supply_ended'] })
    expect(await fails('select public.gridex_review_separate_service_continuation_v1($1,$2,$3,$4)', [C, id, JSON.stringify({ agreement_clause: '§4' }), ACTOR])).toBe('separate_service_depends_on_supply')
  })

  it('an independent service continues after the supply end only with a documented review and actual provision', async () => {
    const id = await register(service())
    await provide(id, '2026-11-30')
    expect(await billable(id, '2026-11-01', '2026-12-01')).toMatchObject({ billable: false, reasons: ['continuation_review_required'] })
    expect(await fails('select public.gridex_review_separate_service_continuation_v1($1,$2,$3,$4)', [C, id, JSON.stringify({}), ACTOR])).toBe('separate_service_continuation_basis_required')
    await db.query('select public.gridex_review_separate_service_continuation_v1($1,$2,$3,$4)', [C, id, JSON.stringify({ agreement_clause: 'SOL-1 §4: fortsätter oberoende av elavtal' }), ACTOR])
    expect(await billable(id, '2026-11-01', '2026-12-01')).toMatchObject({ billable: true, reasons: [] })
    expect((await billable(id, '2026-12-01', '2027-01-01')).reasons).toContain('not_provided')
  })

  it('keeps tenant, permission and evidence checks, and no direct writes', async () => {
    expect(await fails('select public.gridex_register_separate_service_v1($1,$2,$3)', [C, JSON.stringify(service()), '55555555-5555-4555-8555-555555555555'])).toBe('separate_service_not_allowed')
    expect(await fails('select public.gridex_register_separate_service_v1($1,$2,$3)', [OTHER, JSON.stringify(service()), ACTOR])).toBe('separate_service_customer_not_found')
    const id = await register(service())
    expect(await fails('select public.gridex_record_separate_service_provision_v1($1,$2,$3,$4,$5)', [C, id, '2026-09-30', '{}', ACTOR])).toBe('separate_service_provision_evidence_required')
    expect(await fails('select public.gridex_record_separate_service_provision_v1($1,$2,$3,$4,$5)', [C, id, '2026-08-01', JSON.stringify({ x: 1 }), ACTOR])).toBe('separate_service_provision_outside_agreement')
    const { rows } = await db.query<{ p: boolean }>(`select bool_or(has_table_privilege(r,'public.contract_separate_services','insert,update,delete')) p from unnest(array['anon','authenticated','service_role']) r`)
    expect(rows[0].p).toBe(false)
  })
})
