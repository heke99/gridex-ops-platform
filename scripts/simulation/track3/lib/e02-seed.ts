// EDIEL02: routbar mätpunkt/kund/kundobjekt/datarequest för syntetiska UTILTS E66 70007 -> 16700, unikt prefix per körning.
// Ursprung (mönster, ej kopierad kod rad för rad):
//  - 1c0c088c:scripts/ediel-utilts-consumption-native.test.ts seed() rad ~50-80 (customers, grid_owners, customer_sites,
//    metering_points, grid_owner_data_requests; mätpunkten och kundobjektets facility_id är samma 18-siffriga id som LOC+172)
//  - 1c0c088c:scripts/ediel-utilts-err-gateway-native.test.ts seed() rad 89-96 (samma INSERT-satser)
//  - 1c0c088c:scripts/helpers/utiltsConsumptionParties.ts registerUtiltsIssuer() (importeras, kopieras inte): godkänd
//    syntetisk utfärdare/transportmandat för 70007 så att fält 203/505-namnrymden finns.
// Egen part (tenant 16700), grid_owner 70007 och automationsaktören kommer ur lib/seed.mjs-fixturen (up.sh).
import { registerUtiltsIssuer, seedUtiltsIssuerHistoryGround } from '../../../helpers/utiltsConsumptionParties'
import { adminClient, COUNTERPARTY_EDIEL_ID, jlit, lit, sql, sqlJson } from './seed.mjs'
import { e02CompanyId, E02_OWN_ID } from './e02-tenant'
import { createHash, randomUUID } from 'node:crypto'

export type E02Fixture = {
  companyId: string; actorUserId: string; gridOwnerId: string
  customerId: string; siteId: string; pointId: string; requestId: string; meteringPoint: string
}

/** GS1 mod-10 kontrollsiffra för en sifferrad (GSRN: 17 siffror + kontrollsiffra). */
export function gs1CheckDigit(base: string): string {
  let sum = 0
  for (let i = 0; i < base.length; i++) sum += Number(base[base.length - 1 - i]) * (i % 2 === 0 ? 3 : 1)
  return String((10 - (sum % 10)) % 10)
}
/** 18-siffrigt GSRN med giltig GS1-kontrollsiffra (koden kräver den: UTILTS_METERING_POINT_GS1_CHECK_DIGIT_INVALID), unikt per prefix+salt. */
export function e02MeteringPoint(prefix: string, salt = 0): string {
  const h = createHash('sha256').update(`${prefix}:${salt}`).digest()
  const base = `7359992607${String(h.readUInt32BE(0) % 10_000_000).padStart(7, '0')}`
  return base + gs1CheckDigit(base)
}

/** Seeda kund/kundobjekt/mätpunkt/datarequest för en given mätpunkt i tenant 16700 (idempotent per mätpunkt). */
export function seedE02Routable(meteringPoint: string, label: string, environment: 'test' | 'production' = 'test'): E02Fixture {
  const companyId = e02CompanyId()
  const actorUserId = process.env.EDIEL_AUTOMATION_ACTOR_USER_ID! // sätts av ensureE02Tenant för isolerad tenant
  const gridOwnerId = sql(`SELECT id FROM public.grid_owners WHERE company_id=${lit(companyId)} AND environment=${lit(environment)} AND ediel_id=${lit(COUNTERPARTY_EDIEL_ID)} LIMIT 1`)
  const existing = sqlJson(`SELECT to_jsonb(x) FROM (SELECT p.id point, p.customer_id customer, p.site_id site,
      (SELECT id FROM public.grid_owner_data_requests r WHERE r.metering_point_id=p.id LIMIT 1) request
    FROM public.metering_points p WHERE p.company_id=${lit(companyId)} AND p.metering_point_id=${lit(meteringPoint)} LIMIT 1) x`) as null | { point: string; customer: string; site: string; request: string }
  if (existing) return { companyId, actorUserId, gridOwnerId, customerId: existing.customer, siteId: existing.site, pointId: existing.point, requestId: existing.request, meteringPoint }
  const ids = { customer: randomUUID(), site: randomUUID(), point: randomUUID(), request: randomUUID() }
  sql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(ids.customer)},${lit(companyId)},${lit('E02-' + ids.customer.slice(0, 8))},${lit('E02 syntetisk kund ' + label)},'private');
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id)
      VALUES(${lit(ids.site)},${lit(companyId)},${lit(ids.customer)},${lit('E02 ' + label)},'consumption','active','SE',${lit(meteringPoint)},${lit(gridOwnerId)});
    INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,grid_owner_id)
      VALUES(${lit(ids.point)},${lit(companyId)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.site)},${lit(meteringPoint)},${lit(meteringPoint)},${lit(gridOwnerId)});
    INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope)
      VALUES(${lit(ids.request)},${lit(companyId)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.point)},${lit(gridOwnerId)},'billing_underlay');`)
  return { companyId, actorUserId, gridOwnerId, customerId: ids.customer, siteId: ids.site, pointId: ids.point, requestId: ids.request, meteringPoint }
}

/** Registrera 70007 som godkänd syntetisk UTILTS-utfärdare (fält 203/505-namnrymd + transportmandat). Idempotent. */
export function registerE02Issuer(): void {
  const actor = process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!
  registerUtiltsIssuer(((s: string) => sql(s)) as never, lit as never, COUNTERPARTY_EDIEL_ID, actor)
}
export { adminClient, jlit }

/**
 * Företagsägd IMAP-brevlåda (company_id = tenant 16700) mot samma lokala IMAP som den delade brevlådan.
 * Harnessval (se EDIEL02-rapporten, kandidatfynd "shared mailbox"): ediel_messages-triggern
 * gridex_ediel_message_inbound_email_tenant_guard kräver inbound_email_messages.company_id = meddelandets company_id vid INSERT,
 * men den delade brevlådan lagrar mejlet med company_id NULL och sätter bolaget först efteråt
 * (inboundStatusUpdater.ts updateInboundEmailProcessingStatus). Därför skapas ingen ediel_messages-rad via den delade brevlådan.
 * Raden skapas inaktiv och aktiveras bara under EDIEL02-körningen (setE02MailboxActive).
 */
export function ensureE02CompanyMailbox(environment: 'test' | 'production' = 'test'): string {
  const companyId = e02CompanyId()
  const name = `T3SIM E02 company mailbox ${E02_OWN_ID} (${environment})`
  const found = sql(`SELECT id FROM public.ediel_mailboxes WHERE mailbox_name=${lit(name)} LIMIT 1`)
  if (found) return found
  return sql(`INSERT INTO public.ediel_mailboxes(company_id,mailbox_name,email_address,environment,is_active,imap_host,imap_port,username,secret_reference,smtp_from,
      tls_required,transport_mode,encryption_mode,signing_mode,poll_interval_minutes,mailbox_type,metadata)
    SELECT ${lit(companyId)},${lit(name)},email_address,environment,false,imap_host,imap_port,username,secret_reference,smtp_from,tls_required,transport_mode,encryption_mode,signing_mode,
      poll_interval_minutes,'company',${jlit({ scope: 'company', imap_folder: 'INBOX', imap_secure: true, smtp_secure: true, t3sim: true, e02: true })}
    FROM public.ediel_mailboxes WHERE company_id IS NULL AND environment=${lit(environment)} AND metadata->>'scope'='platform_shared' ORDER BY created_at LIMIT 1 RETURNING id`).split('\n')[0]
}
export function setE02MailboxActive(id: string, active: boolean): void {
  sql(`UPDATE public.ediel_mailboxes SET is_active=${active}, last_polled_at=NULL, locked_at=NULL, locked_by=NULL WHERE id=${lit(id)}`)
}

/**
 * Granskad historik-/identitetstäckning ("reviewed history-coverage ground") för en admitterad UTILTS-källa.
 * Utan den håller koden E66 med UTILTS_ISSUER_IDENTITY_BASIS_UNAVAILABLE (`ediel_utilts_identity_history_coverage_unavailable`,
 * ingen APERAK, ingen affärseffekt). I produktion är det ett mänskligt granskat underlag; här ersätts det syntetiskt,
 * exakt som de nativa testerna gör (1c0c088c:scripts/helpers/utiltsConsumptionParties.ts seedUtiltsIssuerHistoryGround, importeras).
 * Dokumenterat ersättningssteg: körs mellan första mottagning (admission) och ombearbetning.
 */
export function grantHistoryGround(edielMessageId: string): boolean {
  if (Number(sql(`SELECT count(*) FROM gridex_utilts_issuer.source_absence_grounds WHERE source_message_id=${lit(edielMessageId)}`)) > 0) return false
  if (Number(sql(`SELECT count(*) FROM gridex_utilts_issuer.source_admissions WHERE source_message_id=${lit(edielMessageId)} AND namespace_id IS NOT NULL`)) === 0) return false
  seedUtiltsIssuerHistoryGround(((s: string) => sql(s)) as never, lit as never, edielMessageId, process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!)
  return true
}
/** Ombearbeta en redan mottagen ediel_message med automationsaktören (samma ingång som poller-autoprocess). */
export async function reprocessInbound(edielMessageId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const { processInboundEdielMessage } = await import('@/lib/ediel/flows/inboundProcessing')
  try { await processInboundEdielMessage({ actorUserId: process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!, edielMessageId }); return { ok: true } }
  catch (error) {
    // PostgREST-fel är inga Error-instanser; plocka message/code ur objektet.
    const o = error as { message?: unknown; code?: unknown; cause?: { message?: unknown } }
    const msg = error instanceof Error ? error.message : typeof o?.message === 'string' ? o.message : JSON.stringify(error)
    return { ok: false, error: `${msg}${o?.cause && typeof o.cause.message === 'string' ? ` | cause: ${o.cause.message}` : ''}${o?.code ? ` [${String(o.code)}]` : ''}` }
  }
}

/**
 * Främmande tenant med en egen mätpunkt (för E10-provet, SC-047). Bara bolag/kund/kundobjekt/mätpunkt, ingen Ediel-identitet:
 * mönster 1c0c088c:scripts/ediel-utilts-err-gateway-native.test.ts SC-047 (foreign = annan seed()-tenant med samma fysiska LOC+172).
 */
export function seedForeignTenantPoint(meteringPoint: string, label: string): { companyId: string; pointId: string; customerId: string } {
  const name = `T3SIM E02 foreign tenant ${label}`
  let companyId = sql(`SELECT id FROM public.companies WHERE name=${lit(name)} LIMIT 1`)
  if (!companyId) companyId = sql(`INSERT INTO public.companies(name,status,default_environment) VALUES(${lit(name)},'active','test') RETURNING id`).split('\n')[0]
  const found = sql(`SELECT id||'|'||customer_id FROM public.metering_points WHERE company_id=${lit(companyId)} AND metering_point_id=${lit(meteringPoint)} LIMIT 1`)
  if (found) { const [pointId, customerId] = found.split('|'); return { companyId, pointId, customerId } }
  const ids = { customer: randomUUID(), site: randomUUID(), point: randomUUID() }
  sql(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(ids.customer)},${lit(companyId)},${lit('E02F-' + ids.customer.slice(0, 8))},${lit('E02 foreign customer ' + label)},'private');
    INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id) VALUES(${lit(ids.site)},${lit(companyId)},${lit(ids.customer)},${lit('E02 foreign ' + label)},'consumption','active','SE',${lit(meteringPoint)});
    INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id) VALUES(${lit(ids.point)},${lit(companyId)},${lit(ids.customer)},${lit(ids.site)},${lit(ids.site)},${lit(meteringPoint)},${lit(meteringPoint)});`)
  return { companyId, pointId: ids.point, customerId: ids.customer }
}
/** Stamdata-fingeravtryck för bolaget (kunder/kundobjekt/mätpunkter): ska vara identiskt före/efter ett avvisat meddelande. */
export function masterDataFingerprint(companyIds: string[]): string {
  const list = companyIds.map(lit).join(',')
  return sql(`SELECT md5(coalesce((SELECT string_agg(id::text,',' ORDER BY id) FROM public.customers WHERE company_id IN(${list})),'')||'|'||coalesce((SELECT string_agg(id::text,',' ORDER BY id) FROM public.customer_sites WHERE company_id IN(${list})),'')||'|'||coalesce((SELECT string_agg(id::text,',' ORDER BY id) FROM public.metering_points WHERE company_id IN(${list})),''))`)
}

/**
 * CONTRL-svarsrouten kräver en rutt-profil vars application_reference = UNB-applikationsreferensen i originalet
 * (gridex_ediel_technical_ack.select_configured_reply_route_v2: `p.application_reference IS NOT DISTINCT FROM u->>'applicationReference'`).
 * lib/seed.mjs seedar profilerna med NULL -> `ediel_technical_ack_route_count:0` och ingen CONTRL. Harnessfel i delad seed (ej ändrad här):
 * EDIEL02 lägger en egen kompletterande profil (kopia av ediel_ack-profilen) per miljö med '23-DDQ-E66-T'.
 */
export function ensureE02AckRouteProfile(environment: 'test' | 'production' = 'test', app = '23-DDQ-E66-T'): void {
  const co = lit(e02CompanyId()), env = lit(environment)
  // Idempotent: sätt application_reference på den befintliga ediel_ack-profilen i stället för att kopiera den (en kopia ger två aktiva profiler på samma rutt -> PGRST116 i maybeSingle).
  if (Number(sql(`SELECT count(*) FROM public.ediel_route_profiles WHERE company_id=${co} AND environment=${env} AND is_active AND route_name LIKE '%ediel_ack%' AND application_reference=${lit(app)}`)) === 0)
    sql(`UPDATE public.ediel_route_profiles SET application_reference=${lit(app)} WHERE id=(SELECT id FROM public.ediel_route_profiles WHERE company_id=${co} AND environment=${env} AND is_active AND route_name LIKE '%ediel_ack%' AND application_reference IS NULL ORDER BY created_at DESC LIMIT 1)`)
  deactivateDuplicateE02RouteProfiles()
}

/**
 * Engångsstädning: ediel_route_runtime_v filtrerar inte på is_active, så extra profiler på samma rutt ger PGRST116.
 * Varje överskjutande profil (allt utom den nyaste, aktiva först, per rutt+miljö) flyttas till en EGEN inaktiv arkivrutt
 * (samma bolag, unikt namn) och sätts is_active=false. Inga rader raderas och FK-barn (historik m.m.) rörs inte.
 * Idempotent: en flyttad profil är ensam på sin rutt (rank 1) och väljs aldrig igen.
 */
export function deactivateDuplicateE02RouteProfiles(): void {
  sql(`DO $$
DECLARE co uuid := ${lit(e02CompanyId())}; p record; dr uuid;
BEGIN
  FOR p IN SELECT id, communication_route_id FROM (SELECT id, communication_route_id, row_number() OVER (PARTITION BY communication_route_id, environment ORDER BY is_active DESC, created_at DESC, id DESC) rn
      FROM public.ediel_route_profiles WHERE company_id=co) t WHERE rn>1 LOOP
    INSERT INTO public.communication_routes(company_id,route_name,route_scope,route_type,is_active,target_email,counterparty_ediel_id,environment_type,market_party_role)
      SELECT company_id,'T3SIM E02 archived profile '||left(p.id::text,8),route_scope,route_type,false,target_email,counterparty_ediel_id,environment_type,market_party_role
      FROM public.communication_routes WHERE id=p.communication_route_id RETURNING id INTO dr;
    UPDATE public.ediel_route_profiles SET communication_route_id=dr, is_active=false WHERE id=p.id;
  END LOOP;
END $$;`)
}

/** Vakt: exakt en rad i ediel_route_runtime_v per fixturens ACK-rutt (annars kastar runtime-uppslaget PGRST116). */
export function assertSingleAckRuntimeRow(environment: 'test' | 'production' = 'test'): void {
  const routes = sql(`SELECT DISTINCT communication_route_id FROM public.ediel_route_profiles WHERE company_id=${lit(e02CompanyId())} AND environment=${lit(environment)} AND route_name LIKE '%ediel_ack%'`).split('\n').filter(Boolean)
  if (routes.length === 0) throw new Error('E02 setup: ingen ACK-rutt hittad för fixturen')
  for (const r of routes) {
    const n = Number(sql(`SELECT count(*) FROM public.ediel_route_runtime_v WHERE communication_route_id=${lit(r)}`))
    if (n !== 1) throw new Error(`E02 setup: ediel_route_runtime_v har ${n} rader (förväntat 1) för ACK-rutt ${r}`)
  }
}
