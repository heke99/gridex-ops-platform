// masterplan: IMP-02, AT-IMP-02, IMP-03, AT-IMP-03, SC-058
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: mocks.rpc } }))
import { parseActorRegistryXml } from '@/lib/actor-registry/parseActorRegistryXml'
import { parseActorRegistryTxt } from '@/lib/actor-registry/parseActorRegistryTxt'
import { diffRegistryRecord } from '@/lib/actor-registry/registrySnapshotDiff'
import { requireElRegistryRouteSource, verifyElRegistryActor } from '@/lib/actor-registry/registryMarketSource'
import * as partyRegistry from '@/lib/ediel/partyRegistry'

/* Synthetic registry sources only. The SQL section executes the actual
 * migrations (importer, private market qualifier, EL verifier, dispatch owner)
 * in embedded PostgreSQL through the existing declared fixture
 * scripts/ediel-registry-market-sql-regression.mjs; external readiness and
 * transport ports are declared there. It is not authentic-registry evidence. */

const xml = `<Registry><Market Code="EL" CountryCode="SE"><Company><Name>Synthetic Grid AB</Name><Key Type="EdielId">21660</Key><Key Type="OrgNo">556000-0000</Key><Role>Netowner</Role>
<EDIFACTDetails Type="PRODAT"><SubAddress>grid-prodat</SubAddress><CommunicationAddress Type="SMTP">el-prodat@example.invalid</CommunicationAddress><PartyId IdCodeQualifier="ZZ" IdCodeResponsible="260">21660</PartyId><InterchangePartyId IdCodeQualifier="ZZ">82150</InterchangePartyId></EDIFACTDetails>
<EDIFACTDetails Type="UTILTS"><CommunicationAddress Type="SMTP">el-utilts@example.invalid</CommunicationAddress><PartyId>21660</PartyId><InterchangePartyId>82150</InterchangePartyId></EDIFACTDetails></Company></Market>
<Market Code="GAS" CountryCode="SE"><Company><Name>Synthetic Grid AB</Name><Key Type="EdielId">21660</Key><Key Type="OrgNo">556000-0000</Key><Role>Netowner</Role>
<EDIFACTDetails Type="PRODAT"><CommunicationAddress Type="SMTP">gas-prodat@example.invalid</CommunicationAddress><PartyId>21660</PartyId><InterchangePartyId>21660</InterchangePartyId></EDIFACTDetails></Company></Market></Registry>`

describe('IMP-02 normalization preserves source qualifiers (parser layer)', () => {
  it('condition: keeps market, original code, country, roles, legal vs technical identity, family, subaddress and transport type', () => {
    const [el, gas] = parseActorRegistryXml(xml)
    expect(el).toMatchObject({ market: 'EL', countryCode: 'SE', edielId: '21660', roles: ['grid_owner'] })
    expect(el.raw.originalRoles).toEqual(['Netowner'])
    expect(el.routes.map((r) => [r.messageFamily, r.subaddress, r.communicationType, r.communicationAddress, r.partyId, r.interchangePartyId])).toEqual([
      ['PRODAT', 'grid-prodat', 'SMTP', 'el-prodat@example.invalid', '21660', '82150'],
      ['UTILTS', null, 'SMTP', 'el-utilts@example.invalid', '21660', '82150'],
    ])
    expect(gas).toMatchObject({ market: 'GAS', countryCode: 'SE', edielId: '21660' })
  })
  it('on_pass: GAS is retained as a reference record but is never executable in the EL profile', () => {
    const gas = parseActorRegistryXml(xml)[1]
    expect(gas.routes[0]).toMatchObject({ messageFamily: 'PRODAT', communicationAddress: 'gas-prodat@example.invalid', status: 'blocked', isVerified: false })
  })
  it('on_failure: family qualifiers survive the TXT adapter as separate routes', () => {
    const header = 'Market;CompanyName;SvkId;EdielId;Address1;Address2;PostCode;Place;CountryCode;WebSiteAddress;Type PRODAT;SubAddress;CommunicationAddress;InterchangePartyId;PartyId;Type UTILTS;SubAddress;CommunicationAddress;InterchangePartyId;PartyId'
    const [actor] = parseActorRegistryTxt(header + '\nEL;Synthetic TXT;SYN;12345;Street;;12345;Town;SE;;PRODAT;sub-p;p@example.invalid;54321;12345;UTILTS;;u@example.invalid;54321;12345')
    expect(actor.routes.map((r) => [r.messageFamily, r.subaddress, r.interchangePartyId, r.partyId])).toEqual([['PRODAT', 'sub-p', '54321', '12345'], ['UTILTS', null, '54321', '12345']])
  })
  it('on_failure: same name and organisation number are not a diff join key; only identifier-matched records are compared', () => {
    const base = { name: 'Same name', legalName: 'Same name', market: 'EL', countryCode: 'SE', orgNumber: '5560000000', edielId: '11111', roles: [], routes: [] }
    // identical name/org with a different legal ID still reports nothing merged by name: the
    // diff never rewrites edielId, it only compares declared source fields of a matched actor
    expect(diffRegistryRecord({ ...base, edielId: '22222' }, base)).not.toContain('edielId')
    expect(diffRegistryRecord({ ...base, routes: [{ messageFamily: 'UTILTS', partyId: '11111', interchangePartyId: '11111', communicationAddress: 'x@example.invalid' }] }, { ...base, routes: [{ messageFamily: 'PRODAT', partyId: '11111', interchangePartyId: '11111', communicationAddress: 'x@example.invalid' }] })).toEqual(['routes'])
  })
  it('SC-058 prohibited: the market-less first-match party-route resolver is no longer exported', () => {
    expect((partyRegistry as Record<string, unknown>).resolveEdielPartyRoute).toBeUndefined()
  })
})

describe('IMP-02 EL consumers reject a GAS route (TypeScript consumer layer)', () => {
  const route = '00000000-0000-4000-8000-0000000000aa', actorId = '00000000-0000-4000-8000-0000000000bb', h = 'a'.repeat(64)
  const source = (market: 'EL' | 'GAS') => ({ status: 'source_qualified', routeId: route, actorId, market, sourceSha256: h, sourceRecordSha256: h, countryCode: 'SE', legalEdielId: '21660', roles: ['grid_owner'], wire: { actorId, market, family: 'PRODAT', environment: 'production', subaddress: null, applicationReference: null, address: `${market.toLowerCase()}@example.invalid`, transport: 'smtp', partyId: '21660', interchangePartyId: '82150' } })
  it('on_pass/SC-058: the EL route source returns the EL address', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: source('EL'), error: null })
    expect((await requireElRegistryRouteSource(route)).wire.address).toBe('el@example.invalid')
  })
  it('on_pass/SC-058: a GAS route is not a fallback for an EL message', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: source('GAS'), error: null })
    await expect(requireElRegistryRouteSource(route)).rejects.toThrow('ediel_registry_current_el_route_source_required')
  })
  it('IMP-03 on_failure: manual EL verification never returns auto-send readiness', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { actorId, market: 'EL', autoSendAllowed: true, routeIds: [route] }, error: null })
    await expect(verifyElRegistryActor({ actorUserId: actorId, actorId })).rejects.toThrow('ediel_registry_verify_source_result_invalid')
  })
})

type Ctx = { db: { query: (sql: string) => Promise<{ rows: Array<Record<string, any>> }>; exec: (sql: string) => Promise<unknown> }; apply: (bytes: string, records: unknown[]) => Promise<any>; actor: (ediel: string | null, name?: string, org?: string) => any; uid: (n: number) => string }
const results: Record<string, unknown> = {}

describe('IMP-02 / IMP-03 actual SQL importer and market owner (embedded PostgreSQL)', () => {
  beforeAll(async () => {
    const req = createRequire(import.meta.url)
    process.env.EDIEL_PGLITE_MODULE = req.resolve('@electric-sql/pglite')
    process.env.EDIEL_REGISTRY_PROBE_MODULE = fileURLToPath(new URL('./helpers/edielRegistryProbeBridge.mjs', import.meta.url))
    ;(globalThis as Record<string, unknown>).__edielRegistryProbe = async ({ db, apply, actor, uid }: Ctx) => {
      const one = async (sql: string) => (await db.query(sql)).rows[0]
      const counts = async () => one(`SELECT (SELECT count(*)::int FROM platform_market_actors) actors,(SELECT count(*)::int FROM platform_actor_routes) routes,(SELECT count(*)::int FROM actor_registry_import_runs) runs,(SELECT count(*)::int FROM gridex_registry_import.batches) batches,(SELECT count(*)::int FROM gridex_registry_import.market_records) market_records`)
      const asService = async <T>(fn: () => Promise<T>) => { await db.exec('SET ROLE service_role'); try { return await fn() } finally { await db.exec('RESET ROLE') } }
      const readMarket = (rid: string) => asService(async () => (await one(`SELECT public.ediel_registry_route_source_v1('${rid}') q`)).q)
      const verify = (aid: string, rid: string | null) => asService(async () => (await one(`SELECT public.ediel_verify_registry_el_actor_v1('${uid(1)}','${aid}',${rid ? `'${rid}'` : 'NULL'}) q`)).q)

      // IMP-02 condition: one legal actor, EL (PRODAT with subaddress + distinct technical party, UTILTS) and GAS
      const el = actor('IMP02-LEGAL', 'Synthetic Imp Grid', 'IMP-ORG'); el.roles = ['grid_owner']; el.raw = { originalRoles: ['Netowner'], fixture: true }
      el.routes = [{ ...el.routes[0], subaddress: 'imp-sub', interchangePartyId: 'IMP02-TECH', communicationAddress: 'imp-el-prodat@example.invalid', applicationReference: 'IMP-APP' },
        { ...el.routes[0], messageFamily: 'UTILTS', interchangePartyId: 'IMP02-TECH', communicationAddress: 'imp-el-utilts@example.invalid', applicationReference: 'IMP-U-APP' }]
      const gas = { ...actor('IMP02-LEGAL', 'Synthetic Imp Grid', 'IMP-ORG'), market: 'GAS', roles: ['grid_owner'] }; gas.routes = [{ ...gas.routes[0], communicationAddress: 'imp-gas-prodat@example.invalid', applicationReference: 'IMP-APP' }]
      const before = await counts()
      const first = await apply('IMP SOURCE V1', [el, gas])
      results.first = first
      const aid = (first.actors as Array<{ actorId: string }>)[0].actorId
      results.routes = (await db.query(`SELECT id,registry_market,message_family,subaddress,communication_type,communication_address,party_id,interchange_party_id,application_reference,status,is_verified,auto_send_allowed FROM platform_actor_routes WHERE actor_id='${aid}' ORDER BY registry_market,message_family`)).rows
      results.actor = await one(`SELECT country_code,org_number FROM platform_market_actors WHERE id='${aid}'`)
      results.roles = (await db.query(`SELECT actor_role,metadata->>'market' market FROM platform_actor_roles WHERE actor_id='${aid}'`)).rows
      results.marketRecords = (await db.query(`SELECT market,record->'raw' raw,record->>'countryCode' country FROM gridex_registry_import.market_records WHERE actor_id='${aid}' ORDER BY market`)).rows
      const rows = results.routes as Array<Record<string, any>>
      const elProdat = rows.find((r) => r.registry_market === 'EL' && r.message_family === 'PRODAT')!, gasRoute = rows.find((r) => r.registry_market === 'GAS')!
      results.elSource = await readMarket(elProdat.id); results.gasSource = await readMarket(gasRoute.id)
      results.verifyGas = await verify(aid, gasRoute.id).then(() => 'accepted', (e: Error) => e.message)
      results.verifyEl = await verify(aid, elProdat.id)
      results.afterVerify = (await db.query(`SELECT registry_market,is_verified,auto_send_allowed,status FROM platform_actor_routes WHERE actor_id='${aid}' ORDER BY registry_market,message_family`)).rows

      // IMP-02 on_failure: same name + same org number + different legal ID are two actors
      const twin = await apply('IMP TWIN SOURCE', [actor('IMP02-TWIN', 'Synthetic Imp Grid', 'IMP-ORG')])
      results.twin = { created: twin.created, actors: (await one(`SELECT count(*)::int n FROM platform_market_actors WHERE org_number='IMP-ORG'`)).n }

      // IMP-03 on_pass: idempotent replay of identical bytes creates nothing new
      const mid = await counts()
      const replay = await apply('IMP SOURCE V1', [el, gas])
      results.replay = { reused: replay.reusedExistingRun, sameRun: replay.importRunId === first.importRunId, unchanged: JSON.stringify(await counts()) === JSON.stringify(mid) }
      // IMP-03 on_pass: atomic — a later conflicting record rolls back the whole batch
      await apply('IMP ATOMIC CONFLICT', [actor('IMP03-NEW'), { ...actor('IMP02-LEGAL', 'Conflict', 'OTHER-ORG') }]).then(() => { results.atomic = 'applied' }, (e: Error) => { results.atomic = e.message })
      results.atomicUnchanged = JSON.stringify(await counts()) === JSON.stringify(mid)
      // IMP-03 on_pass: a contradictory address change creates a new route (version) and keeps the old one in review
      await db.exec(`UPDATE platform_actor_routes SET is_verified=true,auto_send_allowed=true,status='active' WHERE id='${elProdat.id}'`)
      const moved = { ...el, routes: [{ ...el.routes[0], communicationAddress: 'imp-el-new@example.invalid' }, el.routes[1]] }
      const second = await apply('IMP SOURCE V2', [moved, gas])
      results.second = second
      results.versions = (await db.query(`SELECT communication_address,status,is_verified,auto_send_allowed FROM platform_actor_routes WHERE actor_id='${aid}' AND registry_market='EL' AND message_family='PRODAT' ORDER BY communication_address`)).rows
      results.oldSource = (await readMarket(elProdat.id)).status
      results.sourceRecords = (await one(`SELECT count(DISTINCT source_sha256)::int n FROM gridex_registry_import.market_records WHERE actor_id='${aid}' AND market='EL'`)).n
      results.countsGrew = { before, after: await counts() }
    }
    await import('../scripts/ediel-registry-market-sql-regression.mjs')
  }, 300000)

  it('IMP-02 condition: preserves market, country, roles, legal/technical identity, family, subaddress, transport and original codes', () => {
    const rows = results.routes as Array<Record<string, unknown>>
    expect(rows.map((r) => [r.registry_market, r.message_family, r.subaddress, r.communication_type, r.party_id, r.interchange_party_id])).toEqual([
      ['EL', 'PRODAT', 'imp-sub', 'smtp', 'IMP02-LEGAL', 'IMP02-TECH'],
      ['EL', 'UTILTS', null, 'smtp', 'IMP02-LEGAL', 'IMP02-TECH'],
      ['GAS', 'PRODAT', null, 'smtp', 'IMP02-LEGAL', 'IMP02-LEGAL'],
    ])
    expect(results.actor).toMatchObject({ country_code: 'SE', org_number: 'IMP-ORG' })
    expect(results.roles).toEqual([{ actor_role: 'grid_owner', market: 'EL' }])
    expect(results.marketRecords).toEqual([
      { market: 'EL', raw: { originalRoles: ['Netowner'], fixture: true }, country: 'SE' },
      { market: 'GAS', raw: { fixture: true }, country: 'SE' },
    ])
  })
  it('IMP-02 on_pass / SC-058: route matching is market-scoped; GAS is a stored blocked reference, never the EL route', () => {
    expect(results.elSource).toMatchObject({ status: 'source_qualified', market: 'EL', legalEdielId: 'IMP02-LEGAL', countryCode: 'SE', wire: { address: 'imp-el-prodat@example.invalid', subaddress: 'imp-sub', interchangePartyId: 'IMP02-TECH', transport: 'smtp' } })
    expect(results.gasSource).toMatchObject({ market: 'GAS', wire: { address: 'imp-gas-prodat@example.invalid' } })
    expect((results.routes as Array<Record<string, unknown>>).find((r) => r.registry_market === 'GAS')).toMatchObject({ status: 'blocked', is_verified: false, auto_send_allowed: false })
    expect(results.verifyGas).toMatch(/current_el_route_source_required/)
    expect(results.afterVerify).toContainEqual({ registry_market: 'GAS', is_verified: false, auto_send_allowed: false, status: 'blocked' })
  })
  it('IMP-02 on_failure: actors are not merged on name/organisation number', () => {
    expect(results.twin).toEqual({ created: 1, actors: 2 })
  })
  it('IMP-03 on_pass: identical import is idempotent (no duplicates, same run)', () => {
    expect(results.replay).toEqual({ reused: true, sameRun: true, unchanged: true })
  })
  it('IMP-03 on_pass: import is atomic — a conflict in a later record leaves nothing behind', () => {
    expect(results.atomic).toMatch(/legal_org_conflict/)
    expect(results.atomicUnchanged).toBe(true)
  })
  it('IMP-03 on_pass / SC-057: a contradictory address change yields a new route version, keeps the old one, and both stay in review', () => {
    expect(results.second).toMatchObject({ reusedExistingRun: false, activation: 'held_pending_current_source_readiness' })
    expect(results.versions).toEqual([
      { communication_address: 'imp-el-new@example.invalid', status: 'needs_review', is_verified: false, auto_send_allowed: false },
      { communication_address: 'imp-el-prodat@example.invalid', status: 'needs_review', is_verified: false, auto_send_allowed: false },
    ])
    expect(results.sourceRecords).toBe(2)
  })
  it('IMP-03 on_failure / AT prohibited: an imported address is not a valid certificate or production readiness', () => {
    expect(results.first).toMatchObject({ activation: 'held_pending_current_source_readiness' })
    expect((results.routes as Array<Record<string, unknown>>).every((r) => r.is_verified === false && r.auto_send_allowed === false)).toBe(true)
    // separation: review (verify) is its own step, and even then auto-send stays off
    expect(results.verifyEl).toMatchObject({ market: 'EL', autoSendAllowed: false })
    expect((results.afterVerify as Array<Record<string, unknown>>).every((r) => r.auto_send_allowed === false)).toBe(true)
  })
})
