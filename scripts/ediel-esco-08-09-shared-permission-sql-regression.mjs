// masterplan: ESCO-08, AT-ESCO-08, ESCO-09, AT-ESCO-09
// Extends the grant-set consumer chain (service administration -> positive ACK
// service scope -> grant set) with the ESCO-08 shared-permission termination
// coordination and ESCO-09 independent grant re-evaluation after market
// restoration. Same finite synthetic source/storage fixtures; PGlite mechanics,
// not native replay or legal approval.
// Run: EDIEL_PGLITE_MODULE=<pglite> EDIEL_SQL_REPOSITORY=<repo root> node scripts/ediel-esco-08-09-shared-permission-sql-regression.mjs
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const original=readFileSync(new URL('./ediel-service-grant-set-sql-regression.mjs',import.meta.url),'utf8')
const marker=" console.log('Grant-set forward SQL: '"
assert.equal(original.split(marker).length,2)
// Injected into nested String.raw templates: no backticks or template placeholders.
const extension=String.raw`
 let escoChecks=0
 const esco=async fn=>{await fn();escoChecks++}
 let inTx=false
 const readOnly=async fn=>{if(!inTx)return fn();await db.exec('SAVEPOINT esco_read');try{await fn()}finally{await db.exec('ROLLBACK TO SAVEPOINT esco_read')}}
 const version=async a=>Number((await db.query('SELECT version FROM ediel_service_assignments WHERE id=$1',[a])).rows[0].version)
 const coordinate=async(a,command)=>(await db.query('SELECT public.ediel_coordinate_service_permission_v1($1,$2,$3,$4,$5) r',[uid(1),a,uid(20),await version(a),command])).rows[0].r
 const escoPage=(beneficiary,grantId,purpose,requested)=>db.query('SELECT ediel_beneficiary_series_page_v1($1,$2,$3,2,$4,$5,$6,$7,$8) p',[beneficiary,uid(20),grantId,purpose,uid(211),requested,'2026-01-01','2026-02-01'])
 const permissionBefore=async()=>(await db.query('SELECT to_jsonb(p) j FROM metering_permissions p WHERE id=$1',[uid(201)])).rows[0].j
 await db.exec('BEGIN');inTx=true
 try {
  const marketBefore=await permissionBefore()
  // ESCO-08: two internal assignments share permission uid(201). Ending one is an internal
  // event: no market termination is requested while another valid assignment depends on it.
  const firstEnd=await coordinate(aid2,'end_assignment')
  await esco(async()=>{assert.equal(firstEnd.status,'assignment_ended',JSON.stringify(firstEnd));assert.equal(firstEnd.permissionId,uid(201))})
  await esco(async()=>{assert.deepEqual(await permissionBefore(),marketBefore,'the shared market permission is untouched')})
  // Internal access follows the current mandate: the ended assignment's grant is revoked, the other still reads.
  await esco(async()=>{await readOnly(()=>assert.rejects(escoPage(uid(3),grant2.grantId,'quality-monitoring',['quality']),/grant_not_current/))
   assert.ok((await escoPage(uid(2),grant.grantId,'analysis',['quantity'])).rows[0].p.rows.length>0)})
  // Only when the last dependent assignment ends is market termination (Z18) required.
  const lastEnd=await coordinate(aid,'end_assignment')
  await esco(async()=>{assert.equal(lastEnd.status,'market_termination_required',JSON.stringify(lastEnd));assert.equal(lastEnd.permissionId,uid(201))})
 } finally { await db.exec('ROLLBACK');inTx=false }

 await db.exec('BEGIN');inTx=true
 try {
  // ESCO-09: market end then restoration (Z15 then Z15C on the sites).
  await db.query("UPDATE ediel_data_access_grants SET status='revoked',revoked_at=now() WHERE id=$1",[grant2.grantId])
  await db.exec("UPDATE metering_permission_sites SET end_at='2026-01-15'")
  await readOnly(()=>assert.rejects(escoPage(uid(2),grant.grantId,'analysis',['quantity']),/./))
  await db.exec("UPDATE metering_permission_sites SET end_at='2027-01-01',status='approved'")
  // The market relation is restored for the grant that is still independently valid.
  await esco(async()=>{assert.ok((await escoPage(uid(2),grant.grantId,'analysis',['quantity'])).rows[0].p.rows.length>0)})
  // Prohibited: an explicitly revoked tenant grant is not revived.
  await esco(()=>readOnly(()=>assert.rejects(escoPage(uid(3),grant2.grantId,'quality-monitoring',['quality']),/grant_not_current/)))
  // Prohibited: an expired customer agreement is not revived by the market restoration.
  await db.query("UPDATE ediel_service_evidence SET status='revoked' WHERE assignment_id=$1 AND kind='end_user_contract'",[aid])
  await esco(()=>readOnly(()=>assert.rejects(escoPage(uid(2),grant.grantId,'analysis',['quantity']),/./)))
 } finally { await db.exec('ROLLBACK');inTx=false }
 console.log('ESCO-08/ESCO-09 shared permission SQL: '+escoChecks+' PASS; finite synthetic fixtures, NOT native/legal approval proof')
`
const modified=original.replace(marker,()=>extension+marker)
 .replace("'./.ediel-grant-set-runner.tmp.mjs'","'./.ediel-esco-08-09-runner.tmp.mjs'")
 .replace("'./.ediel-grant-set-consumer.tmp.mjs'","'./.ediel-esco-08-09-consumer.tmp.mjs'")
const temp=fileURLToPath(new URL('./.ediel-esco-08-09-outer.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
try {const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
