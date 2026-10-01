// Shared native fixture owns only synthetic local tenants. Real publication,
// signature, archive, Z03 origination and provider-owner ports produce evidence.
// Only external SMTP is injected by the caller; no private ready/accepted row
// is seeded. Synthetic contract/POA acceptance is not an external issuer proof.
import {execFileSync} from 'node:child_process'
import {createHash,randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {signInvoiceTestContractCanonically} from '@/lib/ediel/testing/invoiceTestContractLifecycle'
import {archiveSignedCustomerContractPdf} from '@/lib/customer-contracts/documents'
import {buildAgreementPdfAttachment} from '@/lib/customer-contracts/agreementPdf'
import {savePowerOfAttorney} from '@/lib/operations/db'
import {ensureAuthorizationDocumentFromPowerOfAttorney} from '@/lib/legal/authorizationChain'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {getEdielMessageById} from '@/lib/ediel/db'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
export const literal=(v:unknown):string=>v===null?'NULL':"'"+String(typeof v==='object'?JSON.stringify(v):v).replaceAll("'","''")+"'"
export function nativeSql<T>(input:string):T{
 if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('owned_local_only')
 const out=execFileSync('psql',['postgresql://postgres:postgres@127.0.0.1:54322/postgres','-XAtq','-v','ON_ERROR_STOP=1'],{input,encoding:'utf8',timeout:10000,maxBuffer:2_000_000}).trim()
 return out?JSON.parse(out) as T:undefined as T
}
const sql=nativeSql
function fixtureGsrn(){
 const first17=`735123456789${String(Math.floor(Math.random()*100000)).padStart(5,'0')}`
 const weighted=[...first17].reduce((sum,digit,index)=>sum+Number(digit)*(index%2===0?3:1),0)
 return `${first17}${(10-weighted%10)%10}`
}
export type NormalSwitchStageNativeFixture={companyId:string;actorUserId:string;customerId:string;siteId:string;pointId:string;contractId:string;switchId:string;external:string;sender:string;receiver:string;gridId:string;routeId:string;routeProfileId:string;marketActorId:string;customerIdentity:{id:string;qualifier:'SE2';agency:'260'};requestedStartDate:string;brpEdielId:string;gridAreaCode:string;documentSha256:string;authorizationDocumentId:string;powerOfAttorneyId:string}
type NormalSwitchFixtureInput={requestedStartDate?:string;external?:string;provider?:(email:string)=>void;initialSubtype?:'L'|'H'}
export function seedNormalSwitchNativeFixture(input:NormalSwitchFixtureInput&{deferOriginal:true}):Promise<NormalSwitchStageNativeFixture>
export function seedNormalSwitchNativeFixture(input?:NormalSwitchFixtureInput&{deferOriginal?:false}):Promise<NormalSwitchStageNativeFixture&{caseReference:string;originalZ03:EdielMessageRow}>
export async function seedNormalSwitchNativeFixture(input:NormalSwitchFixtureInput&{deferOriginal?:boolean}={}){
 if(input.initialSubtype!==undefined&&!['L','H'].includes(input.initialSubtype))throw Error('native_switch_initial_subtype_unsupported')
 const companyId=randomUUID(),actorUserId=randomUUID(),customerId=randomUUID(),siteId=randomUUID(),pointId=randomUUID(),contractId=randomUUID(),gridId=randomUUID(),switchId=randomUUID(),routeId=randomUUID(),routeProfileId=randomUUID(),marketActor=randomUUID()
 const external=input.external??fixtureGsrn(),requestedStartDate=input.requestedStartDate??'2026-10-01'
 const customerIdentity='199001011234',organizationNumber='5590001243',brpEdielId='99876',marker={test_center:{kind:'invoice_test_customer'}}
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'Synthetic normal switch native','active');
 INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES(${literal(actorUserId)},'authenticated','authenticated',${literal(`${actorUserId}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actorUserId)},${literal(`${actorUserId}@example.invalid`)},'Synthetic normal switch actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(companyId)},${literal(actorUserId)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
 INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${literal(actorUserId)},'platform_admin',true);
 UPDATE public.company_capabilities SET enabled=true,readiness_status='ready' WHERE company_id=${literal(companyId)} AND capability_code='ediel_test';`)
 const sender=sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_legal_actor_identifier',0));
 WITH available AS (SELECT candidate::text value FROM generate_series(40000,49999) candidate WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) AND NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) ORDER BY candidate LIMIT 1), allocated AS (INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) SELECT ${literal(companyId)},'test',${literal(actorUserId)},'EdielId',value,clock_timestamp()-interval '1 day' FROM available RETURNING identifier_value) SELECT to_jsonb(identifier_value) FROM allocated;COMMIT;`)
 const receiver=sql<string>(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_dispatch_actor_identifier',0));WITH actor AS (INSERT INTO public.platform_market_actors(id,name,status,match_status,visible_to_tenants) VALUES(${literal(marketActor)},${literal(`Synthetic normal grid ${marketActor}`)},'active','verified',true) RETURNING id),available AS (SELECT candidate::text value FROM generate_series(60000,89999) candidate WHERE NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) ORDER BY candidate LIMIT 1),allocated AS (INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified) SELECT actor.id,'EdielId',available.value,true FROM actor CROSS JOIN available RETURNING identifier_value) SELECT to_jsonb(identifier_value) FROM allocated;COMMIT;`)
 const supplierEdielId=sender
 sql(`INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES(${literal(companyId)},'test','electricity',true,clock_timestamp()-interval '1 day');
 INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES(${literal(companyId)},'test',${literal(actorUserId)},'electricity_supplier',clock_timestamp()-interval '1 day');
 INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id) VALUES(${literal(companyId)},'test','Synthetic normal supplier',${literal(sender)},${literal(sender)});
 INSERT INTO public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name) VALUES(${literal(companyId)},'test',${literal(brpEdielId)},'Synthetic native BRP');
 INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status,owner_code) VALUES(${literal(gridId)},${literal(companyId)},'Synthetic normal grid',${literal(receiver)},'test',true,'active','TES');
 INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email) VALUES(${literal(routeId)},${literal(companyId)},'Synthetic normal route','supplier_switch',${literal(gridId)},'bilateral_test',true,'recipient@example.invalid');
 INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,application_reference,is_enabled,transport_security_mode,smtp_to,receiver_email,message_family,business_code) VALUES(${literal(routeProfileId)},${literal(companyId)},${literal(routeId)},'Synthetic normal profile','test','edifact',${literal(sender)},${literal(receiver)},'23-DDQ-PRODAT',true,'unencrypted','recipient@example.invalid','recipient@example.invalid','PRODAT','Z03');
 INSERT INTO public.platform_actor_roles(actor_id,actor_role,is_active) VALUES(${literal(marketActor)},'grid_owner',true);
 INSERT INTO public.platform_actor_routes(actor_id,message_family,environment,status,is_verified,application_reference,communication_type,communication_address,metadata) VALUES(${literal(marketActor)},'PRODAT','production','active',true,'23-DDQ-PRODAT','email','recipient@example.invalid','{"subaddress_status":"not_required_confirmed"}');
 INSERT INTO public.platform_actor_certificates(actor_id,environment,purpose,status,fingerprint_sha256,ediel_id,valid_to,raw_certificate_pem) VALUES(${literal(marketActor)},'production','encryption','valid','synthetic',${literal(receiver)},'2099-01-01','synthetic-readiness-only');`)
 const pricing={schema:'gridex_contract_pricing_v5',pricing_model:'spot',energy_direction:'consumption',interval_resolution:'hourly',vat_rate:0.25,
  price_areas:['SE3'],base_components:[{source_type:'spot',label:'Spotpris',weight_percent:100,price_area:'SE3'}],
  price_components:[{component_code:'spot_markup',component_type:'markup',name:'Påslag',calculation_type:'per_kwh',amount:4,unit:'ore_per_kwh',website_card_visible:true},
   {component_code:'monthly_fee',component_type:'fee',name:'Månadsavgift',calculation_type:'fixed_monthly',amount:49,unit:'sek_month',website_card_visible:true}]}
 const offer={name:`Synthetic archive ${contractId}`,slug:`synthetic-archive-${contractId}`,
  lifecycle_status:'draft',contract_type:'variable_hourly',customer_type:'both',pricing_model:'spot',energy_direction:'consumption',
  terms_version:'test-v1',spot_markup_ore_per_kwh:4,monthly_fee_sek:49,invoice_fee_sek:19,default_binding_months:0,
  default_notice_months:1,automatic_renewal:true,automatic_renewal_term_months:12,
  power_of_attorney_required:true,valid_from:'2026-09-24'}
 sql(`UPDATE public.companies SET legal_name='Synthetic Archive AB',org_number=${literal(organizationNumber)},
   address_line_1='Testgatan 1',postal_code='123 45',city='Teststad',country_code='SE',
   support_email='service@example.invalid',phone='0101234567',website='https://example.invalid'
  WHERE id=${literal(companyId)};`)
 const {data:created,error:createError}=await supabaseService.rpc('gridex_upsert_internal_contract_offer_v2',{
  p_company_id:companyId,p_offer_id:null,p_payload:offer,p_pricing_snapshot:pricing,p_actor_user_id:actorUserId,
 })
 expect(createError).toBeNull()
 const canonical=created as {ok?:boolean;code?:string;offer?:{id?:string}} | null
 expect(canonical,JSON.stringify(canonical)).toMatchObject({ok:true})
 const offerId=canonical?.offer?.id
 expect(offerId).toMatch(/^[0-9a-f-]{36}$/)
 // Publication readiness is part of the real canonical contract path. All
 // routing and legal rows below belong only to this disposable synthetic tenant.
 sql(`INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id)
  VALUES(${literal(companyId)},'production','Synthetic archive supplier',${literal(supplierEdielId)},${literal(supplierEdielId)});
  INSERT INTO public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name)
  VALUES(${literal(companyId)},'production',${literal(brpEdielId)},'Synthetic BRP');
  INSERT INTO public.ediel_route_profiles(company_id,environment,route_name,message_family)
  VALUES(${literal(companyId)},'production','Synthetic PRODAT','PRODAT'),
   (${literal(companyId)},'production','Synthetic UTILTS','UTILTS');
  INSERT INTO public.company_email_settings(company_id,sender_name,sender_email,verification_status)
  VALUES(${literal(companyId)},'Synthetic Archive','synthetic@example.invalid','verified');
  INSERT INTO public.company_email_templates(company_id,template_key,name,subject,body_html,is_active)
  VALUES(${literal(companyId)},'contract.confirmation_sent','Synthetic confirmation',
   'Synthetic confirmation','<p>Synthetic confirmation</p>',true);
  INSERT INTO public.email_event_rules(company_id,event_key,template_key,enabled)
  VALUES(${literal(companyId)},'contract.confirmation_sent','contract.confirmation_sent',true);
  UPDATE public.tenant_legal_profiles SET legal_name='Synthetic Archive AB',organization_number=${literal(organizationNumber)},
   postal_address='{"address_line_1":"Testgatan 1","postal_code":"123 45","city":"Teststad","country_code":"SE"}',
   customer_service_email='service@example.invalid',phone='0101234567',website='https://example.invalid',
   complaints_contact='{"email":"complaints@example.invalid"}',
   data_protection_contact='{"email":"privacy@example.invalid"}',
   billing_information='{"email":"billing@example.invalid"}',
   dispute_resolution_information='{"authority":"ARN","description":"Synthetic dispute contact for archive fixture"}',
   source_company_snapshot=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->'source_company_snapshot'
    FROM public.companies c WHERE c.id=${literal(companyId)}),
   source_company_snapshot_sha256=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->>'source_company_snapshot_sha256'
    FROM public.companies c WHERE c.id=${literal(companyId)}),
   review_required=false,reviewed_at=now() WHERE company_id=${literal(companyId)};`)
 expect(sql(`SELECT to_jsonb(has_actor_setting AND has_brp AND has_prodat_route AND has_utilts_route AND has_sender_identity)
  FROM public.platform_go_live_readiness_v WHERE company_id=${literal(companyId)}`)).toBe(true)
 expect(sql(`SELECT jsonb_build_object('verified',completeness_status='verified' AND NOT review_required,
  'missing',missing_fields,'source',source_company_snapshot->>'legal_name_source')
  FROM public.tenant_legal_profiles WHERE company_id=${literal(companyId)}`)).toEqual({verified:true,missing:[],source:'tenant_explicit'})
 const legalVersionId=sql<string>(`SELECT to_jsonb(public.gridex_materialize_legal_bundle_version(
  ${literal(companyId)},(SELECT contract_product_version_id FROM public.contract_offers WHERE id=${literal(offerId)}),
  NULL,${literal(actorUserId)}))`)
 expect(legalVersionId).toMatch(/^[0-9a-f-]{36}$/)
 sql(`UPDATE public.contract_offers SET legal_bundle_version_id=${literal(legalVersionId)} WHERE id=${literal(offerId)};`)
 const {data:published,error:publishError}=await supabaseService.rpc('gridex_publish_internal_contract_version',{
  p_company_id:companyId,p_offer_id:offerId,p_actor_user_id:actorUserId,
 })
 expect(publishError).toBeNull()
 expect(published,JSON.stringify(published)).toMatchObject({ok:true,mode:'published'})
 // Channel publication snapshots an active template tied to these immutable
 // product and plan versions. Give this synthetic offer one selectable price.
 sql(`WITH template AS (
  INSERT INTO public.contract_price_options(company_id,contract_product_version_id,
   price_plan_version_id,option_reference,option_code,customer_name,contract_type,
   binding_months,notice_months,auto_renew_enabled,renewal_term_months,status,
   customer_type,is_default,selection_required,created_by)
  SELECT ${literal(companyId)},contract_product_version_id,price_plan_version_id,
   'archive-default','archive-default','Synthetic hourly price','variable_hourly',
   0,1,true,12,'active','both',true,false,${literal(actorUserId)}
  FROM public.contract_offers WHERE id=${literal(offerId)}
  RETURNING id,company_id,price_plan_version_id
 ) INSERT INTO public.contract_price_option_area_prices(company_id,contract_price_option_id,
  price_plan_version_id,price_row_reference,price_area,amount,unit,created_by)
 SELECT company_id,id,price_plan_version_id,'archive-se3','SE3',4,'ore_per_kwh',
  ${literal(actorUserId)} FROM template;`)
 const {data:channel,error:channelError}=await supabaseService.rpc('gridex_publish_contract_channel',{
  p_company_id:companyId,p_offer_id:offerId,p_channel:'internal',p_actor_user_id:actorUserId,
 })
 expect(channelError).toBeNull()
 expect(channel,JSON.stringify(channel)).toMatchObject({ok:true,channel:'internal'})
 const publicationVersionId=(channel as {contract_publication_version_id?:string}|null)?.contract_publication_version_id
 expect(publicationVersionId).toMatch(/^[0-9a-f-]{36}$/)
 expect(sql(`SELECT to_jsonb(contract_product_version_id IS NOT NULL AND price_plan_version_id IS NOT NULL
  AND legal_bundle_version_id IS NOT NULL) FROM public.contract_offers WHERE id=${literal(offerId)}`)).toBe(true)
 sql(`INSERT INTO public.customers(id,company_id,first_name,last_name,name,customer_number,personal_number,email,source,is_test_data,metadata)
  VALUES(${literal(customerId)},${literal(companyId)},'Synthetic','Archive','Synthetic Own Customer',${literal(customerId)},${literal(customerIdentity)},${literal(`synthetic-${customerId}@example.invalid`)},'invoice_test_center',true,${literal(marker)}::jsonb);
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,facility_id,grid_owner_id,grid_area_code,price_area_code,status,is_test_data,metadata)
  VALUES(${literal(siteId)},${literal(companyId)},${literal(customerId)},'Archive site',${literal(external)},${literal(gridId)},'TES','SE3','active',true,${literal(marker)}::jsonb);
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,meter_point_id,metering_point_id,ediel_metering_point_id,grid_owner_id,grid_owner_ediel_id,grid_area_code,price_area_code,status,reading_frequency,measurement_type,is_settlement_relevant,is_test_data,metadata)
  VALUES(${literal(pointId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},${literal(siteId)},${literal(external)},${literal(external)},${literal(external)},${literal(gridId)},${literal(receiver)},'TES','SE3','active','hourly','consumption',true,true,${literal(marker)}::jsonb);
  INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,
   contract_offer_id,status,requested_start_date,starts_at,metadata,created_by,contract_publication_version_id,
   contract_product_id,contract_product_version_id,price_plan_id,price_plan_version_id,
   price_book_id,legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot)
  SELECT ${literal(contractId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},
   ${literal(pointId)},${literal(offerId)},'draft',${literal(requestedStartDate)}::date,${literal(requestedStartDate)}::date,${literal(marker)}::jsonb,
   ${literal(actorUserId)},v.id,p.contract_product_id,v.contract_product_version_id,
   v.price_plan_id,v.price_plan_version_id,v.price_book_id,v.legal_bundle_version_id,
   v.offer_reference,p.commercial_snapshot,l.rendered_snapshot
  FROM public.contract_publication_versions v
  JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id
  JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id
  WHERE v.id=${literal(publicationVersionId)} AND v.status='published';`)
 expect(sql(`SELECT to_jsonb(contract_publication_version_id IS NOT NULL AND contract_product_version_id IS NOT NULL
  AND price_plan_version_id IS NOT NULL AND legal_bundle_version_id IS NOT NULL)
  FROM public.customer_contracts WHERE id=${literal(contractId)}`)).toBe(true)
 {
  const signed=await signInvoiceTestContractCanonically({companyId,customerId,contractId,actorUserId})
  expect(signed).toMatchObject({status:'signed',signature_snapshot_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})
  const signedFacts=sql<{old:string;next:string;signedAt:string|null}[]>(`SELECT jsonb_agg(jsonb_build_object(
   'old',old_fact->>'status','next',new_fact->>'status','signedAt',new_fact->>'signed_at') ORDER BY id)
   FROM gridex_correction_process.facts WHERE table_name='customer_contracts' AND row_id=${literal(contractId)}
    AND operation='UPDATE' AND new_fact->>'status'='signed'`)
  expect(signedFacts).toEqual([{old:'pending_signature',next:'signed',signedAt:expect.any(String)}])
 }

 // The native PDF archive is produced from the actual signed publication and
 // signature records. Its digest is bound once through the ordinary document
 // owner; a ready flag never substitutes for storage/readback evidence.
 const signed=sql<Record<string,unknown>>(`SELECT to_jsonb(c) FROM public.customer_contracts c WHERE id=${literal(contractId)}`)
 const legalVersions=sql<{type:string;title:string;version:string;id:string;body:string}[]>(`SELECT jsonb_agg(jsonb_build_object('type',module_key,'title',title,'version',coalesce(template_version,left(content_sha256,12)),'id',id,'body',rendered_body)) FROM public.legal_bundle_version_documents WHERE legal_bundle_version_id=${literal(signed.legal_bundle_version_id)}`)
 const attachment=buildAgreementPdfAttachment({companyName:'Synthetic Archive AB',organizationNumber,customerName:'Synthetic Own Customer',customerEmail:`synthetic-${customerId}@example.invalid`,customerNumber:customerId,contractNumber:String(signed.contract_number??contractId),contractName:'Synthetic native hourly',contractType:'variable_hourly',signedAt:String(signed.signed_at),startsAt:requestedStartDate,offerReference:String(signed.offer_reference),contractPublicationVersionId:String(signed.contract_publication_version_id),pricePlanVersionId:String(signed.price_plan_version_id),legalBundleVersionId:String(signed.legal_bundle_version_id),signatureSnapshotSha256:String(signed.signature_snapshot_sha256),legalVersions,monthlyFeeSek:49,spotMarkupOrePerKwh:4})
 const pdfBuffer=Buffer.from(attachment.content,'base64'),documentSha256=createHash('sha256').update(pdfBuffer).digest('hex')
 await archiveSignedCustomerContractPdf({companyId,customerContractId:contractId,pdfBuffer,documentSha256,generationSnapshot:{schema:'gridex_signed_contract_document_v1',contract_id:contractId,signature_snapshot_sha256:signed.signature_snapshot_sha256,synthetic:true}})
 const bound=await supabaseService.from('customer_contracts').update({document_sha256:documentSha256}).eq('id',contractId).eq('company_id',companyId).is('document_sha256',null);expect(bound.error).toBeNull()
 // Explicit test-only manual authorization is created by its existing public
 // admin writer and exact chain helper. It is a declared synthetic legal fact,
 // never a private owner receipt or claim of real customer authentication.
 const poa=await savePowerOfAttorney(supabaseService,{customer_id:customerId,site_id:siteId,companyId,scope:'supplier_switch',status:'draft',signed_at:null,valid_from:'2026-01-01',valid_to:'2099-01-01',method:'manual_pdf',signer_name:'Synthetic Own Customer',signer_identity_number:customerIdentity,accepted_at:null,accepted_source:'synthetic_native_fixture',signedScopes:[],scopeSummary:{scopes:['supplier_switch','grid_owner_data','metering_data']}})
 const poaLink=await supabaseService.from('powers_of_attorney').update({contract_id:contractId,customer_contract_id:contractId}).eq('id',poa.id).eq('company_id',companyId);expect(poaLink.error).toBeNull()
 await savePowerOfAttorney(supabaseService,{id:poa.id,customer_id:customerId,site_id:siteId,companyId,scope:'supplier_switch',status:'signed',signed_at:new Date().toISOString(),valid_from:'2026-01-01',valid_to:'2099-01-01',method:'manual_pdf',signer_name:'Synthetic Own Customer',signer_identity_number:customerIdentity,accepted_at:new Date().toISOString(),accepted_source:'synthetic_native_fixture',signedScopes:['supplier_switch','grid_owner_data','metering_data'],scopeSummary:{scopes:['supplier_switch','grid_owner_data','metering_data']}})
 const authorization=await ensureAuthorizationDocumentFromPowerOfAttorney({companyId,customerId,powerOfAttorneyId:poa.id,siteId,meteringPointId:pointId,contractId})
 const authorizationDocumentId=authorization.authorizationDocumentId;expect(authorizationDocumentId).toBeTruthy()
 expect(sql(`SELECT to_jsonb(switch_ready) FROM public.customer_contract_lifecycle_readiness_v WHERE customer_contract_id=${literal(contractId)}`)).toBe(true)
 sql(`INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,grid_owner_id,contract_id,customer_contract_id,power_of_attorney_id,authorization_document_id,request_type,status,requested_start_date,prodat_variant,prodat_reason,lifecycle_blocked) VALUES(${literal(switchId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},${literal(siteId)},${literal(pointId)},${literal(gridId)},${literal(contractId)},${literal(contractId)},${literal(poa.id)},${literal(authorizationDocumentId)},'switch','ready',${literal(requestedStartDate)},${literal(input.initialSubtype??'L')},${literal(input.initialSubtype==='H'?'Z25':'Z22')},false);`)
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(actorUserId)},${literal(companyId)},id,key FROM public.permissions
 WHERE key IN('communication.read','communication.write','communication.send','metering.read','metering.write','operations.read','operations.write','contracts.read','contracts.write','customers.read','customers.write');
 DELETE FROM public.admin_users WHERE user_id=${literal(actorUserId)};`)
 for(const permission of ['communication.read','communication.write','communication.send','metering.read','metering.write'])expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(actorUserId)},${literal(companyId)},${literal(permission)}))`)).toBe(true)
 const stage:NormalSwitchStageNativeFixture={companyId,actorUserId,customerId,siteId,pointId,contractId,switchId,external,sender,receiver,gridId,routeId,routeProfileId,marketActorId:marketActor,customerIdentity:{id:customerIdentity,qualifier:'SE2',agency:'260'},requestedStartDate,brpEdielId,gridAreaCode:'TES',documentSha256,authorizationDocumentId:authorizationDocumentId!,powerOfAttorneyId:poa.id}
 if(input.deferOriginal){expect(sql(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(companyId)}),'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(companyId)}),'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(companyId)}))`)).toEqual({messages:0,originals:0,periods:0});return stage}
 const queued=await prepareAndQueueEdielZ03({actorUserId,switchRequestId:switchId,communicationRouteId:routeId,environment:'test'})
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.switch_originals WHERE message_id=${literal(queued.id)}`)).toBe(1)
 if(input.provider){input.provider('recipient@example.invalid');await sendEdielMessageViaSmtp(queued,{actorUserId,smtpMimeMode:'nodemailer-attachment'})}
 const originalZ03=await getEdielMessageById(queued.id);expect(originalZ03).not.toBeNull()
 const tokenized=tokenizeEdifact(originalZ03!.raw_payload!),li=tokenized.segments.find(t=>t.tag==='RFF'&&segmentComposite(t,1,tokenized.una)[0]==='LI'),caseReference=li?segmentComposite(li,1,tokenized.una)[1]:null;expect(caseReference).toBeTruthy()
 if(input.provider)expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(queued.id)}`)).toBe(true)
 return {...stage,caseReference:caseReference!,originalZ03:originalZ03!}
}
