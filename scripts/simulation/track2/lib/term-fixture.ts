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
// Avvikelser mot förlagan: egen tenant per createTermTenant(); kund/site/mätpunkt via ordinarie intake,
// avtal från erbjudande via HTTP-action och kanoniska signerings-RPC:er. Ingen switch/POA/Z03.
// Villkoren härleds av appens skapande från valt prisalternativ och publicerad komponentversion.
//
// VAR AVTALSPRIS/MÅNADSAVGIFT KOMMER FRÅN (läst i stackens funktionskroppar):
//  - customer_contracts.binding_months/notice_months/monthly_fee_sek/auto_renew_*: draft-raden. I appens
//    admin-skapande (gridex_create_internal_customer_contract_v1) kommer binding/notice/auto_renew från
//    contract_price_options och monthly_fee_sek från komponent 'monthly_fee' i vald price_components_snapshot.
//  - gridex_prepare_signature_before_record_retention_v1 skapar contract_price_snapshots (snapshot_json innehåller
//    monthly_fee_sek, binding_months, notice_months, starts_at, ends_at kopierade från raden) och sätter
//    customer_contracts.contract_price_snapshot_id. Snapshotens komponenter kommer från publicerad commercial_snapshot.
//  Fixturen håller offer, option, rad och komponent i samma värden och exponerar alla i `sources`.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { psql, psqlRows, serviceClient } from './db'
import { sim } from './env'
import { createAdminFixture, observeFixtureActor, type AdminFixture } from './fixture'
import { loginSession, type AppSession } from './session'
import { callServerAction, type ServerActionResult } from './server-action'

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
  offerCache: Map<string, { offerId: string; publicationVersionId: string; priceOptionId: string; optionReference: string }>
  /** Inloggad admin-session (lazy, se tenantSession). */
  session?: AppSession
}

/** Riktig cookie-session för tenantens admin (auth = real tid). */
export async function tenantSession(tenant: TermTenant): Promise<AppSession> {
  tenant.session ??= await loginSession(tenant.admin.email, tenant.admin.password, { companyId: tenant.companyId })
  if (typeof process !== 'undefined' && process.env.SIM_REQUIRE_ACTOR_RECEIPT === '1'
    && (!tenant.session.actorProof || tenant.session.actorProof.intent !== 'authorized'
      || tenant.session.actorProof.userId !== tenant.admin.userId || tenant.session.actorProof.companyId !== tenant.companyId
      || !tenant.session.actorProof.selectedCompanyVerified)) {
    throw new Error('term_actor_session_proof_missing')
  }
  return tenant.session
}

/**
 * Det som INTE går via appens egna ingångar utan skrivs direkt (SQL/RPC) i fixturen. Skrivs ut i loggen en gång.
 * Kund/anläggning/mätpunkt, avtal och avtalsändringsförsök går via HTTP server actions.
 */
export const BACKEND_REPLACEMENTS = [
  'SQL: company-uppgifter (org_number, legal profile), ediel_actor/brp/route-profiler, company_email_settings/templates/event_rules, platform_market_actors + identifiers, tenant_actor_identifiers, grid_owners (verified_for_customer_flow=true, actor_registry_status=verified)',
  'SQL: auth.users/user_profiles/company_memberships/roles/user_roles/role_permissions/admin_users för builder-aktör och login-adminens engångsroll (role_permissions ger customers.write/contracts.write m.fl.)',
  'RPC (service_role): gridex_upsert_internal_contract_offer_v3 (skapar även contract_price_options ur snapshotens price_options, som appens egen väg), gridex_publish_internal_contract_version (publishContractVersionAction-motsvarighet; ingen kanalaktivering, se kommentar i ensureOffer)',
  'SQL: gridex_materialize_legal_bundle_version + UPDATE contract_offers.legal_bundle_version_id (legal bundle)',
  'HTTP: createCustomerAction skapar kund/site/mätpunkt; exakt tenant-/intake-/grafkvittokontroll före fortsatt avtal. SQL märker enbart verifierade syntetiska rader som testdata.',
  'Signerat dokument arkiveras inte (ingen PDF-arkivering; customer_contracts.document_sha256 är null): bindning via acceptansbevis (customer_contract_evidence/acceptances) och juridiska accepter (customer_legal_acceptances)',
  'RPC (service_role): gridex_prepare_customer_contract_signature_request_v1 + gridex_finalize_customer_contract_signature_v1 (ersätter UI-/länksignering; signed_at = real tid)',
] as const
let replacementsLogged = false
function logBackendReplacements() {
  if (replacementsLogged) return
  replacementsLogged = true
  console.info(`[BACKEND_REPLACEMENTS]\n - ${BACKEND_REPLACEMENTS.join('\n - ')}`)
}

/**
 * Unik syntetisk tenant per körning: företag + login-admin + builder-aktör + Ediel/legal-underlag som krävs
 * för att den kanoniska publiceringen ska godkänna ett erbjudande. companies saknar is_test_data; kund, site
 * och mätpunkt märks is_test_data=true i createSignedContract.
 */
/** Det fixturens egna HTTP-actions kräver (requireAdminActionAccess i lib/admin/guards.ts:269 kastar Forbidden annars); alltid en union med det anroparen begär. */
export const FIXTURE_REQUIRED_PERMISSIONS = ['customers.read', 'customers.write', 'contracts.read', 'contracts.write', 'contracts.create', 'masterdata.read'] as const

export async function createTermTenant(opts: { permissionKeys?: string[] } = {}): Promise<TermTenant> {
  const runId = randomBytes(4).toString('hex')
  const admin = await createAdminFixture({
    permissionKeys: Array.from(new Set([...FIXTURE_REQUIRED_PERMISSIONS, ...(opts.permissionKeys ?? [])])),
    companyName: `Synthetic TERM tenant ${runId}`,
  })
  const companyId = admin.companyId
  const builderUserId = randomUUID()
  const gridOwnerId = randomUUID()
  const marketActor = randomUUID()
  const brpEdielId = '99876'

  // Aktörsroll så att medlemskapet listas av kanoniska tenantkontexten (nativeActorRoleSql i förlagan), för båda användarna.
  // HARNESSFEL (rättat): adminsidans behörighet kommer från canonical_authenticated_tenant_context_v1_scoped, som
  // läser user_roles -> role_permissions -> permissions, INTE user_permissions. Utan role_permissions blir
  // permissions=[] => isAdmin=false => requireAdminAccess redirect('/login') (lib/admin/guards.ts:~190) => 307.
  // Login-adminens engångsroll får därför role_permissions för nyckellistan.
  const roleSql = (userId: string, permissionKeys: string[] = []) => {
    const role = randomUUID(); const key = `native_actor_${role}`
    const grants = permissionKeys.length === 0 ? '' : `
      INSERT INTO public.role_permissions(role_id,role_key,permission_id,permission_key,effect)
        SELECT ${lit(role)},${lit(key)},id,key,'allow' FROM public.permissions WHERE key IN (${permissionKeys.map(lit).join(',')});`
    return `INSERT INTO public.roles(id,key,name,scope) VALUES(${lit(role)},${lit(key)},'Disposable native actor role','company');
      INSERT INTO public.user_roles(user_id,company_id,role_id,role,status,is_active) VALUES(${lit(userId)},${lit(companyId)},${lit(role)},${lit(key)},'active',true);${grants}`
  }
  psql(`BEGIN;
    ${roleSql(admin.userId, admin.permissionKeys)}
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
    INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status,owner_code,verified_for_customer_flow,actor_registry_status) VALUES(${lit(gridOwnerId)},${lit(companyId)},'Synthetic TERM grid',${lit(edielReceiver)},'test',true,'active','TES',true,'verified');
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

  // Capture the role_permissions path only after the actual SQL role grants.
  // This fixture observation never replaces fresh authenticated checks per fetch.
  if (typeof process !== 'undefined' && process.env.SIM_REQUIRE_ACTOR_RECEIPT === '1') {
    admin.observedFixture = observeFixtureActor(admin.userId, companyId)
  }

  return { runId, companyId, admin, builderUserId, edielSender, edielReceiver, gridOwnerId, offerCache: new Map() }
}

/** Kopia av appens identitetsnyckel (app/admin/customers/actions.part-3.ts:35-83) för ett intake utan avtalsdel. */
function expectedIntakeKey(companyId: string, f: { personalNumber: string; email: string; firstName: string; lastName: string; facilityId: string; meterPointId: string; street: string; postalCode: string; city: string; siteName: string }): string {
  const identity = ['private', f.personalNumber, '', f.email, '', f.firstName, f.lastName, '', f.facilityId, f.meterPointId, f.street, f.postalCode, f.city, f.siteName,
    '', '', '', '', '', '', '', '', 'create_new_pending_review', '', '', '', '', '', '', '', '', '', '', '', '', '', '[]'].join('|')
  return `customer_create:${companyId}:${createHash('sha256').update(identity).digest('hex')}`
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
  /** Återanvänd befintlig kund/anläggning/mätpunkt (skapar bara ett nytt avtal). */
  existing?: { customerId: string; siteId: string; meteringPointId: string; gsrn: string }
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
  creation: CreationTrail
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

function pricingFor(input: CreateSignedContractInput, monthlyFee: number, area: string, pilotInvoiceFee = false) {
  const resolution = /quarter/.test(input.contractType) ? 'quarterly' : /hour/.test(input.contractType) ? 'hourly' : 'monthly'
  const feeComponent: Record<string, unknown> = {
    component_code: 'monthly_fee', component_type: 'fee', name: 'Månadsavgift', calculation_type: 'fixed_monthly',
    amount: monthlyFee, unit: 'sek_month', website_card_visible: true,
    // priceComponentCalculator.ts:67-91 prorerar bara när komponentens periodization_mode = prorated_by_days OCH metadata har policyn.
    ...(input.prorationPolicy ? { periodization_mode: input.prorationPolicy, metadata: { proration_policy: input.prorationPolicy } } : {}),
  }
  return {
    schema: 'gridex_contract_pricing_v5', pricing_model: 'spot', energy_direction: 'consumption',
    interval_resolution: resolution, vat_rate: 0.25, price_areas: [area],
    base_components: [{ source_type: 'spot', label: 'Spotpris', weight_percent: 100, price_area: area }],
    price_components: [
      { component_code: 'spot_markup', component_type: 'markup', name: 'Påslag', calculation_type: 'per_kwh', amount: 4, unit: 'ore_per_kwh', website_card_visible: true },
      feeComponent,
      // Opt-in pilot preserves the existing offer's 19 SEK invoice fee in its
      // actual accepted component snapshot; legacy case snapshots stay intact.
      ...(pilotInvoiceFee ? [{ component_code: 'invoice_fee', component_type: 'invoice_fee', name: 'Fakturaavgift', calculation_type: 'fixed_once', amount: 19, unit: 'sek_invoice', website_card_visible: true }] : []),
    ],
  }
}

async function ensureOffer(tenant: TermTenant, input: CreateSignedContractInput, monthlyFee: number, area: string, mode: 'rpc_v3' | 'legacy_v2' = 'rpc_v3', historicalValidFrom?: string) {
  const bindingForOption = input.bindingMonths ?? 0
  const renewTerm = input.autoRenew ? (input.autoRenewTermMonths ?? (bindingForOption > 0 ? bindingForOption : 12)) : null
  const key = JSON.stringify([input.contractType, bindingForOption, input.noticeMonths, monthlyFee, input.prorationPolicy ?? null, area, input.autoRenew ?? false, renewTerm, mode])
  const cached = tenant.offerCache.get(key)
  if (cached) return cached
  const n = tenant.offerCache.size + 1
  const { companyId, builderUserId } = tenant
  const slug = `term-${tenant.runId}-${n}`
  const offer = {
    name: `Synthetic TERM offer ${slug}`, slug, lifecycle_status: 'draft', contract_type: input.contractType, customer_type: 'both',
    pricing_model: 'spot', energy_direction: 'consumption', terms_version: 'test-v1', spot_markup_ore_per_kwh: 4,
    monthly_fee_sek: monthlyFee, invoice_fee_sek: 19, default_binding_months: input.bindingMonths,
    default_notice_months: input.noticeMonths, automatic_renewal: Boolean(input.autoRenew),
    ...(renewTerm ? { automatic_renewal_term_months: renewTerm } : {}),
    power_of_attorney_required: true,
    valid_from: historicalValidFrom ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
  }
  const client = serviceClient()
  const optionRef = `term-${tenant.runId}-${n}`
  // rpc_v3 = appens egen väg (app/admin/contracts/actions.ts:392): v3-RPC:n skapar contract_price_options/områdespriser
  // ur pricing-snapshotens price_options, och erbjudandets commercial_snapshot får då en kommersiell modell, vilket gör att
  // createContractFromOfferAction väljer RPC-vägen gridex_create_internal_customer_contract_v1. legacy_v2 (utan price_options)
  // ger TS-vägen createCustomerContract (fynd 005) och används bara av TERM01.PRE.
  const pricing = pricingFor(input, monthlyFee, area, historicalValidFrom !== undefined)
  const snapshot = mode === 'rpc_v3'
    ? {
        ...pricing, snapshot_schema: 'gridex_contract_pricing_v6_selection', schema_version: 'gridex_contract_pricing_v6_selection',
        price_options: [{
          price_option_reference: optionRef, option_code: optionRef, customer_name: 'Synthetic TERM price', internal_description: null,
          contract_type: input.contractType, customer_type: 'both', binding_months: bindingForOption, notice_months: input.noticeMonths,
          auto_renew_enabled: Boolean(input.autoRenew), renewal_term_months: renewTerm, default: true, selection_required: false,
          valid_from: null, valid_to: null, earliest_start_date: null, latest_start_date: null, status: 'active', sort_order: 0, version_number: 1,
          area_prices: [], metadata: { customer_type: 'both', is_default: true, selection_required: false },
        }],
        commercial_components: [], invoice_delivery_methods: ['email'], default_price_option_reference: optionRef,
      }
    : pricing
  const created = await client.rpc(mode === 'rpc_v3' ? 'gridex_upsert_internal_contract_offer_v3' : 'gridex_upsert_internal_contract_offer_v2', {
    p_company_id: companyId, p_offer_id: null, p_payload: offer, p_pricing_snapshot: snapshot, p_actor_user_id: builderUserId,
  })
  if (created.error) throw new Error(`upsert_offer(${mode}): ${created.error.message}`)
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

  // INGEN gridex_publish_contract_channel här. Appens sekvens är: spara (v3) -> publishContractVersionAction
  // (gridex_publish_internal_contract_version, sätter offer published/active/is_active) -> skapa avtal. Avtals-RPC:n
  // gridex_create_internal_customer_contract_v1 anropar själv gridex_ensure_internal_contract_publication, som skapar den publicerade
  // publication-versionen (snapshot gridex_internal_publication_v1). En föregående kanalaktivering skapar en annan publicerad version
  // (gridex_contract_publication_v6) i samma publication och ensure kolliderar då mot unikindexet
  // contract_publication_versions_one_published_per_publication_uid (23505): se rapporterad produktkandidat.
  let priceOptionId = ''
  if (mode === 'rpc_v3') {
    const rows = psqlRows<{ id: string }>(`select id from public.contract_price_options where company_id=${lit(companyId)} and option_reference=${lit(optionRef)}`)
    if (rows.length !== 1) throw new Error(`v3-RPC skapade ${rows.length} contract_price_options för ${optionRef} (väntade 1)`)
    priceOptionId = rows[0].id
  }

  const entry = { offerId, publicationVersionId: '', priceOptionId, optionReference: optionRef }
  tenant.offerCache.set(key, entry)
  return entry
}

/** Hjälp: kasta tydligt fel när en server action kastade eller inte gav väntat resultat. */
function assertActionOk(label: string, r: ServerActionResult) {
  if (r.httpStatus >= 400 || r.threw) {
    throw new Error(`${label}: server action misslyckades (HTTP ${r.httpStatus}, kastade=${r.threw}, redirect=${r.redirect ?? '-'}) ${r.errorRows.join(' | ')} :: ${r.excerpt.replace(/\s+/g, ' ').slice(0, 300)} (meddelandet finns i appens serverlogg, app.log)`)
  }
}

export type CreationTrail = {
  customerAction: { httpStatus: number; redirect: string | null; requestId?: string; intakeId?: string; idempotencyKey?: string; state: unknown }
  contractAction: { httpStatus: number; redirect: string | null }
  /** metadata.source_of_truth på avtalsraden: 'contract_price_options' = RPC-vägen, annars TS-vägen createCustomerContract. */
  contractPath: 'rpc_gridex_create_internal_customer_contract_v1' | 'ts_createCustomerContract'
  sourceType: string | null
}

/**
 * Skapar kund + anläggning + mätpunkt via appens intake-action (createCustomerAction, HTTP server action) och avtalet
 * via createContractFromOfferAction (HTTP server action) som den inloggade tenant-adminen. Signeringen görs med de
 * kanoniska prepare/finalize-RPC:erna (ersättning för UI-signering). Märkning is_test_data sätts efteråt.
 * Avtalsfälten (binding/notice/månadsavgift/auto_renew/ends_at) härleds av appens skapande från erbjudandet
 * (price option/offer-defaults) och formuläret, inte av fixturen.
 */
/** Bär utfallet av createContractFromOfferAction till TERM01.PRE-proben (kastas bara när opts.probe är satt). */
export class ContractActionProbe extends Error {
  constructor(public result: ServerActionResult, public contractCount: number) { super('contract_action_probe') }
}

export async function createSignedContract(tenant: TermTenant, input: CreateSignedContractInput, opts: { offerMode?: 'rpc_v3' | 'legacy_v2'; probe?: boolean; uploadedAgreement?: { file: File; signedDate: string; offerValidFrom: string } } = {}): Promise<SignedContractFixture> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startsAt)) throw new Error('startsAt måste vara YYYY-MM-DD')
  logBackendReplacements()
  const area = input.priceArea ?? 'SE3'
  const monthlyFee = input.monthlyFeeSek ?? 49
  const declaredSignedAt = input.signedAt ?? '2026-10-15'
  const { companyId, builderUserId } = tenant
  const uploaded = opts.uploadedAgreement
  if (uploaded) {
    const dates = [uploaded.signedDate, uploaded.offerValidFrom, input.startsAt]
    if (dates.some(value => !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)
      || uploaded.offerValidFrom > uploaded.signedDate || uploaded.signedDate > input.startsAt || uploaded.signedDate >= stockholmToday()
      || !uploaded.file || uploaded.file.type !== 'application/pdf' || uploaded.file.size === 0) throw new Error('pilot_historical_signing_invalid')
    if (tenant.offerCache.size || input.existing) throw new Error('pilot_fresh_offer_and_customer_required')
  }
  const offer = await ensureOffer(tenant, input, monthlyFee, area, opts.offerMode ?? 'rpc_v3', uploaded?.offerValidFrom)
  const session = await tenantSession(tenant)

  // 1. Kund/site/mätpunkt skapas av ordinarie intake. Vid okänt eller delvis
  // committat utfall: stoppa och stäm av kvittot; aldrig SQL-fallback eller retry.
  let gsrn = fixtureGsrn()
  const suffix = randomBytes(4).toString('hex')
  let email = `synthetic-${suffix}-${tenant.runId}@example.invalid`
  let customerId: string; let siteId: string; let pointId: string
  let intakeReceipt: { intakeId: string; idempotencyKey: string } | undefined
  let customerResult: ServerActionResult = { httpStatus: 0, redirect: null, value: 'existing_graph_reused', threw: false, errorRows: [], excerpt: '' }
  if (input.existing) {
    // TERM03.05b återanvänder den redan verifierade kundens graf, ingen ny intake.
    ;({ customerId, siteId, meteringPointId: pointId, gsrn } = input.existing)
    email = psql(`select email from public.customers where id=${lit(customerId)} and company_id=${lit(companyId)}`)
  } else {
    const firstName = 'Synthetic'; const lastName = `Term${suffix}`
    const personalNumber = syntheticPersonalNumber()
    const fields: Record<string, string> = {
      customerType: 'private', firstName, lastName, personalNumber, email,
      siteName: 'TERM site', facilityId: gsrn, meterPointId: gsrn, siteType: 'consumption',
      gridOwnerId: tenant.gridOwnerId, priceAreaCode: area, gridAreaCode: 'TES',
      street: 'Testgatan 1', postalCode: '12345', city: 'Teststad', country: 'SE',
      currentSupplierUnknown: 'on', postCreateAction: 'open_customer',
    }
    const form = new FormData()
    for (const [key, value] of Object.entries(fields)) form.append(key, value)
    customerResult = await callServerAction(session, {
      route: '/admin/customers/intake', filename: 'app/admin/customers/actions.ts', exportedName: 'createCustomerAction',
      args: [{ status: 'idle', message: '', fieldErrors: {}, values: {}, createdCustomerId: null }, form], worker: 'app/admin/customers/intake/page',
    })
    if (customerResult.httpStatus !== 200 || customerResult.threw || customerResult.errorRows.length > 0 || customerResult.redirect !== null) {
      throw new Error('term_intake_transport_unconfirmed: stäm av befintlig intake/graf före nytt försök')
    }
    const state = customerResult.value
    if (!state || typeof state !== 'object' || Array.isArray(state) || !('status' in state) || state.status !== 'success') {
      throw new Error('term_intake_outcome_unconfirmed: success krävs; committed_review eller okänt utfall måste stämmas av')
    }
    const result = state as Record<string, unknown>
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const returnedIds = [result.createdCustomerId, result.createdSiteId, result.createdMeteringPointId]
    if (!returnedIds.every((id): id is string => typeof id === 'string' && uuid.test(id))) {
      throw new Error('term_intake_graph_ids_missing: inget nytt försök eller SQL-fallback')
    }
    ;[customerId, siteId, pointId] = returnedIds as [string, string, string]
    const key = expectedIntakeKey(companyId, { personalNumber, email, firstName, lastName, facilityId: gsrn, meterPointId: gsrn,
      street: fields.street, postalCode: fields.postalCode, city: fields.city, siteName: fields.siteName })
    // Övre admin-intake använder nyckeln nedan; kanoniska grafkommandot har
    // separat prefix admin:. Endast den exakta tenantens sparade kvitto duger.
    const intakes = psqlRows<{ id: string; company_id: string; status: string; customer_id: string; result: Record<string, unknown> | null }>(`
      SELECT id,company_id,status,customer_id,result FROM public.customer_application_intakes
      WHERE company_id=${lit(companyId)} AND idempotency_key=${lit(key)}`)
    const intake = intakes[0]
    if (intakes.length !== 1 || intake.company_id !== companyId || intake.status !== 'completed' || intake.customer_id !== customerId
      || !intake.result || intake.result.review_required === true || intake.result.customer_id !== customerId
      || intake.result.created_site_id !== siteId || intake.result.created_metering_point_id !== pointId) {
      throw new Error('term_intake_receipt_mismatch: stäm av exakta intake- och grafidentiteter')
    }
    const graphs = psqlRows<Record<string, unknown>>(`
      SELECT c.id AS customer_id,c.company_id,c.email AS customer_email,c.personal_number,
        s.id AS site_id,s.company_id AS site_company_id,s.customer_id AS site_customer_id,s.facility_id,s.price_area_code,
        m.id AS metering_point_id,m.company_id AS point_company_id,m.customer_id AS point_customer_id,
        m.site_id AS point_site_id,m.meter_point_id AS point_gsrn
      FROM public.customers c
      JOIN public.customer_sites s ON s.id=${lit(siteId)} AND s.company_id=c.company_id AND s.customer_id=c.id
      JOIN public.metering_points m ON m.id=${lit(pointId)} AND m.company_id=c.company_id AND m.customer_id=c.id AND m.site_id=s.id
      WHERE c.id=${lit(customerId)} AND c.company_id=${lit(companyId)}`)
    const graph = graphs[0]
    const expected: Record<string, unknown> = {
      customer_id: customerId, company_id: companyId, customer_email: email, personal_number: personalNumber,
      site_id: siteId, site_company_id: companyId, site_customer_id: customerId, facility_id: gsrn, price_area_code: area,
      metering_point_id: pointId, point_company_id: companyId, point_customer_id: customerId, point_site_id: siteId, point_gsrn: gsrn,
    }
    if (graphs.length !== 1 || Object.entries(expected).some(([field, value]) => graph[field] !== value)) {
      throw new Error('term_intake_graph_mismatch: tenant, ägare eller inskickade affärsfält stämmer inte')
    }
    intakeReceipt = { intakeId: intake.id, idempotencyKey: key }
    // Testmarkering först efter verifierat affärskvitto; inga affärsfält ändras.
    const marker = lit({ test_center: { kind: 'invoice_test_customer' } })
    psql(`UPDATE public.customers SET is_test_data=true,metadata=coalesce(metadata,'{}'::jsonb)||${marker}::jsonb WHERE id=${lit(customerId)} AND company_id=${lit(companyId)};
      UPDATE public.customer_sites SET is_test_data=true,metadata=coalesce(metadata,'{}'::jsonb)||${marker}::jsonb WHERE id=${lit(siteId)} AND company_id=${lit(companyId)} AND customer_id=${lit(customerId)};
      UPDATE public.metering_points SET is_test_data=true,metadata=coalesce(metadata,'{}'::jsonb)||${marker}::jsonb WHERE id=${lit(pointId)} AND company_id=${lit(companyId)} AND customer_id=${lit(customerId)} AND site_id=${lit(siteId)};`)
  }

  // 2. Avtal från erbjudande: createContractFromOfferAction (kundkortets formulär).
  const contractForm = new FormData()
  const cput = (k: string, v: string) => contractForm.append(k, v)
  cput('customer_id', customerId); cput('contract_offer_id', offer.offerId); cput('site_id', siteId); cput('metering_point_id', pointId)
  cput('starts_at', input.startsAt); cput('signing_method', uploaded ? 'uploaded_signed' : 'draft'); cput('invoice_delivery_method', 'email')
  if (uploaded) { contractForm.append('signed_agreement_file', uploaded.file); cput('signed_date', uploaded.signedDate) }
  cput('price_option_reference', offer.optionReference)
  const hasModel = psql(`select (jsonb_typeof(commercial_snapshot->'price_options')='array' and jsonb_array_length(commercial_snapshot->'price_options')>0)::text from public.contract_offers where id=${lit(offer.offerId)}`) === 'true'
  const predictedPath = hasModel ? 'rpc_gridex_create_internal_customer_contract_v1' : 'ts_createCustomerContract'
  console.info(`[contractPath] FÖRE anrop: offer ${offer.offerId.slice(0, 8)} price_options i commercial_snapshot=${hasModel} => förutsagd väg ${predictedPath}`)
  const knownContractIds = new Set(psqlRows<{ id: string }>(`select id from public.customer_contracts where company_id=${lit(companyId)} and customer_id=${lit(customerId)}`).map((r) => r.id))
  const contractResult = await callServerAction(session, {
    route: `/admin/customers/${customerId}`, filename: 'components/admin/customers/contracts/actions.ts',
    exportedName: 'createContractFromOfferAction', args: [contractForm], worker: 'app/admin/customers/[id]/page',
  })
  console.info(`[contractPath] EFTER anrop: HTTP ${contractResult.httpStatus} kastade=${contractResult.threw} förutsagd väg ${predictedPath} request-id=${contractResult.requestId}`)
  if (opts.probe) throw new ContractActionProbe(contractResult, psqlRows<{ id: string }>(`select id from public.customer_contracts where company_id=${lit(companyId)} and customer_id=${lit(customerId)}`).filter((r) => !knownContractIds.has(r.id)).length)
  assertActionOk('createContractFromOfferAction', contractResult)
  const contractRows = psqlRows<{ id: string }>(`select id from public.customer_contracts where company_id=${lit(companyId)} and customer_id=${lit(customerId)}`).filter((r) => !knownContractIds.has(r.id))
  if (contractRows.length !== 1) throw new Error(`createContractFromOfferAction skapade ${contractRows.length} nya avtal; svar: ${contractResult.excerpt.slice(0, 300)}`)
  const contractId = contractRows[0].id
  const created = psqlRows<{ status: string; source_type: string | null; metadata: Record<string, unknown> | null }>(`select status,source_type,metadata from public.customer_contracts where id=${lit(contractId)}`)[0]
  const pubVersionId = psql(`select contract_publication_version_id from public.customer_contracts where id=${lit(contractId)}`)
  if (!pubVersionId) throw new Error('avtalet saknar contract_publication_version_id efter skapandet')
  offer.publicationVersionId = pubVersionId
  const contractPath = created.metadata?.source_of_truth === 'contract_price_options' ? 'rpc_gridex_create_internal_customer_contract_v1' as const : 'ts_createCustomerContract' as const
  console.info(`[contractPath] contract ${contractId.slice(0, 8)} => ${contractPath} (source_of_truth=${String(created.metadata?.source_of_truth ?? '-')}, source_type=${created.source_type})`)
  if (contractPath !== 'rpc_gridex_create_internal_customer_contract_v1') {
    throw new Error('TS-vägen createCustomerContract valdes i stället för RPC-vägen; TS-vägen skriver kolumner som saknas i schemat (fynd 005, t.ex. current_supplier_contract_end_date). TERM-stegen kräver RPC-vägen.')
  }
  // Deklarerat signeringsdatum följer med som metadata (ingen affärslogik); skrivs före signering på ett draft-avtal.
  if (!uploaded) psql(`UPDATE public.customer_contracts SET metadata=coalesce(metadata,'{}'::jsonb)||${lit({ sim_declared_signed_at: declaredSignedAt, test_center: { kind: 'invoice_test_customer' } })}::jsonb WHERE id=${lit(contractId)} AND status='draft' AND signed_at IS NULL;`)

  // Uploaded pilot uses the same create action's actual PDF import; legacy cases retain canonical RPC signing.
  if (!uploaded) {
    // 3. Signering: kanonisk prepare/finalize (ersätter UI-signering).
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
  }

  const contractRow = psqlRows<Record<string, unknown>>(`SELECT * FROM public.customer_contracts WHERE id=${lit(contractId)}`)[0]
  if (!contractRow || contractRow.status !== 'signed' || !contractRow.signed_at || !contractRow.contract_price_snapshot_id) {
    throw new Error(`term_fixture_signing_not_verified: ${JSON.stringify({ status: contractRow?.status, signed_at: contractRow?.signed_at })}`)
  }
  if (uploaded) {
    const documents = psqlRows<Record<string, unknown>>(`SELECT id,document_sha256,verified_at,generated_at,storage_path FROM public.customer_contract_documents WHERE company_id=${lit(companyId)} AND customer_contract_id=${lit(contractId)} AND document_type='signed_contract_pdf' AND document_sha256=${lit(contractRow.document_sha256)}`)
    const expectedHash = createHash('sha256').update(Buffer.from(await uploaded.file.arrayBuffer())).digest('hex')
    if (String(contractRow.signed_at).slice(0, 10) !== uploaded.signedDate || contractRow.document_sha256 !== expectedHash
      || documents.length !== 1 || !documents[0].verified_at || !documents[0].storage_path || !documents[0].generated_at) throw new Error('pilot_uploaded_signature_readback_failed')
  }
  const priceSnapshotId = String(contractRow.contract_price_snapshot_id)
  const snapshotRow = psqlRows<Record<string, unknown>>(`SELECT * FROM public.contract_price_snapshots WHERE id=${lit(priceSnapshotId)}`)[0]
  const optionRow = offer.priceOptionId ? psqlRows<Record<string, unknown>>(`SELECT * FROM public.contract_price_options WHERE id=${lit(offer.priceOptionId)}`)[0] : {}
  const snapshotJson = (snapshotRow.snapshot_json ?? {}) as Record<string, unknown>
  const components = Array.isArray(snapshotRow.price_components_snapshot) ? snapshotRow.price_components_snapshot as Record<string, unknown>[] : []
  const feeComponent = components.find((c) => (c.component_code ?? c.componentCode) === 'monthly_fee') ?? null
  const asNumber = (v: unknown) => (v === null || v === undefined ? null : Number(v))

  return {
    tenant, companyId, customerId, siteId, meteringPointId: pointId, gsrn, contractId,
    offerId: offer.offerId, publicationVersionId: offer.publicationVersionId, priceOptionId: offer.priceOptionId, priceSnapshotId,
    declaredSignedAt, actualSignedAt: String(contractRow.signed_at), input,
    creation: {
      customerAction: { httpStatus: customerResult.httpStatus, redirect: customerResult.redirect, requestId: customerResult.requestId, ...intakeReceipt, state: customerResult.value },
      contractAction: { httpStatus: contractResult.httpStatus, redirect: contractResult.redirect },
      contractPath, sourceType: created.source_type,
    },
    sources: {
      contractRow, optionRow, snapshotRow,
      // v6-selection: avgiften ligger i price_components_snapshot (monthly_fee), bindningen i valt prisalternativ.
      snapshotMonthlyFeeSek: asNumber(feeComponent?.amount ?? snapshotJson.monthly_fee_sek),
      snapshotBindingMonths: asNumber((Array.isArray(snapshotJson.price_options) ? (snapshotJson.price_options as Record<string, unknown>[]).find((o) => o.price_option_reference === snapshotJson.price_option_reference)?.binding_months : undefined) ?? snapshotJson.binding_months),
      snapshotMonthlyFeeComponent: feeComponent,
    },
  }
}

/**
 * TERM01.PRE: en färsk unik inskickning via createCustomerAction (HTTP). Skapar ingen data som övriga steg använder.
 * Utfallet loggas av anroparen; räknas inte in i TERM-ID:ns utfall.
 */
export async function probeCreateCustomerAction(tenant: TermTenant): Promise<{ httpStatus: number; requestId?: string; state: unknown; intake: { id: string; status: string; stage: string }[]; customersCreated: number; error: string | null }> {
  const session = await tenantSession(tenant)
  const gsrn = fixtureGsrn(); const suffix = randomBytes(4).toString('hex')
  const email = `synthetic-pre-${suffix}-${tenant.runId}@example.invalid`
  const personalNumber = syntheticPersonalNumber()
  const form = new FormData()
  const put = (k: string, v: string) => form.append(k, v)
  put('customerType', 'private'); put('firstName', 'Synthetic'); put('lastName', `Pre${suffix}`)
  put('email', email); put('personalNumber', personalNumber)
  put('siteName', 'TERM site'); put('facilityId', gsrn); put('meterPointId', gsrn); put('siteType', 'consumption')
  put('gridOwnerId', tenant.gridOwnerId); put('priceAreaCode', 'SE3'); put('gridAreaCode', 'TES')
  put('street', 'Testgatan 1'); put('postalCode', '12345'); put('city', 'Teststad'); put('country', 'SE'); put('currentSupplierUnknown', 'on')
  const r = await callServerAction(session, {
    route: '/admin/customers/intake', filename: 'app/admin/customers/actions.ts', exportedName: 'createCustomerAction',
    args: [{ status: 'idle', message: '', fieldErrors: {}, values: {}, createdCustomerId: null }, form], worker: 'app/admin/customers/intake/page',
  })
  const key = expectedIntakeKey(tenant.companyId, { personalNumber, email, firstName: 'Synthetic', lastName: `Pre${suffix}`, facilityId: gsrn, meterPointId: gsrn, street: 'Testgatan 1', postalCode: '12345', city: 'Teststad', siteName: 'TERM site' })
  const intake = psqlRows<{ id: string; status: string; stage: string }>(`select id,status,stage from public.customer_application_intakes where company_id=${lit(tenant.companyId)} and idempotency_key=${lit(key)}`)
  const customersCreated = Number(psql(`select count(*) from public.customers where company_id=${lit(tenant.companyId)} and email=${lit(email)}`))
  const state = r.value as { status?: string; message?: string } | null
  return { httpStatus: r.httpStatus, requestId: r.requestId, state, intake, customersCreated, error: r.threw ? r.errorRows.join(' | ') : state?.status === 'error' ? String(state.message) : null }
}

/**
 * TERM01.PRE createContract TS-path: erbjudande utan price_options => appens action väljer TS-vägen createCustomerContract.
 * Deterministiskt (ingen price_option_reference, ingen kommersiell modell). Loggar fynd 005-utfallet; inga signeringar.
 */
export async function probeCreateContractTsPath(tenant: TermTenant): Promise<{ httpStatus: number; requestId?: string; threw: boolean; errorRows: string[]; excerpt: string; contractsCreated: number }> {
  try {
    await createSignedContract(tenant, { contractType: 'variable_hourly', bindingMonths: 12, noticeMonths: 1, startsAt: '2026-11-01', priceArea: 'SE3' }, { offerMode: 'legacy_v2', probe: true })
  } catch (error) {
    if (error instanceof ContractActionProbe) {
      const r = error.result
      return { httpStatus: r.httpStatus, requestId: r.requestId, threw: r.threw, errorRows: r.errorRows, excerpt: r.excerpt, contractsCreated: error.contractCount }
    }
    throw error
  }
  throw new Error('probe: createSignedContract returnerade utan probe-utfall')
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
