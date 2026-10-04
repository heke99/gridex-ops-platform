// masterplan: TEN-08, AT-TEN-08, TEN-10, AT-TEN-10
// masterplan: TEN-12, AT-TEN-12
// Runs the focused PGlite grant fan-out/revocation regression over the real
// service administration, positive-ACK service scope and grant-set SQL.
// Mechanics only; native replay remains the clean-replay job.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.join(__dirname, '..')
const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-ten-08-10-grant-sql-regression.mjs')], {
  cwd: root, encoding: 'utf8',
  env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite'), EDIEL_SQL_REPOSITORY: root },
})
const pass = (run.stdout || '').split('\n').find((line) => line.startsWith('TEN-08/TEN-10 grant SQL:'))
if (run.status === 0 && pass) console.log(`ok ${pass}`)
else { console.error(`not ok\n${(run.stdout || '').slice(-1500)}\n${(run.stderr || '').slice(-2000)}`); process.exit(1) }
