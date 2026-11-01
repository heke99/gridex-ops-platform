/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
// VENDORED COPY. Origin: claude/gifted-hamilton-vss1hj @ 2711f86287fd77da12e48aa5fd26a695f4a51426:scripts/helpers/live-chain-fixture.ts
// Only the edits listed in chain/vendor-sync.py PATCHES (and @/ import rewrites) differ from the origin.
// Live-like local chain fixture. Owned local Supabase, a locally running Next
// app and a local GreenMail (IMAPS/SMTPS with a local CA) only. Everything
// here is synthetic (E2E- names, example.invalid) and is torn down with the
// disposable stack. Nothing is sent outside the machine.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import nodemailer from 'nodemailer'
import { ImapFlow } from 'imapflow'
import { fixtureOrganizationNumber, nativeActorRoleSql } from '@/scripts/helpers/ediel-normal-switch-native-fixture'
import { registerUtiltsIssuer, seedUtiltsIssuerHistoryGround } from '@/scripts/helpers/utiltsConsumptionParties'

export const LIVE = {
  appUrl: process.env.GRIDEX_LIVE_APP_URL ?? 'http://127.0.0.1:3104',
  cronSecret: process.env.CRON_SECRET ?? '',
  platformMailbox: process.env.GRIDEX_SHARED_EDIEL_TEST_EMAIL ?? 'gridex-ediel-test@example.invalid',
  mailHost: 'localhost',
  smtpsPort: Number(process.env.T4_SMTPS_PORT ?? 55425),
  imapsPort: Number(process.env.T4_IMAPS_PORT ?? 55426),
  automationUserId: process.env.GRIDEX_AUTOMATION_USER_ID ?? '',
}

export const literal = (v: unknown): string => v === null || v === undefined ? 'NULL'
  : "'" + String(typeof v === 'object' ? JSON.stringify(v) : v).replaceAll("'", "''") + "'"

export function sql<T = unknown>(input: string, timeoutMs = 60_000): T {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL !== 'http://127.0.0.1:54321') throw Error('owned_local_only')
  const out = execFileSync('psql', ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-XAtq', '-v', 'ON_ERROR_STOP=1'],
    { input, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 50_000_000 }).trim()
  if (out === 't' || out === 'f') return (out === 't') as T
  return (out ? JSON.parse(out) : undefined) as T
}

export { dailyE66, dayProfile, gs1, kwhText } from './live-chain-wire'
import { gs1 } from './live-chain-wire'
import { platformMailboxFor } from '../reality/simulators/platformMailbox'
import { edifactAttachment } from '../reality/simulators/edifactMailParts'

/**
 * The grid owner sends one EDIFACT file as an e-mail attachment over SMTPS (TLS verified via the local CA), to the
 * platform's shared Ediel mailbox of the file's own lane (UNB test indicator; FINDINGS T7), like the simulators.
 */
export async function gridOwnerSends(input: { from: string; edifact: string; filename: string; subject: string }) {
  const transport = nodemailer.createTransport({ host: LIVE.mailHost, port: LIVE.smtpsPort, secure: true, requireTLS: true,
    auth: { user: input.from, pass: 'grid-owner-local' }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
  await transport.sendMail({ from: input.from, to: platformMailboxFor(input.edifact), subject: input.subject, text: 'Ediel',
    attachments: [edifactAttachment(input.filename, input.edifact)] })
}

export type ReceivedMail = { subject: string; from: string; to: string; attachments: Array<{ filename: string; text: string }> }

/** What a counterparty actually received (CONTRL/APERAK/PRODAT replies sent by the platform). */
export async function readInbox(user: string): Promise<ReceivedMail[]> {
  const client = new ImapFlow({ host: LIVE.mailHost, port: LIVE.imapsPort, secure: true, auth: { user, pass: 'counterparty-local' }, logger: false })
  await client.connect()
  const lock = await client.getMailboxLock('INBOX')
  const out: ReceivedMail[] = []
  try {
    const status = await client.status('INBOX', { messages: true })
    if (!status || !status.messages) return out
    const listed: Array<{ uid: number; subject: string; from: string; to: string; parts: Array<{ part: string; filename: string }> }> = []
    for await (const message of client.fetch('1:*', { uid: true, envelope: true, bodyStructure: true })) {
      const parts: Array<{ part: string; filename: string }> = []
      const walk = (node: { part?: string; disposition?: string; dispositionParameters?: Record<string, string>; parameters?: Record<string, string>; childNodes?: unknown[] } | undefined) => {
        if (!node) return
        const filename = node.dispositionParameters?.filename ?? node.parameters?.name
        // A single-part message (e.g. an outbound CONTRL sent as application/EDIFACT)
        // is its own attachment; imapflow gives its root no part number, IMAP calls it 1.
        const part = node.part ?? (node.childNodes?.length ? undefined : '1')
        if (filename && part) parts.push({ part, filename })
        for (const child of node.childNodes ?? []) walk(child as never)
      }
      walk(message.bodyStructure as never)
      listed.push({ uid: message.uid, subject: message.envelope?.subject ?? '', from: message.envelope?.from?.[0]?.address ?? '',
        to: message.envelope?.to?.[0]?.address ?? '', parts })
    }
    for (const message of listed) {
      const attachments: Array<{ filename: string; text: string }> = []
      for (const part of message.parts) {
        const { content } = await client.download(String(message.uid), part.part, { uid: true })
        if (!content) continue
        const chunks: Buffer[] = []
        for await (const chunk of content) chunks.push(Buffer.from(chunk))
        attachments.push({ filename: part.filename, text: Buffer.concat(chunks).toString('utf8') })
      }
      out.push({ subject: message.subject, from: message.from, to: message.to, attachments })
    }
  } finally { lock.release(); await client.logout() }
  return out
}

/**
 * One request to the app on a fresh connection (agent: false), for single reads after a long or loaded scenario step:
 * fetch can reuse an idle keep-alive socket the server already closed and fail with UND_ERR_SOCKET "other side closed"
 * before the request reaches the app (FINDINGS T27, C-B3a).
 */
export async function appRequest(path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: Record<string, string>; text: string }> {
  const url = new URL(path, LIVE.appUrl)
  const { request } = await import(url.protocol === 'https:' ? 'node:https' : 'node:http')
  return new Promise((resolve, reject) => {
    const req = request(url, { method: init.method ?? 'GET', agent: false, headers: init.headers ?? {} }, (res: import('node:http').IncomingMessage) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value
        resolve({ status: res.statusCode ?? 0, headers, text: Buffer.concat(chunks).toString('utf8') })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    if (init.body !== undefined) req.write(init.body)
    req.end()
  })
}

/**
 * Calls a scheduled endpoint exactly like Vercel Cron: Bearer CRON_SECRET, on a fresh connection each time (agent: false).
 * fetch reused an idle keep-alive socket the server had already closed after a long scenario step, and the call failed
 * with UND_ERR_SOCKET "other side closed" before the request reached the app (FINDINGS T27, F run 32 F7).
 */
export async function cron(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const url = new URL(path, LIVE.appUrl)
  const { request } = await import(url.protocol === 'https:' ? 'node:https' : 'node:http')
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'GET', agent: false, headers: { authorization: `Bearer ${LIVE.cronSecret}` } }, (res: import('node:http').IncomingMessage) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        let body: Record<string, unknown> = {}
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> } catch { body = {} }
        resolve({ status: res.statusCode ?? 0, body })
      })
      res.on('error', reject)
    })
    req.on('error', reject)
    req.end()
  })
}


/**
 * Hosted environments carry the application permission catalog as reference
 * data; the canonical clean replay skips the legacy foundation that seeded it
 * (see ediel-native-permission-catalog.setup.ts). Mirror the code catalog
 * (lib/rbac/catalog.ts PERMISSION_CATALOG) as reference rows — never a grant.
 */
export function ensureHostedPermissionCatalog() {
  const source = readFileSync('lib/rbac/catalog.ts', 'utf8')
  const start = source.indexOf('const PERMISSION_CATALOG'), end = source.indexOf('\n]', start)
  const keys = [...source.slice(start, end).matchAll(/key: '([^']+)'/g)].map(match => match[1])
  if (keys.length < 40 || !keys.includes('pricing.write')) throw Error('permission_catalog_source_unreadable')
  sql(`INSERT INTO public.permissions(key,name,description,category) SELECT k,k,'Hosted catalog reference (live chain)','live_chain'
   FROM unnest(ARRAY[${keys.map(literal).join(',')}]) k WHERE NOT EXISTS(SELECT FROM public.permissions p WHERE p.key=k);`)
  return keys.length
}

/**
 * Production parity for FINDINGS F16: hosted production has
 * public.gridex_get_user_roles(uuid) (body identical to
 * 20260526_debug_step1_2c_full_schema_code_alignment.sql, SECURITY INVOKER), but
 * the canonical replay excludes that noncanonical migration. Without it every
 * platform admin without a company membership is locked out of /admin. The
 * function is created only if missing, exactly as production has it.
 */
export function ensureProductionRoleLookupParity() {
  const migration = readFileSync('supabase/migrations/20260526_debug_step1_2c_full_schema_code_alignment.sql', 'utf8')
  const start = migration.indexOf('create or replace function public.gridex_get_user_roles(p_user_id uuid)')
  const end = migration.indexOf('$$;', start)
  if (start < 0 || end < 0) throw Error('gridex_get_user_roles_source_unreadable')
  const definition = migration.slice(start, end + 3).replace('security definer', 'security invoker')
  sql(`DO $parity$BEGIN IF to_regprocedure('public.gridex_get_user_roles(uuid)') IS NULL THEN
   EXECUTE ${literal(definition)};
   EXECUTE 'GRANT EXECUTE ON FUNCTION public.gridex_get_user_roles(uuid) TO authenticated, service_role';
  END IF; END$parity$;`)
}

/**
 * The shared test Ediel mailbox profile, as a platform admin saves it in
 * /admin/inbound-mail (saveSharedMailboxProfileAction fields): local IMAPS/SMTPS,
 * password by env reference. Platform-level configuration, not tenant data.
 */
export function configurePlatformMailbox() {
  sql(`UPDATE public.ediel_mailboxes SET email_address=${literal(LIVE.platformMailbox)},imap_host=${literal(LIVE.mailHost)},imap_port=${LIVE.imapsPort},
    username=${literal(LIVE.platformMailbox)},secret_reference='env:GRIDEX_SHARED_EDIEL_TEST_IMAP_PASS',smtp_from=${literal(LIVE.platformMailbox)},
    is_active=true,poll_interval_minutes=1,last_error=NULL,locked_at=NULL,locked_by=NULL,last_polled_at=NULL,
    metadata=metadata||jsonb_build_object('imap_secure',true,'imap_folder','INBOX','smtp_host',${literal(LIVE.mailHost)},'smtp_port',${LIVE.smtpsPort},'smtp_secure',true)
   WHERE company_id IS NULL AND environment='test';`)
  return sql<number>(`SELECT to_jsonb(count(*)) FROM public.ediel_mailboxes WHERE company_id IS NULL AND environment='test' AND imap_port=${LIVE.imapsPort}`)
}

export type LiveTenant = {
  companyId: string
  /**
   * The fixture "admin" (configureTenant): a company_admin membership, a disposable native_actor_* role without
   * permissions and direct user_permissions allow rows. It has NO role-based admin authority: the admin context
   * counts only role allows and uses direct rows only as denials, so its permissions are [] and the admin API
   * answers "Ej behörig" (FINDINGS F52, F109). Use it as a fixture actor id only; a step that needs a real tenant
   * employee (admin pages, /api/internal/*) must create one with scripts/helpers/reality/tenantStaff.ts.
   */
  adminUserId: string; adminEmail: string; adminPassword: string
  /** Gridex platform staff (super_admin in user_roles) operating this supplier as a member. */
  operatorEmail: string; operatorPassword: string
  supplierEdielId: string; issuerEdielId: string; gridOwnerId: string; gridOwnerEmail: string
  offerId: string; publicationVersionId: string
}

/**
 * Go-live configuration of one electricity supplier, as a platform admin sets
 * it up: legal profile, sender, Ediel identity/roles/routes, BRP, grid owner,
 * a published quarter-hour spot product and billing automation. The grid-owner
 * issuer registry entry is a SYNTHETIC stand-in for external evidence EXT-ISSUER-01.
 */
/**
 * `brp: false` leaves the BRP to the onboarding step, as Gridex staff choose it in the go-live UI (FINDINGS F44).
 * Publishing an offer requires a production BRP, so `beforePublish` runs that onboarding before the offer is published.
 */
export async function configureTenant(supabase: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  options: { brp?: boolean; beforePublish?: (tenant: { companyId: string; operatorEmail: string; operatorPassword: string }) => Promise<void>
    /** Reuse another tenant's grid owner (same Ediel id and mailbox): two suppliers in one grid area. */
    sharedGridOwner?: Pick<LiveTenant, 'issuerEdielId' | 'gridOwnerEmail'>
    /** The offer's contract terms (default: no binding, one month notice, 12-month automatic renewal). */
    terms?: { bindingMonths: number; noticeMonths: number; renewalMonths: number } } = {}): Promise<LiveTenant> {
  const terms = options.terms ?? { bindingMonths: 0, noticeMonths: 1, renewalMonths: 12 }
  ensureHostedPermissionCatalog()
  ensureProductionRoleLookupParity()
  const companyId = randomUUID(), adminUserId = randomUUID(), gridOwnerId = randomUUID()
  const org = fixtureOrganizationNumber()
  const adminEmail = `e2e-admin-${adminUserId.slice(0, 8)}@example.invalid`, adminPassword = `Live-${randomUUID()}`
  const operatorUserId = randomUUID(), operatorEmail = `e2e-operator-${operatorUserId.slice(0, 8)}@example.invalid`, operatorPassword = `Live-${randomUUID()}`
  const supplierEdielId = sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_utilts_consumption_receiver',0));
   SELECT to_jsonb(min(n)::text) FROM generate_series(70000,79999) n WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=n::text)
    AND NOT EXISTS(SELECT FROM public.ediel_actor_settings a WHERE a.ediel_id=n::text); COMMIT;`)
  const issuerEdielId = options.sharedGridOwner?.issuerEdielId ?? sql<string>(`BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('native_utilts_consumption_issuer',0));
   SELECT to_jsonb(min(n)::text) FROM generate_series(80000,89999) n WHERE NOT EXISTS(SELECT FROM gridex_utilts_issuer.namespaces x WHERE x.registry_actor_key='SYNTHETIC-NATIVE-ISSUER:'||n::text); COMMIT;`)
  const gridOwnerEmail = options.sharedGridOwner?.gridOwnerEmail ?? `e2e-natagare-${issuerEdielId}@example.invalid`
  const user = (id: string, email: string, name: string, password?: string) => `
   INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous,confirmation_token,recovery_token,email_change_token_new,email_change)
   VALUES(${literal(id)},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${literal(email)},${password ? `extensions.crypt(${literal(password)},extensions.gen_salt('bf'))` : 'NULL'},now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),false,false,'','','','');
   INSERT INTO auth.identities(id,user_id,provider_id,identity_data,provider,last_sign_in_at,created_at,updated_at)
   VALUES(gen_random_uuid(),${literal(id)},${literal(id)},jsonb_build_object('sub',${literal(id)},'email',${literal(email)},'email_verified',true),'email',now(),now(),now());
   INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(id)},${literal(email)},${literal(name)},'active') ON CONFLICT(id) DO UPDATE SET user_status='active';`
  const member = (id: string) => `
   INSERT INTO public.company_memberships(company_id,user_id,membership_role,status,accepted_at,metadata,role,is_active,joined_at,role_key)
   VALUES(${literal(companyId)},${literal(id)},'company_admin','active',now(),'{}','company_admin',true,now(),'company_admin');
   -- The single active company role is the disposable native actor role below. (A company_admin row was a
   -- no-op while the replay had no roles; scenario D's production role parity, FINDINGS F52, would collide.)
   INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key)
   SELECT ${literal(id)},${literal(companyId)},p.id,p.key FROM public.permissions p WHERE p.key NOT LIKE 'ediel.production.%' AND p.key NOT LIKE 'ediel.retention.%'
   AND NOT EXISTS(SELECT FROM public.user_permissions u WHERE u.user_id=${literal(id)} AND u.company_id=${literal(companyId)} AND u.permission_key=p.key);
   ${nativeActorRoleSql(companyId, id)}`
  // Company creation sets the public slug (all production companies have one); legal document URLs use it.
  sql(`INSERT INTO public.companies(id,name,status,slug) VALUES(${literal(companyId)},'E2E Live Elhandel AB','active',${literal(`e2e-live-elhandel-${companyId.slice(0, 8)}`)});
   ${user(adminUserId, adminEmail, 'E2E Live Admin', adminPassword)}
   ${member(adminUserId)}
   ${member(LIVE.automationUserId)}
   ${user(operatorUserId, operatorEmail, 'E2E Gridex Operator', operatorPassword)}
   -- As in production: platform staff are super_admin in user_roles without a company. The
   -- canonical replay lacks the super_admin role row, so it is mirrored as reference data.
   INSERT INTO public.roles(key,name,scope,is_system_role,is_active) VALUES('super_admin','super_admin','company',false,true) ON CONFLICT(key) DO NOTHING;
   INSERT INTO public.user_roles(user_id,role_id,role,company_id,status,is_active) SELECT ${literal(operatorUserId)},id,'super_admin',NULL,'active',true FROM public.roles WHERE key='super_admin';
   -- Business Ediel acts require a current member with communication.write (platform authority
   -- never spans companies), so the operating staff member is also a member of this supplier.
   ${member(operatorUserId)}
   UPDATE public.companies SET legal_name='E2E Live Elhandel AB',org_number=${literal(org)},address_line_1='Testgatan 1',postal_code='123 45',city='Teststad',country_code='SE',
    support_email='service@example.invalid',phone='0101234567',website='https://example.invalid' WHERE id=${literal(companyId)};`)
  const pricing = { schema: 'gridex_contract_pricing_v5', pricing_model: 'spot', energy_direction: 'consumption', interval_resolution: 'quarterly', vat_rate: 0.25,
    price_areas: ['SE3'], base_components: [{ source_type: 'spot', label: 'Spotpris', weight_percent: 100, price_area: 'SE3' }],
    price_components: [
      { component_code: 'spot_markup', component_type: 'markup', name: 'Påslag', calculation_type: 'per_kwh', amount: 4, unit: 'ore_per_kwh', website_card_visible: true },
      { component_code: 'monthly_fee', component_type: 'fee', name: 'Månadsavgift', calculation_type: 'fixed_monthly', amount: 49, unit: 'sek_month', website_card_visible: true },
      // Website/API channels require the invoice fee as a canonical component (0 kr = offer row invoice_fee_sek).
      { component_code: 'invoice_fee', component_type: 'fee', name: 'Fakturaavgift', calculation_type: 'per_invoice', amount: 0, unit: 'sek_invoice', website_card_visible: true }] }
  const offer = { name: 'E2E Kvartspris', slug: `e2e-kvartspris-${companyId}`, lifecycle_status: 'draft', contract_type: 'variable_quarterly', customer_type: 'both', pricing_model: 'spot',
    energy_direction: 'consumption', terms_version: 'e2e-v1', spot_markup_ore_per_kwh: 4, monthly_fee_sek: 49, invoice_fee_sek: 0, default_binding_months: terms.bindingMonths, default_notice_months: terms.noticeMonths,
    automatic_renewal: true, automatic_renewal_term_months: terms.renewalMonths, power_of_attorney_required: true, valid_from: '2026-06-01' }
  const created = await supabase.rpc('gridex_upsert_internal_contract_offer_v2', { p_company_id: companyId, p_offer_id: null, p_payload: offer, p_pricing_snapshot: pricing, p_actor_user_id: adminUserId })
  if (created.error) throw Error(`offer_create_failed:${JSON.stringify(created.error)}`)
  const offerResult = created.data as { ok?: boolean; offer?: { id?: string } }
  if (!offerResult.ok || !offerResult.offer?.id) throw Error(`offer_create_rejected:${JSON.stringify(created.data)}`)
  const offerId = offerResult.offer.id
  sql(`INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id)
    VALUES(${literal(companyId)},'production','E2E Live Elhandel',${literal(supplierEdielId)},${literal(supplierEdielId)}),(${literal(companyId)},'test','E2E Live Elhandel',${literal(supplierEdielId)},${literal(supplierEdielId)});
   ${options.brp === false ? '' : `INSERT INTO public.ediel_brp_settings(company_id,environment,brp_ediel_id,brp_name) VALUES(${literal(companyId)},'production','54321','E2E BRP');`}
   INSERT INTO public.ediel_route_profiles(company_id,environment,route_name,message_family) VALUES(${literal(companyId)},'production','E2E PRODAT','PRODAT'),(${literal(companyId)},'production','E2E UTILTS','UTILTS');
   INSERT INTO public.company_email_settings(company_id,sender_name,sender_email,verification_status) VALUES(${literal(companyId)},'E2E Live','e2e-live@example.invalid','verified');
   INSERT INTO public.company_email_templates(company_id,template_key,name,subject,body_html,is_active) VALUES(${literal(companyId)},'contract.confirmation_sent','E2E','E2E','<p>E2E</p>',true);
   INSERT INTO public.email_event_rules(company_id,event_key,template_key,enabled) VALUES(${literal(companyId)},'contract.confirmation_sent','contract.confirmation_sent',true);
   UPDATE public.tenant_legal_profiles SET legal_name='E2E Live Elhandel AB',organization_number=${literal(org)},
    postal_address='{"address_line_1":"Testgatan 1","postal_code":"123 45","city":"Teststad","country_code":"SE"}',customer_service_email='service@example.invalid',phone='0101234567',website='https://example.invalid',
    complaints_contact='{"email":"c@example.invalid"}',data_protection_contact='{"email":"p@example.invalid"}',billing_information='{"email":"b@example.invalid"}',
    dispute_resolution_information='{"authority":"ARN","description":"Synthetic dispute contact for live chain fixture"}',
    source_company_snapshot=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->'source_company_snapshot' FROM public.companies c WHERE c.id=${literal(companyId)}),
    source_company_snapshot_sha256=(SELECT public.gridex_company_legal_profile_defaults(to_jsonb(c))->>'source_company_snapshot_sha256' FROM public.companies c WHERE c.id=${literal(companyId)}),
    review_required=false,reviewed_at=now() WHERE company_id=${literal(companyId)};`)
  const legal = sql<string>(`SELECT to_jsonb(public.gridex_materialize_legal_bundle_version(${literal(companyId)},(SELECT contract_product_version_id FROM public.contract_offers WHERE id=${literal(offerId)}),NULL,${literal(adminUserId)}))`)
  sql(`UPDATE public.contract_offers SET legal_bundle_version_id=${literal(legal)} WHERE id=${literal(offerId)};`)
  if (options.beforePublish) await options.beforePublish({ companyId, operatorEmail, operatorPassword })
  const published = await supabase.rpc('gridex_publish_internal_contract_version', { p_company_id: companyId, p_offer_id: offerId, p_actor_user_id: adminUserId })
  if (published.error || !(published.data as { ok?: boolean })?.ok) throw Error(`publish_rejected:${JSON.stringify(published.error ?? published.data)}`)
  sql(`WITH t AS (INSERT INTO public.contract_price_options(company_id,contract_product_version_id,price_plan_version_id,option_reference,option_code,customer_name,contract_type,
     binding_months,notice_months,auto_renew_enabled,renewal_term_months,status,customer_type,is_default,selection_required,created_by)
    SELECT ${literal(companyId)},contract_product_version_id,price_plan_version_id,'e2e-default','e2e-default','Kvartspris','variable_quarterly',${terms.bindingMonths},${terms.noticeMonths},true,${terms.renewalMonths},'active','both',true,false,${literal(adminUserId)}
    FROM public.contract_offers WHERE id=${literal(offerId)} RETURNING id,company_id,price_plan_version_id)
   INSERT INTO public.contract_price_option_area_prices(company_id,contract_price_option_id,price_plan_version_id,price_row_reference,price_area,amount,unit,created_by)
   SELECT company_id,id,price_plan_version_id,'e2e-se3','SE3',4,'ore_per_kwh',${literal(adminUserId)} FROM t;`)
  const channel = await supabase.rpc('gridex_publish_contract_channel', { p_company_id: companyId, p_offer_id: offerId, p_channel: 'internal', p_actor_user_id: adminUserId })
  if (channel.error || !(channel.data as { ok?: boolean })?.ok) throw Error(`channel_rejected:${JSON.stringify(channel.error ?? channel.data)}`)
  const publicationVersionId = (channel.data as { contract_publication_version_id: string }).contract_publication_version_id
  // Ediel market identity, roles, ACK route and the grid owner.
  sql(`INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) SELECT ${literal(companyId)},e,'electricity',true,clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e ON CONFLICT DO NOTHING;
   INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) SELECT ${literal(companyId)},e,${literal(adminUserId)},'EdielId',${literal(supplierEdielId)},clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e;
   INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) SELECT ${literal(companyId)},e,${literal(adminUserId)},'electricity_supplier',clock_timestamp()-interval '1 day' FROM unnest(ARRAY['test','production']) e;
   WITH r AS (INSERT INTO public.communication_routes(company_id,route_name,route_scope,environment_type,is_active,target_email,grid_owner_id)
    VALUES(${literal(companyId)},'E2E ACK-route nätägare','ediel_ack','bilateral_test',true,${literal(gridOwnerEmail)},NULL) RETURNING id)
   INSERT INTO public.ediel_route_profiles(company_id,communication_route_id,route_name,environment,is_enabled,is_active,message_standard,payload_format,
    sender_ediel_id,receiver_ediel_id,application_reference,mailbox,smtp_host,smtp_port)
   SELECT ${literal(companyId)},r.id,'E2E ACK-profil','test',true,true,'edifact','edifact',${literal(supplierEdielId)},${literal(issuerEdielId)},'23-DDQ-E66-T',${literal(LIVE.platformMailbox)},${literal(LIVE.mailHost)},${LIVE.smtpsPort} FROM r;
   INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status,email) VALUES(${literal(gridOwnerId)},${literal(companyId)},'E2E Nätägare AB',${literal(issuerEdielId)},'test',true,'active',${literal(gridOwnerEmail)});
   UPDATE public.companies SET billing_automation_enabled=true,invoice_export_enabled=true,billing_provider_environment='test' WHERE id=${literal(companyId)};`)
  // SYNTHETIC stand-in for EXT-ISSUER-01 (grid-owner legal identity + transport mandate).
  registerUtiltsIssuer(sql as never, literal, issuerEdielId, adminUserId)
  // The outbox sends test-environment Ediel only when the ediel_test capability
  // is ready. No application path sets it for a new tenant (see FINDINGS F13);
  // like the project's native fixtures, the go-live configuration sets it here.
  sql(`UPDATE public.company_capabilities SET enabled=true,readiness_status='ready' WHERE company_id=${literal(companyId)} AND capability_code='ediel_test'`)
  return { companyId, adminUserId, adminEmail, adminPassword, operatorEmail, operatorPassword, supplierEdielId, issuerEdielId, gridOwnerId, gridOwnerEmail, offerId, publicationVersionId }
}

export type LiveOffer = { offerId: string; publicationVersionId: string }

/**
 * A second, FIXED-PRICE consumer offer of the tenant (FINDINGS D11-G2), authored, published and opened on the internal
 * channel through the same product commands as the tenant's variable offer above: the canonical draft writer
 * (gridex_upsert_internal_contract_offer_v2) with a fixed SE3 base component as the admin pricing normalizer builds it
 * (lib/pricing/contractPricingVersioning.ts: source_type 'fixed', fixed_price_sek_per_kwh, price_area), its legal bundle,
 * gridex_publish_internal_contract_version, an active fixed price option with its SE3 area row, and
 * gridex_publish_contract_channel. Time-bound like the variable offer (binding, notice, renewal).
 */
export async function publishFixedPriceOffer(tenant: LiveTenant, input: { fixedOrePerKwh: number; terms: { bindingMonths: number; noticeMonths: number; renewalMonths: number } }): Promise<LiveOffer> {
  const { supabaseService: supabase } = await import('@/lib/supabase/service')
  const { companyId, adminUserId } = tenant, terms = input.terms, sek = Math.round(input.fixedOrePerKwh) / 100
  // A fixed-price version's interval resolution is 'fixed' (contract readiness: contract_type 'fixed' expects it;
  // 'quarterly' was refused with resolution_mismatch, FINDINGS H-B5).
  const pricing = { schema: 'gridex_contract_pricing_v5', pricing_model: 'fixed', energy_direction: 'consumption', interval_resolution: 'fixed', vat_rate: 0.25,
    price_areas: ['SE3'], base_components: [{ source_type: 'fixed', label: 'Fast pris', weight_percent: 100, fixed_price_sek_per_kwh: sek, price_area: 'SE3' }],
    price_components: [
      { component_code: 'monthly_fee', component_type: 'fee', name: 'Månadsavgift', calculation_type: 'fixed_monthly', amount: 49, unit: 'sek_month', website_card_visible: true },
      { component_code: 'invoice_fee', component_type: 'fee', name: 'Fakturaavgift', calculation_type: 'per_invoice', amount: 0, unit: 'sek_invoice', website_card_visible: true }] }
  const offer = { name: 'E2E Fastpris', slug: `e2e-fastpris-${companyId}`, lifecycle_status: 'draft', contract_type: 'fixed', customer_type: 'both', pricing_model: 'fixed',
    energy_direction: 'consumption', terms_version: 'e2e-v1', fixed_price_ore_per_kwh: input.fixedOrePerKwh, monthly_fee_sek: 49, invoice_fee_sek: 0,
    default_binding_months: terms.bindingMonths, default_notice_months: terms.noticeMonths, automatic_renewal: true, automatic_renewal_term_months: terms.renewalMonths,
    power_of_attorney_required: true, valid_from: '2026-06-01' }
  const created = await supabase.rpc('gridex_upsert_internal_contract_offer_v2', { p_company_id: companyId, p_offer_id: null, p_payload: offer, p_pricing_snapshot: pricing, p_actor_user_id: adminUserId })
  if (created.error) throw Error(`fixed_offer_create_failed:${JSON.stringify(created.error)}`)
  const offerResult = created.data as { ok?: boolean; offer?: { id?: string } }
  if (!offerResult.ok || !offerResult.offer?.id) throw Error(`fixed_offer_create_rejected:${JSON.stringify(created.data)}`)
  const offerId = offerResult.offer.id
  const legal = sql<string>(`SELECT to_jsonb(public.gridex_materialize_legal_bundle_version(${literal(companyId)},(SELECT contract_product_version_id FROM public.contract_offers WHERE id=${literal(offerId)}),NULL,${literal(adminUserId)}))`)
  sql(`UPDATE public.contract_offers SET legal_bundle_version_id=${literal(legal)} WHERE id=${literal(offerId)};`)
  const published = await supabase.rpc('gridex_publish_internal_contract_version', { p_company_id: companyId, p_offer_id: offerId, p_actor_user_id: adminUserId })
  if (published.error || !(published.data as { ok?: boolean })?.ok) throw Error(`fixed_offer_publish_rejected:${JSON.stringify(published.error ?? published.data)}`)
  sql(`WITH t AS (INSERT INTO public.contract_price_options(company_id,contract_product_version_id,price_plan_version_id,option_reference,option_code,customer_name,contract_type,
     binding_months,notice_months,auto_renew_enabled,renewal_term_months,status,customer_type,is_default,selection_required,created_by)
    SELECT ${literal(companyId)},contract_product_version_id,price_plan_version_id,'e2e-fixed','e2e-fixed','Fastpris','fixed',${terms.bindingMonths},${terms.noticeMonths},true,${terms.renewalMonths},'active','both',true,false,${literal(adminUserId)}
    FROM public.contract_offers WHERE id=${literal(offerId)} RETURNING id,company_id,price_plan_version_id)
   INSERT INTO public.contract_price_option_area_prices(company_id,contract_price_option_id,price_plan_version_id,price_row_reference,price_area,amount,unit,created_by)
   SELECT company_id,id,price_plan_version_id,'e2e-fixed-se3','SE3',${input.fixedOrePerKwh},'ore_per_kwh',${literal(adminUserId)} FROM t;`)
  const channel = await supabase.rpc('gridex_publish_contract_channel', { p_company_id: companyId, p_offer_id: offerId, p_channel: 'internal', p_actor_user_id: adminUserId })
  if (channel.error || !(channel.data as { ok?: boolean })?.ok) throw Error(`fixed_offer_channel_rejected:${JSON.stringify(channel.error ?? channel.data)}`)
  return { offerId, publicationVersionId: (channel.data as { contract_publication_version_id: string }).contract_publication_version_id }
}

/** SYNTHETIC stand-in for EXT-ISSUER-01/EXT-ARCHIVE-02: reviewed issuer history ground for one received source. */
export function approveIssuerHistoryGround(sourceMessageId: string, actorUserId: string) {
  seedUtiltsIssuerHistoryGround(sql as never, literal, sourceMessageId, actorUserId)
}

export type LiveCustomer = { customerId: string; siteId: string; meteringPointId: string; meterId: string; contractId: string; supplyPeriodId: string; email: string }

/**
 * An existing supply customer (migrated, in supply since `supplyStart`). The
 * contract is signed through the platform's own signature RPCs, which also
 * freeze the price snapshot; the supply period is the confirmed market state.
 */
export async function existingSupplyCustomer(supabase: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  tenant: LiveTenant, input: { name: string; supplyStart: string }): Promise<LiveCustomer> {
  const customerId = randomUUID(), siteId = randomUUID(), meteringPointId = randomUUID(), contractId = randomUUID(), supplyPeriodId = randomUUID()
  const meterId = gs1(`735999${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`)
  const email = `e2e-kund-${customerId.slice(0, 8)}@example.invalid`
  sql(`INSERT INTO public.customers(id,company_id,first_name,last_name,email,customer_type,is_test_data,source)
    VALUES(${literal(customerId)},${literal(tenant.companyId)},'E2E',${literal(input.name)},${literal(email)},'private',true,'e2e_live_chain');
   INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id,price_area_code,is_test_data)
    VALUES(${literal(siteId)},${literal(tenant.companyId)},${literal(customerId)},'E2E Villa','consumption','active','SE',${literal(meterId)},${literal(tenant.gridOwnerId)},'SE3',true);
   INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,ediel_reference,site_facility_id,grid_owner_id,price_area_code,reading_frequency,status,is_test_data)
    VALUES(${literal(meteringPointId)},${literal(tenant.companyId)},${literal(customerId)},${literal(siteId)},${literal(siteId)},${literal(meterId)},${literal(meterId)},${literal(meterId)},${literal(meterId)},${literal(tenant.gridOwnerId)},'SE3','quarter_hour','active',true);
   INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,metering_point_id,contract_offer_id,status,created_by,contract_publication_version_id,
    contract_product_id,contract_product_version_id,price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot,starts_at,invoice_email)
   SELECT ${literal(contractId)},${literal(tenant.companyId)},${literal(customerId)},${literal(siteId)},${literal(meteringPointId)},${literal(tenant.offerId)},'pending_signature',${literal(tenant.adminUserId)},v.id,
    p.contract_product_id,v.contract_product_version_id,v.price_plan_id,v.price_plan_version_id,v.price_book_id,v.legal_bundle_version_id,v.offer_reference,p.commercial_snapshot,l.rendered_snapshot,${literal(input.supplyStart)},${literal(email)}
   FROM public.contract_publication_versions v JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id
   JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id WHERE v.id=${literal(tenant.publicationVersionId)};`)
  const tokenHash = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
  const prepared = await supabase.rpc('gridex_prepare_customer_contract_signature_request_v1', { p_company_id: tenant.companyId, p_customer_id: customerId, p_contract_id: contractId,
    p_token_hash: tokenHash, p_recipient_email: email, p_expires_at: new Date(Date.now() + 3_600_000).toISOString(), p_actor_user_id: tenant.adminUserId, p_channel: 'internal' })
  if (prepared.error) throw Error(`signature_prepare_failed:${JSON.stringify(prepared.error)}`)
  const finalized = await supabase.rpc('gridex_finalize_customer_contract_signature_v1', { p_token_hash: tokenHash, p_signed_ip_hash: null, p_signed_user_agent: 'E2E live chain synthetic acceptance' })
  if (finalized.error) throw Error(`signature_finalize_failed:${JSON.stringify(finalized.error)}`)
  sql(`INSERT INTO public.customer_supply_periods(id,company_id,customer_id,metering_point_id,contract_id,customer_contract_id,start_date,actual_start_date,status,source,metadata)
    VALUES(${literal(supplyPeriodId)},${literal(tenant.companyId)},${literal(customerId)},${literal(meteringPointId)},${literal(contractId)},${literal(contractId)},${literal(input.supplyStart)},${literal(input.supplyStart)},'active','migration','{"e2e_live_chain":"existing_customer"}');`)
  return { customerId, siteId, meteringPointId, meterId, contractId, supplyPeriodId, email }
}

/**
 * World establishment of a signature that happened in the past (owner decision 2026-10-22, scenario F): the
 * platform's own signing function runs unchanged except that its clock reads `at` instead of now. Its exact
 * definition is copied into a session-temporary function with only `clock_timestamp()` replaced, so every snapshot,
 * hash, acceptance, evidence row, trigger and immutability guard is produced by the real signing code at that
 * instant. Nothing is rewritten afterwards and the product code is untouched.
 */
export function finalizeSignatureAt(tokenHash: string, userAgent: string, at: string) {
  const definition = sql<string>(`SELECT to_jsonb(pg_get_functiondef('public.gridex_finalize_customer_contract_signature_v1(text,text,text)'::regprocedure))`)
  const header = 'CREATE OR REPLACE FUNCTION public.gridex_finalize_customer_contract_signature_v1('
  if (!definition.startsWith(header) || (definition.match(/clock_timestamp\(\)/g) ?? []).length !== 2) throw Error('historical_signature_function_shape_changed')
  const historical = definition.replace(header, 'CREATE FUNCTION pg_temp.reality_finalize_signature_at(')
    .replaceAll('clock_timestamp()', `${literal(at)}::timestamptz`)
  return sql<Record<string, unknown>>(`${historical};
    SELECT to_jsonb(pg_temp.reality_finalize_signature_at(${literal(tokenHash)},NULL,${literal(userAgent)}));`)
}

export type AugustFacilityInput = { gsrn: string; street: string; postalCode: string; city: string; annualConsumptionKwh: number }
export type AugustFacility = { gsrn: string; siteId: string; meteringPointId: string; contractId: string; powerOfAttorneyId: string; authorizationDocumentId: string }
export type AugustSupplyCustomer = { customerId: string; email: string; facilities: AugustFacility[] }

/**
 * A private customer who signed in August for supply of one or more facilities from `supplyStart`, on the
 * tenant's published offer: one contract per facility, signed through the platform's own signature RPCs
 * (which freeze the price snapshot and queue the signed-agreement confirmation), and a signed power of
 * attorney per facility through the admin writer and its authorization chain. The registered address is the
 * customer's masterdata, recorded through the registered-address writer. Unlike `existingSupplyCustomer` there is NO supply period: supply must come from the
 * grid owner's Z04 (a migrated period is never billable, FINDINGS F17). No switch request is created here.
 */
export async function augustSupplyCustomer(tenant: LiveTenant, input: { firstName: string; lastName: string; personalNumber: string; email: string
  address: { street: string; postalCode: string; city: string }; supplyStart: string; authorizedAt: string
  grid: { gridOwnerId: string; gridOwnerEdielId: string; gridAreaCode: string }; facilities: AugustFacilityInput[]
  /** How the agreement was made (customer_contracts.source_type); default the column default. A distance agreement
   *  ('website_application') carries the right of withdrawal (FINDINGS T24). */
  agreementSource?: 'website_application'
  /** Another published offer of the tenant (default the tenant's own); its contract type and fixed price are copied as
   *  the product's contract writers copy them (lib/customer-contracts/db.ts; FINDINGS D11-G2). */
  offer?: LiveOffer }): Promise<AugustSupplyCustomer> {
  const { supabaseService } = await import('@/lib/supabase/service')
  const { savePowerOfAttorney } = await import('@/lib/operations/db')
  const { ensureAuthorizationDocumentFromPowerOfAttorney } = await import('@/lib/legal/authorizationChain')
  const { powerOfAttorneyCoverageFromScopes } = await import('@/lib/operations/powerOfAttorneyWorkflow')
  const company = literal(tenant.companyId), customerId = randomUUID(), fullName = `${input.firstName} ${input.lastName}`
  const offer: LiveOffer = input.offer ?? { offerId: tenant.offerId, publicationVersionId: tenant.publicationVersionId }
  const offerColumns = input.offer ? ',contract_type,fixed_price_ore_per_kwh' : '', offerValues = input.offer ? ',o.contract_type,o.fixed_price_ore_per_kwh' : ''
  sql(`INSERT INTO public.customers(id,company_id,first_name,last_name,full_name,personal_number,email,invoice_email,customer_type,is_test_data,source,billing_street,billing_postal_code,billing_city,billing_country)
    VALUES(${literal(customerId)},${company},${literal(input.firstName)},${literal(input.lastName)},${literal(fullName)},${literal(input.personalNumber)},${literal(input.email)},${literal(input.email)},'private',true,'e2e_reality_august',
     ${literal(input.address.street)},${literal(input.address.postalCode)},${literal(input.address.city)},'SE');`)
  // FINDINGS F51: the registered address goes through the product's own writer (staff entry at the August intake).
  // T4: lib/customers/registeredAddress.ts does not exist at base 1c0c088c; the registered-address writer call is omitted.
  const facilities: AugustFacility[] = []
  for (const facility of input.facilities) {
    const siteId = randomUUID(), meteringPointId = randomUUID(), contractId = randomUUID(), gsrn = literal(facility.gsrn)
    sql(`INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id,grid_owner_ediel_id,grid_area_code,price_area_code,street,postal_code,city,annual_consumption_kwh,current_supplier_unknown,is_test_data)
      VALUES(${literal(siteId)},${company},${literal(customerId)},${literal(facility.street)},'consumption','active','SE',${gsrn},${literal(input.grid.gridOwnerId)},${literal(input.grid.gridOwnerEdielId)},${literal(input.grid.gridAreaCode)},'SE3',
       ${literal(facility.street)},${literal(facility.postalCode)},${literal(facility.city)},${facility.annualConsumptionKwh},true,true);
     INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,ediel_metering_point_id,ediel_reference,site_facility_id,grid_owner_id,grid_owner_ediel_id,grid_area_code,price_area_code,
       reading_frequency,measurement_type,product_direction,is_settlement_relevant,status,estimated_annual_consumption_kwh,is_test_data)
      VALUES(${literal(meteringPointId)},${company},${literal(customerId)},${literal(siteId)},${literal(siteId)},${gsrn},${gsrn},${gsrn},${gsrn},${gsrn},${literal(input.grid.gridOwnerId)},${literal(input.grid.gridOwnerEdielId)},${literal(input.grid.gridAreaCode)},'SE3',
       'quarter_hour','consumption','consumption',true,'active',${facility.annualConsumptionKwh},true);
     INSERT INTO public.customer_contracts(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,contract_offer_id,status,created_by,contract_publication_version_id,
      contract_product_id,contract_product_version_id,price_plan_id,price_plan_version_id,price_book_id,legal_bundle_version_id,offer_reference,commercial_snapshot,legal_snapshot,
      starts_at,requested_start_date,requested_start_mode,invoice_email,binding_months,notice_months,auto_renew_enabled,source_type${offerColumns})
     SELECT ${literal(contractId)},${company},${literal(customerId)},${literal(siteId)},${literal(siteId)},${literal(meteringPointId)},${literal(offer.offerId)},'pending_signature',${literal(tenant.adminUserId)},v.id,
      p.contract_product_id,v.contract_product_version_id,v.price_plan_id,v.price_plan_version_id,v.price_book_id,v.legal_bundle_version_id,v.offer_reference,p.commercial_snapshot,l.rendered_snapshot,
      ${literal(input.supplyStart)},${literal(input.supplyStart)},'specific_date',${literal(input.email)},
      -- The offer's terms, as the product's contract writers copy them (lib/customer-contracts/db.ts; FINDINGS T23).
      p.binding_months,p.notice_months,p.automatic_renewal,${literal(input.agreementSource ?? 'manual_override')}${offerValues}
     FROM public.contract_publication_versions v JOIN public.contract_product_versions p ON p.id=v.contract_product_version_id
     JOIN public.legal_bundle_versions l ON l.id=v.legal_bundle_version_id JOIN public.contract_offers o ON o.id=${literal(offer.offerId)} AND o.company_id=${company}
     WHERE v.id=${literal(offer.publicationVersionId)};`)
    const tokenHash = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
    const prepared = await supabaseService.rpc('gridex_prepare_customer_contract_signature_request_v1', { p_company_id: tenant.companyId, p_customer_id: customerId, p_contract_id: contractId,
      p_token_hash: tokenHash, p_recipient_email: input.email, p_expires_at: new Date(Date.now() + 3_600_000).toISOString(), p_actor_user_id: tenant.adminUserId, p_channel: 'internal' })
    if (prepared.error) throw Error(`signature_prepare_failed:${JSON.stringify(prepared.error)}`)
    // The customer signed in August: the real signing code runs with its clock at the August instant.
    finalizeSignatureAt(tokenHash, 'E2E reality August customer', input.authorizedAt)
    // The customer's power of attorney for the switch, recorded through the admin writer (draft, then signed in August).
    const scopes = ['supplier_switch', 'grid_owner_data', 'metering_data']
    const reference = `POA${contractId.replaceAll('-', '').slice(0, 12).toUpperCase()}`
    const poaInput = { customer_id: customerId, site_id: siteId, companyId: tenant.companyId, reference, scope: 'supplier_switch' as const, valid_from: input.authorizedAt.slice(0, 10),
      valid_to: `${Number(input.authorizedAt.slice(0, 4)) + 1}${input.authorizedAt.slice(4, 10)}`, method: 'manual_pdf', signer_name: fullName, signer_identity_number: input.personalNumber,
      accepted_source: 'e2e_reality_august', signedScopes: scopes, scopeSummary: { scopes } }
    const poa = await savePowerOfAttorney(supabaseService, { ...poaInput, status: 'draft', signed_at: null, accepted_at: null })
    const linked = await supabaseService.from('powers_of_attorney').update({ contract_id: contractId, customer_contract_id: contractId }).eq('id', poa.id).eq('company_id', tenant.companyId)
    if (linked.error) throw Error(`power_of_attorney_link_failed:${linked.error.message}`)
    await savePowerOfAttorney(supabaseService, { ...poaInput, id: poa.id, status: 'signed', signed_at: input.authorizedAt, accepted_at: input.authorizedAt })
    const authorization = await ensureAuthorizationDocumentFromPowerOfAttorney({ companyId: tenant.companyId, customerId, powerOfAttorneyId: poa.id, siteId, meteringPointId, contractId,
      coverage: powerOfAttorneyCoverageFromScopes(scopes), signedScopes: scopes })
    if (!authorization.authorizationDocumentId) throw Error(`authorization_document_missing:${facility.gsrn}`)
    facilities.push({ gsrn: facility.gsrn, siteId, meteringPointId, contractId, powerOfAttorneyId: poa.id, authorizationDocumentId: authorization.authorizationDocumentId })
  }
  return { customerId, email: input.email, facilities }
}
