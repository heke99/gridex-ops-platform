// EDIEL01-hjälpare: gör syntetiska UTILTS E66 (70007 -> 16700) fullt routbara så att CONTRL och APERAK skapas.
//
// Ursprung (läst, inte kopierat rakt av; SQL-formen för kundkedjan är anpassad):
//  * 1c0c088c:scripts/ediel-utilts-consumption-native.test.ts rad ~60-90 (seed(): customers, customer_sites,
//    metering_points, grid_owner_data_requests; mönstret för tenant-/aktörsrader finns redan i lib/seed.mjs).
//  * 1c0c088c:scripts/helpers/utiltsConsumptionParties.ts registerUtiltsIssuer() (importeras, inte kopierad):
//    godkänd utgivare + transportmandat för nätägaren 70007 (gridex_utilts_issuer.*).
//  * 1c0c088c:__tests__/helpers/utiltsObservationHandoff.ts energyHandoffMessage() (segmentlayout för E66 "energy":
//    en 15-minutersobservation, STS+7++21::260) och __tests__/helpers/utiltsNativeSourceFixture.ts
//    utiltsTestEnvironmentWire() (UNB 0031/0035 = 1 för miljö 'test').
// Allt data är syntetiskt. Unika referenser per körning (prefix) och löpnummer.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { registerUtiltsIssuer, seedUtiltsIssuerHistoryGround } from '../../../helpers/utiltsConsumptionParties'
import { COUNTERPARTY_EDIEL_ID, dbUrl, lit, sql, sqlJson } from './seed.mjs'

/** Egen part för EDIEL01: en egen tenant (se seedE01Tenant), inte basfixturens 16700. */
export const OWN_EDIEL_ID = process.env.T3_E01_OWN_ID ?? '16701'
export const E01_COMPANY_NAME = OWN_EDIEL_ID === '16701' ? 'T3SIM E01 Supplier AB' : `T3SIM E01 Supplier AB ${OWN_EDIEL_ID}`

/** psql via stdin (BEGIN/COMMIT-block och flera satser). Tom utdata -> undefined, annars JSON. */
export function sqlIn<T = unknown>(input: string): T {
  const out = execFileSync('psql', [dbUrl(), '-XAtq', '-v', 'ON_ERROR_STOP=1'], {
    input, encoding: 'utf8', timeout: 60_000, maxBuffer: 20_000_000, env: { ...process.env, PGPASSWORD: 'postgres' },
  }).trim()
  if (out === 't' || out === 'f') return (out === 't') as T
  try { return (out ? JSON.parse(out) : undefined) as T } catch { return out as unknown as T }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

/** GS1 mod-10 kontrollsiffra (vikter 3,1,3,... från höger i kroppen) för en 17-siffrig kropp -> 18-siffrigt GSRN. */
export function gs1WithCheckDigit(body17: string): string {
  if (!/^\d{17}$/.test(body17)) throw new Error('gsrn_body_must_be_17_digits')
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(body17[16 - i]) * (i % 2 === 0 ? 3 : 1)
  return body17 + String((10 - (sum % 10)) % 10)
}

export type E66Spec = { seq: number; interchangeRef: string; documentRef: string; transactionRef: string; meteringPoint: string; raw: string }

/** Syntetiskt E66 ("energy"-varianten) med unika UNB-/BGM-/IDE-referenser och unik mätpunkt per (prefix, seq). */
export function buildRoutableE66(o: { prefix: string; seq: number; now?: Date; environment?: 'test' | 'production'; sender?: string; receiver?: string }): E66Spec {
  const now = o.now ?? new Date()
  const env = o.environment ?? ((process.env.T3_MODE as 'test' | 'production') ?? 'test')
  const sender = o.sender ?? COUNTERPARTY_EDIEL_ID
  const receiver = o.receiver ?? OWN_EDIEL_ID
  const h = sha(`${o.prefix}:${o.seq}`)
  const interchangeRef = `I${h.slice(0, 13)}`
  const documentRef = `M${h.slice(13, 33)}`
  const transactionRef = `T${h.slice(33, 49)}`
  const digits = BigInt('0x' + h.slice(0, 15)).toString().padStart(9, '0').slice(-9)
  const meteringPoint = gs1WithCheckDigit(`73599926${digits}`)
  const pad = (n: number) => String(n).padStart(2, '0')
  const yymmdd = `${pad(now.getUTCFullYear() % 100)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`
  const hhmm = `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
  const periodStart = new Date(now.getTime() - 3 * 86400_000)
  const ps = `${periodStart.getUTCFullYear()}${pad(periodStart.getUTCMonth() + 1)}${pad(periodStart.getUTCDate())}0000`
  const pe = `${periodStart.getUTCFullYear()}${pad(periodStart.getUTCMonth() + 1)}${pad(periodStart.getUTCDate())}0015`
  const testFlags = env === 'test' ? '++1++1' : '++1'
  const body = [
    "UNA:+.? '",
    `UNB+UNOC:3+${sender}:ZZ+${receiver}:ZZ+${yymmdd}:${hhmm}+${interchangeRef}++23-DDQ-E66-T${testFlags}'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'",
    `BGM+E66::260+${documentRef}+9+AB'`,
    `DTM+137:20${yymmdd}${hhmm}:203'`,
    "DTM+735:?+0200:406'", "MKS+23+E02::260'",
    `NAD+MS+${sender}:SVK:260'`, `NAD+MR+${receiver}:SVK:260'`, "NAD+DDQ'",
    `IDE+24+${transactionRef}'`, `LOC+172+${meteringPoint}::9'`, "LOC+239+TES:SVK:260'",
    "LIN+++8716867000030:::9'", `DTM+324:${ps}${pe}:719'`,
    `DTM+597:${pe}:203'`, "DTM+354:15:806'", "STS+7++E88::260'", "MEA+AAZ++KWH'",
    "CCI+++E12::260'", "CAV+E17::260'",
    "SEQ++1'", "QTY+136:500'", `DTM+597:${ps}:203'`, "STS+7++21::260'",
  ]
  // UNT = antal segment UNH..UNT.
  const unh = body.findIndex((s) => s.startsWith('UNH+'))
  const lines = [...body, `UNT+${body.length - unh + 1}+1'`, `UNZ+1+${interchangeRef}'`]
  return { seq: o.seq, interchangeRef, documentRef, transactionRef, meteringPoint, raw: lines.join('\n') }
}

export type Seeded = { companyId: string; actorUserId: string; gridOwnerId: string; points: Array<{ meteringPoint: string; customerId: string; siteId: string; pointId: string; requestId: string }> }

/** Godkänd utgivare/mandat för 70007 + kund, anläggning, mätpunkt och dataförfrågan per mätpunkt. Idempotent per mätpunkt. */
export function seedRoutableChain(meteringPoints: string[], environment: 'test' | 'production' = (process.env.T3_MODE as 'test' | 'production') ?? 'test'): Seeded {
  const fx = sqlIn<{ company: string; actor: string; grid: string }>(`SELECT json_build_object('company',c.id,'actor',(SELECT actor_id FROM public.tenant_actor_identifiers WHERE company_id=c.id AND environment=${lit(environment)} AND identifier_value=${lit(OWN_EDIEL_ID)} LIMIT 1),
    'grid',(SELECT id FROM public.grid_owners WHERE company_id=c.id AND environment=${lit(environment)} AND ediel_id=${lit(COUNTERPARTY_EDIEL_ID)} LIMIT 1))::text FROM public.companies c WHERE c.name=${lit(E01_COMPANY_NAME)}`)
  registerUtiltsIssuer(sqlIn, lit, COUNTERPARTY_EDIEL_ID, fx.actor)
  const points: Seeded['points'] = []
  for (const mp of meteringPoints) {
    const existing = sqlJson(`SELECT to_jsonb(x) FROM (SELECT p.id AS "pointId", p.customer_id AS "customerId", p.site_id AS "siteId", r.id AS "requestId" FROM public.metering_points p
      LEFT JOIN public.grid_owner_data_requests r ON r.metering_point_id=p.id WHERE p.company_id=${lit(fx.company)} AND p.metering_point_id=${lit(mp)} LIMIT 1) x`) as null | { pointId: string; customerId: string; siteId: string; requestId: string }
    if (existing) { points.push({ meteringPoint: mp, ...existing }); continue }
    const id = () => sql('SELECT gen_random_uuid()')
    const customerId = id(), siteId = id(), pointId = id(), requestId = id()
    sqlIn(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(customerId)},${lit(fx.company)},${lit(`T3-${mp.slice(-8)}`)},'T3SIM kund (syntetisk)','private');
     INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id) VALUES(${lit(siteId)},${lit(fx.company)},${lit(customerId)},'T3SIM anläggning','consumption','active','SE',${lit(mp)},${lit(fx.grid)});
     INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,grid_owner_id) VALUES(${lit(pointId)},${lit(fx.company)},${lit(customerId)},${lit(siteId)},${lit(siteId)},${lit(mp)},${lit(mp)},${lit(fx.grid)});
     INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${lit(requestId)},${lit(fx.company)},${lit(customerId)},${lit(siteId)},${lit(pointId)},${lit(fx.grid)},'billing_underlay');`)
    points.push({ meteringPoint: mp, customerId, siteId, pointId, requestId })
  }
  return { companyId: fx.company, actorUserId: fx.actor, gridOwnerId: fx.grid, points }
}

/**
 * Teknisk kvittensrutt (CONTRL/APERAK) för E66-utbyten: select_configured_reply_route_v2 kräver exakt en aktiv rutt+profil
 * vars application_reference = originalets UNB-applikationsreferens (här 23-DDQ-E66-T). Basfixturens ediel_ack-profil har
 * application_reference NULL. En andra rutt+profil gör affärsflödets ruttval tvetydigt (communication_route_ambiguous:test:generic),
 * så basprofilen sätts i stället; returnerar tidigare värde så att scenariot kan återställa det.
 */
export function setAckRouteApplicationReference(value: string | null, environment: 'test' | 'production' = (process.env.T3_MODE as 'test' | 'production') ?? 'test'): { profileId: string; previous: string | null } {
  const row = sqlJson(`SELECT to_jsonb(x) FROM (SELECT p.id AS "profileId", p.application_reference AS previous FROM public.ediel_route_profiles p
    JOIN public.companies c ON c.id=p.company_id
    WHERE c.name=${lit(E01_COMPANY_NAME)} AND p.route_name=${lit(`T3SIM E01 ediel_ack -> DSO ${COUNTERPARTY_EDIEL_ID} (${environment})`)}) x`) as { profileId: string; previous: string | null }
  sqlIn(`UPDATE public.ediel_route_profiles SET application_reference=${value === null ? 'NULL' : lit(value)} WHERE id=${lit(row.profileId)}`)
  return row
}

/** Granskat historiktäckningsunderlag (syntetiskt) för redan admitterade källor; anpassat anrop av helperns seedUtiltsIssuerHistoryGround. */
export function seedHistoryGround(sourceIds: string[], actorUserId: string): number {
  let n = 0
  for (const id of sourceIds) {
    seedUtiltsIssuerHistoryGround(sqlIn, lit, id, actorUserId)
    n++
  }
  return n
}

/**
 * Egen tenant för EDIEL01 (T3SIM E01 Supplier AB, Ediel-ID 16701), adapterad från lib/seed.mjs seedFixture() (rad ~95-205: bolag, medlemskap,
 * behörigheter, juridisk identitet, nätägare 70007, aktörsinställning, rutter + rutt-profiler). Skäl: kvittensläsningarna
 * (gridex_ack_authority.read_outbound_originals_v1 m.fl.) går igenom varje utgående CONTRL i bolaget; ackskapandet tog >8 s
 * (PostgREST statement_timeout) när basbolaget redan hade ~37 CONTRL från övriga spår. Egen tenant ger en ren grund och påverkar inte
 * andra spårs data. Samma automationsaktör och samma delade IMAP-brevlåda (tenant väljs på UNB-mottagare).
 * Idempotent.
 */
export function seedE01Tenant(): { companyId: string; actorUserId: string } {
  const actorUserId = process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!
  const ensure = (table: string, where: string, insert: Record<string, unknown>, rawCols: string[] = []): string => {
    const found = sql(`SELECT id FROM ${table} WHERE ${where} LIMIT 1`)
    if (found) return found
    const cols = Object.keys(insert)
    return sql(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map((c) => (rawCols.includes(c) ? String(insert[c]) : lit(insert[c]))).join(',')}) RETURNING id`).split('\n')[0]
  }
  const companyId = ensure('public.companies', `name=${lit(E01_COMPANY_NAME)}`, { name: E01_COMPANY_NAME, status: 'active', ediel_id: OWN_EDIEL_ID, default_environment: 'test' })
  sql(`UPDATE public.companies SET ediel_id=${lit(OWN_EDIEL_ID)}, status='active', is_active=true WHERE id=${lit(companyId)}`)
  const ownerRole = sql(`SELECT id FROM public.roles WHERE key='owner' LIMIT 1`) || null
  ensure('public.company_memberships', `company_id=${lit(companyId)} AND user_id=${lit(actorUserId)}`,
    { company_id: companyId, user_id: actorUserId, status: 'active', is_active: true, role: 'owner', role_key: 'owner', membership_role: 'owner', role_id: ownerRole })
  sql(`UPDATE public.company_memberships SET accepted_at=coalesce(accepted_at,now()), joined_at=coalesce(joined_at,now()) WHERE company_id=${lit(companyId)} AND user_id=${lit(actorUserId)}`)
  sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect)
    SELECT ${lit(actorUserId)},${lit(companyId)},p.id,p.key,true,'active','allow' FROM public.permissions p
    WHERE (p.key LIKE 'communication.%' OR p.key LIKE 'ediel.%' OR p.key LIKE 'ediel\\_testing.%' OR p.key LIKE 'metering.%')
      AND NOT EXISTS (SELECT 1 FROM public.user_permissions u WHERE u.user_id=${lit(actorUserId)} AND u.company_id=${lit(companyId)} AND u.permission_key=p.key)`)
  sql(`UPDATE public.company_capabilities SET enabled=true, readiness_status='ready' WHERE company_id=${lit(companyId)} AND capability_code IN ('ediel_test','ediel_production')`)
  const mailboxAddress = process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid'
  for (const environment of ['test', 'production'] as const) {
    ensure('public.tenant_ediel_profiles', `company_id=${lit(companyId)} AND environment=${lit(environment)} AND market='electricity'`,
      { company_id: companyId, environment, market: 'electricity', is_enabled: 'true', valid_from: "clock_timestamp()-interval '1 day'" }, ['valid_from'])
    ensure('public.tenant_actor_identifiers', `company_id=${lit(companyId)} AND environment=${lit(environment)} AND identifier_type='EdielId' AND identifier_value=${lit(OWN_EDIEL_ID)}`,
      { company_id: companyId, environment, actor_id: actorUserId, identifier_type: 'EdielId', identifier_value: OWN_EDIEL_ID, valid_from: "clock_timestamp()-interval '1 day'" }, ['valid_from'])
    ensure('public.tenant_actor_roles', `company_id=${lit(companyId)} AND environment=${lit(environment)} AND actor_id=${lit(actorUserId)} AND role_code='electricity_supplier'`,
      { company_id: companyId, environment, actor_id: actorUserId, role_code: 'electricity_supplier', valid_from: "clock_timestamp()-interval '1 day'" }, ['valid_from'])
    const gridOwnerId = ensure('public.grid_owners', `company_id=${lit(companyId)} AND environment=${lit(environment)} AND ediel_id=${lit(COUNTERPARTY_EDIEL_ID)}`,
      { company_id: companyId, name: 'T3SIM E01 DSO 70007', ediel_id: COUNTERPARTY_EDIEL_ID, environment, is_active: 'true', lifecycle_status: 'active', owner_code: 'TES' })
    ensure('public.ediel_actor_settings', `company_id=${lit(companyId)} AND environment=${lit(environment)} AND actor_ediel_id=${lit(OWN_EDIEL_ID)}`,
      { company_id: companyId, actor_name: E01_COMPANY_NAME, actor_ediel_id: OWN_EDIEL_ID, ediel_id: OWN_EDIEL_ID, actor_role: 'supplier', role: 'supplier', environment, is_active: true,
        sender_name: E01_COMPANY_NAME, default_test_flag: environment === 'test' ? 1 : 0, smtp_from_email: mailboxAddress, mailbox: mailboxAddress })
    for (const scope of ['ediel_ack', 'meter_values']) {
      const routeName = `T3SIM E01 ${scope} -> DSO ${COUNTERPARTY_EDIEL_ID} (${environment})`
      const routeId = ensure('public.communication_routes', `company_id=${lit(companyId)} AND route_name=${lit(routeName)}`,
        { company_id: companyId, route_name: routeName, route_scope: scope, route_type: 'ediel_partner', is_active: true, target_email: 'dso@t3.sim.invalid', counterparty_ediel_id: COUNTERPARTY_EDIEL_ID,
          environment_type: environment === 'test' ? 'tgt_test' : 'production', market_party_role: 'grid_owner' })
      // Generisk rutt (grid_owner_id NULL): replyGridOwnerId() hittar två 70007-nätägare (test+production) och faller då tillbaka på generiska rutten.
      sql(`UPDATE public.communication_routes SET grid_owner_id=NULL WHERE id=${lit(routeId)}`); void gridOwnerId
      ensure('public.ediel_route_profiles', `company_id=${lit(companyId)} AND communication_route_id=${lit(routeId)}`,
        { company_id: companyId, communication_route_id: routeId, is_enabled: true, is_active: true, environment, route_name: routeName, sender_ediel_id: OWN_EDIEL_ID, own_ediel_id: OWN_EDIEL_ID,
          receiver_ediel_id: COUNTERPARTY_EDIEL_ID, counterparty_ediel_id: COUNTERPARTY_EDIEL_ID, receiver_email: 'dso@t3.sim.invalid', smtp_to: 'dso@t3.sim.invalid', smtp_from: mailboxAddress,
          smtp_host: '127.0.0.1', smtp_port: Number(process.env.T3_SMTP_PORT ?? 3125), mailbox: mailboxAddress, is_test_route: environment === 'test', is_production_route: environment === 'production',
          transport_mode: 'smtp_imap', tls_required: true, encryption_mode: 'none', default_test_flag: environment === 'test' ? 1 : 0 })
    }
  }
  // Ångra min tidigare ändring av basfixturens ediel_ack-profil (application_reference) om en avbruten körning lämnade den kvar.
  sql(`UPDATE public.ediel_route_profiles SET application_reference=NULL WHERE route_name LIKE 'T3SIM ediel_ack -> DSO %' AND application_reference='23-DDQ-E66-T'`)
  return { companyId, actorUserId }
}
