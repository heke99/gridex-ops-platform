import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

type Scope = { scope: string; table: string; predicate: string; delete_order: number }
const folder = 'quality/admin-consistency-2026-10-13/cleanup/'
const policy = JSON.parse(readFileSync(folder + 'reset-approved-scopes.json', 'utf8'))
const scopes = policy.scopes as Scope[]
const empty = ['customers', 'customer_sites', 'metering_points', 'external_contract_intakes', 'customer_application_intakes', 'forecast_run_items', 'forecast_adjustments', 'webhook_deliveries']
const preserved = ['companies', 'audit_logs', 'integration_api_clients', 'ediel_messages']
const app = '11111111-1111-4111-8111-111111111111'
const quoteId = '22222222-2222-4222-8222-222222222222'
const domain = '33333333-3333-4333-8333-333333333333'
const canonical = '44444444-4444-4444-8444-444444444444'
const manualCase = '55555555-5555-4555-8555-555555555555'
const inboundEvent = '66666666-6666-4666-8666-666666666666'
const unknownEnergyEvent = '77777777-7777-4777-8777-777777777777'
let db: PGlite

function quoted(value: string) { return "'" + value.replaceAll("'", "''") + "'" }

async function renderedReset() {
  const values = []
  for (const scope of scopes) {
    const row = (await db.query<{ n: number; h: string }>(`select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) h from public.${scope.table} t where ${scope.predicate}`)).rows[0]
    values.push(`(${quoted(scope.scope)},${quoted(scope.table)},${quoted(scope.predicate)},${row.n},${quoted(row.h)},${scope.delete_order})`)
  }
  return readFileSync(folder + 'reset-customer-flow.template.sql', 'utf8')
    .replace('__SCOPED_BASELINE__', values.join(','))
    .replace('__EMPTY_TABLES__', empty.map(table => `(${quoted(table)})`).join(','))
    .replace('__PRESERVED_TABLES__', preserved.map(table => `(${quoted(table)})`).join(','))
}

async function count(table: string) {
  return (await db.query<{ n: number }>(`select count(*)::int n from public.${table}`)).rows[0].n
}

async function renderedFocused(group: string) {
  let sql = readFileSync(folder + `reset-focused-${group}.sql`, 'utf8')
  const baseline = JSON.parse(readFileSync(folder + 'reset-approved-baseline.json', 'utf8')) as Array<{
    scope_name: string; exact_count: number; row_fingerprint: string
  }>
  for (const scope of scopes) {
    const row = (await db.query<{ n: number; h: string }>(`select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) h from public.${scope.table} t where ${scope.predicate}`)).rows[0]
    const reviewed = baseline.find(item => item.scope_name === scope.scope)
    if (!reviewed) throw new Error('Missing focused fixture baseline: ' + scope.scope)
    const prefix = '(' + [scope.scope, scope.table, scope.predicate].map(quoted).join(',') + ','
    sql = sql.replaceAll(prefix + reviewed.exact_count + ',' + quoted(reviewed.row_fingerprint) + ',' + scope.delete_order + ')',
      prefix + row.n + ',' + quoted(row.h) + ',' + scope.delete_order + ')')
  }
  return sql
}

async function renderedStatic(filename: string, scopeNames: string[]) {
  let sql = readFileSync(folder + filename, 'utf8')
  const baseline = JSON.parse(readFileSync(folder + 'reset-approved-baseline.json', 'utf8')) as Array<{
    scope_name: string; exact_count: number; row_fingerprint: string
  }>
  for (const name of scopeNames) {
    const scope = scopes.find(item => item.scope === name)
    const reviewed = baseline.find(item => item.scope_name === name)
    if (!scope || !reviewed) throw new Error('Missing static fixture baseline: ' + name)
    const row = (await db.query<{ n: number; h: string }>(`select count(*)::int n,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) h from public.${scope.table} t where ${scope.predicate}`)).rows[0]
    sql = sql.replaceAll(`if n<>${reviewed.exact_count} or h<>${quoted(reviewed.row_fingerprint)} then raise exception 'static_reset_stale:${name}'`,
      `if n<>${row.n} or h<>${quoted(row.h)} then raise exception 'static_reset_stale:${name}'`)
    sql = sql.replaceAll(`if n<>${reviewed.exact_count} or exists(select 1 from public.${scope.table} where id=any(ids))`,
      `if n<>${row.n} or exists(select 1 from public.${scope.table} where id=any(ids))`)
    sql = sql.replaceAll(`if n<>${reviewed.exact_count} then raise exception 'static_reset_delete_mismatch:${name}'`,
      `if n<>${row.n} then raise exception 'static_reset_delete_mismatch:${name}'`)
  }
  return sql
}

async function modelCompletedRoots() {
  await db.exec('delete from public.website_customer_applications;delete from public.data_quality_issues;delete from public.dashboard_alerts')
  for (const table of policy.assert_empty_tables as string[]) {
    await db.exec(`create table if not exists public.${table}(id uuid primary key default gen_random_uuid())`)
  }
}

describe('reviewed customer-flow reset transaction', () => {
  beforeEach(async () => {
    db = new PGlite()
    const special = new Set(['domain_events', 'event_outbox', 'canonical_domain_events', 'canonical_event_outbox', 'canonical_energy_flow_events', 'manual_inbound_messages', 'inbound_operation_events'])
    for (const table of new Set([...scopes.map(scope => scope.table), ...empty, ...policy.preserve_tables, ...policy.review_held_tables])) {
      if (!special.has(table)) await db.exec(`create table public.${table}(id uuid primary key default gen_random_uuid(),payload jsonb default '{}'::jsonb)`)
    }
    await db.exec(`
      create table public.domain_events(id uuid primary key default gen_random_uuid(),aggregate_type text,payload jsonb default '{}');
      create table public.event_outbox(id uuid primary key default gen_random_uuid(),domain_event_id uuid references public.domain_events(id) on delete cascade,payload jsonb default '{}');
      create table public.canonical_domain_events(id uuid primary key default gen_random_uuid(),aggregate_type text,payload jsonb default '{}');
      create table public.canonical_event_outbox(id uuid primary key default gen_random_uuid(),domain_event_id uuid references public.canonical_domain_events(id) on delete cascade,payload jsonb default '{}');
      create table public.canonical_energy_flow_events(id uuid primary key default gen_random_uuid(),event_scope text,event_type text,quote_id uuid references public.website_contract_quotes(id) on delete set null,payload jsonb default '{}');
      create table public.manual_inbound_messages(id uuid primary key default gen_random_uuid(),request_id uuid,resolution_status text,payload jsonb default '{}');
      create table public.inbound_operation_events(id uuid primary key default gen_random_uuid(),source_transport text,business_process text,intent text,source_id text,
        customer_id uuid,customer_site_id uuid,metering_point_id uuid,business_object_id uuid,payload jsonb default '{}');
      insert into public.domain_events(id,aggregate_type) values('${domain}','website_customer_application');
      insert into public.event_outbox(domain_event_id) values('${domain}');
      insert into public.canonical_domain_events(id,aggregate_type) values('${canonical}','website_customer_application');
      insert into public.canonical_event_outbox(domain_event_id) values('${canonical}');
      insert into public.domain_events(aggregate_type,payload) values('contract_publication','{"proof":"preserve"}');
      insert into public.canonical_domain_events(aggregate_type,payload) values('actor_test_result','{"proof":"preserve"}');
      insert into public.canonical_energy_flow_events(event_scope,event_type) values('tenant','quote.created');
      insert into public.canonical_energy_flow_events(event_scope,event_type,payload) values('platform','market_price.updated','{"proof":"preserve"}');
      insert into public.canonical_energy_flow_events(id,event_scope,event_type,payload) values('${unknownEnergyEvent}',null,null,'{"proof":"unknown"}');
      insert into public.manual_inbound_messages(id,resolution_status) values('${manualCase}','unmatched');
      insert into public.manual_inbound_messages(resolution_status,payload) values('matched','{"proof":"preserve"}');
      insert into public.inbound_operation_events(id,source_transport,business_process,intent,source_id)
        values('${inboundEvent}','email','power_of_attorney','power_of_attorney_question','${manualCase}');
      insert into public.inbound_operation_events(source_transport,business_process,intent,payload)
        values('ediel','actor_test','actor_test','{"proof":"preserve"}');
    `)
    for (const table of scopes.map(scope => scope.table).filter(table => !special.has(table))) {
      const id = table === 'website_contract_quotes' ? quoteId : app
      await db.query(`insert into public.${table}(id) values($1)`, [id])
    }
    for (const table of preserved) await db.exec(`insert into public.${table}(payload) values('{"proof":"preserve"}')`)
  }, 30_000)
  afterEach(async () => { await db.close() })

  it('deletes reviewed customer rowsets child-first and preserves technical/configuration/audit rows', async () => {
    await db.exec(await renderedReset())
    expect(await count('website_customer_applications')).toBe(0)
    expect(await count('event_outbox')).toBe(0)
    expect(await count('canonical_event_outbox')).toBe(0)
    expect(await count('domain_events')).toBe(1)
    expect(await count('canonical_domain_events')).toBe(1)
    expect(await count('canonical_energy_flow_events')).toBe(2)
    expect(await count('manual_inbound_messages')).toBe(1)
    expect(await count('inbound_operation_events')).toBe(1)
    expect((await db.query('select id from public.manual_inbound_messages where id=$1', [manualCase])).rows).toEqual([])
    expect((await db.query('select id from public.inbound_operation_events where id=$1', [inboundEvent])).rows).toEqual([])
    for (const table of preserved) expect(await count(table)).toBe(1)
  })

  it('aborts without deleting anything when an application arrives after the reviewed baseline', async () => {
    const sql = await renderedReset()
    await db.exec('insert into public.website_customer_applications default values')
    await expect(db.exec(sql)).rejects.toThrow('reset_stale_baseline:website_customer_applications')
    await db.exec('rollback')
    expect(await count('website_customer_applications')).toBe(2)
    expect(await count('domain_events')).toBe(2)
    expect(await count('dashboard_alerts')).toBe(1)
  })

  it('aborts when a new customer enters the previously empty graph', async () => {
    const sql = await renderedReset()
    await db.exec('insert into public.customers default values')
    await expect(db.exec(sql)).rejects.toThrow('reset_refused_new_customer_rows')
    await db.exec('rollback')
    expect(await count('customers')).toBe(1)
    expect(await count('website_customer_applications')).toBe(1)
  })

  it('rolls back if an FK SET NULL would change a preserved technical proof row', async () => {
    await db.query("update public.canonical_energy_flow_events set quote_id=$1 where event_scope='platform'", [quoteId])
    const sql = await renderedReset()
    await expect(db.exec(sql)).rejects.toThrow('reset_changed_preserved_rows:canonical_energy_flow_events')
    await db.exec('rollback')
    expect(await count('website_contract_quotes')).toBe(1)
    expect(await count('website_customer_applications')).toBe(1)
    expect(await count('canonical_energy_flow_events')).toBe(3)
  })

  it('refuses an inbound case whose classification changed after the reviewed baseline', async () => {
    const sql = await renderedReset()
    await db.query("update public.inbound_operation_events set intent='actor_test' where id=$1", [inboundEvent])
    await expect(db.exec(sql)).rejects.toThrow('reset_stale_baseline:inbound_operation_events')
    await db.exec('rollback')
    expect(await count('website_customer_applications')).toBe(1)
    expect(await count('manual_inbound_messages')).toBe(2)
    expect(await count('inbound_operation_events')).toBe(2)
  })

  it('refuses a newly added classified inbound pair instead of expanding the approved rowset', async () => {
    const sql = await renderedReset()
    await db.exec(`with m as (
      insert into public.manual_inbound_messages(resolution_status) values('unmatched') returning id
    ) insert into public.inbound_operation_events(source_transport,business_process,intent,source_id)
      select 'email','power_of_attorney','power_of_attorney_question',id::text from m`)
    await expect(db.exec(sql)).rejects.toThrow('reset_stale_baseline:inbound_operation_events')
    await db.exec('rollback')
    expect(await count('website_customer_applications')).toBe(1)
    expect(await count('manual_inbound_messages')).toBe(3)
    expect(await count('inbound_operation_events')).toBe(3)
  })

  it('refuses an inbound source that now matches an Ediel message', async () => {
    const sql = await renderedReset()
    await db.query('insert into public.ediel_messages(id) values($1)', [manualCase])
    await expect(db.exec(sql)).rejects.toThrow('reset_stale_baseline:inbound_operation_events')
    await db.exec('rollback')
    expect(await count('website_customer_applications')).toBe(1)
    expect(await count('ediel_messages')).toBe(2)
    expect(await count('manual_inbound_messages')).toBe(2)
  })

  it('rolls back an unexpected trigger mutation of a NULL-classified technical row', async () => {
    const sql = await renderedReset()
    await db.exec(`create function fixture_mutate_unknown_technical_row() returns trigger language plpgsql as $$
      begin update public.canonical_energy_flow_events set payload='{"changed":true}' where id='${unknownEnergyEvent}';return null;end$$;
      create trigger fixture_mutate_unknown_technical_row after delete on public.website_customer_applications
      for each statement execute function fixture_mutate_unknown_technical_row();`)
    await expect(db.exec(sql)).rejects.toThrow('reset_changed_preserved_rows:canonical_energy_flow_events')
    await db.exec('rollback')
    expect((await db.query<{ payload: unknown }>('select payload from public.canonical_energy_flow_events where id=$1', [unknownEnergyEvent])).rows[0].payload)
      .toEqual({ proof: 'unknown' })
    expect(await count('website_customer_applications')).toBe(1)
    expect(await count('event_outbox')).toBe(1)
    expect(await count('manual_inbound_messages')).toBe(2)
    expect(await count('inbound_operation_events')).toBe(2)
  })

  it('runs focused C, B, A, D batches after the separately verified application removal', async () => {
    await db.exec('delete from public.website_customer_applications')
    for (const group of ['c-events', 'b-read-models', 'a-quality', 'd-inbound']) {
      await db.exec(await renderedFocused(group))
    }
    expect(await count('event_outbox')).toBe(0)
    expect(await count('canonical_event_outbox')).toBe(0)
    expect(await count('domain_events')).toBe(1)
    expect(await count('canonical_domain_events')).toBe(1)
    expect(await count('canonical_energy_flow_events')).toBe(2)
    expect(await count('website_contract_quotes')).toBe(0)
    expect(await count('forecast_runs')).toBe(0)
    expect(await count('data_quality_issues')).toBe(0)
    expect(await count('dashboard_alerts')).toBe(0)
    expect(await count('manual_inbound_messages')).toBe(1)
    expect(await count('inbound_operation_events')).toBe(1)
    for (const table of preserved) expect(await count(table)).toBe(1)
    for (const table of policy.assert_empty_tables as string[]) {
      await db.exec(`create table if not exists public.${table}(id uuid primary key default gen_random_uuid())`)
    }
    const verification = readFileSync(folder + 'reset-focused-final-verification.sql', 'utf8')
    await db.exec(verification)
    await db.exec('insert into public.customer_contracts default values')
    await expect(db.exec(verification)).rejects.toThrow('reset_final_customer_graph_not_empty:customer_contracts')
    await db.exec('rollback')
  }, 30_000)

  it('refuses a focused event batch if its reviewed parent row changes', async () => {
    await db.exec('delete from public.website_customer_applications')
    const sql = await renderedFocused('c-events')
    await db.query('update public.domain_events set payload=$1::jsonb where id=$2', [JSON.stringify({ changed: true }), domain])
    await expect(db.exec(sql)).rejects.toThrow('focused_reset_stale:customer_domain_events')
    await db.exec('rollback')
    expect(await count('event_outbox')).toBe(1)
    expect(await count('domain_events')).toBe(2)
  })

  it('rolls back focused root removal if FK SET NULL alters an unknown technical row', async () => {
    await db.exec('delete from public.website_customer_applications')
    await db.query('update public.canonical_energy_flow_events set quote_id=$1 where id=$2', [quoteId, unknownEnergyEvent])
    const sql = await renderedFocused('b-read-models')
    await expect(db.exec(sql)).rejects.toThrow('focused_reset_changed_preserved:canonical_energy_flow_events')
    await db.exec('rollback')
    expect(await count('website_contract_quotes')).toBe(1)
    expect((await db.query<{ quote_id: string }>('select quote_id from public.canonical_energy_flow_events where id=$1', [unknownEnergyEvent])).rows[0].quote_id).toBe(quoteId)
  })

  it('refuses a focused inbound batch when its source becomes technical Ediel data', async () => {
    await db.exec('delete from public.website_customer_applications')
    const sql = await renderedFocused('d-inbound')
    await db.query('insert into public.ediel_messages(id) values($1)', [manualCase])
    await expect(db.exec(sql)).rejects.toThrow('focused_reset_stale:inbound_operation_events')
    await db.exec('rollback')
    expect(await count('manual_inbound_messages')).toBe(2)
    expect(await count('inbound_operation_events')).toBe(2)
    expect(await count('ediel_messages')).toBe(2)
  })

  it('runs all static C/B/D statements and verifies the complete empty customer graph', async () => {
    await modelCompletedRoots()
    const groups = [
      ['customer_domain_outbox', 'customer_canonical_outbox', 'customer_domain_events', 'customer_canonical_events', 'customer_energy_events'],
      ['customer_onboarding_operations', 'website_contract_quotes', 'customer_site_resolution', 'customer_portfolio_forecast_snapshots', 'bidding_zone_monthly_metrics', 'company_monthly_metrics', 'forecast_runs'],
    ]
    for (const [i, names] of groups.entries()) {
      for (const [j, name] of names.entries()) {
        await db.exec(await renderedStatic(`reset-static-${i === 0 ? 'c' : 'b'}${j + 1}-${name}.sql`, [name]))
      }
    }
    await db.exec(await renderedStatic('reset-static-d-inbound-pair.sql', ['manual_inbound_messages', 'inbound_operation_events']))
    await db.exec(readFileSync(folder + 'reset-focused-final-verification.sql', 'utf8'))
    expect(await count('domain_events')).toBe(1)
    expect(await count('canonical_domain_events')).toBe(1)
    expect(await count('canonical_energy_flow_events')).toBe(2)
    expect(await count('manual_inbound_messages')).toBe(1)
    expect(await count('inbound_operation_events')).toBe(1)
    for (const table of preserved) expect(await count(table)).toBe(1)
  }, 30_000)

  it('refuses a static parent deletion when an unexpected referencing FK appears', async () => {
    await modelCompletedRoots()
    await db.exec('delete from public.event_outbox')
    const sql = await renderedStatic('reset-static-c3-customer_domain_events.sql', ['customer_domain_events'])
    await db.exec(`create table extra_technical_reference(id uuid primary key default gen_random_uuid(),domain_event_id uuid references public.domain_events(id) on delete cascade);
      insert into extra_technical_reference(domain_event_id) values('${domain}')`)
    await expect(db.exec(sql)).rejects.toThrow('static_reset_schema_changed:domain_events')
    await db.exec('rollback')
    expect(await count('domain_events')).toBe(2)
    expect(await count('extra_technical_reference')).toBe(1)
  })

  it('rolls back static quote removal when SET NULL would alter an unknown technical event', async () => {
    await modelCompletedRoots()
    await db.query('update public.canonical_energy_flow_events set quote_id=$1 where id=$2', [quoteId, unknownEnergyEvent])
    const sql = await renderedStatic('reset-static-b2-website_contract_quotes.sql', ['website_contract_quotes'])
    await expect(db.exec(sql)).rejects.toThrow('static_reset_changed_child:canonical_energy_flow_events')
    await db.exec('rollback')
    expect(await count('website_contract_quotes')).toBe(1)
    expect((await db.query<{ quote_id: string }>('select quote_id from public.canonical_energy_flow_events where id=$1', [unknownEnergyEvent])).rows[0].quote_id).toBe(quoteId)
  })

  it('refuses static inbound removal when its source now matches technical Ediel proof', async () => {
    await modelCompletedRoots()
    const sql = await renderedStatic('reset-static-d-inbound-pair.sql', ['manual_inbound_messages', 'inbound_operation_events'])
    await db.query('insert into public.ediel_messages(id) values($1)', [manualCase])
    await expect(db.exec(sql)).rejects.toThrow('static_reset_stale:inbound_operation_events')
    await db.exec('rollback')
    expect(await count('manual_inbound_messages')).toBe(2)
    expect(await count('inbound_operation_events')).toBe(2)
    expect(await count('ediel_messages')).toBe(2)
  })
})
