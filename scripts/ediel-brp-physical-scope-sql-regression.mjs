// Narrow wrapper fixtures. These do not manufacture actual registry, contract,
// supply approval or native migration/schema parity evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
if(!process.env.EDIEL_PGLITE_MODULE)throw Error('EDIEL_PGLITE_MODULE required')
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const basis={status:'authorized',supplyPeriodId:id(2),effectiveAt:'2027-01-01T00:00:00Z',supplyStateVersion:4,supplySourceMessageId:id(3),legalReceiverId:'54321',pointId:'SYNTHETIC-POINT',identityAgency:'9',gridArea:'TES'}
const source={qualified:true,sourceMessageId:id(3),marketStateVersion:4,dsoEdielId:'54321',sourceObjects:[{point:'SYNTHETIC-POINT',identityAgency:'9',gridArea:'TES'}]}
let checks=0
const read=()=>db.query(`SELECT gridex_brp_changes.context_v1('${id(1)}','${id(4)}','${id(5)}') b`)
const set=async value=>db.query('UPDATE source_fixture SET source=$1',[value])
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_brp_changes;CREATE SCHEMA gridex_received_sources;
 CREATE TABLE source_fixture(basis jsonb,source jsonb);
 CREATE FUNCTION gridex_brp_changes.context_v1(uuid,uuid,uuid,boolean DEFAULT true) RETURNS jsonb LANGUAGE sql AS $$SELECT basis FROM public.source_fixture$$;
 CREATE FUNCTION gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT source FROM public.source_fixture$$;`)
 await db.query('INSERT INTO source_fixture VALUES($1,$2)',[basis,source])
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930211156_ediel_brp_approved_supply_physical_scope.sql',import.meta.url),'utf8'));checks++
 assert.deepEqual((await read()).rows[0].b,basis);checks++
 for(const altered of [null,{...source,qualified:false},{...source,marketStateVersion:5},{...source,sourceMessageId:id(99)},{...source,dsoEdielId:'OTHER'}, {...source,sourceObjects:null}, {...source,sourceObjects:[]}, {...source,sourceObjects:[{...source.sourceObjects[0],point:'OTHER'}]}, {...source,sourceObjects:[{...source.sourceObjects[0],identityAgency:'89'}]}, {...source,sourceObjects:[{...source.sourceObjects[0],gridArea:'OTHER'}]}, {...source,sourceObjects:[source.sourceObjects[0],source.sourceObjects[0]]}]){
  await set(altered);assert.equal((await read()).rows[0].b.status,'held');checks++
 }
 await db.query('UPDATE source_fixture SET basis=$1',[{status:'held',missing:['authentic_contract']}])
 assert.deepEqual((await read()).rows[0].b,{status:'held',missing:['authentic_contract']});checks++
 assert.equal((await db.query(`SELECT has_function_privilege('service_role','gridex_brp_changes.context_v1(uuid,uuid,uuid,boolean)','EXECUTE') allowed`)).rows[0].allowed,false);checks++
 assert.equal((await db.query('SELECT basis FROM source_fixture')).rows[0].basis.status,'held');checks++
 console.log(`PASS ${checks} focused approved BRP physical-scope PostgreSQL fixture checks; native/authentic evidence deferred`)
}finally{await db.close()}
