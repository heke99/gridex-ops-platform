// masterplan: ESCO-01, AT-ESCO-01, ESCO-02, AT-ESCO-02
// Extends the service request-timing regression (real coordinator
// ediel_coordinate_service_permission_v1 with the 20261001043917 timing
// consumer) with ESCO-01 request prerequisites and ESCO-02
// V/VH period rules. Same finite declared
// archive/issuer fixtures; PGlite mechanics, not native replay or legal approval.
// Run: EDIEL_PGLITE_MODULE=<pglite> EDIEL_SQL_REPOSITORY=<repo root> node scripts/ediel-esco-01-02-request-basis-sql-regression.mjs
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
let original=readFileSync(new URL('./ediel-service-request-timing-sql-regression.mjs',import.meta.url),'utf8')
// Let approveFresh take explicit assignment field overrides (beneficiary, purpose, objects).
const signature="networkEnd=null}={})=>{"
const purpose="purpose:'Synthetic bounded timing purpose '+count}"
for(const s of [signature,purpose])assert.equal(original.split(s).length,2,s)
original=original.replace(signature,()=>"networkEnd=null,extra=null}={})=>{").replace(purpose,()=>"purpose:'Synthetic bounded timing purpose '+count,...(extra||{})}")
const marker=" assert.equal(first.status,'permission_required')\n"
assert.equal(original.split(marker).length,2)
// Injected into nested String.raw templates: no backticks or template placeholders.
const extension=String.raw`
 let escoChecks=0
 const esco=async fn=>{await fn();escoChecks++}
 const permissionRow=async id=>(await db.query('SELECT id,status,permission_scope,metadata FROM metering_permissions WHERE id=$1',[id])).rows[0]
 // ESCO-01 on_pass: a fully evidenced assignment yields a pending request linked to the assignment, with its mode.
 await esco(async()=>{const p=await permissionRow(first.permissionId);assert.equal(p.status,'draft');assert.equal(p.permission_scope,'V');assert.equal(p.metadata.service_assignment_id,valid.assignment)
  assert.equal((await db.query('SELECT count(*)::int n FROM ediel_assignment_permission_links WHERE assignment_id=$1 AND permission_id=$2',[valid.assignment,first.permissionId])).rows[0].n,1)})
 // ESCO-01 prohibited: an assignment with only the beneficiary/service contract staged is held; no permission row is minted.
 await esco(async()=>{const created=await command({action:'create_assignment',commandId:uid(7700),fields:{...fields,purpose:'ESCO-01 beneficiary-only basis'}})
  const before=await effectCount()
  await db.exec('SET ROLE service_role')
  let held
  try{held=(await db.query("SELECT public.ediel_coordinate_service_permission_v1($1,$2,$3,1,'request_access') r",[uid(1),created.assignmentId,uid(20)])).rows[0].r}finally{await db.exec('RESET ROLE')}
  assert.equal(held.status,'held',JSON.stringify(held));assert.equal(held.permissionId,null);assert.deepEqual(await effectCount(),before)})
 // ESCO-02: V is continuous, VH is a bounded history that must end before the request day.
 const escoPeriod=async(mode,start,end,day,networkStart='2000-01-01',networkEnd=null)=>(await db.query('SELECT gridex_service_permission.evaluate_request_period_v1($1,$2,$3,$4,$5,$6) r',[mode,start,end,day,networkStart,networkEnd])).rows[0].r.status
 await esco(async()=>{assert.equal(await escoPeriod('VH','2026-01-01T00:00:00Z',null,'2026-10-04'),'held','VH requires an end date')})
 await esco(async()=>{assert.equal(await escoPeriod('VH','2026-01-01T00:00:00Z','2026-06-01T00:00:00Z','2026-10-04'),'authorized')})
 await esco(async()=>{assert.equal(await escoPeriod('VH','2026-01-01T00:00:00Z','2026-12-01T00:00:00Z','2026-10-04'),'held','VH cannot be used for ongoing reporting')})
 await esco(async()=>{assert.equal(await escoPeriod('V','2023-10-04T00:00:00Z',null,'2026-10-04'),'authorized');assert.equal(await escoPeriod('V','2023-10-03T00:00:00Z',null,'2026-10-04'),'held','three-year limit')})
 await esco(async()=>{assert.equal(await escoPeriod('V','2026-03-01T00:00:00Z',null,'2026-10-04','2026-04-01'),'held','period must lie within the network contract')})
 // ESCO-02: V and VH on the same market tuple are separate processes (separate permissions).
 const history=await approveFresh({mode:'VH',start:'2026-01-01T00:00:00Z',end:'2026-06-01T00:00:00Z',networkStart:'2026-01-01'})
 const vh=await history.request()
 await esco(async()=>{assert.equal(vh.status,'permission_required',JSON.stringify(vh));assert.notEqual(vh.permissionId,first.permissionId);assert.equal((await permissionRow(vh.permissionId)).permission_scope,'VH')})
 console.log('ESCO-01/ESCO-02 request basis SQL: '+escoChecks+' PASS; finite declared fixtures, NOT native/legal approval proof')
`
const modified=original.replace(marker,()=>marker+extension)
 .replace("'./.ediel-service-timing-nested.tmp.mjs'","'./.ediel-esco-01-02-nested.tmp.mjs'")
const temp=fileURLToPath(new URL('./.ediel-esco-01-02-outer.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
try {const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
