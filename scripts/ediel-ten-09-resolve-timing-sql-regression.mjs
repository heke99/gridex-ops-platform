// masterplan: TEN-09, AT-TEN-09
// Extends the service request-timing regression (real coordinator, archive,
// stage, separate review and 20261001043917 timing consumer) with the
// 20261004120000 gate on the public explicit-permission resolver. The resolver
// predecessor in the parent harness is its declared finite read-only stub, so
// this proves the gate, not the reuse semantics (ediel-service-manual-sql-regression).
// PGlite mechanics, not native replay or legal approval.
// Run: EDIEL_PGLITE_MODULE=<pglite> EDIEL_SQL_REPOSITORY=<repo root> node scripts/ediel-ten-09-resolve-timing-sql-regression.mjs
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const original=readFileSync(new URL('./ediel-service-request-timing-sql-regression.mjs',import.meta.url),'utf8')
const marker=" assert.equal(first.status,'permission_required')\n"
assert.equal(original.split(marker).length,2)
// Injected into nested String.raw templates: no backticks or template placeholders.
const extension=String.raw`
 let ten09Checks=0
 const ten09=async fn=>{await fn();ten09Checks++}
 const resolverOid=(await db.query("SELECT oid FROM pg_proc WHERE oid='public.ediel_resolve_service_permission_command_v1(uuid,uuid,uuid,bigint,uuid)'::regprocedure")).rows[0].oid
 await db.exec(readFileSync(new URL('../supabase/migrations/20261004120000_ediel_service_resolve_permission_request_timing.sql',import.meta.url),'utf8'))
 const resolveAs=async(assignment,permission,role='service_role')=>{if(role)await db.exec('SET ROLE '+role);try{return(await db.query('SELECT public.ediel_resolve_service_permission_command_v1($1,$2,$3,2,$4) r',[uid(1),assignment,uid(20),permission])).rows[0].r}finally{await db.exec('RESET ROLE')}}
 await ten09(async()=>assert.equal((await db.query("SELECT oid FROM pg_proc WHERE oid='public.ediel_resolve_service_permission_command_v1(uuid,uuid,uuid,bigint,uuid)'::regprocedure")).rows[0].oid,resolverOid))
 // Codex repro shape: dataStart before the signed DSO network start. An explicit
 // permission id must not bypass the coordinator's timing decision.
 const early=await approveFresh({start:'2026-06-01T00:00:00Z',networkStart:'2026-07-01'})
 await ten09(async()=>{const before=await effectCount(),r=await resolveAs(early.assignment,first.permissionId)
  assert.equal(r.status,'held',JSON.stringify(r));assert.equal(r.permissionId,null)
  assert.ok(r.missing.includes('esco_request_start_before_three_year_or_network_contract_bound'),JSON.stringify(r))
  assert.deepEqual(await effectCount(),before)})
 await ten09(async()=>assert.equal((await early.request()).status,'held'))
 // Within the bounds and bound to its recorded permission: unchanged predecessor result.
 await ten09(async()=>{const r=await resolveAs(valid.assignment,first.permissionId);assert.equal(r.status,'permission_required');assert.equal(r.permissionId,first.permissionId)})
 // A different permission than the immutable request receipt is held.
 await ten09(async()=>{const before=await effectCount(),r=await resolveAs(valid.assignment,uid(9999))
  assert.equal(r.status,'held');assert.deepEqual(r.missing,['immutable_service_request_permission_mismatch']);assert.deepEqual(await effectCount(),before)})
 await ten09(async()=>{await assert.rejects(resolveAs(valid.assignment,first.permissionId,null),/ediel_service_manual_service_required/)})
 await ten09(async()=>{const acl=(await db.query("SELECT has_function_privilege('service_role','gridex_service_permission.resolve_before_request_timing_v1(uuid,uuid,uuid,bigint,uuid)','EXECUTE') p")).rows[0].p;assert.equal(acl,false)})
 console.log('TEN-09 resolver request timing SQL: '+ten09Checks+' PASS; finite read-only resolver predecessor, NOT native/legal approval proof')
`
const modified=original.replace(marker,()=>marker+extension)
 .replace("'./.ediel-service-timing-nested.tmp.mjs'","'./.ediel-ten-09-nested.tmp.mjs'")
const temp=fileURLToPath(new URL('./.ediel-ten-09-outer.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
try {const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
