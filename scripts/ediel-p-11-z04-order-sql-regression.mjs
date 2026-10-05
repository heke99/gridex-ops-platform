// masterplan: P-11, AT-P-11, SC-036
// Extends the normal-switch source regression (real Z04 confirmation apply and
// supply activation) with P-11 ordering effects. Same declared fixtures;
// PGlite mechanics, not native replay or legal approval.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const original=readFileSync(new URL('./ediel-normal-switch-source-sql-regression.mjs',import.meta.url),'utf8')
const marker=" const result=(await run()).rows[0].b;assert.equal(result.applied,true);assert.equal(result.commits.length,3);checks++"
assert.equal(original.split(marker).length,2)
const before=`
 let p11=0
 // A valid Z04 may arrive before the positive APERAK on the own Z03 (Z03 only 'sent').
 await db.exec('BEGIN')
 await db.exec("UPDATE ediel_messages SET status='sent' WHERE id IN('"+id(20)+"','"+id(120)+"','"+id(220)+"')")
 { const early=(await run()).rows[0].b; assert.equal(early.applied,true,JSON.stringify(early)); assert.ok(early.periods.every(p=>p.status==='confirmed_by_grid_owner')); p11++ }
 // SC-036: the late positive APERAK on the same Z03 originals, written with the
 // canonical updater's ACK columns, completes ACK status only.
 const periodsBefore=(await db.query("SELECT id,status,start_date,end_date FROM customer_supply_periods ORDER BY id")).rows
 await db.exec("ALTER TABLE ediel_messages ADD COLUMN IF NOT EXISTS aperak_status text, ADD COLUMN IF NOT EXISTS functional_check_status text, ADD COLUMN IF NOT EXISTS ack_outcome text, ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz, ADD COLUMN IF NOT EXISTS failed_at timestamptz, ADD COLUMN IF NOT EXISTS failure_reason text")
 await db.exec("UPDATE ediel_messages SET aperak_status='accepted',functional_check_status='accepted',ack_outcome='positive',acknowledged_at=now(),failed_at=NULL,failure_reason=NULL WHERE id IN('"+id(20)+"','"+id(120)+"','"+id(220)+"')")
 assert.deepEqual((await db.query("SELECT id,status,start_date,end_date FROM customer_supply_periods ORDER BY id")).rows,periodsBefore); p11++
 assert.equal((await db.query("SELECT count(*)::int n FROM ediel_messages WHERE id IN('"+id(20)+"','"+id(120)+"','"+id(220)+"') AND aperak_status='accepted' AND ack_outcome='positive' AND acknowledged_at IS NOT NULL")).rows[0].n,3); p11++
 { const again=(await run()).rows[0].b; assert.equal(again.idempotent,true,JSON.stringify(again)); p11++ }
 await db.exec('ROLLBACK')
`
const after=`
 // A late negative ACK on the own Z03 cannot roll back the established confirmation.
 await db.exec("UPDATE ediel_messages SET status='failed' WHERE id IN('"+id(20)+"','"+id(120)+"','"+id(220)+"')")
 assert.ok((await db.query("SELECT bool_and(status='confirmed_by_grid_owner') ok FROM customer_supply_periods")).rows[0].ok); p11++
 assert.equal((await run()).rows[0].b.idempotent,true); p11++
 await db.exec("UPDATE ediel_messages SET status='acknowledged' WHERE id IN('"+id(20)+"','"+id(120)+"','"+id(220)+"')")
 console.log('P-11 Z04 ordering SQL: '+p11+' PASS; declared fixtures, NOT native/legal approval proof')
`
const modified=original.replace(marker,()=>before+marker+after)
const temp=fileURLToPath(new URL('./.ediel-p-11.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
try {const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
