// Mechanical internal-site projection boundary checks. The underlying private
// market-source owner is a declared named port, not authentic/native evidence.
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`
let checks=0
try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA gridex_received_sources;
 CREATE TABLE customer_supply_periods(id uuid,company_id uuid,customer_id uuid,metering_point_id uuid,market_state_version bigint,source_message_id uuid);
 CREATE TABLE metering_points(id uuid,company_id uuid,customer_id uuid,site_id uuid,ediel_metering_point_id text,grid_area_code text,grid_owner_ediel_id text);
 CREATE TABLE customer_sites(id uuid,company_id uuid,customer_id uuid);
 CREATE TABLE ediel_messages(id uuid,company_id uuid);
 CREATE TABLE gridex_received_sources.normal_switch_confirmations(period_id uuid,company_id uuid);
 CREATE TABLE gridex_received_sources.supply_source_transitions(source_message_id uuid,company_id uuid,resulting_states jsonb);
 CREATE TABLE declared_market_source_port(company_id uuid,period_id uuid,basis jsonb);
 CREATE FUNCTION gridex_received_sources.supply_period_source_basis_v1(uuid,uuid,timestamptz,timestamptz) RETURNS jsonb LANGUAGE sql AS $$SELECT basis FROM public.declared_market_source_port WHERE company_id=$1 AND period_id=$2$$;
 INSERT INTO customer_supply_periods VALUES('${id(3)}','${id(1)}','${id(4)}','${id(5)}',2,'${id(10)}');
 INSERT INTO metering_points VALUES('${id(5)}','${id(1)}','${id(4)}','${id(6)}','735123456789012345','TES','54321');
 INSERT INTO customer_sites VALUES('${id(6)}','${id(1)}','${id(4)}');INSERT INTO ediel_messages VALUES('${id(10)}','${id(1)}'),('${id(11)}','${id(1)}');`)
 await db.query('INSERT INTO gridex_received_sources.supply_source_transitions VALUES($1,$2,$3)',[id(11),id(1),[{id:id(3),market_state_version:2}]])
 const basis={qualified:true,periodId:id(3),customerId:id(4),meteringPointId:id(5),marketStateVersion:2,sourceMessageId:id(11),initialSourceMessageId:id(10),dsoEdielId:'54321',sourceObjects:[{point:'735123456789012345',identityAgency:'9',gridArea:'TES'}],marketStartAt:'2026-01-01T00:00:00Z',marketEndAt:null}
 await db.query('INSERT INTO declared_market_source_port VALUES($1,$2,$3)',[id(1),id(3),basis])
 await db.exec(readFileSync(new URL('../supabase/migrations/20260930231447_ediel_regulated_supply_internal_site_projection.sql',import.meta.url),'utf8'));checks++
 const read=async company=>(await db.query('SELECT gridex_received_sources.supply_period_source_basis_v1($1,$2,$3,$4) b',[company??id(1),id(3),'2026-02-01','2026-02-02'])).rows[0].b
 const result=await read();assert.equal(result.siteId,id(6));assert.equal(result.companyId,id(1));assert.equal(result.siteProjectionKind,'current_owned_source_physical_point');assert.deepEqual(result.sourceObjects,basis.sourceObjects);assert.equal(result.marketStateVersion,2);checks++
 assert.equal(await read(id(99)),null);checks++
 for(const [column,value,restore] of [['customer_id',id(99),id(4)],['site_id',id(99),id(6)],['ediel_metering_point_id','735000000000000001','735123456789012345'],['grid_area_code','NEW','TES'],['grid_owner_ediel_id','99999','54321']]){
  await db.query(`UPDATE metering_points SET ${column}=$1 WHERE id=$2`,[value,id(5)]);assert.equal(await read(),null);checks++
  await db.query(`UPDATE metering_points SET ${column}=$1 WHERE id=$2`,[restore,id(5)])
 }
 await db.query('UPDATE customer_sites SET customer_id=$1',[id(99)]);assert.equal(await read(),null);checks++;await db.query('UPDATE customer_sites SET customer_id=$1',[id(4)])
 await db.query('UPDATE declared_market_source_port SET basis=$1',[{...basis,marketStateVersion:1}]);assert.equal(await read(),null);checks++
 await db.query('UPDATE declared_market_source_port SET basis=$1',[{...basis,sourceObjects:[{...basis.sourceObjects[0],identityAgency:'unknown'}]}]);assert.equal(await read(),null);checks++
 await db.query('UPDATE declared_market_source_port SET basis=$1',[{...basis,qualified:false}]);assert.equal(await read(),null);checks++
 await db.query('UPDATE declared_market_source_port SET basis=$1',[{...basis,sourceObjects:[...basis.sourceObjects,...basis.sourceObjects]}]);assert.equal(await read(),null);checks++
 await db.query('UPDATE declared_market_source_port SET basis=$1',[basis]);await db.exec('UPDATE customer_supply_periods SET market_state_version=3');assert.equal(await read(),null);checks++
 assert.equal((await db.query("SELECT has_function_privilege('service_role','gridex_received_sources.supply_period_source_before_internal_site_v1(uuid,uuid,timestamptz,timestamptz)','EXECUTE') b")).rows[0].b,false);checks++
 console.log(`PASS ${checks} mechanical same-source/current-physical-point/internal-site/tenant/version/ACL checks; declared source port, not native approval evidence`)
}finally{await db.close()}
