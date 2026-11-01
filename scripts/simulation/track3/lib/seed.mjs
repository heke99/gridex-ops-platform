// Spår 3: fixture-seed mot den LOKALA Supabase-stacken. Idempotent.
// Bas-fixturen (tenant, aktör, parter 16700/70007, rutter, delad brevlåda) är stabil över körningar eftersom
// inkommande tenantupplösning kräver exakt en tenant per Ediel-ID. Unikt per körning är runPrefix (referenser
// i meddelanden, ämnesrader, mapp-/evidensnamn).
//
// Syntetiska identiteter: egen part 16700, motpart (nätägare/DSO) 70007, SVK-koder i NAD enligt befintliga
// enhetsfixturer (__tests__/helpers/utiltsObservationHandoff.ts på 1c0c088c: "NAD+MS+..:SVK:260").
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const { createClient } = require('@supabase/supabase-js')

export const OWN_EDIEL_ID = '16700'
export const COUNTERPARTY_EDIEL_ID = '70007'
export const DSO_EMAIL = 'dso@t3.sim.invalid'
export const ACTOR_EMAIL = 't3sim-automation@t3.sim.invalid'
export const COMPANY_NAME = 'T3SIM Supplier AB'
export const COMPANY_ORG = '5560160680' // syntetiskt organisationsnummer-format; ingen verklig koppling avsedd

export function envOrThrow(name) {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} saknas (ladda SIM_HOME/env/track3.env)`)
  return v
}

/** Supabase admin-klient (service role) mot lokala stacken. Vägrar annan värd än 127.0.0.1/localhost. */
export function adminClient() {
  const url = envOrThrow('NEXT_PUBLIC_SUPABASE_URL')
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) throw new Error('adminClient: endast lokal Supabase tillåts')
  return createClient(url, envOrThrow('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export function dbUrl() {
  const url = process.env.T3_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
  if (!/@(127\.0\.0\.1|localhost):\d+\//.test(url)) throw new Error('db: endast lokal databas tillåts')
  return url
}

export const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replaceAll("'", "''")}'`)
export const jlit = (v) => `${lit(JSON.stringify(v))}::jsonb`

/** Kör SQL via psql (tuples-only). Returnerar trimmad stdout. */
export function sql(statement) {
  return execFileSync('psql', [dbUrl(), '-XAtq', '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    encoding: 'utf8', timeout: 60_000, env: { ...process.env, PGPASSWORD: 'postgres' },
  }).trim()
}
/** SQL som returnerar en JSON-kolumn -> parsat värde. */
export function sqlJson(statement) {
  const out = sql(statement)
  return out ? JSON.parse(out) : null
}

export function newRunContext(label = 'run') {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const runId = `${stamp}-${randomBytes(3).toString('hex')}`
  const prefix = `T3S${stamp.slice(2, 12)}${randomBytes(2).toString('hex').toUpperCase()}` // t.ex. T3S2610292014AB12
  return { runId, prefix, label }
}

async function ensureActorUser(admin) {
  let userId = null
  for (let page = 1; page < 10 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    userId = data.users.find((u) => u.email === ACTOR_EMAIL)?.id ?? null
    if (data.users.length < 200) break
  }
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: ACTOR_EMAIL, password: randomBytes(24).toString('hex'), email_confirm: true,
      user_metadata: { full_name: 'T3SIM Ediel automation (syntetisk)' },
    })
    if (error) throw error
    userId = data.user.id
  }
  return userId
}

/** Ersätt/skapa en rad identifierad av ett naturligt nyckeluttryck. */
function ensureRow({ table, where, insert }) {
  const found = sql(`SELECT id FROM ${table} WHERE ${where} LIMIT 1`)
  if (found) return found
  const cols = Object.keys(insert)
  return sql(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map((c) => insert[c] instanceof Raw ? insert[c].sql : lit(insert[c])).join(',')}) RETURNING id`).split('\n')[0]
}
class Raw { constructor(s) { this.sql = s } }
const raw = (s) => new Raw(s)

/**
 * Seeda bas-fixturen för båda miljöerna. Returnerar id:n. Skriver dessutom evidens om vad som ändrades.
 * @param {{ simHome?: string, mode?: 'test'|'production' }} options
 */
export async function seedFixture(options = {}) {
  const simHome = options.simHome ?? process.env.T3_SIM_HOME ?? process.env.SIM_HOME
  const admin = adminClient()
  const actorUserId = await ensureActorUser(admin)

  const companyId = ensureRow({
    table: 'public.companies', where: `name=${lit(COMPANY_NAME)}`,
    insert: { name: COMPANY_NAME, status: 'active', ediel_id: OWN_EDIEL_ID, default_environment: 'test' },
  })
  sql(`UPDATE public.companies SET ediel_id=${lit(OWN_EDIEL_ID)}, status='active', is_active=true WHERE id=${lit(companyId)}`)

  ensureRow({
    table: 'public.user_profiles', where: `id=${lit(actorUserId)}`,
    insert: { id: actorUserId, email: ACTOR_EMAIL, full_name: 'T3SIM Ediel automation (syntetisk)' },
  })
  const ownerRole = sql(`SELECT id FROM public.roles WHERE key='owner' LIMIT 1`) || null
  ensureRow({
    table: 'public.company_memberships', where: `company_id=${lit(companyId)} AND user_id=${lit(actorUserId)}`,
    insert: { company_id: companyId, user_id: actorUserId, status: 'active', is_active: true, role: 'owner', role_key: 'owner', membership_role: 'owner', role_id: ownerRole },
  })

  sql(`UPDATE public.company_memberships SET accepted_at=coalesce(accepted_at,now()), joined_at=coalesce(joined_at,now())
       WHERE company_id=${lit(companyId)} AND user_id=${lit(actorUserId)}`)
  // Automationsaktörens behörigheter (mönster: scripts/helpers/ediel-decision-original-native-fixture.ts decisionUser(), 1c0c088c).
  // Alla communication.*, ediel.*, ediel_testing.* och metering.* tillstånd som finns i katalogen, som explicit allow-rader för just denna syntetiska aktör.
  sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect)
    SELECT ${lit(actorUserId)},${lit(companyId)},p.id,p.key,true,'active','allow' FROM public.permissions p
    WHERE (p.key LIKE 'communication.%' OR p.key LIKE 'ediel.%' OR p.key LIKE 'ediel\\_testing.%' OR p.key LIKE 'metering.%')
      AND NOT EXISTS (SELECT 1 FROM public.user_permissions u WHERE u.user_id=${lit(actorUserId)} AND u.company_id=${lit(companyId)} AND u.permission_key=p.key)`)

  // Motpartens (DSO 70007) marknadsaktör + nätägare, delad över miljöer (plattformsdata).
  // Mönster från 1c0c088cb4ed66d0dd8b3e34c9606019342a1a56:scripts/helpers/ediel-h05h08-normal-switch-native-fixture.ts (foundation()).
  const gridActorId = ensureRow({
    table: 'public.platform_market_actors', where: `name=${lit('T3SIM DSO 70007 (syntetisk nätägare)')}`,
    insert: { name: 'T3SIM DSO 70007 (syntetisk nätägare)', status: 'active', match_status: 'verified', visible_to_tenants: 'true' },
  })
  ensureRow({
    table: 'public.platform_actor_identifiers', where: `actor_id=${lit(gridActorId)} AND identifier_type='EdielId' AND identifier_value=${lit(COUNTERPARTY_EDIEL_ID)}`,
    insert: { actor_id: gridActorId, identifier_type: 'EdielId', identifier_value: COUNTERPARTY_EDIEL_ID, is_verified: 'true' },
  })
  ensureRow({
    table: 'public.platform_actor_roles', where: `actor_id=${lit(gridActorId)} AND actor_role='grid_owner'`,
    insert: { actor_id: gridActorId, actor_role: 'grid_owner', is_active: 'true' },
  })
  sql(`UPDATE public.company_capabilities SET enabled=true, readiness_status='ready' WHERE company_id=${lit(companyId)} AND capability_code IN ('ediel_test','ediel_production')`)

  const gridOwners = {}
  const routes = {}
  for (const environment of ['test', 'production']) {
    // Juridisk identitet för egen part (tenant_actor_identifiers/roles/profil) -> verifierad tenantupplösning.
    ensureRow({
      table: 'public.tenant_ediel_profiles', where: `company_id=${lit(companyId)} AND environment=${lit(environment)} AND market='electricity'`,
      insert: { company_id: companyId, environment, market: 'electricity', is_enabled: 'true', valid_from: raw("clock_timestamp()-interval '1 day'") },
    })
    ensureRow({
      table: 'public.tenant_actor_identifiers',
      where: `company_id=${lit(companyId)} AND environment=${lit(environment)} AND identifier_type='EdielId' AND identifier_value=${lit(OWN_EDIEL_ID)}`,
      insert: { company_id: companyId, environment, actor_id: actorUserId, identifier_type: 'EdielId', identifier_value: OWN_EDIEL_ID, valid_from: raw("clock_timestamp()-interval '1 day'") },
    })
    ensureRow({
      table: 'public.tenant_actor_roles', where: `company_id=${lit(companyId)} AND environment=${lit(environment)} AND actor_id=${lit(actorUserId)} AND role_code='electricity_supplier'`,
      insert: { company_id: companyId, environment, actor_id: actorUserId, role_code: 'electricity_supplier', valid_from: raw("clock_timestamp()-interval '1 day'") },
    })
    gridOwners[environment] = ensureRow({
      table: 'public.grid_owners', where: `company_id=${lit(companyId)} AND environment=${lit(environment)} AND ediel_id=${lit(COUNTERPARTY_EDIEL_ID)}`,
      insert: { company_id: companyId, name: 'T3SIM DSO 70007', ediel_id: COUNTERPARTY_EDIEL_ID, environment, is_active: 'true', lifecycle_status: 'active', owner_code: 'TES' },
    })
    // Egen part (aktörsinställning) per miljö.
    ensureRow({
      table: 'public.ediel_actor_settings',
      where: `company_id=${lit(companyId)} AND environment=${lit(environment)} AND actor_ediel_id=${lit(OWN_EDIEL_ID)}`,
      insert: {
        company_id: companyId, actor_name: 'T3SIM Supplier AB', actor_ediel_id: OWN_EDIEL_ID, ediel_id: OWN_EDIEL_ID,
        actor_role: 'supplier', role: 'supplier', environment, is_active: true, sender_name: 'T3SIM Supplier AB',
        default_test_flag: environment === 'test' ? 1 : 0, smtp_from_email: process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid',
        mailbox: process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid',
      },
    })
    // Motpart-/nätägarväg: en kommunikationsrutt + rutt-profil per scope så att CONTRL/APERAK (ediel_ack) och E66 (meter_values) hittar 70007.
    for (const scope of ['ediel_ack', 'meter_values']) {
      const routeName = `T3SIM ${scope} -> DSO ${COUNTERPARTY_EDIEL_ID} (${environment})`
      const routeId = ensureRow({
        table: 'public.communication_routes', where: `company_id=${lit(companyId)} AND route_name=${lit(routeName)}`,
        insert: {
          company_id: companyId, route_name: routeName, route_scope: scope, route_type: 'ediel_partner', is_active: true,
          target_email: DSO_EMAIL, counterparty_ediel_id: COUNTERPARTY_EDIEL_ID, environment_type: environment === 'test' ? 'tgt_test' : 'production',
          market_party_role: 'grid_owner', grid_owner_id: gridOwners[environment],
        },
      })
      const profileId = ensureRow({
        table: 'public.ediel_route_profiles', where: `company_id=${lit(companyId)} AND communication_route_id=${lit(routeId)}`,
        insert: {
          company_id: companyId, communication_route_id: routeId, is_enabled: true, is_active: true, environment,
          route_name: routeName, sender_ediel_id: OWN_EDIEL_ID, own_ediel_id: OWN_EDIEL_ID,
          receiver_ediel_id: COUNTERPARTY_EDIEL_ID, counterparty_ediel_id: COUNTERPARTY_EDIEL_ID,
          receiver_email: DSO_EMAIL, smtp_to: DSO_EMAIL, smtp_from: process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid',
          smtp_host: '127.0.0.1', smtp_port: Number(process.env.T3_SMTP_PORT ?? 3125),
          mailbox: process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid',
          is_test_route: environment === 'test', is_production_route: environment === 'production',
          transport_mode: 'smtp_imap', tls_required: true, encryption_mode: 'none',
          default_test_flag: environment === 'test' ? 1 : 0,
        },
      })
      routes[`${environment}:${scope}`] = { routeId, profileId }
    }
  }

  // Delad inkommande brevlåda (platform_shared) per miljö -> lokala IMAP via egen CA.
  const mailboxAddress = process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid'
  const imapPort = Number(process.env.T3_IMAP_TLS_PORT ?? 3993)
  const mailboxes = {}
  const originals = []
  for (const environment of ['test', 'production']) {
    const row = sqlJson(`SELECT to_jsonb(m) FROM public.ediel_mailboxes m WHERE company_id IS NULL AND environment=${lit(environment)}
      AND COALESCE(metadata->>'scope','')='platform_shared' ORDER BY created_at LIMIT 1`)
    if (!row) throw new Error(`ingen platform_shared-brevlåda för ${environment}`)
    originals.push(row)
    sql(`UPDATE public.ediel_mailboxes SET email_address=${lit(mailboxAddress)}, imap_host='127.0.0.1', imap_port=${imapPort},
      username=${lit(process.env.T3_IMAP_USER ?? 'ediel')}, secret_reference='env:EDIEL_IMAP_PASS', smtp_from=${lit(mailboxAddress)},
      is_active=true, locked_at=NULL, locked_by=NULL, last_error=NULL,
      metadata = metadata || ${jlit({ imap_folder: 'INBOX', imap_secure: true, smtp_secure: true, t3sim: true })},
      updated_at=now() WHERE id=${lit(row.id)}`)
    mailboxes[environment] = row.id
  }
  if (simHome) {
    const dir = join(simHome, 'evidence'); mkdirSync(dir, { recursive: true })
    const original = join(dir, 'seed-original-shared-mailboxes.json')
    if (!existsSync(original)) writeFileSync(original, JSON.stringify(originals, null, 2), { mode: 0o600 })
  }

  return { companyId, actorUserId, actorEmail: ACTOR_EMAIL, ownEdielId: OWN_EDIEL_ID, counterpartyEdielId: COUNTERPARTY_EDIEL_ID,
    dsoEmail: DSO_EMAIL, mailboxAddress, gridOwnerActorId: gridActorId, mailboxes, routes, seededAt: new Date().toISOString() }
}

export const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export { randomUUID }
