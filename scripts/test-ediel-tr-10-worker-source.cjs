// masterplan: TR-10, AT-TR-10, SC-063
// Finite actual PostgreSQL journal owner proof. The retained harness declares
// its upstream actor/archive/source probe fixtures; actual queue/worker/lease
// and external SMTP execution is mandatory in the native recovery-chain file.
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {spawnSync} = require('node:child_process')
const path = require('node:path')
test('actual journal entry, immutable observation, unsafe-release and worker-fence assertions',() => {
  const run = spawnSync(process.execPath,[path.join(__dirname,'ediel-transport-journal-sql-regression.mjs')],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
  assert.ifError(run.error); assert.equal(run.status,0,run.stdout + run.stderr)
  assert.match(run.stdout,/^PASS \d+ targeted PostgreSQL transport journal checks; synthetic fixture, source-owner probe stub; not native\/replay or authentic DSN evidence/m)
})
for (const [file,checks] of [['ediel-worker-lease-sql-regression.mjs',55],['ediel-sealed-worker-lease-sql-regression.mjs',13]]) {
  test(`actual current lease prepare/entry and late-observation behavior: ${file}`,() => {
    const run=spawnSync(process.execPath,[path.join(__dirname,file)],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
    assert.ifError(run.error);assert.equal(run.status,0,run.stdout+run.stderr)
    const receipt=JSON.parse(run.stdout.trim())
    assert.equal(receipt.status,'PASS');assert.equal(receipt.checks,checks)
  })
}
