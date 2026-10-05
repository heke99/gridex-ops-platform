// masterplan: U-04, AT-U-04, U-14, AT-U-14
// Runs the focused PGlite regressions for the U-04 late-version fix and the
// U-14 received-UTILTS_ERR positive-ACK dispatcher (forward migration
// 20261003150200). Mechanics only; native replay remains the clean-replay job.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const pglite = require.resolve('@electric-sql/pglite')
const root = path.join(__dirname, '..')
let failed = 0
for (const script of ['ediel-utilts-late-version-sql-regression.mjs', 'ediel-utilts-err-ack-dispatcher-sql-regression.mjs', 'ediel-utilts-u04-u14-effects-sql-regression.mjs']) {
  const run = spawnSync(process.execPath, [path.join(__dirname, script)], { cwd: root, encoding: 'utf8', env: { ...process.env, EDIEL_PGLITE_MODULE: pglite } })
  const pass = (run.stdout || '').split('\n').find((line) => line.startsWith('PASS'))
  if (run.status === 0 && pass) console.log(`ok ${script}: ${pass}`)
  else { failed++; console.error(`not ok ${script}\n${(run.stderr || '').slice(-2000)}`) }
}
if (failed) process.exit(1)
