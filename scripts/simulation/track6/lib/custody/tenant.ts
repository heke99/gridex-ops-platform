// Egen leverantörstenant + routbar mätpunktskedja för CUSTODY01. Syntetiskt, lokalt, idempotent.
// Härkomst (kopierad, ändrad): 01d97c27:scripts/simulation/track3/lib/e01-fixture.ts seedE01Tenant() och seedRoutableChain()
//   (parametriserade på namn/Ediel-ID; DSO-adress t6.sim.invalid; registerUtiltsIssuer importeras dynamiskt från scripts/helpers).
import { COUNTERPARTY_EDIEL_ID, lit, sql, sqlJson } from '../seed.mjs'
import { actorId, mode, sqlIn } from './base'

const ensure = (table: string, where: string, insert: Record<string, unknown>, rawCols: string[] = []): string => {
  const found = sql(`SELECT id FROM ${table} WHERE ${where} LIMIT 1`)
  if (found) return found
  const cols = Object.keys(insert)
  return sql(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map((c) => (rawCols.includes(c) ? String(insert[c]) : lit(insert[c]))).join(',')}) RETURNING id`).split('\n')[0]
}

export type SupplierTenant = { companyId: string; actorUserId: string; name: string; edielId: string; gridOwnerId: string }

/** Egen leverantörstenant med unikt Ediel-ID (t.ex. 16712) och samma automationsaktör som basfixturen. */
export function seedSupplierTenant(o: { name: string; edielId: string }): SupplierTenant {
  const a = actorId()
  const dso = 'dso@t6.sim.invalid'
  const mailbox = process.env.T6_MAILBOX_ADDRESS ?? 'ediel@t6.sim.invalid'
  const past = "clock_timestamp()-interval '1 day'"
  const companyId = ensure('public.companies', `name=${lit(o.name)}`, { name: o.name, status: 'active', ediel_id: o.edielId, default_environment: 'test' })
  sql(`UPDATE public.companies SET ediel_id=${lit(o.edielId)}, status='active', is_active=true WHERE id=${lit(companyId)}`)
  const ownerRole = sql(`SELECT id FROM public.roles WHERE key='owner' LIMIT 1`) || null
  ensure('public.company_memberships', `company_id=${lit(companyId)} AND user_id=${lit(a)}`,
    { company_id: companyId, user_id: a, status: 'active', is_active: true, role: 'owner', role_key: 'owner', membership_role: 'owner', role_id: ownerRole })
  sql(`UPDATE public.company_memberships SET accepted_at=coalesce(accepted_at,now()), joined_at=coalesce(joined_at,now()) WHERE company_id=${lit(companyId)} AND user_id=${lit(a)}`)
  sql(`INSERT INTO public.user_permissions(user_id,company_id,permission_id,permission_key,is_active,status,effect)
    SELECT ${lit(a)},${lit(companyId)},p.id,p.key,true,'active','allow' FROM public.permissions p
    WHERE (p.key LIKE 'communication.%' OR p.key LIKE 'ediel.%' OR p.key LIKE 'ediel\\_testing.%' OR p.key LIKE 'metering.%')
      AND NOT EXISTS (SELECT 1 FROM public.user_permissions u WHERE u.user_id=${lit(a)} AND u.company_id=${lit(companyId)} AND u.permission_key=p.key)`)
  sql(`UPDATE public.company_capabilities SET enabled=true, readiness_status='ready' WHERE company_id=${lit(companyId)} AND capability_code IN ('ediel_test','ediel_production')`)
  let gridOwnerId = ''
  for (const environment of ['test', 'production'] as const) {
    ensure('public.tenant_ediel_profiles', `company_id=${lit(companyId)} AND environment=${lit(environment)} AND market='electricity'`,
      { company_id: companyId, environment, market: 'electricity', is_enabled: 'true', valid_from: past }, ['valid_from'])
    ensure('public.tenant_actor_identifiers', `company_id=${lit(companyId)} AND environment=${lit(environment)} AND identifier_type='EdielId' AND identifier_value=${lit(o.edielId)}`,
      { company_id: companyId, environment, actor_id: a, identifier_type: 'EdielId', identifier_value: o.edielId, valid_from: past }, ['valid_from'])
    ensure('public.tenant_actor_roles', `company_id=${lit(companyId)} AND environment=${lit(environment)} AND actor_id=${lit(a)} AND role_code='electricity_supplier'`,
      { company_id: companyId, environment, actor_id: a, role_code: 'electricity_supplier', valid_from: past }, ['valid_from'])
    const g = ensure('public.grid_owners', `company_id=${lit(companyId)} AND environment=${lit(environment)} AND ediel_id=${lit(COUNTERPARTY_EDIEL_ID)}`,
      { company_id: companyId, name: `${o.name} DSO ${COUNTERPARTY_EDIEL_ID}`, ediel_id: COUNTERPARTY_EDIEL_ID, environment, is_active: 'true', lifecycle_status: 'active', owner_code: 'TES' })
    if (environment === mode()) gridOwnerId = g
    ensure('public.ediel_actor_settings', `company_id=${lit(companyId)} AND environment=${lit(environment)} AND actor_ediel_id=${lit(o.edielId)}`,
      { company_id: companyId, actor_name: o.name, actor_ediel_id: o.edielId, ediel_id: o.edielId, actor_role: 'supplier', role: 'supplier', environment, is_active: true,
        sender_name: o.name, default_test_flag: environment === 'test' ? 1 : 0, smtp_from_email: mailbox, mailbox })
    for (const scope of ['ediel_ack', 'meter_values']) {
      const routeName = `${o.name} ${scope} -> DSO ${COUNTERPARTY_EDIEL_ID} (${environment})`
      const routeId = ensure('public.communication_routes', `company_id=${lit(companyId)} AND route_name=${lit(routeName)}`,
        { company_id: companyId, route_name: routeName, route_scope: scope, route_type: 'ediel_partner', is_active: true, target_email: dso, counterparty_ediel_id: COUNTERPARTY_EDIEL_ID,
          environment_type: environment === 'test' ? 'tgt_test' : 'production', market_party_role: 'grid_owner' })
      // Generisk rutt (grid_owner_id NULL), som i spår 3: två 70007-nätägare (test+production) ger annars tvetydigt ruttval.
      sql(`UPDATE public.communication_routes SET grid_owner_id=NULL WHERE id=${lit(routeId)}`)
      ensure('public.ediel_route_profiles', `company_id=${lit(companyId)} AND communication_route_id=${lit(routeId)}`,
        { company_id: companyId, communication_route_id: routeId, is_enabled: true, is_active: true, environment, route_name: routeName, sender_ediel_id: o.edielId, own_ediel_id: o.edielId,
          receiver_ediel_id: COUNTERPARTY_EDIEL_ID, counterparty_ediel_id: COUNTERPARTY_EDIEL_ID, receiver_email: dso, smtp_to: dso, smtp_from: mailbox,
          smtp_host: '127.0.0.1', smtp_port: Number(process.env.T6_SMTP_PORT ?? 3625), mailbox, is_test_route: environment === 'test', is_production_route: environment === 'production',
          transport_mode: 'smtp_imap', tls_required: true, encryption_mode: 'none', default_test_flag: environment === 'test' ? 1 : 0,
          ...(scope === 'ediel_ack' ? { application_reference: '23-DDQ-E66-T' } : {}) })
    }
  }
  return { companyId, actorUserId: a, name: o.name, edielId: o.edielId, gridOwnerId }
}

export type SeededPoint = { meteringPoint: string; customerId: string; siteId: string; pointId: string; requestId: string }
/** Godkänd utgivare/mandat för 70007 + kund, anläggning, mätpunkt och dataförfrågan per mätpunkt. Idempotent per mätpunkt. */
export async function seedRoutableChain(t: SupplierTenant, meteringPoints: string[]): Promise<SeededPoint[]> {
  const { registerUtiltsIssuer } = await import('../../../../helpers/utiltsConsumptionParties')
  registerUtiltsIssuer(sqlIn, lit, COUNTERPARTY_EDIEL_ID, t.actorUserId)
  const points: SeededPoint[] = []
  for (const mp of meteringPoints) {
    const existing = sqlJson(`SELECT to_jsonb(x) FROM (SELECT p.id AS "pointId", p.customer_id AS "customerId", p.site_id AS "siteId", r.id AS "requestId" FROM public.metering_points p
      LEFT JOIN public.grid_owner_data_requests r ON r.metering_point_id=p.id WHERE p.company_id=${lit(t.companyId)} AND p.metering_point_id=${lit(mp)} LIMIT 1) x`) as null | Omit<SeededPoint, 'meteringPoint'>
    if (existing) { points.push({ meteringPoint: mp, ...existing }); continue }
    const id = () => sql('SELECT gen_random_uuid()')
    const customerId = id(), siteId = id(), pointId = id(), requestId = id()
    sqlIn(`INSERT INTO public.customers(id,company_id,customer_number,name,customer_type) VALUES(${lit(customerId)},${lit(t.companyId)},${lit(`T6-${mp.slice(-8)}`)},'T6SIM kund (syntetisk)','private');
     INSERT INTO public.customer_sites(id,company_id,customer_id,site_name,site_type,status,country,facility_id,grid_owner_id) VALUES(${lit(siteId)},${lit(t.companyId)},${lit(customerId)},'T6SIM anläggning','consumption','active','SE',${lit(mp)},${lit(t.gridOwnerId)});
     INSERT INTO public.metering_points(id,company_id,customer_id,site_id,customer_site_id,metering_point_id,meter_point_id,grid_owner_id) VALUES(${lit(pointId)},${lit(t.companyId)},${lit(customerId)},${lit(siteId)},${lit(siteId)},${lit(mp)},${lit(mp)},${lit(t.gridOwnerId)});
     INSERT INTO public.grid_owner_data_requests(id,company_id,customer_id,site_id,metering_point_id,grid_owner_id,request_scope) VALUES(${lit(requestId)},${lit(t.companyId)},${lit(customerId)},${lit(siteId)},${lit(pointId)},${lit(t.gridOwnerId)},'billing_underlay');`)
    points.push({ meteringPoint: mp, customerId, siteId, pointId, requestId })
  }
  return points
}
