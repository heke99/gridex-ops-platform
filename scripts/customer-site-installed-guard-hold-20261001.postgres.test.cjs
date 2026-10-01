// Actual native callback source acquisition + PostgreSQL compilation in a
// temporary HOLD-shaped checkout. This is PostgreSQL-core, not Supabase native.
const assert = require('node:assert/strict')
const { readFileSync, mkdtempSync, mkdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { resolve, join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { test } = require('node:test')
const ts = require('typescript')
const { PGlite } = require('@electric-sql/pglite')
const root = resolve(__dirname, '..')
const source = readFileSync(join(root, 'scripts/customer-site-continuation-20260930.native.test.ts'), 'utf8')
const schema = readFileSync(join(root, 'supabase/schema.sql'), 'utf8')
const migration = readFileSync(join(root, 'supabase/migrations/20260930192831_customer_site_registry_atomic_command.sql'), 'utf8')
const start = migration.indexOf('create function public.gridex_save_customer_site_v1(p_command jsonb)')
const end = migration.indexOf('$function$;', start)
assert.ok(start >= 0 && end > start)
const definition = migration.slice(start, end + '$function$;'.length)
function table(name) {
  const found = schema.match(new RegExp(`CREATE TABLE public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0]
  assert.ok(found, `actual rowtype absent: ${name}`)
  return found
}
test('actual installed whole site function and native five-case guard work while all migration paths are HOLD absent', async () => {
  const db = new PGlite(), dir = mkdtempSync(join(tmpdir(), 'gridex-site-hold-'))
  try {
    mkdirSync(join(dir, 'scripts')); mkdirSync(join(dir, 'supabase/migrations'), { recursive: true })
    const normalizerStart = schema.indexOf('CREATE FUNCTION public.gridex_normalize_facility_id(')
    const normalizer = schema.slice(normalizerStart, schema.indexOf('$$;', normalizerStart) + 3)
    const referenceStart = schema.indexOf('CREATE FUNCTION public.gridex_new_public_resource_reference(')
    const reference = schema.slice(referenceStart, schema.indexOf('$$;', referenceStart) + 3)
    await db.exec(`${normalizer}\n${reference}\n${table('customer_sites')}\n${table('canonical_command_results')}\n${definition}`)
    const installed = (await db.query("SELECT pg_get_functiondef('public.gridex_save_customer_site_v1(jsonb)'::regprocedure) AS definition")).rows[0].definition
    assert.match(installed, /FUNCTION public\.gridex_save_customer_site_v1\(p_command jsonb\)/)
    // Execute the exact checked-in native callback up to its synchronous psql
    // boundary; then execute that exact constructed SQL with real PostgreSQL.
    // No canned successful SQL result is returned by this harness.
    const marker = "it('compiles the literal production candidate guard and preserves complete/incomplete postal validation', () => {"
    const from = source.indexOf(marker), until = source.indexOf('\n  })\n\n  it.each', from)
    assert.ok(from >= 0 && until > from)
    const callback = source.slice(from + marker.length, until).replaceAll('import.meta.url', JSON.stringify(pathToFileURL(join(dir, 'scripts/native.test.ts')).href))
    const compiled = ts.transpileModule(`function runProbe() { ${callback} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const captured = new Error('native_probe_sql_captured')
    let statement
    const sql = query => {
      if (query.includes('pg_get_functiondef')) {
        assert.match(query, /'public\.gridex_save_customer_site_v1\(jsonb\)'::regprocedure/)
        return installed
      }
      statement = query; throw captured
    }
    const expect = value => ({ toBeGreaterThan: minimum => assert.ok(value > minimum) })
    const quote = value => `'${value.replaceAll("'", "''")}'`
    const run = new Function('readFileSync', 'sql', 'expect', 'quote', `${compiled}\nreturn runProbe;`)(readFileSync, sql, expect, quote)
    assert.throws(run, error => error === captured)
    assert.ok(statement, 'native callback must construct actual parser SQL')
    const result = await db.exec(statement)
    assert.deepEqual(result.at(-1).rows[0].jsonb_build_array, [true, true, true, true, true])
    assert.equal((await db.query("SELECT pg_get_functiondef('public.gridex_save_customer_site_v1(jsonb)'::regprocedure) AS definition")).rows[0].definition, installed)
  } finally { await db.close(); rmSync(dir, { recursive: true, force: true }) }
})
