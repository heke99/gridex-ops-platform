// BILLNEG01.02 native SQL proof only. No seeds, policy/trigger bypasses, mocks,
// HTTP/Auth/browser credit, migration installation, or new producer workflow.
// Existing producer supplies fresh prepared synthetic FINAL graphs through
// standard product paths, owns the disposable local backend and preserves raw
// evidence privately. This fixture manifest is data, not admission authority.
// No native PASS exists until that producer executes the complete suite on its
// qualified quiescent disposable backend with the exact pinned PR997 migration.
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { Worker } from 'node:worker_threads'
import { beforeAll, describe, expect, it } from 'vitest'

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type Row = Record<string, Json>
type Role = 'service_role' | 'authenticated' | 'anon'
type Graph = { exportItemId: string; preparationEvidenceSha256: string }
type Fixture = {
  companyId: string
  otherCompanyId: string
  permittedActorIds: [string, string]
  otherCompanyActorId: string
  graphs: { concurrent: Graph; contextDrift: Graph; rollback: Graph }
}
type Context = { item: Row; invoice: Row; underlay: Row; pricing_run: Row }
type Snapshot = {
  graphHash: string
  eventHash: string
  outboxHash: string
  eventCount: number
  outboxCount: number
}
type Attempt = { status: number; sqlstate: string | null; value?: Row }
type Controller = { pid: number; finish: () => Promise<void> }
const connection = 'postgresql://postgres@127.0.0.1:54322/postgres'
const args = [connection, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate']
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const digest = /^[0-9a-f]{64}$/
const signature = 'public.gridex_approve_invoice_export_item_v1(uuid,uuid,uuid,jsonb,text)'
const nonce = randomUUID().replaceAll('-', '')
let fixture: Fixture
let contexts: Record<keyof Fixture['graphs'], Context>
let concurrentPhaseQualified = false
let mirrorRollbackQualified = false

function must(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(label)
}
function row(value: unknown): Row {
  must(value !== null && typeof value === 'object' && !Array.isArray(value), 'native_result_object_required')
  return value as Row
}
function literal(value: string): string { return `'${value.replaceAll("'", "''")}'` }
function json(value: unknown): string { return `${literal(JSON.stringify(value))}::jsonb` }
function stable(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
function hash(value: Json): string { return createHash('sha256').update(stable(value)).digest('hex') }
function privateJson(path: string | undefined): unknown {
  try {
    must(path && isAbsolute(path) && realpathSync(path) === path, 'private_fixture_path_required')
    const stat = lstatSync(path)
    must(stat.isFile() && stat.uid === process.getuid?.() && (stat.mode & 0o077) === 0
      && stat.size <= 65_536, 'private_fixture_file_required')
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // Filesystem and JSON parse errors can include private paths or content.
    throw new Error('owned_private_fixture_file_invalid')
  }
}
function readFixture(): Fixture {
  const input = row(privateJson(process.env.T4_APPROVAL_NATIVE_FIXTURE))
  must(input.format === 't4_invoice_approval_native_fixture_v1', 'native_fixture_format_required')
  const graphs = row(input.graphs)
  const result = {
    companyId: input.companyId,
    otherCompanyId: input.otherCompanyId,
    permittedActorIds: input.permittedActorIds,
    otherCompanyActorId: input.otherCompanyActorId,
    graphs,
  }
  must(typeof result.companyId === 'string' && uuid.test(result.companyId)
    && typeof result.otherCompanyId === 'string' && uuid.test(result.otherCompanyId)
    && result.companyId !== result.otherCompanyId, 'distinct_fixture_companies_required')
  must(Array.isArray(result.permittedActorIds) && result.permittedActorIds.length === 2
    && result.permittedActorIds.every((actor) => typeof actor === 'string' && uuid.test(actor))
    && new Set(result.permittedActorIds).size === 2
    && typeof result.otherCompanyActorId === 'string' && uuid.test(result.otherCompanyActorId)
    && !result.permittedActorIds.includes(result.otherCompanyActorId), 'distinct_fixture_actors_required')
  const ids: string[] = []
  for (const name of ['concurrent', 'contextDrift', 'rollback']) {
    const graph = row(graphs[name])
    must(typeof graph.exportItemId === 'string' && uuid.test(graph.exportItemId)
      && typeof graph.preparationEvidenceSha256 === 'string'
      && digest.test(graph.preparationEvidenceSha256), 'prepared_graph_reference_required')
    ids.push(graph.exportItemId)
  }
  must(new Set(ids).size === 3, 'three_distinct_prepared_graphs_required')
  return result as unknown as Fixture
}
function safeAttempt(input: string): Attempt {
  try {
    const output = execFileSync('psql', args, {
      input, encoding: 'utf8', timeout: 30_000, maxBuffer: 8_000_000,
      stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PGPASSWORD: 'postgres' },
    }).trim().split('\n').filter(Boolean).at(-1)
    must(output, 'native_sql_result_missing')
    return { status: 0, sqlstate: null, value: row(JSON.parse(output)) }
  } catch (error) {
    const failure = error as { status?: number; stderr?: string | Buffer }
    const match = String(failure.stderr ?? '').match(/ERROR:\s+([0-9A-Z]{5})\b/)
    // Never attach original error/stdout/stderr: psql may echo private context.
    return { status: failure.status ?? -1, sqlstate: match?.[1] ?? null }
  }
}
function sql(input: string): Row {
  const result = safeAttempt(input)
  must(result.status === 0 && result.value, `native_sql_failed:${result.status}:${result.sqlstate ?? 'unknown'}`)
  return result.value
}
function transaction(body: string, role: Role = 'service_role', actor = fixture.permittedActorIds[0]): string {
  return `BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='5s';
    SET LOCAL ROLE ${role};
    SELECT set_config('request.jwt.claims',${literal(JSON.stringify({ role, sub: actor }))},true);
    SELECT set_config('request.jwt.claim.role',${literal(role)},true);
    ${body} COMMIT;`
}
function context(graph: Graph): Context {
  const result = sql(`SELECT jsonb_build_object('context',jsonb_build_object(
    'item',to_jsonb(i),'invoice',to_jsonb(inv),'underlay',to_jsonb(u),'pricing_run',to_jsonb(p)))
    FROM public.invoice_export_items i
    JOIN public.customer_invoices inv ON inv.company_id=i.company_id AND inv.invoice_export_item_id=i.id
    JOIN public.billing_underlays u ON u.company_id=i.company_id AND u.id=i.billing_underlay_id
    JOIN public.pricing_runs p ON p.company_id=i.company_id AND p.id=i.pricing_run_id
    WHERE i.company_id=${literal(fixture.companyId)}::uuid AND i.id=${literal(graph.exportItemId)}::uuid;`)
  const value = row(result.context)
  return { item: row(value.item), invoice: row(value.invoice), underlay: row(value.underlay), pricing_run: row(value.pricing_run) }
}
function reviewHash(value: Context): string {
  return hash({
    invoice_export_item_id: value.item.id,
    billing_underlay_id: value.underlay.id,
    pricing_run_id: value.pricing_run.id,
    calculation_snapshot_sha256: value.invoice.calculation_snapshot_sha256,
    total_kwh: Number(value.underlay.total_kwh),
    total_inc_vat: Number(value.invoice.amount_inc_vat),
    price_area: value.invoice.price_area_code ?? value.underlay.price_area,
  })
}
function call(value: Context, actor: string, company = fixture.companyId): string {
  return `public.gridex_approve_invoice_export_item_v1(${literal(company)}::uuid,
    ${literal(String(value.item.id))}::uuid,${literal(actor)}::uuid,${json(value)},${literal(reviewHash(value))})`
}
function invoke(value: Context, actor = fixture.permittedActorIds[0], company = fixture.companyId, role: Role = 'service_role'): Attempt {
  return safeAttempt(transaction(`SELECT jsonb_build_object('receipt',${call(value, actor, company)});`, role, actor))
}
function snapshot(graph: Graph): Snapshot {
  const result = sql(`WITH events AS (
      SELECT * FROM public.domain_events WHERE aggregate_type='invoice_export_item'
        AND aggregate_id=${literal(graph.exportItemId)} AND event_type='invoice.approved'
    ), outbox AS (
      SELECT o.* FROM public.event_outbox o JOIN events e ON e.id=o.domain_event_id
    ) SELECT jsonb_build_object(
      'graphHash',encode(sha256(convert_to(jsonb_build_object(
        'context',${json(context(graph))})::text,'UTF8')),'hex'),
      'eventHash',encode(sha256(convert_to(coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM events e),'[]')::text,'UTF8')),'hex'),
      'outboxHash',encode(sha256(convert_to(coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM outbox o),'[]')::text,'UTF8')),'hex'),
      'eventCount',(SELECT count(*) FROM events),'outboxCount',(SELECT count(*) FROM outbox));`)
  return result as unknown as Snapshot
}
function unchanged(before: Snapshot, after: Snapshot) {
  expect(after.graphHash).toBe(before.graphHash)
  expect(after.eventHash).toBe(before.eventHash)
  expect(after.outboxHash).toBe(before.outboxHash)
  expect(after.eventCount).toBe(before.eventCount)
  expect(after.outboxCount).toBe(before.outboxCount)
}
function approvalHash(value: Context): string {
  const item = row(value.item.metadata).approval
  const mirror = row(value.invoice.metadata).approval
  expect(hash(item)).toBe(hash(mirror))
  return hash(item)
}
function businessContextHash(value: Context): string {
  const copy = structuredClone(value)
  for (const name of ['item', 'invoice'] as const) {
    delete copy[name].updated_at
    delete row(copy[name].metadata).approval
  }
  return hash(copy)
}
function nativeWorker(input: string): Promise<Attempt> {
  return new Promise((resolveAttempt, reject) => {
    const worker = new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      const {execFileSync}=require('node:child_process');
      try {
        const lines=execFileSync('psql',workerData.args,{input:workerData.input,encoding:'utf8',
          timeout:30000,maxBuffer:8000000,stdio:['pipe','pipe','pipe'],env:{...process.env,PGPASSWORD:'postgres'}}).trim().split('\\n').filter(Boolean);
        parentPort.postMessage({status:0,sqlstate:null,value:JSON.parse(lines.at(-1))});
      } catch(error) {
        const match=String(error.stderr??'').match(/ERROR:\\s+([0-9A-Z]{5})\\b/);
        parentPort.postMessage({status:error.status??-1,sqlstate:match?.[1]??null});
      }
    `, { eval: true, workerData: { args, input } })
    worker.once('message', (value: Attempt) => resolveAttempt(value))
    worker.once('error', () => reject(new Error('native_worker_failed')))
    worker.once('exit', (code) => { if (code !== 0) reject(new Error(`native_worker_exit:${code}`)) })
  })
}

async function holdCompanyRow(): Promise<Controller> {
  const child = spawn('psql', args, {
    env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: ['pipe', 'pipe', 'pipe'],
  })
  // This exact owned child only holds a row lock and makes no business writes.
  // The server-side idle timeout and own-child ceiling make cleanup finite.
  const ceiling = setTimeout(() => child.kill('SIGTERM'), 25_000)
  const closed = new Promise<number | null>((resolveClosed) => child.once('close', resolveClosed))
  child.stderr.resume() // Drain privately; never attach raw SQL diagnostics to an error.
  child.stdin.on('error', () => child.kill('SIGTERM'))
  const ready = new Promise<number>((resolveReady, reject) => {
    let buffer = ''
    const timeout = setTimeout(() => {
      child.stdin.end('ROLLBACK;\n')
      reject(new Error('owned_lock_controller_not_ready'))
    }, 5_000)
    child.once('error', () => { clearTimeout(timeout); reject(new Error('owned_lock_controller_spawn_failed')) })
    child.once('close', () => { clearTimeout(timeout); reject(new Error('owned_lock_controller_closed_before_ready')) })
    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString('utf8')
      while (buffer.includes('\n')) {
        const boundary = buffer.indexOf('\n')
        const line = buffer.slice(0, boundary).trim()
        buffer = buffer.slice(boundary + 1)
        try {
          const message = JSON.parse(line) as { controllerPid?: number }
          if (Number.isSafeInteger(message.controllerPid) && Number(message.controllerPid) > 0) {
            clearTimeout(timeout)
            resolveReady(Number(message.controllerPid))
          }
        } catch { /* psql command tags are not readiness and grant nothing */ }
      }
    })
  })
  child.stdin.write(`BEGIN; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='5s';
    SET LOCAL idle_in_transaction_session_timeout='15s';
    SET LOCAL application_name=${literal(`t4_approval_controller_${nonce}`)};
    SELECT jsonb_build_object('controllerPid',pg_backend_pid()) FROM public.companies
      WHERE id=${literal(fixture.companyId)}::uuid FOR UPDATE;\n`)
  try {
    const pid = await ready
    return { pid, finish: async () => {
      child.stdin.end('ROLLBACK;\n')
      const code = await closed
      clearTimeout(ceiling)
      must(code === 0, 'owned_lock_controller_cleanup_failed')
    } }
  } catch {
    child.stdin.end('ROLLBACK;\n')
    await closed
    clearTimeout(ceiling)
    throw new Error('owned_lock_controller_setup_failed')
  }
}

async function observeBothBlocked(names: string[], controllerPid: number): Promise<void> {
  const deadline = Date.now() + 4_000
  while (Date.now() < deadline) {
    const observation = sql(`BEGIN; SET LOCAL statement_timeout='2s';
      WITH RECURSIVE own AS (
        SELECT pid,wait_event_type FROM pg_stat_activity
          WHERE application_name=ANY(ARRAY[${names.map(literal).join(',')}]::text[])
      ), chain(root,pid,path) AS (
        SELECT pid,pid,ARRAY[pid] FROM own
        UNION ALL SELECT c.root,b.pid,c.path||b.pid FROM chain c
          CROSS JOIN LATERAL unnest(pg_blocking_pids(c.pid)) b(pid)
          WHERE NOT b.pid=ANY(c.path)
      ) SELECT jsonb_build_object('observed',
        (SELECT count(*)=2 AND count(DISTINCT pid)=2 FROM own)
        AND (SELECT bool_and(wait_event_type='Lock' AND EXISTS(
          SELECT FROM chain WHERE root=own.pid AND pid=${controllerPid})) FROM own)); COMMIT;`)
    if (observation.observed === true) return
    await new Promise<void>((resolvePoll) => setTimeout(resolvePoll, 50))
  }
  throw new Error('two_rpc_connections_not_observed_blocked_on_owned_controller')
}

function assertRollback(kind: 'mirror' | 'outbox'): void {
  const graph = fixture.graphs.rollback
  const value = contexts.rollback
  const before = snapshot(graph)
  const helperSchema = `t4_approval_${nonce}_${kind}`
  const helperTrigger = `t4_approval_${nonce}_${kind}`
  const helperMarker = `t4-approval-rollback:${nonce}:${kind}`
  const functionName = `reject_${kind}`
  const table = kind === 'mirror' ? 'customer_invoices' : 'event_outbox'
  const sqlstate = kind === 'mirror' ? 'P0T42' : 'P0T43'
  const body = kind === 'mirror'
    ? `BEGIN RAISE EXCEPTION 't4_owned_rollback_probe' USING ERRCODE='P0T42'; END;`
    : `BEGIN
      IF NEW.company_id=${literal(fixture.companyId)}::uuid AND EXISTS(
        SELECT FROM public.domain_events e WHERE e.id=NEW.domain_event_id
          AND e.company_id=${literal(fixture.companyId)}::uuid
          AND e.aggregate_type='invoice_export_item'
          AND e.aggregate_id=${literal(graph.exportItemId)}
          AND e.event_type='invoice.approved'
      ) THEN RAISE EXCEPTION 't4_owned_outbox_rollback_probe' USING ERRCODE='P0T43'; END IF;
      RETURN NEW; END;`
  // PostgreSQL trigger WHEN cannot contain a subquery. The outbox function
  // additionally resolves NEW.domain_event_id to this exact own approval event.
  const trigger = kind === 'mirror'
    ? `AFTER UPDATE OF metadata ON public.customer_invoices FOR EACH ROW
        WHEN (OLD.id=${literal(String(value.invoice.id))}::uuid
          AND OLD.company_id=${literal(fixture.companyId)}::uuid)`
    : `AFTER INSERT ON public.event_outbox FOR EACH ROW
        WHEN (NEW.company_id=${literal(fixture.companyId)}::uuid)`
  try {
    sql(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s';
      CREATE SCHEMA ${helperSchema}; COMMENT ON SCHEMA ${helperSchema} IS ${literal(helperMarker)};
      CREATE FUNCTION ${helperSchema}.${functionName}() RETURNS trigger LANGUAGE plpgsql
        SET search_path=pg_catalog AS ${literal(body)};
      CREATE TRIGGER ${helperTrigger} ${trigger}
        EXECUTE FUNCTION ${helperSchema}.${functionName}(); COMMIT;
      SELECT jsonb_build_object('installed',true);`)
    const result = invoke(value)
    expect(result.status !== 0).toBe(true)
    expect(result.sqlstate).toBe(sqlstate)
    unchanged(before, snapshot(graph))
  } finally {
    // Always read back after installation was attempted: COMMIT may have
    // succeeded even if the client never obtained a parseable final result.
    const ownership = sql(`SELECT jsonb_build_object(
      'absent',NOT EXISTS(SELECT FROM pg_namespace WHERE nspname=${literal(helperSchema)})
        AND NOT EXISTS(SELECT FROM pg_trigger WHERE tgname=${literal(helperTrigger)}),
      'ours',coalesce((SELECT obj_description(n.oid,'pg_namespace')=${literal(helperMarker)}
        AND p.prosrc=${literal(body)} AND t.tgfoid=p.oid
        AND t.tgrelid=${literal(`public.${table}`)}::regclass
        FROM pg_namespace n JOIN pg_proc p ON p.pronamespace=n.oid
          AND p.proname=${literal(functionName)}
        JOIN pg_trigger t ON t.tgname=${literal(helperTrigger)}
        WHERE n.nspname=${literal(helperSchema)}),false));`)
    if (ownership.absent !== true) {
      must(ownership.ours === true, 'owned_helper_cleanup_binding_required')
      const cleaned = sql(`BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='20s';
        DROP TRIGGER ${helperTrigger} ON public.${table};
        DROP FUNCTION ${helperSchema}.${functionName}(); DROP SCHEMA ${helperSchema}; COMMIT;
        SELECT jsonb_build_object('absent',NOT EXISTS(
          SELECT FROM pg_namespace WHERE nspname=${literal(helperSchema)}) AND NOT EXISTS(
          SELECT FROM pg_trigger WHERE tgname=${literal(helperTrigger)}));`)
      expect(cleaned.absent).toBe(true)
    }
  }
  unchanged(before, snapshot(graph))
}

beforeAll(() => {
  fixture = readFixture()
  let migration: string
  try { migration = readFileSync(resolve('supabase/migrations/20261101115115_invoice_approval_atomic.sql'), 'utf8') }
  catch { throw new Error('qualified_candidate_migration_file_required') }
  must(createHash('sha256').update(migration).digest('hex')
    === '1052f7157b250ac8a004c7da36c24c1cd1a44a4feebe303fb4a31b17732a433f',
  'qualified_candidate_migration_hash_required')
  const body = migration.match(/CREATE(?: OR REPLACE)? FUNCTION public\.gridex_approve_invoice_export_item_v1\([\s\S]*?\bAS \$\$([\s\S]*?)\$\$;/)?.[1]
  must(body, 'candidate_function_source_required')
  const binding = sql(`SELECT jsonb_build_object(
    'sourceMatches',p.prosrc=${literal(body)},'securityDefiner',p.prosecdef,
    'configMatches',(SELECT array_agg(setting ORDER BY setting) FROM unnest(p.proconfig) setting)
      =ARRAY['lock_timeout=5s','search_path=pg_catalog']::text[],
    'serviceExecute',has_function_privilege('service_role',p.oid,'EXECUTE'),
    'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),
    'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE')) FROM pg_proc p
    WHERE p.oid=${literal(signature)}::regprocedure;`)
  expect(binding.sourceMatches).toBe(true)
  expect(binding.securityDefiner).toBe(true)
  expect(binding.configMatches).toBe(true)
  expect(binding.serviceExecute).toBe(true)
  expect(binding.authenticatedExecute).toBe(false)
  expect(binding.anonExecute).toBe(false)
  const actors = sql(`SELECT jsonb_build_object(
    'firstPermitted',public.gridex_actor_has_company_permission(
      ${literal(fixture.permittedActorIds[0])}::uuid,${literal(fixture.companyId)}::uuid,'billing_underlay.export'),
    'secondPermitted',public.gridex_actor_has_company_permission(
      ${literal(fixture.permittedActorIds[1])}::uuid,${literal(fixture.companyId)}::uuid,'billing_underlay.export'),
    'otherCompanyPermitted',public.gridex_actor_has_company_permission(
      ${literal(fixture.otherCompanyActorId)}::uuid,${literal(fixture.otherCompanyId)}::uuid,'billing_underlay.export'),
    'otherCompanyForbidden',public.gridex_actor_has_company_permission(
      ${literal(fixture.otherCompanyActorId)}::uuid,${literal(fixture.companyId)}::uuid,'billing_underlay.export') IS FALSE,
    'operationalCompanies',(SELECT count(*)=2 FROM public.companies
      WHERE id IN (${literal(fixture.companyId)}::uuid,${literal(fixture.otherCompanyId)}::uuid)
      AND coalesce(status,'active') NOT IN ('paused','suspended','closed','archived','pending_deletion','deleted_test_only')
      AND is_active IS DISTINCT FROM FALSE),
    'activeActors',(SELECT count(*)=3 FROM auth.users u JOIN public.user_profiles p ON p.id=u.id
      WHERE u.id=ANY(ARRAY[${[...fixture.permittedActorIds, fixture.otherCompanyActorId].map(literal).join(',')}]::uuid[])
        AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=clock_timestamp())
        AND u.email_confirmed_at IS NOT NULL AND p.user_status='active'));`)
  for (const key of ['firstPermitted', 'secondPermitted', 'otherCompanyPermitted',
    'otherCompanyForbidden', 'operationalCompanies', 'activeActors']) expect(actors[key]).toBe(true)
  contexts = {
    concurrent: context(fixture.graphs.concurrent),
    contextDrift: context(fixture.graphs.contextDrift),
    rollback: context(fixture.graphs.rollback),
  }
  must(new Set(Object.values(contexts).map((value) => value.underlay.id)).size === 3,
    'three_distinct_prepared_underlays_required')
  for (const name of ['concurrent', 'contextDrift', 'rollback'] as const) {
    const value = contexts[name]
    expect(value.item.status).toBe('pending')
    expect(value.invoice.status).toBe('draft')
    expect(row(row(value.item.metadata).approval).status).toBe('pending_review')
    expect(row(row(value.invoice.metadata).approval).status).toBe('pending_review')
    expect(value.pricing_run.status).toBe('locked')
    expect(value.underlay.source_system === 'consumption_estimate'
      || value.underlay.source_system === 'normalized_metering_values+consumption_estimate').toBe(false)
    const guard = sql(`BEGIN; SET LOCAL statement_timeout='20s'; SET LOCAL lock_timeout='5s';
      SELECT gridex_billing_source.require_underlay_v1(${literal(fixture.companyId)}::uuid,
        ${literal(String(value.underlay.id))}::uuid); COMMIT;
      SELECT jsonb_build_object('qualified',true);`)
    expect(guard.qualified).toBe(true)
    const before = snapshot(fixture.graphs[name])
    expect(before.eventCount).toBe(0)
    expect(before.outboxCount).toBe(0)
    const sources = sql(transaction(`WITH lines AS (
      SELECT count(*) AS total,count(source_normalized_metering_value_id) AS linked
      FROM public.billing_underlay_items WHERE company_id=${literal(fixture.companyId)}::uuid
        AND billing_underlay_id=${literal(String(value.underlay.id))}::uuid
    ), ids AS (
      SELECT DISTINCT source_normalized_metering_value_id AS id
      FROM public.billing_underlay_items WHERE company_id=${literal(fixture.companyId)}::uuid
        AND billing_underlay_id=${literal(String(value.underlay.id))}::uuid
        AND source_normalized_metering_value_id IS NOT NULL
    ), numbered AS (
      SELECT id,(row_number() OVER (ORDER BY id)-1)/250 AS batch FROM ids
    ), batches AS (
      SELECT batch,array_agg(id ORDER BY id) AS ids FROM numbered GROUP BY batch
    ), source_values AS MATERIALIZED (
      SELECT public.gridex_read_billing_source_values_v1(${literal(fixture.companyId)}::uuid,ids)
        AS body FROM batches
    ), actual AS (
      SELECT v FROM source_values CROSS JOIN LATERAL jsonb_array_elements(body) v
    ) SELECT jsonb_build_object(
      'allLinked',(SELECT total>0 AND total=linked FROM lines),
      'expectedCount',(SELECT count(*) FROM ids),
      'sourceCount',(SELECT count(*) FROM actual),
      'distinctCount',(SELECT count(DISTINCT v->>'id') FROM actual),
      'allRequested',NOT EXISTS(SELECT FROM actual WHERE NOT EXISTS(
        SELECT FROM ids WHERE id::text=actual.v->>'id')),
      'allFinal',(SELECT bool_and(v#>>'{billing_source_basis,qualified}'='true'
        AND v#>>'{billing_source_basis,qualityEstablished}'='true'
        AND v#>'{billing_source_basis,quality}'='null'::jsonb) FROM actual));`))
    expect(sources.allLinked).toBe(true)
    expect(Number(sources.sourceCount) > 0).toBe(true)
    expect(sources.sourceCount).toBe(sources.expectedCount)
    expect(sources.distinctCount).toBe(sources.expectedCount)
    expect(sources.allRequested).toBe(true)
    expect(sources.allFinal).toBe(true)
  }
})

describe.sequential('BILLNEG01.02 qualified native approval transaction', () => {
  it('two database connections preserve one actor and emit exactly one event/outbox', async () => {
    const value = contexts.concurrent
    const controller = await holdCompanyRow()
    const applicationNames = fixture.permittedActorIds.map((_, index) => `t4_approval_${nonce}_${index}`)
    const pending = Promise.all(fixture.permittedActorIds.map((actor, index) =>
      nativeWorker(transaction(`SET LOCAL application_name=${literal(applicationNames[index])};
        SELECT jsonb_build_object('pid',pg_backend_pid(),'receipt',${call(value, actor)});`,
      'service_role', actor))))
    // Attach an immediate handler without converting errors into successful outcomes.
    // The original promise is awaited in finally even when observation fails.
    void pending.catch(() => undefined)
    let attempts: Attempt[] = []
    try {
      await observeBothBlocked(applicationNames, controller.pid)
    } finally {
      try { await controller.finish() }
      finally { attempts = await pending }
    }
    expect(attempts.map((attempt) => attempt.status)).toEqual([0, 0])
    const records = attempts.map((attempt) => row(attempt.value))
    expect(records[0].pid !== records[1].pid).toBe(true)
    const receipts = records.map((record) => row(record.receipt))
    expect(receipts.filter((receipt) => receipt.approved_now === true)).toHaveLength(1)
    expect(receipts.filter((receipt) => receipt.approved_now === false)).toHaveLength(1)
    expect(hash(receipts[0].approval)).toBe(hash(receipts[1].approval))
    const after = snapshot(fixture.graphs.concurrent)
    expect(after.eventCount).toBe(1)
    expect(after.outboxCount).toBe(1)
    const stored = context(fixture.graphs.concurrent)
    // Only approval metadata and its write timestamp may change. Invoice
    // numbers, amounts, snapshots and every underlay/pricing field stay frozen.
    expect(businessContextHash(stored)).toBe(businessContextHash(value))
    const winnerIndex = receipts.findIndex((receipt) => receipt.approved_now === true)
    const winner = receipts[winnerIndex]
    expect(row(winner.approval).approved_by).toBe(fixture.permittedActorIds[winnerIndex])
    expect(row(winner.approval).review_hash).toBe(reviewHash(value))
    expect(approvalHash(stored)).toBe(hash(winner.approval))
    const durable = sql(`SELECT jsonb_build_object('eventBound',
      e.company_id=${literal(fixture.companyId)}::uuid
      AND e.actor_user_id=${literal(fixture.permittedActorIds[winnerIndex])}::uuid
      AND e.aggregate_id=${literal(String(value.item.id))}
      AND e.payload->>'review_hash'=${literal(reviewHash(value))}
      AND e.id=${literal(String(winner.event_id))}::uuid,
      'outboxBound',o.company_id=e.company_id AND o.destination_type='webhook'
        AND o.destination_key='webhook_fanout_v1' AND o.status='queued')
      FROM public.domain_events e JOIN public.event_outbox o ON o.domain_event_id=e.id
      WHERE e.id=${literal(String(winner.event_id))}::uuid;`)
    expect(durable.eventBound).toBe(true)
    expect(durable.outboxBound).toBe(true)
    const pids = [...records.map((record) => Number(record.pid)), controller.pid]
    must(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0), 'native_backend_pid_required')
    const closed = sql(`SELECT jsonb_build_object('connectionsClosed',NOT EXISTS(
      SELECT FROM pg_stat_activity WHERE pid=ANY(ARRAY[${pids.join(',')}]::int[])),
      'locksReleased',NOT EXISTS(SELECT FROM pg_locks WHERE pid=ANY(ARRAY[${pids.join(',')}]::int[])));`)
    expect(closed.connectionsClosed).toBe(true)
    expect(closed.locksReleased).toBe(true)
    concurrentPhaseQualified = true
  })

  it('sequential replay leaves the entire graph and event/outbox unchanged', () => {
    must(concurrentPhaseQualified, 'concurrent_phase_unqualified_no_blind_replay')
    const graph = fixture.graphs.concurrent
    const before = snapshot(graph)
    const result = invoke(contexts.concurrent, fixture.permittedActorIds[1])
    expect(result.status).toBe(0)
    expect(row(result.value?.receipt).approved_now).toBe(false)
    unchanged(before, snapshot(graph))
  })

  it('a mismatched reviewed context is rejected with no durable effects', () => {
    const graph = fixture.graphs.contextDrift
    const before = snapshot(graph)
    const altered = structuredClone(contexts.contextDrift)
    altered.underlay.total_kwh = Number(altered.underlay.total_kwh) + 1
    const result = invoke(altered)
    expect(result.status !== 0).toBe(true)
    expect(result.sqlstate).toBe('40001')
    unchanged(before, snapshot(graph))
  })

  it('wrong company, wrong actor, authenticated and anon calls cannot write', () => {
    const graph = fixture.graphs.contextDrift
    const before = snapshot(graph)
    const value = contexts.contextDrift
    const attempts = [
      invoke(value, fixture.otherCompanyActorId, fixture.otherCompanyId),
      invoke(value, fixture.otherCompanyActorId),
      invoke(value, fixture.permittedActorIds[0], fixture.companyId, 'authenticated'),
      invoke(value, fixture.permittedActorIds[0], fixture.companyId, 'anon'),
    ]
    expect(attempts.every((attempt) => attempt.status !== 0)).toBe(true)
    expect(attempts.map((attempt) => attempt.sqlstate)).toEqual(['P0002', '42501', '42501', '42501'])
    unchanged(before, snapshot(graph))
  })

  it('a real mirror trigger exception rolls back item, mirror and event/outbox', () => {
    assertRollback('mirror')
    mirrorRollbackQualified = true
  })

  it('an outbox insertion failure rolls back both approvals and their new domain event', () => {
    must(mirrorRollbackQualified, 'mirror_rollback_unqualified_no_blind_fixture_replay')
    assertRollback('outbox')
  })
})
