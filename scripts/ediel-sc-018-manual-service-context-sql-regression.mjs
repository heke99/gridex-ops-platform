// Actual current manual/context/coordinator/resolver owners, with the unchanged
// existing manual harness bootstrap. Named current timing/assessment/source and
// actor-permission ports are finite. Supplied active DDQ rows are not canonical
// supply receipts, and this check proves no authentic issuer/market approval.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

if (!process.env.EDIEL_PGLITE_MODULE) throw new Error('EDIEL_PGLITE_MODULE required')
const { PGlite } = await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href)
const db = new PGlite()
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
const fixture = readFileSync(new URL('./ediel-service-manual-sql-regression.mjs', import.meta.url), 'utf8')
const start = ' await db.exec(`CREATE ROLE anon;'
const end = '`)' + '\n await db.exec(definition('
assert.equal(fixture.split(start).length, 2)
assert.equal(fixture.split(end).length, 2)
const bootstrap = fixture.slice(fixture.indexOf(start) + ' await db.exec(`'.length, fixture.indexOf(end))

function definition(name) {
  const marker = `CREATE FUNCTION ${name}(`
  assert.equal(schema.split(marker).length, 2, `unique current owner ${name}`)
  const at = schema.indexOf(marker)
  return schema.slice(at, schema.indexOf('$$;', schema.indexOf('$$', at)) + 3)
}
function table(name) {
  const marker = `CREATE TABLE ${name} (`
  assert.equal(schema.split(marker).length, 2, `unique current table ${name}`)
  const at = schema.indexOf(marker)
  return schema.slice(at, schema.indexOf('\n);', at) + 3)
}
const owners = [
  'gridex_service_administration.scope_v1',
  'gridex_service_administration.permission_matches_assignment_v1',
  'gridex_service_administration.permission_originals_for_tuple_v1',
  'gridex_service_administration.require_manual_actor_v1',
  'gridex_service_administration.manual_hold_v1',
  'gridex_service_administration.coordinate_before_manual_resolution_v1',
  'gridex_service_administration.coordinate_before_source_timing_v1',
  'public.ediel_coordinate_service_permission_v1',
  'public.ediel_resolve_service_permission_command_v1',
  'public.ediel_service_permission_manual_context_v1',
]
let checks = 0
async function check(name, run) { await run(); checks++; console.log(`PASS ${name}`) }
async function manual(selection, { company = uid(1), actor = uid(2), customer = uid(3) } = {}) {
  await db.exec('SET ROLE service_role')
  try { return (await db.query('SELECT public.ediel_service_permission_manual_context_v1($1,$2,$3,$4) result', [company, actor, customer, selection])).rows[0].result }
  finally { await db.exec('RESET ROLE') }
}
const stableTables = [
  'public.ediel_service_assignments', 'public.metering_permissions', 'public.metering_permission_sites',
  'public.ediel_assignment_permission_links', 'public.ediel_data_access_grants',
  'public.ediel_messages', 'public.outbound_requests', 'gridex_service_permission.origins',
  'gridex_service_administration.permission_request_owners', 'gridex_service_permission.request_timing_receipts',
  'public.supplier_contracts', 'public.grid_owner_data_requests', 'public.ediel_outbox',
]
async function snapshot(tables = stableTables) {
  const result = {}
  for (const name of tables) result[name] = (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) rows FROM ${name} t`)).rows[0].rows
  return result
}
const effects = () => snapshot([...stableTables, 'gridex_service_administration.manual_permission_requests', 'public.customer_operation_tasks'])

try {
  await db.exec(bootstrap)
  for (const name of ['gridex_service_administration.manual_permission_requests', 'gridex_service_administration.permission_request_owners']) await db.exec(table(name))
  await db.exec(`CREATE TABLE gridex_service_permission.request_timing_receipts(company_id uuid,assignment_id uuid,scope_basis_version bigint,permission_id uuid,scope jsonb,proof jsonb,request_day date);
    CREATE TABLE public.supplier_contracts(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,status text,legal_role text,gsrn text,metadata jsonb);
    CREATE TABLE public.grid_owner_data_requests(id uuid PRIMARY KEY,company_id uuid,customer_id uuid,request_scope text,status text);
    CREATE TABLE public.ediel_outbox(id uuid PRIMARY KEY,company_id uuid,message_id uuid,status text);
    CREATE TABLE public.current_timing_source_fixture(allowed boolean);INSERT INTO public.current_timing_source_fixture VALUES(false);
    CREATE FUNCTION gridex_service_permission.lock_request_writer_v1() RETURNS void LANGUAGE sql AS $$SELECT NULL::void$$;
    CREATE FUNCTION gridex_service_permission.current_request_timing_v1(c uuid,aid uuid,actor uuid,version bigint,recorded boolean) RETURNS jsonb LANGUAGE sql AS $$
      SELECT CASE WHEN allowed THEN jsonb_build_object('status','authorized','requestDay',current_date,'scope','{}'::jsonb,'proof',jsonb_build_object('scopeBasisVersion',1))
        ELSE jsonb_build_object('status','held','missing',ARRAY['finite_current_ESCO_source_evidence_missing']) END FROM public.current_timing_source_fixture$$;
    CREATE FUNCTION gridex_service_permission.resolve_before_request_timing_v1(uuid,uuid,uuid,bigint,uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'unexpected_retained_resolver_entry';END$$;`)
  for (const name of owners) {
    const sql = definition(name)
    await db.exec(sql)
    const body = sql.slice(sql.indexOf('$$') + 2, sql.lastIndexOf('$$')).trim()
    const installed = (await db.query('SELECT prosrc FROM pg_proc WHERE oid=$1::regprocedure', [sql.slice('CREATE FUNCTION '.length, sql.indexOf(')') + 1).replace(/\b(p_[a-z_]+|c|customer|actor|selection|missing|a|p)\s+/g, '')])).rows[0].prosrc.trim()
    assert.equal(installed, body, `installed body exactly current committed owner ${name}`)
    console.log(`CURRENT ${name} ${createHash('sha256').update(body).digest('hex')}`)
  }
  await db.exec(`INSERT INTO companies VALUES('${uid(1)}','Own provider'),('${uid(90)}','Foreign sentinel');
    INSERT INTO customers VALUES('${uid(3)}','${uid(1)}'),('${uid(91)}','${uid(90)}');
    INSERT INTO auth.users VALUES('${uid(2)}');INSERT INTO user_profiles VALUES('${uid(2)}','active');
    INSERT INTO company_memberships VALUES('${uid(1)}','${uid(2)}','active',true,now());
    INSERT INTO ediel_service_assignments VALUES('${uid(4)}','${uid(1)}','${uid(90)}','${uid(5)}','${uid(20)}','${uid(3)}','${uid(6)}','test','V','held',7,1,'independent ESCO service',ARRAY['point-a'],ARRAY['8716867000030'],ARRAY['quantity'],'2026-01-01','2030-01-01','2000-01-01',null);
    INSERT INTO assignment_authority_fixture VALUES('${uid(4)}',false);
    INSERT INTO supplier_contracts VALUES('${uid(50)}','${uid(1)}','${uid(3)}','active','DDQ','point-a','{"suppliedUpstreamFact":true,"ESCOAuthority":false}'),('${uid(51)}','${uid(90)}','${uid(91)}','active','DDQ','point-a','{"foreignSentinel":true}');
    INSERT INTO metering_permissions(id,company_id,customer_id,status,metadata) VALUES('${uid(92)}','${uid(90)}','${uid(91)}','active','{"foreignSentinel":true}');
    INSERT INTO metering_permission_sites VALUES('${uid(93)}','${uid(90)}','${uid(92)}','${uid(91)}','point-a','active','{"foreignSentinel":true}',now(),NULL,NULL);
    INSERT INTO ediel_data_access_grants VALUES('${uid(90)}','${uid(94)}','active',NULL);
    INSERT INTO grid_owner_data_requests VALUES('${uid(95)}','${uid(90)}','${uid(91)}','metering_access','sent');
    INSERT INTO ediel_outbox VALUES('${uid(96)}','${uid(90)}','${uid(97)}','sent');`)
  const baseline = await snapshot()
  const selection = { code: 'Z13' }
  let first
  await check('active supplied DDQ without explicit ESCO assignment produces held source request and investigation only', async () => {
    first = await manual(selection)
    assert.equal(first.status, 'held'); assert.deepEqual(first.missing, ['explicit_source_assignment_required'])
    assert.deepEqual(await snapshot(), baseline)
    const request = (await db.query('SELECT to_jsonb(r) row FROM gridex_service_administration.manual_permission_requests r')).rows[0].row
    const task = (await db.query('SELECT to_jsonb(t) row FROM public.customer_operation_tasks t')).rows[0].row
    assert.equal(request.id, first.requestId); assert.equal(request.company_id, uid(1)); assert.equal(request.customer_id, uid(3)); assert.equal(request.actor_user_id, uid(2)); assert.deepEqual(request.selection, selection); assert.deepEqual(request.missing, first.missing); assert.equal(request.task_id, task.id)
    assert.equal(task.company_id, uid(1)); assert.equal(task.customer_id, uid(3)); assert.equal(task.task_type, 'ediel_service_permission_source_held'); assert.equal(task.status, 'open'); assert.equal(task.priority, 'high'); assert.equal(task.assigned_to, uid(2)); assert.equal(task.created_by, uid(2)); assert.equal(task.updated_by, uid(2))
    assert.match(task.description, /aktuellt tjänsteuppdrag och styrkt behörighetsunderlag/)
    assert.deepEqual(task.metadata, { serviceCommandRequestId: request.id, selection, missing: first.missing, marketActivationGranted: false })
    assert.equal((await db.query("SELECT count(*)::int n FROM public.metering_permissions WHERE company_id=$1", [uid(1)])).rows[0].n, 0)
    assert.equal((await db.query("SELECT count(*)::int n FROM public.ediel_data_access_grants WHERE company_id=$1", [uid(1)])).rows[0].n, 0)
  })
  await check('same manual replay returns original request/task with all table values unchanged and no insert attempt', async () => {
    const before = await effects()
    await db.exec(`CREATE FUNCTION public.sc018_no_replay_insert() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'unexpected_manual_replay_insert';END$$;
      CREATE TRIGGER sc018_no_replay_request BEFORE INSERT ON gridex_service_administration.manual_permission_requests FOR EACH ROW EXECUTE FUNCTION public.sc018_no_replay_insert();
      CREATE TRIGGER sc018_no_replay_task BEFORE INSERT ON public.customer_operation_tasks FOR EACH ROW EXECUTE FUNCTION public.sc018_no_replay_insert();`)
    assert.deepEqual(await manual(selection), first); assert.deepEqual(await effects(), before)
    await db.exec('DROP TRIGGER sc018_no_replay_request ON gridex_service_administration.manual_permission_requests;DROP TRIGGER sc018_no_replay_task ON public.customer_operation_tasks')
  })
  await check('explicit current assignment with missing timing/source authority remains held without DGI permission or grant', async () => {
    const result = await manual({ code: 'Z13', assignmentId: uid(4), expectedVersion: 7 })
    assert.equal(result.status, 'held'); assert.deepEqual(result.missing, ['finite_current_ESCO_source_evidence_missing']); assert.deepEqual(await snapshot(), baseline)
  })
  await check('timing supplied but missing service assessment still follows the real coordinator into held investigation', async () => {
    await db.exec('UPDATE public.current_timing_source_fixture SET allowed=true')
    const result = await manual({ code: 'Z13', assignmentId: uid(4), expectedVersion: 7 })
    assert.equal(result.status, 'held'); assert.deepEqual(result.missing, ['synthetic_missing_approval']); assert.deepEqual(await snapshot(), baseline)
    await db.exec('UPDATE public.current_timing_source_fixture SET allowed=false')
  })
  await check('active supply and form-grant injection cannot become selection authority', async () => {
    const before = await effects()
    await assert.rejects(manual({ code: 'Z13', activeSupply: true, accessGranted: true }), /selection_invalid/)
    assert.deepEqual(await effects(), before)
  })
  await check('current actor permission revocation denies before any source request or task mutation', async () => {
    await db.exec("UPDATE permission_fixture SET allowed=false WHERE permission='metering.write'")
    const before = await effects(); await assert.rejects(manual(selection), /manual_actor_forbidden/); assert.deepEqual(await effects(), before)
    await db.exec("UPDATE permission_fixture SET allowed=true WHERE permission='metering.write'")
  })
  await check('foreign customer and source assignment fail without cross-tenant mutations', async () => {
    const before = await effects()
    await assert.rejects(manual(selection, { customer: uid(91) }), /customer_not_owned/)
    await assert.rejects(manual({ code: 'Z13', assignmentId: uid(94), expectedVersion: 1 }), /assignment_not_owned/)
    assert.deepEqual(await effects(), before)
  })
  await check('missing explicit source version is held and cannot make active DDQ an ESCO grant', async () => {
    const result = await manual({ code: 'Z13', assignmentId: uid(4) })
    assert.equal(result.status, 'held'); assert.deepEqual(result.missing, ['explicit_assignment_version_required']); assert.deepEqual(await snapshot(), baseline)
  })
  await check('task failure atomically rolls back the source request without changing rights, supply or traffic', async () => {
    await db.exec(`CREATE FUNCTION public.sc018_task_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'finite_task_storage_failure';END$$;CREATE TRIGGER sc018_task_failure BEFORE INSERT ON public.customer_operation_tasks FOR EACH ROW EXECUTE FUNCTION public.sc018_task_failure()`)
    const before = await effects(); await assert.rejects(manual({ code: 'Z13', mode: 'VH' }), /finite_task_storage_failure/); assert.deepEqual(await effects(), before)
  })
  console.log(`SC-018 current manual service SQL: ${checks} PASS; finite current source/actor/supply inputs, not native/canonical supply/market approval`)
} finally { await db.close() }
