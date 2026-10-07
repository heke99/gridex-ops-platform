// Shared native fixture owns only synthetic local tenants. Real publication,
// signature, archive, Z03 origination and provider-owner ports produce evidence.
// Only external SMTP is injected by the caller; no private ready/accepted row
// is seeded. Synthetic contract/POA acceptance is not an external issuer proof.
import {execFileSync} from 'node:child_process'
import {createHmac,createHash,randomUUID} from 'node:crypto'
import {expect} from 'vitest'
import {supabaseService} from '@/lib/supabase/service'
import {signInvoiceTestContractCanonically} from '@/lib/ediel/testing/invoiceTestContractLifecycle'
import {archiveSignedCustomerContractPdf} from '@/lib/customer-contracts/documents'
import {buildAgreementPdfAttachment} from '@/lib/customer-contracts/agreementPdf'
import {savePowerOfAttorney} from '@/lib/operations/db'
import {ensureAuthorizationDocumentFromPowerOfAttorney} from '@/lib/legal/authorizationChain'
import {powerOfAttorneyCoverageFromScopes} from '@/lib/operations/powerOfAttorneyWorkflow'
import {prepareAndQueueEdielZ03} from '@/lib/ediel/flows/prodatSwitch'
import {sendEdielMessageViaSmtp} from '@/lib/ediel/transport'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {getEdielMessageById} from '@/lib/ediel/db'
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer'
import {syntheticSwedishOrganizationNumber} from '../../e2e/production/helpers/swedish-organization-number.mjs'
import {nativeFixtureCompanyIdentitySql} from './native-fixture-company-identity'
// Legacy random Luhn candidate; it does not reserve database uniqueness.
// Normal-switch fixtures use the atomic company allocation below instead.
export function fixtureOrganizationNumber(){
 const body='55'+String(Math.floor(Math.random()*1e7)).padStart(7,'0')
 const sum=[...body].reduce((total,digit,index)=>{const value=Number(digit)*(index%2===0?2:1);return total+(value>9?value-9:value)},0)
 return body+String((10-sum%10)%10)
}
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
const networkRegistries=new Map<string,{artifact:{artifactId:string;sourceHash:string;claimsHash:string};reviewerId:string}>()
/** The qualified network registry version this fixture created for a company. */
export function normalSwitchNetworkRegistry(companyId:string){return networkRegistries.get(companyId)}
/** A supply start that is still in the future when the suite runs: Swedish
 * calendar today plus `days`. Fixed literal dates go stale once passed. */
/** The canonical tenant context lists a membership only with an active role
 * assignment. A disposable non-system role grants no permission; the user's
 * authority stays its explicit user_permissions. */
export function nativeActorRoleSql(companyId:string,userId:string){
 const role=randomUUID(),key=`native_actor_${role}`
 return `INSERT INTO public.roles(id,key,name,scope) VALUES(${literal(role)},${literal(key)},'Disposable native actor role','company');
  INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES(${literal(userId)},${literal(companyId)},${literal(role)},${literal(key)},'active',true);`
}
export function futureNativeSupplyDate(days=14){
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 const date=new Date(`${today}T00:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10)
}
export type NormalSwitchStageNativeFixture={companyId:string;actorUserId:string;customerId:string;siteId:string;pointId:string;contractId:string;switchId:string;external:string;sender:string;receiver:string;gridId:string;routeId:string;routeProfileId:string;marketActorId:string;customerIdentity:{id:string;qualifier:'SE2';agency:'260'};requestedStartDate:string;brpEdielId:string;gridAreaCode:string;documentSha256:string;authorizationDocumentId:string;powerOfAttorneyId:string}
export type NormalSwitchNativeRequestInput=Omit<NormalSwitchStageNativeFixture,'switchId'>&{invoiceeSnapshot:Record<string,unknown>}
export type NormalSwitchFixtureInput={requestedStartDate?:string;external?:string;provider?:(email:string)=>void;initialSubtype?:'L'|'H';customerName?:string;bindingMonths?:number;billingAddress?:{street:string;postalCode:string;city:string;country:string};createSwitchRequest?:(input:NormalSwitchNativeRequestInput)=>Promise<string>}
export function seedNormalSwitchNativeFixture(input:NormalSwitchFixtureInput&{deferOriginal:true}):Promise<NormalSwitchStageNativeFixture>
export function seedNormalSwitchNativeFixture(input?:NormalSwitchFixtureInput&{deferOriginal?:false}):Promise<NormalSwitchStageNativeFixture&{caseReference:string;originalZ03:EdielMessageRow}>
export async function seedNormalSwitchNativeFixture(input:NormalSwitchFixtureInput&{deferOriginal?:boolean}={}){
 const customerName=input.customerName??'Synthetic Own Customer'
 const bindingMonths=input.bindingMonths??0
 if(!Number.isInteger(bindingMonths)||bindingMonths<0)throw Error('native_switch_binding_months_invalid')
 if(input.billingAddress&&Object.values(input.billingAddress).some(value=>!value.trim()))throw Error('native_switch_billing_address_incomplete')
 if(input.initialSubtype!==undefined&&!['L','H'].includes(input.initialSubtype))throw Error('native_switch_initial_subtype_unsupported')
 const companyId=randomUUID(),actorUserId=randomUUID(),customerId=randomUUID(),siteId=randomUUID(),pointId=randomUUID(),contractId=randomUUID(),gridId=randomUUID(),switchId=randomUUID(),routeId=randomUUID(),routeProfileId=randomUUID(),marketActor=randomUUID()
 const external=input.external??fixtureGsrn(),requestedStartDate=input.requestedStartDate??'2026-10-01'
 const customerIdentity='199001011234',brpEdielId='99876',marker={test_center:{kind:'invoice_test_customer'}}
 sql(`INSERT INTO public.companies(id,name,status) VALUES(${literal(companyId)},'Synthetic normal switch native','active');
 INSERT INTO auth.users(instance_id,confirmation_token,recovery_token,email_change_token_new,email_change,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous) VALUES('00000000-0000-0000-0000-000000000000','','','','',${literal(actorUserId)},'authenticated','authenticated',${literal(`${actorUserId}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
 INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(actorUserId)},${literal(`${actorUserId}@example.invalid`)},'Synthetic normal switch actor','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) VALUES(${literal(companyId)},${literal(actorUserId)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
 -- A separate guardian tenant admin (no Ediel role/permission): revoking the
 -- acting user's membership must not trip guard_last_functioning_tenant_admin.
 WITH guardian AS(SELECT gen_random_uuid() id),u AS(INSERT INTO auth.users(instance_id,confirmation_token,recovery_token,email_change_token_new,email_change,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
  SELECT '00000000-0000-0000-0000-000000000000','','','','',id,'authenticated','authenticated',id||'@example.invalid',now(),'{}','{}',now(),now(),false,false FROM guardian RETURNING id),
 p AS(INSERT INTO public.user_profiles(id,email,full_name,user_status) SELECT id,id||'@example.invalid','Synthetic guardian tenant admin','active' FROM u RETURNING id)
 INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key) SELECT ${literal(companyId)},id,'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin' FROM p;
  ${nativeActorRoleSql(companyId,actorUserId)}
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
  terms_version:'test-v1',spot_markup_ore_per_kwh:4,monthly_fee_sek:49,invoice_fee_sek:19,default_binding_months:bindingMonths,
  default_notice_months:1,automatic_renewal:true,automatic_renewal_term_months:12,
  power_of_attorney_required:true,valid_from:'2026-09-24'}
 const organizationNumber=sql<string>(nativeFixtureCompanyIdentitySql(companyId,
  Array.from({length:32},(_,attempt)=>syntheticSwedishOrganizationNumber(`normal-switch:${companyId}:${attempt}`))))
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
   ${bindingMonths},1,true,12,'active','both',true,false,${literal(actorUserId)}
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
  VALUES(${literal(customerId)},${literal(companyId)},'Synthetic','Archive',${literal(customerName)},${literal(customerId)},${literal(customerIdentity)},${literal(`synthetic-${customerId}@example.invalid`)},'invoice_test_center',true,${literal(marker)}::jsonb);
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,facility_id,grid_owner_id,grid_area_code,price_area_code,status,is_test_data,metadata)
  VALUES(${literal(siteId)},${literal(companyId)},${literal(customerId)},'Archive site',${literal(external)},${literal(gridId)},'TES','SE3','active',true,${literal(marker)}::jsonb);
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,meter_point_id,metering_point_id,ediel_metering_point_id,grid_owner_id,grid_owner_ediel_id,grid_area_code,price_area_code,status,reading_frequency,measurement_type,product_direction,is_settlement_relevant,is_test_data,metadata)
  VALUES(${literal(pointId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},${literal(siteId)},${literal(external)},${literal(external)},${literal(external)},${literal(gridId)},${literal(receiver)},'TES','SE3','active','hourly','consumption','consumption',true,true,${literal(marker)}::jsonb);
  INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,
   contract_offer_id,status,contract_version,requested_start_date,starts_at,metadata,created_by,contract_publication_version_id,
   contract_product_id,contract_product_version_id,price_plan_id,price_plan_version_id,
   price_book_id,legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot)
  SELECT ${literal(contractId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},
   ${literal(pointId)},${literal(offerId)},'draft','v1',${literal(requestedStartDate)}::date,${literal(requestedStartDate)}::date,${literal(marker)}::jsonb,
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
 // Optional synthetic source inputs belong to the original draft, before
 // canonical signature, price snapshot and PDF/POA capture. Never change a
 // signed contract to manufacture a conditional native branch.
 if(input.billingAddress){
  const address=input.billingAddress
  sql(`UPDATE public.customer_contracts SET billing_address_same_as_site=false,
   billing_street=${literal(address.street)},billing_postal_code=${literal(address.postalCode)},
   billing_city=${literal(address.city)},billing_country=${literal(address.country)}
   WHERE id=${literal(contractId)} AND company_id=${literal(companyId)} AND status='draft';`)
  expect(sql(`SELECT jsonb_build_object('street',billing_street,'postalCode',billing_postal_code,'city',billing_city,'country',billing_country)
   FROM public.customer_contracts WHERE id=${literal(contractId)} AND status='draft'`)).toEqual(address)
 }
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
 const attachment=buildAgreementPdfAttachment({companyName:'Synthetic Archive AB',organizationNumber,customerName,customerEmail:`synthetic-${customerId}@example.invalid`,customerNumber:customerId,contractNumber:String(signed.contract_number??contractId),contractName:'Synthetic native hourly',contractType:'variable_hourly',signedAt:String(signed.signed_at),startsAt:requestedStartDate,offerReference:String(signed.offer_reference),contractPublicationVersionId:String(signed.contract_publication_version_id),pricePlanVersionId:String(signed.price_plan_version_id),legalBundleVersionId:String(signed.legal_bundle_version_id),signatureSnapshotSha256:String(signed.signature_snapshot_sha256),legalVersions,monthlyFeeSek:49,spotMarkupOrePerKwh:4})
 const pdfBuffer=Buffer.from(attachment.content,'base64'),documentSha256=createHash('sha256').update(pdfBuffer).digest('hex')
 await archiveSignedCustomerContractPdf({companyId,customerContractId:contractId,pdfBuffer,documentSha256,generationSnapshot:{schema:'gridex_signed_contract_document_v1',contract_id:contractId,signature_snapshot_sha256:signed.signature_snapshot_sha256,synthetic:true}})
 const bound=await supabaseService.from('customer_contracts').update({document_sha256:documentSha256}).eq('id',contractId).eq('company_id',companyId).is('document_sha256',null);expect(bound.error).toBeNull()
 // Every new-agreement Z03 needs the receiver's qualified network registry
 // version (requested-method/legal header basis). Qualify it through the real
 // archive and separate-reviewer owners, with the synthetic issuer boundary.
 const {attachNetworkRegistrySourceFixture}=await import('./ediel-network-registry-native-fixture')
 const {archiveNetworkRegistrySource,reviewNetworkRegistrySource}=await import('@/lib/ediel/production/networkRegistrySource')
 const registry=await attachNetworkRegistrySourceFixture({companyId,actorUserId,receiver})
 const networkArtifact=await archiveNetworkRegistrySource({...registry.submission('SYNTHETIC normal switch network original',registry.pdf('normal switch network')),companyId,actorUserId:registry.uploader.id});expect(networkArtifact.missing).toEqual([])
 const networkReview=await reviewNetworkRegistrySource({...networkArtifact,companyId,actorUserId:registry.reviewer.id,decision:'approve',reason:'SYNTHETIC separate review of the switch network original',clause:registry.clause});expect(networkReview.status).toBe('authorized')
 networkRegistries.set(companyId,{artifact:networkArtifact,reviewerId:registry.reviewer.id})
 // A first supply's field262 needs a signed same-agreement BRP declaration
 // over an approved BRP registry ground. Seed the SYNTHETIC registry ground and
 // issuer boundary, then use the real scope/archive/separate-review owners.
 const brpActor=sql<string>(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('native_brp_actor_${brpEdielId}',0));
 WITH existing AS (SELECT actor_id FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=${literal(brpEdielId)} ORDER BY actor_id LIMIT 1),
 created AS (INSERT INTO public.platform_market_actors(id,name,status,match_status,visible_to_tenants) SELECT gen_random_uuid(),'Synthetic native BRP','active','verified',true WHERE NOT EXISTS(SELECT FROM existing) RETURNING id),
 ident AS (INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified) SELECT id,'EdielId',${literal(brpEdielId)},true FROM created RETURNING actor_id)
 SELECT to_jsonb(coalesce((SELECT actor_id FROM existing),(SELECT actor_id FROM ident)));COMMIT;`)
 sql(`INSERT INTO public.platform_actor_roles(actor_id,actor_role,is_active) SELECT ${literal(brpActor)},'balance_responsible',true WHERE NOT EXISTS(SELECT FROM public.platform_actor_roles WHERE actor_id=${literal(brpActor)} AND actor_role='balance_responsible' AND is_active);
 INSERT INTO public.platform_actor_roles(actor_id,actor_role,is_active) SELECT ${literal(marketActor)},'grid_owner',true WHERE NOT EXISTS(SELECT FROM public.platform_actor_roles WHERE actor_id=${literal(marketActor)} AND actor_role='grid_owner' AND is_active)`)
 const registryGroundId=randomUUID(),brpRegistrySource=Buffer.from('SYNTHETIC BRP registry ground '+registryGroundId)
 sql(`INSERT INTO gridex_brp_changes.registry_grounds(id,company_id,environment,dso_actor_id,brp_actor_id,dso_ediel_id,brp_ediel_id,grid_area_code,registry_version,source_reference,source_sha256,registry_snapshot,approved_by,approved_at,valid_from)
  SELECT ${literal(registryGroundId)},${literal(companyId)},'test',${literal(marketActor)},${literal(brpActor)},${literal(receiver)},${literal(brpEdielId)},p.grid_area_code,'SYNTHETIC-1',${literal('SYNTHETIC native BRP registry '+registryGroundId)},${literal(createHash('sha256').update(brpRegistrySource).digest('hex'))},gridex_brp_changes.registry_snapshot_v1(${literal(marketActor)},${literal(brpActor)}),${literal(actorUserId)},clock_timestamp(),'2026-01-01T00:00:00Z'
  FROM public.metering_points p WHERE p.id=${literal(pointId)}`)
 const {createBilateralSourceOperator}=await import('./ediel-bilateral-customer-native-fixture')
 const brpUploader=await createBilateralSourceOperator(companyId,['communication.read','communication.write','customers.read','customers.write','contracts.read','contracts.write'])
 const brpReviewer=await createBilateralSourceOperator(companyId,['communication.read','communication.write','customers.read','customers.write','contracts.read','contracts.write','ediel.source.review'])
 const brpSelector={environment:'test' as const,contractId,registryGroundId,identityAgency:'9' as const}
 const brpScope=await brpUploader.client.rpc('ediel_signed_brp_declaration_scope_v1',{p_company_id:companyId,p_actor_user_id:brpUploader.id,p_selector:{...brpSelector,agreementHash:documentSha256}})
 expect(brpScope.error,JSON.stringify(brpScope.error)).toBeNull();expect(brpScope.data,JSON.stringify(brpScope.data)).toMatchObject({status:'scope_available'})
 const brpKey=randomUUID(),brpRepresentation=randomUUID(),brpSecret=Buffer.from('SYNTHETIC BRP declaration issuer key '+brpKey),brpLegal='SYNTHETIC BRP DECLARATION ISSUER ONLY',brpRepresentationLegal='SYNTHETIC BRP DECLARATION REPRESENTATION ONLY'
 sql(`INSERT INTO gridex_brp_declaration_intake.issuer_keys(id,company_id,environment,issuer_code,legal_source_reference,legal_source_sha256,signing_key,valid_from,valid_to) VALUES(${literal(brpKey)},${literal(companyId)},'test','SYNTHETIC',${literal(brpLegal)},${literal(createHash('sha256').update(brpLegal).digest('hex'))},decode(${literal(brpSecret.toString('hex'))},'hex'),'2020-01-01','2099-01-01');
 INSERT INTO gridex_brp_declaration_intake.issuer_representations(id,company_id,environment,issuer_key_id,legal_actor_id,purpose,legal_source_reference,legal_source_sha256,valid_from,valid_to) VALUES(${literal(brpRepresentation)},${literal(companyId)},'test',${literal(brpKey)},${literal((brpScope.data as {claims:{legalActorId:string}}).claims.legalActorId)},'signed_contract_brp_declaration',${literal(brpRepresentationLegal)},${literal(createHash('sha256').update(brpRepresentationLegal).digest('hex'))},'2020-01-01','2099-01-01')`)
 const brpSource=Buffer.from('SYNTHETIC signed BRP declaration source '+contractId),brpSourceReference='SYNTHETIC-native-brp-'+contractId
 const brpClaimsHash=(brpScope.data as {claimsHash:string}).claimsHash,issuedAt=new Date(Date.now()-60000).toISOString(),expiresAt=new Date(Date.now()+86400000).toISOString()
 const brpPayload=Buffer.from(JSON.stringify({format:'ediel_signed_brp_declaration_receipt_v1',purpose:'signed_contract_brp_declaration',companyId,environment:'test',issuerCode:'SYNTHETIC',receiptId:randomUUID(),issuerLegalReference:brpLegal,representationLegalReference:brpRepresentationLegal,claimsHash:brpClaimsHash,agreementHash:documentSha256,sourceHash:createHash('sha256').update(brpSource).digest('hex'),sourceReference:brpSourceReference,sourceVersion:'1',issuedAt,expiresAt}))
 const brpArchive=await brpUploader.client.rpc('ediel_archive_signed_brp_declaration_v1',{p_company_id:companyId,p_actor_user_id:brpUploader.id,p_submission:{...brpSelector,agreementBase64:pdfBuffer.toString('base64'),sourceBase64:brpSource.toString('base64'),sourceReference:brpSourceReference,sourceVersion:'1',issuerReceipt:{keyId:brpKey,representationId:brpRepresentation,payloadBase64:brpPayload.toString('base64'),signatureHex:createHmac('sha256',brpSecret).update(brpPayload).digest('hex')}}})
 expect(brpArchive.error,JSON.stringify(brpArchive.error)).toBeNull();expect(brpArchive.data).toMatchObject({status:'archived',issuerQualified:true})
 const archivedBrp=brpArchive.data as {artifactId:string;agreementHash:string;sourceHash:string;claimsHash:string}
 const brpReview=await brpReviewer.client.rpc('ediel_review_signed_brp_declaration_v1',{p_company_id:companyId,p_actor_user_id:brpReviewer.id,p_artifact_id:archivedBrp.artifactId,p_review:{agreementHash:archivedBrp.agreementHash,sourceHash:archivedBrp.sourceHash,claimsHash:archivedBrp.claimsHash,decision:'approve',reason:'SYNTHETIC separate review of the signed BRP declaration',clause:{locator:'page1 synthetic',quote:'SYNTHETIC balance responsible party declaration'}}})
 expect(brpReview.error,JSON.stringify(brpReview.error)).toBeNull();expect(brpReview.data,JSON.stringify(brpReview.data)).toMatchObject({status:'authorized'})
 // End-user UD masterdata for a dated (future) switch day cannot come from
 // today's registered address. Bind a declared SYNTHETIC signed masterdata
 // declaration to this exact signed contract (same agreement bytes, revision
 // and production contract hash). It is a fixture fact, never real approval.
 const declarationSource=Buffer.from('SYNTHETIC signed customer masterdata declaration '+contractId)
 sql(`INSERT INTO gridex_customer_masterdata.signed_declarations(company_id,customer_id,environment,contract_id,contract_revision,contract_hash,agreement_original,agreement_sha256,valid_from,customer_identity,end_user_masterdata,source_reference,source_version,source_original,source_sha256,approved_by,approved_at)
  SELECT c.company_id,c.customer_id,'test',c.id,c.signed_version,gridex_received_sources.production_contract_hash_v1(c),decode(${literal(pdfBuffer.toString('hex'))},'hex'),${literal(documentSha256)},'2026-01-01T00:00:00Z',
  jsonb_build_object('id',${literal(customerIdentity)},'qualifier','SE2','agency','260'),
  jsonb_build_object('nameParts',jsonb_build_array(${literal(customerName)}),'streetParts',jsonb_build_array('Testgatan 1'),'postalCode','123 45','city','Teststad','country','SE'),
  ${literal('SYNTHETIC-native-masterdata-'+contractId)},'1',decode(${literal(declarationSource.toString('hex'))},'hex'),${literal(createHash('sha256').update(declarationSource).digest('hex'))},${literal(actorUserId)},clock_timestamp()
  FROM public.customer_contracts c WHERE c.id=${literal(contractId)} AND c.company_id=${literal(companyId)}`)
 // The new agreement's requested metering method is its own signed source.
 // Bind a declared SYNTHETIC method declaration to the same contract bytes and
 // the point/grid/legal header actually seeded above (hourly Z04).
 const methodSource=Buffer.from('SYNTHETIC signed new-agreement requested method '+contractId)
 sql(`INSERT INTO gridex_metering_method_changes.contract_request_declarations(company_id,environment,contract_id,contract_revision,protected_contract_hash,customer_id,site_id,metering_point_id,legal_actor_id,legal_sender_id,legal_receiver_id,point_id,identity_agency,grid_area_code,requested_method,agreement_original,agreement_sha256,source_reference,source_version,source_original,source_sha256,approved_by,approved_at)
  SELECT c.company_id,'test',c.id,c.signed_version,gridex_received_sources.production_contract_hash_v1(c),c.customer_id,coalesce(c.customer_site_id,c.site_id),c.metering_point_id,
  (gridex_ai_processing.header_company_basis_v1(c.company_id,'test',${literal(sender)},p.grid_owner_ediel_id)->>'legalActorId')::uuid,${literal(sender)},p.grid_owner_ediel_id,
  coalesce(nullif(p.ediel_metering_point_id,''),nullif(p.meter_point_id,'')),'9',p.grid_area_code,'Z04',decode(${literal(pdfBuffer.toString('hex'))},'hex'),${literal(documentSha256)},
  ${literal('SYNTHETIC-native-method-'+contractId)},'1',decode(${literal(methodSource.toString('hex'))},'hex'),${literal(createHash('sha256').update(methodSource).digest('hex'))},${literal(actorUserId)},clock_timestamp()
  FROM public.customer_contracts c JOIN public.metering_points p ON p.id=c.metering_point_id WHERE c.id=${literal(contractId)} AND c.company_id=${literal(companyId)}`)
 // Explicit test-only manual authorization is created by its existing public
 // admin writer and exact chain helper. It is a declared synthetic legal fact,
 // never a private owner receipt or claim of real customer authentication.
 const poaReference=`POA${switchId.replace(/-/g,'').slice(0,12).toUpperCase()}`
 const poa=await savePowerOfAttorney(supabaseService,{customer_id:customerId,site_id:siteId,companyId,reference:poaReference,scope:'supplier_switch',status:'draft',signed_at:null,valid_from:'2026-01-01',valid_to:'2099-01-01',method:'manual_pdf',signer_name:customerName,signer_identity_number:customerIdentity,accepted_at:null,accepted_source:'synthetic_native_fixture',signedScopes:['supplier_switch','grid_owner_data','metering_data'],scopeSummary:{scopes:['supplier_switch','grid_owner_data','metering_data']}})
 const poaLink=await supabaseService.from('powers_of_attorney').update({contract_id:contractId,customer_contract_id:contractId}).eq('id',poa.id).eq('company_id',companyId);expect(poaLink.error).toBeNull()
 await savePowerOfAttorney(supabaseService,{id:poa.id,customer_id:customerId,site_id:siteId,companyId,reference:poaReference,scope:'supplier_switch',status:'signed',signed_at:new Date().toISOString(),valid_from:'2026-01-01',valid_to:'2099-01-01',method:'manual_pdf',signer_name:customerName,signer_identity_number:customerIdentity,accepted_at:new Date().toISOString(),accepted_source:'synthetic_native_fixture',signedScopes:['supplier_switch','grid_owner_data','metering_data'],scopeSummary:{scopes:['supplier_switch','grid_owner_data','metering_data']}})
 const poaScopes=['supplier_switch','grid_owner_data','metering_data']
 const authorization=await ensureAuthorizationDocumentFromPowerOfAttorney({companyId,customerId,powerOfAttorneyId:poa.id,siteId,meteringPointId:pointId,contractId,coverage:powerOfAttorneyCoverageFromScopes(poaScopes),signedScopes:poaScopes})
 const authorizationDocumentId=authorization.authorizationDocumentId;expect(authorizationDocumentId).toBeTruthy()
 expect(sql(`SELECT to_jsonb(switch_ready) FROM public.customer_contract_lifecycle_readiness_v WHERE customer_contract_id=${literal(contractId)}`)).toBe(true)
 // P26.A: the invoicee is an independent caller selection, never inferred.
 // The synthetic selection names the end user at the same address.
 const invoiceeAddress={lines:['Testgatan 1','',''],postalCode:'123 45',city:'Teststad',country:'SE',representation:{convention:'original',reference:'SYNTHETIC',mode:1}}
 const invoiceeSnapshot={portalData:{powerOfAttorneyReference:poaReference,dependentConditionFacts:{invoiceeObjects:[{meteringPointId:external,identityAgency:'9',
  endUser:{identity:{id:customerIdentity,qualifier:'SE2',agency:'260'},address:invoiceeAddress},
  invoicee:{identity:{id:customerIdentity,qualifier:'SE2',agency:'260'},nameLines:[customerName],address:invoiceeAddress,availability:'available'},
  event:{state:'none',reference:`fixture-invoicee:${switchId}`},source:{kind:'caller_selection',companyId,reference:`fixture-invoicee:${switchId}`}}]}}}
 // An opt-in caller may exercise its public request creator before any case
 // exists. Existing callers retain their exact prospective SQL input below.
 let createdSwitchId:string=switchId
 if(input.createSwitchRequest){
  createdSwitchId=await input.createSwitchRequest({companyId,actorUserId,customerId,siteId,pointId,contractId,external,sender,receiver,gridId,routeId,routeProfileId,marketActorId:marketActor,customerIdentity:{id:customerIdentity,qualifier:'SE2',agency:'260'},requestedStartDate,brpEdielId,gridAreaCode:'TES',documentSha256,authorizationDocumentId:authorizationDocumentId!,powerOfAttorneyId:poa.id,invoiceeSnapshot})
 }else{
 sql(`INSERT INTO public.supplier_switch_requests(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,grid_owner_id,contract_id,customer_contract_id,power_of_attorney_id,authorization_document_id,request_type,status,requested_start_date,prodat_variant,prodat_reason,lifecycle_blocked,validation_snapshot) VALUES(${literal(switchId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},${literal(siteId)},${literal(pointId)},${literal(gridId)},${literal(contractId)},${literal(contractId)},${literal(poa.id)},${literal(authorizationDocumentId)},'switch','ready',${literal(requestedStartDate)},${literal(input.initialSubtype??'L')},${literal(input.initialSubtype==='H'?'Z25':'Z22')},false,${literal(JSON.stringify(invoiceeSnapshot))}::jsonb);`)
 }
 sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
 SELECT ${literal(actorUserId)},${literal(companyId)},id,key FROM public.permissions
 WHERE key IN('communication.read','communication.write','communication.send','metering.read','metering.write','operations.read','operations.write','contracts.read','contracts.write','customers.read','customers.write');
 DELETE FROM public.admin_users WHERE user_id=${literal(actorUserId)};`)
 for(const permission of ['communication.read','communication.write','communication.send','metering.read','metering.write'])expect(sql(`SELECT to_jsonb(public.gridex_actor_has_company_permission(${literal(actorUserId)},${literal(companyId)},${literal(permission)}))`)).toBe(true)
 const stage:NormalSwitchStageNativeFixture={companyId,actorUserId,customerId,siteId,pointId,contractId,switchId:createdSwitchId,external,sender,receiver,gridId,routeId,routeProfileId,marketActorId:marketActor,customerIdentity:{id:customerIdentity,qualifier:'SE2',agency:'260'},requestedStartDate,brpEdielId,gridAreaCode:'TES',documentSha256,authorizationDocumentId:authorizationDocumentId!,powerOfAttorneyId:poa.id}
 if(input.deferOriginal){expect(sql(`SELECT jsonb_build_object('messages',(SELECT count(*) FROM public.ediel_messages WHERE company_id=${literal(companyId)}),'originals',(SELECT count(*) FROM gridex_received_sources.switch_originals WHERE company_id=${literal(companyId)}),'periods',(SELECT count(*) FROM public.customer_supply_periods WHERE company_id=${literal(companyId)}))`)).toEqual({messages:0,originals:0,periods:0});return stage}
 const queued=await prepareAndQueueEdielZ03({actorUserId,switchRequestId:createdSwitchId,communicationRouteId:routeId,environment:'test'})
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_received_sources.switch_originals WHERE message_id=${literal(queued.id)}`)).toBe(1)
 if(input.provider){input.provider('recipient@example.invalid');await sendEdielMessageViaSmtp(queued,{actorUserId,smtpMimeMode:'nodemailer-attachment'})}
 const originalZ03=await getEdielMessageById(queued.id);expect(originalZ03).not.toBeNull()
 const tokenized=tokenizeEdifact(originalZ03!.raw_payload!),li=tokenized.segments.find(t=>t.tag==='RFF'&&segmentComposite(t,1,tokenized.una)[0]==='LI'),caseReference=li?segmentComposite(li,1,tokenized.una)[1]:null;expect(caseReference).toBeTruthy()
 if(input.provider)expect(sql(`SELECT to_jsonb(gridex_received_sources.sent_source_is_current_v1(m)) FROM public.ediel_messages m WHERE id=${literal(queued.id)}`)).toBe(true)
 return {...stage,caseReference:caseReference!,originalZ03:originalZ03!}
}
