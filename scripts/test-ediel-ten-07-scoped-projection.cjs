// masterplan: TEN-07, AT-TEN-07, ESCO-10, AT-ESCO-10, ESCO-11, AT-ESCO-11, SC-008, SC-017
// Run the actual scoped SQL consumer assertions in the regular tagged-test gate.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { test } = require('node:test')

test('TEN-07 limits each beneficiary to granted objects, periods and fields while preserving owner originals', () => {
  const root = path.resolve(__dirname, '..')
  const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-ten-07-scoped-projection-sql-regression.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, EDIEL_SQL_REPOSITORY: root, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite') },
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, `${run.stdout || ''}\n${run.stderr || ''}`)
  assert.match(run.stdout, /^PASS 17 TEN-07 scoped-object\/window\/field\/raw-owner effects;/m)
})

test('TEN-07 keeps full MIME copies behind the original owner boundary', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-transport-copy-sql-regression.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite') },
  })
  assert.ifError(run.error)
  assert.equal(run.status, 0, `${run.stdout || ''}\n${run.stderr || ''}`)
  assert.match(run.stdout, /^PASS 14 targeted transport copy checks;/m)
})
