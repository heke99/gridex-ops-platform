// masterplan: TEN-08, AT-TEN-08, TEN-10, AT-TEN-10
// Extends the grant-set consumer chain (service administration -> positive ACK
// service scope -> grant set) with the TEN-08 fan-out and TEN-10 revocation
// effects. Same finite synthetic source/storage fixtures; PGlite mechanics,
// not native replay or legal approval.
// Run: EDIEL_PGLITE_MODULE=<pglite> EDIEL_SQL_REPOSITORY=<repo root> node scripts/ediel-ten-08-10-grant-sql-regression.mjs
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const original=readFileSync(new URL('./ediel-service-grant-set-sql-regression.mjs',import.meta.url),'utf8')
const marker=" console.log('Grant-set forward SQL: '"
assert.equal(original.split(marker).length,2)
// Injected into nested String.raw templates: no backticks or template placeholders.
const extension=String.raw`
 let tenChecks=0
 const tenCheck=async fn=>{await fn();tenChecks++}
 let inTx=false
 const readOnly=async fn=>{if(!inTx)return fn();await db.exec('SAVEPOINT ten_read');try{await fn()}finally{await db.exec('ROLLBACK TO SAVEPOINT ten_read')}}
 const grantVersion=async id=>Number((await db.query('SELECT version FROM ediel_data_access_grants WHERE id=$1',[id])).rows[0].version)
 const tenPage=(beneficiary,grantId,version,purpose,requested)=>db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) p',[beneficiary,uid(20),grantId,version,purpose,uid(211),requested,'2026-01-01','2026-02-01'])
 // A third active tenant shares the platform and the GSRN but holds no grant.
 await db.exec("INSERT INTO companies VALUES('"+uid(4)+"','active');INSERT INTO company_memberships VALUES('"+uid(4)+"','"+uid(20)+"','active',true,now())")
 await db.query("INSERT INTO meter_reading_values VALUES($1,$2,$3,'2026-01-03',18.500,'KWH','56','220')",[uid(640),uid(1),uid(211)])
 const ackHash=raw=>db.query("SELECT projection FROM gridex_ediel_ack_replay.positive_service_scope_receipts WHERE ack_raw_hash=encode(sha256(convert_to($1,'UTF8')),'hex')",[raw])

 // TEN-08: one market reception/ACK, then one internal scope per valid grant.
 await tenCheck(async()=>{const rows=(await ackHash(raw2)).rows;assert.equal(rows.length,1,'one market ACK receipt')
  const scopes=rows[0].projection.transactions[0].scopes
  assert.deepEqual(scopes.map(s=>s.grant.id).sort(),[grant.grantId,grant2.grantId].sort())
  assert.deepEqual(scopes.map(s=>[s.assignment.beneficiary_company_id,s.assignment.purpose]).sort(),[[uid(2),'analysis'],[uid(3),'quality-monitoring']].sort())})
 // Prohibited: no copy to a tenant only because it shares the GSRN/platform.
 await tenCheck(async()=>{const rows=(await ackHash(raw2)).rows;assert.ok(!JSON.stringify(rows).includes(uid(4)))
  for(const g of [grant.grantId,grant2.grantId])await readOnly(()=>assert.rejects(tenPage(uid(4),g,2,'analysis',['quantity']),/beneficiary_forbidden|no rows/))})
 // Each grant distributes only its own purpose and fields.
 await tenCheck(async()=>{assert.deepEqual((await tenPage(uid(2),grant.grantId,2,'analysis',['quantity'])).rows[0].p.rows.map(r=>r.quantity).sort(),['17.250','18.500'])
  assert.deepEqual((await tenPage(uid(3),grant2.grantId,2,'quality-monitoring',['quality'])).rows[0].p.rows,[{quality:'56'},{quality:'56'}])
  await readOnly(()=>assert.rejects(tenPage(uid(2),grant.grantId,2,'quality-monitoring',['quantity']),/./))})

 // Time interval is part of the grant scope: a period outside the grant is refused.
 await tenCheck(()=>readOnly(()=>assert.rejects(db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) p',[uid(2),uid(20),grant.grantId,2,'analysis',uid(211),['quantity'],'2025-01-01','2025-02-01']),/outside_grant|series_outside_grant/)))

 // TEN-10: internal revocation is its own event, checked against the current grant version.
 await db.exec('BEGIN');inTx=true
 try {
  const historyBefore=Number((await db.query("SELECT count(*) n FROM ediel_service_history WHERE entity_id=$1",[grant2.grantId])).rows[0].n)
  await db.query("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id=$1",[grant2.grantId])
  const revokedVersion=await grantVersion(grant2.grantId)
  await tenCheck(async()=>{assert.equal(revokedVersion,3)
   await readOnly(()=>assert.rejects(tenPage(uid(3),grant2.grantId,revokedVersion,'quality-monitoring',['quality']),/grant_not_current/))
   await readOnly(()=>assert.rejects(tenPage(uid(3),grant2.grantId,2,'quality-monitoring',['quality']),/grant_not_current/))})
  // Other beneficiaries on the same market permission keep their access.
  await tenCheck(async()=>{assert.equal((await tenPage(uid(2),grant.grantId,2,'analysis',['quantity'])).rows[0].p.rows.length,2)})
  // History/audit is retained, not deleted.
  await tenCheck(async()=>{const after=Number((await db.query("SELECT count(*) n FROM ediel_service_history WHERE entity_id=$1",[grant2.grantId])).rows[0].n)
   assert.ok(after>historyBefore);assert.equal((await db.query('SELECT count(*)::int n FROM ediel_data_access_grants WHERE id=$1',[grant2.grantId])).rows[0].n,1)})
  // Market end (Z15) followed by market restoration (Z15C) never touches the internal grant.
  await db.exec("UPDATE metering_permission_sites SET end_at='2026-01-15'")
  await readOnly(()=>assert.rejects(tenPage(uid(2),grant.grantId,2,'analysis',['quantity']),/./))
  await db.exec("UPDATE metering_permission_sites SET end_at='2027-01-01',status='approved'")
  await tenCheck(async()=>{assert.equal((await tenPage(uid(2),grant.grantId,2,'analysis',['quantity'])).rows[0].p.rows.length,2,'restored market permission serves the unrevoked grant')
   const g=(await db.query('SELECT status,revoked_at FROM ediel_data_access_grants WHERE id=$1',[grant2.grantId])).rows[0];assert.equal(g.status,'revoked');assert.ok(g.revoked_at)
   await readOnly(()=>assert.rejects(tenPage(uid(3),grant2.grantId,revokedVersion,'quality-monitoring',['quality']),/grant_not_current/))})
  // Prohibited: a revoked grant cannot be switched back on; access needs a new basis.
  await tenCheck(()=>readOnly(()=>assert.rejects(db.query("UPDATE ediel_data_access_grants SET status='active',revoked_at=NULL WHERE id=$1",[grant2.grantId]),/revoked_grant_requires_new_basis/)))
 } finally { await db.exec('ROLLBACK');inTx=false }
 await db.query('DELETE FROM meter_reading_values WHERE id=$1',[uid(640)])
 console.log('TEN-08/TEN-10 grant SQL: '+tenChecks+' PASS; finite synthetic fixtures, NOT native/legal approval proof')
`
const modified=original.replace(marker,()=>extension+marker)
 .replace("'./.ediel-grant-set-runner.tmp.mjs'","'./.ediel-ten-08-10-runner.tmp.mjs'")
 .replace("'./.ediel-grant-set-consumer.tmp.mjs'","'./.ediel-ten-08-10-consumer.tmp.mjs'")
const temp=fileURLToPath(new URL('./.ediel-ten-08-10-outer.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
try {const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
