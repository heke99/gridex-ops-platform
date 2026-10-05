// masterplan: P-13, AT-P-13
// Extends the national supply rescission atomic regression (real matched Z05L
// end apply) with P-13 preservation effects. Same declared ports; PGlite
// mechanics, not native replay or legal approval.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
const original=readFileSync(new URL('./ediel-national-supply-rescission-atomic-sql-regression.mjs',import.meta.url),'utf8')
const marker=" const hEndResult=await hApply();"
assert.equal(original.split(marker).length,2)
const after=" assert.equal((await hApply()).idempotent,true);assert.deepEqual(await hEndCounts(),hEndAfter);checks++;\n"
assert.equal(original.split(after).length,2)
const snapshot=`const p13Snapshot=async()=>(await db.query("SELECT jsonb_build_object('customers',(SELECT count(*) FROM customers),'sites',(SELECT count(*) FROM customer_sites),'points',(SELECT count(*) FROM metering_points),'periods',(SELECT count(*) FROM customer_supply_periods),'otherPeriods',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM customer_supply_periods p WHERE p.id<>$1),'grants',CASE WHEN to_regclass('public.ediel_data_access_grants') IS NULL THEN NULL ELSE (SELECT count(*) FROM ediel_data_access_grants) END) b",[id(301)])).rows[0].b;`
const before=" let p13=0;"+snapshot+"const p13Before=await p13Snapshot();\n"
const check=` // P-13: the end is versioned on the matched period only; nothing else is deleted or changed.
 assert.deepEqual(await p13Snapshot(),p13Before);p13++
 assert.ok((await db.query('SELECT count(*)::int n FROM customer_supply_periods WHERE id=$1',[id(301)])).rows[0].n===1);p13++
 console.log('P-13 end preservation SQL: '+p13+' PASS; declared ports, NOT native/legal approval proof')
`
const modified=original.replace(marker,()=>before+marker).replace(after,()=>after+check)
const temp=fileURLToPath(new URL('./.ediel-p-13.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
try {const r=spawnSync(process.execPath,[temp],{stdio:'inherit',env:process.env});if(r.error)throw r.error;process.exitCode=r.status??1}finally{unlinkSync(temp)}
