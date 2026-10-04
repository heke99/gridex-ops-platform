// masterplan: TR-02, AT-TR-02
const {test}=require('node:test')
const assert=require('node:assert/strict')
const {spawnSync}=require('node:child_process')
const path=require('node:path')
test('real retained SMTP ledger preserves 250/450/550/timeout evidence and immutable attempts',()=>{
 const root=path.resolve(__dirname,'..')
 const run=spawnSync(process.execPath,[path.join(__dirname,'ediel-tr-02-smtp-ledger-sql-regression.mjs')],{cwd:root,encoding:'utf8',env:{...process.env,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
 assert.equal(run.status,0,run.stdout+run.stderr)
 assert.match(run.stdout,/TR-02 retained SMTP ledger: 5 checks PASS/)
})
for(const [file,expected] of [
 ['ediel-accepted-projection-sql-regression.mjs',/targeted accepted projection PostgreSQL checks/],
 ['ediel-atomic-accepted-source-sql-regression.mjs',/atomic accepted-source PostgreSQL checks/],
])test('SMTP acceptance preserves separate delivery/ACK/business authority: '+file,()=>{
 const root=path.resolve(__dirname,'..')
 const run=spawnSync(process.execPath,[path.join(__dirname,file)],{cwd:root,encoding:'utf8',env:{...process.env,EDIEL_SQL_REPOSITORY:root,EDIEL_PGLITE_MODULE:require.resolve('@electric-sql/pglite')}})
 assert.equal(run.status,0,run.stdout+run.stderr)
 assert.match(run.stdout,expected)
})
