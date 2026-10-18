// Mechanical SQL regression, not an issuer/native/market or live deployment proof.
// External permission, regulated-ground and legacy activation ports below are
// declared fixtures. The installed deadline functions and readiness SQL are real.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pathToFileURL } from 'node:url'

export async function verifySupplyDeadlineRuntimeRepair() {
const db = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20261018230141_restore_supply_deadline_runtime.sql', import.meta.url), 'utf8')
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
let checks = 0
const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++ }
const value = async (sql, args = []) => (await db.query(sql, args)).rows[0].value
const run = (company = id(1), actor = id(10), limit = 100) => value('select public.ediel_advance_supply_deadlines_v1($1,$2,$3) as value', [company, actor, limit])
const install = () => db.exec(migration)
const count = table => value(`select count(*)::int as value from ${table}`)

try {
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA gridex_received_sources; CREATE SCHEMA gridex_regulated_supply; CREATE SCHEMA extensions;
    CREATE TABLE public.user_profiles(id uuid PRIMARY KEY,user_status text);
    CREATE TABLE public.company_memberships(company_id uuid,user_id uuid,status text,is_active bool,accepted_at timestamptz);
    CREATE TABLE public.fixture_permissions(company_id uuid,user_id uuid,allowed bool);
    CREATE FUNCTION public.gridex_actor_has_company_permission(uuid,uuid,text) RETURNS bool LANGUAGE sql AS
      $$SELECT EXISTS(SELECT FROM public.fixture_permissions WHERE user_id=$1 AND company_id=$2 AND allowed)$$;
    CREATE TABLE public.ediel_messages(id uuid PRIMARY KEY,company_id uuid,raw_payload text,environment text);
    CREATE TABLE public.customer_supply_periods(id uuid PRIMARY KEY,company_id uuid,status text,market_end_at timestamptz,market_start_at timestamptz,
      source_end_message_id uuid,source_message_id uuid,market_state_version bigint,customer_id uuid,metering_point_id uuid,source_process text,metadata jsonb,updated_at timestamptz);
    CREATE TABLE gridex_received_sources.supply_source_transitions(source_message_id uuid,company_id uuid,payload_hash text,resulting_states jsonb);
    CREATE TABLE gridex_received_sources.regulated_supply_ground_versions(id uuid,company_id uuid,environment text,bilateral_agreement_id uuid,
      dso_actor_id uuid,legal_actor_id uuid,source_reference text,revoked_at timestamptz,valid_from timestamptz,valid_to timestamptz);
    CREATE TABLE public.tenant_bilateral_agreements(id uuid,company_id uuid,environment text,counterparty_actor_id uuid,is_enabled bool,source_reference text,valid_from timestamptz,valid_to timestamptz);
    CREATE TABLE public.tenant_actor_roles(company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
    CREATE TABLE public.tenant_ediel_profiles(company_id uuid,environment text,market text,is_enabled bool,valid_from timestamptz,valid_to timestamptz);
    CREATE TABLE gridex_received_sources.normal_switch_confirmations(period_id uuid PRIMARY KEY,company_id uuid,market_start_at timestamptz,switch_id uuid,source_message_id uuid);
    CREATE TABLE gridex_received_sources.normal_supply_activations(period_id uuid PRIMARY KEY);
    CREATE TABLE public.fixture_ground(current bool); INSERT INTO public.fixture_ground VALUES(false);
    CREATE TABLE public.fixture_locks(calls int); INSERT INTO public.fixture_locks VALUES(0);
    CREATE FUNCTION gridex_regulated_supply.lock_graph_v1() RETURNS void LANGUAGE sql AS $$UPDATE public.fixture_locks SET calls=calls+1$$;
    CREATE FUNCTION gridex_regulated_supply.ground_current_v1(uuid,uuid,uuid,timestamptz) RETURNS bool LANGUAGE sql AS $$SELECT current FROM public.fixture_ground$$;
    CREATE TABLE public.fixture_held(period_id uuid PRIMARY KEY);
    CREATE FUNCTION public.activate_customer_supply_v1(uuid,uuid,uuid,date,uuid,text) RETURNS void LANGUAGE plpgsql AS $$
    DECLARE p uuid;
    BEGIN
      IF NOT public.gridex_actor_has_company_permission($5,$1,'metering.write') OR NOT EXISTS(SELECT FROM public.company_memberships WHERE company_id=$1 AND user_id=$5 AND status='active' AND is_active AND accepted_at IS NOT NULL) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='fixture_denied'; END IF;
      SELECT period_id INTO p FROM gridex_received_sources.normal_switch_confirmations WHERE company_id=$1 AND switch_id=$2 AND source_message_id=$3;
      UPDATE public.customer_supply_periods SET status='active' WHERE id=p AND company_id=$1;
      IF EXISTS(SELECT FROM public.fixture_held WHERE period_id=p) THEN RAISE EXCEPTION 'fixture_held_after_write'; END IF;
      INSERT INTO gridex_received_sources.normal_supply_activations VALUES(p);
    END$$;
    CREATE TABLE public.supplier_switch_requests(communication_route_id uuid,ediel_route_profile_id uuid);
    CREATE TABLE public.communication_routes(id uuid); CREATE TABLE public.ediel_route_profiles(id uuid);
    CREATE TABLE public.grid_owner_information_requests(id uuid);
    CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql AS $$SELECT sha256(convert_to($1,'UTF8'))$$;
    CREATE FUNCTION public.gridex_set_grid_owner_request_idempotency_key() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM extensions.digest('fixture','sha256');RETURN NEW;END$$;
    CREATE TRIGGER trg_grid_owner_information_requests_idempotency BEFORE INSERT ON public.grid_owner_information_requests FOR EACH ROW EXECUTE FUNCTION public.gridex_set_grid_owner_request_idempotency_key();
    CREATE FUNCTION public.gridex_lock_signed_customer_contract() RETURNS void LANGUAGE sql AS $$SELECT$$;
  `)
  await db.exec(readFileSync(new URL('../supabase/migrations/20260824134340_customer_application_runtime_readiness_contract.sql', import.meta.url), 'utf8'))
  equal((await value('select public.gridex_customer_application_runtime_contract_v1() as value')).ready, true)
  await install()
  equal(await value("select to_regprocedure('public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)') is not null as value"), true)
  equal(await value("select to_regprocedure('gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)') is not null as value"), true)
  equal((await value('select public.gridex_customer_application_runtime_contract_v1() as value')).ready, true)
  equal(await value("select relrowsecurity as value from pg_class where oid='gridex_received_sources.normal_activation_sweep_cursors'::regclass"), true)
  // Canonical private schemas remain inaccessible to the service caller.
  // SECURITY INVOKER diagnostics must resolve private OIDs through catalogs.
  await db.exec('REVOKE ALL ON SCHEMA gridex_received_sources,gridex_regulated_supply FROM PUBLIC,anon,authenticated,service_role')
  equal(await value("select has_schema_privilege('service_role','gridex_received_sources','usage') as value"), false)
  equal(await value("select has_schema_privilege('service_role','gridex_regulated_supply','usage') as value"), false)
  await db.exec('SET ROLE service_role')
  try {
    equal((await value('select public.gridex_customer_application_runtime_contract_v1() as value')).ready, true)
  } finally {
    await db.exec('RESET ROLE')
  }
  for (const role of ['anon', 'authenticated']) {
    equal(await value("select has_function_privilege($1,'public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)','execute') as value", [role]), false)
  }
  equal(await value("select has_function_privilege('service_role','public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer)','execute') as value"), true)
  for (const role of ['anon', 'authenticated', 'service_role']) {
    equal(await value("select has_function_privilege($1,'gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)','execute') as value", [role]), false)
    equal(await value("select has_table_privilege($1,'gridex_received_sources.normal_activation_sweep_cursors','select,insert,update,delete,truncate') as value", [role]), false)
  }
  await install()
  equal((await value('select public.gridex_customer_application_runtime_contract_v1() as value')).ready, true)

  // Existing cursors must accept the NULL position used by INSERT(scope_key).
  // A malformed preimage must stop installation rather than fail on first use.
  await db.exec('ALTER TABLE gridex_received_sources.normal_activation_sweep_cursors ALTER COLUMN last_start SET NOT NULL')
  equal((await value('select public.gridex_customer_application_runtime_contract_v1() as value')).ready, false)
  await assert.rejects(install(), /supply_deadline_cursor_conflict/); checks++
  await db.exec('ROLLBACK;ALTER TABLE gridex_received_sources.normal_activation_sweep_cursors ALTER COLUMN last_start DROP NOT NULL;ALTER TABLE gridex_received_sources.normal_activation_sweep_cursors ALTER COLUMN last_period SET NOT NULL')
  await assert.rejects(install(), /supply_deadline_cursor_conflict/); checks++
  await db.exec('ROLLBACK;ALTER TABLE gridex_received_sources.normal_activation_sweep_cursors ALTER COLUMN last_period DROP NOT NULL;ALTER TABLE gridex_received_sources.normal_activation_sweep_cursors ALTER COLUMN last_start SET DEFAULT now()')
  equal((await value('select public.gridex_customer_application_runtime_contract_v1() as value')).ready, false)
  await assert.rejects(install(), /supply_deadline_cursor_conflict/); checks++
  await db.exec('ROLLBACK;ALTER TABLE gridex_received_sources.normal_activation_sweep_cursors ALTER COLUMN last_start DROP DEFAULT')
  await install()

  // Missing runtime cannot be hidden by a previously green readiness record.
  await db.exec('DROP FUNCTION gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)')
  const missing = await value('select public.gridex_customer_application_runtime_contract_v1() as value')
  equal(missing.ready, false)
  equal(missing.checks.supply_deadline_helper_exists, false)
  await install()
  await db.exec('GRANT EXECUTE ON FUNCTION public.ediel_advance_supply_deadlines_v1(uuid,uuid,integer) TO anon')
  const exposed = await value('select public.gridex_customer_application_runtime_contract_v1() as value')
  equal(exposed.ready, false)
  equal(exposed.checks.supply_deadline_rpc_service_only, false)
  await install()

  // No invalid actor may even create/advance an operational cursor.
  equal((await run()).updated, 0)
  equal(await count('gridex_received_sources.normal_activation_sweep_cursors'), 0)
  await db.query("INSERT INTO public.user_profiles VALUES($1,'active')", [id(10)])
  await db.query('INSERT INTO public.fixture_permissions VALUES($1,$2,true)', [id(1), id(10)])
  equal((await run()).updated, 0)
  equal(await count('gridex_received_sources.normal_activation_sweep_cursors'), 0)
  await db.query("INSERT INTO public.company_memberships VALUES($1,$2,'active',true,now())", [id(1), id(10)])
  equal((await run(id(2))).updated, 0)
  equal(await count('gridex_received_sources.normal_activation_sweep_cursors'), 0)

  // Actual helper ending effects: exact archived transition/version/hash and
  // membership/permission, bounded independently from the activation phases.
  for (const [company, source, amount] of [[id(1), id(20), 201], [id(2), id(21), 1]]) {
    await db.query("INSERT INTO public.ediel_messages VALUES($1,$2,'declared-wire','test')", [source, company])
    const states = []
    for (let n = 0; n < amount; n++) {
      const period = id(company === id(1) ? 1000 + n : 2000)
      await db.query("INSERT INTO public.customer_supply_periods(id,company_id,status,market_end_at,source_end_message_id,market_state_version) VALUES($1,$2,'ending','2000-01-01T00:00:00Z',$3,1)", [period, company, source])
      states.push({ id: period, market_state_version: 1, market_end_at: '2000-01-01T00:00:00Z' })
    }
    await db.query("INSERT INTO gridex_received_sources.supply_source_transitions VALUES($1,$2,encode(sha256(convert_to('declared-wire','UTF8')),'hex'),$3)", [source, company, JSON.stringify(states)])
  }
  equal((await run(id(1), id(10), 1)).updated, 1)
  equal((await run(id(1), id(10), 10000)).updated, 200)
  equal((await run()).updated, 0)
  equal(await value("select status as value from public.customer_supply_periods where id=$1", [id(2000)]), 'ending')
  equal(await value('select calls>0 as value from public.fixture_locks'), true)

  // Normal activation port: held work rolls its earlier write back and cannot
  // starve the next eligible own candidate or expose foreign-company effects.
  for (const [period, company, date] of [[id(3000), id(1), '2001-01-01'], [id(3001), id(1), '2001-01-02'], [id(3002), id(2), '2001-01-03']]) {
    await db.query("INSERT INTO public.customer_supply_periods(id,company_id,status) VALUES($1,$2,'confirmed_by_grid_owner')", [period, company])
    await db.query('INSERT INTO gridex_received_sources.normal_switch_confirmations VALUES($1,$2,$3,$1,$1)', [period, company, date])
  }
  await db.query('INSERT INTO public.fixture_held VALUES($1)', [id(3000)])
  equal((await run(null, id(10), 1)).normalActivated, 0)
  equal(await value('select status as value from public.customer_supply_periods where id=$1', [id(3000)]), 'confirmed_by_grid_owner')
  equal((await run(null, id(10), 1)).normalActivated, 1)
  equal(await value('select status as value from public.customer_supply_periods where id=$1', [id(3002)]), 'confirmed_by_grid_owner')
  equal(await count('gridex_received_sources.normal_supply_activations'), 1)

  // Later regulated-ground protection is exercised, not merely source-matched.
  const metadata = { sourceGroundId: id(40) }
  await db.query("INSERT INTO public.customer_supply_periods(id,company_id,status,market_start_at,source_message_id,market_state_version,customer_id,metering_point_id,source_process,metadata) VALUES($1,$2,'confirmed_by_grid_owner','2000-01-01',$3,1,$4,$5,'assigned_supply',$6)", [id(4000), id(1), id(41), id(42), id(43), JSON.stringify(metadata)])
  await db.query("INSERT INTO public.ediel_messages VALUES($1,$2,'regulated-wire','test')", [id(41), id(1)])
  const saved = { id: id(4000), market_state_version: 1, market_start_at: '2000-01-01T00:00:00Z', customer_id: id(42), metering_point_id: id(43), source_process: 'assigned_supply', metadata }
  await db.query("INSERT INTO gridex_received_sources.supply_source_transitions VALUES($1,$2,encode(sha256(convert_to('regulated-wire','UTF8')),'hex'),$3)", [id(41), id(1), JSON.stringify([saved])])
  await db.query("INSERT INTO gridex_received_sources.regulated_supply_ground_versions VALUES($1,$2,'test',$3,$4,$5,'fixture-ground',NULL,'1999-01-01',NULL)", [id(40), id(1), id(44), id(45), id(46)])
  await db.query("INSERT INTO public.tenant_bilateral_agreements VALUES($1,$2,'test',$3,true,'fixture-ground','1999-01-01',NULL)", [id(44), id(1), id(45)])
  await db.query("INSERT INTO public.tenant_actor_roles VALUES($1,'test',$2,'electricity_supplier','1999-01-01',NULL)", [id(1), id(46)])
  await db.query("INSERT INTO public.tenant_ediel_profiles VALUES($1,'test','electricity',true,'1999-01-01',NULL)", [id(1)])
  equal((await run()).updated, 0)
  equal(await value('select status as value from public.customer_supply_periods where id=$1', [id(4000)]), 'confirmed_by_grid_owner')
  await db.exec('UPDATE public.fixture_ground SET current=true')
  equal((await run()).updated, 1)
  equal(await value('select status as value from public.customer_supply_periods where id=$1', [id(4000)]), 'active')

  // A changed version or source hash cannot revive an archived ending decision.
  await db.query("UPDATE public.customer_supply_periods SET status='ending',market_state_version=2 WHERE id=$1", [id(1000)])
  equal((await run()).updated, 0)
  await db.query("UPDATE public.customer_supply_periods SET status='ending' WHERE id=$1", [id(1001)])
  await db.query("UPDATE public.ediel_messages SET raw_payload='changed-wire' WHERE id=$1", [id(20)])
  equal((await run()).updated, 0)
  equal(await value('select status as value from public.customer_supply_periods where id=$1', [id(1001)]), 'ending')
  await db.query("UPDATE public.ediel_messages SET raw_payload='declared-wire' WHERE id=$1", [id(20)])
  await db.exec("CREATE FUNCTION public.fixture_reject_end() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'ending_atomic_rollback_probe';END$$; CREATE TRIGGER fixture_reject_end BEFORE UPDATE ON public.customer_supply_periods FOR EACH ROW WHEN(OLD.status='ending') EXECUTE FUNCTION public.fixture_reject_end();")
  const cursors = await value('select jsonb_agg(to_jsonb(c) order by scope_key) as value from gridex_received_sources.normal_activation_sweep_cursors c')
  await assert.rejects(run(), /ending_atomic_rollback_probe/); checks++
  equal(await value('select status as value from public.customer_supply_periods where id=$1', [id(1001)]), 'ending')
  equal(await value('select jsonb_agg(to_jsonb(c) order by scope_key) as value from gridex_received_sources.normal_activation_sweep_cursors c'), cursors)
  await db.exec('DROP TRIGGER fixture_reject_end ON public.customer_supply_periods;DROP FUNCTION public.fixture_reject_end()')

  // A conflicting installed body must be retained and stop the whole repair.
  await db.exec("CREATE OR REPLACE FUNCTION gridex_received_sources.advance_supply_before_normal_switch_v1(p_company_id uuid,p_actor_user_id uuid,p_limit integer DEFAULT 100) RETURNS jsonb LANGUAGE sql AS $$SELECT '{\"updated\":999}'::jsonb$$")
  await assert.rejects(install(), /supply_deadline_helper_conflict/); checks++
  await db.exec('ROLLBACK')
  equal(await value("select prosrc like '%999%' as value from pg_proc where oid='gridex_received_sources.advance_supply_before_normal_switch_v1(uuid,uuid,integer)'::regprocedure"), true)
  return { status: 'PASS_MECHANICAL_SQL', checks, production_writes: 0, limits: 'Declared external permission/ground/activation ports; not native acceptance or live rollout' }
} finally {
  await db.close()
}

}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.stdout.write(JSON.stringify(await verifySupplyDeadlineRuntimeRepair()) + '\n')
}
