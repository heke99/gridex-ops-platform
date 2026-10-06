import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { buildDb04Fixture, assertDb04Measurement, sqlLiteral, type Db04Explain } from './helpers/ediel-db04-query-fixture'

/** Native PostgreSQL, full installed production schema and all birth/capture
 * guards. These inbound originals and request metadata remain unqualified.
 * No accepted ACK/business facts, values, dispatch, private owners, disabled
 * trigger or modified planner setting is created. Every row is rolled back.
 * The unit companion executes db.ts readers via an explicit SQL transport;
 * this suite measures their same SQL selections, not PostgREST/RLS behavior. */
it('measures current queue/SLA and selective/opposing object/version/FK workloads on the full native schema', () => {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const fixture = buildDb04Fixture(randomUUID(), randomUUID(), randomUUID())
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const queryObject = Object.entries(fixture.queries).map(([name, query]) =>
    `${sqlLiteral(name)},jsonb_build_object('plan',pg_temp.db04_plan(${sqlLiteral(query.sql)}),'rows',pg_temp.db04_rows(${sqlLiteral(query.sql)}))`).join(',')
  const ownScope = `company_id IN(${sqlLiteral(fixture.first)}::uuid,${sqlLiteral(fixture.second)}::uuid)`
  const ackIds = fixture.ackStates.map(row => sqlLiteral(row.id) + '::uuid').join(',')
  const output = execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input: `BEGIN;
      SET LOCAL statement_timeout='90s';
      ${fixture.seedSql}
      ${fixture.forbiddenParentsSql}
      CREATE FUNCTION pg_temp.db04_plan(query text) RETURNS jsonb LANGUAGE plpgsql AS $plan$
        DECLARE result jsonb; BEGIN EXECUTE 'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '||query INTO result; RETURN result->0; END $plan$;
      CREATE FUNCTION pg_temp.db04_rows(query text) RETURNS jsonb LANGUAGE plpgsql AS $rows$
        DECLARE result jsonb; BEGIN EXECUTE $q$SELECT coalesce(jsonb_agg(CASE WHEN to_jsonb(r)?'id'
          THEN jsonb_build_object('id',to_jsonb(r)->'id') ELSE to_jsonb(r) END),'[]'::jsonb) FROM ($q$||query||') r'
          INTO result; RETURN result; END $rows$;
      SELECT jsonb_build_object(
        'transactionNow',now(),
        'queries',jsonb_build_object(${queryObject}),
        'oppositionControls',jsonb_build_array(${fixture.oppositionControls.map(control => `pg_temp.db04_rows(${sqlLiteral(control.sql)})`).join(',')}),
        'ackStates',(SELECT jsonb_agg(jsonb_build_object('id',id,'canonical_ack_state',canonical_ack_state)) FROM public.ediel_message_ack_state_v WHERE id IN(${ackIds})),
        'slaMonitor',jsonb_build_object('plan',pg_temp.db04_plan(${sqlLiteral(fixture.slaMonitorSql)}),'rows',pg_temp.db04_rows(${sqlLiteral(fixture.slaMonitorSql)})),
        'slaCount',jsonb_build_object('plan',pg_temp.db04_plan(${sqlLiteral(fixture.slaCountSql)}),'rows',pg_temp.db04_rows(${sqlLiteral(fixture.slaCountSql)})),
        'originalRows',(SELECT count(*) FROM public.ediel_messages WHERE ${ownScope}),
        'capturedOriginals',(SELECT count(*) FROM gridex_received_sources.sources WHERE ${ownScope}),
        'requestMetadataRows',(SELECT count(*) FROM public.meter_reading_series WHERE ${ownScope} AND series_kind='request'),
        'measurementValues',(SELECT count(*) FROM public.meter_reading_values WHERE ${ownScope}),
        'objectAssessments',(SELECT count(*) FROM gridex_received_sources.object_assessments WHERE ${ownScope}),
        'validationAssessments',(SELECT count(*) FROM gridex_received_sources.validation_assessments WHERE ${ownScope}),
        'dispatchAttempts',(SELECT count(*) FROM gridex_ediel_transport.attempts WHERE ${ownScope}),
        'outboxRows',(SELECT count(*) FROM public.ediel_outbox WHERE ${ownScope}),
        'triggers',(SELECT jsonb_object_agg(tgrelid::regclass::text||'.'||tgname,tgenabled) FROM pg_trigger
          WHERE tgrelid IN('public.ediel_messages'::regclass,'public.meter_reading_series'::regclass) AND NOT tgisinternal));
      ROLLBACK;`, encoding: 'utf8', timeout: 120_000, maxBuffer: 4_000_000,
  }).trim()
  type Observation = { plan: Db04Explain; rows: Array<{ id: string; n?: number }> }
  const evidence = JSON.parse(output) as {
    queries: Record<keyof typeof fixture.queries, Observation>; oppositionControls: Array<Array<{ id: string }>>
    ackStates: typeof fixture.ackStates; slaMonitor: Observation; slaCount: Observation
    originalRows: number; capturedOriginals: number; requestMetadataRows: number; measurementValues: number
    objectAssessments: number; validationAssessments: number; dispatchAttempts: number; outboxRows: number; triggers: Record<string, string>
  }
  // Log the measured result even when an assertion refuses it. Source hashes
  // identify authored inputs in addition to HEAD, which may predate local edits.
  const inputPaths = ['supabase/schema.sql', 'lib/ediel/db.ts', 'lib/ediel/operations/ackSlaMonitor.ts',
    'lib/ediel/operations/controlTower.ts', 'scripts/helpers/ediel-db04-query-fixture.ts',
    '__tests__/ediel-db-04-query-consumers.test.ts', 'scripts/ediel-db04-current-consumers-native.test.ts']
  console.log(JSON.stringify({ kind: 'ediel_db04_current_consumers_native', head, observedAt: new Date().toISOString(),
    inputHashes: Object.fromEntries(inputPaths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')])),
    dataset: { synthetic: true, originalRows: fixture.originalRows, requestMetadataRows: fixture.seriesRows, companies: 2,
      qualifiedSources: false, acceptedMeasurements: false, acceptedAckAuthority: false, deadlineMetadataOnly: true,
      frozenTransactionClock: true, fullNativeSchema: true, postgrestOrRlsProof: false },
    budgetMs: 500, sql: fixture.queries, slaMonitorSql: fixture.slaMonitorSql, slaCountSql: fixture.slaCountSql, ...evidence }))
  expect(evidence.originalRows).toBe(fixture.originalRows)
  expect(evidence.capturedOriginals).toBe(fixture.originalRows)
  expect(evidence.requestMetadataRows).toBe(fixture.seriesRows)
  for (const key of ['measurementValues', 'objectAssessments', 'validationAssessments', 'dispatchAttempts', 'outboxRows'] as const) expect(evidence[key], key).toBe(0)
  expect(Object.values(evidence.triggers).every(state => state === 'O' || state === 'A')).toBe(true)
  for (const name of ['meter_reading_series_tenant_guard', 'meter_reading_series_immutable_guard']) {
    expect(Object.keys(evidence.triggers).some(key => key.endsWith('.' + name))).toBe(true)
  }
  for (const [name, query] of Object.entries(fixture.queries)) {
    const observed = evidence.queries[name as keyof typeof fixture.queries]
    expect(observed.rows.map(row => row.id), name).toEqual(query.ids)
    assertDb04Measurement(observed.plan, query.ids.length, 500)
  }
  evidence.oppositionControls.forEach((rows, i) => expect(rows.map(row => row.id)).toEqual(fixture.oppositionControls[i].ids))
  expect(evidence.ackStates.sort((a, b) => a.id.localeCompare(b.id))).toEqual([...fixture.ackStates].sort((a, b) => a.id.localeCompare(b.id)))
  expect(evidence.slaMonitor.rows.map(row => row.id).sort()).toEqual([...fixture.expected.sla].sort())
  assertDb04Measurement(evidence.slaMonitor.plan, 2, 500)
  expect(evidence.slaCount.rows).toEqual([{ n: 2 }])
  assertDb04Measurement(evidence.slaCount.plan, 1, 500)
  expect(() => assertDb04Measurement(evidence.queries.reference.plan, 1, 0)).toThrow('db04_measured_budget_exceeded')
}, 120_000)
