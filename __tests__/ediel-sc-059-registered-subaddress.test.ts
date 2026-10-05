// masterplan: SC-059
// Frozen named projection -> real typed source consumer/materializer/sender
// selector/actor and route context/fresh guard/UNB codec. Only SDK storage,
// private current-source admission, tenant identity and readiness are finite
// ports. The projection's original hash is linkage, not retained XML custody;
// projection-record hashes below are not native immutable-record hashes.
// No native/legal/production acceptance, SMTP or outbox execution is inferred.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), activeActor: vi.fn(), runtime: vi.fn(),
  identity: vi.fn(), readiness: vi.fn(), safeReadiness: vi.fn(), fallback: vi.fn(),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: io.from, rpc: io.rpc } }))
vi.mock('@/lib/ediel/config', () => ({ getActiveEdielActorSettings: io.activeActor, getEdielRouteRuntimeByCommunicationRouteId: io.runtime }))
vi.mock('@/lib/ediel/tenant/tenantEdielIdentity', () => ({ resolveCanonicalTenantEdielIdentity: io.identity }))
vi.mock('@/lib/ediel/companyRouteReadiness', () => ({ getCompanyGridOwnerRouteReadiness: io.readiness }))
vi.mock('@/lib/ediel/routeProfileProductionReadiness', () => ({ evaluateRouteProfileProductionReadiness: io.safeReadiness }))
vi.mock('@/lib/cis/db-routes', () => ({ findBestCommunicationRoute: io.fallback }))

import { materializeCompanyGridOwnerRoute } from '@/lib/ediel/routeMaterializer'
import { assertFreshBusinessRegistryRouteSource, resolveCanonicalRouteContext } from '@/lib/ediel/core/routeRegistry'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import { segmentComposite, tokenizeEdifact } from '@/lib/ediel/core/edifactTokenizer'
import type { SourceQualifiedRegistryRoute } from '@/lib/actor-registry/registryMarketSource'

type Row = Record<string, unknown>
type Family = 'PRODAT' | 'UTILTS'
type ProjectionRoute = { family: Family; smtp: string; subaddress: string | null; technical_id: string; legal_id: string }
type ProjectionActor = { market: string; name: string; ediel_id: string; roles: string[]; routes: ProjectionRoute[] }
type Snapshot = { sha256: string; not_imported_live: boolean; selected: ProjectionActor[] }
const projectionPath = resolve('docs/ediel/masterplan-v2/registers/registry_snapshot_evidence.json')
const projectionBytes = readFileSync(projectionPath)
const snapshot = JSON.parse(projectionBytes.toString('utf8')) as Snapshot
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const companyId = id(1), gridOwnerId = id(2), actorId = id(3), platformRouteId = id(4)
const writeIds: Record<string, string> = { communication_routes: id(6), ediel_route_profiles: id(7), company_market_party_routes: id(8) }
let tables: Record<string, Row[]>, source: SourceQualifiedRegistryRoute, family: Family, applicationReference: string
let projectionRecord: string, held: boolean, foreignDispatch: boolean, changedCurrentSource: boolean
let writes: Array<{ table: string; row: Row }>, rendered: string[]

// This adapter records the real callers' predicates and payloads. It supplies
// no SQL grants, private source qualification, graph constraints or send rights.
function storage(table: string) {
  if (!(table in tables)) throw Error(`SC059 unprovided storage port:${table}`)
  const filters: Array<[string, unknown]> = []
  let payload: Row | undefined, update = false, bound = Infinity
  let completed: { data: Row | Row[] | null; error: null } | undefined
  const execute = (single: boolean) => {
    if (completed) return completed
    let selected = tables[table].filter(row => filters.every(([key, value]) => row[key] === value)).slice(0, bound)
    if (payload) {
      if (!(table in writeIds)) throw Error(`SC059 forbidden write:${table}`)
      if (update) {
        expect(selected).toHaveLength(1)
        Object.assign(selected[0], structuredClone(payload))
      } else {
        selected = [{ ...structuredClone(payload), id: writeIds[table] }]
        tables[table].push(selected[0])
      }
      writes.push({ table, row: structuredClone(selected[0]) })
    }
    if (single && selected.length > 1) throw Error('SC059 ambiguous finite row')
    completed = { data: single ? selected[0] ?? null : selected, error: null }
    return completed
  }
  const query = {
    select() { return query },
    eq(key: string, value: unknown) { filters.push([key, value]); return query },
    limit(value: number) { bound = value; return query },
    insert(value: Row) { payload = value; return query },
    update(value: Row) { payload = value; update = true; return query },
    async maybeSingle() { return execute(true) },
    async single() { return execute(true) },
    then(onFulfilled: (value: ReturnType<typeof execute>) => unknown, onRejected: (error: unknown) => unknown) {
      return Promise.resolve(execute(false)).then(onFulfilled, onRejected)
    },
  }
  return query
}

function namedActor(edielId: string, name: string) {
  const actor = snapshot.selected.find(row => row.ediel_id === edielId && row.name === name && row.market === 'EL')
  expect(actor).toBeDefined()
  return actor!
}

function selectProjection(edielId: string, name: string, messageFamily: Family) {
  const actor = namedActor(edielId, name)
  const route = actor.routes.find(row => row.family === messageFamily)
  expect(route).toBeDefined()
  family = messageFamily
  // Current business policy input, absent from the frozen registry projection.
  applicationReference = family === 'PRODAT' ? '23-DDQ-PRODAT' : '23-DDQ-E66-S'
  projectionRecord = JSON.stringify({ actor: { ...actor, routes: undefined }, route })
  source = {
    status: 'source_qualified', routeId: platformRouteId, actorId, market: 'EL',
    sourceSha256: snapshot.sha256, sourceRecordSha256: sha(projectionRecord),
    countryCode: 'SE', legalEdielId: route!.legal_id, legalName: actor.name, roles: actor.roles,
    wire: { actorId, market: 'EL', family, environment: 'production', subaddress: route!.subaddress,
      applicationReference: null, address: route!.smtp, transport: 'smtp', partyId: route!.legal_id,
      interchangePartyId: route!.technical_id },
  }
  const own = namedActor('21660', 'Gridex EL AB')
  const ownRoute = own.routes.find(row => row.family === family)!
  tables.platform_actor_routes = [{ id: platformRouteId, actor_id: actorId, message_family: family,
    environment: 'production', status: 'active', is_verified: true, auto_send_allowed: true,
    communication_address: route!.smtp, communication_type: 'smtp', party_id: route!.legal_id,
    interchange_party_id: route!.technical_id, subaddress: route!.subaddress, application_reference: null,
    metadata: { blank_subaddress_requires_review: false, subaddress_status: route!.subaddress === null ? 'not_required_confirmed' : 'registered' } }]
  tables.grid_owners = [{ id: gridOwnerId, company_id: companyId, platform_market_actor_id: actorId, name: actor.name, ediel_id: actor.ediel_id, is_active: true }]
  tables.ediel_actor_settings = [{ id: id(5), company_id: companyId, environment: 'production', is_active: true,
    actor_role: 'supplier', market_roles: ['electricity_supplier', 'energy_service_company'], ediel_id: own.ediel_id,
    sender_name: own.name, sender_subaddress: null, sender_sub_address: null,
    sender_subaddress_prodat: own.routes.find(row => row.family === 'PRODAT')!.subaddress,
    sender_subaddress_utilts: own.routes.find(row => row.family === 'UTILTS')!.subaddress,
    default_application_reference: applicationReference, production_send_lock_enabled: true,
    first_production_send_approved: false, smtp_from_email: ownRoute.smtp, metadata: { message_family: family } }]
}

beforeEach(() => {
  vi.clearAllMocks()
  tables = { platform_actor_routes: [], grid_owners: [], ediel_actor_settings: [], communication_routes: [], ediel_route_profiles: [], company_market_party_routes: [] }
  writes = []; rendered = []; held = false; foreignDispatch = false; changedCurrentSource = false
  io.from.mockImplementation(storage)
  io.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'ediel_registry_route_source_v1') {
      expect(args).toEqual({ p_route_id: platformRouteId })
      return { data: held ? { status: 'held', routeId: platformRouteId, reason: 'declared_missing_current_source' }
        : { ...structuredClone(source), ...(changedCurrentSource ? { sourceRecordSha256: sha('declared changed current projection') } : {}) }, error: null }
    }
    if (name === 'ediel_registry_dispatch_source_v1') {
      expect(args).toEqual({ p_company_id: companyId, p_communication_route_id: id(6), p_route_profile_id: id(7),
        p_environment: 'production', p_message_family: family, p_application_reference: applicationReference })
      return { data: { ...structuredClone(source), companyId: foreignDispatch ? id(99) : companyId,
        communicationRouteId: id(6), routeProfileId: id(7), selectedApplicationReference: applicationReference }, error: null }
    }
    throw Error(`SC059 unprovided RPC:${name}`)
  })
  io.activeActor.mockImplementation(async (environment: string, company: string) => {
    expect([environment, company]).toEqual(['production', companyId])
    return tables.ediel_actor_settings[0]
  })
  io.identity.mockImplementation(async (scope: Row) => {
    expect(scope).toEqual({ companyId, environment: 'production' })
    return { legalEdielId: '21660', transportEdielId: '21660', roleCodes: ['electricity_supplier', 'energy_service_company'], representedByTransportAgent: false }
  })
  io.runtime.mockImplementation(async (routeId: string) => {
    expect(routeId).toBe(id(6))
    const row = tables.ediel_route_profiles[0]
    return { ...row, route_profile_id: row.id }
  })
  io.safeReadiness.mockResolvedValue({ status: 'declared_finite_readiness' })
  io.readiness.mockImplementation(async () => ({ operational_route_ready: true,
    communication_route_id: tables.communication_routes[0]?.id, ediel_route_profile_id: tables.ediel_route_profiles[0]?.id,
    company_market_party_route_id: tables.company_market_party_routes[0]?.id, platform_actor_route_id: platformRouteId, environment: 'production' }))
  io.fallback.mockImplementation(() => { throw Error('SC059 unexpected automatic route fallback') })
})

const materialize = () => materializeCompanyGridOwnerRoute({ companyId, gridOwnerId, platformActorRouteId: platformRouteId,
  messageFamily: family, messageCode: family === 'PRODAT' ? 'Z01' : 'E66', environment: 'production', actorUserId: id(9) })

async function buildContext() {
  return resolveCanonicalRouteContext({ companyId, preferredRouteId: id(6), requestType: family === 'PRODAT' ? 'customer_masterdata' : 'meter_values',
    environment: 'production', messageStandard: 'edifact', applicationReference })
}

// This is a coupled renderer probe, not a substitute outbound implementation.
// Only completion of the real guard followed by the real codec is observed.
async function renderCurrent() {
  const context = await buildContext()
  await assertFreshBusinessRegistryRouteSource(context, family)
  const raw = EdifactEnvelopeCodec.encode({ sender: context.senderEdielId, receiver: context.receiverEdielId,
    senderSubAddress: context.senderSubAddress, receiverSubAddress: context.receiverSubAddress,
    applicationReference: context.applicationReference, environment: context.environment,
    interchangeReference: 'SC0591', acknowledgementRequest: true, createdAt: new Date('2026-09-10T12:00:00Z'),
    messages: [{ messageReference: '1', messageTypeToken: family === 'PRODAT' ? 'PRODAT:D:97A:UN:E2SE6A' : 'UTILTS:D:02B:UN:E5SE5A',
      businessSegments: [`BGM+${family === 'PRODAT' ? 'Z01' : 'E66'}+SC059+9`] }] })
  rendered.push(raw)
  return { context, raw }
}

function assertProjectionUnchanged() {
  expect(readFileSync(projectionPath)).toEqual(projectionBytes)
  expect(sha(projectionBytes)).toBe('2a60f51ca225a1dd21711fa0fc0a29c67528737dd1ea02ee5f25222dff64de2c')
  expect(snapshot.sha256).toBe('e94c3fac98913a113573376d6e0134ce3c5b5778cf6c8c8905dd9174db30d9ab')
  expect(snapshot.not_imported_live).toBe(true)
  expect(source.sourceRecordSha256).toBe(sha(projectionRecord))
}

describe('SC059 registered subaddress with named frozen projection and declared finite ports', () => {
  it.each([
    ['21660', 'Gridex EL AB', 'PRODAT', null], ['21660', 'Gridex EL AB', 'UTILTS', null],
    ['27700', 'Mjölby Kraftnät AB', 'PRODAT', 'PRODAT'], ['27700', 'Mjölby Kraftnät AB', 'UTILTS', null],
  ] as const)('%s %s %s preserves the exact registered %s through actual materialization/context/UNB', async (edielId, name, selectedFamily, subaddress) => {
    selectProjection(edielId, name, selectedFamily)
    expect(await materialize()).toMatchObject({ status: 'materialized', communicationRouteId: id(6), edielRouteProfileId: id(7), companyMarketPartyRouteId: id(8) })
    expect(writes.map(write => write.table)).toEqual(Object.keys(writeIds))
    expect(tables.ediel_route_profiles[0]).toMatchObject({ sender_subaddress: null, sender_sub_address: null,
      receiver_ediel_id: edielId, receiver_subaddress: subaddress, receiver_sub_address: subaddress, counterparty_subaddress: subaddress })
    expect(io.safeReadiness).toHaveBeenCalledWith({ routeProfileId: id(7), actorUserId: id(9), applyFixes: true, approveProduction: false })
    expect(tables.ediel_actor_settings[0].first_production_send_approved).toBe(false)
    const { context, raw } = await renderCurrent()
    expect(context).toMatchObject({ senderEdielId: '21660', senderSubAddress: null, receiverEdielId: edielId,
      receiverSubAddress: subaddress, receiverMessageSubAddress: subaddress, receiverEmail: source.wire.address, routeSelectionSource: 'explicit_route' })
    const tokens = tokenizeEdifact(raw), unb = tokens.segments.find(segment => segment.tag === 'UNB')!
    expect(segmentComposite(unb, 2, tokens.una)).toEqual(['21660', 'ZZ'])
    expect(segmentComposite(unb, 3, tokens.una)).toEqual(subaddress === null ? [edielId, 'ZZ'] : [edielId, 'ZZ', subaddress])
    expect(EdifactEnvelopeCodec.decode(raw)).toMatchObject({ senderSubAddress: null, receiverSubAddress: subaddress, receiver: edielId })
    expect(rendered).toHaveLength(1)
    expect(writes).toHaveLength(3)
    expect(io.fallback).not.toHaveBeenCalled()
    assertProjectionUnchanged()
  })

  it.each(['GRIDEX', 'SCH'])('denies invented %s for the registered empty Gridex PRODAT before rendering or additional writes', async invented => {
    selectProjection('21660', 'Gridex EL AB', 'PRODAT')
    expect(await materialize()).toMatchObject({ status: 'materialized' })
    Object.assign(tables.ediel_route_profiles[0], { receiver_subaddress: invented, receiver_sub_address: invented, counterparty_subaddress: invented })
    const before = structuredClone(writes)
    await expect(renderCurrent()).rejects.toThrow('ediel_registry_dispatch_context_mismatch')
    expect(rendered).toEqual([]); expect(writes).toEqual(before); assertProjectionUnchanged()
  })

  it.each([null, 'GRIDEX', 'SCH'])('denies changing named Mjölby PRODAT to %s without changed source before rendering or additional writes', async replacement => {
    selectProjection('27700', 'Mjölby Kraftnät AB', 'PRODAT')
    expect(await materialize()).toMatchObject({ status: 'materialized' })
    Object.assign(tables.ediel_route_profiles[0], { receiver_subaddress: replacement, receiver_sub_address: replacement, counterparty_subaddress: replacement })
    const before = structuredClone(writes)
    await expect(renderCurrent()).rejects.toThrow('ediel_registry_dispatch_context_mismatch')
    expect(rendered).toEqual([]); expect(writes).toEqual(before); assertProjectionUnchanged()
  })

  it('holds absent current source before any operational write despite declared public verification flags', async () => {
    selectProjection('27700', 'Mjölby Kraftnät AB', 'PRODAT'); held = true
    await expect(materialize()).rejects.toThrow('ediel_registry_current_el_route_source_required')
    expect(writes).toEqual([]); expect(rendered).toEqual([]); expect(io.safeReadiness).not.toHaveBeenCalled()
    assertProjectionUnchanged()
  })

  it('denies a different source actor before any operational write', async () => {
    selectProjection('27700', 'Mjölby Kraftnät AB', 'PRODAT')
    source = { ...source, actorId: id(99), wire: { ...source.wire, actorId: id(99) } }
    await expect(materialize()).rejects.toThrow('ediel_registry_materialization_scope_mismatch')
    expect(writes).toEqual([]); expect(rendered).toEqual([]); assertProjectionUnchanged()
  })

  it.each(['foreign_company', 'changed_current_source'])('denies %s at actual dispatch revalidation before rendering or additional writes', async hostile => {
    selectProjection('27700', 'Mjölby Kraftnät AB', 'PRODAT')
    expect(await materialize()).toMatchObject({ status: 'materialized' })
    foreignDispatch = hostile === 'foreign_company'; changedCurrentSource = hostile === 'changed_current_source'
    const before = structuredClone(writes)
    await expect(renderCurrent()).rejects.toThrow('ediel_registry_dispatch_result_invalid')
    expect(rendered).toEqual([]); expect(writes).toEqual(before); assertProjectionUnchanged()
  })
})
