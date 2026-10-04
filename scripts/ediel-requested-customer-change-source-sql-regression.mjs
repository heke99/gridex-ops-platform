// Bounded real producer/actor/HMAC/current-source SQL. Independent current
// supply/legal identity catalogue and disposable issuer controls are synthetic;
// no native replay or authentic market/legal authority is claimed.
import assert from 'node:assert/strict'
import {createHash,createHmac} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import {createRecreatedCustomerOwnerFixture,id,functionSql} from './helpers/ediel-recreated-customer-owners-sql-fixture.mjs'
const{PGlite}=await import(pathToFileURL(process.env.EDIEL_PGLITE_MODULE).href),db=new PGlite();let checks=0
try{
 await createRecreatedCustomerOwnerFixture(db)
 await db.exec(`ALTER TABLE metering_points ADD customer_site_id uuid,ADD product_direction text;ALTER TABLE customer_supply_periods ADD contract_id uuid,ADD customer_contract_id uuid;
 CREATE TABLE tenant_actor_identifiers(id uuid,company_id uuid,environment text,actor_id uuid,identifier_type text,identifier_value text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE tenant_actor_roles(id uuid,company_id uuid,environment text,actor_id uuid,role_code text,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE tenant_ediel_profiles(id uuid,company_id uuid,environment text,market text,is_enabled bool,valid_from timestamptz,valid_to timestamptz);
 CREATE TABLE platform_actor_roles(id uuid,actor_id uuid,actor_role text,is_active bool);
 CREATE FUNCTION gridex_received_sources.production_contract_hash_v1(c public.customer_contracts)RETURNS text LANGUAGE sql AS $$SELECT encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex')$$;`)
 await db.exec(functionSql('../supabase/migrations/20260930232100_ediel_requested_change_source_intake_and_review.sql','gridex_requested_changes.receipt_hmac_sha256_v1'))
 await db.exec(readFileSync(new URL('../supabase/migrations/20261001084106_ediel_requested_customer_change_source_owner.sql',import.meta.url),'utf8'))
 const company=id(1),uploader=id(20),reviewer=id(21),contract=id(90),agreement=id(91),key=id(92),representation=id(93),counterparty=id(95)
 await db.query('INSERT INTO auth.users(id)VALUES($1)',[reviewer]);await db.query("INSERT INTO user_profiles VALUES($1,'active')",[reviewer]);await db.query("INSERT INTO company_memberships VALUES($1,$2,'active',true,now())",[company,reviewer])
 for(const[n,p]of ['communication.write','communication.read','customers.write','customers.read','contracts.write','contracts.read','ediel.source.review'].entries()){
  await db.query('INSERT INTO permissions VALUES($1,$2,true)',[id(500+n),p]);for(const actor of[uploader,reviewer])await db.query("INSERT INTO user_permissions VALUES($1,$2,$3,$4,$5,'allow','active',true)",[id((actor===uploader?600:700)+n),actor,company,id(500+n),p])
 }
 await db.query("INSERT INTO customer_contracts VALUES($1,$2,$3,$4,'signed','2026-01-01','1')",[contract,company,id(3),id(5)])
 await db.query('UPDATE customer_supply_periods SET customer_contract_id=$1',[contract]);await db.exec("UPDATE metering_points SET product_direction='consumption'")
 await db.query("INSERT INTO tenant_actor_identifiers VALUES($1,$2,'test',$3,'EdielId','12345','2000-01-01',NULL)",[id(800),company,reviewer]);await db.query("INSERT INTO tenant_actor_roles VALUES($1,$2,'test',$3,'electricity_supplier','2000-01-01',NULL)",[id(801),company,reviewer]);await db.query("INSERT INTO tenant_ediel_profiles VALUES($1,$2,'test','electricity',true,'2000-01-01',NULL)",[id(802),company])
 await db.query("INSERT INTO platform_actor_identifiers VALUES($1,$2,'EdielId','54321',true,'2000-01-01',NULL)",[id(803),counterparty]);await db.query("INSERT INTO platform_actor_roles VALUES($1,$2,'grid_owner',true)",[id(804),counterparty])
 await db.query("INSERT INTO tenant_bilateral_agreements VALUES($1,$2,'test',$3,'prodat_z09e_requested_customer_change',true,'SYNTHETIC external outgoing customer mandate','{}','2000-01-01','2099-01-01')",[agreement,company,counterparty])
 await db.query('INSERT INTO basis_ports VALUES($1,$2)',[id(6),{qualified:true,periodId:id(6),companyId:company,customerId:id(3),siteId:id(7),meteringPointId:id(5),sourceMessageId:id(8),payloadHash:'a'.repeat(64),marketStateVersion:1,legalActorId:reviewer,dsoEdielId:'54321',sourceObjects:[{point:'POINT',identityAgency:'9',gridArea:'TES',customerIdentity:'5566778899'}]}])
 const raw="UNB+UNOC:3+12345:14+54321:14+261001:1200+I++23-DDQ-PRODAT'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z09+DOC+9'NAD+FR+12345:160:SVK'NAD+DO+54321:160:SVK'LIN+1++POINT:::9'CCI++Z13'CAV+E34'RFF+LI:LI-POINT'RFF+Z05:TES'DTM+157:202610051200:203'NAD+Z02+BRP:160:SVK'NAD+UD+5566778899:SE1:260++New name+End user street+New city++12345+SE'UNT+14+1'UNZ+1+I'"
 const claims=(await db.query('SELECT gridex_requested_customer_changes.source_claims_v1($1,$2,$3,$4,$5,$6) claims',[company,'test',agreement,id(6),contract,raw])).rows[0].claims;assert.equal(claims.purpose,'prodat_z09e_requested_customer_change');assert.equal(claims.supplyQualified,true);checks++
 const call=async(name,params)=>{await db.exec('SET ROLE service_role');let failed=false;try{return(await db.query('SELECT public.'+name+'('+params.map((_,i)=>'$'+(i+1)).join(',')+') result',params)).rows[0].result}catch(error){failed=true;throw error}finally{try{await db.exec('RESET ROLE')}catch(error){if(!failed)throw error}}}
 const clause={locator:'SYNTHETIC outgoing original clause',quote:'Synthetic DSO permits this precise outgoing customer request.'},pdf=Buffer.from('%PDF-1.7\n'+clause.quote+'\n%%EOF'),reference='SYNTHETIC exact outgoing original',submission={environment:'test',agreementId:agreement,supplyPeriodId:id(6),contractId:contract,rawPayload:raw,source:{bytesBase64:pdf.toString('base64'),mimeType:'application/pdf',reference,version:'1'}}
 const pending=await call('ediel_archive_requested_customer_change_v1',[company,uploader,submission]);assert(pending.missing.includes('authentic_current_outgoing_customer_mandate'));checks++
 const held=await call('ediel_review_requested_customer_change_v1',[company,reviewer,pending.artifactId,{sourceHash:pending.sourceHash,claimsHash:pending.claimsHash,decision:'approve',reason:'Synthetic original without external issuer',clause}]);assert.equal(held.status,'held');assert.equal((await db.query('SELECT count(*) n FROM gridex_customer_life_events.events')).rows[0].n,0);checks++
 const secret=Buffer.from('SYNTHETIC EXTERNAL OUTGOING KEY ONLY 0123456789012345'),authorityHash='b'.repeat(64)
 await db.query("INSERT INTO gridex_requested_customer_changes.issuer_keys(id,company_id,environment,counterparty_actor_id,legal_authority_reference,legal_authority_hash,receipt_signing_key,valid_from,valid_to)VALUES($1,$2,'test',$3,'SYNTHETIC external issuer control',$4,$5,'2000-01-01','2099-01-01')",[key,company,counterparty,authorityHash,secret])
 await db.query("INSERT INTO gridex_requested_customer_changes.representations(id,company_id,environment,issuer_key_id,legal_actor_id,agreement_id,purpose,legal_authority_reference,legal_authority_hash,valid_from,valid_to)VALUES($1,$2,'test',$3,$4,$5,'prodat_z09e_requested_customer_change','SYNTHETIC external representation control',$6,'2000-01-01','2099-01-01')",[representation,company,key,reviewer,agreement,authorityHash])
 const sourceHash=createHash('sha256').update(pdf).digest('hex'),receiptBytes=Buffer.from(JSON.stringify({format:'ediel_requested_customer_change_receipt_v1',purpose:'prodat_z09e_requested_customer_change',receiptId:id(96),claims,sourceHash,sourceReference:reference+' authenticated',sourceVersion:'1',authorizedFields:['227','228','229','231','232','316'],clause,issuedAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+3600000).toISOString()}))
 const qualified={...submission,source:{...submission.source,reference:reference+' authenticated',bytesBase64:Buffer.concat([pdf,Buffer.from('\nAUTHENTICATED SYNTHETIC CONTROL')]).toString('base64')}}
 // Exact source hash refers to the qualified bytes, not the earlier artifact.
 const signedPayload=JSON.parse(receiptBytes.toString());signedPayload.sourceHash=createHash('sha256').update(Buffer.from(qualified.source.bytesBase64,'base64')).digest('hex');const signed=Buffer.from(JSON.stringify(signedPayload))
 qualified.issuerReceipt={keyId:key,representationId:representation,payloadBase64:signed.toString('base64'),signatureHex:createHmac('sha256',secret).update(signed).digest('hex')}
 const variant=(label,patch={},keyId=key,representationId=representation)=>{
  const input=structuredClone(qualified),bytes=Buffer.concat([pdf,Buffer.from('\n'+label)]),payload={...signedPayload,...patch,receiptId:label,sourceReference:reference+' '+label,sourceHash:createHash('sha256').update(bytes).digest('hex')}
  const original=Buffer.from(JSON.stringify(payload));input.source={...input.source,reference:payload.sourceReference,bytesBase64:bytes.toString('base64')};input.issuerReceipt={keyId,representationId,payloadBase64:original.toString('base64'),signatureHex:createHmac('sha256',secret).update(original).digest('hex')};return input
 }
 for(const patch of[{issuedAt:null},{expiresAt:null},{issuedAt:null,expiresAt:null}]){
  const missingClock=await call('ediel_archive_requested_customer_change_v1',[company,uploader,variant('SYNTHETIC missing receipt clock '+JSON.stringify(patch),patch)]);assert(missingClock.missing.includes('authentic_current_outgoing_customer_mandate'),'signed NULL receipt clocks must never authorize')
  assert.equal((await call('ediel_review_requested_customer_change_v1',[company,reviewer,missingClock.artifactId,{sourceHash:missingClock.sourceHash,claimsHash:missingClock.claimsHash,decision:'approve',reason:'Synthetic explicit missing receipt clock',clause}])).status,'held');checks++
 }
 const archived=await call('ediel_archive_requested_customer_change_v1',[company,uploader,qualified]);assert.deepEqual(archived.missing,[]);checks++
 const review={sourceHash:archived.sourceHash,claimsHash:archived.claimsHash,decision:'approve',reason:'Synthetic separate exact outgoing review',clause}
 await assert.rejects(call('ediel_review_requested_customer_change_v1',[company,uploader,archived.artifactId,review]),/separate_reviewer/);checks++
 const approved=await call('ediel_review_requested_customer_change_v1',[company,reviewer,archived.artifactId,review]);assert.equal(approved.status,'authorized');assert(approved.eventId);checks++
 const event=(await db.query('SELECT * FROM gridex_customer_life_events.events WHERE id=$1',[approved.eventId])).rows[0];assert.equal(event.classification,'other_masterdata');assert.equal(event.approved_raw_payload,raw);assert(!event.allowed_customer_fields.includes('310'));checks++
 assert.equal((await call('ediel_requested_customer_change_queue_basis_v1',[company,uploader,archived.artifactId])).eventId,approved.eventId);checks++
 assert.equal((await call('ediel_review_requested_customer_change_v1',[company,reviewer,archived.artifactId,review])).eventId,approved.eventId);assert.equal((await db.query('SELECT count(*) n FROM gridex_customer_life_events.events')).rows[0].n,1);checks++
 const expiringKey=id(902),expiringRepresentation=id(903),deadline=(await db.query("SELECT (clock_timestamp()+interval '1500 milliseconds')::text deadline")).rows[0].deadline
 await db.query("INSERT INTO gridex_requested_customer_changes.issuer_keys(id,company_id,environment,counterparty_actor_id,legal_authority_reference,legal_authority_hash,receipt_signing_key,valid_from,valid_to)VALUES($1,$2,'test',$3,'SYNTHETIC native expiry control',$4,$5,'2000-01-01',$6)",[expiringKey,company,counterparty,authorityHash,secret,deadline])
 await db.query("INSERT INTO gridex_requested_customer_changes.representations(id,company_id,environment,issuer_key_id,legal_actor_id,agreement_id,purpose,legal_authority_reference,legal_authority_hash,valid_from,valid_to)VALUES($1,$2,'test',$3,$4,$5,'prodat_z09e_requested_customer_change','SYNTHETIC native expiry control',$6,'2000-01-01',$7)",[expiringRepresentation,company,expiringKey,reviewer,agreement,authorityHash,deadline])
 const expiring=await call('ediel_archive_requested_customer_change_v1',[company,uploader,variant('SYNTHETIC expiring current authority',{expiresAt:deadline},expiringKey,expiringRepresentation)]);assert.deepEqual(expiring.missing,[])
 const expiringReview=await call('ediel_review_requested_customer_change_v1',[company,reviewer,expiring.artifactId,{sourceHash:expiring.sourceHash,claimsHash:expiring.claimsHash,decision:'approve',reason:'Synthetic separate current expiry review',clause}]);assert.equal(expiringReview.status,'authorized')
 await db.exec('BEGIN');try{
  await new Promise(resolve=>setTimeout(resolve,1800));assert.equal((await db.query('SELECT clock_timestamp()>$1::timestamptz expired',[deadline])).rows[0].expired,true)
  assert.equal((await call('ediel_requested_customer_change_queue_basis_v1',[company,uploader,expiring.artifactId])).status,'held','transaction start must not preserve expired issuer authority')
  assert.equal((await db.query("SELECT gridex_customer_life_events.source_v1($1,$2,$3,'prepare') proof",[company,expiringReview.eventId,uploader])).rows[0].proof.status,'held');checks++
 }finally{await db.exec('ROLLBACK')}
 await db.exec('BEGIN');try{
  await db.query("INSERT INTO user_permission_overrides(id,user_id,company_id,permission_key,effect,is_active,valid_from,valid_to)VALUES($1,$2,$3,'communication.write','deny',true,clock_timestamp()+interval '700 milliseconds',clock_timestamp()+interval '1 day')",[id(904),uploader,company])
  assert.equal((await call('ediel_requested_customer_change_queue_basis_v1',[company,uploader,archived.artifactId])).status,'authorized')
  await new Promise(resolve=>setTimeout(resolve,900))
  assert.equal((await db.query("SELECT gridex_requested_customer_changes.actor_v1($1,$2,'archive','method_contract') current_actor,gridex_requested_changes.actor_v1($1,$2,'archive','method_contract') transaction_actor",[company,uploader])).rows[0].current_actor,false)
  await assert.rejects(call('ediel_requested_customer_change_queue_basis_v1',[company,uploader,archived.artifactId]),/queue_actor_forbidden/);checks++
 }finally{await db.exec('ROLLBACK')}
 await db.query("UPDATE user_permissions SET is_active=false WHERE user_id=$1 AND permission_key='ediel.source.review'",[reviewer]);assert.equal((await call('ediel_requested_customer_change_queue_basis_v1',[company,uploader,archived.artifactId])).status,'held');checks++
 await db.query("UPDATE user_permissions SET is_active=true WHERE user_id=$1 AND permission_key='ediel.source.review'",[reviewer]);await db.query("INSERT INTO gridex_requested_customer_changes.revocations VALUES('key',$1,'SYNTHETIC issuer revocation',$2,clock_timestamp())",[key,'c'.repeat(64)]);assert.equal((await call('ediel_requested_customer_change_queue_basis_v1',[company,uploader,archived.artifactId])).status,'held');checks++
 assert.equal((await db.query("SELECT gridex_customer_life_events.source_v1($1,$2,$3,'prepare') proof",[company,approved.eventId,uploader])).rows[0].proof.status,'held');checks++
 await assert.rejects(db.query('SELECT gridex_requested_customer_changes.source_claims_v1($1,$2,$3,$4,$5,$6)',[company,'test',agreement,id(6),contract,raw.replace("CAV+E34'","CAV+E34'CCI++Z17'CAV+Z41'")]),/non_death/);checks++
 await assert.rejects(call('ediel_archive_requested_customer_change_v1',[company,uploader,{...submission,approved:true}]),/archive_shape/);checks++
 assert.equal((await db.query("SELECT has_table_privilege('service_role','gridex_requested_customer_changes.artifacts','INSERT') allowed")).rows[0].allowed,false);assert.equal((await db.query("SELECT has_function_privilege('authenticated','public.ediel_review_requested_customer_change_v1(uuid,uuid,uuid,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);checks++
 console.log(JSON.stringify({status:'PASS',checks,scope:'bounded actual requested outgoing archive/HMAC/separate review/event/current-source',native:'NOT_RUN',criterionApproval:false}))
}catch(error){console.error(error.message,error.stack);process.exitCode=1}finally{await db.close()}
