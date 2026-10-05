// masterplan: SC-058
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedActorRegistryActor } from '@/lib/actor-registry/types'
import type { CanonicalRouteContext } from '@/lib/ediel/core/routeRegistry'

type Row = Record<string, unknown>
type Probe = {
  db: PGlite
  uid: (value: number) => string
  apply: (bytes: string, records: ParsedActorRegistryActor[]) => Promise<{ routeIds: string[] }>
}
const port = vi.hoisted(() => ({
  read: null as null | ((name: string, args: Row) => Promise<{ data: unknown; error: { message: string } | null }>),
  calls: [] as Array<{ name: string; args: Row }>,
}))
// Only the external Supabase wire is replaced. Its responses come from the
// real current SQL functions, never from a declared source-qualified verdict.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: (name: string, args: Row) => {
    port.calls.push({ name, args: structuredClone(args) })
    if (!port.read) throw Error('SC058 SQL port not initialized')
    return port.read(name, args)
  },
  from: () => { throw Error('Unexpected direct DB access outside SC058 RPC adapter') },
} }))

import { parseActorRegistryXml } from '@/lib/actor-registry/parseActorRegistryXml'
import { readRegistryRouteSource, requireRegistryDispatchSource } from '@/lib/actor-registry/registryMarketSource'
import { requireZ01LegalReceiver } from '@/lib/ediel/prodat/z01LegalParties'

const legal = '76543'
const application = '23-DDQ-PRODAT'
const elEmail = 'sc058-el@example.invalid'
const gasEmail = 'sc058-gas@example.invalid'
const xml = `<Companies>${(['GAS', 'EL'] as const).map(market => `<Company Market="${market}" Country="SE"><Name>Synthetic SC058 network</Name><Key Type="EdielId">${legal}</Key><Role>NetOwner</Role><EDIFACTDetails Type="PRODAT"><ApplicationReference>${application}</ApplicationReference><PartyId>${legal}</PartyId><InterchangePartyId>${legal}</InterchangePartyId><CommunicationAddress Type="SMTP">${market === 'EL' ? elEmail : gasEmail}</CommunicationAddress></EDIFACTDetails></Company>`).join('')}</Companies>`
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
let probe: Probe
let execution: Promise<unknown> | undefined
let release: (() => void) | undefined
let directory: string
let elId: string
let gasId: string
let actorId: string
let scope: { companyId: string; communicationRouteId: string; routeProfileId: string; environment: 'production'; messageFamily: string; applicationReference: string }
let route: CanonicalRouteContext

async function sqlRpc(name: string, args: Row) {
  await probe.db.exec('SET ROLE service_role')
  try {
    const statements: Record<string, { sql: string; values: unknown[] }> = {
      ediel_registry_route_source_v1: {
        sql: 'SELECT public.ediel_registry_route_source_v1($1::uuid) result',
        values: [args.p_route_id],
      },
      ediel_registry_dispatch_source_v1: {
        sql: 'SELECT public.ediel_registry_dispatch_source_v1($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text) result',
        values: [args.p_company_id, args.p_communication_route_id, args.p_route_profile_id, args.p_environment, args.p_message_family, args.p_application_reference],
      },
    }
    const statement = statements[name]
    if (!statement) throw Error(`Unexpected RPC ${name}`)
    return { data: (await probe.db.query<{ result: unknown }>(statement.sql, statement.values)).rows[0].result, error: null }
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }
  } finally {
    await probe.db.exec('RESET ROLE')
  }
}

// Read installed owner definitions verbatim; this fixture loader contains no
// implementation of registry matching, market qualification or dispatch.
function currentFunction(name: string) {
  const migration = readFileSync(resolve('supabase/migrations/20261001103439_ediel_registry_current_actor_source_guards.sql'), 'utf8')
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION gridex_registry_import.${name}(`)
  const end = migration.indexOf('END$$;', start)
  if (start < 0 || end < start) throw Error(`Current SQL fixture definition missing: ${name}`)
  return migration.slice(start, end + 'END$$;'.length)
}

function currentImporterBlock(name: string) {
  const migration = readFileSync(resolve('supabase/migrations/20261001103439_ediel_registry_current_actor_source_guards.sql'), 'utf8')
  const start = migration.indexOf(`DO $${name}$`)
  const terminator = `END $${name}$;`
  const compactTerminator = `END$${name}$;`
  const end = migration.indexOf(terminator, start)
  const compactEnd = migration.indexOf(compactTerminator, start)
  if (start < 0 || end < 0 && compactEnd < 0) throw Error(`Current importer fixture block missing: ${name}`)
  return end >= 0 ? migration.slice(start, end + terminator.length) : migration.slice(start, compactEnd + compactTerminator.length)
}

async function rows(table: string) {
  return (await probe.db.query<Row>(`SELECT t.* FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows
}

async function snapshot() {
  const tables = ['platform_market_actors', 'platform_actor_identifiers', 'platform_actor_roles', 'platform_actor_routes', 'platform_actor_certificates', 'actor_registry_import_runs', 'actor_registry_import_items', 'communication_routes', 'ediel_route_profiles', 'ediel_messages', ...['market_current', 'route_market_current', 'market_records', 'route_market_sources', 'normalized_batches', 'batches'].map(table => `gridex_registry_import.${table}`)]
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(table)])))
}

beforeAll(async () => {
  directory = mkdtempSync(resolve(tmpdir(), 'gridex-sc058-'))
  const hook = resolve(directory, 'probe.mjs')
  writeFileSync(hook, 'export default context => globalThis[Symbol.for("gridex.sc058.sqlProbe")](context)\n')
  let arrive!: (value: Probe) => void
  const arrived = new Promise<Probe>(done => { arrive = done })
  const finished = new Promise<void>(done => { release = done })
  Reflect.set(globalThis, Symbol.for('gridex.sc058.sqlProbe'), async (value: Probe) => { arrive(value); await finished })
  vi.stubEnv('EDIEL_PGLITE_MODULE', resolve('node_modules/@electric-sql/pglite/dist/index.js'))
  vi.stubEnv('EDIEL_REGISTRY_PROBE_MODULE', hook)
  const script = pathToFileURL(resolve('scripts/ediel-registry-market-sql-regression.mjs')).href
  execution = import(/* @vite-ignore */ script)
  probe = await Promise.race([arrived, execution.then(() => { throw Error('Existing SQL probe did not invoke its hook') })])

  // The reusable probe stops at40159. Bring the selected source/dispatch owner
  // to current main103439 while retaining its declared finite graph boundary.
  await probe.db.exec(`CREATE SCHEMA gridex_ediel_ack_replay;
    CREATE FUNCTION gridex_ediel_ack_replay.lock_current_graph_v2() RETURNS void LANGUAGE plpgsql AS $$BEGIN LOCK TABLE auth.users,public.user_profiles,public.admin_users,public.user_roles,public.platform_actor_identifiers IN SHARE MODE;END$$;
    ALTER TABLE public.communication_routes ADD COLUMN is_active boolean DEFAULT true;
    ALTER TABLE public.ediel_route_profiles ADD COLUMN is_active boolean DEFAULT true, ADD COLUMN is_enabled boolean DEFAULT true, ADD COLUMN message_standard text DEFAULT 'edifact', ADD COLUMN payload_format text DEFAULT 'edifact';`)
  for (const name of ['import_graph', 'current_txt', 'import_lock']) await probe.db.exec(currentImporterBlock(name))
  for (const name of ['route_source_v1', 'dispatch_source_v1']) await probe.db.exec(currentFunction(name))
  const records = parseActorRegistryXml(xml)
  expect(records.map(record => [record.market, record.edielId, record.routes[0].communicationAddress])).toEqual([
    ['GAS', legal, gasEmail], ['EL', legal, elEmail],
  ])
  const imported = await probe.apply(xml, records)
  expect(imported.routeIds).toHaveLength(2)
  const sources = (await probe.db.query<{ id: string; actor_id: string; registry_market: string; communication_address: string }>('SELECT id,actor_id,registry_market,communication_address FROM platform_actor_routes WHERE party_id=$1 ORDER BY registry_market', [legal])).rows
  expect(sources.map(source => [source.registry_market, source.communication_address])).toEqual([['EL', elEmail], ['GAS', gasEmail]])
  elId = sources[0].id; gasId = sources[1].id; actorId = sources[0].actor_id
  expect(sources[1].actor_id).toBe(actorId)
  scope = { companyId: probe.uid(5801), communicationRouteId: probe.uid(5802), routeProfileId: probe.uid(5803), environment: 'production', messageFamily: 'PRODAT', applicationReference: application }
  await probe.db.query(`INSERT INTO communication_routes(id,company_id,auth_config,target_email,route_type,environment_type,is_active) VALUES($1,$2,jsonb_build_object('platform_actor_route_id',$3::text,'materialized_from','platform_actor_routes'),$4,'ediel_partner','production',true)`, [scope.communicationRouteId, scope.companyId, elId, elEmail])
  await probe.db.query(`INSERT INTO ediel_route_profiles(id,company_id,communication_route_id,metadata,environment,message_family,transport_type,receiver_ediel_id,application_reference) VALUES($1,$2,$3,jsonb_build_object('platform_actor_route_id',$4::text,'materialized_from','platform_actor_routes'),'production','PRODAT','smtp',$5,$6)`, [scope.routeProfileId, scope.companyId, scope.communicationRouteId, elId, legal, application])
  // Only the independently consumed routing tuple is needed by this actual
  // legal receiver guard. No sender identity/mandate/readiness is asserted.
  route = { companyId: scope.companyId, route: { id: scope.communicationRouteId }, routeRuntime: { route_profile_id: scope.routeProfileId }, environment: 'production', receiverEdielId: legal, receiverMessageSubAddress: null, receiverSubAddress: null } as CanonicalRouteContext
  port.read = sqlRpc
}, 30_000)

afterAll(async () => {
  release?.()
  try { await execution } finally {
    Reflect.deleteProperty(globalThis, Symbol.for('gridex.sc058.sqlProbe'))
    vi.unstubAllEnvs()
    if (directory) rmSync(directory, { recursive: true, force: true })
    port.read = null
  }
}, 30_000)

beforeEach(async () => {
  port.calls = []
  await probe.db.query('UPDATE communication_routes SET auth_config=jsonb_build_object(\'platform_actor_route_id\',$1::text,\'materialized_from\',\'platform_actor_routes\'),target_email=$2 WHERE id=$3', [elId, elEmail, scope.communicationRouteId])
  await probe.db.query('UPDATE ediel_route_profiles SET metadata=jsonb_build_object(\'platform_actor_route_id\',$1::text,\'materialized_from\',\'platform_actor_routes\') WHERE id=$2', [elId, scope.routeProfileId])
})

describe('SC058 actual same-actor market source -> EL dispatch consumer', () => {
  it('uses the current EL SMTP and legal receiver despite GAS appearing first in the physical export', async () => {
    const before = await snapshot()
    const selected = await requireRegistryDispatchSource(scope)
    expect(selected).toMatchObject({ routeId: elId, actorId, market: 'EL', legalEdielId: legal, sourceSha256: hash(xml), wire: { market: 'EL', family: 'PRODAT', address: elEmail, partyId: legal, interchangePartyId: legal } })
    expect(await requireZ01LegalReceiver(route, scope.companyId, application)).toEqual({ legalEdielId: legal, countryCode: 'SE' })
    expect(port.calls.map(call => call.name)).toEqual(['ediel_registry_dispatch_source_v1', 'ediel_registry_route_source_v1', 'ediel_registry_dispatch_source_v1', 'ediel_registry_route_source_v1'])
    expect(port.calls[0].args).toEqual({ p_company_id: scope.companyId, p_communication_route_id: scope.communicationRouteId, p_route_profile_id: scope.routeProfileId, p_environment: 'production', p_message_family: 'PRODAT', p_application_reference: application })
    expect(await snapshot()).toEqual(before)
  })

  it('retains GAS as reference but refuses it as an EL dispatch fallback without altering either market', async () => {
    expect(await readRegistryRouteSource(gasId)).toMatchObject({ market: 'GAS', legalEdielId: legal, wire: { address: gasEmail } })
    await probe.db.query('UPDATE communication_routes SET auth_config=jsonb_build_object(\'platform_actor_route_id\',$1::text),target_email=$2 WHERE id=$3', [gasId, gasEmail, scope.communicationRouteId])
    await probe.db.query('UPDATE ediel_route_profiles SET metadata=jsonb_build_object(\'platform_actor_route_id\',$1::text) WHERE id=$2', [gasId, scope.routeProfileId])
    const before = await snapshot()
    await expect(requireZ01LegalReceiver(route, scope.companyId, application)).rejects.toMatchObject({ message: 'ediel_registry_current_el_route_source_required' })
    expect(await snapshot()).toEqual(before)
  })

  it('refuses a GAS mailbox copied onto an EL route rather than using the first actor address', async () => {
    await probe.db.query('UPDATE communication_routes SET target_email=$1 WHERE id=$2', [gasEmail, scope.communicationRouteId])
    const before = await snapshot()
    await expect(requireRegistryDispatchSource(scope)).rejects.toMatchObject({ message: 'ediel_registry_route_dispatch_source_mismatch' })
    await expect(requireZ01LegalReceiver(route, scope.companyId, application)).rejects.toMatchObject({ message: 'ediel_registry_route_dispatch_source_mismatch' })
    expect(await snapshot()).toEqual(before)
  })

  it('holds absent current EL source while the same actor still has a qualified GAS reference', async () => {
    // Current-map removal is finite fixture input; neither immutable source nor
    // production authority is changed by the actual consumers under test.
    const original = (await probe.db.query<{ source_sha256: string }>('DELETE FROM gridex_registry_import.market_current WHERE actor_id=$1 AND market=\'EL\' RETURNING source_sha256', [actorId])).rows[0]
    try {
      expect(await readRegistryRouteSource(gasId)).toMatchObject({ market: 'GAS', wire: { address: gasEmail } })
      const before = await snapshot()
      await expect(requireZ01LegalReceiver(route, scope.companyId, application)).rejects.toMatchObject({ message: 'ediel_registry_current_el_route_source_required' })
      expect(await snapshot()).toEqual(before)
    } finally {
      await probe.db.query('INSERT INTO gridex_registry_import.market_current(actor_id,market,source_sha256) VALUES($1,\'EL\',$2)', [actorId, original.source_sha256])
    }
  })
})
