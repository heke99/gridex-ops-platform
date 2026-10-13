// customer_sites.normalized_facility_id and customer_sites.is_active are
// GENERATED ALWAYS. Assigning them raises 428C9, which rolled back every
// positive Z02 apply at job_insert, facility-lookup completion and site
// creation. The forward migration replaces the three writers with their
// current definitions minus those writes only.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const MIGRATION = 'supabase/migrations/20261012190000_ediel_z02_generated_facility_id_write.sql'
const FOLLOWUP = 'supabase/migrations/20261012231000_ediel_z02_original_grid_refusal.sql'
const CORE = 'gridex_received_sources.gridex_apply_exact_z02_core_before_current_source_v1('
const CORE_BEFORE = 'aefd46d0c8e38ae7a2451da307f430f9379bcccc20e7da48c1df1ad7b94ed27a'
const CORE_AFTER = 'b0f3c17dd3fc013bdad0c1ab5d8f67a71bdd2fbbd4cfc502a1b0c051e4d9de74'
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
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

// The subsequent guarded forward adds only original-grid refusal and the
// proven Z01 relation. Reverse exactly those two reviewed patches so this
// earlier generated-column invariant still compares every other byte.
function beforeReviewedCoreForward(current: string, signature: string): string {
  if (signature !== CORE || !existsSync(path.join(root, FOLLOWUP))) return current
  const source = current.match(/AS (\$[^$]*\$)([\s\S]*?)\1;/)?.[2]
  expect(source, 'current core source').toBeDefined()
  if (sha256(source!) !== CORE_AFTER) return current
  const followup = readFileSync(path.join(root, FOLLOWUP), 'utf8')
  const patchValue = (name: string) => {
    const value = followup.match(new RegExp(`v_${name} constant text := \\$patch\\$([\\s\\S]*?)\\$patch\\$;`))?.[1]
    expect(value, `reviewed ${name}`).toBeDefined()
    return value!
  }
  let prior = source!
  for (const kind of ['grid', 'link']) {
    const patch = patchValue(`${kind}_patch`), original = patchValue(`${kind}_anchor`)
    expect(prior.split(patch), `exactly one ${kind} patch`).toHaveLength(2)
    prior = prior.replace(patch, original)
  }
  expect(sha256(prior), 'all other core source bytes preserved').toBe(CORE_BEFORE)
  return current.replace(source!, prior)
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
    // Replay runs each file in its own psql session; an uncommitted BEGIN rolls back on close.
    const statements = migration.replace(/^--.*$/gm, '').trim()
    expect(statements.startsWith('BEGIN;') && statements.endsWith('\nCOMMIT;'), 'one committed transaction').toBe(true)
    expect(migration.match(/^(BEGIN|COMMIT);$/gm)).toEqual(['BEGIN;', 'COMMIT;'])
    expect(migration.match(/^CREATE\b.*$/gm)).toEqual(FUNCTIONS.map(({ signature }) => expect.stringContaining(`CREATE OR REPLACE FUNCTION ${signature}`)))
    for (const { signature, fix } of FUNCTIONS) {
      const current = beforeReviewedCoreForward(body(schema, 'CREATE FUNCTION', signature), signature)
      const replaced = body(migration, 'CREATE OR REPLACE FUNCTION', signature)
      expect(ASSIGNMENT.test(replaced), `migration ${signature} assigns normalized_facility_id`).toBe(false)
      // Before GEN the old source may remain; authentic GEN may also contain
      // the separately reviewed forward, whose only two patches are reversed above.
      expect(replaced === current || replaced === fix(current), `${signature} drift`).toBe(true)
      const insert = replaced.indexOf('insert into public.customer_sites')
      if (insert >= 0) expect(replaced.slice(insert, replaced.indexOf(') values (', insert))).not.toMatch(/\bis_active\b/)
    }
  })
})
