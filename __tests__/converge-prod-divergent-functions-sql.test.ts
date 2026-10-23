import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// The four converged functions carry the production body byte-for-byte, and
// OUTBOUND-001 of run_tenant_integrity_audit checks the switch/contract links
// and the metering-point customer, whether or not outbound_requests carries the
// optional link columns.
const migration = readFileSync('supabase/migrations/20261023150000_converge_prod_divergent_functions.sql', 'utf8')
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [companyA, companyB, customerA, customerA2, customerB, siteA, meterA, meterOther, contractB, switchB] =
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(id)
let db: PGlite

async function outboundFindings() {
  const { rows: [run] } = await db.query<{ result: { ok: boolean; error?: string } }>(
    "select public.run_tenant_integrity_audit(null,'operations',null) as result")
  expect(run?.result).toMatchObject({ ok: true })
  const { rows } = await db.query<{ entity_id: string }>(
    "select entity_id from public.tenant_integrity_findings where rule_key='OUTBOUND-001' and run_id=(select id from public.tenant_integrity_audit_runs order by started_at desc, id desc limit 1) order by entity_id")
  return rows.map(row => row.entity_id)
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create table public.companies(id uuid primary key, status text default 'active', is_active boolean default true, is_paused boolean default false, lifecycle_status text, outbound_frozen boolean default false);
    create table public.tenant_integrity_rule_registry(rule_key text primary key, is_enabled boolean, severity text, title text);
    create table public.tenant_integrity_audit_runs(id uuid primary key default gen_random_uuid(), company_id uuid, scope text, requested_by uuid, status text, metadata jsonb default '{}', started_at timestamptz default clock_timestamp(), finished_at timestamptz, finding_count int, critical_count int, high_count int, medium_count int, low_count int, info_count int, error_message text);
    create table public.tenant_integrity_findings(run_id uuid, rule_key text, company_id uuid, entity_type text, entity_id uuid, severity text, title text, message text, fingerprint text, evidence jsonb);
    create table public.customers(id uuid primary key, company_id uuid);
    create table public.customer_sites(id uuid primary key, company_id uuid, customer_id uuid);
    create table public.metering_points(id uuid primary key, company_id uuid, site_id uuid, customer_id uuid);
    create table public.customer_contracts(id uuid primary key, company_id uuid, customer_id uuid, customer_site_id uuid, site_id uuid, metering_point_id uuid);
    create table public.supplier_switch_requests(id uuid primary key, company_id uuid, customer_id uuid, site_id uuid, metering_point_id uuid, customer_contract_id uuid, contract_id uuid);
    create table public.outbound_requests(id uuid primary key, company_id uuid, customer_id uuid, site_id uuid, customer_site_id uuid, metering_point_id uuid);
    create table public.dependency_circuit_state(dependency_key text primary key, state text not null default 'closed', half_open_after timestamptz, probe_lease_expires_at timestamptz, last_attempt_at timestamptz, updated_at timestamptz);
    insert into public.tenant_integrity_rule_registry values ('OUTBOUND-001',true,'critical','Outbound tenant mismatch');
    set check_function_bodies = off;`)
  await db.exec(migration)
})
afterAll(async () => { await db?.close() })

describe('production bodies', () => {
  it('keeps each converged body byte-identical to production', async () => {
    const { rows } = await db.query<{ name: string; sha: string }>(`select proname as name, encode(sha256(convert_to(prosrc,'UTF8')),'hex') as sha
      from pg_proc where pronamespace='public'::regnamespace and proname in ('gridex_apply_exact_z02_core','gridex_dependency_circuit_before_request_v1',
        'gridex_stage_energy_geodata_features_v2','gridex_create_invoice_export_graph_v1_core') order by proname`)
    expect(Object.fromEntries(rows.map(row => [row.name, row.sha]))).toEqual({
      gridex_apply_exact_z02_core: '04902d0adf63b94cc17e231cd93ed0692e1b54846525c8d6a899c25113543edf',
      gridex_create_invoice_export_graph_v1_core: 'aa5e13cc4acaca36a54aaf3b77635def30afead613471fc837f817d9eaa27253',
      gridex_dependency_circuit_before_request_v1: 'f164fc532add16ae83f027278591350ebdb6933a9a8bfc11326841631a0f2ed2',
      gridex_stage_energy_geodata_features_v2: 'da6b62864afc3eebb2d841903905b5058b2369c20a53fe563d892055920f4b80',
    })
  })

  it('half-opens an open circuit only once half_open_after is set and due', async () => {
    const before = (key: string) => db.query<{ allowed: boolean; circuit_state: string }>(
      'select allowed, circuit_state from public.gridex_dependency_circuit_before_request_v1($1)', [key]).then(result => result.rows[0])
    await db.exec(`insert into public.dependency_circuit_state(dependency_key,state,half_open_after) values
      ('svk.unset','open',null), ('svk.due','open',now()-interval '1 minute'), ('svk.later','open',now()+interval '1 hour')`)
    expect(await before('svk.unset')).toEqual({ allowed: false, circuit_state: 'open' })
    expect(await before('svk.due')).toEqual({ allowed: true, circuit_state: 'half_open' })
    expect(await before('svk.later')).toEqual({ allowed: false, circuit_state: 'open' })
  })
})

describe('OUTBOUND-001 merged check', () => {
  beforeEach(async () => {
    await db.exec(`truncate public.companies, public.customers, public.customer_sites, public.metering_points, public.customer_contracts,
      public.supplier_switch_requests, public.outbound_requests, public.tenant_integrity_findings, public.tenant_integrity_audit_runs`)
    await db.query(`insert into public.companies(id) values ($1),($2)`, [companyA, companyB])
    await db.query(`insert into public.customers values ($1,$4),($2,$4),($3,$5)`, [customerA, customerA2, customerB, companyA, companyB])
    await db.query(`insert into public.customer_sites values ($1,$2,$3)`, [siteA, companyA, customerA])
    await db.query(`insert into public.metering_points values ($1,$3,$4,$5),($2,$3,null,$6)`, [meterA, meterOther, companyA, siteA, customerA, customerA2])
    await db.query(`insert into public.customer_contracts values ($1,$2,$3,null,null,null)`, [contractB, companyB, customerB])
    await db.query(`insert into public.supplier_switch_requests values ($1,$2,$3,null,null,null,null)`, [switchB, companyB, customerB])
  })

  it('flags a metering point of another customer on the typed replay schema', async () => {
    await db.query(`insert into public.outbound_requests values ($1,$3,$4,$5,null,$6),($2,$3,$4,$5,null,$7)`,
      [id(20), id(21), companyA, customerA, siteA, meterA, meterOther])
    expect(await outboundFindings()).toEqual([id(21)])
  })

  it('flags a switch or contract of another tenant when the link columns exist', async () => {
    await db.exec(`alter table public.outbound_requests add column supplier_switch_request_id uuid, add column switch_request_id uuid,
      add column customer_contract_id uuid, add column contract_id uuid`)
    try {
      await db.query(`insert into public.outbound_requests(id,company_id,customer_id,site_id,metering_point_id,supplier_switch_request_id,customer_contract_id,contract_id) values
        ($1,$4,$5,$6,$7,null,null,null), ($2,$4,$5,$6,$7,$8,null,null), ($3,$4,$5,$6,$7,null,null,$9)`,
        [id(30), id(31), id(32), companyA, customerA, siteA, meterA, switchB, contractB])
      expect(await outboundFindings()).toEqual([id(31), id(32)])
    } finally {
      await db.exec(`alter table public.outbound_requests drop column supplier_switch_request_id, drop column switch_request_id,
        drop column customer_contract_id, drop column contract_id`)
    }
  })
})
