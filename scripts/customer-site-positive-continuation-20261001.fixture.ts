// Isolated reusable genuine local fixture. No hooks, senders, fake successful
// source row/status or disabled production trigger. Each caller owns its UUIDs.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID, X509Certificate } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { signInvoiceTestContractCanonically } from '@/lib/ediel/testing/invoiceTestContractLifecycle'
import { buildAgreementPdfAttachment, type AgreementPdfLegalVersion } from '@/lib/customer-contracts/agreementPdf'
import { archiveSignedCustomerContractPdf, CUSTOMER_CONTRACT_DOCUMENT_BUCKET } from '@/lib/customer-contracts/documents'
import { checkSupplierSwitchReadiness } from '@/lib/customer-operations/switchReadiness'
import { createCustomerInfoRequest, queueCustomerInfoRequestForDispatch } from '@/lib/onboarding/infoRequests'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { JobRow } from '@/lib/customer-operations/automation.part-1'
import { proofSql as sql, quote } from './customer-read-proof-native'

export function createPositiveSiteFixture(companies: string[]) {
  const f = { company: randomUUID(), customer: randomUUID(), actor: randomUUID(), site: randomUUID(), point: randomUUID(),
    contract: randomUUID(), grid: randomUUID(), marketActor: randomUUID(), cert: randomUUID(), source: String(randomUUID()),
    inbound: randomUUID(), request: String(randomUUID()), job: randomUUID(), operation: randomUUID(),
    area: `SP${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`, reference: `SP${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    meter: `735${BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 12)}`).toString().padStart(15, '0')}`.slice(0, 18),
    start: new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10), email: `site-positive-${randomUUID()}@example.invalid` }
  companies.push(f.company)
  sql(`INSERT INTO public.companies(id,name,status,operating_environment,legal_name,org_number,address_line_1,postal_code,city,country_code,support_email,phone,website)
      VALUES(${quote(f.company)},'Synthetic Site Supplier','active','test','Synthetic Site Supplier AB','5590001235','Testgatan 1','12345','Teststad','SE','support@example.invalid','0101234567','https://example.invalid');
    INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES(${quote(f.actor)},'authenticated','authenticated',${quote(`${f.actor}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${quote(f.actor)},${quote(`${f.actor}@example.invalid`)},'Synthetic Site Actor','active');
    INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${quote(f.actor)},'platform_admin',true);
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,role,is_active,accepted_at)
      VALUES(${quote(f.company)},${quote(f.actor)},'operations','active','operations',true,now());
    INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active)
      SELECT ${quote(f.actor)},${quote(f.company)},id,key,'active',true FROM public.roles WHERE key='company_admin';
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT ${quote(f.actor)},${quote(f.company)},id,key FROM public.permissions WHERE key='communication.send';
    INSERT INTO public.customers(id,company_id,customer_number,first_name,last_name,name,full_name,company_name,customer_type,org_number,email,source,is_test_data,metadata)
      VALUES(${quote(f.customer)},${quote(f.company)},${quote(f.reference)},'Synthetic','Site Customer','Synthetic Site Customer','Synthetic Site Customer','Synthetic Site Customer','business','5590001235',${quote(f.email)},'invoice_test_center',true,'{"test_center":{"kind":"invoice_test_customer"}}');
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,status,street,postal_code,city,country,current_supplier_name,move_in_date,is_test_data,metadata)
      VALUES(${quote(f.site)},${quote(f.company)},${quote(f.customer)},'Synthetic Positive Site','draft','Testgatan 1','12345','Teststad','SE','Synthetic Previous Supplier',${quote(f.start)},true,'{"test_center":{"kind":"invoice_test_customer"}}');
    INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,status,meter_point_id,metering_point_id,is_test_data,metadata)
      VALUES(${quote(f.point)},${quote(f.company)},${quote(f.customer)},${quote(f.site)},${quote(f.site)},'draft',${quote(f.meter)},${quote(f.meter)},true,'{"test_center":{"kind":"invoice_test_customer"}}');
    INSERT INTO public.electricity_suppliers(company_id,name,org_number,ediel_id,is_own_supplier,is_active)
      VALUES(${quote(f.company)},'Synthetic Site Supplier','5590001235','12345',true,true);
    UPDATE public.company_capabilities SET enabled=true,readiness_status='ready' WHERE company_id=${quote(f.company)} AND capability_code='ediel_test';
    SELECT to_jsonb(true);`)
  return f
}
export type PositiveSiteFixture = ReturnType<typeof createPositiveSiteFixture>

function recipientCertificate() {
  const folder = mkdtempSync(join(process.env.RUNNER_TEMP!, 'site-positive-certificate-'))
  try {
    const path = join(folder, 'recipient.pem')
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(folder, 'recipient.key'),
      '-out', path, '-days', '365', '-subj', '/CN=Synthetic Local Recipient'], { stdio: ['ignore', 'ignore', 'ignore'], timeout: 30_000 })
    const pem = readFileSync(path, 'utf8'), certificate = new X509Certificate(pem)
    return { pem, hash: certificate.fingerprint256.replaceAll(':', '').toLowerCase(),
      validFrom: new Date(certificate.validFrom).toISOString(), validTo: new Date(certificate.validTo).toISOString() }
  } finally { rmSync(folder, { recursive: true, force: true }) }
}
export function createHeldPositiveSiteRoutes(f: PositiveSiteFixture) {
  const c = recipientCertificate()
  const receiver = sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_site_positive_actor_identifier',0));
    INSERT INTO public.platform_market_actors(id,name,status,match_status,visible_to_tenants)
      VALUES(${quote(f.marketActor)},${quote(`Synthetic Electricity Grid ${f.marketActor}`)},'active','verified',true);
    WITH available AS (SELECT candidate::text value FROM generate_series(60000,89999) candidate
      WHERE NOT EXISTS(SELECT 1 FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) ORDER BY candidate LIMIT 1),
    allocated AS (INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified)
      SELECT ${quote(f.marketActor)},'EdielId',value,true FROM available RETURNING identifier_value)
    SELECT to_jsonb(identifier_value) FROM allocated; COMMIT;`)
  expect(receiver).toMatch(/^[6-8][0-9]{4}$/)
  sql(`INSERT INTO public.platform_actor_roles(actor_id,actor_role,is_active) VALUES(${quote(f.marketActor)},'grid_owner',true);
    INSERT INTO public.platform_actor_certificates(actor_id,environment,purpose,status,fingerprint_sha256,ediel_id,valid_from,valid_to,raw_certificate_pem)
      VALUES(${quote(f.marketActor)},'production','encryption','valid',${quote(c.hash)},${quote(receiver)},${quote(c.validFrom)},${quote(c.validTo)},${quote(c.pem)});
    INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,platform_market_actor_id,is_active,lifecycle_status,communication_email,prodat_subaddress_status,prodat_subaddress_source)
      VALUES(${quote(f.grid)},${quote(f.company)},${quote(`Synthetic Electricity Grid ${f.marketActor}`)},${quote(receiver)},'production',${quote(f.marketActor)},true,'active','recipient@example.invalid','not_required_confirmed','not_required_confirmed');
    INSERT INTO public.platform_grid_areas(grid_area_code,grid_owner_name,price_area,source,is_active)
      VALUES(${quote(f.area)},'Synthetic Electricity Grid','SE3','synthetic_disposable_site_positive',true);
    UPDATE public.customer_sites SET grid_owner_id=${quote(f.grid)},grid_area_code=${quote(f.area)},price_area_code='SE3' WHERE id=${quote(f.site)};
    INSERT INTO public.ediel_certificates(id,company_id,certificate_fingerprint,secret_reference,status,encryption_status,environment,public_certificate_pem,
      fingerprint_sha256,owner_ediel_id,message_family,purpose,usage,valid_from,valid_to,certificate_valid_from,certificate_valid_to,source)
      VALUES(${quote(f.cert)},${quote(f.company)},${quote(c.hash)},'synthetic:public-certificate-only','active','validated','production',${quote(c.pem)},${quote(c.hash)},
      ${quote(receiver)},'PRODAT','encryption','outbound_recipient',${quote(c.validFrom)},${quote(c.validTo)},${quote(c.validFrom)},${quote(c.validTo)},'synthetic_disposable_site_positive');
    SELECT to_jsonb(true);`)
  for (const environment of ['production', 'test']) {
    const sender = randomUUID()
    sql(`INSERT INTO public.ediel_actor_settings(id,company_id,environment,actor_name,actor_ediel_id,ediel_id,actor_role,role,market_roles,
      default_application_reference,application_reference,first_production_send_approved,approved_by,approved_at,smtp_from_email)
      VALUES(${quote(sender)},${quote(f.company)},${quote(environment)},'Synthetic Site Supplier','12345','12345','supplier','supplier','["supplier"]',
      '23-DDQ-PRODAT','23-DDQ-PRODAT',true,${quote(f.actor)},now(),'sender@example.invalid');
      INSERT INTO public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name) VALUES(${quote(f.company)},${quote(environment)},'54321','Synthetic BRP'); SELECT to_jsonb(true);`)
    for (const code of ['Z01', 'Z03']) {
      const platformRoute = randomUUID(), route = randomUUID(), profile = randomUUID()
      sql(`INSERT INTO public.platform_actor_routes(id,actor_id,message_family,environment,status,is_verified,auto_send_allowed,application_reference,communication_type,communication_address,metadata)
        VALUES(${quote(platformRoute)},${quote(f.marketActor)},'PRODAT',${quote(environment)},'active',true,false,'23-DDQ-PRODAT','email','recipient@example.invalid',
        ${quote(JSON.stringify({ message_code: code, subaddress_status: 'not_required_confirmed', synthetic_local_held: true }))});
        INSERT INTO public.communication_routes(id,company_id,route_name,grid_owner_id,environment_type,is_active,target_email,counterparty_ediel_id,target_system)
        VALUES(${quote(route)},${quote(f.company)},${quote(`Synthetic held ${code} ${environment}`)},${quote(f.grid)},${quote(environment === 'test' ? 'bilateral_test' : 'production')},true,'recipient@example.invalid',${quote(receiver)},'synthetic_local_hold');
        INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,sender_ediel_id,receiver_ediel_id,
          application_reference,is_enabled,is_active,transport_mode,transport_type,transport_security_mode,smtp_to,receiver_email,message_family,message_code,business_code,
          actor_setting_id,is_production_ready,production_mode,encryption_mode,certificate_required,receiver_certificate_id,security_policy_status,metadata)
        VALUES(${quote(profile)},${quote(f.company)},${quote(route)},${quote(`Synthetic held ${code} ${environment}`)},${quote(environment)},'edifact','12345',${quote(receiver)},
          '23-DDQ-PRODAT',true,true,'smtp_imap','email',${quote(environment === 'production' ? 'smime' : 'unencrypted')},'recipient@example.invalid','recipient@example.invalid','PRODAT',${quote(code)},${quote(code)},
          ${quote(sender)},true,'dry_run',${quote(environment === 'production' ? 'smime' : 'none')},${environment === 'production'},${environment === 'production' ? quote(f.cert) : 'NULL'},'approved','{"production_send_lock_status":"approved","synthetic_local_held":true}');
        INSERT INTO public.company_market_party_routes(company_id,market_party_id,message_family,message_code,environment,platform_actor_route_id,communication_route_id,route_profile_id,active)
          VALUES(${quote(f.company)},${quote(f.marketActor)},'PRODAT',${quote(code)},${quote(environment)},${quote(platformRoute)},${quote(route)},${quote(profile)},true); SELECT to_jsonb(true);`)
    }
  }
  // Internal offer publication requires an actual UTILTS profile too. It is
  // inert, tenant-owned and never selected for a supplier-switch message.
  sql(`INSERT INTO public.ediel_route_profiles(company_id,environment,route_name,message_family)
    VALUES(${quote(f.company)},'production','Synthetic inert publication UTILTS','UTILTS'); SELECT to_jsonb(true);`)
  return receiver
}

export type CanonicalDraftFixture = {
  company: string; customer: string; actor: string; contract: string; start: string
  site: string | null; point: string | null
}
// Publication readiness for a disposable tenant without any SMTP/market send.
// Existing held-route callers already supply their own complete prerequisites.
export function prepareInertPositiveSitePublication(f: Pick<CanonicalDraftFixture, 'company' | 'actor'>) {
  sql(`UPDATE public.companies SET legal_name='Synthetic Site Supplier AB',org_number='5590001235',
      address_line_1='Testgatan 1',postal_code='12345',city='Teststad',country_code='SE',
      support_email='support@example.invalid',phone='0101234567',website='https://example.invalid'
    WHERE id=${quote(f.company)};
    INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id)
      VALUES(${quote(f.company)},'production','Synthetic inert supplier','12345','12345');
    INSERT INTO public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name)
      VALUES(${quote(f.company)},'production','54321','Synthetic BRP');
    INSERT INTO public.ediel_route_profiles(company_id,environment,route_name,message_family)
      VALUES(${quote(f.company)},'production','Synthetic inert PRODAT','PRODAT'),
        (${quote(f.company)},'production','Synthetic inert UTILTS','UTILTS');
    INSERT INTO public.permissions(key,name,description,category)
      SELECT key,key,'Synthetic canonical preparation','test' FROM
      unnest(ARRAY['contracts.create','contracts.publish','pricing.write','pricing.publish']) candidate(key)
      ON CONFLICT(key) DO NOTHING;
    INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
      SELECT ${quote(f.actor)},${quote(f.company)},id,key FROM public.permissions
      WHERE key IN ('contracts.create','contracts.publish','pricing.write','pricing.publish') ON CONFLICT DO NOTHING;
    SELECT to_jsonb(true);`)
}
// Reuse the real canonical offer/legal/publication owners to prepare a draft.
// This helper creates no customer signature, dispatch or acceptance evidence.
export async function preparePositiveSiteDraftAgreement(f: CanonicalDraftFixture) {
  sql(`INSERT INTO public.company_email_settings(company_id,sender_name,sender_email,verification_status,verified_at,sender_mode,is_active)
      VALUES(${quote(f.company)},'Synthetic Site Supplier','sender@example.invalid','verified',now(),'verified_domain',true);
    INSERT INTO public.company_email_templates(company_id,template_key,name,subject,body_html,body_text,is_active) VALUES
      (${quote(f.company)},'contract.confirmation_sent','Synthetic confirmation','Synthetic confirmation','<p>Synthetic confirmation</p>','Synthetic confirmation',true),
      (${quote(f.company)},'switch.started','Synthetic switch','Byte för {{customer_name}}','<p>{{company_name}} {{customer_name}} {{facility_id}} {{metering_point_id}} {{start_date}}</p>',
        '{{company_name}} {{customer_name}} {{facility_id}} {{metering_point_id}} {{start_date}}',true);
    INSERT INTO public.email_event_rules(company_id,event_key,template_key,enabled,delay_minutes,send_to_customer)
      VALUES(${quote(f.company)},'contract.confirmation_sent','contract.confirmation_sent',true,0,true),(${quote(f.company)},'switch.started','switch.started',true,1440,true);
    UPDATE public.tenant_legal_profiles SET legal_name='Synthetic Site Supplier AB',organization_number='5590001235',
      postal_address='{"address_line_1":"Testgatan 1","postal_code":"12345","city":"Teststad","country_code":"SE"}',
      customer_service_email='support@example.invalid',phone='0101234567',website='https://example.invalid',complaints_contact='{"email":"complaints@example.invalid"}',
      data_protection_contact='{"email":"privacy@example.invalid"}',billing_information='{"email":"billing@example.invalid"}',
      dispute_resolution_information='{"authority":"ARN","description":"Synthetic dispute contact"}',
      source_company_snapshot=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->'source_company_snapshot' FROM public.companies c WHERE c.id=${quote(f.company)}),
      source_company_snapshot_sha256=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->>'source_company_snapshot_sha256' FROM public.companies c WHERE c.id=${quote(f.company)}),
      review_required=false,reviewed_at=now() WHERE company_id=${quote(f.company)}; SELECT to_jsonb(true);`)
  const created = await supabaseService.rpc('gridex_upsert_internal_contract_offer_v2', { p_company_id: f.company, p_offer_id: null, p_actor_user_id: f.actor,
    p_payload: { name: `Synthetic positive ${f.contract}`, slug: `site-positive-${f.contract}`, lifecycle_status: 'draft', contract_type: 'variable_hourly',
      customer_type: 'both', pricing_model: 'spot', energy_direction: 'consumption', terms_version: 'test-v1', spot_markup_ore_per_kwh: 4, monthly_fee_sek: 49,
      invoice_fee_sek: 19, default_binding_months: 0, default_notice_months: 1, automatic_renewal: true, automatic_renewal_term_months: 12,
      power_of_attorney_required: true, valid_from: new Date().toISOString().slice(0, 10) },
    p_pricing_snapshot: { schema: 'gridex_contract_pricing_v5', pricing_model: 'spot', energy_direction: 'consumption', interval_resolution: 'hourly', vat_rate: 0.25,
      price_areas: ['SE3'], base_components: [{ source_type: 'spot', label: 'Spotpris', weight_percent: 100, price_area: 'SE3' }],
      price_components: [{ component_code: 'spot_markup', component_type: 'markup', name: 'Påslag', calculation_type: 'per_kwh', amount: 4, unit: 'ore_per_kwh', website_card_visible: true },
        { component_code: 'monthly_fee', component_type: 'fee', name: 'Månadsavgift', calculation_type: 'fixed_monthly', amount: 49, unit: 'sek_month', website_card_visible: true }] } })
  expect(created.error).toBeNull(); expect(created.data).toMatchObject({ ok: true })
  const offer = (created.data as { offer: { id: string } }).offer.id
  const legal = sql<string>(`SELECT to_jsonb(public.gridex_materialize_legal_bundle_version(${quote(f.company)},
    (SELECT contract_product_version_id FROM public.contract_offers WHERE id=${quote(offer)}),NULL,${quote(f.actor)}));`)
  sql(`UPDATE public.contract_offers SET legal_bundle_version_id=${quote(legal)} WHERE id=${quote(offer)}; SELECT to_jsonb(true);`)
  const published = await supabaseService.rpc('gridex_publish_internal_contract_version', { p_company_id: f.company, p_offer_id: offer, p_actor_user_id: f.actor })
  expect(published.error).toBeNull(); expect(published.data).toMatchObject({ ok: true, mode: 'published' })
  sql(`WITH option AS (INSERT INTO public.contract_price_options(company_id,contract_product_version_id,price_plan_version_id,option_reference,option_code,customer_name,
    contract_type,binding_months,notice_months,auto_renew_enabled,renewal_term_months,status,customer_type,is_default,selection_required,created_by)
    SELECT ${quote(f.company)},contract_product_version_id,price_plan_version_id,'site-positive-default','site-positive-default','Synthetic hourly price',
    'variable_hourly',0,1,true,12,'active','both',true,false,${quote(f.actor)} FROM public.contract_offers WHERE id=${quote(offer)} RETURNING id,company_id,price_plan_version_id)
    INSERT INTO public.contract_price_option_area_prices(company_id,contract_price_option_id,price_plan_version_id,price_row_reference,price_area,amount,unit,created_by)
    SELECT company_id,id,price_plan_version_id,'site-positive-se3','SE3',4,'ore_per_kwh',${quote(f.actor)} FROM option; SELECT to_jsonb(true);`)
  const channel = await supabaseService.rpc('gridex_publish_contract_channel', { p_company_id: f.company, p_offer_id: offer, p_channel: 'internal', p_actor_user_id: f.actor })
  expect(channel.error).toBeNull(); expect(channel.data).toMatchObject({ ok: true, channel: 'internal' })
  const publication = (channel.data as { contract_publication_version_id: string }).contract_publication_version_id
  sql(`INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_offer_id,status,metadata,created_by,
    requested_start_date,starts_at,contract_publication_version_id,contract_product_id,contract_product_version_id,price_plan_id,price_plan_version_id,price_book_id,
    legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot)
    SELECT ${quote(f.contract)},${quote(f.company)},${quote(f.customer)},${f.site === null ? 'NULL' : quote(f.site)},${f.site === null ? 'NULL' : quote(f.site)},${f.point === null ? 'NULL' : quote(f.point)},${quote(offer)},'draft',
    '{"test_center":{"kind":"invoice_test_customer"}}',${quote(f.actor)},${quote(f.start)},${quote(f.start)},v.id,p.contract_product_id,v.contract_product_version_id,
    v.price_plan_id,v.price_plan_version_id,v.price_book_id,v.legal_bundle_version_id,v.offer_reference,p.commercial_snapshot,l.rendered_snapshot
    FROM public.contract_publication_versions v JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id
    JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id WHERE v.id=${quote(publication)} AND v.status='published'; SELECT to_jsonb(true);`)
  return { publication, legal }
}

export type SignedPositiveSiteAgreementFixture = CanonicalDraftFixture & { site: string; point: string; email: string; reference: string }
export async function signPositiveSiteAgreement(f: SignedPositiveSiteAgreementFixture) {
  const { publication, legal } = await preparePositiveSiteDraftAgreement(f)
  const signed = await signInvoiceTestContractCanonically({ companyId: f.company, customerId: f.customer, contractId: f.contract, actorUserId: f.actor })
  expect(signed).toMatchObject({ status: 'signed', signature_snapshot_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
  const facts = sql<{ signedAt: string; number: string; offer: string; signature: string; tenantHash: string; legal: AgreementPdfLegalVersion[] }>(`SELECT jsonb_build_object(
    'signedAt',c.signed_at,'number',c.contract_number,'offer',c.offer_reference,'signature',c.signature_snapshot_sha256,'tenantHash',c.tenant_communication_snapshot_sha256,
    'legal',(SELECT jsonb_agg(jsonb_build_object('id',d.id,'type',d.module_key,'title',d.title,'version',coalesce(d.template_version,left(d.content_sha256,12)),'body',d.rendered_body)
      ORDER BY d.sort_order,d.id) FROM public.legal_bundle_version_documents d WHERE d.legal_bundle_version_id=c.legal_bundle_version_id))
    FROM public.customer_contracts c WHERE c.id=${quote(f.contract)};`)
  const attachment = buildAgreementPdfAttachment({ companyName: 'Synthetic Site Supplier AB', organizationNumber: '5590001235', companyAddress: 'Testgatan 1, 12345 Teststad',
    companySupportEmail: 'support@example.invalid', customerName: 'Synthetic Site Customer', customerEmail: f.email, customerNumber: f.reference,
    contractNumber: facts.number, contractName: 'Synthetic hourly price', contractType: 'variable_hourly', signedAt: facts.signedAt, startsAt: f.start,
    offerReference: facts.offer, contractPublicationVersionId: publication, legalBundleVersionId: legal, tenantSnapshotSha256: facts.tenantHash,
    legalVersions: facts.legal, signatureSnapshotSha256: facts.signature, evidenceId: `native-site-positive:${f.contract}` })
  const pdf = Buffer.from(attachment.content, 'base64'), hash = createHash('sha256').update(pdf).digest('hex')
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  const doc = await archiveSignedCustomerContractPdf({ companyId: f.company, customerContractId: f.contract, pdfBuffer: pdf,
    documentSha256: hash, generatedAt: facts.signedAt, generationSnapshot: { schema: 'gridex_signed_contract_document_v1', contract_id: f.contract,
      signature_snapshot_sha256: facts.signature, legal_document_ids: facts.legal.map(d => d.id), synthetic_acceptance: true } })
  const downloaded = await supabaseService.storage.from(CUSTOMER_CONTRACT_DOCUMENT_BUCKET).download(doc.storage_path!)
  expect(downloaded.error).toBeNull()
  expect(createHash('sha256').update(Buffer.from(await downloaded.data!.arrayBuffer())).digest('hex')).toBe(hash)
  const bound = await supabaseService.from('customer_contracts').update({ document_sha256: hash }).eq('id', f.contract).eq('company_id', f.company).is('document_sha256', null)
  expect(bound.error).toBeNull()
  // Test-only explicit signed mandate carries the exact immutable document
  // accepted above; ordinary authorization-chain materialization stays real.
  sql(`INSERT INTO public.powers_of_attorney(company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_id,customer_contract_id,scope,status,signed_at,
    accepted_at,valid_from,valid_to,reference,method,source,signed_scope_snapshot,scope_summary,legal_bundle_version_document_id,evidence_payload)
    SELECT ${quote(f.company)},${quote(f.customer)},${quote(f.site)},${quote(f.site)},${quote(f.point)},${quote(f.contract)},${quote(f.contract)},'supplier_switch','signed',
      ${quote(facts.signedAt)},${quote(facts.signedAt)},current_date,current_date+365,${quote(f.reference)},'manual','synthetic_disposable_site_positive',
      '["supplier_switch","current_supplier_contract","grid_owner_data"]','{"scopes":["supplier_switch","current_supplier_contract","grid_owner_data"]}',d.id,
      jsonb_build_object('synthetic_acceptance',true,'signature_snapshot_sha256',${quote(facts.signature)},'signed_pdf_sha256',${quote(hash)})
    FROM public.legal_bundle_version_documents d WHERE d.legal_bundle_version_id=${quote(legal)} AND d.module_key='power_of_attorney'; SELECT to_jsonb(true);`)
}

export async function preparePositiveZ01AndCaptureZ02(f: PositiveSiteFixture): Promise<JobRow> {
  // The real readiness reader materializes the signed scoped authorization
  // chain. Facility/masterdata can still be pending until the received Z02.
  await checkSupplierSwitchReadiness({ companyId: f.company, customerId: f.customer, siteId: f.site, contractId: f.contract })
  const request = await createCustomerInfoRequest({ companyId: f.company, actorUserId: f.actor, customerId: f.customer,
    siteId: f.site, meteringPointId: f.point, gridOwnerId: f.grid, requestType: 'z01_customer_masterdata', targetPartyType: 'grid_owner',
    requestedDataCategories: ['facility_id', 'metering_point_id', 'grid_area', 'customer_masterdata'], externalReference: f.reference, operationId: f.operation })
  f.request = request.id
  // Existing explicit test environment configuration is isolated to this native
  // worker call and restored. The real resolver/producer/RenderGateway run.
  const priorEnvironment = process.env.GRIDEX_CUSTOMER_DATA_EDIEL_ENVIRONMENT
  let dispatch: Awaited<ReturnType<typeof queueCustomerInfoRequestForDispatch>>
  process.env.GRIDEX_CUSTOMER_DATA_EDIEL_ENVIRONMENT = 'test'
  try { dispatch = await queueCustomerInfoRequestForDispatch({ companyId: f.company, actorUserId: f.actor, requestId: request.id }) }
  finally {
    if (priorEnvironment === undefined) delete process.env.GRIDEX_CUSTOMER_DATA_EDIEL_ENVIRONMENT
    else process.env.GRIDEX_CUSTOMER_DATA_EDIEL_ENVIRONMENT = priorEnvironment
  }
  expect(dispatch).toMatchObject({ status: 'z01_prepared', blockerCode: null, customerInfoRequest: { ediel_message_id: expect.any(String) } })
  f.source = dispatch.customerInfoRequest.ediel_message_id!
  const origin = sql<EdielMessageRow>(`SELECT to_jsonb(m) FROM public.ediel_messages m WHERE id=${quote(f.source)} AND company_id=${quote(f.company)};`)
  expect(origin).toMatchObject({ direction: 'outbound', message_code: 'Z01', customer_id: f.customer, site_id: f.site,
    canonical_rule_pack_id: expect.any(String), communication_route_id: expect.any(String), route_profile_id: expect.any(String),
    immutable_payload_hash: expect.stringMatching(/^[a-f0-9]{64}$/), message_sent_at: null })
  expect(['prepared', 'queued']).toContain(origin.status)
  const reference = sql<string>(`SELECT to_jsonb(public.gridex_edifact_rff_value(raw_payload,'LI')) FROM public.ediel_messages WHERE id=${quote(f.source)};`)
  expect(reference).toBeTruthy()
  expect(sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_business_references WHERE company_id=${quote(f.company)} AND source_message_id=${quote(f.source)}
    AND reference_type='RFF_LI' AND reference_value=${quote(reference)};`)).toBeGreaterThan(0)
  const variant = origin.parsed_payload?.expectedZ02Variant ?? origin.validation_report?.expectedZ02Variant
  expect(['L', 'LK']).toContain(variant)
  const reason = variant === 'LK' ? 'Z23' : 'Z22'
  const meter = f.meter, receiver = origin.receiver_ediel_id!, sender = origin.sender_ediel_id!
  const date = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12)
  const segments = [`UNH+1+PRODAT:D:96B:UN:E2SE6A`, `BGM+Z02+${f.reference}+9+AB`, `DTM+137:${date}:203`, `LIN+1++${meter}:::9`,
    'CCI++Z04', 'CAV+Z01', 'CCI++Z13', `CAV+${reason}`, `RFF+Z05:${f.area}`, `RFF+LI:${reference}`,
    'NAD+UD+5590001235:SE1:260++Synthetic Site Customer+Testgatan 1+Teststad++12345+SE', `NAD+IT+${meter}::9+++Testgatan 1+Teststad++12345+SE`]
  const raw = `UNB+UNOC:3+${receiver}:14+${sender}:14+${date.slice(2, 8)}:${date.slice(8)}+${f.reference}+++++PRODAT'` +
    [...segments, `UNT+${segments.length + 1}+1`, `UNZ+1+${f.reference}`].join("'") + "'"
  // Only the synthetic received response is inserted. Its original bytes are
  // captured by real enabled INSERT owners; no sent source or job result is forged.
  sql(`INSERT INTO public.ediel_messages(id,company_id,environment,direction,message_family,message_code,status,raw_payload,parsed_payload,customer_id,site_id,grid_owner_id,sender_ediel_id,receiver_ediel_id,message_received_at)
    VALUES(${quote(f.inbound)},${quote(f.company)},${quote(origin.environment)},'inbound','PRODAT','Z02','received',${quote(raw)},
      ${quote(JSON.stringify({ prodatVariant: variant, meteringPointId: meter, gridAreaId: f.area, priceAreaCode: 'SE3', annualConsumptionKwh: 1200 }))},
      ${quote(f.customer)},${quote(f.site)},${quote(f.grid)},${quote(receiver)},${quote(sender)},now());
    INSERT INTO public.customer_operation_jobs(id,company_id,customer_id,customer_site_id,metering_point_id,job_type,status,idempotency_key,payload,request_snapshot,created_by,operation_id)
      SELECT ${quote(f.job)},${quote(f.company)},${quote(f.customer)},${quote(f.site)},${quote(f.point)},'apply_inbound_grid_owner_response','queued',${quote(`site-positive-z02:${f.inbound}`)},
      jsonb_build_object('customer_info_request_id',${quote(f.request)},'ediel_message_id',${quote(f.inbound)}),
      jsonb_build_object('site_id',s.id,'address_hash',coalesce(nullif(s.address_hash,''),lower(concat_ws('|',s.street,regexp_replace(s.postal_code,'[^0-9]','','g'),s.city))),
      'grid_owner_id',s.grid_owner_id),${quote(f.actor)},${quote(f.operation)} FROM public.customer_sites s WHERE s.id=${quote(f.site)};
    SELECT to_jsonb(true);`)
  return sql<JobRow>(`SELECT to_jsonb(j) FROM public.customer_operation_jobs j WHERE id=${quote(f.job)};`)
}
