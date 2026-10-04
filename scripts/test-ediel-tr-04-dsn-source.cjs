// masterplan: TR-04, AT-TR-04, SC-062
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
test('actual parser and SQL owner bind encoded captured DSN fields without delivery/business authority', () => {
 const root = path.resolve(__dirname, '..')
 const run = spawnSync(process.execPath, ['--experimental-vm-modules', path.join(__dirname, 'ediel-tr-04-encoded-dsn-sql-regression.mjs')], {
  cwd: root, encoding: 'utf8', env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite'),
   EDIEL_DSN_FORWARD_MIGRATIONS: '20261004175536_ediel_dsn_encoded_source_identity.sql' },
 })
 assert.ifError(run.error); assert.equal(run.status, 0, run.stdout + run.stderr)
 assert.match(run.stdout, /^PASS \d+ TR-04 actual parser\/current qualifier\/encoded source-owner checks;/m)
})
