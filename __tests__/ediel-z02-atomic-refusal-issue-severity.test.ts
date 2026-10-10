// masterplan: AT-Z02L-SUPPLIER, AT-Z02LK-SUPPLIER
// Actual historical gate/forward, PostgreSQL CHECK/FKs and trigger. The seven
// UUID false-core port and reduced parent/CIR/job rows are explicit finite IO;
// this proves refusal persistence, not original/source/admission/RLS authority.
import {createHash} from 'node:crypto'
import {existsSync, readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {expect, it} from 'vitest'

type Row = Record<string, unknown>
type State = Record<string, Row[]>
type Failure = {code: string | null; constraint: string | null; table: string | null; column: string | null; messageHash: string}
const root = (path: string) => new URL('../' + path, import.meta.url)
const forward = root('supabase/migrations/20261007230733_ediel_z02_atomic_refusal_issue_severity.sql')
const signature = 'public.gridex_gate_exact_z02_atomic_apply()'
const coreSignature = 'public.gridex_apply_exact_z02_core(uuid,uuid,uuid,uuid,uuid,uuid,uuid)'
const triggerName = 'trg_customer_operation_job_z02_zz_atomic_apply'
const oldHash = '4025d5ada5bc455f9b581b2e4ce26454ddb7769a92c71517f068c2f88bdbc55b'
const newHash = '118f62e6dc781c4a69a183a9d7675cd4cde6488bc55a2dea0e6dc8e876eb1033'
const schema = readFileSync(root('supabase/schema.sql'), 'utf8')
const historical = readFileSync(root('supabase/migrations/20260903213000_z02_snapshot_market_context_guard.sql'), 'utf8')
const gate = historical.match(/create or replace function public\.gridex_gate_exact_z02_atomic_apply\(\)[\s\S]*?as \$\$([\s\S]*?)\$\$;/i)
if (!gate) throw Error('actual_historical_atomic_gate_required')
const originalGate = gate[0], originalBody = gate[1]
const foundation = readFileSync(root('supabase/migrations/20260611123000_actor_registry_message_semantics_tenant_automation.sql'), 'utf8')
const issueDDL = foundation.match(/create table if not exists public\.facility_data_quality_issues \([\s\S]*?\n\);/i)?.[0]
const compositeFK = schema.match(/ALTER TABLE ONLY public\.facility_data_quality_issues\n    ADD CONSTRAINT facility_data_quality_issues_customer_company_fk[^;]+;/)?.[0]
const attachment = schema.match(/^CREATE TRIGGER trg_customer_operation_job_z02_zz_atomic_apply .*;$/m)?.[0]
const comment = schema.match(/^COMMENT ON FUNCTION public\.gridex_gate_exact_z02_atomic_apply\(\) IS .*;$/m)?.[0]
if (!issueDDL || !compositeFK || !attachment || !comment) throw Error('actual_issue_FKs_atomic_attachment_comment_required')
const access = readFileSync(root('supabase/migrations/20260821151000_restrict_site_scoped_z02_definers.sql'), 'utf8')
const gateRevoke = access.match(/revoke execute on function public\.gridex_gate_exact_z02_atomic_apply\(\)\s+from public, anon, authenticated;/i)?.[0]
const gateGrant = access.match(/grant execute on function public\.gridex_gate_exact_z02_atomic_apply\(\)\s+to service_role;/i)?.[0]
if (!gateRevoke || !gateGrant) throw Error('actual_atomic_gate_access_required')
function statusCheck(table: string) {
  const start = schema.indexOf(`CREATE TABLE public.${table} (`), end = schema.indexOf('\n);', start)
  const check = schema.slice(start, end).match(new RegExp(`CONSTRAINT ${table}_status_check CHECK \\(.+\\)`))?.[0]
  if (start < 0 || end < start || !check) throw Error('actual_status_check_required:' + table)
  return check
}
const tables = ['companies', 'customers', 'customer_sites', 'metering_points', 'customer_info_requests', 'customer_operation_jobs', 'facility_data_quality_issues']
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const own = {company: id(1), foreign: id(2), customer: id(3), foreignCustomer: id(4), site: id(5), foreignSite: id(6), point: id(7), foreignPoint: id(8), request: id(9), foreignRequest: id(10), message: id(11), operation: id(12), actor: id(13), job: id(14), foreignJob: id(15), issue: id(16), foreignIssue: id(17), target: id(18), dedup: id(19), absent: id(20), grid: id(23)}
const flags = {z02_correlation_status: 'exact', z02_payload_validation_status: 'valid', z02_snapshot_freshness_status: 'valid', z02_atomic_core_applied: false}
const payload = {customer_info_request_id: own.request, ediel_message_id: own.message}
const refusal = {ok: false, code: 'response_site_mismatch'}
function object(x: unknown): Row {return x && typeof x === 'object' && !Array.isArray(x) ? x as Row : {}}
function ordered(x: unknown): unknown {return Array.isArray(x) ? x.map(ordered) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, ordered(v)])) : x}
const hash = (x: unknown) => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(ordered(x))).digest('hex')
const sorted = (rows: Row[]) => rows.sort((a, b) => String(a.id).localeCompare(String(b.id)))
function job(overrides: Row = {}): Row {return {id: own.target, company_id: own.company, customer_id: own.customer, customer_site_id: own.site, job_type: 'apply_inbound_grid_owner_response', status: 'queued', result: {...flags}, payload: {...payload}, operation_id: own.operation, created_by: own.actor, ...overrides}}
function tuple(row: Row) {const p = object(row.payload); return [row.company_id, row.customer_id, row.customer_site_id, p.customer_info_request_id || null, p.ediel_message_id || null, row.operation_id, row.created_by]}
function failure(error: unknown): Failure {const e = object(error); return {code: typeof e.code === 'string' ? e.code : null, constraint: typeof e.constraint === 'string' ? e.constraint : null, table: typeof e.table === 'string' ? e.table : null, column: typeof e.column === 'string' ? e.column : null, messageHash: hash(String(e.message ?? ''))}}

async function setup(repair = true) {
  expect(hash(originalBody)).toBe(oldHash)
  const db = new PGlite(), calls: Array<Array<string | null>> = []
  let explicitRollback = false
  const observe = (notice: {message?: string; code?: string; severity?: string}) => {
    const prefix = 'GRIDEX_SEVERITY_CORE_PORT '
    if (notice.message?.startsWith(prefix)) {
      const values: unknown = JSON.parse(notice.message.slice(prefix.length))
      if (!Array.isArray(values) || values.length !== 7 || values.some(v => v !== null && typeof v !== 'string')) throw Error('invalid_declared_core_tuple')
      calls.push(values as Array<string | null>)
    } else if (notice.code === '00000' && notice.severity === 'DEBUG') return
    else if (explicitRollback && notice.code === '01000' && notice.severity === 'WARNING' && /^# [0-9]{1,20}: aborting transaction [0-9]{1,20}$/.test(notice.message ?? '')) return
    else throw Error('unexpected_pg_notice:' + hash({code: notice.code, severity: notice.severity, message: notice.message}))
  }
  const q = (sql: string, params: unknown[] = []) => db.query<Row>(sql, params, {onNotice: observe})
  const exec = (sql: string) => db.exec(sql, {onNotice: observe})
  const rollback = async () => {explicitRollback = true; try {await q('ROLLBACK')} finally {explicitRollback = false}}
  const rows = async (table: string) => (await q(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY id`)).rows.map(r => r.row as Row)
  const state = async () => {const s: State = {}; for (const table of tables) s[table] = await rows(table); return s}
  const insert = async (table: string, row: Row) => {
    const keys = Object.keys(row)
    return (await q(`INSERT INTO public.${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING to_jsonb(${table}) AS row`, keys.map(k => row[k]))).rows[0].row as Row
  }
  try {
    expect(Number((await q('SHOW server_version_num')).rows[0].server_version_num)).toBeGreaterThanOrEqual(170000)
    expect(Number((await q('SHOW server_version_num')).rows[0].server_version_num)).toBeLessThan(180000)
    await exec(`CREATE ROLE declared_owner NOLOGIN; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.companies(id uuid PRIMARY KEY, fixture_label text NOT NULL);
      CREATE TABLE public.customers(id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.companies(id), fixture_label text NOT NULL, UNIQUE(id,company_id));
      CREATE TABLE public.customer_sites(id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.companies(id), customer_id uuid REFERENCES public.customers(id), fixture_label text NOT NULL);
      CREATE TABLE public.metering_points(id uuid PRIMARY KEY, company_id uuid NOT NULL REFERENCES public.companies(id), customer_site_id uuid REFERENCES public.customer_sites(id), fixture_label text NOT NULL);
      CREATE TABLE public.customer_info_requests(id uuid PRIMARY KEY, company_id uuid NOT NULL, grid_owner_id uuid, status text DEFAULT 'draft' NOT NULL, blocker_code text, blocker_reason text, blocker_details jsonb DEFAULT '{}' NOT NULL, next_required_action text, updated_at timestamptz DEFAULT now() NOT NULL, updated_by uuid, ${statusCheck('customer_info_requests')});
      CREATE TABLE public.customer_operation_jobs(id uuid DEFAULT gen_random_uuid() PRIMARY KEY, company_id uuid NOT NULL, customer_id uuid NOT NULL, customer_site_id uuid, job_type text NOT NULL, status text DEFAULT 'queued' NOT NULL, result jsonb DEFAULT '{}' NOT NULL, payload jsonb DEFAULT '{}' NOT NULL, operation_id uuid DEFAULT gen_random_uuid() NOT NULL, created_by uuid, ${statusCheck('customer_operation_jobs')});
      ${issueDDL} ${compositeFK}
      CREATE FUNCTION public.gridex_apply_exact_z02_core(p_company_id uuid,p_customer_id uuid,p_site_id uuid,p_request_id uuid,p_message_id uuid,p_operation_id uuid,p_actor_user_id uuid)
      RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN
      RAISE NOTICE 'GRIDEX_SEVERITY_CORE_PORT %', jsonb_build_array(p_company_id,p_customer_id,p_site_id,p_request_id,p_message_id,p_operation_id,p_actor_user_id)::text;
      RETURN jsonb_build_object('ok',false,'code','response_site_mismatch'); END$$;
      ${originalGate} ${attachment} ${comment}
      ALTER FUNCTION ${signature} OWNER TO declared_owner;
      ${gateRevoke} ${gateGrant}
      GRANT USAGE ON SCHEMA public TO declared_owner;
      GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO declared_owner;`)
    await q('BEGIN')
    for (const foreign of [false, true]) {
      const company = foreign ? own.foreign : own.company, customer = foreign ? own.foreignCustomer : own.customer, site = foreign ? own.foreignSite : own.site, point = foreign ? own.foreignPoint : own.point
      await insert('companies', {id: company, fixture_label: foreign ? 'foreign-company' : 'own-company'})
      await insert('customers', {id: customer, company_id: company, fixture_label: foreign ? 'foreign-customer' : 'own-customer'})
      await insert('customer_sites', {id: site, company_id: company, customer_id: customer, fixture_label: foreign ? 'foreign-site' : 'own-site'})
      await insert('metering_points', {id: point, company_id: company, customer_site_id: site, fixture_label: foreign ? 'foreign-point' : 'own-point'})
      await insert('customer_info_requests', {id: foreign ? own.foreignRequest : own.request, company_id: company, grid_owner_id: own.grid, status: 'waiting_for_z02', blocker_code: 'sentinel', blocker_reason: 'retained reason', blocker_details: {sentinel: foreign ? 'foreign' : 'own'}, next_required_action: 'retained action', updated_at: '2026-10-07T00:00:00+00:00', updated_by: own.actor})
      await insert('customer_operation_jobs', job({id: foreign ? own.foreignJob : own.job, company_id: company, customer_id: customer, customer_site_id: site, status: 'completed', result: {sentinel: foreign ? 'foreign' : 'own'}, payload: {sentinel: true}}))
      await insert('facility_data_quality_issues', {id: foreign ? own.foreignIssue : own.issue, company_id: company, customer_id: customer, customer_site_id: site, metering_point_id: point, issue_type: 'sentinel', severity: 'blocking', source: 'sentinel', recommended_action: 'retained action', metadata: {sentinel: foreign ? 'foreign' : 'own'}, created_at: '2026-10-07T00:00:00+00:00'})
    }
    await q('COMMIT')
    const baseline = await state()
    expect(tables.every(t => baseline[t].length === 2)).toBe(true)
    expect(calls).toEqual([])
    // Meaningful test-first RED runs the actual old gate before the forward
    // exists. The separate mandatory asset test prevents missing-forward GREEN.
    if (repair && existsSync(forward)) await exec(readFileSync(forward, 'utf8'))
    return {db, q, exec, rollback, state, insert, calls, baseline, close: () => db.close()}
  } catch (error) {await db.close(); throw Error('fixture_setup_failure:' + JSON.stringify(failure(error)))}
}
type Fixture = Awaited<ReturnType<typeof setup>>
async function transaction(f: Fixture, run: () => Promise<void>) {
  expect(await f.state()).toEqual(f.baseline)
  await f.q('BEGIN')
  try {await run()} finally {
    await f.rollback()
    expect(await f.state()).toEqual(f.baseline)
    expect((await f.q('SELECT 1 AS usable')).rows).toEqual([{usable: 1}])
  }
}
async function statement(f: Fixture, run: () => Promise<unknown>, expectedTuple?: unknown[]) {
  const before = await f.state(), at = f.calls.length
  await f.q('SAVEPOINT declared_statement')
  let actualFailure: Failure | null = null, result: unknown
  try {result = await run()} catch (error) {actualFailure = failure(error)}
  if (actualFailure) {
    await f.q('ROLLBACK TO SAVEPOINT declared_statement')
    const restored = await f.state()
    expect(restored).toEqual(before)
    expect((await f.q('SELECT 1 AS usable')).rows).toEqual([{usable: 1}])
    if (expectedTuple) expect(f.calls.slice(at)).toEqual([expectedTuple])
    console.info('Z02_REFUSAL_SQL_EVIDENCE ' + JSON.stringify({sqlState: actualFailure.code, constraint: actualFailure.constraint, table: actualFailure.table, fullRowsRestored: true, connectionUsable: true, callCount: f.calls.length - at, expectedTupleMatched: expectedTuple ? true : null, callTupleHash: f.calls[at] ? hash(f.calls[at]) : null, beforeHash: hash(before), afterHash: hash(restored), bodyHash: (await f.q("SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') hash FROM pg_proc WHERE oid=$1::regprocedure", [signature])).rows[0]?.hash}))
  }
  await f.q('RELEASE SAVEPOINT declared_statement')
  return {failure: actualFailure, result}
}
function expectedRefusalJob(row: Row): Row {return {...row, status: 'needs_review', result: {...object(row.result), reason: refusal.code, reason_code: refusal.code, z02_atomic_core_applied: false, z02_atomic_core: refusal}}}
function expectedCIR(row: Row, request: unknown, message: unknown, clock: unknown): Row {return {...row, status: 'manual_review_required', blocker_code: refusal.code, blocker_reason: 'Atomisk Z02-apply blockerades av datainvariant.', blocker_details: {...object(row.blocker_details), atomic_core_apply: refusal, inbound_message_id: message || null, operation_id: own.operation}, next_required_action: 'Granska Z02-data och lös konflikt innan automation återupptas.', updated_at: clock, updated_by: own.actor, id: request}}
function expectedIssue(severity: string, generated: unknown, clock: unknown, message: unknown = own.message): Row {return {id: generated, company_id: own.company, customer_id: own.customer, customer_site_id: own.site, metering_point_id: null, customer_application_id: null, grid_owner_id: own.grid, issue_type: refusal.code, status: 'open', severity, facility_id: null, ediel_metering_point_id: null, grid_area_code: null, price_area: null, source: 'ediel_z02_atomic_core_apply', source_actor_id: null, source_error_code: refusal.code, source_error_text: 'Atomisk Z02-apply blockerades av datainvariant.', recommended_action: 'Granska inbound Z02 och site/metering-identitet innan automation återupptas.', retry_allowed: false, next_readiness_required: true, metadata: {customer_info_request_id: own.request, inbound_message_id: message || null, operation_id: own.operation, result: refusal}, created_at: clock, resolved_at: null, resolved_by: null}}
async function assertRefusal(f: Fixture, row: Row, cir: boolean, issue: boolean) {
  const before = await f.state(), at = f.calls.length, clock = (await f.q('SELECT to_jsonb(now()) clock')).rows[0].clock
  const out = await statement(f, () => f.insert('customer_operation_jobs', row), tuple(row))
  expect(out.failure, 'the actual gate must persist a truthful refusal instead of a SQL CHECK error').toBeNull()
  expect(f.calls.slice(at)).toEqual([tuple(row)])
  expect(out.result).toEqual(expectedRefusalJob(row))
  const after = await f.state(), expected = structuredClone(before), p = object(row.payload)
  expected.customer_operation_jobs = sorted([...expected.customer_operation_jobs, expectedRefusalJob(row)])
  if (cir) expected.customer_info_requests = expected.customer_info_requests.map(r => r.id === own.request ? expectedCIR(r, own.request, p.ediel_message_id, clock) : r)
  if (issue) {
    const added = after.facility_data_quality_issues.filter(r => !before.facility_data_quality_issues.some(old => old.id === r.id))
    expect(added).toHaveLength(1)
    expect(added[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(Object.values(own)).not.toContain(added[0].id)
    expect(tables.flatMap(t => before[t].map(r => r.id))).not.toContain(added[0].id)
    const issueRow = expectedIssue('blocking', added[0].id, clock, p.ediel_message_id ?? null)
    expect(Object.keys(issueRow)).toHaveLength(25)
    expect(added[0]).toEqual(issueRow)
    expected.facility_data_quality_issues = sorted([...expected.facility_data_quality_issues, issueRow])
  }
  expect(after).toEqual(expected)
}
async function catalog(f: Fixture) {return (await f.q(`SELECT jsonb_build_object('gate',(SELECT to_jsonb(p) FROM pg_proc p WHERE oid=to_regprocedure($1)), 'comment',obj_description(to_regprocedure($1),'pg_proc'), 'trigger',(SELECT to_jsonb(t) FROM pg_trigger t WHERE tgname=$2 AND tgrelid='public.customer_operation_jobs'::regclass), 'trigger_definition',(SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname=$2 AND tgrelid='public.customer_operation_jobs'::regclass), 'core',(SELECT to_jsonb(p) FROM pg_proc p WHERE oid=to_regprocedure($3))) value`, [signature, triggerName, coreSignature])).rows[0].value as Row}
async function accessProbes(f: Fixture) {
  return (await f.q(`SELECT r.rolname,has_function_privilege(r.oid,$1::regprocedure,'EXECUTE') allowed FROM pg_roles r WHERE rolname IN('anon','authenticated','service_role') ORDER BY rolname`, [signature])).rows
}
async function migrationFailure(f: Fixture) {
  expect(existsSync(forward), 'actual forward asset is mandatory').toBe(true)
  const before = await f.state(), metadata = await catalog(f)
  let caught: Failure | null = null
  try {await f.exec(readFileSync(forward, 'utf8'))} catch (error) {caught = failure(error); await f.rollback()}
  expect(caught).not.toBeNull()
  expect(caught?.code).toBe('P0001')
  expect(await f.state()).toEqual(before)
  expect(await catalog(f)).toEqual(metadata)
  expect((await f.q('SELECT 1 AS usable')).rows).toEqual([{usable: 1}])
}

it.each(['queued', 'running'])('persists complete blocking refusal for %s', async status => {
  const f = await setup(); try {await transaction(f, () => assertRefusal(f, job({status}), true, true))} finally {await f.close()}
}, 20000)
it('untouched historical gate reaches the actual named severity CHECK and rolls back every row', async () => {
  const f = await setup(false); try {await transaction(f, async () => {
    const row = job(), out = await statement(f, () => f.insert('customer_operation_jobs', row), tuple(row))
    expect(out.failure).toMatchObject({code: '23514', constraint: 'facility_data_quality_issues_severity_check', table: 'facility_data_quality_issues'})
    expect(await f.state()).toEqual(f.baseline)
  })} finally {await f.close()}
}, 20000)
it('the maintained forward and its exact canonical checksum are mandatory assets', () => {
  expect(existsSync(forward)).toBe(true)
  const manifest = JSON.parse(readFileSync(root('scripts/migration-history-manifest.json'), 'utf8')) as {files: Record<string, string>}
  expect(manifest.files['20261007230733_ediel_z02_atomic_refusal_issue_severity.sql']).toBe(hash(readFileSync(forward, 'utf8')))
})
const bypasses: Array<[string, Row]> = [
  ['job type', {job_type: 'declared_non_applicable'}], ['status', {status: 'completed'}],
  ['correlation', {result: {...flags, z02_correlation_status: 'ambiguous'}}], ['payload', {result: {...flags, z02_payload_validation_status: 'invalid'}}],
  ['snapshot', {result: {...flags, z02_snapshot_freshness_status: 'stale'}}], ['already atomic', {result: {...flags, z02_atomic_core_applied: true}}],
]
it.each(bypasses)('keeps the individual %s applicability guard', async (_label, override) => {
  const f = await setup(); try {await transaction(f, async () => {
    const row = job(override), before = await f.state(), at = f.calls.length
    expect(await f.insert('customer_operation_jobs', row)).toEqual(row)
    expect(f.calls.length).toBe(at)
    const expected = structuredClone(before); expected.customer_operation_jobs = sorted([...expected.customer_operation_jobs, row])
    expect(await f.state()).toEqual(expected)
  })} finally {await f.close()}
}, 20000)
it.each(['customer_info_request_id', 'ediel_message_id'])('malformed %s remains a caught no-core-call refusal', async field => {
  const f = await setup(); try {await transaction(f, async () => {
    const row = job({payload: {...payload, [field]: 'malformed'}}), before = await f.state(), at = f.calls.length
    const result = await f.insert('customer_operation_jobs', row)
    const expected = {...row, status: 'needs_review', result: {...flags, reason: 'z02_atomic_apply_invalid_identifiers', reason_code: 'z02_atomic_apply_invalid_identifiers'}}
    expect(result).toEqual(expected); expect(f.calls.length).toBe(at)
    before.customer_operation_jobs = sorted([...before.customer_operation_jobs, expected]); expect(await f.state()).toEqual(before)
  })} finally {await f.close()}
}, 20000)
it.each(['missing', 'empty'])('preserves distinct %s request/message SQL-NULL branches', async mode => {
  const f = await setup(); try {
    await transaction(f, async () => {const p: Row = {...payload}; if (mode === 'missing') delete p.customer_info_request_id; else p.customer_info_request_id = ''; await assertRefusal(f, job({payload: p}), false, false)})
    await transaction(f, async () => {const p: Row = {...payload}; if (mode === 'missing') delete p.ediel_message_id; else p.ediel_message_id = ''; await assertRefusal(f, job({payload: p}), true, true)})
  } finally {await f.close()}
}, 20000)
it.each([['foreign', own.foreignRequest], ['missing', own.absent]])('keeps %s CIR outside the own-company refusal update/issue', async (_label, request) => {
  const f = await setup(); try {await transaction(f, () => assertRefusal(f, job({payload: {...payload, customer_info_request_id: request}}), false, false))} finally {await f.close()}
}, 20000)
it.each([true, false])('deduplicates only the same open issue message (match %s)', async match => {
  const f = await setup(); try {await transaction(f, async () => {
    await f.insert('facility_data_quality_issues', {id: own.dedup, company_id: own.company, customer_id: own.customer, customer_site_id: own.site, issue_type: refusal.code, severity: 'blocking', source: 'ediel_z02_atomic_core_apply', source_error_code: refusal.code, recommended_action: 'retained dedup action', metadata: {inbound_message_id: match ? own.message : own.absent}, created_at: '2026-10-07T00:00:00+00:00'})
    await assertRefusal(f, job(), true, !match)
  })} finally {await f.close()}
}, 20000)
it('actual watched status UPDATE runs the gate while result-only UPDATE does not', async () => {
  const f = await setup(); try {await transaction(f, async () => {
    await f.insert('customer_operation_jobs', job({result: {...flags, z02_atomic_core_applied: true}}))
    await f.q('UPDATE public.customer_operation_jobs SET result=$1 WHERE id=$2', [flags, own.target])
    expect(f.calls).toEqual([])
    const before = await f.state(), clock = (await f.q('SELECT to_jsonb(now()) clock')).rows[0].clock
    await f.q('UPDATE public.customer_operation_jobs SET status=status WHERE id=$1', [own.target])
    expect(f.calls).toEqual([tuple(job())])
    const after = await f.state(), added = after.facility_data_quality_issues.filter(r => !before.facility_data_quality_issues.some(old => old.id === r.id))
    expect(added).toHaveLength(1); expect(added[0]).toEqual(expectedIssue('blocking', added[0].id, clock))
    const expected = structuredClone(before)
    expected.customer_operation_jobs = expected.customer_operation_jobs.map(r => r.id === own.target ? expectedRefusalJob(job()) : r)
    expected.customer_info_requests = expected.customer_info_requests.map(r => r.id === own.request ? expectedCIR(r, own.request, own.message, clock) : r)
    expected.facility_data_quality_issues = sorted([...expected.facility_data_quality_issues, added[0]])
    expect(after).toEqual(expected)
  })} finally {await f.close()}
}, 20000)
it('a later differently named job CHECK rolls back real repaired CIR/issue/job effects', async () => {
  const f = await setup(); try {await transaction(f, async () => {
    await f.exec(`ALTER TABLE public.customer_operation_jobs ADD CONSTRAINT declared_late_job_failure CHECK(id<>'${own.target}'::uuid) NOT VALID`)
    const row = job(), out = await statement(f, () => f.insert('customer_operation_jobs', row), tuple(row))
    expect(out.failure).toMatchObject({code: '23514', constraint: 'declared_late_job_failure', table: 'customer_operation_jobs'})
    expect(await f.state()).toEqual(f.baseline)
  })} finally {await f.close()}
}, 20000)
it('critical remains rejected by the unchanged real issue CHECK', async () => {
  const f = await setup(); try {await transaction(f, async () => {
    const out = await statement(f, () => f.insert('facility_data_quality_issues', {company_id: own.company, customer_id: own.customer, customer_site_id: own.site, issue_type: refusal.code, severity: 'critical', source: 'declared_check_control', recommended_action: 'declared action'}))
    expect(out.failure).toMatchObject({code: '23514', constraint: 'facility_data_quality_issues_severity_check', table: 'facility_data_quality_issues'})
    expect(f.calls).toEqual([])
  })} finally {await f.close()}
}, 20000)
it('forward preserves OID/owner/full metadata/ACL/comment/attachment/core and is idempotent', async () => {
  const f = await setup(false); try {
    expect(existsSync(forward)).toBe(true)
    const before = await catalog(f), gateBefore = object(before.gate)
    expect(hash(gateBefore.prosrc)).toBe(oldHash)
    expect(await accessProbes(f)).toEqual([{rolname: 'anon', allowed: false}, {rolname: 'authenticated', allowed: false}, {rolname: 'service_role', allowed: true}])
    expect((await f.q("SELECT EXISTS(SELECT 1 FROM aclexplode((SELECT proacl FROM pg_proc WHERE oid=$1::regprocedure)) WHERE grantee=0 AND privilege_type='EXECUTE') allowed", [signature])).rows).toEqual([{allowed: false}])
    await f.exec(readFileSync(forward, 'utf8'))
    const after = await catalog(f), gateAfter = object(after.gate)
    expect(hash(gateAfter.prosrc)).toBe(newHash)
    const expected = structuredClone(before); expected.gate = {...gateBefore, prosrc: gateAfter.prosrc}
    expect(after).toEqual(expected)
    expect(await accessProbes(f)).toEqual([{rolname: 'anon', allowed: false}, {rolname: 'authenticated', allowed: false}, {rolname: 'service_role', allowed: true}])
    expect(await f.state()).toEqual(f.baseline)
    await f.exec(readFileSync(forward, 'utf8'))
    expect(await catalog(f)).toEqual(after); expect(await f.state()).toEqual(f.baseline)
  } finally {await f.close()}
}, 20000)
it.each([
  ['unknown body', 'body'], ['missing target', 'missing'], ['security invoker', 'security'], ['search path', 'config'],
  ['missing attachment', 'trigger_missing'], ['disabled attachment', 'trigger_disabled'], ['wrong watched columns', 'trigger_columns'],
] as const)('forward fails closed with unchanged rows/catalog for %s', async (_label, mutation) => {
  const f = await setup(false); try {
    if (mutation === 'body') await f.exec(originalGate.replace(originalBody, originalBody + '\n-- declared unknown body\n'))
    else if (mutation === 'missing') await f.exec(`DROP TRIGGER ${triggerName} ON public.customer_operation_jobs; DROP FUNCTION ${signature}`)
    else if (mutation === 'security') await f.exec(`ALTER FUNCTION ${signature} SECURITY INVOKER`)
    else if (mutation === 'config') await f.exec(`ALTER FUNCTION ${signature} SET search_path=pg_catalog`)
    else if (mutation === 'trigger_missing') await f.exec(`DROP TRIGGER ${triggerName} ON public.customer_operation_jobs`)
    else if (mutation === 'trigger_disabled') await f.exec(`ALTER TABLE public.customer_operation_jobs DISABLE TRIGGER ${triggerName}`)
    else await f.exec(`DROP TRIGGER ${triggerName} ON public.customer_operation_jobs; ${attachment.replace('UPDATE OF status, payload, job_type', 'UPDATE OF status')}`)
    await migrationFailure(f)
  } finally {await f.close()}
}, 20000)
