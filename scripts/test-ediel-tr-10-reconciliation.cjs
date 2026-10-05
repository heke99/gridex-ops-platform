// masterplan: TR-10, AT-TR-10, SC-063
// Actual SQL owners; declared finite upstream source/auth/archive boundaries.
const {test}=require('node:test'), assert=require('node:assert/strict')
const {spawnSync}=require('node:child_process'), path=require('node:path')
test('automatic unknown tracking, qualified crash entry, immutable history and scoped projection',()=>{
  const run=spawnSync(process.execPath,[path.join(__dirname,'ediel-tr-10-reconciliation-sql-regression.mjs')],{
    cwd:path.resolve(__dirname,'..'),encoding:'utf8',env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite'),EDIEL_RECONCILIATION_FORWARD:'20261004204835_ediel_unknown_transport_reconciliation_cases.sql'}})
  assert.ifError(run.error); assert.equal(run.status,0,run.stdout+run.stderr)
  assert.match(run.stdout,/^PASS \d+ actual reconciliation SQL checks; declared finite upstream ports, native pending/m)
})
