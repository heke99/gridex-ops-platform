// TERM-fixture: syntetisk tenant + signerade kundavtal via de normala RPC:erna.
//
// KLOCKOR: Auth/JWT = real tid (aldrig manipulerad). Affärsdatum (starts_at, bindning) är explicita
// parametrar. Onlinesignering (gridex_finalize_customer_contract_signature_v1) stämplar signed_at med
// clock_timestamp(), dvs real tid; `signedAt` i createSignedContract är ett DEKLARERAT fixturdatum som
// returneras separat (declaredSignedAt) och skrivs i contract.metadata.sim_declared_signed_at. Det styr
// ingen affärslogik. Faktiskt signed_at returneras som actualSignedAt.
//
// URSPRUNG (RUN_DIR /root/sim/track2 @1c0c088c, kopierat mönster, ingen affärslogik återskapad):
//  - scripts/helpers/ediel-normal-switch-native-fixture.ts:100-200 (seedNormalSwitchNativeFixture):
//    SQL för auth-användare/medlemskap/admin_users, EdielId-allokering (sender/receiver), ediel_*-inställningar,
//    pricing/offer-payload, gridex_upsert_internal_contract_offer_v2 -> legal profile ->
//    gridex_materialize_legal_bundle_version -> gridex_publish_internal_contract_version ->
//    contract_price_options/area_prices -> gridex_publish_contract_channel('internal') ->
//    kund/site/mätpunkt/draft customer_contracts från publicerad publication version; fixtureGsrn().
//    nativeActorRoleSql() (scripts/helpers/ediel-normal-switch-native-fixture.ts:42-47).
//  - lib/ediel/testing/invoiceTestContractLifecycle.ts:22-104 (signInvoiceTestContractCanonically):
//    gridex_prepare_customer_contract_signature_request_v1 + gridex_finalize_customer_contract_signature_v1.
//  - scripts/helpers/native-fixture-company-identity.ts (organisationsnummerallokering; förenklad till TS-loop).
// Avvikelser mot förlagan: en egen tenant per createTermTenant() (login-admin från lib/fixture.ts är tenantens
// admin), avtalsfälten binding_months/notice_months/monthly_fee_sek/auto_renew_* /contract_type sätts på
// draft-raden (prepare-RPC:n bygger prissnapshoten från raden), ingen switch/POA/Z03.
//
// VAR AVTALSPRIS/MÅNADSAVGIFT KOMMER FRÅN (läst i stackens funktionskroppar):
//  - customer_contracts.binding_months/notice_months/monthly_fee_sek/auto_renew_*: draft-raden. I appens
//    admin-skapande (gridex_create_internal_customer_contract_v1) kommer binding/notice/auto_renew från
//    contract_price_options och monthly_fee_sek från komponent 'monthly_fee' i vald price_components_snapshot.
//  - gridex_prepare_signature_before_record_retention_v1 skapar contract_price_snapshots (snapshot_json innehåller
//    monthly_fee_sek, binding_months, notice_months, starts_at, ends_at kopierade från raden) och sätter
//    customer_contracts.contract_price_snapshot_id. Snapshotens komponenter kommer från publicerad commercial_snapshot.
//  Fixturen håller offer, option, rad och komponent i samma värden och exponerar alla i `sources`.
import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { psql, psqlRows, serviceClient } from './db'
import { sim } from './env'
import { createAdminFixture, type AdminFixture } from './fixture'

const lit = (v: unknown): string => v === null || v === undefined ? 'NULL'
  : `'${String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'", "''")}'`

function sqlJson<T>(sql: string): T {
  const out = psql(sql)
  return (out ? JSON.parse(out) : undefined) as T
}

/** Stockholms kalenderdag (real tid) som YYYY-MM-DD. Endast för defaultvärden, aldrig oraklet. */
export function stockholmToday(now = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function luhnCheckDigit(nineDigits: string): string {
  let sum = 0
  for (let i = 0; i < nineDigits.length; i += 1) {
    const p = Number(nineDigits[i]) * (i % 2 === 0 ? 2 : 1)
    sum += Math.floor(p / 10) + (p % 10)
  }
  return String((10 - (sum % 10)) % 10)
}
const rnd = (digits: number) => String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, '0')
/** Luhn-giltigt syntetiskt organisationsnummer (prefix 559 => tredje siffran >= 2). */
function syntheticOrgNumber(): string { const base = `559${rnd(6)}`; return base + luhnCheckDigit(base) }
let personCounter = 0
function syntheticPersonalNumber(): string {
  personCounter += 1
  const base = `900101${String((personCounter * 7 + Number(rnd(3))) % 1000).padStart(3, '0')}`
  return `19${base}${luhnCheckDigit(base)}`
}
/** Samma form som fixtureGsrn() i förlagan (GSRN med giltig kontrollsiffra). */
function fixtureGsrn(): string {
  const first17 = `735123456789${rnd(5)}`
  const weighted = [...first17].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 3 : 1), 0)
  return `${first17}${(10 - (weighted % 10)) % 10}`
}

export type TermTenant = {
  runId: string
  companyId: string
  /** Inloggningsbar tenant-admin (customers.read, contracts.read, masterdata.read). */
  admin: AdminFixture
  /** Icke-inloggande platform_admin-aktör som äger RPC-anropen (service_role + admin_users), som i förlagan. */
  builderUserId: string
  edielSender: string
  edielReceiver: string
  gridOwnerId: string
  offerCache: Map<string, { offerId: string; publicationVersionId: string; priceOptionId: string }>
}

/**
 * Unik syntetisk tenant per körning: företag + login-admin + builder-aktör + Ediel/legal-underlag som krävs
 * för att den kanoniska publiceringen ska godkänna ett erbjudande. companies saknar is_test_data; kund, site
 * och mätpunkt märks is_test_data=true i createSignedContract.
 */
export async function createTermTenant(opts: { permissionKeys?: string[] } = {}): Promise<TermTenant> {
  const runId = randomBytes(4).toString('hex')
  const admin = await createAdminFixture({
    permissionKeys: opts.permissionKeys ?? ['customers.read', 'contracts.read', 'masterdata.read'],
    companyName: `Synthetic TERM tenant ${runId}`,
  })
  const companyId = admin.companyId
  const builderUserId = randomUUID()
  const gridOwnerId = randomUUID()
  const marketActor = randomUUID()
  const brpEdielId = '99876'

  // Aktörsroll så att medlemskapet listas av kanoniska tenantkontexten (nativeActorRoleSql i förlagan), för båda användarna.
  const roleSql = (userId: string) => {
    const role = randomUUID(); const key = `native_actor_${role}`
    return `INSERT INTO public.roles(id,key,name,scope) VALUES(${lit(role)},${lit(key)},'Disposable native actor role','company');
      INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES(${lit(userId)},${lit(companyId)},${lit(role)},${lit(key)},'active',true);`
  }
  psql(`BEGIN;
    ${roleSql(admin.userId)}
    INSERT INTO auth.users(instance_id,confirmation_token,recovery_token,email_change_token_new,email_change,id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
      VALUES('00000000-0000-0000-0000-000000000000','','','','',${lit(builderUserId)},'authenticated','authenticated',${lit(`${builderUserId}@example.invalid`)},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${lit(builderUserId)},${lit(`${builderUserId}@example.invalid`)},'Synthetic TERM builder','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
      VALUES(${lit(companyId)},${lit(builderUserId)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
    ${roleSql(builderUserId)}
    INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${lit(builderUserId)},'platform_admin',true);
    COMMIT;`)

  // EdielId-allokering (samma advisory-lås och intervall som förlagan).
  const edielSender = sqlJson<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_legal_actor_identifier',0));
    WITH available AS (SELECT candidate::text value FROM generate_series(40000,49999) candidate WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) AND NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) ORDER BY candidate LIMIT 1),
    allocated AS (INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) SELECT ${lit(companyId)},'test',${lit(builderUserId)},'EdielId',value,clock_timestamp()-interval '1 day' FROM available RETURNING identifier_value)
    SELECT to_jsonb(identifier_value) FROM allocated;COMMIT;`)
  const edielReceiver = sqlJson<string>(`BEGIN;SELECT pg_advisory_xact_lock(hashtextextended('native_outbound_dispatch_actor_identifier',0));
    WITH actor AS (INSERT INTO public.platform_market_actors(id,name,status,match_status,visible_to_tenants) VALUES(${lit(marketActor)},${lit(`Synthetic TERM grid ${marketActor}`)},'active','verified',true) RETURNING id),
    available AS (SELECT candidate::text value FROM generate_series(60000,89999) candidate WHERE NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=candidate::text) ORDER BY candidate LIMIT 1),
    allocated AS (INSERT INTO public.platform_actor_identifiers(actor_id,identifier_type,identifier_value,is_verified) SELECT actor.id,'EdielId',available.value,true FROM actor CROSS JOIN available RETURNING identifier_value)
    SELECT to_jsonb(identifier_value) FROM allocated;COMMIT;`)

  psql(`BEGIN;
    INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES(${lit(companyId)},'test','electricity',true,clock_timestamp()-interval '1 day');
    INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES(${lit(companyId)},'test',${lit(builderUserId)},'electricity_supplier',clock_timestamp()-interval '1 day');
    INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id) VALUES(${lit(companyId)},'test','Synthetic TERM supplier',${lit(edielSender)},${lit(edielSender)});
    INSERT INTO public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name) VALUES(${lit(companyId)},'test',${lit(brpEdielId)},'Synthetic TERM BRP');
    INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status,owner_code) VALUES(${lit(gridOwnerId)},${lit(companyId)},'Synthetic TERM grid',${lit(edielReceiver)},'test',true,'active','TES');
    INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id) VALUES(${lit(companyId)},'production','Synthetic TERM supplier',${lit(edielSender)},${lit(edielSender)});
    INSERT INTO public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name) VALUES(${lit(companyId)},'production',${lit(brpEdielId)},'Synthetic BRP');
    INSERT INTO public.ediel_route_profiles(company_id,environment,route_name,message_family) VALUES(${lit(companyId)},'production','Synthetic PRODAT','PRODAT'),(${lit(companyId)},'production','Synthetic UTILTS','UTILTS');
    INSERT INTO public.company_email_settings(company_id,sender_name,sender_email,verification_status) VALUES(${lit(companyId)},'Synthetic TERM','synthetic@example.invalid','verified');
    INSERT INTO public.company_email_templates(company_id,template_key,name,subject,body_html,is_active) VALUES(${lit(companyId)},'contract.confirmation_sent','Synthetic confirmation','Synthetic confirmation','<p>Synthetic confirmation</p>',true);
    INSERT INTO public.email_event_rules(company_id,event_key,template_key,enabled) VALUES(${lit(companyId)},'contract.confirmation_sent','contract.confirmation_sent',true);
    COMMIT;`)

  // Organisationsnummer: ux_companies_normalized_org kan krocka; pröva nya kandidater (endast den constrainten).
  let assigned = false
  for (let attempt = 0; attempt < 32 && !assigned; attempt += 1) {
    try {
      psql(`UPDATE public.companies SET legal_name='Synthetic TERM AB',org_number=${lit(syntheticOrgNumber())},
        address_line_1='Testgatan 1',postal_code='123 45',city='Teststad',country_code='SE',
        support_email='service@example.invalid',phone='0101234567',website='https://example.invalid' WHERE id=${lit(companyId)};`)
      assigned = true
    } catch (error) {
      const stderr = String((error as { stderr?: unknown }).stderr ?? '')
      if (!stderr.includes('ux_companies_normalized_org')) throw new Error(`org_number_update_failed: ${stderr.slice(0, 400)}`)
    }
  }
  if (!assigned) throw new Error('term_fixture_org_number_candidates_exhausted')

  psql(`UPDATE public.tenant_legal_profiles SET legal_name='Synthetic TERM AB',organization_number=(SELECT org_number FROM public.companies WHERE id=${lit(companyId)}),
    postal_address='{"address_line_1":"Testgatan 1","postal_code":"123 45","city":"Teststad","country_code":"SE"}',
    customer_service_email='service@example.invalid',phone='0101234567',website='https://example.invalid',
    complaints_contact='{"email":"complaints@example.invalid"}',
    data_protection_contact='{"email":"privacy@example.invalid"}',
    billing_information='{"email":"billing@example.invalid"}',
    dispute_resolution_information='{"authority":"ARN","description":"Synthetic dispute contact for TERM fixture"}',
    source_company_snapshot=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->'source_company_snapshot' FROM public.companies c WHERE c.id=${lit(companyId)}),
    source_company_snapshot_sha256=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->>'source_company_snapshot_sha256' FROM public.companies c WHERE c.id=${lit(companyId)}),
    review_required=false,reviewed_at=now() WHERE company_id=${lit(companyId)};`)

  const ready = sqlJson<boolean>(`SELECT to_jsonb(has_actor_setting AND has_brp AND has_prodat_route AND has_utilts_route AND has_sender_identity)
    FROM public.platform_go_live_readiness_v WHERE company_id=${lit(companyId)}`)
  if (ready !== true) throw new Error('term_fixture_publication_readiness_not_met')

  return { runId, companyId, admin, builderUserId, edielSender, edielReceiver, gridOwnerId, offerCache: new Map() }
}

export type ContractTypeInput = 'variable_monthly' | 'variable_hourly' | 'variable_quarterly' | (string & {})

export type CreateSignedContractInput = {
  contractType: ContractTypeInput
  /** null => binding_months NULL på avtalsraden (option får 0, kolumnen kräver heltal). */
  bindingMonths: number | null
  noticeMonths: number
  /** Affärsdatum YYYY-MM-DD (customer_contracts.starts_at är en date). Explicit, aldrig real tid. */
  startsAt: string
  monthlyFeeSek?: number
  /** Skrivs i månadsavgiftskomponentens metadata.proration_policy (t.ex. 'prorated_by_days'); default ingen. */
  prorationPolicy?: string
  priceArea?: 'SE1' | 'SE2' | 'SE3' | 'SE4'
  autoRenew?: boolean
  /** Förlängningstid i månader; default bindingMonths>0 ? bindingMonths : 12 när autoRenew=true. */
  autoRenewTermMonths?: number
  /** DEKLARERAT signeringsdatum (YYYY-MM-DD); se klockkommentaren överst. Default Stockholms dag (real tid). */
  signedAt?: string
}

export type SignedContractFixture = {
  tenant: TermTenant
  companyId: string
  customerId: string
  siteId: string
  meteringPointId: string
  gsrn: string
  contractId: string
  offerId: string
  publicationVersionId: string
  priceOptionId: string
  priceSnapshotId: string
  declaredSignedAt: string
  actualSignedAt: string
  input: CreateSignedContractInput
  /** Fälten som avtalspris/månadsavgift/bindning kommer ifrån, så som de ligger i DB efter signering. */
  sources: {
    contractRow: Record<string, unknown>
    optionRow: Record<string, unknown>
    snapshotRow: Record<string, unknown>
    snapshotMonthlyFeeSek: number | null
    snapshotBindingMonths: number | null
    snapshotMonthlyFeeComponent: Record<string, unknown> | null
  }
}

function pricingFor(input: CreateSignedContractInput, monthlyFee: number, area: string) {
  const resolution = /quarter/.test(input.contractType) ? 'quarterly' : /hour/.test(input.contractType) ? 'hourly' : 'monthly'
  const feeComponent: Record<string, unknown> = {
    component_code: 'monthly_fee', component_type: 'fee', name: 'Månadsavgift', calculation_type: 'fixed_monthly',
    amount: monthlyFee, unit: 'sek_month', website_card_visible: true,
    ...(input.prorationPolicy ? { metadata: { proration_policy: input.prorationPolicy } } : {}),
  }
  return {
    schema: 'gridex_contract_pricing_v5', pricing_model: 'spot', energy_direction: 'consumption',
    interval_resolution: resolution, vat_rate: 0.25, price_areas: [area],
    base_components: [{ source_type: 'spot', label: 'Spotpris', weight_percent: 100, price_area: area }],
    price_components: [
      { component_code: 'spot_markup', component_type: 'markup', name: 'Påslag', calculation_type: 'per_kwh', amount: 4, unit: 'ore_per_kwh', website_card_visible: true },
      feeComponent,
    ],
  }
}

async function ensureOffer(tenant: TermTenant, input: CreateSignedContractInput, monthlyFee: number, area: string) {
  const bindingForOption = input.bindingMonths ?? 0
  const renewTerm = input.autoRenew ? (input.autoRenewTermMonths ?? (bindingForOption > 0 ? bindingForOption : 12)) : null
  const key = JSON.stringify([input.contractType, bindingForOption, input.noticeMonths, monthlyFee, input.prorationPolicy ?? null, area, input.autoRenew ?? false, renewTerm])
  const cached = tenant.offerCache.get(key)
  if (cached) return cached
  const n = tenant.offerCache.size + 1
  const { companyId, builderUserId } = tenant
  const slug = `term-${tenant.runId}-${n}`
  const offer = {
    name: `Synthetic TERM offer ${slug}`, slug, lifecycle_status: 'draft', contract_type: input.contractType, customer_type: 'both',
    pricing_model: 'spot', energy_direction: 'consumption', terms_version: 'test-v1', spot_markup_ore_per_kwh: 4,
    monthly_fee_sek: monthlyFee, invoice_fee_sek: 19, default_binding_months: bindingForOption,
    default_notice_months: input.noticeMonths, automatic_renewal: Boolean(input.autoRenew),
    ...(renewTerm ? { automatic_renewal_term_months: renewTerm } : {}),
    power_of_attorney_required: true,
    valid_from: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
  }
  const client = serviceClient()
  const created = await client.rpc('gridex_upsert_internal_contract_offer_v2', {
    p_company_id: companyId, p_offer_id: null, p_payload: offer, p_pricing_snapshot: pricingFor(input, monthlyFee, area), p_actor_user_id: builderUserId,
  })
  if (created.error) throw new Error(`upsert_offer: ${created.error.message}`)
  const createdData = created.data as { ok?: boolean; code?: string; offer?: { id?: string } } | null
  if (!createdData?.ok || !createdData.offer?.id) throw new Error(`upsert_offer ej ok: ${JSON.stringify(createdData)}`)
  const offerId = createdData.offer.id

  const legalVersionId = sqlJson<string>(`SELECT to_jsonb(public.gridex_materialize_legal_bundle_version(
    ${lit(companyId)},(SELECT contract_product_version_id FROM public.contract_offers WHERE id=${lit(offerId)}),NULL,${lit(builderUserId)}))`)
  psql(`UPDATE public.contract_offers SET legal_bundle_version_id=${lit(legalVersionId)} WHERE id=${lit(offerId)};`)

  const published = await client.rpc('gridex_publish_internal_contract_version', { p_company_id: companyId, p_offer_id: offerId, p_actor_user_id: builderUserId })
  if (published.error) throw new Error(`publish_version: ${published.error.message}`)
  const pub = published.data as { ok?: boolean; mode?: string } | null
  if (!pub?.ok || pub.mode !== 'published') throw new Error(`publish_version ej published: ${JSON.stringify(pub)}`)

  // Valbart pris för mallen: option med avtalets bindning/uppsägning/förnyelse + områdespris (som förlagan).
  const optionRef = `term-${tenant.runId}-${n}`
  const priceOptionId = sqlJson<string>(`WITH template AS (
    INSERT INTO public.contract_price_options(company_id,contract_product_version_id,price_plan_version_id,option_reference,option_code,customer_name,contract_type,
      binding_months,notice_months,auto_renew_enabled,renewal_term_months,status,customer_type,is_default,selection_required,created_by)
    SELECT ${lit(companyId)},contract_product_version_id,price_plan_version_id,${lit(optionRef)},${lit(optionRef)},'Synthetic TERM price',${lit(input.contractType)},
      ${bindingForOption},${input.noticeMonths},${input.autoRenew ? 'true' : 'false'},${renewTerm === null ? 'NULL' : renewTerm},'active','both',true,false,${lit(builderUserId)}
    FROM public.contract_offers WHERE id=${lit(offerId)}
    RETURNING id,company_id,price_plan_version_id
  ), area AS (
    INSERT INTO public.contract_price_option_area_prices(company_id,contract_price_option_id,price_plan_version_id,price_row_reference,price_area,amount,unit,created_by)
    SELECT company_id,id,price_plan_version_id,${lit(`${optionRef}-${area.toLowerCase()}`)},${lit(area)},4,'ore_per_kwh',${lit(builderUserId)} FROM template RETURNING 1
  ) SELECT to_jsonb(id) FROM template`)

  const channel = await client.rpc('gridex_publish_contract_channel', { p_company_id: companyId, p_offer_id: offerId, p_channel: 'internal', p_actor_user_id: builderUserId })
  if (channel.error) throw new Error(`publish_channel: ${channel.error.message}`)
  const channelData = channel.data as { ok?: boolean; channel?: string; contract_publication_version_id?: string } | null
  if (!channelData?.ok || channelData.channel !== 'internal' || !channelData.contract_publication_version_id) throw new Error(`publish_channel ej ok: ${JSON.stringify(channelData)}`)

  const entry = { offerId, publicationVersionId: channelData.contract_publication_version_id, priceOptionId }
  tenant.offerCache.set(key, entry)
  return entry
}

/**
 * Skapar kund + anläggning + mätpunkt (is_test_data) och ett draft-avtal från publicerad publication version,
 * signerar via prepare/finalize-RPC:erna (service_role) och returnerar id:n och prisfältens källor.
 */
export async function createSignedContract(tenant: TermTenant, input: CreateSignedContractInput): Promise<SignedContractFixture> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsAt)) throw new Error('startsAt måste vara YYYY-MM-DD')
  const area = input.priceArea ?? 'SE3'
  const monthlyFee = input.monthlyFeeSek ?? 49
  const declaredSignedAt = input.signedAt ?? stockholmToday()
  const { companyId, builderUserId } = tenant
  const offer = await ensureOffer(tenant, input, monthlyFee, area)

  const customerId = randomUUID(); const siteId = randomUUID(); const pointId = randomUUID(); const contractId = randomUUID()
  const gsrn = fixtureGsrn()
  const marker = { test_center: { kind: 'invoice_test_customer' } }
  const contractMarker = { ...marker, sim_declared_signed_at: declaredSignedAt }
  const email = `synthetic-${customerId}@example.invalid`
  const renewTerm = input.autoRenew ? (input.autoRenewTermMonths ?? ((input.bindingMonths ?? 0) > 0 ? input.bindingMonths! : 12)) : null

  psql(`BEGIN;
    INSERT INTO public.customers(id,company_id,first_name,last_name,name,customer_number,personal_number,email,source,is_test_data,metadata)
      VALUES(${lit(customerId)},${lit(companyId)},'Synthetic','Term',${lit(`Synthetic TERM customer ${customerId.slice(0, 8)}`)},${lit(customerId)},${lit(syntheticPersonalNumber())},${lit(email)},'invoice_test_center',true,${lit(marker)}::jsonb);
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,facility_id,grid_owner_id,grid_area_code,price_area_code,status,is_test_data,metadata)
      VALUES(${lit(siteId)},${lit(companyId)},${lit(customerId)},'TERM site',${lit(gsrn)},${lit(tenant.gridOwnerId)},'TES',${lit(area)},'active',true,${lit(marker)}::jsonb);
    INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,meter_point_id,metering_point_id,ediel_metering_point_id,grid_owner_id,grid_owner_ediel_id,grid_area_code,price_area_code,status,reading_frequency,measurement_type,product_direction,is_settlement_relevant,is_test_data,metadata)
      VALUES(${lit(pointId)},${lit(companyId)},${lit(customerId)},${lit(siteId)},${lit(siteId)},${lit(gsrn)},${lit(gsrn)},${lit(gsrn)},${lit(tenant.gridOwnerId)},${lit(tenant.edielReceiver)},'TES',${lit(area)},'active','hourly','consumption','consumption',true,true,${lit(marker)}::jsonb);
    INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,
      contract_offer_id,status,contract_version,requested_start_date,starts_at,metadata,created_by,contract_publication_version_id,
      contract_product_id,contract_product_version_id,price_plan_id,price_plan_version_id,
      price_book_id,legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot,
      contract_type,binding_months,notice_months,monthly_fee_sek,auto_renew_enabled,auto_renew_term_months)
    SELECT ${lit(contractId)},${lit(companyId)},${lit(customerId)},${lit(siteId)},
      ${lit(pointId)},${lit(offer.offerId)},'draft','v1',${lit(input.startsAt)}::date,${lit(input.startsAt)}::date,${lit(contractMarker)}::jsonb,
      ${lit(builderUserId)},v.id,p.contract_product_id,v.contract_product_version_id,
      v.price_plan_id,v.price_plan_version_id,v.price_book_id,v.legal_bundle_version_id,
      v.offer_reference,p.commercial_snapshot,l.rendered_snapshot,
      ${lit(input.contractType)},${input.bindingMonths === null ? 'NULL' : input.bindingMonths},${input.noticeMonths},${monthlyFee},
      ${input.autoRenew ? 'true' : 'false'},${renewTerm === null ? 'NULL' : renewTerm}
    FROM public.contract_publication_versions v
    JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id
    JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id
    WHERE v.id=${lit(offer.publicationVersionId)} AND v.status='published';
    COMMIT;`)
  const exists = sqlJson<boolean>(`SELECT to_jsonb(count(*)=1) FROM public.customer_contracts WHERE id=${lit(contractId)}`)
  if (!exists) throw new Error('term_fixture_draft_contract_not_created (publication version saknas eller inte published)')

  // Canonical signering: prepare + finalize (invoiceTestContractLifecycle.ts:22-104). Token-hashen lämnar aldrig backend.
  const client = serviceClient()
  const tokenHash = randomBytes(32).toString('hex')
  const prepared = await client.rpc('gridex_prepare_customer_contract_signature_request_v1', {
    p_company_id: companyId, p_customer_id: customerId, p_contract_id: contractId, p_token_hash: tokenHash,
    p_recipient_email: email, p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), p_actor_user_id: builderUserId, p_channel: 'internal',
  })
  if (prepared.error) throw new Error(`prepare_signature: ${prepared.error.message}`)
  const finalized = await client.rpc('gridex_finalize_customer_contract_signature_v1', {
    p_token_hash: tokenHash, p_signed_ip_hash: null, p_signed_user_agent: 'Gridex TERM sim synthetic acceptance · TEST ONLY',
  })
  if (finalized.error) throw new Error(`finalize_signature: ${finalized.error.message}`)

  const contractRow = psqlRows<Record<string, unknown>>(`SELECT * FROM public.customer_contracts WHERE id=${lit(contractId)}`)[0]
  if (!contractRow || contractRow.status !== 'signed' || !contractRow.signed_at || !contractRow.contract_price_snapshot_id) {
    throw new Error(`term_fixture_signing_not_verified: ${JSON.stringify({ status: contractRow?.status, signed_at: contractRow?.signed_at })}`)
  }
  const priceSnapshotId = String(contractRow.contract_price_snapshot_id)
  const snapshotRow = psqlRows<Record<string, unknown>>(`SELECT * FROM public.contract_price_snapshots WHERE id=${lit(priceSnapshotId)}`)[0]
  const optionRow = psqlRows<Record<string, unknown>>(`SELECT * FROM public.contract_price_options WHERE id=${lit(offer.priceOptionId)}`)[0]
  const snapshotJson = (snapshotRow.snapshot_json ?? {}) as Record<string, unknown>
  const components = Array.isArray(snapshotRow.price_components_snapshot) ? snapshotRow.price_components_snapshot as Record<string, unknown>[] : []
  const feeComponent = components.find((c) => (c.component_code ?? c.componentCode) === 'monthly_fee') ?? null
  const asNumber = (v: unknown) => (v === null || v === undefined ? null : Number(v))

  return {
    tenant, companyId, customerId, siteId, meteringPointId: pointId, gsrn, contractId,
    offerId: offer.offerId, publicationVersionId: offer.publicationVersionId, priceOptionId: offer.priceOptionId, priceSnapshotId,
    declaredSignedAt, actualSignedAt: String(contractRow.signed_at), input,
    sources: {
      contractRow, optionRow, snapshotRow,
      snapshotMonthlyFeeSek: asNumber(snapshotJson.monthly_fee_sek),
      snapshotBindingMonths: asNumber(snapshotJson.binding_months),
      snapshotMonthlyFeeComponent: feeComponent,
    },
  }
}

export type SqlErrorResult = { sqlstate: string; message: string; raw: string }

/**
 * Kör SQL i en transaktion som ALLTID rullas tillbaka (BEGIN ... ROLLBACK) och returnerar SQLSTATE + meddelande
 * för första felet, eller null om satserna lyckades (då är inget persisterat). VERBOSITY=verbose ger SQLSTATE.
 */
export function psqlExpectError(sql: string): SqlErrorResult | null {
  if (!/^postgres(ql)?:\/\/[^@]+@(127\.0\.0\.1|localhost)[:/]/.test(sim.dbUrl)) throw new Error('sim_db_local_only')
  try {
    execFileSync('psql', [sim.dbUrl, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], {
      input: `BEGIN;\n${sql}\nROLLBACK;`, encoding: 'utf8', timeout: 60_000, maxBuffer: 16_000_000,
      env: { ...process.env, PGCONNECT_TIMEOUT: '10' }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    return null
  } catch (error) {
    const stderr = String((error as { stderr?: unknown }).stderr ?? '')
    const match = /ERROR:\s+([0-9A-Z]{5}):\s*(.*)/.exec(stderr)
    if (!match) throw new Error(`psql_failed_without_sqlstate: ${stderr.slice(0, 400)}`)
    return { sqlstate: match[1], message: match[2].trim(), raw: stderr.split('\n')[0] }
  }
}

/** md5 över hela radens JSON-form; för före/efter-jämförelse av oföränderlighet. */
export function rowHash(table: 'customer_contracts' | 'contract_price_snapshots', id: string): string {
  return psql(`SELECT md5(to_jsonb(t)::text) FROM public.${table} t WHERE t.id=${lit(id)}`)
}
