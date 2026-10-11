// masterplan: ESCO-07, SC-023
// Finite SQL component proof. Existing source grammar/executor/receipts are real;
// canonical/legal/sent-original admission fixtures are inherited declared ports.
// No protected Supabase/native, custody or current-market approval is claimed.
import {readFileSync,existsSync} from 'node:fs'
import assert from 'node:assert/strict'
export default async function probe({db,id}) {
for(const method of ['query','exec']){
 const original=db[method].bind(db)
 db[method]=async(...args)=>{try{return await original(...args)}catch(error){throw new Error(`SC023_SQL(${method}): ${String(args[0]).slice(-250)}: ${error.message}`,{cause:error})}}
}
const raw=(code,objects,sender='54321',receiver='12345')=>["UNB+UNOC:3+54321:14+12345:14+261001:1200+I++23-DDQ-PRODAT","UNH+M+PRODAT:D:97A:UN:E2SE6A",`BGM+${code}+DOC+9`,`NAD+FR+${sender}:160:SVK`,`NAD+DO+${receiver}:160:SVK`,...objects.flatMap((own,i)=>[own.point===null&&own.agency===null?`LIN+${i+1}`:`LIN+${i+1}++${own.point??''}:::${own.agency??'9'}`,`RFF+LI:${own.li??'LI-A'}`,'RFF+Z05:TES',...(own.permission?[`RFF+Z09:${own.permission}`]:[]),...(own.omitCustomer?[]:[`NAD+UD+${own.customer??'PERSON-A'}:SE1:260`]),'CCI++Z13',`CAV+${own.reason??'S17'}`,...(own.status?['CCI++Z23',`CAV+${own.status}`]:[]),...(own.start?[`DTM+90:${own.start}:203`]:[]),...(own.end?[`DTM+91:${own.end}:203`]:[]),...(own.permissionEnd?[`DTM+164:${own.permissionEnd}:203`]:[]),...(own.endReason?['CCI++Z25',`CAV+${own.endReason}`]:[]),'CCI++Z14','CAV+::::8716867000030']),"UNT","UNZ+1+I"].map((segment,index,segments)=>index===segments.length-2?`UNT+${segments.length-2}+M`:segment).join("'")+"'"
const service=async(sql,params=[])=>{await db.exec('SET ROLE service_role');try{return await db.query(sql,params)}finally{try{await db.exec('RESET ROLE')}catch{ /* preserve actual transaction error */ }}}
const apply=(source=id(30),expected=null,actor=id(2),company=id(1))=>service('SELECT public.ediel_apply_permission_source_v1($1,$2,$3,$4) b',[company,source,actor,expected]).then(r=>r.rows[0].b)
const fixtures=[]
async function incoming(n,code,objects,decisions=objects.map(()=> 'accepted'),functional='accepted',application=null){
 const wire=application===null?raw(code,objects):raw(code,objects).replace('23-DDQ-PRODAT',application);await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,customer_id) VALUES($1,$2,'test','inbound','PRODAT',$3,$4,'received',$5)",[id(n),id(1),code,wire,id(3)])
 const tokens=(await db.query('SELECT gridex_received_sources.closure_wire_tokens_v2($1) b',[wire])).rows[0].b
 const lines=tokens.filter(x=>x.tag==='LIN').map(x=>x.index)
 const scopes=objects.map((o,i)=>({messageIndex:0,messageReference:'M',objectId:o.point??null,identityAgency:o.agency===null?null:o.agency??'9',registers:[{lineIndex:i,lineNumber:String(i+1),registerIndex:null,registerPosition:0,segmentIndex:lines[i]}]}))
 const facet={assessmentId:id(n+1000),headerDecision:'accepted',objects:scopes.map((scope,i)=>({...scope,applicationDecision:decisions[i],reasonCodes:decisions[i]==='accepted'?[]:['MODELED_APP_REJECTION']}))}
 await db.query("INSERT INTO gridex_received_sources.validation_assessments(id,source_message_id,company_id,environment,source_payload_hash,facts_text,previous_assessment_id) VALUES($1,$2,$3,'test',encode(sha256(convert_to($4,'UTF8')),'hex'),$5,NULL)",[id(n+1000),id(n),id(1),wire,JSON.stringify({syntaxDecision:'accepted',functionalDecision:functional,applicationDecision:decisions.includes('rejected')?'rejected':'accepted'})])
 const sourceHash=(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') h",[wire])).rows[0].h
 const applicationFacts={version:1,owner:'canonical-prodat-application-all-v1',coverage:'canonical_own_application_only',sourcePayloadHash:sourceHash,headerDecision:'accepted',objects:facet.objects}
 const originalFacts={syntaxDecision:'accepted',functionalDecision:functional,applicationDecision:decisions.includes('rejected')?'rejected':'accepted',rulePackEvidence:{declared:'external-original-owner-fixture'},registerValidation:{owner:'validateProdatRegisterPolicy',coverage:'canonical_register_only',objects:scopes.map((scope,i)=>({...scope,disposition:decisions[i]==='rejected'?'rejected':'accepted',reasons:decisions[i]==='rejected'?['MODELED_APP_REJECTION']:[]}))}}
 await db.query("UPDATE gridex_received_sources.validation_assessments SET facts_text=$1,facts_hash=encode(sha256(convert_to($1,'UTF8')),'hex') WHERE id=$2",[JSON.stringify(originalFacts),id(n+1000)])
 await db.query("INSERT INTO gridex_received_sources.prodat_application_facets VALUES($1,$2,$3,'test',$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[id(n+1000),id(n),id(1),sourceHash,JSON.stringify(applicationFacts)])
 await db.query("INSERT INTO gridex_received_sources.prodat_response_facets VALUES($1,$2,$3,'test',$4,$5,encode(sha256(convert_to($5,'UTF8')),'hex'))",[id(n+1000),id(n),id(1),sourceHash,JSON.stringify({responses:scopes.map((scope,i)=>({scope:'object',lineIndex:scope.registers[0].segmentIndex,ercCode:decisions[i]==='accepted'?'100':'MODELED_BAD'}))})])
 await db.query('INSERT INTO application_fixture VALUES($1,$2)',[id(n),facet]);await db.query('INSERT INTO legal_fixture VALUES($1,$2)',[id(n),{actorRole:'energy_service_company',legalEdielId:'12345',environment:'test',family:'PRODAT',code}]);fixtures.push(n);return{wire,scopes,facet}
}
async function permission(n,objects,application=null){
 const original=raw('Z13',objects,'12345','54321'),wire=application===null?original:original.replace('23-DDQ-PRODAT',application);await db.query("INSERT INTO ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,message_sent_at,immutable_rendered_at,immutable_payload_hash,customer_id) VALUES($1,$2,'test','outbound','PRODAT','Z13',$3,'acknowledged',now(),now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4)",[id(n+5000),id(1),wire,id(3)])
 await db.query("INSERT INTO accepted_source_fixture VALUES($1,encode(sha256(convert_to($2,'UTF8')),'hex'))",[id(n+5000),wire])
 await db.query("INSERT INTO metering_permissions(id,company_id,customer_id,status,source_z13_message_id,outbound_z13_message_id,rff_li_reference,grid_owner_ediel_id,market_state_version,metadata) VALUES($1,$2,$3,'z13_sent',$4,$4,$5,'54321',0,'{}')",[id(n),id(1),id(3),id(n+5000),objects[0].li??'LI-A'])
}
 await db.exec(readFileSync(new URL('../supabase/migrations/20261006234527_ediel_z14_original_purpose_correspondence.sql',import.meta.url),'utf8'))
 // Captured DDL dependencies; no invented production columns.
 const schema=readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8')
 await db.exec('CREATE SCHEMA gridex_utilts_binding;CREATE SCHEMA gridex_ediel_ack_replay;CREATE SCHEMA extensions;')
 for(const name of ['public.grid_owner_data_requests','public.meter_reading_series','gridex_utilts_binding.contracts','gridex_utilts_binding.receipts','gridex_ediel_ack_replay.positive_service_scope_receipts','public.ediel_ack_transaction_results','public.customer_supply_periods','public.supplier_switch_requests','public.ediel_service_assignments']){
  const a=schema.indexOf('CREATE TABLE '+name+' (');assert.ok(a>=0);await db.exec(schema.slice(a,schema.indexOf('\n);',a)+4))
 }
 const requestPrimary=schema.match(/ALTER TABLE ONLY public\.grid_owner_data_requests\s+ADD CONSTRAINT [^;]+ PRIMARY KEY \(id\);/)
 assert.ok(requestPrimary);await db.exec(requestPrimary[0])
 // Only the hash extension is an explicit embedded-runtime port. SHA-256 is
 // PostgreSQL's actual built-in function; no storage validator is stubbed.
 await db.exec(`CREATE FUNCTION extensions.digest(bytes bytea,algorithm text) RETURNS bytea LANGUAGE plpgsql IMMUTABLE AS $$BEGIN IF algorithm IS DISTINCT FROM 'sha256' THEN RAISE EXCEPTION 'unsupported_fixture_digest';END IF;RETURN sha256(bytes);END$$;`)
 for(const [name,type] of [['sender_ediel_id','text'],['receiver_ediel_id','text'],['sender_sub_address','text'],['receiver_sub_address','text'],['interchange_reference','text'],['transaction_reference','text'],['application_reference','text'],['original_message_id','uuid'],['external_reference','text'],['grid_owner_data_request_id','uuid']]) await db.exec(`ALTER TABLE public.ediel_messages ADD COLUMN ${name} ${type}`)
 const capturedFunction=name=>{
  const a=schema.indexOf('CREATE FUNCTION '+name+'(');assert.ok(a>=0,name)
  const header=schema.slice(a);const delimiter=header.match(/\n\s+AS (\$[\w]*\$)/)?.[1];assert.ok(delimiter,name)
  const begin=header.indexOf(delimiter),end=header.indexOf(delimiter+';',begin+delimiter.length);assert.ok(end>begin,name)
  return header.slice(0,end+delimiter.length+1)
 }
 for(const name of ['wire_tokens_v1','exact_keys_v1','absolute_v1','validate_contract_base_v1','validate_legacy_contract_v1','canonical_decimal_v2','valid_transaction_reference_v2','validate_contract_v1','validate_decimal_source_v2','supported_point_v1','source_context_v1','stored_contract_v1']) await db.exec(capturedFunction('gridex_utilts_binding.'+name))
 await db.exec(capturedFunction('public.gridex_normalize_metering_point_id'))
 await db.exec(capturedFunction('public.gridex_normalize_facility_id'))
 for(const name of ['public.metering_points','public.customer_sites']){const a=schema.indexOf('CREATE TABLE '+name+' (');assert.ok(a>=0);await db.exec(schema.slice(a,schema.indexOf('\n);',a)+4))}
 // Historical reviewed assignment is an explicit external admission port.
 await db.exec("ALTER TABLE public.companies ADD COLUMN status text DEFAULT 'active';ALTER TABLE auth.users ADD COLUMN deleted_at timestamptz;ALTER TABLE auth.users ADD COLUMN banned_until timestamptz;CREATE SCHEMA gridex_ediel_services;CREATE FUNCTION gridex_ediel_services.lock_evidence_graph_v1() RETURNS void LANGUAGE sql AS $$SELECT$$;")
 const actualReader=capturedFunction('gridex_received_sources.received_z14_reporting_source_basis_v1')
 const readerAuth=actualReader.slice(actualReader.indexOf(" IF current_setting('role'"),actualReader.indexOf(" IF m.direction IS DISTINCT"))
 assert.ok(readerAuth.includes('received_reporting_read_actor_forbidden'))
 // Byte-identical actual reader role/account/read-auth branch, followed by the
 // declared reviewed-original fixture tail. This is not full source approval.
 await db.exec(`CREATE FUNCTION gridex_received_sources.received_z14_reporting_source_basis_v1(p_source_message_id uuid,p_actor_user_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$DECLARE m public.ediel_messages%rowtype;clock_at timestamptz:=clock_timestamp();BEGIN ${readerAuth} RETURN(SELECT jsonb_build_object('objects',coalesce(jsonb_agg(jsonb_build_object('scope',jsonb_build_object('objectId',site.facility_id),'original',jsonb_build_object('permissionId',site.metering_permission_id,'assignmentId','00000000-0000-0000-0000-000000970001'))),'[]')) FROM public.metering_permission_sites site WHERE site.metadata->>'edielMessageId'=p_source_message_id::text);END$$;`)
 await db.query("INSERT INTO public.permission_fixture VALUES($1,$2,'ediel.read')",[id(2),id(1)])
 const migration=new URL('../supabase/migrations/20261011140000_ediel_vh_history_delivery_sc023.sql',import.meta.url)
 if(existsSync(migration)) await db.exec(readFileSync(migration,'utf8'))
 const point='735123456789099990',v={point,li:'SC023-OWN-V',permission:'SC023-OWN-V-ID',start:'202601010000',end:'202601020000',status:'A74'},vh={...v,li:'SC023-OWN-VH',permission:'SC023-OWN-VH-ID',reason:'S18'}
 await permission(900010,[v],'23-DGI-PRODAT')
 await incoming(900030,'Z14',[v],['accepted'],'accepted','23-DGI-PRODAT')
 assert.equal((await apply(id(900030))).applied,true)
 await db.query("INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,start_date,source_process,status,market_start_at,metadata) VALUES($1,$2,$3,$4,'2025-12-01','normal_supplier_switch','active','2025-11-30T23:00:00Z','{\"retained\":\"DDQ\"}')",[id(970010),id(1),id(3),id(970011)])
 await db.query("INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,metering_point_id,status,requested_start_date,process_type,metadata) VALUES($1,$2,$3,$4,'submitted','2025-12-01','supplier_switch_existing_site','{\"retained\":\"switch\"}')",[id(970020),id(1),id(3),id(970011)])
 await db.query("INSERT INTO public.ediel_service_assignments(id,company_id,beneficiary_company_id,provider_actor_id,actor_profile_id,customer_id,dso_actor_id,environment,mode,purpose,object_ids,product_ids,field_sets,data_start,data_end,valid_from,valid_to,status,scope_basis_version) VALUES($1,$2,$3,$4,$5,$6,$7,'test','V','retained periodic',ARRAY[$8],ARRAY['8716867000030'],ARRAY['consumption'],'2025-12-01','2027-12-01','2025-11-01','2027-12-01','active',1)",[id(970002),id(1),id(99),id(970003),id(970004),id(3),id(970005),point])
 const forbidden=async()=>(await db.query("SELECT jsonb_build_object('periods',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.customer_supply_periods x),'switches',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.supplier_switch_requests x),'assignments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.ediel_service_assignments x),'originals',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.ediel_messages x WHERE message_code='Z13'),'V',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.metering_permissions x WHERE id=$1),'Vsites',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.metering_permission_sites x WHERE metering_permission_id=$1)) b",[id(900010)])).rows[0].b
 const independent=async()=>(await db.query("SELECT jsonb_build_object('permission',(SELECT to_jsonb(p) FROM metering_permissions p WHERE id=$1),'sites',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM metering_permission_sites s WHERE metering_permission_id=$1)) b",[id(900010)])).rows[0].b
 const preserved=await independent()
 await permission(900110,[vh],'23-DGI-PRODAT')
 await incoming(900130,'Z14',[vh],['accepted'],'accepted','23-DGI-PRODAT')
 assert.equal((await apply(id(900130))).applied,true)
 const exists=(await db.query("SELECT to_regclass('gridex_vh_history.deliveries') IS NOT NULL b")).rows[0].b
 const jobs=exists?(await db.query('SELECT * FROM gridex_vh_history.deliveries WHERE company_id=$1 AND permission_id=$2',[id(1),id(900110)])).rows:[]
 assert.equal(jobs.length,1,'qualified S18/Z14 must create one real durable history-delivery job')
 assert.equal(jobs[0].state,'approved_or_receiving')
 const forbiddenBefore=await forbidden()
 const historyObject=(await db.query('SELECT * FROM gridex_vh_history.objects WHERE permission_id=$1',[id(900110)])).rows[0]
 const audit=async(permission=id(900110),site=historyObject.site_id)=>(await db.query('SELECT gridex_vh_history.coverage_v1($1,$2,$3) b',[id(1),permission,site])).rows[0].b
 const initial=await audit()
 assert.equal(initial.status,'gaps');assert.equal(initial.dataAccessGranted,false)
 assert.equal(initial.gaps[0].reason,'missing_values')
 let cases=1
 async function isolated(body){await db.exec('BEGIN');try{await body();cases++}finally{await db.exec('ROLLBACK');await db.exec('RESET ROLE')}}
 await isolated(async()=>{
  await db.query("DELETE FROM public.permission_fixture WHERE actor=$1 AND permission='ediel.read'",[id(2)])
  const writeOnly={...vh,point:'735123456789099997',li:'SC023-WRITE-ONLY',permission:'SC023-WRITE-ONLY-ID'}
  await permission(901110,[writeOnly],'23-DGI-PRODAT');await incoming(901130,'Z14',[writeOnly],['accepted'],'accepted','23-DGI-PRODAT')
  assert.equal((await apply(id(901130))).applied,true,'valid metering.write source effect must survive missing unrelated historical read authority')
  const row=(await db.query('SELECT authorization_basis FROM gridex_vh_history.objects WHERE permission_id=$1',[id(901110)])).rows[0]
  assert.equal(row.authorization_basis.status,'held');assert.equal(row.authorization_basis.reason,'vh_history_reviewed_original_unavailable')
 })
 // Captured accepted storage/contract/private receipt is real; historic grant
 // admission remains a declared, immutable scope fixture, never live approval.
 const skip={capability:'skip',reason:'no_attribution',customerId:null,siteId:null,customerSiteId:null,meteringPointId:null,gridOwnerId:null,sourceRequestId:null}
 let storageCounter=0
 async function storedE66({observations,version=1,supersedes=null,seriesStart='2026-01-01T00:00:00.000Z',seriesEnd='2026-01-02T00:00:00.000Z'}={}){
  const n=980000+(storageCounter++)*10,source=id(n),seriesId=id(n+1),transaction='SC023-E66-'+n
  const contract={version,projectionVersion:'utilts-consumption-v'+version,attributionVersion:'tenant-match-v1',companyId:id(1),environment:'test',messageCode:'E66',transactionId:transaction,seriesKind:'actual',profileKey:'utilts_e66',profileVersion:null,rulePackHash:null,guideRevision:'25-A-4',sourceType:'ediel_utilts',
   interpretation:{localPeriodStart:null,localPeriodEnd:null,localRegistration:null,resolutionValue:null,resolutionFormat:null,timezoneRaw:null,timezoneFormat:null,offsetMinutes:null,timestampPolicy:'explicit-offset-v1'},observations:observations.map((o,i)=>({ordinal:i,sourceOrdinal:i,quantity:version===2?String(o.quantity??0):o.quantity??0,periodStart:o.start,periodEnd:o.end,readAt:o.end,resolution:o.resolution??'PT15M',unit:'kWh',quality:o.quality??null,readingType:'consumption',direction:'consumption',registerCode:null,productCode:historyObject.product,sourceLineReference:null,externalPoint:historyObject.point,gridArea:null})),metering:skip,billing:{...skip,requestScope:null,periodStart:null,periodEnd:null,month:null,year:null,status:'received',sourceSystem:'ediel_utilts',currency:'SEK'},billingContributionOrdinals:[]}
  const wire=["UNH+SC023+UTILTS","BGM+E66","NAD+MS+54321:SVK:260","NAD+MR+12345:SVK:260",'IDE+24+'+transaction,'LOC+172+'+historyObject.point+'::9','MEA+AAZ++KWH',...contract.observations.flatMap((o,i)=>['SEQ++'+(i+1),'QTY+136:'+o.quantity]),'UNT'].join("'")+"'"
  const item={transactionId:transaction,disposition:'accepted',unit:'KWH',quantities:contract.observations.map(o=>({qualifier:'136',value:version===2?String(o.quantity):o.quantity})),consumptionContract:contract}
  await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,sender_ediel_id,receiver_ediel_id,application_reference) VALUES($1,$2,'test','inbound','UTILTS','E66',$3,'received','54321','12345','23-DGI-E66-T')",[source,id(1),wire])
  await db.query("INSERT INTO public.meter_reading_series(id,company_id,dedupe_key,source_ediel_message_id,source_transaction_reference,external_metering_point_id,product_id,period_start,period_end,message_code,series_kind,resolution,raw_transaction,immutable_hash,supersedes_series_id) VALUES($1,$2,$3,$4,$3,$5,$6,$7,$8,'E66','actual','PT15M',$9,encode(sha256(convert_to($9::jsonb::text,'UTF8')),'hex'),$10)",[seriesId,id(1),transaction,source,historyObject.point,historyObject.product,seriesStart,seriesEnd,JSON.stringify(item),supersedes])
  await db.query("INSERT INTO gridex_utilts_binding.receipts(source_message_id,company_id,environment,message_code,raw_hash,source_context,membership,contract_version) SELECT id,company_id,environment,message_code,encode(sha256(convert_to(raw_payload,'UTF8')),'hex'),gridex_utilts_binding.source_context_v1(m),$2,$3 FROM public.ediel_messages m WHERE id=$1",[source,JSON.stringify([transaction]),version])
  await db.query("INSERT INTO public.ediel_ack_transaction_results(company_id,environment,source_message_id,source_transaction_id,syntax_result,guide_validation_result,processability_result,disposition,persistence_status,planned_response_type,persisted_series_id) VALUES($1,'test',$2,$3,'positive','positive','positive','accepted','persisted','positive_aperak',$4)",[id(1),source,transaction,seriesId])
  await db.query("INSERT INTO gridex_utilts_binding.contracts(series_id,company_id,environment,source_message_id,transaction_id,contract_version,contract,contract_hash) VALUES($1,$2,'test',$3,$4,$5,$6,encode(sha256(convert_to($6::jsonb::text,'UTF8')),'hex'))",[seriesId,id(1),source,transaction,version,JSON.stringify(contract)])
  const hashes=(await db.query("SELECT encode(sha256(convert_to($1,'UTF8')),'hex') raw,contract_hash FROM gridex_utilts_binding.contracts WHERE series_id=$2",[wire,seriesId])).rows[0]
  const scope={assignment:{id:id(970001),company_id:id(1),customer_id:id(3),environment:'test',mode:'VH'},permissionLink:{company_id:id(1),permission_id:id(900110)},permission:{id:id(900110),company_id:id(1),inbound_z14_message_id:id(900130)},site:historyObject.approved_site}
  const projection={version:2,companyId:id(1),environment:'test',sourceMessageId:source,sourceRawHash:hashes.raw,ackRawHash:'a'.repeat(64),transactions:[{transactionId:transaction,seriesId,originMessageId:source,originRawHash:hashes.raw,contractHash:hashes.contract_hash,originContext:{actorRole:'energy_service_company',legalEdielId:'12345'},scopes:[scope]}]}
  await db.query('INSERT INTO gridex_ediel_ack_replay.positive_service_scope_receipts(company_id,environment,source_message_id,ack_raw_hash,actor_user_id,projection) VALUES($1,\'test\',$2,$3,$4,$5)',[id(1),source,projection.ackRawHash,id(2),JSON.stringify(projection)])
  assert.deepEqual((await db.query('SELECT gridex_utilts_binding.stored_contract_v1($1,$2,$3) b',[id(1),source,transaction])).rows[0].b,contract)
  return {source,seriesId,contract,transaction}
 }
 // A resolution label cannot turn a 24h period header into 96 actual slots.
 await db.exec('BEGIN')
 await storedE66({observations:[{start:historyObject.period_start.toISOString(),end:historyObject.period_end.toISOString()}],seriesStart:historyObject.period_start.toISOString(),seriesEnd:historyObject.period_end.toISOString()})
 const invalidResolution=await audit()
 assert.equal(invalidResolution.sources.length,1,JSON.stringify(invalidResolution))
 assert.equal(invalidResolution.status,'gaps','PT15M values must cover actual quarter-hour intervals, never their 24h envelope')
 await db.exec('ROLLBACK')
 cases++
 const slots=(minutes=15)=>Array.from({length:24*60/minutes},(_,i)=>({start:new Date(historyObject.period_start.getTime()+i*minutes*60_000).toISOString(),end:new Date(historyObject.period_start.getTime()+(i+1)*minutes*60_000).toISOString(),resolution:'PT'+minutes+'M',quantity:0}))
 for(const minutes of [15,30,60]) await isolated(async()=>{
  await storedE66({observations:slots(minutes),seriesStart:historyObject.period_start.toISOString(),seriesEnd:historyObject.period_end.toISOString()})
  const review=await audit();assert.equal(review.status,'complete');assert.equal(review.gaps.length,0);assert.equal(review.intervals.length,24*60/minutes);assert.equal(review.dataAccessGranted,false)
 })
 await isolated(async()=>{
  await storedE66({observations:slots().filter((_,i)=>i!==30),seriesStart:historyObject.period_start.toISOString(),seriesEnd:historyObject.period_end.toISOString()})
  const review=await audit();assert.equal(review.status,'gaps');assert.equal(review.gaps.filter(x=>x.reason==='missing_values').length,1)
 })
 await isolated(async()=>{
  await storedE66({observations:slots().map((o,i)=>i===30?{...o,quality:'46'}:o),seriesStart:historyObject.period_start.toISOString(),seriesEnd:historyObject.period_end.toISOString()})
  const review=await audit();assert.equal(review.status,'gaps');assert.ok(review.gaps.some(x=>x.reason==='unsupported_or_missing_observation'))
 })
 await isolated(async()=>{
  await storedE66({observations:slots(),version:2,seriesStart:historyObject.period_start.toISOString(),seriesEnd:historyObject.period_end.toISOString()})
  assert.equal((await audit()).status,'complete','exact V2 zero is a value, never missing')
 })
 const corruptions=[
  x=>db.query("UPDATE public.ediel_messages SET raw_payload=raw_payload||'x' WHERE id=$1",[x.source]),
  x=>db.query("UPDATE public.meter_reading_series SET raw_transaction=jsonb_set(raw_transaction,'{consumptionContract,observations,0,quantity}','7') WHERE id=$1",[x.seriesId]),
  x=>db.query("UPDATE gridex_utilts_binding.contracts SET contract_hash=repeat('0',64) WHERE series_id=$1",[x.seriesId]),
  x=>db.query("UPDATE public.ediel_ack_transaction_results SET persistence_status='pending' WHERE source_message_id=$1",[x.source]),
  x=>db.query("UPDATE gridex_utilts_binding.receipts SET membership=membership||'\"MISSING\"'::jsonb WHERE source_message_id=$1",[x.source]),
  x=>db.query("UPDATE gridex_ediel_ack_replay.positive_service_scope_receipts SET projection=jsonb_set(projection,'{transactions,0,scopes,0,assignment,company_id}',to_jsonb($2::text)) WHERE source_message_id=$1",[x.source,id(99)]),
 ]
 for(const corrupt of corruptions) await isolated(async()=>{
  const x=await storedE66({observations:slots(),seriesStart:historyObject.period_start.toISOString(),seriesEnd:historyObject.period_end.toISOString()});await corrupt(x)
  const review=await audit();assert.equal(review.status,'held');assert.equal(review.intervals.length,0)
 })
 await isolated(async()=>{
  const x=await storedE66({observations:slots(),seriesStart:historyObject.period_start.toISOString(),seriesEnd:historyObject.period_end.toISOString()})
  await db.query('UPDATE public.meter_reading_series SET is_current=false WHERE id=$1',[x.seriesId])
  const review=await audit();assert.equal(review.status,'gaps');assert.equal(review.intervals.length,0)
 })
 await isolated(async()=>{
  await storedE66({observations:slots(),seriesStart:historyObject.period_start.toISOString(),seriesEnd:historyObject.period_end.toISOString()})
  await storedE66({observations:slots(),seriesStart:historyObject.period_start.toISOString(),seriesEnd:historyObject.period_end.toISOString()})
  const review=await audit();assert.equal(review.status,'held');assert.ok(review.gaps.some(x=>x.reason==='overlapping_observations'))
 })
 // Denied tenant/actor/source never creates a closure or ends this VH job.
 await incoming(900140,'Z15',[{...vh,permissionEnd:'202601021200',endReason:'B77'}],['accepted'],'accepted','23-DGI-PRODAT')
 for(const [actor,company] of [[id(98),id(1)],[id(2),id(99)]]) await isolated(async()=>{
  assert.equal((await apply(id(900140),null,actor,company)).applied,false)
  assert.equal((await db.query('SELECT count(*)::int n FROM gridex_vh_history.closures')).rows[0].n,0)
 })
 await isolated(async()=>{
  await db.query("UPDATE public.user_profiles SET user_status='suspended' WHERE id=$1",[id(2)])
  assert.equal((await apply(id(900140))).applied,false)
  assert.equal((await db.query('SELECT count(*)::int n FROM gridex_vh_history.closures')).rows[0].n,0)
 })
 await db.query("INSERT INTO public.permission_fixture VALUES($1,$2,'metering.read'),($1,$2,'communication.write')",[id(2),id(1)])
 const readAudit=async(company=id(1),actor=id(2))=>(await service('SELECT public.ediel_vh_history_delivery_audit_v1($1,$2,$3) b',[company,id(900110),actor])).rows[0].b
 const visible=await readAudit();assert.equal(visible.state,'approved_or_receiving');assert.equal(visible.dataAccessGranted,false)
 assert.equal(visible.objects.length,1);assert.equal(visible.objects[0].closure,null)
 await assert.rejects(readAudit(id(1),id(98)),/vh_history_actor_unqualified/)
 await assert.rejects(readAudit(id(99),id(2)),/vh_history_actor_unqualified/)
 await isolated(async()=>{
  await db.query("DELETE FROM public.permission_fixture WHERE actor=$1 AND permission='metering.read'",[id(2)])
  await assert.rejects(readAudit(),/vh_history_actor_unqualified/)
 })
 // Existing sent/provider-qualified E73, not a new producer or transport job.
 // Outbound native owner is a declared external admission fixture port here.
 await db.exec(`CREATE SCHEMA gridex_ediel_outbound_owner;CREATE FUNCTION gridex_ediel_outbound_owner.require_v1(c uuid,msg uuid) RETURNS jsonb LANGUAGE plpgsql AS $$BEGIN IF NOT EXISTS(SELECT FROM public.accepted_source_fixture f JOIN public.ediel_messages m ON m.id=f.source AND m.company_id=c WHERE m.id=msg AND f.payload_hash=encode(sha256(convert_to(m.raw_payload,'UTF8')),'hex')) THEN RAISE EXCEPTION 'declared_outbound_owner_unavailable';END IF;RETURN '{"declared":"external_native_owner"}'::jsonb;END$$;`)
 const e73id=id(975001),requestId=id(975002),requestTx='SC023-VH-REQUEST'
 const period719=(await db.query("SELECT to_char($1::timestamptz AT TIME ZONE INTERVAL '+01:00','YYYYMMDDHH24MI')||to_char($2::timestamptz AT TIME ZONE INTERVAL '+01:00','YYYYMMDDHH24MI') p",[historyObject.period_start,historyObject.period_end])).rows[0].p
 const e73wire=["UNH+SC023REQ+UTILTS","BGM+E73","NAD+MS+12345:SVK:260","NAD+MR+54321:SVK:260",'IDE+24+'+requestTx,'LOC+172+'+historyObject.point+'::9','DTM+324:'+period719+':719','RFF+E66','UNT'].join("'")+"'"
 await db.query("INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,request_scope,status,requested_period_start,requested_period_end,sent_at,request_payload) VALUES($1,$2,$3,'meter_values','sent','2026-01-01','2026-01-02',now(),'{\"requestedMessageCode\":\"E66\"}')",[requestId,id(1),id(3)])
 await db.query('INSERT INTO public.customer_sites(id,company_id,customer_id) VALUES($1,$2,$3)',[id(975004),id(1),id(3)])
 await db.query('INSERT INTO public.metering_points(id,company_id,customer_id,customer_site_id,meter_point_id) VALUES($1,$2,$3,$4,$5)',[id(975003),id(1),id(3),id(975004),historyObject.point])
 await db.query('UPDATE public.grid_owner_data_requests SET metering_point_id=$2,site_id=$3 WHERE id=$1',[requestId,id(975003),id(975004)])
 await db.query("INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,message_code,raw_payload,status,message_sent_at,immutable_rendered_at,immutable_payload_hash,customer_id,sender_ediel_id,receiver_ediel_id,application_reference,original_message_id,grid_owner_data_request_id) VALUES($1,$2,'test','outbound','UTILTS','E73',$3,'sent',now(),now(),encode(sha256(convert_to($3,'UTF8')),'hex'),$4,'12345','54321','23-DGI-E66-T',$5,$6)",[e73id,id(1),e73wire,id(3),id(900130),requestId])
 await db.query("INSERT INTO accepted_source_fixture VALUES($1,encode(sha256(convert_to($2,'UTF8')),'hex'))",[e73id,e73wire])
 await db.query('INSERT INTO legal_fixture VALUES($1,$2)',[e73id,{actorRole:'energy_service_company',legalEdielId:'12345',environment:'test',family:'UTILTS',code:'E73'}])
 const linkRequest=async(actor=id(2),company=id(1))=>(await service('SELECT public.ediel_link_vh_history_request_v1($1,$2,$3,$4,$5,$6,$7) b',[company,id(900110),historyObject.site_id,requestId,e73id,requestTx,actor])).rows[0].b
 await isolated(async()=>{
  await db.query("UPDATE public.metering_points SET meter_point_id='735123456789077773' WHERE id=$1",[id(975003)])
  await assert.rejects(linkRequest(),/vh_history_request_point_unqualified/,'same-customer request for another genuine point must fail before a new link')
 })
 await isolated(async()=>{
  await db.query("UPDATE public.grid_owner_data_requests SET request_payload='{\"requestedMessageCode\":\"E30\"}' WHERE id=$1",[requestId])
  await assert.rejects(linkRequest(),/vh_history_request_target_unqualified/)
 })
 await isolated(async()=>{
  await db.query('UPDATE public.metering_points SET company_id=$2 WHERE id=$1',[id(975003),id(99)])
  await assert.rejects(linkRequest(),/vh_history_request_point_unqualified/)
 })
 const linked=await linkRequest();assert.equal(linked.state,'awaiting');assert.equal(linked.transportAuthorityGranted,false)
 assert.equal((await linkRequest()).idempotent,true)
 await assert.rejects(linkRequest(id(98)),/vh_history_actor_unqualified/)
 const originalRequest=(await db.query('SELECT to_jsonb(x) b FROM public.grid_owner_data_requests x WHERE id=$1',[requestId])).rows[0].b
 const originalE73=(await db.query('SELECT to_jsonb(x) b FROM public.ediel_messages x WHERE id=$1',[e73id])).rows[0].b
 assert.ok((await audit()).gaps.some(x=>x.reason==='pending_e73_manual_review'))
 cases++
 for(const corrupt of [
  ()=>db.query("UPDATE public.grid_owner_data_requests SET requested_period_end='2026-01-03' WHERE id=$1",[requestId]),
  ()=>db.query("UPDATE public.ediel_messages SET original_message_id=$2 WHERE id=$1",[e73id,id(900030)]),
  ()=>db.query("UPDATE legal_fixture SET basis=jsonb_set(basis,'{actorRole}','\"supplier\"') WHERE source=$1",[e73id]),
  ()=>db.query("DELETE FROM public.permission_fixture WHERE actor=$1 AND permission='communication.write'",[id(2)]),
 ]) await isolated(async()=>{await corrupt();await assert.rejects(linkRequest(),/vh_history_(request_scope_unqualified|request_legal_source_unqualified|actor_unqualified)/)})
 await isolated(async()=>{
  const wire=e73wire.replace("RFF+E66'",'')
  await db.query("UPDATE public.ediel_messages SET raw_payload=$2,immutable_payload_hash=encode(sha256(convert_to($2,'UTF8')),'hex') WHERE id=$1",[e73id,wire])
  await db.query("UPDATE public.accepted_source_fixture SET payload_hash=encode(sha256(convert_to($2,'UTF8')),'hex') WHERE source=$1",[e73id,wire])
  await assert.rejects(linkRequest(),/vh_history_request_physical_scope_unqualified/)
 })
 // Fault after the close hook proves whole-statement rollback, including the
 // job and permission, rather than validate_only being used as a guarantee.
 const historyBefore=(await db.query("SELECT jsonb_build_object('job',(SELECT to_jsonb(x) FROM gridex_vh_history.deliveries x WHERE permission_id=$1),'permission',(SELECT to_jsonb(x) FROM public.metering_permissions x WHERE id=$1),'sites',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.metering_permission_sites x WHERE metering_permission_id=$1)) b",[id(900110)])).rows[0].b
 await db.exec(`CREATE FUNCTION public.sc023_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.source_message_id='${id(900140)}' THEN RAISE EXCEPTION 'SC023_INJECTED_POST_CLOSE_RECEIPT_FAILURE';END IF;RETURN NEW;END$$;CREATE TRIGGER sc023_receipt_failure BEFORE INSERT ON gridex_received_sources.permission_effect_receipts FOR EACH ROW EXECUTE FUNCTION public.sc023_receipt_failure();`)
 await assert.rejects(apply(id(900140)),/SC023_INJECTED_POST_CLOSE_RECEIPT_FAILURE/)
 await db.exec('DROP TRIGGER sc023_receipt_failure ON gridex_received_sources.permission_effect_receipts;DROP FUNCTION public.sc023_receipt_failure();')
 assert.deepEqual((await db.query("SELECT jsonb_build_object('job',(SELECT to_jsonb(x) FROM gridex_vh_history.deliveries x WHERE permission_id=$1),'permission',(SELECT to_jsonb(x) FROM public.metering_permissions x WHERE id=$1),'sites',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.metering_permission_sites x WHERE metering_permission_id=$1)) b",[id(900110)])).rows[0].b,historyBefore)
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_vh_history.closures')).rows[0].n,0);cases++
 assert.equal((await apply(id(900140))).applied,true)
 const closed=(await db.query('SELECT state FROM gridex_vh_history.deliveries WHERE company_id=$1 AND permission_id=$2',[id(1),id(900110)])).rows[0]
 assert.equal(closed.state,'historical_delivery_closed')
 assert.deepEqual(await independent(),preserved)
 assert.deepEqual(await forbidden(),forbiddenBefore,'full retained V/site/assignment/period/switch/original bytes stay unchanged')
 const frozen=(await db.query('SELECT to_jsonb(x) b FROM gridex_vh_history.closures x WHERE permission_id=$1',[id(900110)])).rows[0].b
 assert.equal(frozen.coverage_status,'gaps')
 assert.ok(frozen.review.gaps.some(x=>x.reason==='pending_e73_manual_review'))
 assert.equal((await linkRequest()).state,'manual_review')
 assert.deepEqual((await db.query('SELECT to_jsonb(x) b FROM public.grid_owner_data_requests x WHERE id=$1',[requestId])).rows[0].b,originalRequest,'manual review does not cancel/change generic transport status')
 assert.deepEqual((await db.query('SELECT to_jsonb(x) b FROM public.ediel_messages x WHERE id=$1',[e73id])).rows[0].b,originalE73,'sent E73/provider/wire remains intact')
 await storedE66({observations:slots(),seriesStart:historyObject.period_start.toISOString(),seriesEnd:historyObject.period_end.toISOString()})
 assert.equal((await apply(id(900140))).idempotent,true)
 assert.deepEqual((await db.query('SELECT to_jsonb(x) b FROM gridex_vh_history.closures x WHERE permission_id=$1',[id(900110)])).rows[0].b,frozen,'late E66 must not recalculate frozen Z15 closure')
 cases++
 await assert.rejects(db.exec("UPDATE gridex_vh_history.closures SET review='{}'"),/immutable_receipt/)
 await assert.rejects(db.exec('DELETE FROM gridex_vh_history.objects'),/immutable_receipt/)
 await assert.rejects(db.exec('TRUNCATE gridex_vh_history.closures,gridex_vh_history.restorations'),/immutable_receipt/)
 // A genuine same-source-bound Z24 reverses permission closure. It must not
 // destroy the previous history proof or block a later genuine S18 closure.
 await incoming(900141,'Z15',[{...vh,reason:'Z24',permissionEnd:'202601021200'}],['accepted'],'accepted','23-DGI-PRODAT')
 assert.equal((await apply(id(900141))).applied,true)
 await incoming(900142,'Z15',[{...vh,permissionEnd:'202601021200',endReason:'B77'}],['accepted'],'accepted','23-DGI-PRODAT')
 assert.equal((await apply(id(900142))).applied,true,'fresh S18 after genuine Z24 remains admissible')
 assert.deepEqual((await db.query('SELECT to_jsonb(x) b FROM gridex_vh_history.closures x WHERE source_message_id=$1',[id(900140)])).rows[0].b,frozen)
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_vh_history.closures WHERE permission_id=$1',[id(900110)])).rows[0].n,2)
 assert.equal((await linkRequest()).state,'manual_review','genuine Z24 does not requeue old unresolved requests')
 cases++
 // Only selected approved physical objects close; siblings remain receiving.
 const second={...vh,point:'735123456789088887',li:'SC023-SUBSET',permission:'SC023-SUBSET-2'},first={...second,point:'735123456789088880',permission:'SC023-SUBSET-1'}
 await permission(902110,[first,second],'23-DGI-PRODAT');await incoming(902130,'Z14',[first,second],['accepted','accepted'],'accepted','23-DGI-PRODAT');assert.equal((await apply(id(902130))).applied,true)
 const sibling=(await db.query('SELECT to_jsonb(x) b FROM public.metering_permission_sites x WHERE metering_permission_id=$1 AND facility_id=$2',[id(902110),second.point])).rows[0].b
 await incoming(902140,'Z15',[{...first,permissionEnd:'202601021200',endReason:'B77'}],['accepted'],'accepted','23-DGI-PRODAT');assert.equal((await apply(id(902140))).applied,true)
 assert.equal((await db.query('SELECT state FROM gridex_vh_history.deliveries WHERE permission_id=$1',[id(902110)])).rows[0].state,'approved_or_receiving')
 assert.deepEqual((await db.query('SELECT to_jsonb(x) b FROM public.metering_permission_sites x WHERE metering_permission_id=$1 AND facility_id=$2',[id(902110),second.point])).rows[0].b,sibling)
 assert.equal((await db.query('SELECT count(*)::int n FROM gridex_vh_history.closures WHERE permission_id=$1',[id(902110)])).rows[0].n,1)
 await incoming(902141,'Z15',[{...second,permissionEnd:'202601021200',endReason:'B77'}],['accepted'],'accepted','23-DGI-PRODAT');assert.equal((await apply(id(902141))).applied,true)
 assert.equal((await db.query('SELECT state FROM gridex_vh_history.deliveries WHERE permission_id=$1',[id(902110)])).rows[0].state,'historical_delivery_closed');cases++
 for(const role of ['anon','authenticated','service_role']){
  const privileges=(await db.query("SELECT has_schema_privilege($1,'gridex_vh_history','USAGE') s,has_function_privilege($1,'gridex_vh_history.coverage_v1(uuid,uuid,uuid)','EXECUTE') f,has_table_privilege($1,'gridex_vh_history.closures','SELECT') t",[role])).rows[0]
  assert.deepEqual(privileges,{s:false,f:false,t:false})
  assert.equal((await db.query("SELECT has_function_privilege($1,'public.ediel_vh_history_delivery_audit_v1(uuid,uuid,uuid)','EXECUTE') r,has_function_privilege($1,'public.ediel_link_vh_history_request_v1(uuid,uuid,uuid,uuid,uuid,text,uuid)','EXECUTE') w",[role])).rows[0].r,role==='service_role')
  assert.equal((await db.query("SELECT has_function_privilege($1,'public.ediel_link_vh_history_request_v1(uuid,uuid,uuid,uuid,uuid,text,uuid)','EXECUTE') w",[role])).rows[0].w,role==='service_role')
 }
 const rls=(await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='gridex_vh_history' AND relkind='r'")).rows
 assert.equal(rls.length,5);assert.ok(rls.every(x=>x.relrowsecurity&&x.relforcerowsecurity));cases++
 console.log(`SC-023 own history SQL: ${cases} cases PASS; actual stored-contract V1/V2 and writer, declared historical admission/hash-extension ports; whole/native NOT_VERIFIED.`)
}
