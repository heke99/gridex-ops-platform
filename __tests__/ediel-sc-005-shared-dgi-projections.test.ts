// masterplan: SC-003, SC-005
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { EdielProjectionPage } from '@/lib/ediel/services/types'

// The actual HTTP parser, projection adapter and provenance filter are coupled.
// The restricted SQL owner is an explicit finite port; genuine one-source
// storage/disposition/ACK and mission publication are qualified from #497.
const ports = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), table: vi.fn(() => { throw Error('unexpected provider table access') }) }))
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: ports.auth }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: ports.rpc, from: ports.table } }))
import { GET } from '@/app/api/ediel/beneficiary/series/[seriesId]/route'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const provider = uid(1), source = uid(2), series = uid(3), legalProvider = uid(4)
const raw = "UNB+UNOC:3+54321:ZZ+21660:ZZ+261001:1200+SC005SOURCE++++++1'UNH+1+UTILTS:D:25A:UN:E66'"
const sourceHash = createHash('sha256').update(raw).digest('hex')
const period = { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' }
const missions = [
  { company: uid(10), actor: uid(11), grant: uid(12), version: 2, receipt: uid(13), contract: 'a'.repeat(64) },
  { company: uid(20), actor: uid(21), grant: uid(22), version: 3, receipt: uid(23), contract: 'b'.repeat(64) },
] as const
const page = (mission: typeof missions[number]): EdielProjectionPage => ({
  grantId: mission.grant, grantVersion: mission.version, seriesId: series,
  rows: [{ reading_at: '2026-09-15T00:00:00Z', quantity: '0.1234567890123456789' }], next: null,
  consumerReceiptId: mission.receipt,
  provenance: { version: 1, sourceMessageId: source, sourceRawHash: sourceHash, sourceFamily: 'UTILTS', sourceCode: 'E66',
    sourceEnvironment: 'test', sourceRole: 'DGI', sourceApplicationReference: '30-DGI-UTILTS', sourceSenderEdielId: '54321',
    receiverActorId: legalProvider, receiverRole: 'energy_service_company', contractVersion: mission.version,
    contractHash: mission.contract, purpose: 'analysis', fields: ['reading_at', 'quantity'], qualityOrigin: null },
})
const query = (mission: typeof missions[number]) => new URLSearchParams({ grantId: mission.grant,
  grantVersion: String(mission.version), purpose: 'analysis', fields: 'reading_at,quantity', start: period.start, end: period.end })
const request = (q: URLSearchParams) => new NextRequest(`https://example.test/api/ediel/beneficiary/series/${series}?${q}`)
const context = { params: Promise.resolve({ seriesId: series }) }
const selected = (mission: typeof missions[number]) => ports.auth.mockResolvedValue({ guard: { companyId: mission.company, userId: mission.actor } })

beforeEach(() => {
  vi.clearAllMocks(); selected(missions[0])
  ports.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== 'ediel_beneficiary_series_page_v1') throw Error('unexpected upstream/mutation RPC: ' + name)
    const mission = missions.find(m => m.company === args.p_beneficiary_company_id && m.actor === args.p_actor_user_id &&
      m.grant === args.p_grant_id && m.version === args.p_expected_grant_version)
    if (!mission || args.p_purpose !== 'analysis' || args.p_series_id !== series ||
      args.p_start !== period.start || args.p_end !== period.end ||
      JSON.stringify(args.p_fields) !== JSON.stringify(['reading_at', 'quantity'])) {
      return { data: null, error: new Error('current grant outside scope: private owner ' + provider + ' ' + raw) }
    }
    return { data: { ...page(mission), raw_payload: raw, providerCompanyId: provider,
      provenance: { ...page(mission).provenance, privateContract: 'synthetic private contract' } }, error: null }
  })
})

describe('SC005 two scoped API derivatives of the same DGI source', () => {
  it('returns two distinct current grants and receipts for one unchanged source/series without an upstream write or per-beneficiary ACK call', async () => {
    const results: EdielProjectionPage[] = []
    for (const mission of missions) {
      selected(mission)
      const response = await GET(request(query(mission)), context)
      expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store')
      const result = await response.json() as EdielProjectionPage
      expect(result).toEqual(page(mission)); results.push(result)
      expect(Object.keys(result.rows[0]).sort()).toEqual(['quantity', 'reading_at'])
      expect(JSON.stringify(result)).not.toContain(raw); expect(JSON.stringify(result)).not.toContain(provider)
      expect(JSON.stringify(result)).not.toContain('privateContract')
      expect(result.rows[0].quantity).toBe('0.1234567890123456789')
    }
    expect(new Set(results.map(r => r.grantId)).size).toBe(2)
    expect(new Set(results.map(r => r.consumerReceiptId)).size).toBe(2)
    expect(new Set(results.map(r => r.provenance.contractHash)).size).toBe(2)
    expect(results.map(r => [r.seriesId, r.provenance.sourceMessageId, r.provenance.sourceRawHash])).toEqual([
      [series, source, sourceHash], [series, source, sourceHash],
    ])
    expect(ports.rpc.mock.calls.map(([name]) => name)).toEqual(['ediel_beneficiary_series_page_v1', 'ediel_beneficiary_series_page_v1'])
    expect(ports.table).not.toHaveBeenCalled()
    for (const [index, mission] of missions.entries()) expect(ports.rpc.mock.calls[index][1]).toMatchObject({
      p_beneficiary_company_id: mission.company, p_actor_user_id: mission.actor, p_grant_id: mission.grant,
      p_expected_grant_version: mission.version, p_purpose: 'analysis', p_series_id: series,
      p_start: period.start, p_end: period.end, p_fields: ['reading_at', 'quantity'],
    })
  })
  it('does not let K1 use K2 grant or disclose owner/source diagnostics', async () => {
    const response = await GET(request(query(missions[1])), context)
    expect(response.status).toBe(403)
    const text = JSON.stringify(await response.json())
    expect(text).not.toContain(raw); expect(text).not.toContain(provider); expect(text).not.toContain('outside scope')
    expect(ports.rpc).toHaveBeenCalledOnce(); expect(ports.table).not.toHaveBeenCalled()
  })
  it('rejects a wrongly bound private-port success instead of returning another grant', async () => {
    ports.rpc.mockResolvedValue({ data: page(missions[1]), error: null })
    expect((await GET(request(query(missions[0])), context)).status).toBe(403)
  })
  it.each(['purpose', 'start', 'fields'] as const)('denies widening a K grant through %s rather than widening P access', async key => {
    const q = query(missions[0]); q.set(key, key === 'purpose' ? 'billing' : key === 'start' ? '2026-08-01T00:00:00Z' : 'reading_at,quantity,quality')
    const response = await GET(request(q), context)
    expect(response.status).toBe(403); expect(JSON.stringify(await response.json())).not.toContain(raw)
    expect(ports.table).not.toHaveBeenCalled()
  })
  it('an ungranted tenant knowing the same series obtains no source rows', async () => {
    ports.auth.mockResolvedValue({ guard: { companyId: uid(30), userId: uid(31) } })
    const response = await GET(request(query(missions[0])), context)
    expect(response.status).toBe(403); expect(await response.json()).not.toHaveProperty('rows')
  })
  it('a caller cannot select the provider company or its actor through the query', async () => {
    const q = query(missions[0]); q.set('companyId', provider); q.set('actorUserId', uid(32))
    expect((await GET(request(q), context)).status).toBe(400)
    expect(ports.rpc).not.toHaveBeenCalled(); expect(ports.table).not.toHaveBeenCalled()
  })
  it('refuses private source fields inside an allegedly allowed row', async () => {
    const bad = page(missions[0]); bad.rows[0].raw_payload = raw
    ports.rpc.mockResolvedValue({ data: bad, error: null })
    const response = await GET(request(query(missions[0])), context)
    expect(response.status).toBe(403); expect(JSON.stringify(await response.json())).not.toContain(raw)
  })
})
