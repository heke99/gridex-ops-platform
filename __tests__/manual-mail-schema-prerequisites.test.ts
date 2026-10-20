import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const GUARD_SOURCE = 'supabase/migrations/20261018183448_manual_mail_automatic_application.sql'
const FORWARD_SOURCE = 'supabase/migrations/20261019095200_manual_mail_supplier_terms_schema_prerequisites.sql'
const COLUMN_NAMES = [
  'current_supplier_contract_status',
  'current_supplier_contract_end_date',
  'current_supplier_notice_period',
  'current_supplier_termination_fee',
  'current_supplier_response_status',
] as const
const CO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CUSTOMER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SITE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const SWITCH = '11111111-1111-4111-8111-111111111111'
const MESSAGE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ATTEMPT = '33333333-3333-4333-8333-333333333333'
const OTHER_CO = '55555555-5555-4555-8555-555555555555'
const OTHER_SWITCH = '66666666-6666-4666-8666-666666666666'
const SUPPLIER = '22222222-2222-4222-8222-222222222222'
const SSR_COLUMN_NAMES = ['current_supplier_id', 'current_supplier_unknown', ...COLUMN_NAMES]

// Frozen active continuation payload contract, not a recreated orchestrator:
// supplierSwitchOrchestration.ts's existing-request patch and db.part-2.ts's
// creation payload both write these seven fields to supplier_switch_requests.
const supplierPayload = {
  current_supplier_id: SUPPLIER,
  current_supplier_unknown: false,
  current_supplier_contract_status: 'active',
  current_supplier_contract_end_date: '2027-03-31',
  current_supplier_notice_period: '3 months',
  current_supplier_termination_fee: 0,
  current_supplier_response_status: 'free_to_switch',
}

// Execute the frozen source itself, without relying on a historical Git object
// or recreating the checkpoint in a test helper. Other mail commands are not
// needed to exercise this actual first-entry trigger.
function physicalGuardSql() {
  const source = fs.readFileSync(GUARD_SOURCE, 'utf8')
  const start = source.indexOf('create or replace function public.gridex_guard_manual_supplier_transport_entry_v1()')
  const end = source.indexOf('-- The existing open-request recorder', start)
  if (start < 0 || end <= start) throw new Error('physical_entry_guard_source_missing')
  return source.slice(start, end)
}

function forwardSql() {
  return fs.readFileSync(FORWARD_SOURCE, 'utf8')
}

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    -- Minimal projection of canonical customer_sites: deliberately no five
    -- legacy commercial fields. The existing atomic fixture had all five.
    create table public.customer_sites (
      id uuid primary key, company_id uuid, customer_id uuid,
      current_supplier_id uuid, metadata jsonb not null default '{}'
    );
    create table public.supplier_switch_requests (
      id uuid primary key, company_id uuid, customer_id uuid, site_id uuid,
      customer_site_id uuid, request_type text, status text,
      outbound_z03_message_id uuid, requested_start_date date, metadata jsonb
    );
    create table public.ediel_messages (
      id uuid primary key, company_id uuid, environment text, direction text,
      message_family text, message_code text, customer_id uuid, site_id uuid,
      switch_request_id uuid, raw_payload text, immutable_payload_hash text,
      immutable_rendered_at timestamptz
    );
    create table public.grid_owner_information_requests (
      id uuid primary key, company_id uuid, customer_id uuid,
      customer_site_id uuid, request_type text, metadata jsonb, status text
    );
    create schema gridex_ediel_transport;
    create table gridex_ediel_transport.attempts (
      id uuid primary key, message_id uuid, company_id uuid, environment text,
      entered_at timestamptz
    );
    create schema gridex_received_sources;
    create table gridex_received_sources.switch_originals (
      message_id uuid primary key, company_id uuid, switch_id uuid,
      original_object jsonb
    );
    create schema gridex_switch_cancellations;
    create table gridex_switch_cancellations.origins (
      message_id uuid primary key, company_id uuid, switch_id uuid,
      original_message_id uuid, payload_hash text
    );
  `)
  await db.exec(physicalGuardSql())
  await db.query(`insert into public.customer_sites(id,company_id,customer_id) values ($1,$2,$3)`, [SITE, CO, CUSTOMER])
  await db.query(`insert into public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,request_type,status,outbound_z03_message_id,requested_start_date,metadata)
    values ($1,$2,$3,$4,$4,'switch','prepared',$5,'2027-04-01','{}')`, [SWITCH, CO, CUSTOMER, SITE, MESSAGE])
  await db.query(`insert into public.ediel_messages(id,company_id,environment,direction,message_family,message_code,customer_id,site_id,switch_request_id)
    values ($1,$2,'production','outbound','PRODAT','Z03',$3,$4,$5)`, [MESSAGE, CO, CUSTOMER, SITE, SWITCH])
  await db.query(`insert into gridex_received_sources.switch_originals values ($1,$2,$3,'{"reason":"Z22","start":"202704010000+0200"}')`, [MESSAGE, CO, SWITCH])
  await db.query(`insert into gridex_ediel_transport.attempts(id,message_id,company_id,environment) values ($1,$2,$3,'production')`, [ATTEMPT, MESSAGE, CO])
}, 30_000)

beforeEach(async () => { await db.exec('begin') })
afterEach(async () => { await db.exec('rollback') })
afterAll(async () => { await db?.close() })

async function enter() {
  // A subtransaction lets the test inspect durable state after the real
  // trigger rejects the UPDATE; this does not emulate the native entry owner.
  await db.exec('savepoint entry')
  try {
    await db.query('update gridex_ediel_transport.attempts set entered_at=now() where id=$1', [ATTEMPT])
    await db.exec('release savepoint entry')
  } catch (error) {
    await db.exec('rollback to savepoint entry')
    throw error
  }
}

async function entered() {
  return (await db.query<{ entered_at: Date | null }>('select entered_at from gridex_ediel_transport.attempts where id=$1', [ATTEMPT])).rows[0].entered_at
}

async function columns() {
  return (await db.query<{ name: string; type: string; nullable: boolean; has_default: boolean; typmod: number }>(`
    select a.attname as name,format_type(a.atttypid,a.atttypmod) as type,
      not a.attnotnull as nullable,a.atthasdef as has_default,a.atttypmod as typmod
    from pg_attribute a where a.attrelid='public.customer_sites'::regclass
      and a.attname=any($1::text[]) and not a.attisdropped order by a.attname`, [COLUMN_NAMES])).rows
}

async function supplierColumns() {
  return (await db.query<{ name: string; type: string; nullable: boolean; default_value: string | null }>(`
    select a.attname as name,format_type(a.atttypid,a.atttypmod) as type,
      not a.attnotnull as nullable,pg_get_expr(d.adbin,d.adrelid) as default_value
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.supplier_switch_requests'::regclass
      and a.attname=any($1::text[]) and not a.attisdropped order by a.attname`, [SSR_COLUMN_NAMES])).rows
}

async function updateContinuation(payload: Record<string, string | number | boolean | null>) {
  const entries = Object.entries(payload)
  // Keys come solely from the explicit fixed runtime contract above.
  const assignments = entries.map(([column], index) => `${column}=$${index + 1}`).join(',')
  await db.exec('savepoint continuation')
  try {
    await db.query(`update public.supplier_switch_requests set ${assignments} where id=$${entries.length + 1} and company_id=$${entries.length + 2}`, [...entries.map(([, value]) => value), SWITCH, CO])
    await db.exec('release savepoint continuation')
  } catch (error) {
    await db.exec('rollback to savepoint continuation')
    throw error
  }
}

async function switchRow(id = SWITCH) {
  return (await db.query<{ value: Record<string, unknown> }>('select to_jsonb(ss) as value from public.supplier_switch_requests ss where id=$1', [id])).rows[0].value
}

describe('manual supplier checkpoint canonical schema prerequisites', () => {
  it('reproduces undefined_column on actual normal first entry before the additive forward', async () => {
    expect(await columns()).toEqual([])
    await expect(enter()).rejects.toMatchObject({ code: '42703' })
    expect(await entered()).toBeNull()
  })

  it('permits ordinary bound normal entry after adding the absent nullable fields', async () => {
    await db.exec(forwardSql())
    await enter()
    expect(await entered()).toBeInstanceOf(Date)
    expect(await columns()).toEqual([
      { name: 'current_supplier_contract_end_date', type: 'date', nullable: true, has_default: false, typmod: -1 },
      { name: 'current_supplier_contract_status', type: 'text', nullable: true, has_default: false, typmod: -1 },
      { name: 'current_supplier_notice_period', type: 'text', nullable: true, has_default: false, typmod: -1 },
      { name: 'current_supplier_response_status', type: 'text', nullable: true, has_default: false, typmod: -1 },
      { name: 'current_supplier_termination_fee', type: 'numeric', nullable: true, has_default: false, typmod: -1 },
    ])
    const site = (await db.query<{ value: Record<string, unknown> }>('select to_jsonb(s) as value from public.customer_sites s where id=$1', [SITE])).rows[0].value
    expect(COLUMN_NAMES.every(name => site[name] === null)).toBe(true)
    expect((await db.query<{ requested_start_date: string }>('select requested_start_date::text from public.supplier_switch_requests')).rows[0].requested_start_date).toBe('2027-04-01')
  })

  it.each(['manual_review', 'waiting_response', 'blocked'])('still prevents actual entry for current %s', async status => {
    await db.exec(forwardSql())
    await db.query('update public.customer_sites set current_supplier_response_status=$1 where id=$2', [status, SITE])
    await expect(enter()).rejects.toMatchObject({ code: '23514', message: 'manual_supplier_transport_not_ready' })
    expect(await entered()).toBeNull()
  })

  it('still prevents actual entry for an explicit positive termination fee', async () => {
    await db.exec(forwardSql())
    await db.exec('update public.customer_sites set current_supplier_termination_fee=100')
    await expect(enter()).rejects.toMatchObject({ code: '23514', message: 'manual_supplier_transport_not_ready' })
    expect(await entered()).toBeNull()
  })

  it('preserves exact existing production-shaped facts on repeated forward application', async () => {
    await db.exec(forwardSql())
    await db.exec(`update public.customer_sites set current_supplier_contract_status='active',current_supplier_contract_end_date='2027-03-31',
      current_supplier_notice_period='3 months',current_supplier_termination_fee=123.45,current_supplier_response_status='manual_review'`)
    const before = (await db.query('select to_jsonb(s) as value from public.customer_sites s')).rows
    await db.exec(forwardSql())
    expect((await db.query('select to_jsonb(s) as value from public.customer_sites s')).rows).toEqual(before)
    await expect(enter()).rejects.toMatchObject({ code: '23514' })
    expect(await entered()).toBeNull()
  })

  it('adds only missing family members when a matching existing field already has facts', async () => {
    await db.exec("alter table public.customer_sites add column current_supplier_notice_period text;update public.customer_sites set current_supplier_notice_period='1 month'")
    await db.exec(forwardSql())
    expect((await columns()).length).toBe(5)
    expect((await db.query<{ current_supplier_notice_period: string }>('select current_supplier_notice_period from public.customer_sites')).rows[0].current_supplier_notice_period).toBe('1 month')
  })

  it.each([
    'current_supplier_termination_fee text',
    'current_supplier_termination_fee numeric(12,2)',
    'current_supplier_response_status text not null default \'manual_review\'',
    'current_supplier_response_status text check (current_supplier_response_status is null)',
  ])('refuses incompatible existing shape atomically: %s', async definition => {
    await db.exec(`alter table public.customer_sites add column ${definition}`)
    const before = await columns()
    await db.exec('savepoint forward')
    await expect(db.exec(forwardSql())).rejects.toMatchObject({ code: '23514', message: 'manual_supplier_continuation_existing_shape_mismatch' })
    await db.exec('rollback to savepoint forward')
    expect(await columns()).toEqual(before)
    expect(await entered()).toBeNull()
  })
})

describe('active manual-supplier continuation payload schema', () => {
  it('reproduces undefined_column for the real seven-field update contract before the forward', async () => {
    expect(await supplierColumns()).toEqual([])
    const before = await switchRow()
    await expect(updateContinuation(supplierPayload)).rejects.toMatchObject({ code: '42703' })
    expect(await switchRow()).toEqual(before)
  })

  it('provides nullable supplier terms and a non-null false unknown default for existing requests', async () => {
    await db.exec(forwardSql())
    const row = await switchRow()
    expect(row.current_supplier_unknown).toBe(false)
    expect(['current_supplier_id', ...COLUMN_NAMES].every(name => row[name] === null)).toBe(true)
    expect(await supplierColumns()).toEqual([
      { name: 'current_supplier_contract_end_date', type: 'date', nullable: true, default_value: null },
      { name: 'current_supplier_contract_status', type: 'text', nullable: true, default_value: null },
      { name: 'current_supplier_id', type: 'uuid', nullable: true, default_value: null },
      { name: 'current_supplier_notice_period', type: 'text', nullable: true, default_value: null },
      { name: 'current_supplier_response_status', type: 'text', nullable: true, default_value: null },
      { name: 'current_supplier_termination_fee', type: 'numeric', nullable: true, default_value: null },
      { name: 'current_supplier_unknown', type: 'boolean', nullable: false, default_value: 'false' },
    ])
  })

  it('persists the actual continuation terms on only the scoped tenant/request and preserves them on replay', async () => {
    await db.exec(forwardSql())
    await db.query("insert into public.supplier_switch_requests(id,company_id,customer_id,status,requested_start_date,metadata) values ($1,$2,$3,'draft','2027-06-01','{\"control\":true}')", [OTHER_SWITCH, OTHER_CO, CUSTOMER])
    const otherBefore = await switchRow(OTHER_SWITCH)
    await updateContinuation(supplierPayload)
    const after = await switchRow()
    expect(after).toMatchObject(supplierPayload)
    expect(after.company_id).toBe(CO)
    expect(after.requested_start_date).toBe('2027-04-01')
    expect(await switchRow(OTHER_SWITCH)).toEqual(otherBefore)
    await updateContinuation(supplierPayload)
    await db.exec(forwardSql())
    expect(await switchRow()).toEqual(after)
    expect(await switchRow(OTHER_SWITCH)).toEqual(otherBefore)
  })

  it('round trips explicit unknown and null terms without inventing facts', async () => {
    await db.exec(forwardSql())
    await updateContinuation(supplierPayload)
    const unknownPayload = {
      current_supplier_id: null,
      current_supplier_unknown: true,
      ...Object.fromEntries(COLUMN_NAMES.map(name => [name, null])),
    }
    await updateContinuation(unknownPayload)
    const after = await switchRow()
    expect(after.current_supplier_unknown).toBe(true)
    expect(['current_supplier_id', ...COLUMN_NAMES].every(name => after[name] === null)).toBe(true)
    await db.exec(forwardSql())
    await updateContinuation(unknownPayload)
    expect(await switchRow()).toEqual(after)
  })
})
