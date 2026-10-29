// Structural integration: actual approval SQL -> actual fanout consumer -> actual approval SQL.
// In-process PGlite with minimal field-faithful tables and a finite Supabase query adapter.
// Source-retention and webhook delivery ports are explicit stubs. Not E2E, clean
// migration replay, real webhook delivery, Auth/RLS or independent-session proof.
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

type Row = Record<string, unknown>
type Reply = { data: unknown; error: unknown }
const ports = vi.hoisted(() => ({
  from: null as null | ((table: string) => unknown),
  enqueue: vi.fn(async (_event: unknown, _options: unknown) => 2),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    if (!ports.from) throw new Error('Structural query port not initialized')
    return ports.from(table)
  },
} }))
vi.mock('@/lib/integrations/webhooks', () => ({ enqueueWebhookDeliveriesForEvent: ports.enqueue }))
import { processDomainEventWebhookFanout } from '@/lib/events/domainEvents'

let db: PGlite
// Identifiers and operators come only from the actual consumer's finite calls.
const identifier = (value: string) => {
  if (!/^[a-z_]+$/.test(value)) throw new Error('Invalid structural query identifier')
  return value
}
class Query implements PromiseLike<Reply> {
  private filters: Array<{ key: string; op: '=' | '<' | '<=' | 'in'; value: unknown }> = []
  private patch: Row | null = null
  private one = false
  private columns = '*'
  private ordering = ''
  private rowLimit: number | null = null
  constructor(private table: string) {
    if (!['event_outbox', 'domain_events'].includes(table)) throw new Error(`Unexpected consumer table ${table}`)
  }
  select(columns: string) {
    this.columns = columns === '*' ? '*' : columns.split(',').map(identifier).join(',')
    return this
  }
  update(patch: Row) { this.patch = patch; return this }
  eq(key: string, value: unknown) { this.filters.push({ key: identifier(key), op: '=', value }); return this }
  lt(key: string, value: unknown) { this.filters.push({ key: identifier(key), op: '<', value }); return this }
  lte(key: string, value: unknown) { this.filters.push({ key: identifier(key), op: '<=', value }); return this }
  in(key: string, value: unknown[]) { this.filters.push({ key: identifier(key), op: 'in', value }); return this }
  order(key: string, options: { ascending: boolean }) {
    this.ordering = ` order by ${identifier(key)} ${options.ascending ? 'asc' : 'desc'}`; return this
  }
  limit(value: number) { this.rowLimit = value; return this }
  single() { this.one = true; return this }
  maybeSingle() { this.one = true; return this }
  private async execute(): Promise<Reply> {
    const values: unknown[] = []
    const parameter = (value: unknown) => { values.push(value); return `$${values.length}` }
    const set = this.patch ? Object.entries(this.patch).map(([key, value]) =>
      `${identifier(key)}=${parameter(value && typeof value === 'object' ? JSON.stringify(value) : value)}`).join(',') : ''
    const where = this.filters.map(({ key, op, value }) => op === 'in'
      ? `${key} in (${(value as unknown[]).map(parameter).join(',')})`
      : `${key}${op}${parameter(value)}`).join(' and ')
    const predicate = where ? ` where ${where}` : ''
    const sql = this.patch ? `update ${this.table} set ${set}${predicate} returning ${this.columns}`
      : `select ${this.columns} from ${this.table}${predicate}${this.ordering}${this.rowLimit === null ? '' : ` limit ${this.rowLimit}`}`
    try {
      const result = await db.query(sql, values)
      return { data: this.one ? result.rows[0] ?? null : result.rows, error: null }
    } catch (error) { return { data: null, error } }
  }
  then<TResult1 = Reply, TResult2 = never>(
    onfulfilled?: ((value: Reply) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> { return this.execute().then(onfulfilled, onrejected) }
}

beforeAll(async () => {
  db = new PGlite()
  ports.from = table => new Query(table)
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
      available_at timestamptz not null default now(), payload jsonb not null default '{}',
      locked_at timestamptz, locked_by text, sent_at timestamptz, failed_at timestamptz, last_error text,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create unique index event_outbox_named_destination on event_outbox(domain_event_id,destination_type,destination_key)
      where destination_key is not null;

    -- Source retention is an explicit structural-fixture stub, not qualification.
    create function public.ediel_require_invoice_source_copies_available_v1(uuid,uuid,uuid,uuid)
      returns void language sql as $$select$$;
  `)
  await db.exec(readFileSync(path.resolve(__dirname, '../supabase/migrations/20261028184500_invoice_review_atomic_approval.sql'), 'utf8'))
}, 30_000)
afterAll(async () => { ports.from = null; await db?.close() })

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}

it('retains consumer sent status and delivery count when an approved file-provider draft is approved again', async () => {
  const company = randomUUID(), item = randomUUID(), invoice = randomUUID(), underlay = randomUUID(), price = randomUUID()
  const customer = randomUUID(), contract = randomUUID(), actor = randomUUID()
  const review = { invoice_export_item_id: item, billing_underlay_id: underlay, pricing_run_id: price,
    calculation_snapshot_sha256: 'a'.repeat(64), total_kwh: 24, total_inc_vat: 42.18, price_area: 'SE3' }
  const hash = createHash('sha256').update(stableJson(review)).digest('hex')
  await db.query("insert into companies values($1,'active')", [company])
  await db.query(`insert into billing_underlays(id,company_id,customer_id,customer_contract_id,status,readiness_status,total_kwh,missing_values_count,price_area)
    values($1,$2,$3,$4,'validated','ready',24,0,'SE3')`, [underlay, company, customer, contract])
  await db.query(`insert into pricing_runs(id,company_id,billing_underlay_id,status,locked_at,total_ex_vat,vat_amount,total_inc_vat)
    values($1,$2,$3,'locked',now(),33.74,8.44,42.18)`, [price, company, underlay])
  await db.query(`insert into invoice_export_items(id,company_id,customer_id,customer_contract_id,billing_underlay_id,pricing_run_id,status,total_kwh,amount_ex_vat,vat_amount,amount_inc_vat)
    values($1,$2,$3,$4,$5,$6,'pending',24,33.74,8.44,42.18)`, [item, company, customer, contract, underlay, price])
  await db.query(`insert into customer_invoices(id,company_id,invoice_export_item_id,customer_id,customer_contract_id,billing_underlay_id,status,total_kwh,amount_inc_vat,price_area_code,calculation_snapshot_sha256)
    values($1,$2,$3,$4,$5,$6,'draft',24,42.18,'SE3',$7)`, [invoice, company, item, customer, contract, underlay, 'a'.repeat(64)])
  const invoke = (user: string) => db.transaction(async tx => {
    await tx.exec("set local role service_role; set local \"request.jwt.claim.role\"='service_role'")
    return (await tx.query<{ receipt: { newly_approved: boolean; event_id: string } }>(
      'select public.gridex_approve_invoice_review_v1($1,$2,$3,$4::jsonb,$5) receipt',
      [company, item, user, JSON.stringify(review), hash])).rows[0].receipt
  })
  const state = async () => (await db.query<{ state: Row }>(`select jsonb_build_object(
    'item',(select to_jsonb(t) from invoice_export_items t where id=$1),
    'invoice',(select to_jsonb(t) from customer_invoices t where id=$2),
    'events',(select jsonb_agg(to_jsonb(t)) from domain_events t),
    'outbox',(select jsonb_agg(to_jsonb(t)) from event_outbox t)) state`, [item, invoice])).rows[0].state
  const receipt = await invoke(actor)
  expect(receipt.newly_approved).toBe(true)
  expect(await processDomainEventWebhookFanout({ eventId: receipt.event_id, limit: 1 })).toEqual({ processed: 1, completed: 1, failed: 0 })
  expect(ports.enqueue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: receipt.event_id,
    company_id: company, event_type: 'invoice.approved', aggregate_id: item, actor_user_id: actor }), { strict: true })
  const afterFanout = await state()
  expect(afterFanout.events).toHaveLength(1)
  expect(afterFanout.outbox).toHaveLength(1)
  expect((afterFanout.outbox as Row[])[0]).toMatchObject({ company_id: company, domain_event_id: receipt.event_id,
    destination_type: 'webhook', destination_key: 'webhook_fanout_v1', status: 'sent', attempts: 1, payload: { delivery_count: 2 } })
  expect((afterFanout.item as Row).status).toBe('pending')
  expect((afterFanout.invoice as Row).status).toBe('draft')
  const itemApproval = ((afterFanout.item as Row).metadata as Row).approval
  expect(itemApproval).toEqual(((afterFanout.invoice as Row).metadata as Row).approval)
  expect(itemApproval).toMatchObject({ approved_by: actor, status: 'approved', review_hash: hash })
  expect((await invoke(randomUUID())).newly_approved).toBe(false)
  expect(await state()).toEqual(afterFanout)
  expect(await processDomainEventWebhookFanout({ eventId: receipt.event_id, limit: 1 })).toEqual({ processed: 0, completed: 0, failed: 0 })
  expect(ports.enqueue).toHaveBeenCalledTimes(1)
})
