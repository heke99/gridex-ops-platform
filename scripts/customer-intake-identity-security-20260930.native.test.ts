import { randomBytes, randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair } from 'jose'
import { expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { createExternalContractIntake, parseExternalContractFormData } from '@/lib/external-contracts/intake'
import { proofSql, quote, readFixture, saveFixture, seedReadActors, type ReadProofFixture, type ReadProofCustomer } from './customer-read-proof-native'

const env='GRIDEX_INTAKE_IDENTITY_SECURITY_FIXTURE_PATH'
const contactEmail=`same-email-${randomUUID()}@example.invalid`
const nameCanary='<img src="gridex-intake-xss-canary" onerror="window.__GRIDEX_INTAKE_XSS=1">'
const messageCanary='<img src="gridex-message-xss-canary" onerror="window.__GRIDEX_MESSAGE_XSS=1">'
type Consumer=ReadProofCustomer & {subject:string;issuer:string;kid:string;signingKey:Record<string,unknown>;customerNumber:string;displayName:string}
type Fixture=ReadProofFixture & {
  consumers:Consumer[];owner:{email:string;password:string};admin:{email:string;password:string;userId:string};
  forms:{historical:Record<string,string>;known:Record<string,string>;unknown:Record<string,string>};
  historicalRow:unknown;protectedGraph:unknown;nameCanary:string;messageCanary:string;intakeCompany:string;
}
function protectedGraph(f:Pick<ReadProofFixture,'companies'|'customers'>){
  const companies=f.companies.map(quote).join(','),customers=f.customers.map(c=>quote(c.customerId)).join(',')
  const base=proofSql(`SELECT jsonb_build_object(
    'customers',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM customers t WHERE id IN(${customers})),
    'accounts',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM customer_portal_accounts t WHERE company_id IN(${companies})),
    'contacts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM customer_contacts t WHERE company_id IN(${companies}) AND customer_id IN(${customers})),
    'addresses',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM customer_addresses t WHERE company_id IN(${companies}) AND customer_id IN(${customers})),
    'contracts',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM customer_contracts t WHERE company_id IN(${companies}) AND customer_id IN(${customers})),
    'billing',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM customer_invoices t WHERE company_id IN(${companies})),
    'roles',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM user_roles t WHERE company_id IN(${companies})),
    'grants',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM user_permissions t WHERE company_id IN(${companies})),
    'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM company_memberships t WHERE company_id IN(${companies})));`)
  // customer_profiles is an optional legacy projection, with a missing-table
  // fallback in the real resolver. Preserve it when this replay contains it.
  const profiles=proofSql<boolean>(`SELECT to_jsonb(to_regclass('public.customer_profiles') IS NOT NULL);`)
    ? proofSql(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM customer_profiles t WHERE to_jsonb(t)->>'company_id' IN(${companies}) AND to_jsonb(t)->>'customer_id' IN(${customers});`) : null
  return {base,profiles}
}
async function publication(companyId:string){
  // Real canonical publication commands on a new disposable tenant. Synthetic
  // sender/legal/routing records are not provider credentials or market proof.
  const password=randomBytes(24).toString('base64url'),email=`intake-security-admin-${randomUUID()}@example.invalid`
  const user=await supabaseService.auth.admin.createUser({email,password,email_confirm:true})
  expect(user.error).toBeNull();if(!user.data.user)throw new Error('intake_security_admin_missing')
  const userId=user.data.user.id,slug=`intake-security-${randomUUID()}`
  proofSql(`INSERT INTO user_profiles(id,email,full_name,user_status) VALUES(${quote(userId)},${quote(email)},'Synthetic publication admin','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO admin_users(user_id,role,is_active) VALUES(${quote(userId)},'platform_admin',true);
    INSERT INTO company_memberships(company_id,user_id,membership_role,status,accepted_at,role,is_active,joined_at,role_key)
      VALUES(${quote(companyId)},${quote(userId)},'company_admin','active',now(),'company_admin',true,now(),'company_admin');
    UPDATE companies SET slug=${quote(slug)},production_status='live',live_approved_at=clock_timestamp(),
      legal_name='Synthetic Intake Security AB',org_number='5590001243',address_line_1='Synthetic 1',postal_code='123 45',city='Teststad',country_code='SE',
      support_email='service@example.invalid',phone='0101234567',website='https://example.invalid' WHERE id=${quote(companyId)};
    SELECT to_jsonb(true);`)
  const result=await supabaseService.rpc('gridex_upsert_internal_contract_offer_v2',{
    p_company_id:companyId,p_offer_id:null,p_actor_user_id:userId,
    p_payload:{name:`Synthetic public intake ${randomUUID()}`,slug:`intake-${randomUUID()}`,lifecycle_status:'draft',contract_type:'variable_hourly',
      customer_type:'both',pricing_model:'spot',energy_direction:'consumption',terms_version:'synthetic-v1',spot_markup_ore_per_kwh:4,
      monthly_fee_sek:49,invoice_fee_sek:19,default_binding_months:0,default_notice_months:1,automatic_renewal:true,
      automatic_renewal_term_months:12,power_of_attorney_required:true,valid_from:'2026-09-30'},
    p_pricing_snapshot:{schema:'gridex_contract_pricing_v5',pricing_model:'spot',energy_direction:'consumption',interval_resolution:'hourly',vat_rate:0.25,
      price_areas:['SE3'],base_components:[{source_type:'spot',label:'Spotpris',weight_percent:100,price_area:'SE3'}],
      price_components:[{component_code:'spot_markup',component_type:'markup',name:'Påslag',calculation_type:'per_kwh',amount:4,unit:'ore_per_kwh',website_card_visible:true},
        {component_code:'monthly_fee',component_type:'fee',name:'Månadsavgift',calculation_type:'fixed_monthly',amount:49,unit:'sek_month',website_card_visible:true}]},
  })
  expect(result.error).toBeNull();expect(result.data).toMatchObject({ok:true})
  const offerId=(result.data as {offer:{id:string}}).offer.id
  proofSql(`INSERT INTO ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id)
      VALUES(${quote(companyId)},'production','Synthetic inert supplier','12345','12345');
    INSERT INTO ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name) VALUES(${quote(companyId)},'production','54321','Synthetic inert BRP');
    INSERT INTO ediel_route_profiles(company_id,environment,route_name,message_family) VALUES
      (${quote(companyId)},'production','Synthetic inert PRODAT','PRODAT'),(${quote(companyId)},'production','Synthetic inert UTILTS','UTILTS');
    INSERT INTO company_email_settings(company_id,sender_name,sender_email,verification_status) VALUES(${quote(companyId)},'Synthetic inert sender','synthetic@example.invalid','verified');
    UPDATE tenant_legal_profiles SET legal_name='Synthetic Intake Security AB',organization_number='5590001243',
      postal_address='{"address_line_1":"Synthetic 1","postal_code":"123 45","city":"Teststad","country_code":"SE"}',
      customer_service_email='service@example.invalid',phone='0101234567',website='https://example.invalid',
      complaints_contact='{"email":"complaints@example.invalid"}',data_protection_contact='{"email":"privacy@example.invalid"}',
      billing_information='{"email":"billing@example.invalid"}',dispute_resolution_information='{"authority":"ARN","description":"Synthetic fixture"}',
      source_company_snapshot=(SELECT gridex_company_legal_profile_defaults(to_jsonb(c))->'source_company_snapshot' FROM companies c WHERE id=${quote(companyId)}),
      source_company_snapshot_sha256=(SELECT gridex_company_legal_profile_defaults(to_jsonb(c))->>'source_company_snapshot_sha256' FROM companies c WHERE id=${quote(companyId)}),
      review_required=false,reviewed_at=now() WHERE company_id=${quote(companyId)};
    SELECT to_jsonb(true);`)
  const legal=proofSql<string>(`SELECT to_jsonb(gridex_materialize_legal_bundle_version(${quote(companyId)},
    (SELECT contract_product_version_id FROM contract_offers WHERE id=${quote(offerId)}),NULL,${quote(userId)}));`)
  proofSql(`UPDATE contract_offers SET legal_bundle_version_id=${quote(legal)} WHERE id=${quote(offerId)};SELECT to_jsonb(true);`)
  const published=await supabaseService.rpc('gridex_publish_internal_contract_version',{p_company_id:companyId,p_offer_id:offerId,p_actor_user_id:userId})
  expect(published.error).toBeNull();expect(published.data).toMatchObject({ok:true,mode:'published'})
  proofSql(`WITH option AS (INSERT INTO contract_price_options(company_id,contract_product_version_id,price_plan_version_id,
      option_reference,option_code,customer_name,contract_type,binding_months,notice_months,auto_renew_enabled,renewal_term_months,status,customer_type,is_default,selection_required,created_by)
      SELECT company_id,contract_product_version_id,price_plan_version_id,'intake-security-default','intake-security-default','Synthetic price','variable_hourly',
        0,1,true,12,'active','both',true,false,${quote(userId)} FROM contract_offers WHERE id=${quote(offerId)} RETURNING *)
    INSERT INTO contract_price_option_area_prices(company_id,contract_price_option_id,price_plan_version_id,price_row_reference,price_area,amount,unit,created_by)
      SELECT company_id,id,price_plan_version_id,'intake-security-se3','SE3',4,'ore_per_kwh',${quote(userId)} FROM option;SELECT to_jsonb(true);`)
  const channel=await supabaseService.rpc('gridex_publish_contract_channel',{p_company_id:companyId,p_offer_id:offerId,p_channel:'website',p_actor_user_id:userId})
  expect(channel.error).toBeNull();expect(channel.data).toMatchObject({ok:true,channel:'website'})
  const reference=(channel.data as {offer_reference:string}).offer_reference
  expect(proofSql<number>(`SELECT to_jsonb(count(*)) FROM canonical_public_contract_offers_v WHERE company_id=${quote(companyId)} AND canonical_offer_reference=${quote(reference)};`)).toBe(1)
  return {slug,reference,admin:{userId,email,password}}
}
it('seeds or verifies actual anonymous intake and two-issuer HTTP security fixtures in the existing disposable stack',async()=>{
  if(process.env.GRIDEX_INTAKE_IDENTITY_SECURITY_VERIFY_AFTER_HTTP==='1'){
    const f=readFixture<Fixture>(env),a=f.consumers[0]
    expect(protectedGraph(f)).toEqual(f.protectedGraph)
    expect(proofSql(`SELECT to_jsonb(t) FROM external_contract_intakes t WHERE company_id=${quote(f.intakeCompany)} AND email=${quote(f.forms.historical.email)};`)).toEqual(f.historicalRow)
    for(const form of [f.forms.known,f.forms.unknown]){
      const row=proofSql<{status:string;customerId:string;payload:Record<string,unknown>}>(`SELECT jsonb_build_object('status',status,'customerId',created_customer_id,'payload',payload)
        FROM external_contract_intakes WHERE company_id=${quote(f.intakeCompany)} AND email=${quote(form.email)} AND first_name=${quote(nameCanary)};`)
      expect(row.status).toBe('needs_review');expect(f.customers.map(c=>c.customerId)).not.toContain(row.customerId)
      for(const key of ['customer_id','company_id','actor_user_id','verified','update_existing','role','status','billing_profile','invoice_email'])expect(row.payload).not.toHaveProperty(key)
    }
    expect(proofSql(`SELECT jsonb_build_object('cases',(SELECT count(*) FROM customer_cases WHERE company_id=${quote(a.companyId)} AND customer_id=${quote(a.customerId)} AND title='Synthetic message XSS probe'),
      'messages',(SELECT count(*) FROM customer_support_messages WHERE company_id=${quote(a.companyId)} AND customer_id=${quote(a.customerId)} AND body=${quote(f.messageCanary)}),
      'caseCommands',(SELECT count(*) FROM canonical_command_results WHERE company_id=${quote(a.companyId)} AND command_type='customer.support.command.v1'),
      'sentEmail',(SELECT count(*) FROM tenant_email_outbox WHERE company_id IN(${f.companies.map(quote).join(',')}) AND status='sent'),
      'ediel',(SELECT count(*) FROM ediel_messages WHERE company_id IN(${f.companies.map(quote).join(',')})));`))
      .toEqual({cases:1,messages:1,caseCommands:1,sentEmail:0,ediel:0})
    console.log('INTAKE_IDENTITY_SECURITY_POST_NATIVE_PASS original_profiles_accounts_finance_unchanged=true historical_receipt_unchanged=true known_unknown_manual_review=true forged_fields_not_promoted=true one_authorized_support_message=true no_email_or_ediel_delivery=true')
    return
  }
  const base=await seedReadActors('intake-security','/api/v1/customer/me',['customer_profile.read','customer_cases.read','customer_cases.write'])
  const sharedSubject=`same-sub-${randomUUID()}`,keys=await Promise.all([generateKeyPair('RS256',{extractable:true}),generateKeyPair('RS256',{extractable:true})])
  const issuers=keys.map((_,index)=>`https://isolated-issuer-${index}.example.test/${randomUUID()}`)
  const consumers:Consumer[]=[]
  for(const [index,c] of base.customers.entries()){
    const keyIndex=index===0?0:1,issuer=issuers[keyIndex],kid=`intake-security-${keyIndex}`
    const number=proofSql<string>(`SELECT to_jsonb(customer_number) FROM customers WHERE id=${quote(c.customerId)};`),displayName=`ISSUER_${c.tag}_PRIVATE_PROFILE_CANARY`
    proofSql(`UPDATE customers SET email=${quote(contactEmail)},first_name=${quote(displayName)},last_name='Synthetic',full_name=${quote(displayName)},name=${quote(displayName)} WHERE id=${quote(c.customerId)};
      UPDATE customer_portal_accounts SET portal_user_id=NULL,external_account_id=${quote(sharedSubject)},email=${quote(contactEmail)},user_email=${quote(contactEmail)},customer_number=${quote(number)} WHERE company_id=${quote(c.companyId)} AND customer_id=${quote(c.customerId)};
      SELECT to_jsonb(true);`)
    const jwk={...await exportJWK(keys[keyIndex].publicKey),kid,alg:'RS256',use:'sig'}
    base.trust[c.clientId]={issuer,audience:'gridex-customer-portal',jwks:{keys:[jwk]},bindings:{[issuer]:{[sharedSubject]:c.customerId}}}
    consumers.push({...c,subject:sharedSubject,issuer,kid,signingKey:await exportJWK(keys[keyIndex].privateKey),customerNumber:number,displayName})
  }
  delete base.trust[base.noScopeClientId]
  const ownerPassword=randomBytes(24).toString('base64url'),ownerEmail=`intake-security-${base.customers[0].customerId.slice(0,8)}@example.invalid`
  const passwordChange=await supabaseService.auth.admin.updateUserById(base.customers[0].userId,{password:ownerPassword})
  expect(passwordChange.error).toBeNull()
  const offer=await publication(base.companies[0])
  proofSql(`INSERT INTO customer_invoices(company_id,customer_id,status,amount_ex_vat,vat_amount,amount_inc_vat,metadata)
      VALUES(${quote(base.companies[0])},${quote(base.customers[0].customerId)},'draft',125,31.25,156.25,'{"private_history_canary":"PRIVATE_INTAKE_FINANCE_CANARY"}');SELECT to_jsonb(true);`)
  const forms={historical:{company_slug:offer.slug,offer_reference:offer.reference,first_name:'Synthetic historical',last_name:'Caller',email:`history-${randomUUID()}@example.invalid`},
    known:{company_slug:offer.slug,offer_reference:offer.reference,first_name:nameCanary,last_name:'Synthetic',email:contactEmail},
    unknown:{company_slug:offer.slug,offer_reference:offer.reference,first_name:nameCanary,last_name:'Synthetic',email:`unknown-${randomUUID()}@example.invalid`}}
  const historicalForm=new FormData();for(const [key,value] of Object.entries(forms.historical))historicalForm.append(key,value)
  const historical=await createExternalContractIntake(parseExternalContractFormData(historicalForm))
  expect(historical.status).toBe('needs_review')
  // Model a real allowed legacy receipt state, preserving the actual original
  // command's graph. Current fresh producer continues to create needs_review.
  proofSql(`UPDATE external_contract_intakes SET status='created',issues='["PRIVATE_INTAKE_HISTORY_CANARY"]' WHERE id=${quote(historical.intakeId)};
    SELECT to_jsonb(true);`)
  const f:Fixture={...base,consumers,owner:{email:ownerEmail,password:ownerPassword},admin:offer.admin,forms,
    historicalRow:proofSql(`SELECT to_jsonb(t) FROM external_contract_intakes t WHERE id=${quote(historical.intakeId)};`),
    protectedGraph:protectedGraph(base),nameCanary,messageCanary,intakeCompany:base.companies[0]}
  saveFixture(env,f)
  console.log('INTAKE_IDENTITY_SECURITY_SEED_NATIVE_PASS canonical_website_publication=true real_auth_and_accounts=true same_sub_and_email_two_issuers=true actual_historical_receipt=true local_private_fixture=true')
})
