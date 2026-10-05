// masterplan: P-08, AT-P-08
// Runs the focused PGlite regression for the P-08 Z09D acknowledgement confirmation.
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const root = path.join(__dirname, '..')
const run = spawnSync(process.execPath, [path.join(__dirname, 'ediel-p-08-production-contract-confirmation-sql-regression.mjs')], {
  cwd: root, encoding: 'utf8',
  env: { ...process.env, EDIEL_PGLITE_MODULE: require.resolve('@electric-sql/pglite'), EDIEL_SQL_REPOSITORY: root },
})
const pass = (run.stdout || '').split('\n').find((line) => line.startsWith('P-08 production contract confirmation SQL:'))
if (run.status === 0 && pass) console.log(`ok ${pass}`)
else { console.error(`not ok\n${(run.stdout || '').slice(-1500)}\n${(run.stderr || '').slice(-2000)}`); process.exit(1) }
