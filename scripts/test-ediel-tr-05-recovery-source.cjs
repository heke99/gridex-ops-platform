// masterplan: TR-05, AT-TR-05, SC-040
// Actual SQL owners in finite PGlite fixtures. The harnesses explicitly declare
// synthetic upstream source/admission/archive ports; native-chain proof lives
// in ediel-tr-05-recovery-native.test.ts and cannot be inferred from this gate.
const {test} = require('node:test')
const assert = require('node:assert/strict')
const {spawnSync} = require('node:child_process')
const path = require('node:path')
for (const [file, checks] of [['ediel-prodat-recovery-cursor-sql-regression.mjs',36],['ediel-prodat-recovery-phase-regression.mjs',41],['ediel-recovery-physical-negative-scope-sql-regression.mjs',94]]) {
  test(`retained actual recovery owner assertions: ${file}`,() => {
    const root = path.resolve(__dirname,'..')
    const run = spawnSync(process.execPath,[path.join(__dirname,file)],{cwd:root,encoding:'utf8',env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
    assert.ifError(run.error); assert.equal(run.status,0,run.stdout + run.stderr)
    if (file.includes('cursor')) assert.match(run.stdout,/^PASS 36 focused PostgreSQL actual transport\/recovery enqueue\/cursor\/rollback\/immutable checks;/m)
    else {
      const result = JSON.parse(run.stdout.trim())
      assert.equal(result.status,'PASS'); assert.equal(result.checks,checks)
      if (file.includes('physical')) {assert.equal(result.physicalChecks,53); assert.equal(result.baseChecks,41)}
    }
  })
}
