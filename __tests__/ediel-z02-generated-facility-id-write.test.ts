// customer_sites.normalized_facility_id is GENERATED ALWAYS. Assigning it
// raises 428C9, which rolled back every positive Z02 apply at job_insert and
// facility-lookup completion. The forward migration replaces the two writers
// with their current definitions minus that assignment only.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const MIGRATION = 'supabase/migrations/20261012190000_ediel_z02_generated_facility_id_write.sql'
const FUNCTIONS = [
  'gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1(',
  'public.gridex_complete_facility_response(',
]
const ASSIGNMENT = /\n[ \t]*normalized_facility_id[ \t]*=[ \t]*coalesce\(v_facility_id,[ \t]*normalized_facility_id\),[ \t]*(?=\n)/

function body(sql: string, prefix: string, signature: string): string {
  const start = sql.indexOf(`${prefix} ${signature}`)
  expect(start, `${prefix} ${signature}`).toBeGreaterThanOrEqual(0)
  return sql.slice(start + prefix.length, sql.indexOf('\n$$;\n', start) + 4)
}

describe('Z02 generated facility id write (428C9)', () => {
  it('PostgreSQL rejects an explicit assignment to the generated column but derives it from facility_id', async () => {
    const db = new PGlite()
    await db.exec(`CREATE TABLE customer_sites (id int PRIMARY KEY, facility_id text,
      normalized_facility_id text GENERATED ALWAYS AS (upper(btrim(facility_id))) STORED);
      INSERT INTO customer_sites(id, facility_id) VALUES (1, NULL);`)
    await expect(db.exec(`UPDATE customer_sites SET facility_id = ' 735abc ',
      normalized_facility_id = coalesce(' 735abc ', normalized_facility_id) WHERE id = 1`))
      .rejects.toMatchObject({ code: '428C9' })
    await db.exec(`UPDATE customer_sites SET facility_id = ' 735abc ' WHERE id = 1`)
    expect((await db.query('SELECT normalized_facility_id n FROM customer_sites')).rows).toEqual([{ n: '735ABC' }])
    await db.close()
  })

  it('replaces both current writers verbatim except for the single generated-column assignment', () => {
    const schema = readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
    const migration = readFileSync(path.join(root, MIGRATION), 'utf8')
    for (const signature of FUNCTIONS) {
      const current = body(schema, 'CREATE FUNCTION', signature)
      const replaced = body(migration, 'CREATE OR REPLACE FUNCTION', signature)
      expect(ASSIGNMENT.test(current), `current ${signature} still assigns`).toBe(true)
      expect(ASSIGNMENT.test(replaced), `migration ${signature} assigns`).toBe(false)
      expect(replaced).toBe(current.replace(ASSIGNMENT, ''))
      expect(replaced).toMatch(/\bset facility_id\s*=\s*coalesce\(v_facility_id,\s*facility_id\)/i)
    }
  })
})
