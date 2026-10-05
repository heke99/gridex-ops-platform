// masterplan: DB-05, AT-DB-05
// Retention-class workflows for DB-05 over the real gridex_ediel_retention SQL (PGlite mechanics):
// per-class decision + authorised actor + separate reviewer + deny, holds while supply/legal obligations exist,
// access revoke before personal-field pseudonymisation, content removal with immutable hashes/tombstones.
// Wind-down/revoke and the hard-delete guard are proven natively in scripts/db-05-*-native.test.ts
// (workflow ediel-db04-native.yml); the PGlite guard regression is __tests__/db-05-hard-delete-guard.test.ts.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.join(__dirname, '..')
const env = { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite') }
const expected = { 'ediel-retention-sql-regression.mjs': 9, 'ediel-record-retention-sql-regression.mjs': 10 }
let failed = false
for (const [script, minPass] of Object.entries(expected)) {
  const run = spawnSync(process.execPath, [path.join(__dirname, script)], { cwd: root, encoding: 'utf8', env, maxBuffer: 64 * 1024 * 1024 })
  const passes = (run.stdout || '').split('\n').filter((line) => line.startsWith('PASS ')).length
  if (run.status === 0 && passes >= minPass) console.log(`ok ${script}: ${passes} PASS`)
  else { failed = true; console.error(`not ok ${script}: exit ${run.status}, ${passes} PASS\n${(run.stdout || '').slice(-1500)}\n${(run.stderr || '').slice(-2000)}`) }
}
if (failed) process.exit(1)
