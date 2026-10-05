// masterplan: P-12, AT-P-12
// Extends the regulated-supply ground regression (real Z04A/D scope, archive,
// review and apply SQL from 20261001004331) with P-12 prerequisite checks.
// Same declared fixtures; PGlite mechanics, not native replay or legal approval.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const original=readFileSync(new URL('./ediel-regulated-supply-ground-sql-regression.mjs',import.meta.url),'utf8')
const marker=" const scoped=await run('ediel_regulated_supply_ground_scope_v1',[id(1),id(2),selector]);assert.equal(scoped.status,'scoped');checks++\n"
assert.equal(original.split(marker).length,2)
const extension=`
 let p12=0
 const heldWithout=async(change)=>{await db.exec('BEGIN');try{await db.exec(change);const r=await run('ediel_regulated_supply_ground_scope_v1',[id(1),id(2),selector]);assert.equal(r.status,'held',change+' '+JSON.stringify(r));p12++}finally{await db.exec('ROLLBACK')}}
 // Role, contract, grid area and the counterpart capability are each required.
 await heldWithout("UPDATE tenant_actor_roles SET role_code='grid_owner'")
 await heldWithout("UPDATE customer_contracts SET signed_at=NULL")
 await heldWithout("UPDATE metering_points SET grid_area_code=NULL")
 await heldWithout("UPDATE tenant_bilateral_agreements SET capability_code='PRODAT:Z04:D'")
 await heldWithout("UPDATE tenant_bilateral_agreements SET source_reference=NULL")
 assert.equal((await run('ediel_regulated_supply_ground_scope_v1',[id(1),id(2),selector])).status,'scoped');p12++
 console.log('P-12 Z04A/D scope SQL: '+p12+' PASS; declared fixtures, NOT native/legal approval proof')
`
const modified=original.replace(marker,()=>marker+extension)
const temp=fileURLToPath(new URL('./.ediel-p-12.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
try {const r=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(r.error)throw r.error;process.exitCode=r.status??1}finally{unlinkSync(temp)}
