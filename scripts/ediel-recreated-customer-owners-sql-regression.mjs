// Bounded actual-owner checks. Synthetic permission rows and native ledger
// shape explicitly do not establish an authentic issuer or whole requirement.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createHmac,createHash} from 'node:crypto'
import {createRecreatedCustomerOwnerFixture,id,functionSql} from './helpers/ediel-recreated-customer-owners-sql-fixture.mjs'
const {PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite()
let checks=0
try{
 await createRecreatedCustomerOwnerFixture(db)
 const names=['20261001054122_ediel_bilateral_customer_classification_owner_bridge.sql','20261001063426_ediel_customer_owner_entry_lock_prefix.sql','20261001070121_ediel_classified_customer_execution_scope.sql']
 const before=(await db.query(`SELECT oid,proacl,proowner,proconfig,provolatile,prosecdef FROM pg_proc WHERE oid='gridex_customer_life_events.owner_proof_consistent_v1(jsonb,jsonb,uuid)'::regprocedure`)).rows[0]
 for(const name of names){let migration=readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');if(process.env.EDIEL_RECREATED_ACTOR_PHASE_CONTROL==='submit'&&name.includes('70121'))migration=migration.replace("'archive','method_contract'","'submit','method_contract'");await db.exec(migration)}
 const after=(await db.query(`SELECT oid,proacl,proowner,proconfig,provolatile,prosecdef FROM pg_proc WHERE oid='gridex_customer_life_events.owner_proof_consistent_v1(jsonb,jsonb,uuid)'::regprocedure`)).rows[0]
 assert.deepEqual(after,before);assert.equal(after.provolatile,'s');checks++
 const actor=id(20),company=id(1)
 for(const [n,key]of ['communication.write','communication.read','customers.write','customers.read','contracts.write','contracts.read','ediel.source.review'].entries()){await db.query('INSERT INTO permissions VALUES($1,$2,true)',[id(500+n),key]);await db.query("INSERT INTO user_permissions VALUES($1,$2,$3,$1,$4,'allow','active',true)",[id(500+n),actor,company,key])}
 const allowed=async(mode,kind='method_contract')=>(await db.query('SELECT gridex_requested_changes.actor_v1($1,$2,$3,$4) allowed',[company,actor,mode,kind])).rows[0].allowed
 assert.equal(await allowed('archive'),true);assert.equal(await allowed('read'),true);assert.equal(await allowed('review'),true);assert.equal(await allowed('submit'),false);checks++
 await db.query("INSERT INTO user_permission_overrides VALUES($1,$2,NULL,true,'deny','customers.write',now()-interval '1 day',now()+interval '1 day')",[id(800),actor]);assert.equal(await allowed('archive'),false);assert.equal(await allowed('review'),false);checks++
 await db.exec('DELETE FROM user_permission_overrides');await db.query("UPDATE company_memberships SET is_active=false WHERE company_id=$1 AND user_id=$2",[company,actor]);assert.equal(await allowed('archive'),false);checks++;await db.exec('UPDATE company_memberships SET is_active=true')
 await db.query("UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id=$1",[actor]);assert.equal(await allowed('read'),false);checks++;await db.exec('UPDATE auth.users SET banned_until=NULL')
 const source=id(30),raw="UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z06+DOC+9'"
 await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_standard,message_family,message_code,raw_payload)VALUES($1,$2,'test','inbound','edifact','PRODAT','Z06',$3)",[source,company,raw])
 assert.equal((await db.query('SELECT gridex_bilateral_customer_sources.classification_current_v1($1,$2) proof',[company,source])).rows[0].proof,null);checks++
 assert.equal((await db.query("SELECT gridex_customer_life_events.owner_proof_consistent_v1('{}','{}',$1) proof",[source])).rows[0].proof,false);checks++

 // Actual public archive -> actual HMAC owner -> separate actual review ->
 // publisher. Only independent supply/canonical/source reconstruction ports and
 // external legal registry controls are declared synthetic in this bounded DB.
 const reviewer=id(21),contract=id(90),agreement=id(91),key=id(92),representation=id(93),canonical=id(94),counterparty=id(95)
 await db.query('INSERT INTO auth.users(id)VALUES($1)',[reviewer]);await db.query("INSERT INTO user_profiles VALUES($1,'active')",[reviewer]);await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true,now())",[company,reviewer])
 for(const [n,k]of ['communication.write','communication.read','customers.write','customers.read','contracts.write','contracts.read','ediel.source.review'].entries())await db.query("INSERT INTO user_permissions VALUES($1,$2,$3,$4,$5,'allow','active',true)",[id(600+n),reviewer,company,id(500+n),k])
 const actualWire="UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DDQ-PRODAT'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z06+DOC+9'NAD+FR+54321:160:SVK'NAD+DO+12345:160:SVK'LIN+1++POINT:::9'CCI++Z13'CAV+E34'RFF+LI:LI-POINT'RFF+Z05:TES'DTM+157:202610051200:203'NAD+Z02+BRP:160:SVK'NAD+UD+5566778899:SE1:260++New name+End user street+New city++12345+SE'UNT+14+1'UNZ+1+I'"
 await db.query('UPDATE ediel_messages SET raw_payload=$1 WHERE id=$2',[actualWire,source])
 const payloadHash=createHash('sha256').update(actualWire).digest('hex'),nativeAt=(await db.query("SELECT gridex_customer_life_events.wire_partition_v1($1)#>>'{objects,0,effectiveAt}' effective_at",[actualWire])).rows[0].effective_at
 const sourceClaims={companyId:company,environment:'test',sourceMessageId:source,payloadHash,canonicalAssessmentId:canonical,agreementId:agreement,counterpartyActorId:counterparty,legalActorId:reviewer,supplyPeriodId:id(6),supplySourceMessageId:id(8),supplyStateVersion:1,contractId:contract,customerId:id(3),meteringPointId:id(5),siteId:id(7),objectId:'POINT',identityAgency:'9',effectiveAt:nativeAt,customerTokens:[],party:{id:'5566778899',name:'New name'}}
 await db.exec(`CREATE TABLE synthetic_claim_ports(source_id uuid,company_id uuid,claims jsonb);CREATE OR REPLACE FUNCTION gridex_bilateral_customer_sources.source_claims_v1(c uuid,source_id uuid,agreement uuid,supply_id uuid,contract_id uuid)RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$SELECT p.claims FROM public.synthetic_claim_ports p WHERE p.company_id=c AND p.source_id=source_id AND p.claims->>'agreementId'=agreement::text AND p.claims->>'supplyPeriodId'=supply_id::text AND p.claims->>'contractId'=contract_id::text$$;`)
 await db.query('INSERT INTO synthetic_claim_ports VALUES($1,$2,$3)',[source,company,sourceClaims])
 await db.query("INSERT INTO gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,facts_hash,assessed_at)VALUES($1,$2,$3,'test',$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'),clock_timestamp()-interval '1 minute')",[canonical,source,company,payloadHash,JSON.stringify({syntaxDecision:'accepted',applicationDecision:'accepted',functionalDecision:'accepted'})])
 await db.query("INSERT INTO basis_ports VALUES($1,$2)",[id(6),{qualified:true,periodId:id(6),companyId:company,customerId:id(3),siteId:id(7),meteringPointId:id(5),sourceMessageId:id(8),payloadHash:'a'.repeat(64),marketStateVersion:1,legalActorId:reviewer,dsoEdielId:'54321',sourceObjects:[{point:'POINT',identityAgency:'9',gridArea:'TES',customerIdentity:'5566778899'}]}])
 await db.query("INSERT INTO customer_contracts(id,company_id,customer_id,metering_point_id)VALUES($1,$2,$3,$4)",[contract,company,id(3),id(5)])
 await db.query("INSERT INTO tenant_bilateral_agreements VALUES($1,$2,'test',$3,'prodat_z06e_customer_change',true,'SYNTHETIC external bilateral mandate','{}','2000-01-01','2099-01-01')",[agreement,company,counterparty])
 const secret=Buffer.from('SYNTHETIC EXTERNAL KEY ONLY 012345678901234567890123'),hash='b'.repeat(64)
 await db.query("INSERT INTO gridex_bilateral_customer_sources.issuer_keys(id,company_id,environment,counterparty_actor_id,legal_authority_reference,legal_authority_hash,receipt_signing_key,valid_from,valid_to)VALUES($1,$2,'test',$3,'SYNTHETIC external issuer control',$4,$5,'2000-01-01','2099-01-01')",[key,company,counterparty,hash,secret])
 await db.query("INSERT INTO gridex_bilateral_customer_sources.representations(id,company_id,environment,issuer_key_id,legal_actor_id,agreement_id,purpose,legal_authority_reference,legal_authority_hash,valid_from,valid_to)VALUES($1,$2,'test',$3,$4,$5,'prodat_z06e_customer_change','SYNTHETIC external representation control',$6,'2000-01-01','2099-01-01')",[representation,company,key,reviewer,agreement,hash])
 await db.exec(functionSql('../supabase/migrations/20260930232100_ediel_requested_change_source_intake_and_review.sql','gridex_requested_changes.receipt_hmac_sha256_v1'))
 const clause={locator:'SYNTHETIC exact source clause',quote:'Synthetic mandate authorizes the exact customer change.'},pdf=Buffer.from('%PDF-1.7\n'+clause.quote+'\n%%EOF'),reference='SYNTHETIC whole original'
 const receiptBytes=Buffer.from(JSON.stringify({format:'ediel_bilateral_customer_source_receipt_v1',receiptId:id(96),lifeEventKind:'customer_change',claims:sourceClaims,sourceHash:createHash('sha256').update(pdf).digest('hex'),sourceReference:reference,sourceVersion:'1',authorizedFields:['227','228','229','231','232','316'],clause,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()}))
 const submission={sourceMessageId:source,agreementId:agreement,supplyPeriodId:id(6),contractId:contract,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference,version:'1'},issuerReceipt:{keyId:key,representationId:representation,payloadBase64:receiptBytes.toString('base64'),signatureHex:createHmac('sha256',secret).update(receiptBytes).digest('hex')}}
 const call=async(name,params)=>{await db.exec('SET ROLE service_role');try{return (await db.query('SELECT '+name+'('+params.map((_,n)=>'$'+(n+1)).join(',')+') result',params)).rows[0].result}finally{await db.exec('RESET ROLE')}}
 const archived=await call('public.ediel_archive_bilateral_customer_source_v1',[company,actor,submission]);assert.equal(archived.status,'archived');assert.deepEqual(archived.missing,[]);checks++
 await assert.rejects(call('public.ediel_review_bilateral_customer_source_v1',[company,actor,archived.artifactId,{...archived,artifactId:undefined,missing:undefined,status:undefined,decision:'approve',reason:'Synthetic self review',clause}]),/separate_reviewer/);checks++
 const reviewed=await call('public.ediel_review_bilateral_customer_source_v1',[company,reviewer,archived.artifactId,{sourceHash:archived.sourceHash,claimsHash:archived.claimsHash,decision:'approve',reason:'Synthetic separate actual public review',clause}]);assert.equal(reviewed.status,'authorized');checks++
 assert.equal((await call('public.ediel_review_bilateral_customer_source_v1',[company,reviewer,archived.artifactId,{sourceHash:archived.sourceHash,claimsHash:archived.claimsHash,decision:'approve',reason:'Synthetic current idempotent review',clause}])).status,'authorized');checks++
 const emitted=(await db.query('SELECT q.* FROM gridex_customer_life_events.inbound_classifications q JOIN gridex_bilateral_customer_sources.life_event_classification_origins o ON o.classification_id=q.id')).rows
 assert.equal(emitted.length,1);assert.equal(emitted[0].classification,'other_masterdata');assert.deepEqual(Buffer.from(emitted[0].source_original),pdf);assert.deepEqual(Buffer.from(emitted[0].classification_original),receiptBytes);checks++
 assert((await db.query('SELECT gridex_bilateral_customer_sources.classification_current_v1($1,$2,clock_timestamp()) proof',[company,source])).rows[0].proof);checks++
 // Real native actor owner at the actual public execution guard: a communication
 // actor is insufficient, a qualified actor passes this guard and reaches the
 // declared independent immutable inbound-context prerequisite (not a write).
 await db.query("UPDATE user_permissions SET is_active=false WHERE user_id=$1 AND permission_key='customers.write'",[actor])
 await assert.rejects(call('public.ediel_apply_customer_life_event_source_v1',[company,source,actor]),/classified_customer_first_effect_actor_forbidden/);checks++
 await db.query("UPDATE user_permissions SET is_active=true WHERE user_id=$1 AND permission_key='customers.write'",[actor])
 await assert.rejects(call('public.ediel_apply_customer_life_event_source_v1',[company,source,actor]),/declared_historical_identity_basis_unavailable/);checks++
 await db.query("INSERT INTO gridex_bilateral_customer_sources.revocations VALUES('key',$1,'SYNTHETIC current issuer revocation',$2,clock_timestamp())",[key,'c'.repeat(64)])
 assert.equal((await db.query('SELECT gridex_bilateral_customer_sources.classification_current_v1($1,$2,clock_timestamp()) proof',[company,source])).rows[0].proof,null);checks++

 // Catalogue mechanism only: no accepted classification is privately seeded.
 const body=(await db.query("SELECT pg_get_functiondef('public.ediel_apply_customer_life_event_source_v1(uuid,uuid,uuid)'::regprocedure) body")).rows[0].body
 assert(body.indexOf('RETURN partition.result')<body.indexOf('classified_customer_first_effect_actor_forbidden'));assert(body.indexOf('RETURN prior.result')<body.indexOf('classified_customer_first_effect_actor_forbidden'));checks++
 for(const name of ['patches_v1(uuid,uuid,uuid,timestamptz,timestamptz,timestamptz)','export_at_v1(uuid,uuid,uuid,timestamptz)','export_projection_v1(uuid,uuid,uuid)','boundaries_v1(uuid,uuid,uuid,timestamptz,timestamptz)']){const definition=(await db.query('SELECT pg_get_functiondef(to_regprocedure($1)) body',['public.ediel_customer_life_event_'+name])).rows[0].body;assert(definition.includes('classified_customer_personal_history_actor_forbidden'));checks++}
 console.log(JSON.stringify({status:'PASS',checks,scope:'bounded actual actor/DDL/OID/ACL/STABLE and guard mechanism',native:'NOT_RUN',criterionApproval:false}))
}catch(error){console.error(error.message,error.stack);process.exitCode=1}finally{await db.close()}
