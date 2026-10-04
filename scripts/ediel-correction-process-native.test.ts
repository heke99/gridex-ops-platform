import {randomUUID} from 'node:crypto'
import {expect,it} from 'vitest'
import {fixtureOrganizationNumber} from './helpers/ediel-normal-switch-native-fixture'
import {supabaseService} from '@/lib/supabase/service'
import {archiveInvoiceTestCustomerSafely} from '@/lib/ediel/testing/invoiceTestCenterArchive'
import {signInvoiceTestContractCanonically} from '@/lib/ediel/testing/invoiceTestContractLifecycle'
import {literal,sql,seed} from './helpers/correctionContextNative'

// Process-owner deletion and graph-capture cases split from
// ediel-correction-context-native.test.ts at a test boundary (file budget).

it('a rolled-back process deletion leaves the producer and immutable facts unchanged',async()=>{
 const f=await seed(),taskId=randomUUID()
 sql(`INSERT INTO public.customer_operation_tasks(id,company_id,task_type,title,status)
  VALUES(${literal(taskId)},${literal(f.companyId)},'follow_up','Rollback process task','open');`)
 expect(()=>sql(`BEGIN; DELETE FROM public.customer_operation_tasks WHERE id=${literal(taskId)};
  SELECT to_jsonb(1/0); COMMIT;`)).toThrow()
 expect(sql(`SELECT to_jsonb(count(*)) FROM public.customer_operation_tasks WHERE id=${literal(taskId)}`)).toBe(1)
 expect(sql(`SELECT jsonb_agg(operation ORDER BY id) FROM gridex_correction_process.facts
  WHERE row_id=${literal(taskId)}`)).toEqual(['INSERT'])
})

it.each([false,true])('the actual invoice-test archive retains committed contract, point and site transitions, signed=%s', async sign => {
 const {companyId,actorUserId}=await seed(),customerId=randomUUID(),siteId=randomUUID()
 const pointId=randomUUID(),contractId=randomUUID(),marker={test_center:{kind:'invoice_test_customer'}}
 const organizationNumber=fixtureOrganizationNumber()
 const supplierEdielId=sign?'12346':'12345',brpEdielId=sign?'54322':'54321'
 const pricing={schema:'gridex_contract_pricing_v5',pricing_model:'spot',energy_direction:'consumption',interval_resolution:'hourly',vat_rate:0.25,
  price_areas:['SE3'],base_components:[{source_type:'spot',label:'Spotpris',weight_percent:100,price_area:'SE3'}],
  price_components:[{component_code:'spot_markup',component_type:'markup',name:'Påslag',calculation_type:'per_kwh',amount:4,unit:'ore_per_kwh',website_card_visible:true},
   {component_code:'monthly_fee',component_type:'fee',name:'Månadsavgift',calculation_type:'fixed_monthly',amount:49,unit:'sek_month',website_card_visible:true}]}
 const offer={name:`Synthetic archive ${contractId}`,slug:`synthetic-archive-${contractId}`,
  lifecycle_status:'draft',contract_type:'variable_hourly',customer_type:'both',pricing_model:'spot',energy_direction:'consumption',
  terms_version:'test-v1',spot_markup_ore_per_kwh:4,monthly_fee_sek:49,invoice_fee_sek:19,default_binding_months:0,
  default_notice_months:1,automatic_renewal:true,automatic_renewal_term_months:12,
  power_of_attorney_required:true,valid_from:'2026-09-24'}
 sql(`INSERT INTO public.admin_users(user_id,role,is_active)
  VALUES(${literal(actorUserId)},'platform_admin',true);
  UPDATE public.companies SET legal_name='Synthetic Archive AB',org_number=${literal(organizationNumber)},
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
 sql(`INSERT INTO public.customers(id,company_id,first_name,last_name,email,source,is_test_data,metadata)
  VALUES(${literal(customerId)},${literal(companyId)},'Synthetic','Archive',${literal(`synthetic-${customerId}@example.invalid`)},'invoice_test_center',true,${literal(marker)}::jsonb);
  INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,facility_id,is_test_data,metadata)
  VALUES(${literal(siteId)},${literal(companyId)},${literal(customerId)},'Archive site','735123456789012345',true,${literal(marker)}::jsonb);
  INSERT INTO public.metering_points(id,company_id,customer_id,site_id,meter_point_id,is_test_data,metadata)
  VALUES(${literal(pointId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},'735123456789012345',true,${literal(marker)}::jsonb);
  INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,
   contract_offer_id,status,metadata,created_by,contract_publication_version_id,
   contract_product_id,contract_product_version_id,price_plan_id,price_plan_version_id,
   price_book_id,legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot)
  SELECT ${literal(contractId)},${literal(companyId)},${literal(customerId)},${literal(siteId)},
   ${literal(pointId)},${literal(offerId)},'draft',${literal(marker)}::jsonb,
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
 if(sign){
  const signed=await signInvoiceTestContractCanonically({companyId,customerId,contractId,actorUserId})
  expect(signed).toMatchObject({status:'signed',signature_snapshot_sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})
  const signedFacts=sql<{old:string;next:string;signedAt:string|null}[]>(`SELECT jsonb_agg(jsonb_build_object(
   'old',old_fact->>'status','next',new_fact->>'status','signedAt',new_fact->>'signed_at') ORDER BY id)
   FROM gridex_correction_process.facts WHERE table_name='customer_contracts' AND row_id=${literal(contractId)}
    AND operation='UPDATE' AND new_fact->>'status'='signed'`)
  expect(signedFacts).toEqual([{old:'pending_signature',next:'signed',signedAt:expect.any(String)}])
 }
 const archived=await archiveInvoiceTestCustomerSafely({companyId,customerId,actorUserId})
 expect(archived.customerId).toBe(customerId)
 expect(sql(`SELECT jsonb_agg(jsonb_build_object('table',table_name,'companyId',company_id,
  'oldStatus',old_fact->>'status','newStatus',new_fact->>'status',
  'oldIdentity',CASE table_name WHEN 'customer_sites' THEN old_fact->>'facility_id' WHEN 'metering_points' THEN old_fact->>'meter_point_id' END,
  'newIdentity',CASE table_name WHEN 'customer_sites' THEN new_fact->>'facility_id' WHEN 'metering_points' THEN new_fact->>'meter_point_id' END,
  'archiveMatches',CASE WHEN table_name IN ('customer_sites','metering_points')
   THEN (new_fact->>'archived_at')::timestamptz=${literal(archived.archivedAt)}::timestamptz ELSE NULL END,
  'customerId',old_fact->>'customer_id') ORDER BY table_name)
  FROM gridex_correction_process.facts WHERE operation='UPDATE'
   AND row_id IN (${[contractId,pointId,siteId].map(literal).join(',')})
   AND (table_name<>'customer_contracts' OR new_fact->>'status'='cancelled')`)).toEqual([
  {table:'customer_contracts',companyId,oldStatus:sign?'signed':'draft',newStatus:'cancelled',oldIdentity:null,newIdentity:null,archiveMatches:null,customerId},
  {table:'customer_sites',companyId,oldStatus:'draft',newStatus:'closed',oldIdentity:'735123456789012345',newIdentity:`ARCHIVED-FAKTURATEST-SITE-${siteId}`,archiveMatches:true,customerId},
  {table:'metering_points',companyId,oldStatus:'draft',newStatus:'ended',oldIdentity:'735123456789012345',newIdentity:`ARCHIVED-FAKTURATEST-MP-${pointId}`,archiveMatches:true,customerId},
 ])
 expect(sql(`SELECT to_jsonb(archived_at IS NOT NULL) FROM public.customers WHERE id=${literal(customerId)}`)).toBe(true)
 expect(sql(`SELECT to_jsonb(status='closed' AND is_active=false)
  FROM public.customer_sites WHERE id=${literal(siteId)}`)).toBe(true)
 // The actual archive leaves a cancelled, legally locked contract. Its
 // production deletion guard must roll back before any process tombstone.
 expect(()=>sql(`DELETE FROM public.customer_contracts WHERE id=${literal(contractId)}`))
  .toThrow(/signed_customer_contract_delete_forbidden/)
 expect(sql(`SELECT to_jsonb(count(*)) FROM gridex_correction_process.facts
  WHERE row_id=${literal(contractId)} AND operation='DELETE'`)).toBe(0)
})
