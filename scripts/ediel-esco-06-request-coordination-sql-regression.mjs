// masterplan: ESCO-06, AT-ESCO-06
// Extends the service request-timing regression (real coordinator
// ediel_coordinate_service_permission_v1 with the 20261001043917 timing
// consumer) with ESCO-06 repeat-request coordination. Same finite declared
// archive/issuer fixtures; PGlite mechanics, not native replay or legal approval.
// Run: EDIEL_PGLITE_MODULE=<pglite> EDIEL_SQL_REPOSITORY=<repo root> node scripts/ediel-esco-06-request-coordination-sql-regression.mjs
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
 const firstPurpose=(await db.query('SELECT purpose FROM ediel_service_assignments WHERE id=$1',[valid.assignment])).rows[0].purpose
 const permissionRow=async id=>(await db.query('SELECT id,customer_id,status,permission_scope,metadata FROM metering_permissions WHERE id=$1',[id])).rows[0]
 // Same market tuple (ESCO actor, customer, DSO, mode, purpose, scope) through a second
 // internal assignment for another beneficiary tenant: reuse, never a duplicate Z13 basis.
 await db.query("INSERT INTO companies(id) VALUES($1) ON CONFLICT DO NOTHING",[uid(3)])
 const sameTuple=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01',extra:{purpose:firstPurpose,beneficiary_company_id:uid(3)}})
 const reused=await sameTuple.request()
 await esco(async()=>{assert.equal(reused.status,'reuse_permission',JSON.stringify(reused));assert.equal(reused.permissionId,first.permissionId)})
 await esco(async()=>{assert.equal((await db.query('SELECT count(*)::int n FROM ediel_assignment_permission_links WHERE permission_id=$1',[first.permissionId])).rows[0].n,2)})
 // Additional objects need a new request: allowed at once (no general 21-day ban),
 // as a separate permission on the same customer/DSO/actor tuple.
 const additional=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-01-01',extra:{purpose:firstPurpose,object_ids:['point-a','point-extra']}})
 const extra=await additional.request()
 await esco(async()=>{assert.equal(extra.status,'permission_required',JSON.stringify(extra));assert.notEqual(extra.permissionId,first.permissionId)})
 await esco(async()=>{const a=await permissionRow(first.permissionId),b=await permissionRow(extra.permissionId)
  assert.equal(b.customer_id,a.customer_id);assert.equal(b.permission_scope,a.permission_scope)
  assert.equal(b.metadata.provider_actor_id,a.metadata.provider_actor_id)
  assert.equal(b.metadata.service_assignment_id,additional.assignment)})
 console.log('ESCO-06 request coordination SQL: '+escoChecks+' PASS; finite declared fixtures, NOT native/legal approval proof')
`
const modified=original.replace(marker,()=>marker+extension)
 .replace("'./.ediel-service-timing-nested.tmp.mjs'","'./.ediel-esco-06-nested.tmp.mjs'")
const temp=fileURLToPath(new URL('./.ediel-esco-06-outer.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
try {const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
