// Go-live of a tenant's website sales channel, as a platform admin does it:
// publish the offer on the website channel and provision the website
// integration (/admin/platform/api-clients → provisionTenantWebsiteIntegration).
// The one-time API key is what the tenant's website then uses.
import { supabaseService } from '@/lib/supabase/service'
import { provisionTenantWebsiteIntegration } from '@/lib/integrations/tenantWebsiteProvisioning'
import { seedDefaultCompanyEmailConfiguration } from '@/lib/email/bootstrap'
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
