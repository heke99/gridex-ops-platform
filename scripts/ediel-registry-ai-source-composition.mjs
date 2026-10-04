// Run through EDIEL_REGISTRY_PROBE_MODULE in the real registry market harness.
// Registry originals/actor authorization are explicitly synthetic IO fixtures;
// actual import/source/private dispatch/market functions run without substitutes.
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'

export default async function probe({db,uid,sqlText,apply,actor,company,profile,communication,mid,mutate}){
 let checks=0
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001055536_ediel_registry_ai_list_dispatch_source_alias.sql',import.meta.url),'utf8'))
 await db.exec(`ALTER TABLE communication_routes ADD COLUMN is_active boolean NOT NULL DEFAULT true;ALTER TABLE ediel_route_profiles ADD COLUMN is_active boolean NOT NULL DEFAULT true,ADD COLUMN is_enabled boolean NOT NULL DEFAULT true,ADD COLUMN message_standard text,ADD COLUMN payload_format text`)
 const input=actor('AI-LEGAL','Synthetic immutable legal network')
 input.roles=['grid_owner'];input.routes[0]={...input.routes[0],messageFamily:'AI',applicationReference:null,interchangePartyId:'AI-TECH',communicationAddress:'ai-source@example.invalid'}
 const imported=await apply('SYNTHETIC EXPLICIT AI SOURCE ORIGINAL',[input]);const rid=imported.routeIds[0]
 const aid=(await db.query(`SELECT actor_id FROM platform_actor_routes WHERE id='${rid}'`)).rows[0].actor_id
 await db.exec(`UPDATE communication_routes SET auth_config=jsonb_build_object('platform_actor_route_id','${rid}'),target_email='ai-source@example.invalid' WHERE id='${communication}';UPDATE ediel_route_profiles SET metadata=jsonb_build_object('platform_actor_route_id','${rid}'),message_family='AI_LIST',message_standard='ai_list',payload_format='raw',receiver_ediel_id='AI-TECH',application_reference=NULL WHERE id='${profile}';UPDATE ediel_messages SET message_family='AI_LIST',message_code='AI',application_reference=NULL,receiver_ediel_id='AI-TECH',receiver_email='ai-source@example.invalid',raw_payload='SYNTHETIC AI ORIGINAL' WHERE id='${mid}'`)
 const dispatch=async(family='AI_LIST',app=null)=>{await db.exec('SET ROLE service_role');try{return(await db.query(`SELECT public.ediel_registry_dispatch_source_v1('${company}','${communication}','${profile}','production',${sqlText(family)},${app===null?'NULL':sqlText(app)}) q`)).rows[0].q}finally{await db.exec('RESET ROLE')}}
 const qualified=await dispatch();assert.equal(qualified.canonicalFamily,'AI');assert.equal(qualified.wire.family,'AI');assert.equal(qualified.selectedApplicationReference,null);assert.equal(qualified.legalEdielId,'AI-LEGAL');assert.equal(qualified.wire.interchangePartyId,'AI-TECH');assert.equal(qualified.legalName,'Synthetic immutable legal network');checks+=6
 assert.equal((await mutate()).proceed,true);checks++
 const original=(await db.query(`SELECT gridex_registry_import.current_el_actor_source_v1('${aid}') q`)).rows[0].q
 assert.equal(original.legalName,qualified.legalName);assert.equal(original.sourceSha256,qualified.sourceSha256);checks+=2
 await db.exec(`UPDATE platform_market_actors SET name='Mutable display label' WHERE id='${aid}'`);assert.equal((await db.query(`SELECT gridex_registry_import.current_el_actor_source_v1('${aid}') q`)).rows[0].q.legalName,qualified.legalName);checks++
 assert.equal((await db.query(`SELECT gridex_registry_import.current_el_actor_source_v1('${uid(999)}') q`)).rows[0].q.status,'held');checks++
 async function altered(change,pattern,restore){await db.exec(change);try{await assert.rejects(dispatch(),pattern);checks++}finally{await db.exec(restore)}}
 await altered(`UPDATE ediel_route_profiles SET is_active=false WHERE id='${profile}'`,/ai_list_dispatch_source_required/,`UPDATE ediel_route_profiles SET is_active=true WHERE id='${profile}'`)
 await altered(`UPDATE ediel_route_profiles SET is_enabled=false WHERE id='${profile}'`,/ai_list_dispatch_source_required/,`UPDATE ediel_route_profiles SET is_enabled=true WHERE id='${profile}'`)
 await altered(`UPDATE communication_routes SET is_active=false WHERE id='${communication}'`,/ai_list_dispatch_source_required/,`UPDATE communication_routes SET is_active=true WHERE id='${communication}'`)
 await altered(`UPDATE ediel_route_profiles SET message_standard='edifact' WHERE id='${profile}'`,/ai_list_dispatch_source_required/,`UPDATE ediel_route_profiles SET message_standard='ai_list' WHERE id='${profile}'`)
 await altered(`UPDATE ediel_route_profiles SET payload_format='edifact' WHERE id='${profile}'`,/ai_list_dispatch_source_required/,`UPDATE ediel_route_profiles SET payload_format='raw' WHERE id='${profile}'`)
 await altered(`UPDATE ediel_route_profiles SET application_reference='INVENTED' WHERE id='${profile}'`,/dispatch_source_mismatch/,`UPDATE ediel_route_profiles SET application_reference=NULL WHERE id='${profile}'`)
 await altered(`UPDATE communication_routes SET target_email='wrong@example.invalid' WHERE id='${communication}'`,/dispatch_source_mismatch/,`UPDATE communication_routes SET target_email='ai-source@example.invalid' WHERE id='${communication}'`)
 await altered(`UPDATE ediel_route_profiles SET receiver_ediel_id='AI-LEGAL' WHERE id='${profile}'`,/dispatch_source_mismatch/,`UPDATE ediel_route_profiles SET receiver_ediel_id='AI-TECH' WHERE id='${profile}'`)
 await assert.rejects(dispatch('AI'),/dispatch_source_mismatch/);checks++
 await db.exec(`UPDATE ediel_route_profiles SET is_active=false WHERE id='${profile}'`);assert.deepEqual(await mutate('enter',{fixtureDisposition:'frozen'}),{proceed:false,receipt:'declared-existing-private-outcome'});checks++
 await assert.rejects(mutate('enter'),/ai_list_dispatch_source_required/);checks++;await db.exec(`UPDATE ediel_route_profiles SET is_active=true WHERE id='${profile}'`)
 await db.exec(`UPDATE ediel_messages SET receiver_ediel_id='AI-LEGAL' WHERE id='${mid}'`);await assert.rejects(mutate('enter'),/message_dispatch_source_mismatch/);checks++;await db.exec(`UPDATE ediel_messages SET receiver_ediel_id='AI-TECH' WHERE id='${mid}'`)
 const other=actor('AI-APP');other.routes[0]={...other.routes[0],messageFamily:'AI',applicationReference:'FORBIDDEN-APP',interchangePartyId:'AI-TECH'};const otherRoute=(await apply('SYNTHETIC AI WITH EDIFACT APP',[other])).routeIds[0]
 await db.exec(`UPDATE communication_routes SET auth_config=jsonb_build_object('platform_actor_route_id','${otherRoute}'),target_email='synthetic@example.invalid' WHERE id='${communication}';UPDATE ediel_route_profiles SET metadata=jsonb_build_object('platform_actor_route_id','${otherRoute}') WHERE id='${profile}'`);await assert.rejects(dispatch(),/dispatch_source_mismatch/);checks++
 assert.equal((await db.query(`SELECT has_function_privilege('service_role','gridex_registry_import.current_el_actor_source_v1(uuid)','EXECUTE') ok`)).rows[0].ok,false);checks++
 console.log(`PASS ${checks} composed actual AI registry dispatch/source criteria; synthetic originals/current actor ports, no network mandate/activation/native evidence`)
}
