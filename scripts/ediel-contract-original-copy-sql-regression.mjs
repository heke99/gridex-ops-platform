import {readFileSync} from 'node:fs'
import {runContractCopyRegression} from './helpers/ediel-contract-original-copy-sql-fixture.mjs'
const file=new URL('./ediel-classification-copy-retention-sql-regression.mjs',import.meta.url),needle=" console.log(JSON.stringify({status:'PASS',checks,scope:'published six-original"
let text=readFileSync(file,'utf8');if(!text.includes(needle))throw Error('contract_copy_actual_predecessor_anchor_changed')
text=text.replace(needle," await globalThis.__contractCopy({db,id,q,hash,source,call,actor,signed,check,own});\n"+needle).replace("const baseUrl=new URL('./ediel-decision-evidence-sql-regression.mjs',import.meta.url)",'const baseUrl=new URL('+JSON.stringify(new URL('./ediel-decision-evidence-sql-regression.mjs',import.meta.url).href)+')').replace("const own=new URL('../supabase/migrations/',import.meta.url)\n",'const own=new URL('+JSON.stringify(new URL('../supabase/migrations/',import.meta.url).href)+')\n')
globalThis.__contractCopy=runContractCopyRegression
try{await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'))}catch(error){console.error(error.message,error.code??'',error.where??'');process.exitCode=1}finally{delete globalThis.__contractCopy}
