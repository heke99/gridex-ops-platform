import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'

const callbackPorts = vi.hoisted(() => ({ from: vi.fn(), transport: vi.fn(), reference: vi.fn(), access: vi.fn(), owner: vi.fn(), scope: vi.fn(), purchase: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: callbackPorts.from } }))
vi.mock('@/lib/integrations/publicWebhookTransport', () => ({ postPublicWebhook: callbackPorts.transport }))
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: callbackPorts.access, requireAdminOperationalCompany: callbackPorts.owner }))
vi.mock('@/lib/tenant/scope', () => ({ assertUserCanOperateCompany: callbackPorts.scope }))
vi.mock('@/lib/integrations/billing/capway/purchase', () => ({ requestCapwayInvoicePurchase: callbackPorts.purchase }))
vi.mock('@/lib/integrations/tenantContext', () => ({ loadExternalTenantReference: callbackPorts.reference }))

const schema = readFileSync('supabase/schema.sql', 'utf8')
const path = 'supabase/migrations/20261101202125_synthetic_pricing_company_guard.sql'
const declaration = 'SYNTHETIC_PRICING_COMPANY_NO_PRODUCTION_BILLING_OR_FINANCIAL_OUTPUT'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = id(10), anotherActor = id(11), ordinary = id(12), existing = id(1)
let requestNumber = 100
const key = () => id(requestNumber++)
let db: PGlite
const hash = (name: string, slug: string) => createHash('sha256').update('gridex-synthetic-pricing-company-command-v1\n' + [name, slug, declaration].map(value => `${Buffer.byteLength(value)}:${value}`).join('')).digest('hex')
function actualFunction(name: string) {
  const at = schema.indexOf(`CREATE FUNCTION public.${name}(`)
  if (at < 0) throw new Error(`Missing actual main function ${name}`)
  const rest = schema.slice(at), tag = /AS (\$[A-Za-z0-9_]*\$)/.exec(rest)
  if (!tag) throw new Error('Missing function delimiter')
  const end = rest.indexOf(tag[1], tag.index + tag[0].length) + tag[1].length
  return rest.slice(0, end) + ';'
}
function actualTable(name: string) {
  const ddl = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  if (!ddl) throw new Error(`Missing actual main table ${name}`)
  return ddl
}
async function fixture(target: PGlite) {
  // Actual canonical company/function/table bodies; only Auth, normalizer,
  // cryptographic-extension and background-worker ports are finite components.
  // This is not a full-main/GoTrue/multiconnection/native replay qualification.
  await target.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema extensions;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz,is_anonymous boolean,deleted_at timestamptz,banned_until timestamptz);
    create table public.user_profiles(id uuid primary key,user_status text);
    create table public.admin_users(user_id uuid,is_active boolean,role text);
    create table public.roles(id uuid,key text,name text);
    create table public.user_roles(user_id uuid,company_id uuid,role_id uuid,role text,is_active boolean,status text);
    create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select sha256($1)$$;
    create function public.gridex_normalize_org_number(text) returns text language sql immutable as $$select $1$$;
    create function public.gridex_normalize_email(text) returns text language sql immutable as $$select $1$$;
    create function public.gridex_normalize_facility_id(text) returns text language sql immutable as $$select $1$$;
    create function public.gridex_normalize_metering_point_id(text) returns text language sql immutable as $$select $1$$;
    create function public.gridex_normalize_phone(text) returns text language sql immutable as $$select $1$$;
    create function public.gridex_normalize_personal_number(text) returns text language sql immutable as $$select $1$$;
    create function public.gridex_new_external_tenant_reference() returns text language sql as $$select 'tenant_'||replace(gen_random_uuid()::text,'-','')||substr(replace(gen_random_uuid()::text,'-',''),1,4)$$;
    create function public.gridex_new_public_resource_reference(text) returns text language sql as $$select $1||'_'||replace(gen_random_uuid()::text,'-','')$$;`)
  for (const name of ['companies', 'canonical_provisioning_requests', 'canonical_command_results', 'canonical_audit_events', 'canonical_domain_events', 'canonical_event_outbox', 'company_capabilities', 'company_onboarding_lifecycle', 'company_onboarding_tasks', 'company_provisioning_jobs', 'company_invitations', 'billing_underlays', 'customer_sites', 'metering_points', 'billing_provider_connections', 'invoice_export_runs', 'invoice_export_items', 'customer_invoices', 'billing_export_runs', 'billing_export_run_items', 'invoice_export_files', 'partner_exports', 'invoice_export_attempts', 'invoice_purchase_events', 'invoice_documents', 'customer_invoice_documents', 'customers', 'integration_api_clients', 'domain_events', 'webhook_subscriptions', 'webhook_deliveries', 'event_outbox']) {
    await target.exec(actualTable(name))
    await target.exec(`alter table public.${name} add primary key(${name === 'company_onboarding_lifecycle' ? 'company_id' : 'id'})`)
  }
  await target.exec(`alter table public.companies add unique(slug);
    alter table public.canonical_provisioning_requests add unique(idempotency_key);
    alter table public.company_capabilities add unique(company_id,capability_code);
    alter table public.company_onboarding_tasks add unique(company_id,task_key);
    insert into auth.users values('${actor}',now(),false,null,null),('${anotherActor}',now(),false,null,null),('${ordinary}',now(),false,null,null);
    insert into public.user_profiles values('${actor}','active'),('${anotherActor}','active'),('${ordinary}','active');
    insert into public.admin_users values('${actor}',true,'platform_admin'),('${anotherActor}',true,'platform_admin');
    insert into public.companies(id,name,slug) values('${existing}','Existing normal company','existing-normal');`)
  for (const name of ['gridex_normalize_platform_role', 'canonical_actor_is_platform_admin', 'canonical_json_sha256', 'canonical_command_request_hash_guard', 'canonical_seed_company_capabilities', 'gridex_seed_company_onboarding_tasks', 'canonical_provision_company_v1_unchecked', 'canonical_provision_company_v3_pre_invitation_intent', 'canonical_provision_company']) await target.exec(actualFunction(name))
  await target.exec('CREATE TRIGGER canonical_command_results_request_hash_guard BEFORE INSERT OR UPDATE OF request_payload, request_hash ON public.canonical_command_results FOR EACH ROW EXECUTE FUNCTION public.canonical_command_request_hash_guard()')
}
type Receipt = { company_id: string; birth_id: string; request_key: string; actor_user_id: string; initial_name: string; initial_slug: string; command_sha256: string; replayed: boolean; [key: string]: unknown }
async function create(request = key(), name = 'Synthetic Å 🧪 company', slug = 'synthetic-test', who = actor, decl = declaration) {
  return (await db.query<{ result: Receipt }>('select public.gridex_create_synthetic_pricing_company_v1($1,$2,$3,$4,$5) result', [who, request, name, slug, decl])).rows[0].result
}
async function read(request: string, who = actor) {
  return (await db.query<{ result: Receipt }>('select public.gridex_read_synthetic_pricing_company_v1($1,$2) result', [who, request])).rows[0].result
}
async function denied(action: () => Promise<unknown>, code = '42501') {
  await db.exec('savepoint refused')
  await expect(action()).rejects.toMatchObject({ code })
  await db.exec('rollback to savepoint refused')
}
beforeAll(async () => { db = new PGlite();await fixture(db);await db.exec(readFileSync(path, 'utf8')) }, 30_000)
beforeEach(async () => { await db.exec('begin') })
afterEach(async () => { await db.exec('rollback') })
afterAll(async () => { if (db) await db.close() })

it('uses real canonical provisioning and binds exact UTF8 command, onboarding effects and immutable restrictions', async () => {
  const request = key(), receipt = await create(request)
  expect(receipt).toMatchObject({ request_key: request, actor_user_id: actor, initial_name: 'Synthetic Å 🧪 company', initial_slug: 'synthetic-test', declaration, command_sha256: hash('Synthetic Å 🧪 company', 'synthetic-test'), production_billing_prohibited: true, external_financial_delivery_prohibited: true, consumer_enabled: false, replayed: false })
  expect((await db.query('select status,invoice_export_enabled,outbound_frozen_channels from public.companies where id=$1', [receipt.company_id])).rows).toEqual([{ status: 'onboarding', invoice_export_enabled: false, outbound_frozen_channels: ['invoice_export'] }])
  expect((await db.query<{ n: number }>('select count(*)::int n from public.company_provisioning_jobs where company_id=$1', [receipt.company_id])).rows[0].n).toBe(7)
  expect((await db.query<{ n: number }>('select count(*)::int n from public.canonical_event_outbox where company_id=$1', [receipt.company_id])).rows[0].n).toBe(1)
  expect((await db.query<{ n: number }>('select count(*)::int n from public.company_invitations')).rows[0].n).toBe(0)
})

async function insert(table: string, values: Record<string, unknown>) {
  const columns = Object.keys(values)
  return db.query(`insert into public.${table}(${columns.join(',')}) values(${columns.map((_, i) => `$${i + 1}`).join(',')}) returning *`, Object.values(values).map(value => typeof value === 'object' && value !== null ? JSON.stringify(value) : value))
}
async function drafts(company: string) {
  const run = id(200), item = id(201), invoice = id(202), legacy = id(203), legacyItem = id(204), customer = id(205), event = id(206)
  await insert('customers', { id: customer, company_id: company })
  await insert('invoice_export_runs', { id: run, company_id: company, billing_month: '2026-01' })
  await insert('billing_export_runs', { id: legacy, company_id: company, period_month: '2026-01' })
  await insert('billing_export_run_items', { id: legacyItem, company_id: company, billing_export_run_id: legacy, export_run_id: legacy })
  await insert('invoice_export_items', { id: item, company_id: company, export_run_id: run, billing_export_run_item_id: legacyItem })
  await insert('customer_invoices', { id: invoice, company_id: company, invoice_export_item_id: item, canonical_export_item_id: item, invoice_reference: `draft:${item}`, partner_invoice_reference: `pending:${item}` })
  await insert('domain_events', { id: event, company_id: company, subject_customer_id: customer, event_type: 'invoice.prepared', aggregate_type: 'invoice', aggregate_id: invoice })
  return { run, item, invoice, legacy, legacyItem, customer, event }
}
it('reconciles only own actual birth; exact replay and rename preserve immutable initial provenance', async () => {
  const request = key(), first = await create(request)
  expect(await read(request)).toEqual(first)
  expect(await create(request)).toEqual({ ...first, replayed: true })
  await denied(() => create(request, 'Changed name'), '23505')
  await denied(() => read(request, anotherActor), 'P0002')
  await denied(() => read(key()), 'P0002')
  await db.query('update public.companies set name=$2,slug=$3 where id=$1', [first.company_id, 'Renamed protected company', 'renamed-protected'])
  expect(await create(request)).toEqual({ ...first, replayed: true })
  expect((await db.query('select count(*)::int n from public.companies')).rows).toEqual([{ n: 2 }])
})
it('refuses a preexisting normal canonical request without enrolling that existing company', async () => {
  const request = key(), canonicalKey = `synthetic.pricing.company.v1:${actor}:${request}`
  await db.query('select public.canonical_provision_company($1::jsonb)', [JSON.stringify({ actor_user_id: actor, idempotency_key: canonicalKey, name: 'Normal canonical birth', slug: 'normal-canonical' })])
  await denied(() => create(request), '23505')
  expect((await db.query('select count(*)::int n from gridex_synthetic_pricing_companies.births')).rows).toEqual([{ n: 0 }])
})
it.each([
  `update auth.users set email_confirmed_at=null where id='${actor}'`,
  `update auth.users set is_anonymous=true where id='${actor}'`,
  `update auth.users set banned_until=now()+interval '1 day' where id='${actor}'`,
  `update auth.users set deleted_at=now() where id='${actor}'`,
  `update public.user_profiles set user_status='inactive' where id='${actor}'`,
  `update public.admin_users set is_active=false where user_id='${actor}'`,
])('rechecks current platform authority before create/read/replay: %s', async change => {
  const request = key();await create(request);await db.exec(change)
  await denied(() => create(request));await denied(() => read(request))
})
it('does not treat ordinary nonplatform actor as birth authority', async () => { await denied(() => create(key(), 'Test', 'test', ordinary)) })
it.each(['', ' padded', 'padded ', '\u00a0padded', 'padded\ufeff', 'bad\u0085name', 'bad\u0001name', 'x'.repeat(201)])('rejects invalid Unicode/name %j independently in SQL', async name => { await denied(() => create(key(), name), '22023') })
it.each(['', '-leading', 'trailing-', 'UPPER', 'å', 'a'.repeat(64)])('rejects noncanonical slug %s', async slug => { await denied(() => create(key(), 'Name', slug), '22023') })
it('preserves non-BMP Unicode scalar count and byte-framed command hash without normalization', async () => {
  const name = '🧪'.repeat(200), result = await create(key(), name, 'unicode')
  expect(result.command_sha256).toBe(hash(name, 'unicode'))
  await denied(() => create(key(), '🧪'.repeat(201), 'too-long'), '22023')
})
it('atomically rolls back actual canonical jobs/audit/company when protection insertion fails', async () => {
  const before = (await db.query('select count(*)::int n from public.companies')).rows
  await db.exec('alter table gridex_synthetic_pricing_companies.births add constraint fail_component_birth check(false)')
  await denied(() => create(), '23514')
  expect((await db.query('select count(*)::int n from public.companies')).rows).toEqual(before)
  expect((await db.query('select count(*)::int n from public.company_provisioning_jobs')).rows).toEqual([{ n: 0 }])
  expect((await db.query('select count(*)::int n from public.canonical_provisioning_requests')).rows).toEqual([{ n: 0 }])
})
it('behavior RED without guards then GREEN rejects removal of the real permanent channel', async () => {
  const birth = await create()
  await db.exec('savepoint without_guard')
  await db.exec('drop trigger zz_synthetic_pricing_company_guard on public.companies')
  await db.query("update public.companies set invoice_export_enabled=true,outbound_frozen_channels='{}',billing_provider_environment='production' where id=$1", [birth.company_id])
  expect((await db.query('select invoice_export_enabled,billing_provider_environment from public.companies where id=$1', [birth.company_id])).rows).toEqual([{ invoice_export_enabled: true, billing_provider_environment: 'production' }])
  await db.exec('rollback to savepoint without_guard')
  await denied(() => db.query("update public.companies set invoice_export_enabled=true,outbound_frozen_channels='{}',billing_provider_environment='production' where id=$1", [birth.company_id]))
  expect((await db.query('select invoice_export_enabled from public.companies where id=$1', [birth.company_id])).rows).toEqual([{ invoice_export_enabled: false }])
})
it.each([
  ['default_environment', "'production'"], ['operating_environment', "'production'"], ['billing_provider_environment', "'production'"], ['outbound_frozen_channels', "'{}'::text[]"], ['invoice_export_enabled', 'true'],
])('protects actual company field %s with direct DML', async (field, value) => {
  const birth = await create();await denied(() => db.query(`update public.companies set ${field}=${value} where id=$1`, [birth.company_id]))
  await db.query(`update public.companies set ${field}=${value} where id=$1`, [existing])
})
it('allows internal drafts while refusing production financial configuration and reassignment', async () => {
  const birth = await create();await drafts(birth.company_id)
  await insert('billing_provider_connections', { company_id: birth.company_id, provider: 'nordfin', environment: 'test' })
  await denied(() => insert('billing_provider_connections', { company_id: birth.company_id, provider: 'nordfin', environment: 'production' }))
  await denied(() => db.query('update public.billing_provider_connections set company_id=$1 where company_id=$2', [existing, birth.company_id]))
  expect((await db.query('select count(*)::int n from public.domain_events')).rows).toEqual([{ n: 1 }])
})
it.each([
  ['invoice_export_runs', 'status', "'processing'"], ['invoice_export_runs', 'environment', "'production'"], ['invoice_export_runs', 'sent_items', '1'],
  ['invoice_export_items', 'status', "'failed_retryable'"], ['invoice_export_items', 'provider_invoice_guid', "'external-guid'"], ['invoice_export_items', 'provider_invoice_id', "'external-id'"], ['invoice_export_items', 'attempt_count', '1'], ['invoice_export_items', 'next_retry_at', 'now()'], ['invoice_export_items', 'request_payload', "'{\"external\":true}'::jsonb"],
  ['customer_invoices', 'status', "'issued'"], ['customer_invoices', 'pdf_url', "'https://invalid.test/invoice.pdf'"], ['customer_invoices', 'partner_invoice_reference', "'external-reference'"],
  ['billing_export_runs', 'status', "'queued'"], ['billing_export_runs', 'rows_exported', '1'], ['billing_export_run_items', 'export_status', "'queued'"], ['billing_export_run_items', 'retry_count', '1'], ['billing_export_run_items', 'status', "'ready_for_retry'"],
])('blocks direct financial mutation %s.%s', async (table, column, value) => {
  const birth = await create();await drafts(birth.company_id)
  await denied(() => db.query(`update public.${table} set ${column}=${value} where company_id=$1`, [birth.company_id]))
})
it.each(['invoice_export_files', 'partner_exports', 'invoice_export_attempts', 'invoice_purchase_events', 'invoice_documents', 'customer_invoice_documents', 'webhook_subscriptions', 'webhook_deliveries'])('rejects protected output insertion on %s before other constraints', async table => {
  const birth = await create()
  await denied(() => insert(table, { company_id: birth.company_id }))
})
it('resolves protected parent aliases even under foreign or NULL row ownership', async () => {
  const birth = await create(), d = await drafts(birth.company_id)
  for (const [table, row] of [
    ['invoice_export_items', { company_id: existing, export_run_id: d.run }],
    ['billing_export_run_items', { company_id: existing, billing_export_run_id: d.legacy }],
    ['billing_export_run_items', { company_id: existing, billing_export_run_id: d.legacy, export_run_id: d.legacy }],
    ['customer_invoices', { company_id: existing, canonical_export_item_id: d.item, invoice_reference: 'fake' }],
    ['invoice_export_attempts', { company_id: existing, invoice_export_item_id: d.item }],
    ['invoice_documents', { company_id: existing, invoice_export_item_id: d.item }],
    ['customer_invoice_documents', { company_id: null, invoice_id: d.invoice }],
    ['domain_events', { company_id: existing, subject_customer_id: d.customer }],
    ['webhook_deliveries', { company_id: existing, domain_event_id: d.event }],
  ] as const) await denied(() => insert(table, row))
})
it('rejects OLD/NEW company and identity laundering for private events, customers, clients and graph rows', async () => {
  const birth = await create();await drafts(birth.company_id)
  await insert('integration_api_clients', { company_id: birth.company_id, name: 'Test client', key_prefix: 'test', secret_hash: 'component-not-authentication' })
  for (const table of ['invoice_export_runs', 'invoice_export_items', 'customer_invoices', 'billing_export_runs', 'billing_export_run_items', 'domain_events', 'customers', 'integration_api_clients']) {
    await denied(() => db.query(`update public.${table} set company_id=$1 where company_id=$2`, [existing, birth.company_id]))
  }
  const foreign = id(207);await insert('customers', { id: foreign, company_id: existing })
  await denied(() => db.query('update public.customers set company_id=$1 where id=$2', [birth.company_id, foreign]))
})
it('keeps ban immutable and service RPC ACLs narrow', async () => {
  await create()
  for (const operation of ['update gridex_synthetic_pricing_companies.births set initial_name=\'changed\'', 'delete from gridex_synthetic_pricing_companies.births', 'truncate gridex_synthetic_pricing_companies.births']) await denied(() => db.exec(operation), '55000')
  for (const role of ['anon', 'authenticated', 'service_role']) {
    expect((await db.query<{ allowed: boolean }>("select has_function_privilege($1,'public.gridex_create_synthetic_pricing_company_v1(uuid,uuid,text,text,text)','EXECUTE') allowed", [role])).rows[0].allowed).toBe(role === 'service_role')
    expect((await db.query<{ allowed: boolean }>("select has_schema_privilege($1,'gridex_synthetic_pricing_companies','USAGE') allowed", [role])).rows[0].allowed).toBe(false)
  }
})

// Finite Supabase wire port: build real SQL against PGlite; no modelled ownership,
// authorization or fanout decisions. Actual application callbacks run unchanged.
class ComponentQuery {
  private mode = 'select'
  private data: Record<string, unknown> = {}
  private filters: { column: string; op: string; value: unknown }[] = []
  private columns = '*'
  private one = false
  private cap = 1000
  constructor(private table: string) {}
  select(columns = '*') { this.columns = columns; return this }
  insert(value: Record<string, unknown>) { this.mode = 'insert'; this.data = value; return this }
  update(value: Record<string, unknown>) { this.mode = 'update'; this.data = value; return this }
  eq(column: string, value: unknown) { this.filters.push({ column, op: '=', value }); return this }
  lt(column: string, value: unknown) { this.filters.push({ column, op: '<', value }); return this }
  lte(column: string, value: unknown) { this.filters.push({ column, op: '<=', value }); return this }
  in(column: string, value: unknown[]) { this.filters.push({ column, op: 'in', value }); return this }
  order() { return this }
  limit(value: number) { this.cap = value; return this }
  maybeSingle() { this.one = true; return this }
  single() { this.one = true; return this }
  private identifier(value: string) { if (!/^[a-z_]+$/.test(value)) throw new Error('Unconfined component identifier'); return value }
  private async execute() {
    const args: unknown[] = []
    const bind = (value: unknown) => { args.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value); return `$${args.length}` }
    const fields = this.columns === '*' ? '*' : this.columns.split(',').map(x => this.identifier(x)).join(',')
    const table = this.identifier(this.table)
    const entries = Object.entries(this.data)
    let sql: string
    if (this.mode === 'insert') sql = `insert into public.${table}(${entries.map(([k]) => this.identifier(k)).join(',')}) values(${entries.map(([, v]) => bind(v)).join(',')})`
    else if (this.mode === 'update') sql = `update public.${table} set ${entries.map(([k, v]) => `${this.identifier(k)}=${bind(v)}`).join(',')}`
    else sql = `select ${fields} from public.${table}`
    if (this.filters.length) sql += ' where ' + this.filters.map(f => f.op === 'in' ? `${this.identifier(f.column)} in (${(f.value as unknown[]).map(bind).join(',')})` : `${this.identifier(f.column)}${f.op}${bind(f.value)}`).join(' and ')
    sql += this.mode === 'select' ? ` limit ${this.cap}` : ` returning ${fields}`
    try {
      const result = await db.query(sql, args)
      const rows = JSON.parse(JSON.stringify(result.rows)) as typeof result.rows // PostgREST JSON wire timestamps
      return { data: this.one ? rows[0] ?? null : rows, error: null }
    } catch (error) { return { data: null, error } }
  }
  then<TResult1 = unknown, TResult2 = never>(fulfilled?: ((value: Awaited<ReturnType<ComponentQuery['execute']>>) => TResult1 | PromiseLike<TResult1>) | null, rejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) {
    return this.execute().then(fulfilled, rejected)
  }
}
it('actual event emitter and actual webhook workers retain a private invoice event with zero fanout or transport', async () => {
  const birth = await create()
  callbackPorts.from.mockImplementation((table: string) => new ComponentQuery(table))
  callbackPorts.reference.mockImplementation(async (company: string) => (await db.query<{ external_tenant_reference: string }>('select external_tenant_reference from public.companies where id=$1', [company])).rows[0].external_tenant_reference)
  callbackPorts.transport.mockImplementation(() => { throw new Error('Unexpected external financial transport') })
  const { emitDomainEvent } = await import('@/lib/events/domainEvents')
  const { dispatchDueWebhookDeliveries } = await import('@/lib/integrations/webhooks')
  const event = await emitDomainEvent({ companyId: birth.company_id, eventType: 'invoice.prepared', aggregateType: 'invoice', aggregateId: id(330), payload: { internal_test: true } })
  expect(event?.company_id).toBe(birth.company_id)
  expect((await db.query('select count(*)::int n from public.domain_events where company_id=$1', [birth.company_id])).rows).toEqual([{ n: 1 }])
  expect((await db.query('select count(*)::int n from public.webhook_deliveries')).rows).toEqual([{ n: 0 }])
  expect((await db.query("select status,payload->>'delivery_count' count from public.event_outbox")).rows).toEqual([{ status: 'sent', count: '0' }])
  expect(await dispatchDueWebhookDeliveries()).toMatchObject({ processed: 0, sent: 0, failed: 0 })
  expect(callbackPorts.transport).not.toHaveBeenCalled()
})
it('behavior RED without webhook guard permits queued output; restored guard blocks it before any worker transport', async () => {
  const birth = await create(), d = await drafts(birth.company_id)
  await db.exec('savepoint legacy_webhook')
  await db.exec('drop trigger zz_synthetic_pricing_company_guard on public.webhook_subscriptions;drop trigger zz_synthetic_pricing_company_guard on public.webhook_deliveries')
  const subscription = id(340)
  await insert('webhook_subscriptions', { id: subscription, company_id: birth.company_id, name: 'Legacy test subscription', endpoint_url: 'https://invalid.test/component-only' })
  await insert('webhook_deliveries', { company_id: birth.company_id, webhook_subscription_id: subscription, domain_event_id: d.event, event_type: 'invoice.prepared', idempotency_key: 'component-red' })
  expect((await db.query('select count(*)::int n from public.webhook_deliveries')).rows).toEqual([{ n: 1 }])
  await db.exec('rollback to savepoint legacy_webhook')
  await denied(() => insert('webhook_subscriptions', { id: subscription, company_id: birth.company_id, name: 'No output', endpoint_url: 'https://invalid.test/never-used' }))
  expect((await db.query('select count(*)::int n from public.webhook_deliveries')).rows).toEqual([{ n: 0 }])
})
it('protects actual subscription and domain-event parents and prevents customer laundering', async () => {
  const birth = await create(), d = await drafts(birth.company_id)
  const subscription = id(350)
  await insert('webhook_subscriptions', { id: subscription, company_id: existing, name: 'Normal subscription', endpoint_url: 'https://invalid.test/not-called' })
  await denied(() => insert('webhook_deliveries', { company_id: existing, webhook_subscription_id: subscription, domain_event_id: d.event, event_type: 'invoice.prepared', idempotency_key: 'foreign-event' }))
  await denied(() => db.query('update public.webhook_subscriptions set company_id=$1 where id=$2', [birth.company_id, subscription]))
  await denied(() => db.query('update public.domain_events set company_id=$1 where id=$2', [existing, d.event]))
})

it('blocks nullable-company partner output through actual protected customer ownership', async () => {
  const birth = await create(), d = await drafts(birth.company_id)
  await denied(() => insert('partner_exports', { company_id: null, customer_id: d.customer, target_system: 'component-not-contacted' }))
})
it('verifies persisted canonical provenance before exact replay or reconciliation', async () => {
  const request = key(), birth = await create(request)
  await db.query("update public.canonical_provisioning_requests set result_payload=result_payload||'{\"forged\":true}'::jsonb where company_id=$1", [birth.company_id])
  await denied(() => read(request), '23505')
  await denied(() => create(request), '23505')
})
it('scopes request keys to actual platform actors and refuses implicit or changed declarations', async () => {
  const request = key(), a = await create(request), b = await create(request, 'Other birth', 'other-birth', anotherActor)
  expect(b.company_id).not.toBe(a.company_id)
  expect((await read(request, anotherActor)).actor_user_id).toBe(anotherActor)
  await denied(() => create(key(), 'Bad', 'bad-declaration', actor, ''), '22023')
})
it('prevents protection removal by company identity mutation, deletion and complete-table cascade', async () => {
  const birth = await create()
  await denied(() => db.query('update public.companies set id=$1 where id=$2', [id(777), birth.company_id]))
  await denied(() => db.query('delete from public.companies where id=$1', [birth.company_id]), '23503')
  await denied(() => db.exec('truncate public.companies cascade'), '55000')
})
it('rejects a subscription-owned protected alias even when its domain event and company are foreign', async () => {
  const birth = await create(), sub = id(366), event = id(367)
  await db.exec('savepoint compromised_component_subscription')
  await db.exec('drop trigger zz_synthetic_pricing_company_guard on public.webhook_subscriptions')
  await insert('webhook_subscriptions', { id: sub, company_id: birth.company_id, name: 'Component inherited row', endpoint_url: 'https://invalid.test/never-contacted' })
  await db.exec('CREATE TRIGGER zz_synthetic_pricing_company_guard BEFORE INSERT OR UPDATE ON public.webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION gridex_synthetic_pricing_companies.guard_v1()')
  await insert('domain_events', { id: event, company_id: existing, event_type: 'invoice.prepared', aggregate_type: 'invoice', aggregate_id: id(368) })
  await denied(() => insert('webhook_deliveries', { company_id: existing, webhook_subscription_id: sub, domain_event_id: event, event_type: 'invoice.prepared', idempotency_key: 'subscription-alias' }))
  await db.exec('rollback to savepoint compromised_component_subscription')
})
it('migration itself rolls back namespace and public RPCs when the next statement fails before ACL completion', async () => {
  const target = new PGlite()
  try {
    await fixture(target)
    const migration = readFileSync(path, 'utf8'), prefix = migration.slice(0, migration.indexOf('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA'))
    await target.exec(prefix)
    await expect(target.exec('select 1/0')).rejects.toMatchObject({ code: '22012' })
    await target.exec('rollback')
    expect((await target.query("select to_regnamespace('gridex_synthetic_pricing_companies') is null absent")).rows).toEqual([{ absent: true }])
    expect((await target.query("select to_regprocedure('public.gridex_create_synthetic_pricing_company_v1(uuid,uuid,text,text,text)') is null absent")).rows).toEqual([{ absent: true }])
    expect((await target.query("select to_regprocedure('public.gridex_read_synthetic_pricing_company_v1(uuid,uuid)') is null absent")).rows).toEqual([{ absent: true }])
  } finally { await target.close() }
}, 30_000)

it('guards all four actual partner parents and nullable intermediate aliases without changing internal pricing fields', async () => {
  const birth = await create(), customer = id(410), site = id(411), point = id(412), underlay = id(413)
  await insert('customers', { id: customer, company_id: birth.company_id })
  await insert('customer_sites', { id: site, customer_site_id: site, company_id: birth.company_id, customer_id: customer })
  await insert('metering_points', { id: point, company_id: birth.company_id, customer_id: customer, site_id: site, customer_site_id: site })
  await insert('billing_underlays', { id: underlay, company_id: birth.company_id, customer_id: customer, site_id: site, customer_site_id: site, metering_point_id: point })
  for (const [column, parent] of [['customer_id', customer], ['site_id', site], ['metering_point_id', point], ['billing_underlay_id', underlay]]) {
    for (const owner of [null, existing]) await denied(() => insert('partner_exports', { company_id: owner, [column]: parent, target_system: 'component-no-transport' }))
  }
  for (const table of ['billing_underlays', 'customer_sites', 'metering_points']) {
    await denied(() => db.query(`update public.${table} set company_id=$1 where company_id=$2`, [existing, birth.company_id]))
    await denied(() => db.query(`update public.${table} set company_id=null where company_id=$1`, [birth.company_id]))
  }
  for (const owner of [null, existing]) {
    await denied(() => insert('customer_sites', { company_id: owner, customer_id: customer }))
    await denied(() => insert('customer_sites', { company_id: owner, customer_site_id: site }))
    await denied(() => insert('metering_points', { company_id: owner, customer_id: customer }))
    await denied(() => insert('metering_points', { company_id: owner, site_id: site }))
    await denied(() => insert('metering_points', { company_id: owner, customer_site_id: site }))
    await denied(() => insert('billing_underlays', { company_id: owner, customer_id: customer }))
  }
  // The guard constrains identity/output, not ordinary private amount editing.
  await db.query('update public.billing_underlays set total_kwh=123 where id=$1', [underlay])
  expect((await db.query('select total_kwh::text amount from public.billing_underlays where id=$1', [underlay])).rows).toEqual([{ amount: '123' }])
})

it('actual purchase route cannot contact its provider because SQL permanently refuses the required GUID', async () => {
  const birth = await create(), d = await drafts(birth.company_id)
  callbackPorts.from.mockImplementation((table: string) => new ComponentQuery(table))
  callbackPorts.access.mockResolvedValue({ guard: { userId: ordinary }, response: null })
  callbackPorts.owner.mockResolvedValue(birth.company_id)
  callbackPorts.scope.mockResolvedValue(birth.company_id)
  callbackPorts.purchase.mockImplementation(() => { throw new Error('Unexpected provider purchase') })
  const { POST } = await import('@/app/api/internal/invoices/[id]/purchase/route')
  const response = await POST(new Request('http://component.invalid/api/internal/invoices/'+d.item+'/purchase', { method: 'POST', body: '{}' }), { params: Promise.resolve({ id: d.item }) })
  expect(response.status).toBe(400)
  expect(callbackPorts.purchase).not.toHaveBeenCalled()
  await denied(() => db.query("update public.invoice_export_items set provider_invoice_guid='pretend-provider-guid' where id=$1", [d.item]))
  expect((await db.query('select provider_invoice_guid from public.invoice_export_items where id=$1', [d.item])).rows).toEqual([{ provider_invoice_guid: null }])
})

it('preserves actual canonical birth actor/time provenance while allowing company renaming', async () => {
  const birth = await create()
  await denied(() => db.query('update public.companies set created_by=$1 where id=$2', [anotherActor, birth.company_id]))
  await denied(() => db.query("update public.companies set created_at=created_at-interval '1 day' where id=$1", [birth.company_id]))
  await db.query("update public.companies set name='Renamed company' where id=$1", [birth.company_id])
  expect((await read(birth.request_key)).initial_name).toBe('Synthetic Å 🧪 company')
})
