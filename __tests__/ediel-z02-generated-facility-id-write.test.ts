// customer_sites.normalized_facility_id and customer_sites.is_active are
// GENERATED ALWAYS. Assigning them raises 428C9, which rolled back every
// positive Z02 apply at job_insert, facility-lookup completion and site
// creation. The forward migration replaces the three writers with their
// current definitions minus those writes only.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const MIGRATION = 'supabase/migrations/20261012190000_ediel_z02_generated_facility_id_write.sql'
const ASSIGNMENT = /\n[ \t]*normalized_facility_id[ \t]*=[ \t]*coalesce\(v_facility_id,[ \t]*normalized_facility_id\),[ \t]*(?=\n)/

function dropSiteInsertIsActive(body: string): string {
  const lines = body.split('\n')
  const insert = lines.findIndex((l) => l.includes('insert into public.customer_sites'))
  const column = lines.findIndex((l, i) => i > insert && l.trim() === 'is_active,')
  const values = lines.findIndex((l, i) => i > insert && /^\s*\) values \($/.test(l))
  const offset = column - insert - 1
  expect(insert >= 0 && column > insert && values > column).toBe(true)
  expect(lines[values + 1 + offset].trim()).toBe('true,')
  return lines.filter((_, i) => i !== column && i !== values + 1 + offset).join('\n')
}

const FUNCTIONS: Array<{ signature: string; fix: (body: string) => string }> = [
  { signature: 'gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1(', fix: (b) => b.replace(ASSIGNMENT, '') },
  { signature: 'public.gridex_complete_facility_response(', fix: (b) => b.replace(ASSIGNMENT, '') },
  { signature: 'public.gridex_create_customer_site_with_address(', fix: dropSiteInsertIsActive },
]

function body(sql: string, prefix: string, signature: string): string {
  const start = sql.indexOf(`${prefix} ${signature}`)
  expect(start, `${prefix} ${signature}`).toBeGreaterThanOrEqual(0)
  const as = sql.indexOf('AS $', start)
  // Close on this body's own dollar-quote tag ($$ or $_$), not the next function's.
  const tag = sql.slice(as + 3, sql.indexOf('$', as + 4) + 1)
  const end = sql.indexOf(`\n${tag};\n`, as + 3 + tag.length)
  expect(end, `${signature} body end`).toBeGreaterThan(as)
  return sql.slice(start + prefix.length, end + tag.length + 3)
}

describe('Z02 generated customer_sites column writes (428C9)', () => {
  it('PostgreSQL rejects explicit writes to generated columns but derives them from facility_id/status', async () => {
    const db = new PGlite()
    await db.exec(`CREATE TABLE customer_sites (id int PRIMARY KEY, facility_id text, status text,
      normalized_facility_id text GENERATED ALWAYS AS (upper(btrim(facility_id))) STORED,
      is_active boolean GENERATED ALWAYS AS (coalesce(status, 'draft') <> ALL (ARRAY['inactive','closed'])) STORED);
      INSERT INTO customer_sites(id, facility_id) VALUES (1, NULL);`)
    await expect(db.exec(`UPDATE customer_sites SET facility_id = ' 735abc ',
      normalized_facility_id = coalesce(' 735abc ', normalized_facility_id) WHERE id = 1`)).rejects.toMatchObject({ code: '428C9' })
    await expect(db.exec(`INSERT INTO customer_sites(id, status, is_active) VALUES (2, 'draft', true)`)).rejects.toMatchObject({ code: '428C9' })
    await db.exec(`UPDATE customer_sites SET facility_id = ' 735abc ' WHERE id = 1; INSERT INTO customer_sites(id, status) VALUES (2, 'draft')`)
    expect((await db.query('SELECT normalized_facility_id n, is_active a FROM customer_sites ORDER BY id')).rows)
      .toEqual([{ n: '735ABC', a: true }, { n: null, a: true }])
    await db.close()
  })

  it('replaces the three writers with their definitions minus only the generated-column writes', () => {
    const schema = readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8')
    const migration = readFileSync(path.join(root, MIGRATION), 'utf8')
    // Only the three replacements: a plain CREATE of an existing function fails native replay.
    expect(migration.match(/^CREATE\b.*$/gm)).toEqual(FUNCTIONS.map(({ signature }) => expect.stringContaining(`CREATE OR REPLACE FUNCTION ${signature}`)))
    for (const { signature, fix } of FUNCTIONS) {
      const current = body(schema, 'CREATE FUNCTION', signature)
      const replaced = body(migration, 'CREATE OR REPLACE FUNCTION', signature)
      expect(ASSIGNMENT.test(replaced), `migration ${signature} assigns normalized_facility_id`).toBe(false)
      // Before GEN, schema.sql holds the old body; after C2's re-capture it holds the fixed one.
      expect(replaced === current || replaced === fix(current), `${signature} drift`).toBe(true)
      const insert = replaced.indexOf('insert into public.customer_sites')
      if (insert >= 0) expect(replaced.slice(insert, replaced.indexOf(') values (', insert))).not.toMatch(/\bis_active\b/)
    }
  })
})
