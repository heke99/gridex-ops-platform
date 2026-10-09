// The real 2026-10-09 ediel.se export through the installed atomic registry
// owner (retained PGlite harness, same hook pattern as SC057). Proves the full
// file applies, a second identical-content import changes nothing, and the TXT
// export after XML keeps roles/OrgNo and creates no duplicate actors/routes.
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: () => { throw Error('no table access expected') } } }))
import { applyActorRegistryRecords, carryForwardTxtRegistryFacts, decodeRegistryUpload } from '@/lib/actor-registry/importActorRegistry'
import { parseActorRegistryXml } from '@/lib/actor-registry/parseActorRegistryXml'
import { parseActorRegistryTxt } from '@/lib/actor-registry/parseActorRegistryTxt'

type Row = Record<string, unknown>
type Db = { query: (sql: string, args?: unknown[]) => Promise<{ rows: Row[] }>; exec: (sql: string) => Promise<unknown> }
const actorUserId = '00000000-0000-4000-8000-000000000001'
const dir = '__tests__/fixtures/ediel-actor-registry/'
const xmlBytes = readFileSync(dir + 'companies.xml'), txtBytes = readFileSync(dir + 'companies.txt')
const proof: Row = {}

async function probe({ db }: { db: Db }) {
  const service = async (sql: string, args: unknown[]) => { await db.exec('SET ROLE service_role'); try { return (await db.query(sql, args)).rows[0] } finally { await db.exec('RESET ROLE') } }
  io.rpc.mockImplementation(async (name: string, a: Row) => {
    try {
      if (name === 'ediel_read_actor_registry_batch_v1') return { data: (await service('SELECT public.ediel_read_actor_registry_batch_v1($1,$2,$3,$4) data', [a.p_actor_user_id, a.p_source_base64, a.p_source_sha256, a.p_source_kind])).data, error: null }
      if (name === 'ediel_apply_actor_registry_v1') return { data: (await service('SELECT public.ediel_apply_actor_registry_v1($1,$2,$3,$4,$5,$6::jsonb) data', [a.p_actor_user_id, a.p_source_base64, a.p_source_sha256, a.p_source_kind, a.p_source_filename, JSON.stringify(a.p_records)])).data, error: null }
      if (name === 'ediel_read_registry_preview_snapshot_v1') return { data: (await service('SELECT public.ediel_read_registry_preview_snapshot_v1($1,$2::text[]) data', [a.p_actor_user_id, a.p_ediel_ids])).data, error: null }
      throw Error(`unexpected rpc ${name}`)
    } catch (error) { return { data: null, error } }
  })
  const count = async (sql: string) => Number((await db.query(sql)).rows[0].n)
  const counts = async () => ({
    actors: await count('SELECT count(*) n FROM platform_market_actors'),
    edielIds: await count("SELECT count(*) n FROM platform_actor_identifiers WHERE identifier_type='EdielId'"),
    routes: await count('SELECT count(*) n FROM platform_actor_routes'),
    roles: await count('SELECT count(*) n FROM platform_actor_roles'),
    orgs: await count("SELECT count(*) n FROM platform_market_actors WHERE org_number IS NOT NULL"),
  })
  const xmlActors = parseActorRegistryXml(decodeRegistryUpload(xmlBytes, 'companies_xml'))

  // Defect evidence: the unmodified records abort the whole atomic apply.
  const raw = await service('SELECT public.ediel_apply_actor_registry_v1($1,$2,$3,$4,$5,$6::jsonb) data', [actorUserId, Buffer.from('probe').toString('base64'), createHash('sha256').update('probe').digest('hex'), 'companies_xml', 'probe', JSON.stringify(xmlActors.map(a => ({ ...a, certificates: [] })))]).then(() => 'applied', (error: Error) => error.message)
  proof.rawRecords = raw

  const first = await applyActorRegistryRecords({ sourceBytes: xmlBytes, sourceKind: 'companies_xml', sourceFilename: 'companies.xml', actorUserId, actors: xmlActors })
  const afterFirst = await counts()
  // Same content, different bytes (another download): no change at all.
  const again = Buffer.concat([xmlBytes, Buffer.from('\r')])
  const second = await applyActorRegistryRecords({ sourceBytes: again, sourceKind: 'companies_xml', sourceFilename: 'companies-again.xml', actorUserId, actors: parseActorRegistryXml(decodeRegistryUpload(again, 'companies_xml')) })
  const afterSecond = await counts()
  const existingIds = (await db.query('SELECT id FROM platform_market_actors')).rows.map(r => r.id)
  const existingState = async () => (await db.query("SELECT a.id,a.name,a.org_number,(SELECT count(*) FROM platform_actor_routes r WHERE r.actor_id=a.id)::int routes,(SELECT count(*) FROM platform_actor_roles r WHERE r.actor_id=a.id)::int roles FROM platform_market_actors a WHERE a.id=ANY($1::uuid[]) ORDER BY a.id", [existingIds])).rows
  const existingBefore = await existingState()
  const txtActors = parseActorRegistryTxt(decodeRegistryUpload(txtBytes, 'companies_txt'))
  const snapshot = (await service('SELECT public.ediel_read_registry_preview_snapshot_v1($1,$2::text[]) data', [actorUserId, [...new Set(txtActors.flatMap(a => a.edielId ? [a.edielId] : []))]])).data as { actors: Array<{ edielId: string; market: string; roles: string[]; orgNumber: string | null }> }
  const third = await applyActorRegistryRecords({ sourceBytes: txtBytes, sourceKind: 'companies_txt', sourceFilename: 'companies.txt', actorUserId, actors: carryForwardTxtRegistryFacts(txtActors, snapshot.actors) })
  const afterTxt = await counts()
  const existingAfter = await existingState()
  const changedExisting = existingAfter.filter((row, i) => JSON.stringify(row) !== JSON.stringify(existingBefore[i]))
  const heldInXml = new Set(xmlActors.filter(a => a.edielId && !a.countryCode).map(a => a.edielId)).size
  const alvesta = (await db.query("SELECT a.org_number,(SELECT array_agg(actor_role ORDER BY actor_role) FROM platform_actor_roles r WHERE r.actor_id=a.id) roles,(SELECT record->'roles' FROM gridex_registry_import.market_current c JOIN gridex_registry_import.market_records m USING(actor_id,market,source_sha256) WHERE c.actor_id=a.id AND c.market='EL') current_roles FROM platform_market_actors a JOIN platform_actor_identifiers i ON i.actor_id=a.id AND i.identifier_type='EdielId' AND i.identifier_value='16900'")).rows[0]
  const dupRoutes = await count("SELECT count(*) n FROM (SELECT actor_id,registry_market,upper(message_family),environment,coalesce(subaddress,''),lower(communication_address) FROM platform_actor_routes GROUP BY 1,2,3,4,5,6 HAVING count(*)>1) d")
  const dupActors = await count("SELECT count(*) n FROM (SELECT identifier_value FROM platform_actor_identifiers WHERE identifier_type='EdielId' GROUP BY 1 HAVING count(DISTINCT actor_id)>1) d")
  Object.assign(proof, { changedExisting, heldInXml, first, second, third, afterFirst, afterSecond, afterTxt, alvesta, dupRoutes, dupActors })
}

beforeAll(async () => {
  const key = '__realExportRegistryProbe', g = globalThis as unknown as Record<string, unknown>, prior = g[key]
  const temporary = resolve('scripts', `.real-export-owned-${randomUUID()}.mjs`)
  const envKeys = ['EDIEL_PGLITE_MODULE', 'EDIEL_REGISTRY_RECORDED_TXT_UPGRADE', 'EDIEL_REGISTRY_PREREQUISITE_CONTROL', 'EDIEL_REGISTRY_LEGACY_CONTROL'], old = Object.fromEntries(envKeys.map(k => [k, process.env[k]]))
  const file = readFileSync(resolve('scripts/ediel-registry-current-actor-source-sql-regression.mjs'), 'utf8'), marker = ' console.log(`PASS ${count} bounded actual registry'
  expect(file.split(marker)).toHaveLength(2)
  g[key] = probe
  process.env.EDIEL_PGLITE_MODULE = createRequire(import.meta.url).resolve('@electric-sql/pglite')
  for (const k of envKeys.slice(1)) delete process.env[k]
  writeFileSync(temporary, file.replace(marker, ` await globalThis.${key}({db});\n` + marker))
  try { await import(/* @vite-ignore */ pathToFileURL(temporary).href) } finally { unlinkSync(temporary); if (prior === undefined) delete g[key]; else g[key] = prior; for (const k of envKeys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k] } }
}, 180000)

describe('real ediel.se export through the installed atomic registry owner', () => {
  it('unmodified records abort on the duplicated EIC 46X000000000353H (defect evidence)', () => expect(proof.rawRecords).toContain('identifier_owner_conflict'))
  it('applies the full XML once and a same-content re-import changes nothing', () => {
    expect(proof.first).toMatchObject({ reusedExistingRun: false })
    expect((proof.afterFirst as Row).actors).toBe(549)
    expect(proof.second).toMatchObject({ created: 0, updated: 0 })
    expect(proof.afterSecond).toEqual(proof.afterFirst)
  })
  it('TXT after XML keeps roles and OrgNo (also in the current market source) and adds no actor/route', () => {
    // TXT only adds the foreign actors whose XML record was held for a market/postal country conflict.
    expect((proof.third as Row).created).toBe(proof.heldInXml)
    expect(Number((proof.afterTxt as Row).actors) - Number((proof.afterFirst as Row).actors)).toBe(proof.heldInXml)
    expect(proof.changedExisting).toEqual([])
    expect(proof.alvesta).toMatchObject({ org_number: '5565256210', roles: ['grid_owner'], current_roles: ['grid_owner'] })
    expect(proof.dupRoutes).toBe(0); expect(proof.dupActors).toBe(0)
  })
})
