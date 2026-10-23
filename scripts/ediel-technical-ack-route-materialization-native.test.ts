// reality-defects: F92, F98 (an inbound grid-owner file can be answered: registry materialization creates the technical CONTRL/APERAK reply routes)
// Native proof against the installed schema and the installed ACK route selector.
// A synthetic grid owner is imported through the public actor-registry importer
// (PRODAT and UTILTS production routes), verified by a platform administrator,
// and materialized for a synthetic supplier by materializeCompanyGridOwnerRoute.
// The reply-route candidate predicate is read from the INSTALLED definition of
// gridex_ediel_technical_ack.select_configured_reply_route_v2 (never copied), and
// evaluated against the inbound UNB the grid owner sends (sender = grid owner,
// receiver = the supplier): exactly one configured pair must answer CONTRL and
// APERAK for each application reference the grid owner sends the supplier.
// The rest of that function (original source, reception and mailbox custody)
// is unchanged and is not under test here. Synthetic data only.
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { nativeSql as sql, literal } from './helpers/ediel-normal-switch-native-fixture'
import { importActorRegistryXml } from '@/lib/actor-registry/importActorRegistry'
import { readRegistryRouteSource, verifyElRegistryActor } from '@/lib/actor-registry/registryMarketSource'
import { materializeCompanyGridOwnerRoute } from '@/lib/ediel/routeMaterializer'
import { inboundTechnicalAckApplicationReferences } from '@/lib/ediel/technicalAckRouteMaterializer'

type Unb = { sender: [string, string, string]; receiver: [string, string, string]; applicationReference: string }
type Candidates = { routeIds: string[]; profileIds: string[] }

const SMTP = { from: 'gridex-f92-ack@example.invalid', host: 'smtp.f92.example.invalid', port: 465 }
const GRID_SUB = { PRODAT: 'F92GP', UTILTS: 'F92GU' } as const
const OWN_SUB = { PRODAT: 'F92P', UTILTS: 'F92U' } as const
const cleanup: Array<() => void> = []

function stubSmtp(configured: boolean) {
  vi.stubEnv('EMAIL_PROVIDER', '')
  vi.stubEnv('EDIEL_EMAIL_PROVIDER', 'strato')
  vi.stubEnv('EDIEL_SMTP_HOST', SMTP.host)
  vi.stubEnv('EDIEL_SMTP_PORT', String(SMTP.port))
  vi.stubEnv('EDIEL_SMTP_SECURE', 'true')
  vi.stubEnv('EDIEL_SMTP_USER', configured ? SMTP.from : '')
  vi.stubEnv('EDIEL_SMTP_FROM', configured ? SMTP.from : '')
  vi.stubEnv('EDIEL_SMTP_PASS', configured ? 'synthetic-f92-not-a-secret' : '')
  vi.stubEnv('EDIEL_SMTP_PASSWORD', '')
  vi.stubEnv('EDIEL_SHARED_MAILBOX_ADDRESS', '')
  vi.stubEnv('EDIEL_APP_DKIM_ENABLED', 'false')
}
afterEach(() => { vi.unstubAllEnvs() })
afterAll(() => { for (const step of cleanup.reverse()) step() })

/**
 * The configured-route predicate of the installed selector, verbatim. It is cut out of
 * pg_get_functiondef and run in a session-temporary function with the selector's own
 * parameter names, so the proof follows the installed definition and fails if its shape changes.
 */
function configuredAckCandidates(c: string, replyFamily: 'CONTRL' | 'APERAK', u: Unb): Candidates {
  const definition = sql<string>(`SELECT to_jsonb(pg_get_functiondef('gridex_ediel_technical_ack.select_configured_reply_route_v2(uuid,jsonb,text,text,text,integer)'::regprocedure))`)
  const head = 'SELECT array_agg(r.id),array_agg(p.id) INTO candidate_ids,candidate_profile_ids FROM'
  const start = definition.indexOf(head), end = definition.indexOf(' IF coalesce(cardinality(candidate_ids),0)<>1 THEN', start)
  if (start < 0 || end < 0 || definition.indexOf(head, start + 1) >= 0) throw Error('installed_ack_selector_shape_changed')
  const predicate = definition.slice(start, end)
  if (!predicate.includes("r.route_scope='ediel_ack'") || !predicate.includes("p.application_reference IS NOT DISTINCT FROM u->>'applicationReference'")) throw Error('installed_ack_selector_shape_changed')
  return sql<Candidates>(`CREATE FUNCTION pg_temp.f92_configured_ack_candidates(c uuid,env text,reply_family text,u jsonb,current_smtp_from text,current_smtp_host text,current_smtp_port integer)
    RETURNS jsonb LANGUAGE plpgsql AS $f92$DECLARE candidate_ids uuid[];candidate_profile_ids uuid[];BEGIN
    ${predicate}
    RETURN jsonb_build_object('routeIds',coalesce(to_jsonb(candidate_ids),'[]'::jsonb),'profileIds',coalesce(to_jsonb(candidate_profile_ids),'[]'::jsonb));END$f92$;
    SELECT pg_temp.f92_configured_ack_candidates(${literal(c)},'production',${literal(replyFamily)},${literal(u)}::jsonb,${literal(SMTP.from)},${literal(SMTP.host)},${SMTP.port});`)
}

/** What the grid owner's file carries: sender = grid owner (its registry sub-address), receiver = the supplier. */
function inboundUnb(gridEdielId: string, supplierEdielId: string, family: 'PRODAT' | 'UTILTS', applicationReference: string): Unb {
  return { sender: [gridEdielId, '14', GRID_SUB[family]], receiver: [supplierEdielId, '14', OWN_SUB[family]], applicationReference }
}

function ackState(companyId: string) {
  return sql<{ routes: number; profiles: number; routeIds: string[]; profileIds: string[] }>(`SELECT jsonb_build_object(
    'routes',(SELECT count(*) FROM public.communication_routes WHERE company_id=${literal(companyId)} AND route_scope='ediel_ack'),
    'profiles',(SELECT count(*) FROM public.ediel_route_profiles p JOIN public.communication_routes r ON r.id=p.communication_route_id WHERE r.company_id=${literal(companyId)} AND r.route_scope='ediel_ack'),
    'routeIds',(SELECT coalesce(jsonb_agg(id ORDER BY id),'[]') FROM public.communication_routes WHERE company_id=${literal(companyId)} AND route_scope='ediel_ack'),
    'profileIds',(SELECT coalesce(jsonb_agg(p.id ORDER BY p.id),'[]') FROM public.ediel_route_profiles p JOIN public.communication_routes r ON r.id=p.communication_route_id WHERE r.company_id=${literal(companyId)} AND r.route_scope='ediel_ack'))`)
}

it('policy: the inbound application references a grid owner sends a supplier', () => {
  // PRODAT: every canonical grid-owner → supplier profile (Z02/Z04/Z05/Z06/Z10) uses 23-DDQ-PRODAT.
  expect(inboundTechnicalAckApplicationReferences('PRODAT')).toEqual(['23-DDQ-PRODAT'])
  // UTILTS: the field-311 registry values of the grid-owner → supplier codes (S02, S03, E31, E66) for the supplier role DDQ.
  expect(inboundTechnicalAckApplicationReferences('UTILTS')).toEqual(['23-DDQ-E31-S', '23-DDQ-E31-T', '23-DDQ-E66-S', '23-DDQ-E66-T', '23-DDQ-S02-S', '23-DDQ-S03-S'])
  expect(inboundTechnicalAckApplicationReferences('AI_LIST')).toEqual([])
})

it('materializing a grid owner route gives the supplier exactly one technical reply route per inbound application reference, idempotently and per tenant', async () => {
  stubSmtp(true)
  const admin = randomUUID(), companyA = randomUUID(), companyB = randomUUID(), companyC = randomUUID()
  const gridA = randomUUID(), gridC = randomUUID()
  const legal = sql<string>(`SELECT to_jsonb(n::text) FROM generate_series(90000,99999) n WHERE NOT EXISTS(SELECT FROM public.platform_actor_identifiers WHERE identifier_type='EdielId' AND identifier_value=n::text)
    AND NOT EXISTS(SELECT FROM public.grid_owners WHERE ediel_id=n::text) ORDER BY n DESC LIMIT 1`)
  const [supplierA, supplierB, supplierC] = sql<string[]>(`SELECT jsonb_agg(n::text ORDER BY n) FROM (SELECT n FROM generate_series(70000,79999) n
    WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=n::text)
      AND NOT EXISTS(SELECT FROM public.ediel_actor_settings a WHERE a.ediel_id=n::text OR a.actor_ediel_id=n::text) ORDER BY n DESC LIMIT 3) s`)
  const settings = (company: string, edielId: string) => `INSERT INTO public.companies(id,name,status) VALUES(${literal(company)},'Synthetic F92 supplier ${edielId}','active');
    INSERT INTO public.ediel_actor_settings(company_id,environment,actor_name,actor_ediel_id,ediel_id,role,sender_subaddress_prodat,sender_subaddress_utilts)
    VALUES(${literal(company)},'production','Synthetic F92 supplier',${literal(edielId)},${literal(edielId)},'supplier',${literal(OWN_SUB.PRODAT)},${literal(OWN_SUB.UTILTS)});`
  sql(`INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,is_sso_user,is_anonymous)
     VALUES(${literal(admin)},'authenticated','authenticated',${literal(admin + '@example.invalid')},now(),'{}','{}',now(),now(),false,false);
    INSERT INTO public.user_profiles(id,email,full_name,user_status) VALUES(${literal(admin)},${literal(admin + '@example.invalid')},'Synthetic F92 registry administrator','active') ON CONFLICT(id) DO UPDATE SET user_status='active';
    INSERT INTO public.admin_users(user_id,role,is_active) VALUES(${literal(admin)},'platform_admin',true);
    ${settings(companyA, supplierA)} ${settings(companyB, supplierB)} ${settings(companyC, supplierC)}`)
  cleanup.push(() => sql(`UPDATE public.admin_users SET is_active=false WHERE user_id=${literal(admin)}`))

  // The grid owner's published registry entry: one PRODAT and one UTILTS production route.
  const gridAddress = `f92-natagare-${legal}@example.invalid`
  const details = (family: 'PRODAT' | 'UTILTS', applicationReference: string) => `<EDIFACTDetails Type="${family}"><ApplicationReference>${applicationReference}</ApplicationReference><SubAddress>${GRID_SUB[family]}</SubAddress>
    <PartyId>${legal}</PartyId><InterchangePartyId>${legal}</InterchangePartyId><CommunicationAddress Type="SMTP">${gridAddress}</CommunicationAddress></EDIFACTDetails>`
  const xml = `<Market Code="EL" Country="SE"><Company><Name>Synthetic F92 grid owner ${legal}</Name><Key Type="EdielId">${legal}</Key><Role>DSO</Role>
    ${details('PRODAT', '23-DDQ-PRODAT')}${details('UTILTS', '23-DDQ-E66-T')}</Company></Market>`
  const imported = await importActorRegistryXml({ xml, uploadedBy: admin, sourceFilename: 'synthetic-f92-grid-owner.xml' })
  const routeIds = Reflect.get(imported, 'routeIds') as string[]
  expect(routeIds).toHaveLength(2)
  const sources = await Promise.all(routeIds.map(id => readRegistryRouteSource(id)))
  const byFamily = Object.fromEntries(sources.map(source => {
    if (source.status !== 'source_qualified') throw Error('f92_registry_source_required')
    return [source.wire.family, source]
  }))
  expect(Object.keys(byFamily).sort()).toEqual(['PRODAT', 'UTILTS'])
  const actorId = byFamily.PRODAT.actorId
  for (const source of sources) if (source.status === 'source_qualified') {
    expect(await verifyElRegistryActor({ actorUserId: admin, actorId, routeId: source.routeId })).toMatchObject({ actorId, routeIds: [source.routeId], market: 'EL' })
  }
  // SYNTHETIC stand-in for the platform's auto-send readiness apply (gridex_apply_actor_auto_send_readiness
  // needs certificate trust that is not under test). The registry source and verification stay real.
  sql(`UPDATE public.platform_actor_routes SET auto_send_allowed=true WHERE actor_id=${literal(actorId)} AND id IN(${routeIds.map(literal).join(',')});`)
  // The UTILTS message the supplier sends on this route is prospective public configuration (as in the Z03L
  // fixture); the company readiness view keys a UTILTS route by it. The immutable registry source is unchanged.
  sql(`UPDATE public.platform_actor_routes SET metadata=metadata||'{"message_code":"E73"}'::jsonb WHERE id=${literal(byFamily.UTILTS.routeId)} AND actor_id=${literal(actorId)};`)
  expect(await readRegistryRouteSource(byFamily.UTILTS.routeId)).toEqual(byFamily.UTILTS)
  cleanup.push(() => sql(`UPDATE public.platform_actor_routes SET auto_send_allowed=false,is_verified=false,status='needs_review' WHERE actor_id=${literal(actorId)};
    UPDATE public.grid_owners SET is_active=false WHERE id IN(${literal(gridA)},${literal(gridC)});`))
  sql(`INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status,platform_market_actor_id)
    VALUES(${literal(gridA)},${literal(companyA)},'Synthetic F92 Nät AB',${literal(legal)},'production',true,'active',${literal(actorId)}),
          (${literal(gridC)},${literal(companyC)},'Synthetic F92 Nät AB',${literal(legal)},'production',true,'active',${literal(actorId)});`)

  const materialize = (companyId: string, gridOwnerId: string, family: 'PRODAT' | 'UTILTS') => materializeCompanyGridOwnerRoute({
    companyId, gridOwnerId, platformActorRouteId: byFamily[family].routeId, messageFamily: family,
    messageCode: family === 'UTILTS' ? 'E73' : null, environment: 'production', actorUserId: admin })

  // Tenant A: PRODAT, then UTILTS.
  const prodat = await materialize(companyA, gridA, 'PRODAT')
  expect(prodat, JSON.stringify(prodat)).toMatchObject({ status: 'materialized', companyId: companyA, messageFamily: 'PRODAT', environment: 'production',
    technicalAck: { status: 'materialized', reasonCode: null, applicationReferences: ['23-DDQ-PRODAT'] } })
  expect(prodat.technicalAck!.routes).toEqual([{ applicationReference: '23-DDQ-PRODAT', action: 'created',
    communicationRouteId: expect.stringMatching(/^[0-9a-f-]{36}$/), edielRouteProfileId: expect.stringMatching(/^[0-9a-f-]{36}$/) }])
  const utilts = await materialize(companyA, gridA, 'UTILTS')
  expect(utilts, JSON.stringify(utilts)).toMatchObject({ status: 'materialized', messageFamily: 'UTILTS', technicalAck: { status: 'materialized',
    applicationReferences: inboundTechnicalAckApplicationReferences('UTILTS') } })
  expect(utilts.technicalAck!.routes.map(route => route.action)).toEqual(Array(6).fill('created'))

  // Every row belongs to tenant A and carries the selector's shape.
  const rows = sql<Array<Record<string, unknown>>>(`SELECT jsonb_agg(jsonb_build_object('company',r.company_id,'profileCompany',p.company_id,'scope',r.route_scope,'envType',r.environment_type,
      'active',r.is_active,'grid',r.grid_owner_id,'target',r.target_email,'env',p.environment,'family',p.message_family,'code',p.business_code,'standard',p.message_standard,'format',p.payload_format,
      'sender',p.sender_ediel_id,'senderSub',p.sender_subaddress,'senderSub2',p.sender_sub_address,'receiver',p.receiver_ediel_id,'receiverSub',p.receiver_subaddress,'receiverSub2',p.receiver_sub_address,
      'app',p.application_reference,'mailbox',p.mailbox,'host',p.smtp_host,'port',p.smtp_port,'transportProfile',p.transport_profile_id,'enabled',p.is_enabled,'profileActive',p.is_active,
      'from',r.auth_config->>'materialized_from','forFamily',r.auth_config->>'technical_ack_for_family','profileFrom',p.metadata->>'materialized_from','profileForFamily',p.metadata->>'technical_ack_for_family')
      ORDER BY p.application_reference)
    FROM public.communication_routes r JOIN public.ediel_route_profiles p ON p.communication_route_id=r.id WHERE r.company_id=${literal(companyA)} AND r.route_scope='ediel_ack'`)
  expect(rows).toHaveLength(7)
  for (const row of rows) {
    const family = row.app === '23-DDQ-PRODAT' ? 'PRODAT' : 'UTILTS'
    expect(row).toEqual({ company: companyA, profileCompany: companyA, scope: 'ediel_ack', envType: 'production', active: true, grid: gridA, target: gridAddress, env: 'production',
      family: null, code: null, standard: 'edifact', format: 'edifact', sender: supplierA, senderSub: OWN_SUB[family], senderSub2: OWN_SUB[family],
      receiver: legal, receiverSub: GRID_SUB[family], receiverSub2: GRID_SUB[family], app: row.app, mailbox: SMTP.from, host: SMTP.host, port: SMTP.port,
      transportProfile: null, enabled: true, profileActive: true, from: 'platform_actor_routes', forFamily: family, profileFrom: 'platform_actor_routes', profileForFamily: family })
  }

  // The installed selector finds exactly one reply pair for an inbound PRODAT (Z04) and E66 file, for CONTRL and APERAK.
  const ackRoute = (app: string) => utilts.technicalAck!.routes.concat(prodat.technicalAck!.routes).find(route => route.applicationReference === app)!
  for (const [family, app] of [['PRODAT', '23-DDQ-PRODAT'], ['UTILTS', '23-DDQ-E66-T'], ['UTILTS', '23-DDQ-E66-S']] as const) {
    for (const reply of ['CONTRL', 'APERAK'] as const) {
      expect(configuredAckCandidates(companyA, reply, inboundUnb(legal, supplierA, family, app)), `${reply} ${app}`)
        .toEqual({ routeIds: [ackRoute(app).communicationRouteId], profileIds: [ackRoute(app).edielRouteProfileId] })
    }
  }
  // Not a reference the grid owner sends the supplier, and not the supplier's own sub-address: nothing answers.
  expect(configuredAckCandidates(companyA, 'CONTRL', inboundUnb(legal, supplierA, 'PRODAT', '23-DGI-PRODAT'))).toEqual({ routeIds: [], profileIds: [] })
  expect(configuredAckCandidates(companyA, 'CONTRL', { ...inboundUnb(legal, supplierA, 'PRODAT', '23-DDQ-PRODAT'), receiver: [supplierA, '14', 'OTHER'] })).toEqual({ routeIds: [], profileIds: [] })

  // Idempotent: a second run keeps every pair and creates none.
  const before = ackState(companyA)
  expect(before).toMatchObject({ routes: 7, profiles: 7 })
  const again = [await materialize(companyA, gridA, 'PRODAT'), await materialize(companyA, gridA, 'UTILTS')]
  for (const result of again) expect(result, JSON.stringify(result)).toMatchObject({ status: 'materialized', technicalAck: { status: 'materialized' } })
  expect(again.flatMap(result => result.technicalAck!.routes.map(route => route.action))).toEqual(Array(7).fill('updated'))
  expect(ackState(companyA)).toEqual(before)
  expect(configuredAckCandidates(companyA, 'APERAK', inboundUnb(legal, supplierA, 'UTILTS', '23-DDQ-E66-T')).routeIds).toHaveLength(1)

  // Another tenant gets nothing: no rows, and tenant A's routes never answer for it.
  expect(ackState(companyB)).toEqual({ routes: 0, profiles: 0, routeIds: [], profileIds: [] })
  expect(configuredAckCandidates(companyB, 'CONTRL', inboundUnb(legal, supplierA, 'PRODAT', '23-DDQ-PRODAT'))).toEqual({ routeIds: [], profileIds: [] })
  expect(configuredAckCandidates(companyB, 'CONTRL', inboundUnb(legal, supplierB, 'PRODAT', '23-DDQ-PRODAT'))).toEqual({ routeIds: [], profileIds: [] })

  // Without the shared Ediel SMTP account the business route is still materialized; the ACK routes are skipped with a reason.
  vi.unstubAllEnvs()
  stubSmtp(false)
  const withoutSmtp = await materialize(companyC, gridC, 'PRODAT')
  expect(withoutSmtp, JSON.stringify(withoutSmtp)).toMatchObject({ status: 'materialized', companyId: companyC, messageFamily: 'PRODAT',
    communicationRouteId: expect.stringMatching(/^[0-9a-f-]{36}$/), edielRouteProfileId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    technicalAck: { status: 'skipped', reasonCode: 'ediel_smtp_not_configured', routes: [] } })
  expect(sql(`SELECT to_jsonb(count(*)) FROM public.communication_routes WHERE company_id=${literal(companyC)} AND route_scope='customer_masterdata' AND is_active`)).toBe(1)
  expect(ackState(companyC)).toEqual({ routes: 0, profiles: 0, routeIds: [], profileIds: [] })
  // Tenant A is untouched by tenant C's run.
  expect(ackState(companyA)).toEqual(before)

  // A pair tenant C already configured by hand for the same inbound identity is kept, never duplicated
  // (the selector holds on two matches instead of choosing one).
  vi.unstubAllEnvs()
  stubSmtp(true)
  const handRoute = randomUUID(), handProfile = randomUUID()
  sql(`INSERT INTO public.communication_routes(id,company_id,route_name,route_scope,grid_owner_id,environment_type,is_active,target_email)
      VALUES(${literal(handRoute)},${literal(companyC)},'Synthetic F92 hand-made ACK route','ediel_ack',${literal(gridC)},'production',true,${literal(gridAddress)});
    INSERT INTO public.ediel_route_profiles(id,company_id,communication_route_id,route_name,environment,message_standard,payload_format,is_enabled,is_active,
      sender_ediel_id,receiver_ediel_id,sender_subaddress,sender_sub_address,receiver_subaddress,receiver_sub_address,application_reference,mailbox,smtp_host,smtp_port)
    VALUES(${literal(handProfile)},${literal(companyC)},${literal(handRoute)},'Synthetic F92 hand-made ACK profile','production','edifact','edifact',true,true,
      ${literal(supplierC)},${literal(legal)},${literal(OWN_SUB.PRODAT)},${literal(OWN_SUB.PRODAT)},${literal(GRID_SUB.PRODAT)},${literal(GRID_SUB.PRODAT)},'23-DDQ-PRODAT',${literal(SMTP.from)},${literal(SMTP.host)},${SMTP.port});`)
  const kept = await materialize(companyC, gridC, 'PRODAT')
  expect(kept, JSON.stringify(kept)).toMatchObject({ status: 'materialized', technicalAck: { status: 'materialized',
    routes: [{ applicationReference: '23-DDQ-PRODAT', action: 'kept_existing', communicationRouteId: handRoute, edielRouteProfileId: handProfile }] } })
  expect(ackState(companyC)).toEqual({ routes: 1, profiles: 1, routeIds: [handRoute], profileIds: [handProfile] })
  expect(configuredAckCandidates(companyC, 'CONTRL', inboundUnb(legal, supplierC, 'PRODAT', '23-DDQ-PRODAT'))).toEqual({ routeIds: [handRoute], profileIds: [handProfile] })

  // F98: a registry UTILTS route as published (no message code, like all 507 in production) cannot become an
  // outbound UTILTS business profile, yet every inbound E66 must still be acknowledged. The reply routes are
  // materialized before, and independently of, the business route.
  const companyD = randomUUID(), gridD = randomUUID()
  const [supplierD] = sql<string[]>(`SELECT jsonb_agg(n::text) FROM (SELECT n FROM generate_series(60000,69999) n
    WHERE NOT EXISTS(SELECT FROM public.tenant_actor_identifiers i WHERE i.identifier_type='EdielId' AND i.identifier_value=n::text)
      AND NOT EXISTS(SELECT FROM public.ediel_actor_settings a WHERE a.ediel_id=n::text OR a.actor_ediel_id=n::text) ORDER BY n DESC LIMIT 1) s`)
  sql(`${settings(companyD, supplierD)}
    UPDATE public.platform_actor_routes SET metadata=metadata-'message_code' WHERE id=${literal(byFamily.UTILTS.routeId)} AND actor_id=${literal(actorId)};
    INSERT INTO public.grid_owners(id,company_id,name,ediel_id,environment,is_active,lifecycle_status,platform_market_actor_id)
    VALUES(${literal(gridD)},${literal(companyD)},'Synthetic F92 Nät AB',${literal(legal)},'production',true,'active',${literal(actorId)});`)
  cleanup.push(() => sql(`UPDATE public.grid_owners SET is_active=false WHERE id=${literal(gridD)}`))
  const unpublishedCode = await materializeCompanyGridOwnerRoute({ companyId: companyD, gridOwnerId: gridD, platformActorRouteId: byFamily.UTILTS.routeId,
    messageFamily: 'UTILTS', messageCode: null, environment: 'production', actorUserId: admin })
  expect(unpublishedCode, JSON.stringify(unpublishedCode)).toMatchObject({ status: 'blocked', messageFamily: 'UTILTS', messageCode: null,
    technicalAck: { status: 'materialized', applicationReferences: inboundTechnicalAckApplicationReferences('UTILTS') } })
  expect(unpublishedCode.technicalAck!.routes.map(route => route.action)).toEqual(Array(6).fill('created'))
  for (const app of ['23-DDQ-E66-T', '23-DDQ-E66-S'] as const) for (const reply of ['CONTRL', 'APERAK'] as const) {
    const pair = unpublishedCode.technicalAck!.routes.find(route => route.applicationReference === app)!
    expect(configuredAckCandidates(companyD, reply, inboundUnb(legal, supplierD, 'UTILTS', app)), `${reply} ${app}`)
      .toEqual({ routeIds: [pair.communicationRouteId], profileIds: [pair.edielRouteProfileId] })
  }
  expect(ackState(companyA)).toEqual(before)
}, 300_000)
