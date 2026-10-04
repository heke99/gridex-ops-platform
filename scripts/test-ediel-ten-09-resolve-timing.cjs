// masterplan: TEN-09, AT-TEN-09
// Runs the focused PGlite regression for the request-timing gate on the public
// explicit-permission resolver (20261004120000) over the real coordinator.
// Mechanics only; native replay remains the clean-replay job.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.join(__dirname, '..')
const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-ten-09-resolve-timing-sql-regression.mjs')], {
  cwd: root, encoding: 'utf8',
  env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite'), EDIEL_SQL_REPOSITORY: root },
})
const pass = (run.stdout || '').split('\n').find((line) => line.startsWith('TEN-09 resolver request timing SQL:'))
if (run.status === 0 && pass) console.log(`ok ${pass}`)
else { console.error(`not ok\n${(run.stdout || '').slice(-1500)}\n${(run.stderr || '').slice(-2000)}`); process.exit(1) }
