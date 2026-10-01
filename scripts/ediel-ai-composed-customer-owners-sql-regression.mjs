/** Synthetic boundary composition probe. Executes the real prior origination
 * regression and new additive owner. Qualified full facets, legal actors,
 * network and initial supply owner remain EXPLICIT SYNTHETIC fixture ports.
 * No authentic native replay, issuer fact or criterion approval is asserted. */
import {readFileSync} from 'node:fs'
const priorUrl=new URL('./ediel-ai-origination-embedded-check.mjs',import.meta.url)
let source=readFileSync(priorUrl,'utf8')
function insertBefore(marker,addition){if(source.split(marker).length!==2)throw Error('prior_AI_fixture_port_drift');source=source.replace(marker,()=>addition+'\n'+marker)}
const setupSql=String.raw`CREATE SCHEMA gridex_requested_changes;
CREATE SCHEMA gridex_synthetic_ai_facet_boundary;
CREATE TABLE gridex_synthetic_ai_facet_boundary.facets(basis jsonb,revoked boolean DEFAULT false);
CREATE FUNCTION gridex_requested_changes.customer_facet_basis_v1(body jsonb,cutoff timestamptz,c uuid,env text,customer uuid,site uuid,source_id text,object_id text,agency text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT basis FROM gridex_synthetic_ai_facet_boundary.facets f WHERE NOT revoked AND basis->>'companyId'=c::text AND basis->>'environment'=env AND basis->>'customerId'=customer::text AND basis->>'siteId'=site::text AND basis->>'sourceMessageId'=source_id AND basis->>'objectId'=object_id AND basis->>'identityAgency'=agency AND (basis->>'availableAt')::timestamptz<=cutoff AND EXISTS(SELECT FROM jsonb_array_elements(body->'sources') s WHERE s->>'sourceMessageId'=source_id AND s->>'payloadHash'=basis->>'payloadHash')
$$;`
insertBefore('const id=n=>','await db.exec('+JSON.stringify(setupSql)+')\n'+"if(!process.argv.includes('--red'))await db.exec(readFileSync(new URL('../supabase/migrations/20261001045349_ediel_ai_composed_customer_history_owners.sql',import.meta.url),'utf8'))")
// The root full-facet provenance trigger is unchanged; use its actual SQL.
insertBefore('const id=n=>',String.raw`
const fullOwnerSql=readFileSync(new URL('../supabase/migrations/20261001003642_ediel_ai_confirmed_customer_facet_history.sql',import.meta.url),'utf8')
await db.exec(fullOwnerSql.match(/CREATE FUNCTION gridex_requested_changes\.capture_ai_customer_sources_v1[\s\S]*?\$\$;/)[0])
await db.exec(fullOwnerSql.match(/CREATE TRIGGER ai_origin_customer_sources[^;]+;/)[0])
`)
insertBefore('// Seal the actual E-derived original',String.raw`
// Separate full owner and later delta, in the same immutable source universe.
const fullId=id(70),fullRaw=eventRaw.replace('202610100000','202610120000').replace('198001011234','199001011234').replace('Updated Person','Full Facet'),fullHash=await sha(fullRaw)
const fullBasis={sourceMessageId:fullId,payloadHash:fullHash,companyId:company,environment:'test',customerId:customer,siteId:site,meteringPointId:id(13),supplyPeriodId:id(14),objectId:'735123456789012345',identityAgency:'9',legalSender:'54321',legalReceiver:'12345',effectiveAt:'2026-10-11T23:00:00Z',marketMinute:'202610120000',availableAt:'2000-01-01Z',party:{id:'199001011234',name:'Full Facet'},authorityKind:'confirmed'}
await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z06',$3)",[fullId,company,fullRaw])
await db.query('INSERT INTO gridex_synthetic_ai_facet_boundary.facets(basis) VALUES($1)',[fullBasis])
const jointUniverse=JSON.parse(eventUniverseText);jointUniverse.sources.push({sourceMessageId:fullId,rawPayload:fullRaw,payloadHash:fullHash,assessments:[]})
const initial=epochFirst.slice(),patchRow=epochSecond.slice(),fullRow=epochSecond.slice(),fullStructure=epochThird.slice();patchRow[20]='20261012';fullRow[17]='199001011234';fullRow[18]='Full Facet';fullRow[19]='20261012';fullStructure[17]='199001011234';fullStructure[18]='Full Facet'
const jointCsv=[csvLines[0],initial.join(';'),patchRow.join(';'),fullRow.join(';'),fullStructure.join(';')].join('\n'),jointRefs=[rowSources[0],rowSources[0],{...rowSources[0],customerSourceMessageId:fullId},{...twoRefs[1],customerSourceMessageId:fullId}]
const jointRows=(raw=jointCsv,refs=jointRefs,body=jointUniverse)=>db.query('SELECT gridex_ai_processing.require_original_row_sources_v1($1::jsonb,now(),(SELECT i FROM public.ediel_message_intents i WHERE id=$2),$3,$4) AS refs',[JSON.stringify(body),intent,raw,JSON.stringify(refs)])
// RED reproduces the prior overwrite: the same qualified five-key full facet
// is refused by the old four-key matcher. Do not reinterpret this as native.
assert.equal((await jointRows()).rows[0].refs[2].customerSourceMessageId,fullId)
await assert.rejects(()=>jointRows(jointCsv,jointRefs.map(r=>{const copy={...r};delete copy.customerSourceMessageId;return copy})),/ai_list_customer_epoch_source_mismatch/)
await assert.rejects(()=>jointRows(jointCsv,jointRefs.map(r=>({...r,customerSourceMessageId:id(99)}))),/ai_list_customer_epoch_source_mismatch/)
await assert.rejects(()=>jointRows(jointCsv.replace('Full Facet','FORGED')),/ai_list_original_row_source_mismatch/)
await assert.rejects(()=>jointRows(jointCsv.replace('NewStreet','WRONG')),/ai_list_original_row_source_mismatch/)
await assert.rejects(()=>jointRows([csvLines[0],initial.join(';'),fullRow.join(';'),fullStructure.join(';')].join('\n'),[jointRefs[0],jointRefs[2],jointRefs[3]]),/ai_list_original_supply_epoch_omitted/)
await db.query("UPDATE gridex_synthetic_ai_facet_boundary.facets SET basis=jsonb_set(basis,'{party,id}','\"OTHER\"')")
await assert.rejects(jointRows,/ai_list_customer_identity_transition_unqualified/)
await db.query('UPDATE gridex_synthetic_ai_facet_boundary.facets SET basis=$1',[fullBasis])
const bilateralBasis={...fullBasis,party:{id:'198001011299',name:'Full Facet'},authorityKind:'bilateral',identityChangeAuthorized:true}
await db.query('UPDATE gridex_synthetic_ai_facet_boundary.facets SET basis=$1',[bilateralBasis])
assert.equal((await jointRows(jointCsv.replaceAll('199001011234;Full Facet','198001011299;Full Facet'))).rows[0].refs[2].customerSourceMessageId,fullId)
await db.query('UPDATE gridex_synthetic_ai_facet_boundary.facets SET basis=$1',[fullBasis])
await db.query("UPDATE gridex_synthetic_ai_facet_boundary.facets SET basis=jsonb_set(basis,'{environment}','\"production\"')")
await assert.rejects(jointRows,/ai_list_customer_epoch_source_mismatch|ai_list_original_dated_source_owner_missing/)
await db.query('UPDATE gridex_synthetic_ai_facet_boundary.facets SET basis=$1',[fullBasis])
await db.query("UPDATE gridex_synthetic_ai_facet_boundary.facets SET basis=jsonb_set(basis,'{objectId}','\"735123456789012346\"')")
await assert.rejects(jointRows,/ai_list_customer_epoch_source_mismatch|ai_list_original_dated_source_owner_missing/)
await db.query('UPDATE gridex_synthetic_ai_facet_boundary.facets SET basis=$1',[fullBasis])
await db.query('UPDATE gridex_synthetic_ai_facet_boundary.facets SET revoked=true')
await assert.rejects(jointRows,/ai_list_customer_epoch_source_mismatch|ai_list_original_dated_source_owner_missing/)
await db.query('UPDATE gridex_synthetic_ai_facet_boundary.facets SET revoked=false')
// Two genuine owner channels at the same effective boundary cannot win by
// iteration order. This fixture changes only a SYNTHETIC full-owner port.
await db.query('UPDATE gridex_synthetic_ai_facet_boundary.facets SET basis=$1',[{...fullBasis,effectiveAt:eventVersionAt,marketMinute:'202610100000'}])
const sameDayUniverse=JSON.parse(JSON.stringify(jointUniverse));sameDayUniverse.sources.at(-1).rawPayload=fullRaw.replace('202610120000','202610100000');sameDayUniverse.sources.at(-1).payloadHash=await sha(sameDayUniverse.sources.at(-1).rawPayload)
await db.query('UPDATE public.ediel_messages SET raw_payload=$1 WHERE id=$2',[sameDayUniverse.sources.at(-1).rawPayload,fullId])
await db.query("UPDATE gridex_synthetic_ai_facet_boundary.facets SET basis=jsonb_set(basis,'{payloadHash}',to_jsonb($1::text))",[sameDayUniverse.sources.at(-1).payloadHash])
await assert.rejects(()=>jointRows(jointCsv,jointRefs,sameDayUniverse),/ai_list_customer_epoch_ambiguous/)
await db.query('UPDATE public.ediel_messages SET raw_payload=$1 WHERE id=$2',[fullRaw,fullId])
await db.query('UPDATE gridex_synthetic_ai_facet_boundary.facets SET basis=$1',[fullBasis])
assert.equal((await jointRows()).rows[0].refs.length,4)
// A subsequent separately applied delta composes over the full facet. It
// does not erase that full owner's fifth source reference or structural state.
const laterId=id(84),laterAssessment=id(85),laterRaw=fullRaw.replace('202610120000','202610200000').replace('Full Facet','Later Delta'),laterHash=await sha(laterRaw),laterAt='2026-10-19T23:00:00Z'
const laterFacts=JSON.parse(eventFactsText);laterFacts.objects[0].business.sourceMessageId=laterId;const laterFactsText=JSON.stringify(laterFacts),laterFactsHash=await sha(laterFactsText)
await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload) VALUES($1,$2,'test','inbound','edifact','PRODAT','Z06',$3)",[laterId,company,laterRaw])
await db.query("INSERT INTO gridex_received_sources.object_assessments(id,company_id,source_message_id,environment,source_payload_hash,facts_text,facts_hash) VALUES($1,$2,$3,'test',$4,$5,$6)",[laterAssessment,company,laterId,laterHash,laterFactsText,laterFactsHash])
await db.query("INSERT INTO gridex_received_sources.object_availability_witnesses VALUES($1,$2,'test',$3,$4,'2000-01-01Z')",[laterAssessment,company,laterId,laterFactsHash])
await db.query('INSERT INTO gridex_customer_life_events.customer_versions VALUES($1,$2,$3,$4,2)',[company,customer,laterId,laterAt])
await db.query("INSERT INTO gridex_customer_life_events.transitions VALUES($1,$2,$3,'2000-01-01Z',$4,$5)",[company,laterId,laterHash,[{customerId:customer,effectiveAt:laterAt,pointId:'735123456789012345',identityAgency:'9',allowedFields:['228']}],[{point:'735123456789012345',identityAgency:'9',customerParty:['199001011234','SE2','260'],name:['Later Delta']} ]])
const laterUniverse=JSON.parse(JSON.stringify(jointUniverse));laterUniverse.sources.push({sourceMessageId:laterId,rawPayload:laterRaw,payloadHash:laterHash,assessments:[{id:laterAssessment,previousAssessmentId:null,availabilityWitnessId:id(86),availableAt:'2000-01-01Z',factsText:laterFactsText,factsHash:laterFactsHash}]})
const beforeLater=fullStructure.slice(),afterLater=fullStructure.slice();beforeLater[20]='20261020';afterLater[19]='20261020';afterLater[18]='Later Delta'
const laterCsv=[csvLines[0],initial.join(';'),patchRow.join(';'),fullRow.join(';'),beforeLater.join(';'),afterLater.join(';')].join('\n'),laterRefs=[...jointRefs,jointRefs[3]]
assert.equal((await jointRows(laterCsv,laterRefs,laterUniverse)).rows[0].refs[4].customerSourceMessageId,fullId)
await assert.rejects(()=>jointRows(jointCsv,jointRefs,laterUniverse),/ai_list_original_row_source_mismatch/)
await db.query("UPDATE gridex_received_sources.object_availability_witnesses SET observed_at='2100-01-01Z' WHERE assessment_id=$1",[laterAssessment])
await assert.rejects(()=>jointRows(laterCsv,laterRefs,laterUniverse),/ai_list_original_customer_patch_owner_required/)
await db.query('DELETE FROM gridex_customer_life_events.customer_versions WHERE source_message_id=$1',[laterId]);await db.query('DELETE FROM gridex_customer_life_events.transitions WHERE source_message_id=$1',[laterId])
// Originate through the real producer, then check its unchanged provenance
// trigger. This is still a SYNTHETIC full-facet qualification boundary.
const jointIntent=id(81),jointSnapshot=id(83),jointHash=await sha(JSON.stringify(jointUniverse))
await db.query("INSERT INTO public.ediel_message_intents SELECT (jsonb_populate_record(NULL::public.ediel_message_intents,to_jsonb(i)||jsonb_build_object('id',$2::uuid,'operation_id',$3::uuid,'payload',jsonb_set(i.payload,'{requestId}',to_jsonb($3::text))))).* FROM public.ediel_message_intents i WHERE i.id=$1",[intent,jointIntent,id(82)])
await db.query("INSERT INTO gridex_received_sources.object_selection_snapshots VALUES($1,$2,'test',now(),now(),$3,$4)",[jointSnapshot,company,JSON.stringify(jointUniverse),jointHash])
await db.exec('SET ROLE service_role;')
await db.query('SELECT public.gridex_ai_record_outbound_original_v1($1,$2,$3,$4,$5,$6,$7,$8,$9)',[company,actor,jointIntent,jointSnapshot,jointHash,jointCsv,'AI.csv','text/csv; charset=utf-8',JSON.stringify(jointRefs)])
await db.exec('RESET ROLE;')
const jointOrigin=(await db.query('SELECT row_sources,source_ids FROM gridex_ai_processing.outbound_origins WHERE intent_id=$1',[jointIntent])).rows[0]
assert.equal(jointOrigin.row_sources[2].customerSourceMessageId,fullId);assert.ok(jointOrigin.source_ids.includes(fullId));assert.ok(jointOrigin.source_ids.includes(eventId))
await db.query('UPDATE gridex_synthetic_ai_facet_boundary.facets SET revoked=true')
await assert.rejects(jointRows,/ai_list_customer_epoch_source_mismatch|ai_list_original_dated_source_owner_missing/)
await db.exec('SET ROLE service_role;')
assert.equal((await db.query('SELECT public.gridex_ai_record_outbound_original_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',[company,actor,jointIntent,jointSnapshot,jointHash,jointCsv,'AI.csv','text/csv; charset=utf-8',JSON.stringify(jointRefs)])).rows[0].result.status,'original')
await db.exec('RESET ROLE;')
await db.query('DELETE FROM gridex_synthetic_ai_facet_boundary.facets')
const epochSnapshot=id(80),epochSnapshotHash=await sha(eventUniverseText)
await db.query("INSERT INTO gridex_received_sources.object_selection_snapshots VALUES($1,$2,'test',now(),now(),$3,$4)",[epochSnapshot,company,eventUniverseText,epochSnapshotHash])
console.log('PASS: synthetic additive full-facet + delta + structural whole-row composition; five-key provenance, wrong cells, scope, identity authority, ambiguity, current revoke and missing epoch fences. Authentic issuer/native/full-chain NOT RUN.')
`)
// Existing mixed raw fixtures deliberately mutate their synthetic source port;
// keep the native current row byte-equal instead of inventing a hash-only owner.
for(const [hashName,rawName]of [['mixedGoodHash','mixedGoodRaw'],['mixedHash','mixedRaw'],['eventHash','eventRaw']]){
 const marker="await db.query('UPDATE gridex_received_sources.object_assessments SET source_payload_hash=$1 WHERE source_message_id=$2',["+hashName+",eventId])"
 source=source.replaceAll(marker,()=>marker+";await db.query('UPDATE public.ediel_messages SET raw_payload=$1 WHERE id=$2',["+rawName+",eventId])")
}
source=source.replaceAll('epochIntent,id(17),multiHash,epochCsv','epochIntent,epochSnapshot,epochSnapshotHash,epochCsv')
source=source.replaceAll('import.meta.url',JSON.stringify(priorUrl.href))
// Execute unchanged prior assertions with only the explicit new fixture ports.
await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
