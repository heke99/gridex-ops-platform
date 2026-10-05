// masterplan: P-10, AT-P-10
// Runs the focused PGlite Z02 correlation regression over the real
// gridex_apply_exact_z02_core (20260930164947) and Z02 decoder.
// Mechanics only; native replay remains the clean-replay job.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const root = path.join(__dirname, '..')
const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-p-10-z02-correlation-sql-regression.mjs')], {
  cwd: root, encoding: 'utf8', env: { ...process.env, PGLITE_MODULE_URL: pathToFileURL(require.resolve('@electric-sql/pglite')).href },
})
const pass = (run.stdout || '').split('\n').find((line) => line.startsWith('P-10 Z02 correlation SQL:'))
if (run.status === 0 && pass) console.log(`ok ${pass}`)
else { console.error(`not ok\n${(run.stdout || '').slice(-1500)}\n${(run.stderr || '').slice(-2000)}`); process.exit(1) }
