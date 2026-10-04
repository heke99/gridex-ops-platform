// masterplan: ESCO-04, AT-ESCO-04, ESCO-07, AT-ESCO-07 (also ESCO-05 A76 SQL side)
// Extends the partial-permission source regression (real lexer, permission
// executor, ledgers and Z15 path from 20261001044351) with the ESCO-04 scoped
// approval and ESCO-07 separate V/VH termination effects. Same declared
// external IO fixtures; PGlite mechanics, not native replay or legal approval.
// Run: EDIEL_PGLITE_MODULE=<pglite> node scripts/ediel-esco-04-07-permission-sql-regression.mjs
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const original=readFileSync(new URL('./ediel-partial-permission-source-sql-regression.mjs',import.meta.url),'utf8')
const marker=' if(process.env.EDIEL_PERMISSION_PROBE_MODULE)'
assert.equal(original.split(marker).length,2)
const extension=String.raw`
 let escoChecks=0
 const esco=(actual,expected)=>{assert.deepEqual(actual,expected);escoChecks++}
 const sites=async permission=>(await db.query('SELECT facility_id,status,permission_end_at FROM metering_permission_sites WHERE metering_permission_id=$1 ORDER BY facility_id',[permission])).rows
 const snapshot=async permission=>(await db.query("SELECT jsonb_build_object('p',(SELECT to_jsonb(p) FROM metering_permissions p WHERE id=$1),'s',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.facility_id) FROM metering_permission_sites s WHERE s.metering_permission_id=$1)) j",[permission])).rows[0].j
 // Another tenant's rows on the same point must never be touched.
 await db.query("INSERT INTO metering_permissions(id,company_id,customer_id,status,rff_li_reference,grid_owner_ediel_id,market_state_version,metadata) VALUES($1,$2,$3,'active','LI-V','54321',3,'{}')",[id(9901),id(99),id(9903)])
 await db.query("INSERT INTO metering_permission_sites(company_id,metering_permission_id,customer_id,facility_id,status,metadata) VALUES($1,$2,$3,'735123456789019001','approved','{}')",[id(99),id(9901),id(9903)])
 const foreignBefore=await snapshot(id(9901))
 const pointV='735123456789019001',extra='735123456789019018'
 const span={permission:'PERM-V',start:'202601010000',end:'202701010000'}

 // ESCO-04: a V request for two points where only one is approved (A74).
 await permission(910,[{point:pointV,li:'LI-V'},{point:extra,li:'LI-V'}])
 await incoming(930,'Z14',[{...span,point:pointV,li:'LI-V',status:'A74'},{...span,point:extra,li:'LI-V',status:'A13'}],['accepted','rejected'])
 const approved=await apply(id(930))
 esco(approved.applied,true)
 esco((await sites(id(910))).map(s=>s.facility_id),[pointV])
 // Prohibited: no widening to the customer's other facility or to other tenants.
 esco((await db.query('SELECT count(*)::int n FROM metering_permission_sites WHERE facility_id=$1',[extra])).rows[0].n,0)
 esco(await snapshot(id(9901)),foreignBefore)
 // A Z14 from a DSO other than the permission's grid owner establishes nothing.
 await permission(920,[{point:'735123456789019025',li:'LI-W'}])
 await db.query("UPDATE metering_permissions SET grid_owner_ediel_id='99999' WHERE id=$1",[id(920)])
 await incoming(921,'Z14',[{...span,point:'735123456789019025',li:'LI-W',status:'A74'}])
 esco((await apply(id(921))).applied,false)
 esco((await sites(id(920))).length,0)

 // ESCO-07: a separate VH (S18 history) permission on the same point and customer.
 const spanVH={permission:'PERM-VH',start:'202501010000',end:'202601010000'}
 await permission(950,[{point:pointV,li:'LI-VH',reason:'S18'}])
 await incoming(960,'Z14',[{...spanVH,point:pointV,li:'LI-VH',reason:'S18',status:'A74'}])
 esco((await apply(id(960))).applied,true)
 const vBefore=await snapshot(id(910))
 // A Z15 whose reason does not match the permission's mode is refused (today at object qualification).
 await incoming(970,'Z15',[{...spanVH,point:pointV,li:'LI-VH',reason:'S17',status:'A74',permissionEnd:'202601011200',endReason:'B77'}])
 esco((await apply(id(970))).applied,false)
 // Z15 VH ends only the history permission.
 await incoming(980,'Z15',[{...spanVH,point:pointV,li:'LI-VH',reason:'S18',status:'A74',permissionEnd:'202601011200',endReason:'B77'}])
 const ended=await apply(id(980))
 esco(ended.applied,true)
 esco((await db.query('SELECT status FROM metering_permissions WHERE id=$1',[id(950)])).rows[0].status,'ended')
 esco((await sites(id(950))).map(s=>s.status),['ended'])
 // Prohibited: the separate V permission and its site are byte-identical; other tenants untouched.
 esco(await snapshot(id(910)),vBefore)
 esco(await snapshot(id(9901)),foreignBefore)
 // ESCO-05 (SQL side): a passive A76 denial is applied as a business answer with no market permission site.
 await permission(990,[{point:'735123456789019049',li:'LI-P'}])
 await incoming(991,'Z14',[{point:null,agency:null,li:'LI-P',reason:'Z96',status:'A76',omitCustomer:true}])
 const passive=await apply(id(991))
 esco(passive.applied,true);esco(passive.status,'rejected_passive_timeout');esco((await sites(id(990))).length,0)
 console.log('ESCO-04/ESCO-07 permission SQL: '+escoChecks+' PASS; declared external ports, NOT native/legal approval proof')
`
const modified=original.replace(marker,()=>extension+marker)
const temp=fileURLToPath(new URL('./.ediel-esco-04-07.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
try {const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
