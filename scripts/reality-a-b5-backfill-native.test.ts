// reality-defects: A-B5
// Owner decision 42 (2026-10-28): fill a missing metering_points.grid_owner_ediel_id only from the bound, verified and
// valid grid owner of the same tenant; conflicts, ambiguity and history go to review; explicit values are never
// overwritten; every fill has before/after image, source and its e035 fact; received originals are not touched.
//
// Native proof on the owned local Supabase inside ONE transaction that is always rolled back. Fixtures are made in
// replica mode (ordinary triggers off; the e035 capture is ENABLE ALWAYS and still records), then the backfill function
// runs normally for exactly the six fixture points. The world never changes.
// Run: set -a; . /tmp/gridex-reality/app.env; set +a; GRIDEX_NATIVE_STATUS=/tmp/gridex-reality/status.json
//   npx vitest run -c scripts/reality-a-b5-backfill-native.config.ts
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const DB = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const MIGRATION = resolve(__dirname, '../supabase/migrations/20261028140000_a_b5_grid_owner_ediel_id_backfill.sql')

function psql<T>(statement: string): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', [DB, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: statement, encoding: 'utf8', stdio: 'pipe', timeout: 60_000 }).trim()
  return (out ? JSON.parse(out.split('\n').at(-1)!) : undefined) as T
}
// The world-wide run at the end of the migration is left out here; the test runs the function for its own points.
const migrationBody = readFileSync(MIGRATION, 'utf8').replace(/^begin;$/m, '').replace(/^commit;$/m, '')
  .replace(/^select \* from gridex_backfill\.a_b5_grid_owner_ediel_id_v1\('a_b5_20261028'\);$/m, '')

type Row = { k: string; value: string | null; outcome: string | null; reason: string | null; before: string | null; after: string | null; fact: boolean; fact_new: string | null; issues: number }
type Result = { first: { filled: number; review: number }; second: { filled: number; review: number }; rows: Row[]; foreign_facts: number }

it('fills only from the bound verified owner of the same tenant; everything else goes to review; one-time', () => {
  const result = psql<Result>(`BEGIN;
  SELECT to_regprocedure('gridex_backfill.a_b5_grid_owner_ediel_id_v1(text,uuid[])') IS NULL AS apply \\gset
  \\if :apply
  ${migrationBody}
  \\endif
  CREATE TEMP TABLE ab5(k text primary key, id uuid) ON COMMIT DROP;
  -- A tenant with six points, and three owners recast for the test.
  INSERT INTO ab5 SELECT 'company', m.company_id FROM public.metering_points m GROUP BY m.company_id HAVING count(*) >= 6 ORDER BY m.company_id LIMIT 1;
  INSERT INTO ab5 SELECT 'other_company', c.id FROM public.companies c WHERE c.id <> (SELECT id FROM ab5 WHERE k='company') ORDER BY c.id LIMIT 1;
  INSERT INTO ab5 SELECT k, id FROM (SELECT unnest(ARRAY['V','U','O']) k, unnest((SELECT array_agg(id ORDER BY id) FROM (SELECT id FROM public.grid_owners ORDER BY id LIMIT 3) g)) id) s;
  INSERT INTO ab5 SELECT 'p'||row_number() OVER (ORDER BY m.id), m.id FROM public.metering_points m WHERE m.company_id=(SELECT id FROM ab5 WHERE k='company') ORDER BY m.id LIMIT 6;
  SET LOCAL session_replication_role = replica;
  UPDATE public.grid_owners g SET company_id=(SELECT id FROM ab5 WHERE k = CASE WHEN g.id=(SELECT id FROM ab5 WHERE k='O') THEN 'other_company' ELSE 'company' END),
    is_active=true, lifecycle_status='active', excluded_from_electricity_scope=false, manual_review_required=false, duplicate_count=1,
    actor_registry_status=CASE WHEN g.id=(SELECT id FROM ab5 WHERE k='U') THEN 'under_review' ELSE 'verified' END,
    ediel_id=CASE g.id WHEN (SELECT id FROM ab5 WHERE k='V') THEN '98765' WHEN (SELECT id FROM ab5 WHERE k='U') THEN '98764' ELSE '98763' END
   WHERE g.id IN (SELECT id FROM ab5 WHERE k IN ('V','U','O'));
  INSERT INTO public.platform_grid_areas(grid_area_code, grid_owner_id, source, is_active, metadata) VALUES ('A5T', (SELECT id FROM ab5 WHERE k='U'), 'reality-a-b5-test', true, '{}');
  UPDATE public.metering_points m SET grid_owner_ediel_id=CASE WHEN m.id=(SELECT id FROM ab5 WHERE k='p2') THEN '55555' END,
    archived_at=CASE WHEN m.id=(SELECT id FROM ab5 WHERE k='p6') THEN now() END, closed_at=null, end_date=null,
    grid_area_code=CASE WHEN m.id=(SELECT id FROM ab5 WHERE k='p5') THEN 'A5T' END,
    grid_owner_id=(SELECT id FROM ab5 WHERE k=CASE m.id WHEN (SELECT id FROM ab5 WHERE k='p3') THEN 'U' WHEN (SELECT id FROM ab5 WHERE k='p4') THEN 'O' ELSE 'V' END)
   WHERE m.id IN (SELECT id FROM ab5 WHERE k LIKE 'p%');
  SET LOCAL session_replication_role = origin;
  SELECT coalesce(max(id),0) AS fact0 FROM gridex_correction_process.facts \\gset
  CREATE TEMP TABLE ab5r(k text primary key, v jsonb) ON COMMIT DROP;
  INSERT INTO ab5r SELECT 'first', to_jsonb(r) FROM gridex_backfill.a_b5_grid_owner_ediel_id_v1('a_b5_test', (SELECT array_agg(id) FROM ab5 WHERE k LIKE 'p%')) r;
  INSERT INTO ab5r SELECT 'second', to_jsonb(r) FROM gridex_backfill.a_b5_grid_owner_ediel_id_v1('a_b5_test', (SELECT array_agg(id) FROM ab5 WHERE k LIKE 'p%')) r;
  SELECT jsonb_build_object(
    'first', (SELECT v FROM ab5r WHERE k='first'), 'second', (SELECT v FROM ab5r WHERE k='second'),
    'foreign_facts', (SELECT count(*) FROM gridex_correction_process.facts f WHERE f.id > :fact0 AND f.table_name <> 'metering_points'),
    'rows', (SELECT jsonb_agg(jsonb_build_object('k', a.k, 'value', m.grid_owner_ediel_id, 'outcome', b.outcome, 'reason', b.reason,
        'before', b.before_value, 'after', b.after_value, 'fact', f.id IS NOT NULL, 'fact_new', f.new_fact->>'grid_owner_ediel_id',
        'issues', (SELECT count(*) FROM public.data_quality_issues q WHERE q.entity_id=a.id AND q.source='a_b5_grid_owner_ediel_backfill' AND q.status='open'))
      ORDER BY a.k)
      FROM ab5 a JOIN public.metering_points m ON m.id=a.id
      LEFT JOIN gridex_backfill.grid_owner_ediel_id_v1 b ON b.metering_point_id=a.id AND b.run_key='a_b5_test'
      LEFT JOIN gridex_correction_process.facts f ON f.id=b.e035_fact_id
     WHERE a.k LIKE 'p%'));
  ROLLBACK;`)
  const byKey = Object.fromEntries(result.rows.map((row) => [row.k, row]))
  expect(result.first).toEqual({ filled: 1, review: 4 })
  // p1: bound, verified, same tenant -> filled, with before/after image and its e035 fact.
  expect(byKey.p1).toMatchObject({ value: '98765', outcome: 'filled', reason: 'bound_verified_grid_owner', before: null, after: '98765', fact: true, fact_new: '98765', issues: 0 })
  // p2: an explicit value is never overwritten, not even selected.
  expect(byKey.p2).toMatchObject({ value: '55555', outcome: null, issues: 0 })
  // p3-p6: unverified identity, another tenant's owner, a grid-area conflict and a historical point go to review.
  expect(byKey.p3).toMatchObject({ value: null, outcome: 'review', reason: 'grid_owner_identity_unverified', fact: false, issues: 1 })
  expect(byKey.p4).toMatchObject({ value: null, outcome: 'review', reason: 'grid_owner_other_tenant', issues: 1 })
  expect(byKey.p5).toMatchObject({ value: null, outcome: 'review', reason: 'grid_area_owner_conflict', issues: 1 })
  expect(byKey.p6).toMatchObject({ value: null, outcome: 'review', reason: 'historical_metering_point', issues: 1 })
  // One-time: a repeated run does nothing and raises no second issue; only metering_points were written.
  expect(result.second).toEqual({ filled: 0, review: 0 })
  expect(result.foreign_facts).toBe(0)
})
