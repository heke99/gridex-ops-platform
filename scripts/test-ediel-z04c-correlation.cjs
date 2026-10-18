// masterplan: AT-Z04C-SUPPLIER
// node:test wrapper for the captured Z04/Z24 owner correlation regression
// (wrong LI/point/customer/start/parties, locked-original mismatch, conflicting
// periods, compensation for executed effects, role/direction/actor refusal,
// exact positive control with decoy, idempotent replay). Actual SQL component
// only; native/public-entrypoint evidence lives in the native Z04C test.
const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

test('AT-Z04C-SUPPLIER captured owner correlation SQL regression', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-z04c-correlation-sql-regression.mjs')], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite') },
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${run.stdout}\n${run.stderr}`
  assert.equal(run.status, 0, output)
  assert.match(run.stdout, /Z04C correlation own SQL: \d+ cases PASS;/, output)
  assert.doesNotMatch(run.stdout, /^FAIL /m, output)
  const result = JSON.parse(run.stdout.split('\n').find((line) => line.startsWith('EDIEL_Z04C_CORRELATION_RESULT ')).slice('EDIEL_Z04C_CORRELATION_RESULT '.length))
  assert.equal(result.failures, 0)
  for (const required of [
    'exact C cancels only the right confirmed future period and its switch; decoy untouched',
    'replay of the committed C is idempotent and changes nothing',
    'wrong LI is z04c_exact_original_unavailable with no mutation',
    'C bound to a foreign customer row is z04c_locked_original_mismatch',
    'two periods tied to the same switch are z04c_conflicting_periods',
    'confirmed period whose start has passed (not activated) requires compensation',
    'activated period requires compensation and is not cancelled',
    'wrong direction (outbound C) is refused',
    'receiver without a current supplier role is refused',
  ]) assert.ok(result.checks.includes(required), `missing case: ${required}`)
})
