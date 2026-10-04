// masterplan: ESCO-08, AT-ESCO-08, ESCO-09, AT-ESCO-09
// Runs the focused PGlite shared-permission termination and grant re-evaluation regression over the real
// service administration, positive-ACK service scope and grant-set SQL.
// Mechanics only; native replay remains the clean-replay job.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.join(__dirname, '..')
const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-esco-08-09-shared-permission-sql-regression.mjs')], {
  cwd: root, encoding: 'utf8',
  env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite'), EDIEL_SQL_REPOSITORY: root },
})
const pass = (run.stdout || '').split('\n').find((line) => line.startsWith('ESCO-08/ESCO-09 shared permission SQL:'))
if (run.status === 0 && pass) console.log(`ok ${pass}`)
else { console.error(`not ok\n${(run.stdout || '').slice(-1500)}\n${(run.stderr || '').slice(-2000)}`); process.exit(1) }
