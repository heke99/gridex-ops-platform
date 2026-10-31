import { randomInt } from 'node:crypto'
import { syntheticSwedishOrganizationNumber } from '@/e2e/production/helpers/swedish-organization-number.mjs'
import { nativeFixtureCompanyIdentitySql } from '@/scripts/helpers/native-fixture-company-identity'
import { psql, serviceClient } from './db'
import { lit } from './t5-world'

// Publicerat API-erbjudande för partner-API:ts `POST contract` (defaultOfferReference kräver ett synligt offer i kanal 'api').
// URSPRUNG: scripts/helpers/ediel-normal-switch-native-fixture.ts @ 1c0c088c, rad 96–182 (offer/legal/publication via
// appens riktiga RPC:er). Avvikelser: kanal 'api' i stället för 'internal', bara production-raderna för go-live-readiness,
// leverantörens EdielId slumpas i spårets egen DB (ingen delad allokering behövs), ingen avtals-/Z03-kedja.

const pricing = {
  schema: 'gridex_contract_pricing_v5', pricing_model: 'spot', energy_direction: 'consumption', interval_resolution: 'hourly', vat_rate: 0.25,
  price_areas: ['SE3'], base_components: [{ source_type: 'spot', label: 'Spotpris', weight_percent: 100, price_area: 'SE3' }],
  price_components: [
    { component_code: 'spot_markup', component_type: 'markup', name: 'Påslag', calculation_type: 'per_kwh', amount: 4, unit: 'ore_per_kwh', website_card_visible: true },
    { component_code: 'monthly_fee', component_type: 'fee', name: 'Månadsavgift', calculation_type: 'fixed_monthly', amount: 49, unit: 'sek_month', website_card_visible: true },
  ],
}

function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined || v === '') throw new Error(`api01-offer: ${what}`)
  return v
}

export type ApiOffer = { offerId: string; offerReference: string; publicationVersionId: string }

export async function publishApiOffer(companyId: string, actorUserId: string): Promise<ApiOffer> {
  const sb = serviceClient()
  const supplierEdielId = String(randomInt(40000, 49999))
  const offer = {
    name: `Synthetic t5 API ${companyId.slice(0, 8)}`, slug: `synthetic-t5-api-${companyId.slice(0, 8)}`,
    lifecycle_status: 'draft', contract_type: 'variable_hourly', customer_type: 'both', pricing_model: 'spot', energy_direction: 'consumption',
    terms_version: 'test-v1', spot_markup_ore_per_kwh: 4, monthly_fee_sek: 49, invoice_fee_sek: 19, default_binding_months: 0,
    default_notice_months: 1, automatic_renewal: true, automatic_renewal_term_months: 12,
    power_of_attorney_required: true, valid_from: '2026-09-24',
  }
  const orgCandidates = Array.from({ length: 32 }, (_, i) => syntheticSwedishOrganizationNumber(`t5-api01:${companyId}:${i}`))
  const orgOut = psql(nativeFixtureCompanyIdentitySql(companyId, orgCandidates))
  const organizationNumber = JSON.parse(orgOut.split('\n').filter(Boolean).pop() ?? 'null') as string
  must(organizationNumber, 'organisationsnummer')

  const created = await sb.rpc('gridex_upsert_internal_contract_offer_v2', {
    p_company_id: companyId, p_offer_id: null, p_payload: offer, p_pricing_snapshot: pricing, p_actor_user_id: actorUserId,
  })
  if (created.error) throw new Error(`upsert offer: ${created.error.message}`)
  const offerId = must((created.data as { ok?: boolean; offer?: { id?: string } } | null)?.offer?.id, `offer saknas: ${JSON.stringify(created.data)}`)

  psql(`INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id)
    VALUES('${companyId}','production','Synthetic t5 supplier',${lit(supplierEdielId)},${lit(supplierEdielId)});
  INSERT INTO public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name)
    VALUES('${companyId}','production','99876','Synthetic BRP');
  INSERT INTO public.ediel_route_profiles(company_id,environment,route_name,message_family)
    VALUES('${companyId}','production','Synthetic PRODAT','PRODAT'),('${companyId}','production','Synthetic UTILTS','UTILTS');
  INSERT INTO public.company_email_settings(company_id,sender_name,sender_email,verification_status)
    VALUES('${companyId}','Synthetic t5','synthetic@example.invalid','verified');
  UPDATE public.tenant_legal_profiles SET legal_name='Synthetic Archive AB',organization_number=${lit(organizationNumber)},
   postal_address='{"address_line_1":"Testgatan 1","postal_code":"123 45","city":"Teststad","country_code":"SE"}',
   customer_service_email='service@example.invalid',phone='0101234567',website='https://example.invalid',
   complaints_contact='{"email":"complaints@example.invalid"}',
   data_protection_contact='{"email":"privacy@example.invalid"}',
   billing_information='{"email":"billing@example.invalid"}',
   dispute_resolution_information='{"authority":"ARN","description":"Synthetic dispute contact for t5 fixture"}',
   source_company_snapshot=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->'source_company_snapshot' FROM public.companies c WHERE c.id='${companyId}'),
   source_company_snapshot_sha256=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->>'source_company_snapshot_sha256' FROM public.companies c WHERE c.id='${companyId}'),
   review_required=false,reviewed_at=now() WHERE company_id='${companyId}';`)

  const legalVersionId = psql(`SELECT public.gridex_materialize_legal_bundle_version('${companyId}',
    (SELECT contract_product_version_id FROM public.contract_offers WHERE id='${offerId}'),NULL,'${actorUserId}')`)
  must(/^[0-9a-f-]{36}$/.test(legalVersionId) ? legalVersionId : null, `legal bundle: ${legalVersionId}`)
  psql(`UPDATE public.contract_offers SET legal_bundle_version_id='${legalVersionId}' WHERE id='${offerId}';`)

  const published = await sb.rpc('gridex_publish_internal_contract_version', { p_company_id: companyId, p_offer_id: offerId, p_actor_user_id: actorUserId })
  if (published.error || (published.data as { ok?: boolean } | null)?.ok !== true) {
    throw new Error(`publish version: ${published.error?.message ?? JSON.stringify(published.data)}`)
  }
  psql(`WITH template AS (
    INSERT INTO public.contract_price_options(company_id,contract_product_version_id,price_plan_version_id,option_reference,option_code,
      customer_name,contract_type,binding_months,notice_months,auto_renew_enabled,renewal_term_months,status,customer_type,is_default,selection_required,created_by)
    SELECT '${companyId}',contract_product_version_id,price_plan_version_id,'t5-default','t5-default','Synthetic hourly price','variable_hourly',
      0,1,true,12,'active','both',true,false,'${actorUserId}' FROM public.contract_offers WHERE id='${offerId}'
    RETURNING id,company_id,price_plan_version_id
  ) INSERT INTO public.contract_price_option_area_prices(company_id,contract_price_option_id,price_plan_version_id,price_row_reference,price_area,amount,unit,created_by)
    SELECT company_id,id,price_plan_version_id,'t5-se3','SE3',4,'ore_per_kwh','${actorUserId}' FROM template;`)

  // Plattformens tillåtelse att publicera i API-kanalen (sätts annars av plattformsadmin på tilldelningen).
  psql(`UPDATE public.tenant_contract_assignments SET api_publication_allowed=true WHERE company_id='${companyId}';`)
  const channel = await sb.rpc('gridex_publish_contract_channel', { p_company_id: companyId, p_offer_id: offerId, p_channel: 'api', p_actor_user_id: actorUserId })
  if (channel.error || (channel.data as { ok?: boolean } | null)?.ok !== true) {
    throw new Error(`publish channel api: ${channel.error?.message ?? JSON.stringify(channel.data)}`)
  }
  const publicationVersionId = must((channel.data as { contract_publication_version_id?: string }).contract_publication_version_id, 'publication version')
  const offerReference = must(psql(`select offer_reference from public.contract_publication_versions where id='${publicationVersionId}'`), 'offer_reference')
  return { offerId, offerReference, publicationVersionId }
}
