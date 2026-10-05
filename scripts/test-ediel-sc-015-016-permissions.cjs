// masterplan: SC-015, SC-016
// Runs actual current SQL owners over declared finite dependency ports.
// This wrapper is neither native clean replay nor authentic legal acceptance.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { test } = require('node:test')
const root = path.join(__dirname, '..')

for (const [scenario, file, marker] of [
  ['SC015 pending other mission and same/new objects', 'ediel-sc-015-pending-request-sql-regression.mjs', 'SC015 pending request current SQL:'],
  ['SC016 partial approved objects and exact grant publication', 'ediel-sc-016-approved-object-sql-regression.mjs', 'SC016 approved-object current SQL:'],
]) {
  test(scenario, () => {
    const run = spawnSync(process.execPath, [path.join(__dirname, file)], {
      cwd: root, encoding: 'utf8', timeout: 180000,
      env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite'), EDIEL_SQL_REPOSITORY: root },
    })
    assert.ifError(run.error)
    assert.equal(run.signal, null, 'a signal or timeout proves no scenario')
    assert.equal(run.status, 0, (run.stdout || '').slice(-2500) + (run.stderr || '').slice(-2500))
    assert.ok((run.stdout || '').split('\n').some(line => line.startsWith(marker) && line.includes(' PASS;')), 'actual SQL asserting case summary required')
    console.log((run.stdout || '').split('\n').filter(line => line.startsWith(marker)).join('\n'))
  })
}
