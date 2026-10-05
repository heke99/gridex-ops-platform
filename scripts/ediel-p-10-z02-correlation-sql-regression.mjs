// masterplan: P-10, AT-P-10
// Extends the Z02 core probe (real gridex_apply_exact_z02_core over the real
// decoder) with P-10 correlation and "Z02 is not a start" effects. Same
// declared synthetic ports; PGlite mechanics, not native replay or legal approval.
import {readFileSync,writeFileSync,unlinkSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {createRequire} from 'node:module'
import assert from 'node:assert/strict'
const original=readFileSync(new URL('./ediel-z02-core-embedded-check.mjs',import.meta.url),'utf8')
const marker="const result=await call();assert.equal(result.ok,true)"
assert.equal(original.split(marker).length,2)
const before=`
let p10=0
const mismatch=async(sql,undo,code)=>{await db.exec('RESET ROLE;');await query(sql);try{assert.equal((await call()).code,code);p10++}finally{await db.exec('RESET ROLE;');await query(undo)}}
// Correlation to the Z01 original: LI, customer identity.
await mismatch("UPDATE public.ediel_business_references SET reference_value='OTHER-LI'","UPDATE public.ediel_business_references SET reference_value='CASE+REF'",'z02_source_reference_or_subtype_mismatch')
await mismatch("UPDATE public.customers SET personal_number='190001011111'","UPDATE public.customers SET personal_number='199001011234'",'z02_verified_customer_identity_mismatch')
await db.exec('RESET ROLE;')
const messagesBefore=(await query('SELECT count(*)::int n FROM public.ediel_messages')).rows[0].n
const requestsBefore=(await query('SELECT count(*)::int n FROM public.grid_owner_data_requests')).rows[0].n
`
const after=`
// Z02 is master data only: no new outbound message (no Z03), no new requests.
await db.exec('RESET ROLE;')
assert.equal((await query('SELECT count(*)::int n FROM public.ediel_messages')).rows[0].n,messagesBefore);p10++
assert.equal((await query("SELECT count(*)::int n FROM public.ediel_messages WHERE message_code='Z03'")).rows[0].n,0);p10++
assert.equal((await query('SELECT count(*)::int n FROM public.grid_owner_data_requests')).rows[0].n,requestsBefore);p10++
assert.deepEqual(Object.keys(result).filter(key=>/activ|supply|start|z03/i.test(key)),[]);p10++
console.log('P-10 Z02 correlation SQL: '+p10+' PASS; declared synthetic ports, NOT native/legal approval proof')
`
const lineEnd=original.indexOf('\n',original.indexOf(marker))
const modified=original.slice(0,original.indexOf(marker))+before+original.slice(original.indexOf(marker),lineEnd+1)+after+original.slice(lineEnd+1)
const temp=fileURLToPath(new URL('./.ediel-p-10.tmp.mjs',import.meta.url))
writeFileSync(temp,modified)
const pglite=process.env.PGLITE_MODULE_URL??pathToFileURL(createRequire(import.meta.url).resolve('@electric-sql/pglite')).href
try {const run=spawnSync(process.execPath,[temp],{stdio:'inherit',env:{...process.env,PGLITE_MODULE_URL:pglite}});if(run.error)throw run.error;process.exitCode=run.status??1}finally{unlinkSync(temp)}
