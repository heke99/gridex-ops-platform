// masterplan: ESCO-04, AT-ESCO-04, ESCO-07, AT-ESCO-07
// Runs the focused PGlite scoped-approval / separate V-VH termination
// regression over the real permission executor (20261001044351).
// Mechanics only; native replay remains the clean-replay job.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.join(__dirname, '..')
const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-esco-04-07-permission-sql-regression.mjs')], {
  cwd: root, encoding: 'utf8', env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite') },
})
const pass = (run.stdout || '').split('\n').find((line) => line.startsWith('ESCO-04/ESCO-07 permission SQL:'))
if (run.status === 0 && pass) console.log(`ok ${pass}`)
else { console.error(`not ok\n${(run.stdout || '').slice(-1500)}\n${(run.stderr || '').slice(-2000)}`); process.exit(1) }
