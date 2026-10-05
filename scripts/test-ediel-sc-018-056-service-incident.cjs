// masterplan: SC-018
// Current manual SQL owner effects. The coupled public action and SC-056
// incident API assertions are in the separately tagged ordinary Vitest suite;
// qualified genuine incident native evidence is recorded in the audit receipt.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.join(__dirname, '..')
const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-sc-018-manual-service-context-sql-regression.mjs')], {
  cwd: root, encoding: 'utf8',
  env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite') },
})
const proof = (run.stdout || '').split('\n').find(line => line.startsWith('SC-018 current manual service SQL:'))
if (run.status === 0 && proof) console.log(`ok ${proof}`)
else { console.error(`not ok ${run.error?.message || run.signal || run.status}\n${(run.stdout || '').slice(-1800)}\n${(run.stderr || '').slice(-2400)}`); process.exit(1) }
