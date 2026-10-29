// BILLNEG01.02 / MAIN04.05 component regression: actual approval migration in PGlite.
// Seven minimal field-faithful domain tables and explicitly structural draft fixtures.
// The source-retention hook is an explicit stub. This is not E2E, clean migration
// replay, Auth/RLS qualification or proof of two independent PostgreSQL sessions.
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(path.resolve(__dirname, '../supabase/migrations/20261028184500_invoice_review_atomic_approval.sql'), 'utf8')
const signature = 'public.gridex_approve_invoice_review_v1(uuid,uuid,uuid,jsonb,text)'
type Row = Record<string, unknown>
type Fixture = {
  company: string; item: string; invoice: string; underlay: string; price: string
  customer: string; contract: string; actor: string; review: Row; hash: string
}
type Receipt = { newly_approved: boolean; invoice_export_item_id: string; invoice_id: string; event_id: string }
type State = { item: Row; invoice: Row; events: Row[]; outbox: Row[] }
let db: PGlite

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.role() returns text language sql stable as $$
      select current_setting('request.jwt.claim.role',true)
    $$;
    grant usage on schema auth to service_role;
    grant execute on function auth.role() to service_role;
    create table companies(id uuid primary key, status text not null);
    create table billing_underlays(id uuid primary key, company_id uuid not null, customer_id uuid,
      customer_contract_id uuid, contract_id uuid, status text not null, readiness_status text,
      total_kwh numeric, missing_values_count integer, price_area text);
    create table pricing_runs(id uuid primary key, company_id uuid not null, billing_underlay_id uuid,
      status text not null, locked_at timestamptz, total_ex_vat numeric not null,
      vat_amount numeric not null, total_inc_vat numeric not null);
    create table invoice_export_items(id uuid primary key, company_id uuid not null, customer_id uuid,
      customer_contract_id uuid, billing_underlay_id uuid, pricing_run_id uuid, status text not null,
      total_kwh numeric, amount_ex_vat numeric not null, vat_amount numeric not null, amount_inc_vat numeric not null,
      metadata jsonb not null default '{}', updated_at timestamptz not null default now());
    create table customer_invoices(id uuid primary key, company_id uuid not null, invoice_export_item_id uuid,
      customer_id uuid, customer_contract_id uuid, billing_underlay_id uuid, status text not null, total_kwh numeric,
      consumption_kwh numeric, amount_inc_vat numeric, price_area_code text, calculation_snapshot_sha256 text,
      calculation_snapshot jsonb not null default '{}', metadata jsonb not null default '{}',
      updated_at timestamptz not null default now(), unique(company_id,invoice_export_item_id));
    create table domain_events(id uuid primary key default gen_random_uuid(), company_id uuid,
      event_type text not null, aggregate_type text not null, aggregate_id text not null,
      subject_customer_id uuid, actor_user_id uuid, source text not null default 'application',
      idempotency_key text, payload jsonb not null default '{}', created_at timestamptz not null default now());
    create unique index domain_events_key on domain_events(idempotency_key) where idempotency_key is not null;
    create table event_outbox(id uuid primary key default gen_random_uuid(), company_id uuid, domain_event_id uuid not null,
      destination_type text not null, destination_key text, status text not null default 'queued',
      attempts integer not null default 0, max_attempts integer not null default 8,
      available_at timestamptz not null default now(), payload jsonb not null default '{}');
    create unique index event_outbox_named_destination on event_outbox(domain_event_id,destination_type,destination_key)
      where destination_key is not null;

    -- Structural-fixture control only; these hooks are NOT project source qualification.
    create table finance_test_control(mode text not null);
    insert into finance_test_control values('normal');
    create function public.ediel_require_invoice_source_copies_available_v1(uuid,uuid,uuid,uuid)
      returns void language plpgsql as $$begin
      if exists(select 1 from finance_test_control where mode='source_retired') then
        raise exception using errcode='23514',message='structural_fixture_source_retired';
      end if;
    end$$;
    create function finance_test_failure() returns trigger language plpgsql as $$begin
      if exists(select 1 from finance_test_control where mode=TG_TABLE_NAME) then
        raise exception using errcode='23514',message='structural_fixture_write_failure';
      end if;
      return NEW;
    end$$;
    create trigger fixture_invoice_failure before update on customer_invoices for each row execute function finance_test_failure();
    create trigger fixture_event_failure before insert on domain_events for each row execute function finance_test_failure();
    create trigger fixture_outbox_failure before insert on event_outbox for each row execute function finance_test_failure();
  `)
  expect((await db.query<{ value: string | null }>('select to_regprocedure($1)::text value', [signature])).rows[0].value).toBeNull()
  await db.exec(migration)
}, 30_000)

beforeEach(async () => { await db.exec("update finance_test_control set mode='normal'") })
afterAll(async () => { await db?.close() })

async function fixture(): Promise<Fixture> {
  const f = { company: randomUUID(), item: randomUUID(), invoice: randomUUID(), underlay: randomUUID(), price: randomUUID(),
    customer: randomUUID(), contract: randomUUID(), actor: randomUUID() }
  const review = { invoice_export_item_id: f.item, billing_underlay_id: f.underlay, pricing_run_id: f.price,
    calculation_snapshot_sha256: 'a'.repeat(64), total_kwh: 24, total_inc_vat: 42.18, price_area: 'SE3' }
  const hash = createHash('sha256').update(stableJson(review)).digest('hex')
  await db.query("insert into companies(id,status) values($1,'active')", [f.company])
  await db.query(`insert into billing_underlays(id,company_id,customer_id,customer_contract_id,status,readiness_status,total_kwh,missing_values_count,price_area)
    values($1,$2,$3,$4,'validated','ready',24,0,'SE3')`, [f.underlay, f.company, f.customer, f.contract])
  await db.query(`insert into pricing_runs(id,company_id,billing_underlay_id,status,locked_at,total_ex_vat,vat_amount,total_inc_vat)
    values($1,$2,$3,'locked',now(),33.74,8.44,42.18)`, [f.price, f.company, f.underlay])
  await db.query(`insert into invoice_export_items(id,company_id,customer_id,customer_contract_id,billing_underlay_id,pricing_run_id,status,total_kwh,
    amount_ex_vat,vat_amount,amount_inc_vat,metadata) values($1,$2,$3,$4,$5,$6,'pending',24,33.74,8.44,42.18,'{"approval":{"status":"pending_review"}}')`,
  [f.item, f.company, f.customer, f.contract, f.underlay, f.price])
  await db.query(`insert into customer_invoices(id,company_id,invoice_export_item_id,customer_id,customer_contract_id,billing_underlay_id,status,
    total_kwh,amount_inc_vat,price_area_code,calculation_snapshot_sha256,calculation_snapshot,metadata)
    values($1,$2,$3,$4,$5,$6,'draft',24,42.18,'SE3',$7,'{"structural_fixture":true,"frozen":true}', '{"approval":{"status":"pending_review"}}')`,
  [f.invoice, f.company, f.item, f.customer, f.contract, f.underlay, 'a'.repeat(64)])
  return { ...f, review, hash }
}

async function invoke(f: Fixture, options: { actor?: string; role?: 'service_role' | 'anon' | 'authenticated'; review?: Row; hash?: string } = {}) {
  const role = options.role ?? 'service_role'
  return db.transaction(async tx => {
    // Values come from a closed role union, not interpolated external input.
    await tx.exec(`set local role ${role}; set local "request.jwt.claim.role"='${role}'`)
    const result = await tx.query<{ receipt: Receipt }>(`select public.gridex_approve_invoice_review_v1($1,$2,$3,$4::jsonb,$5) receipt`,
      [f.company, f.item, options.actor ?? f.actor, JSON.stringify(options.review ?? f.review), options.hash ?? f.hash])
    return result.rows[0].receipt
  })
}

async function state(f: Fixture): Promise<State> {
  return (await db.query<{ value: State }>(`select jsonb_build_object(
    'item',(select to_jsonb(t) from invoice_export_items t where id=$1),
    'invoice',(select to_jsonb(t) from customer_invoices t where id=$2),
    'events',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from domain_events t where company_id=$3),
    'outbox',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb) from event_outbox t where company_id=$3)) value`,
  [f.item, f.invoice, f.company])).rows[0].value
}
const approval = (row: Row) => (row.metadata as { approval: Row }).approval

it('atomically approves both mirrors with one actual event/outbox while financial snapshot and statuses stay frozen', async () => {
  const f = await fixture(), before = await state(f)
  const receipt = await invoke(f), after = await state(f)
  expect(receipt).toMatchObject({ newly_approved: true, invoice_export_item_id: f.item, invoice_id: f.invoice })
  expect(approval(after.item)).toEqual(approval(after.invoice))
  expect(approval(after.item)).toMatchObject({ status: 'approved', approved_by: f.actor, review_hash: f.hash })
  expect(after.item.status).toBe(before.item.status)
  expect(after.invoice.status).toBe(before.invoice.status)
  expect(after.invoice.calculation_snapshot).toEqual(before.invoice.calculation_snapshot)
  expect(after.invoice.calculation_snapshot_sha256).toBe(before.invoice.calculation_snapshot_sha256)
  expect(after.events).toHaveLength(1)
  expect(after.outbox).toHaveLength(1)
  expect(after.events[0]).toMatchObject({ id: receipt.event_id, company_id: f.company, actor_user_id: f.actor,
    subject_customer_id: f.customer, event_type: 'invoice.approved', aggregate_id: f.item })
  expect(after.outbox[0]).toMatchObject({ domain_event_id: receipt.event_id, company_id: f.company,
    destination_type: 'webhook', destination_key: 'webhook_fanout_v1', status: 'queued', attempts: 0, max_attempts: 12,
    payload: { event_type: 'invoice.approved', aggregate_type: 'invoice_export_item', aggregate_id: f.item } })
})

it('a repeat by a new actor reports no new approval and preserves every stored actor/time/audit row', async () => {
  const f = await fixture()
  await invoke(f)
  const before = await state(f)
  const receipt = await invoke(f, { actor: randomUUID() })
  expect(receipt.newly_approved).toBe(false)
  expect(await state(f)).toEqual(before)
})

it.each(['customer_invoices', 'domain_events', 'event_outbox'] as const)('%s trigger failure rolls back both mirrors/audit and the ordinary RPC can retry', async table => {
  const f = await fixture(), before = await state(f)
  await db.query('update finance_test_control set mode=$1', [table])
  await expect(invoke(f)).rejects.toMatchObject({ code: '23514', message: 'structural_fixture_write_failure' })
  expect(await state(f)).toEqual(before)
  await db.exec("update finance_test_control set mode='normal'")
  expect((await invoke(f)).newly_approved).toBe(true)
  const after = await state(f)
  expect(approval(after.item)).toEqual(approval(after.invoice))
  expect(after.events).toHaveLength(1)
  expect(after.outbox).toHaveLength(1)
})

it('stale reviewed financial basis fails closed before approval or audit', async () => {
  const f = await fixture(), before = await state(f)
  await expect(invoke(f, { review: { ...f.review, total_inc_vat: 100 } })).rejects.toMatchObject({ code: '40001', message: 'invoice_review_approval_review_changed' })
  expect(await state(f)).toEqual(before)
})

it.each(['invoice_export_items', 'customer_invoices'] as const)('JSON-array metadata on %s cannot be falsely approved', async table => {
  const f = await fixture()
  const id = table === 'invoice_export_items' ? f.item : f.invoice
  // Deliberately malformed structural fixture, not a normal economic transition.
  await db.query(`update ${table} set metadata='[]'::jsonb where id=$1`, [id])
  const before = await state(f)
  await expect(invoke(f)).rejects.toMatchObject({ code: '55000', message: 'invoice_review_approval_metadata_invalid' })
  expect(await state(f)).toEqual(before)
})

it('retired-source stub remains mandatory and rejection rolls back every approval effect', async () => {
  const f = await fixture(), before = await state(f)
  await db.exec("update finance_test_control set mode='source_retired'")
  await expect(invoke(f)).rejects.toMatchObject({ code: '23514', message: 'structural_fixture_source_retired' })
  expect(await state(f)).toEqual(before)
})

it('an incompatible retained event is rejected without replacing the original approval', async () => {
  const f = await fixture()
  await invoke(f)
  await db.query('update domain_events set actor_user_id=$1 where company_id=$2', [randomUUID(), f.company])
  const before = await state(f)
  await expect(invoke(f)).rejects.toMatchObject({ code: '55000', message: 'invoice_review_approval_event_mismatch' })
  expect(await state(f)).toEqual(before)
})

it('a retained outbox attributed to another company is rejected without replacing the original approval', async () => {
  const f = await fixture()
  await invoke(f)
  // The consumer legitimately replaces payload; the tenant binding stays fixed.
  await db.query('update event_outbox set company_id=$1 where company_id=$2', [randomUUID(), f.company])
  const before = await state(f)
  await expect(invoke(f)).rejects.toMatchObject({ code: '55000', message: 'invoice_review_approval_outbox_mismatch' })
  expect(await state(f)).toEqual(before)
})

it('historical partial approval is refused rather than silently completing or overwriting its actor', async () => {
  const f = await fixture()
  await invoke(f)
  await db.query(`update customer_invoices set metadata='{"approval":{"status":"pending_review"}}'::jsonb where id=$1`, [f.invoice])
  const before = await state(f)
  await expect(invoke(f)).rejects.toMatchObject({ code: '55000', message: 'invoice_review_approval_mirror_mismatch' })
  expect(await state(f)).toEqual(before)
})

it.each(['anon', 'authenticated'] as const)('%s has no execute grant and cannot mutate either mirror', async role => {
  const f = await fixture(), before = await state(f)
  const privilege = (await db.query<{ allowed: boolean }>('select has_function_privilege($1,$2,\'execute\') allowed', [role, signature])).rows[0].allowed
  expect(privilege).toBe(false)
  await expect(invoke(f, { role })).rejects.toMatchObject({ code: '42501' })
  expect(await state(f)).toEqual(before)
})
