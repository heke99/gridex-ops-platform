// masterplan: P-11, AT-P-11
// Runs the focused PGlite Z04 ordering regression over the real normal-switch
// Z04 confirmation apply and supply activation SQL (20260930201111).
// Mechanics only; native replay remains the clean-replay job.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.join(__dirname, '..')
const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-p-11-z04-order-sql-regression.mjs')], {
  cwd: root, encoding: 'utf8',
  env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite'), EDIEL_SQL_REPOSITORY: root },
})
const pass = (run.stdout || '').split('\n').find((line) => line.startsWith('P-11 Z04 ordering SQL:'))
if (run.status === 0 && pass) console.log(`ok ${pass}`)
else { console.error(`not ok\n${(run.stdout || '').slice(-1500)}\n${(run.stderr || '').slice(-2000)}`); process.exit(1) }
