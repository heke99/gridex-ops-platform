// Optional, single-connection WASM PostgreSQL diagnostic. Native replay and
// concurrent sessions remain independent mandatory release gates.
import { createRequire } from 'node:module'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

if (process.env.GRIDEX_STAFF_SQL_DIAGNOSTIC !== '1') throw new Error('Explicit diagnostic mode is required')
const modulePath = process.env.GRIDEX_STAFF_PGLITE_MODULE
if (!modulePath || !modulePath.startsWith('/workspace/scratch/') || !modulePath.endsWith('/dist/index.js')) throw new Error('Expected the local diagnostic PostgreSQL WASM module')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { buildStaffFixture } = require('./lib/staff-sql-fixture.cjs')
const { PGlite } = await import(pathToFileURL(modulePath).href)
const database = new PGlite()
const migrations = readdirSync(resolve(root, 'supabase/migrations')).filter(name => /^20261003\d{6}_staff_[a-z0-9_]+\.sql$/.test(name)).sort()
if (migrations.length < 8) throw new Error('Expected all eight implemented staff schema, policy, command and machine authentication migrations')
let phase = 'source_fixture'
try {
  await database.exec(buildStaffFixture(root, { wasm: true }))
  for (const name of migrations) {
    phase = name
    const sql = readFileSync(resolve(root, 'supabase/migrations', name), 'utf8')
    if (!sql.trim()) throw new Error(`Migration is not implemented: ${name}`)
    await database.exec(sql)
  }
  const tests = readFileSync(resolve(root, 'scripts/staff-api-sql-regression.sql'), 'utf8')
  phase = 'sql_behavior_regression'
  await database.exec(tests)
  phase = 'machine_auth_behavior_regression'
  await database.exec(readFileSync(resolve(root, 'scripts/staff-api-machine-auth-regression.sql'), 'utf8'))
  const { rows } = await database.query('select version() as engine')
  process.stdout.write(JSON.stringify({ status: 'passed', engine: rows[0].engine, migrations, mode: 'single_connection_wasm_diagnostic', full_native_replay: false, provider_storage_verified: false }) + '\n')
} catch (error) {
  process.stderr.write(JSON.stringify({ status: 'failed', phase, code: error.code ?? null, message: error.message, context: error.where ?? null }) + '\n')
  process.exitCode = 1
} finally {
  await database.close()
}
