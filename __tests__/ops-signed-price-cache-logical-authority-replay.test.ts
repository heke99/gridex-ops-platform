// Isolated PostgreSQL snapshot component; native replay remains a separate gate.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

type Authority = Record<string, unknown>

function snapshotQueries(path: string) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const queries = [...source.matchAll(/ SELECT jsonb_build_object\([\s\S]*?\) INTO v_authority_(before|after);/g)]
    .map(match => match[0]
      .replace(/ INTO v_authority_(before|after);$/, ' AS authority;')
      .replace(/\bv_oid\b/g, '$1'))
  if (queries.length !== 2) throw Error(`expected both authority snapshots in ${path}`)
  return queries
}

const canonical = snapshotQueries('../supabase/migrations/20261015100259_ops_api_signed_contract_price_cache_binding_guard_alignment.sql')
const replay = snapshotQueries('../supabase/bootstrap/20261015_ops_signed_price_cache_logical_authority_replay.sql')
let db: PGlite
let targetOid: number

async function authorities(queries: string[]) {
  return Promise.all(queries.map(async query =>
    (await db.query<{ authority: Authority }>(query, [targetOid])).rows[0].authority))
}

async function target() {
  return (await db.query<{ row: Record<string, unknown>; definition: string }>(
    'SELECT to_jsonb(p) AS row, pg_get_functiondef(p.oid) AS definition FROM pg_catalog.pg_proc p WHERE p.oid=$1',
    [targetOid],
  )).rows[0]
}

describe('signed-price-cache replay authority snapshots', () => {
  beforeAll(async () => {
    db = new PGlite()
    // Synthetic surrounding objects exercise the actual source SELECTs. This
    // does not execute the product trigger or emulate its native executor role.
    await db.exec(`
      CREATE ROLE snapshot_owner NOLOGIN;
      CREATE ROLE snapshot_reader NOLOGIN;
      CREATE TABLE public.snapshot_probe(id integer PRIMARY KEY, value text);
      INSERT INTO public.snapshot_probe SELECT n, repeat('x', 80) FROM generate_series(1, 20) AS n;
      CREATE FUNCTION public.snapshot_target() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;
      CREATE FUNCTION public.snapshot_other() RETURNS integer LANGUAGE sql AS $$SELECT 1$$;
    `)
    targetOid = (await db.query<{ oid: number }>(
      "SELECT 'public.snapshot_target()'::regprocedure::oid AS oid",
    )).rows[0].oid
  })
  afterAll(async () => { await db.close() })

  it('reproduces the canonical ANALYZE false positive while both replay snapshots preserve logical authority', async () => {
    const beforeCanonical = await authorities(canonical)
    const beforeReplay = await authorities(replay)
    const beforeTarget = await target()

    await db.exec('ANALYZE public.snapshot_probe')

    const afterCanonical = await authorities(canonical)
    const afterReplay = await authorities(replay)
    for (let index = 0; index < canonical.length; index++) {
      expect(afterCanonical[index]).not.toEqual(beforeCanonical[index])
      expect(Object.keys(beforeCanonical[index]).filter(key =>
        JSON.stringify(beforeCanonical[index][key]) !== JSON.stringify(afterCanonical[index][key]),
      )).toEqual(['relations'])
      expect(afterReplay[index]).toEqual(beforeReplay[index])
    }
    expect(await target()).toEqual(beforeTarget)
  })

  it.each([
    ['relation owner', 'ALTER TABLE public.snapshot_probe OWNER TO snapshot_owner'],
    ['relation ACL', 'GRANT SELECT ON public.snapshot_probe TO snapshot_reader'],
    ['relation RLS', 'ALTER TABLE public.snapshot_probe ENABLE ROW LEVEL SECURITY'],
    ['other function body', 'CREATE OR REPLACE FUNCTION public.snapshot_other() RETURNS integer LANGUAGE sql AS $$SELECT 2$$'],
  ])('still detects %s changes and restores the snapshot after rollback', async (_name, mutation) => {
    const before = await authorities(replay)
    const beforeTarget = await target()
    await db.exec('BEGIN')
    try {
      await db.exec(mutation)
      const after = await authorities(replay)
      for (let index = 0; index < replay.length; index++) {
        expect(after[index]).not.toEqual(before[index])
      }
    } finally {
      await db.exec('ROLLBACK')
    }
    expect(await authorities(replay)).toEqual(before)
    expect(await target()).toEqual(beforeTarget)
  })
})
