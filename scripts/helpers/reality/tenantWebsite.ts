// Go-live of a tenant's website sales channel, as a platform admin does it:
// publish the offer on the website channel and provision the website
// integration (/admin/platform/api-clients → provisionTenantWebsiteIntegration).
// The one-time API key is what the tenant's website then uses.
import { execFileSync } from 'node:child_process'
import { supabaseService } from '@/lib/supabase/service'
import { provisionTenantWebsiteIntegration } from '@/lib/integrations/tenantWebsiteProvisioning'
import { seedDefaultCompanyEmailConfiguration } from '@/lib/email/bootstrap'
import { approveRouteProfileForProduction } from '@/lib/ediel/routeProfileProductionReadiness'
import { LIVE, literal, sql, type LiveTenant } from '../live-chain-fixture'

export const WEBSITE_ORIGIN = 'https://elhandel.example.invalid'

/**
 * Replay vs production drift (FINDINGS F24): production has
 * webhook_subscriptions.api_client_id and provisioning reads it, but the
 * canonical migration replay does not create it (20260821103000 even notes it
 * as absent). Mirrors production's column, foreign key and indexes exactly.
 */
export function ensureProductionWebhookClientParity() {
  // DDL makes PostgREST reload its schema and reset its pool, cutting in-flight requests: only when missing.
  if (sql<boolean>(`SELECT EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='webhook_subscriptions' AND column_name='api_client_id')`)) return
  sql(`ALTER TABLE public.webhook_subscriptions ADD COLUMN IF NOT EXISTS api_client_id uuid REFERENCES public.integration_api_clients(id) ON DELETE SET NULL;
   CREATE INDEX IF NOT EXISTS idx_fk_webhook_subscriptions_f32dc908898b6f81 ON public.webhook_subscriptions USING btree (api_client_id);
   CREATE INDEX IF NOT EXISTS webhook_subscriptions_api_client_idx ON public.webhook_subscriptions USING btree (api_client_id, status, created_at DESC) WHERE (api_client_id IS NOT NULL);
   CREATE UNIQUE INDEX IF NOT EXISTS webhook_subscriptions_company_client_endpoint_uidx ON public.webhook_subscriptions USING btree (company_id, api_client_id, endpoint_url) WHERE ((api_client_id IS NOT NULL) AND (status <> 'revoked'::text));
   NOTIFY pgrst, 'reload schema';`)
}

/**
 * Replay vs production drift (FINDINGS F47): production has companies.white_label_platform_id
 * (uuid, nullable, FK to white_label_platforms ON DELETE SET NULL, btree index) and the go-live page reads
 * it through getActorTestingSummary, but the canonical replay creates neither the column nor
 * white_label_platforms, so every /admin/platform/go-live/<company> page fails with 42703. Mirrors the
 * column and index; the FK target does not exist in the replay and no row here references a platform.
 */
export function ensureProductionWhiteLabelColumnParity() {
  if (sql<boolean>(`SELECT EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='white_label_platform_id')`)) return
  sql(`ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS white_label_platform_id uuid;
   CREATE INDEX IF NOT EXISTS companies_white_label_platform_idx ON public.companies USING btree (white_label_platform_id);
   NOTIFY pgrst, 'reload schema';`)
}

/**
 * The platform's shared manual-operations mailbox (facility lookups, manual grid
 * owner mail), as a platform admin points it at the mail server and verifies
 * it. Platform configuration, like the shared Ediel mailbox; local GreenMail.
 */
export const MANUAL_OPERATIONS_MAILBOX = 'gridex-ops-manual@example.invalid'
export function configurePlatformManualMailbox() {
  sql(`UPDATE public.manual_communication_mailboxes SET from_email=${literal(MANUAL_OPERATIONS_MAILBOX)},reply_to_email=${literal(MANUAL_OPERATIONS_MAILBOX)},
    smtp_host=${literal(LIVE.mailHost)},smtp_port=${LIVE.smtpsPort},smtp_username=${literal(MANUAL_OPERATIONS_MAILBOX)},smtp_secret_reference='env:GRIDEX_MANUAL_OPERATIONS_MAILBOX_PASS',smtp_secure=true,
    imap_host=${literal(LIVE.mailHost)},imap_port=${LIVE.imapsPort},imap_username=${literal(MANUAL_OPERATIONS_MAILBOX)},imap_secret_reference='env:GRIDEX_MANUAL_OPERATIONS_MAILBOX_PASS',imap_secure=true,
    is_active=true,is_verified=true WHERE company_id IS NULL AND environment='production';`)
}

/**
 * Replay vs production drift (FINDINGS F28): production has the canonical
 * number-series wrappers used by the website application path; the canonical
 * replay and supabase/schema.sql do not (20260801143000 only feeds a derived
 * foundation excerpt). Exact production definitions and grants.
 */
export function ensureProductionNumberSeriesParity() {
  if (sql<boolean>(`SELECT to_regprocedure('public.canonical_next_application_number(uuid)') IS NOT NULL AND to_regprocedure('public.canonical_next_customer_number(uuid)') IS NOT NULL
    AND to_regprocedure('public.canonical_next_contract_number(uuid,text)') IS NOT NULL`)) return
  sql(`CREATE OR REPLACE FUNCTION public.canonical_next_application_number(p_company_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
    AS $function$ select public.gridex_next_application_number(p_company_id); $function$;
   CREATE OR REPLACE FUNCTION public.canonical_next_contract_number(p_company_id uuid, p_customer_number text DEFAULT NULL::text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
    AS $function$ select public.gridex_next_contract_number(p_company_id, p_customer_number); $function$;
   CREATE OR REPLACE FUNCTION public.canonical_next_customer_number(p_company_id uuid) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
    AS $function$ select public.gridex_next_customer_number(p_company_id); $function$;
   REVOKE ALL ON FUNCTION public.canonical_next_application_number(uuid), public.canonical_next_contract_number(uuid,text), public.canonical_next_customer_number(uuid) FROM PUBLIC, anon, authenticated;
   GRANT EXECUTE ON FUNCTION public.canonical_next_application_number(uuid), public.canonical_next_contract_number(uuid,text), public.canonical_next_customer_number(uuid) TO service_role;
   NOTIFY pgrst, 'reload schema';`)
}

export async function goLiveOnWebsite(tenant: LiveTenant, operatorUserId: string) {
  ensureProductionWebhookClientParity()
  ensureProductionNumberSeriesParity()
  configurePlatformManualMailbox()
  // /admin/pricing/market-sources: "Tillåt senaste indikativa data som fallback", so a spot quote can
  // be shown for a start month whose prices are not published yet (FINDINGS F27: the default blocks it).
  sql(`UPDATE public.company_market_price_sources SET allow_indicative_latest=true,
     metadata=metadata||jsonb_build_object('updated_from','tenant_market_sources_admin','updated_by',${literal(tenant.adminUserId)}),updated_at=now()
   WHERE company_id=${literal(tenant.companyId)} AND source_key='elprisetjustnu';`)
  // "Install standard e-mail" in /admin/companies/[id]: sender settings, templates and event rules.
  await seedDefaultCompanyEmailConfiguration(tenant.companyId)
  // The grid owner's facility-information contact, verified by platform staff in the admin UI
  // (a service-role server action), so facility lookups can be automated instead of manual review.
  sql(`BEGIN; SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
   INSERT INTO public.grid_owner_contact_channels(grid_owner_id,company_id,channel_type,email,label,is_enabled,is_verified,verified_at)
    VALUES(${literal(tenant.gridOwnerId)},${literal(tenant.companyId)},'facility_information_request',${literal(tenant.gridOwnerEmail.replace('e2e-natagare-', 'e2e-natagare-kundtjanst-'))},'Anläggningsuppgifter nätägare',true,true,now()); COMMIT;`)
  const channel = await supabaseService.rpc('gridex_publish_contract_channel', { p_company_id: tenant.companyId, p_offer_id: tenant.offerId, p_channel: 'website', p_actor_user_id: tenant.adminUserId })
  if (channel.error || !(channel.data as { ok?: boolean })?.ok) throw Error(`website_channel_rejected:${JSON.stringify(channel.error ?? channel.data)}`)
  const provisioned = await provisionTenantWebsiteIntegration({
    companyId: tenant.companyId, actorUserId: operatorUserId, idempotencyKey: `tenant-website:${tenant.companyId}:production`,
    environment: 'production', clientName: 'E2E elhandel webbplats', allowedOrigins: [WEBSITE_ORIGIN], rateLimitPerMinute: 120,
    customerPortalUrl: `${WEBSITE_ORIGIN}/mina-sidor`, webhook: null,
  }).catch((error: unknown) => {
    // Database errors arrive as plain objects; keep every field, including nested issues.
    const fields = error && typeof error === 'object' ? Object.fromEntries(Object.getOwnPropertyNames(error).filter(k => k !== 'stack').map(k => [k, (error as Record<string, unknown>)[k]])) : { value: String(error) }
    throw Error(`website_provisioning_failed:${JSON.stringify(fields)}`)
  })
  return provisioned
}

/**
 * Stands in for the step the platform has no supported path for (FINDINGS F36): Ediel certification
 * of the supplier and platform approval of its first production send. Sets exactly the state that
 * canonical go-live and first-send approval would leave: production state live with the first live
 * send approved, the production sender setting unlocked, the ediel_production capability ready and the
 * certification evidence passed. Everything after it runs the real code.
 */
export function simulateEdielCertifiedGoLive(companyId: string, approverUserId: string) {
  sql(`BEGIN; SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
   INSERT INTO public.ediel_production_state(company_id,state,state_version,approved_by,approved_at,first_live_send_approved_by,first_live_send_approved_at,last_idempotency_key)
    VALUES(${literal(companyId)},'live',1,${literal(approverUserId)},now(),${literal(approverUserId)},now(),'reality-simulated-certified-go-live')
    ON CONFLICT(company_id) DO UPDATE SET state='live',state_version=public.ediel_production_state.state_version+1,approved_by=excluded.approved_by,approved_at=excluded.approved_at,
     first_live_send_approved_by=excluded.first_live_send_approved_by,first_live_send_approved_at=excluded.first_live_send_approved_at,last_idempotency_key=excluded.last_idempotency_key,updated_at=now();
   UPDATE public.ediel_actor_settings SET first_production_send_approved=true,approved_by=${literal(approverUserId)},approved_at=now()
    WHERE company_id=${literal(companyId)} AND environment='production';
   -- canonical_transition_ediel_production projects the ediel_production capability when it goes live; without it
   -- every production send is held as blocked_tenant_state (capability_not_ready) and never released (FINDINGS B1).
   INSERT INTO public.company_capabilities AS capability(company_id,capability_code,enabled,readiness_status,last_verified_at,last_verified_by,created_by,updated_by)
    VALUES(${literal(companyId)},'ediel_production',true,'ready',now(),${literal(approverUserId)},${literal(approverUserId)},${literal(approverUserId)})
    ON CONFLICT(company_id,capability_code) DO UPDATE SET enabled=true,readiness_status='ready',last_verified_at=now(),last_verified_by=excluded.last_verified_by,
     updated_by=excluded.updated_by,updated_at=now();
   -- The certification evidence canonical go-live requires (canonical_ediel_production_evidence_readiness): passed,
   -- approved and current for the engine schema, including the limited pilot required once a production message is sent.
   -- Marked as simulated; the platform itself has no path that produces them (FINDINGS F36).
   INSERT INTO public.ediel_certification_evidence(company_id,environment,evidence_type,status,engine_schema_version,external_reference,evidence_document_reference,tested_at,approved_by,approved_at,metadata)
    SELECT ${literal(companyId)},'production',t,'passed',public.canonical_current_ediel_engine_schema_version(),'reality-simulated-certification:'||t,
      'reality://simulated-certification/'||t,now()-interval '1 minute',${literal(approverUserId)},now(),'{"reality_simulated":true,"finding":"F36"}'::jsonb
    FROM unnest(ARRAY['TGT','AGT','SHADOW_PRODUCTION','LIVE_TENANT_INTEGRITY','RESTORE_REPLAY','LIMITED_PILOT']) t
    ON CONFLICT(company_id,environment,evidence_type,engine_schema_version) DO UPDATE SET status='passed',tested_at=excluded.tested_at,
     approved_by=excluded.approved_by,approved_at=excluded.approved_at,valid_until=NULL,updated_at=now(); COMMIT;`)
  return sql<Record<string, unknown>>(`SELECT jsonb_build_object('state',state,'firstLiveSendApproved',first_live_send_approved_at IS NOT NULL) FROM public.ediel_production_state WHERE company_id=${literal(companyId)}`)
}

/**
 * Production approval of the tenant's route profiles (readiness fixes, receiver certificate, security
 * policy, production mode). The server action approveRouteProfileProductionAction does exactly this
 * call, but no admin page renders it (FINDINGS F37), so the simulation calls the same function.
 */
export async function approveTenantRouteProfiles(companyId: string, actorUserId: string) {
  const ids = sql<string[]>(`SELECT coalesce(jsonb_agg(id::text ORDER BY message_family),'[]') FROM public.ediel_route_profiles
    WHERE company_id=${literal(companyId)} AND environment='production' AND communication_route_id IS NOT NULL`)
  const results = []
  for (const routeProfileId of ids) {
    const result = await approveRouteProfileForProduction({ routeProfileId, actorUserId })
    results.push({ routeProfileId, ready: result.ready, blockers: result.blockers.map(b => b.code), warnings: result.warnings.map(w => w.code) })
  }
  return results
}

/**
 * Publishes the receiver's certificate trust authority (CA anchor, CRL, registered leaf fingerprint)
 * as the external trust owner does it: through the dedicated database role, the only path the platform
 * has (migration 20260930163734: no CA/CRL is seeded and no app path publishes one; FINDINGS F37).
 * The originals come from the Ediel certificate directory simulator's test CA.
 */
export async function publishReceiverCertificateTrust(companyId: string, receiverEdielId: string, actorUserId: string, environment: 'test' | 'production' = 'production') {
  const materials = await (await fetch(`http://127.0.0.1:3902/__sim/trust/${receiverEdielId}`)).json() as Record<string, string[]>
  const scope = { companyId, environment, receiverEdielId, registerVersion: `reality-${Date.now()}`, originalReference: 'reality-simulated-ediel-ca-register',
    legalAuthorityReference: 'reality-simulation', processAuthorityReference: 'reality-simulation', ownerRegisterReference: 'reality-certificate-directory',
    validFrom: new Date(Date.now() - 60_000).toISOString(), validTo: new Date(Date.now() + 30 * 86_400_000).toISOString(), actorUserId }
  // The owner role is a separate database identity; the platform's own roles cannot assume it.
  const statement = `BEGIN; SET LOCAL ROLE gridex_ediel_certificate_authority_owner;
   SELECT public.gridex_ediel_certificate_trust_publish_v1(${literal(JSON.stringify(scope))}::jsonb, convert_to(${literal(JSON.stringify(materials))},'UTF8'), ${literal(JSON.stringify(materials))}::jsonb); COMMIT;`
  return execFileSync('docker', ['exec', '-i', 'supabase_db_gridex-ops-platform', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input: statement, encoding: 'utf8' }).trim().split('\n').filter(line => /^[0-9a-f-]{36}$/.test(line))[0] ?? null
}
