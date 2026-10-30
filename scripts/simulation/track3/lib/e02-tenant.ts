// EDIEL02: valfri ny, tom tenant med eget Ediel-ID via env (T3_E02_OWN_ID, t.ex. 16722). Utan env används fixturens tenant (16700).
// Mönster: lib/seed.mjs seedFixture() (tenant, aktör, behörigheter, juridisk identitet, aktörsinställning, rutter) - kopierat i form, ej ändrat där.
// Tenanten får även ack-rutt-profil med application_reference '23-DDQ-E66-T' (krävs av select_configured_reply_route_v2).
import { randomBytes, randomUUID } from 'node:crypto'
import { adminClient, COMPANY_NAME, COUNTERPARTY_EDIEL_ID, DSO_EMAIL, OWN_EDIEL_ID, lit, sql } from './seed.mjs'

export const E02_OWN_ID: string = process.env.T3_E02_OWN_ID || OWN_EDIEL_ID
export const E02_APP_REF = '23-DDQ-E66-T'
export type E02Tenant = { companyId: string; actorUserId: string; ownId: string; isolated: boolean }
let cached: E02Tenant | null = null

export function e02CompanyId(): string { return cached?.companyId ?? sql(`SELECT id FROM public.companies WHERE name=${lit(COMPANY_NAME)} LIMIT 1`) }

export async function ensureE02Tenant(): Promise<E02Tenant> {
  if (cached) return cached
  if (E02_OWN_ID === OWN_EDIEL_ID) {
    cached = { companyId: sql(`SELECT id FROM public.companies WHERE name=${lit(COMPANY_NAME)} LIMIT 1`), actorUserId: process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!, ownId: OWN_EDIEL_ID, isolated: false }
    return cached
  }
  const id = E02_OWN_ID, name = `T3SIM E02 tenant ${id}`, email = `e02-${id}@t3.sim.invalid`
  const admin = adminClient()
  let companyId = sql(`SELECT id FROM public.companies WHERE name=${lit(name)} LIMIT 1`)
  if (!companyId) companyId = sql(`INSERT INTO public.companies(name,status,ediel_id,default_environment) VALUES(${lit(name)},'active',${lit(id)},'test') RETURNING id`).split('\n')[0]
  sql(`UPDATE public.companies SET ediel_id=${lit(id)}, status='active', is_active=true WHERE id=${lit(companyId)}`)
  let actor = sql(`SELECT id FROM auth.users WHERE email=${lit(email)} LIMIT 1`)
  if (!actor) {
    const { data, error } = await admin.auth.admin.createUser({ email, password: randomBytes(24).toString('hex'), email_confirm: true, user_metadata: { full_name: `E02 actor ${id} (syntetisk)` } })
    if (error) throw error
    actor = data.user.id
  }
  const one = (table: string, where: string, cols: string, vals: string) => { if (!sql(`SELECT id FROM ${table} WHERE ${where} LIMIT 1`)) sql(`INSERT INTO ${table}(${cols}) VALUES(${vals})`) }
  if (!sql(`SELECT id FROM public.user_profiles WHERE id=${lit(actor)}`)) sql(`INSERT INTO public.user_profiles(id,email,full_name) VALUES(${lit(actor)},${lit(email)},'E02 actor (syntetisk)')`)
  const ownerRole = sql(`SELECT id FROM public.roles WHERE key='owner' LIMIT 1`)
  one('public.company_memberships', `company_id=${lit(companyId)} AND user_id=${lit(actor)}`, 'company_id,user_id,status,is_active,role,role_key,membership_role,role_id,accepted_at,joined_at',
    `${lit(companyId)},${lit(actor)},'active',true,'owner','owner','owner',${ownerRole ? lit(ownerRole) : 'NULL'},now(),now()`)
  sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect)
    SELECT ${lit(actor)},${lit(companyId)},p.id,p.key,true,'active','allow' FROM public.permissions p
    WHERE (p.key LIKE 'communication.%' OR p.key LIKE 'ediel.%' OR p.key LIKE 'ediel\\_testing.%' OR p.key LIKE 'metering.%')
      AND NOT EXISTS (SELECT 1 FROM public.user_permissions u WHERE u.user_id=${lit(actor)} AND u.company_id=${lit(companyId)} AND u.permission_key=p.key)`)
  // Appens outbox-cron kör som fixturens automationsaktör (app-processens env): den måste vara medlem med behörighet i den nya tenanten,
  // annars misslyckas utskicket ("[object Object]").
  const appActor = process.env.T3_APP_AUTOMATION_ACTOR_USER_ID ?? process.env.EDIEL_AUTOMATION_ACTOR_USER_ID!
  if (appActor && appActor !== actor) {
    one('public.company_memberships', `company_id=${lit(companyId)} AND user_id=${lit(appActor)}`, 'company_id,user_id,status,is_active,role,role_key,membership_role,role_id,accepted_at,joined_at',
      `${lit(companyId)},${lit(appActor)},'active',true,'owner','owner','owner',${ownerRole ? lit(ownerRole) : 'NULL'},now(),now()`)
    sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect)
      SELECT ${lit(appActor)},${lit(companyId)},p.id,p.key,true,'active','allow' FROM public.permissions p
      WHERE (p.key LIKE 'communication.%' OR p.key LIKE 'ediel.%' OR p.key LIKE 'ediel\\_testing.%' OR p.key LIKE 'metering.%')
        AND NOT EXISTS (SELECT 1 FROM public.user_permissions u WHERE u.user_id=${lit(appActor)} AND u.company_id=${lit(companyId)} AND u.permission_key=p.key)`)
  }
  sql(`UPDATE public.company_capabilities SET enabled=true, readiness_status='ready' WHERE company_id=${lit(companyId)} AND capability_code IN ('ediel_test','ediel_production')`)
  const from = process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid', smtpPort = Number(process.env.T3_SMTP_PORT ?? 3125)
  for (const env of ['test', 'production'] as const) {
    const past = "clock_timestamp()-interval '1 day'"
    if (!sql(`SELECT id FROM public.tenant_ediel_profiles WHERE company_id=${lit(companyId)} AND environment=${lit(env)} AND market='electricity'`)) sql(`INSERT INTO public.tenant_ediel_profiles(company_id,environment,market,is_enabled,valid_from) VALUES(${lit(companyId)},${lit(env)},'electricity',true,${past})`)
    if (!sql(`SELECT id FROM public.tenant_actor_identifiers WHERE company_id=${lit(companyId)} AND environment=${lit(env)} AND identifier_value=${lit(id)}`)) sql(`INSERT INTO public.tenant_actor_identifiers(company_id,environment,actor_id,identifier_type,identifier_value,valid_from) VALUES(${lit(companyId)},${lit(env)},${lit(actor)},'EdielId',${lit(id)},${past})`)
    if (!sql(`SELECT id FROM public.tenant_actor_roles WHERE company_id=${lit(companyId)} AND environment=${lit(env)} AND actor_id=${lit(actor)} AND role_code='electricity_supplier'`)) sql(`INSERT INTO public.tenant_actor_roles(company_id,environment,actor_id,role_code,valid_from) VALUES(${lit(companyId)},${lit(env)},${lit(actor)},'electricity_supplier',${past})`)
    // Rutten är generisk (grid_owner_id NULL): två 70007-nätägare (test+production) ger annars tvetydig svarsrutt (som e01-fixture).
    let grid = sql(`SELECT id FROM public.grid_owners WHERE company_id=${lit(companyId)} AND environment=${lit(env)} AND ediel_id=${lit(COUNTERPARTY_EDIEL_ID)} LIMIT 1`)
    if (!grid) grid = sql(`INSERT INTO public.grid_owners(company_id,name,ediel_id,environment,is_active,lifecycle_status,owner_code) VALUES(${lit(companyId)},'T3SIM DSO 70007',${lit(COUNTERPARTY_EDIEL_ID)},${lit(env)},true,'active','TES') RETURNING id`).split('\n')[0]
    if (!sql(`SELECT id FROM public.ediel_actor_settings WHERE company_id=${lit(companyId)} AND environment=${lit(env)} AND actor_ediel_id=${lit(id)}`))
      sql(`INSERT INTO public.ediel_actor_settings(company_id,actor_name,actor_ediel_id,ediel_id,actor_role,role,environment,is_active,sender_name,default_test_flag,smtp_from_email,mailbox) VALUES(${lit(companyId)},${lit(name)},${lit(id)},${lit(id)},'supplier','supplier',${lit(env)},true,${lit(name)},${env === 'test' ? 1 : 0},${lit(from)},${lit(from)})`)
    for (const scope of ['ediel_ack', 'meter_values']) {
      const routeName = `T3SIM E02 ${id} ${scope} -> DSO ${COUNTERPARTY_EDIEL_ID} (${env})`
      let route = sql(`SELECT id FROM public.communication_routes WHERE company_id=${lit(companyId)} AND route_name=${lit(routeName)}`)
      if (!route) route = sql(`INSERT INTO public.communication_routes(company_id,route_name,route_scope,route_type,is_active,target_email,counterparty_ediel_id,environment_type,market_party_role) VALUES(${lit(companyId)},${lit(routeName)},${lit(scope)},'ediel_partner',true,${lit(DSO_EMAIL)},${lit(COUNTERPARTY_EDIEL_ID)},${env === 'test' ? "'tgt_test'" : "'production'"},'grid_owner') RETURNING id`).split('\n')[0]
      if (!sql(`SELECT id FROM public.ediel_route_profiles WHERE company_id=${lit(companyId)} AND communication_route_id=${lit(route)}`))
        sql(`INSERT INTO public.ediel_route_profiles(company_id,communication_route_id,is_enabled,is_active,environment,route_name,sender_ediel_id,own_ediel_id,receiver_ediel_id,counterparty_ediel_id,receiver_email,smtp_to,smtp_from,smtp_host,smtp_port,mailbox,is_test_route,is_production_route,transport_mode,tls_required,encryption_mode,default_test_flag,application_reference)
          VALUES(${lit(companyId)},${lit(route)},true,true,${lit(env)},${lit(routeName)},${lit(id)},${lit(id)},${lit(COUNTERPARTY_EDIEL_ID)},${lit(COUNTERPARTY_EDIEL_ID)},${lit(DSO_EMAIL)},${lit(DSO_EMAIL)},${lit(from)},'127.0.0.1',${smtpPort},${lit(from)},${env === 'test'},${env === 'production'},'smtp_imap',true,'none',${env === 'test' ? 1 : 0},${lit(E02_APP_REF)})`)
    }
  }
  cached = { companyId, actorUserId: actor, ownId: id, isolated: true }
  // Motorn i testprocessen (lib/inprocess.ts) läser aktören ur env; appens outbox-cron har sin egen (fixturens) aktör.
  process.env.EDIEL_AUTOMATION_ACTOR_USER_ID = actor
  void randomUUID
  return cached
}
