import { beforeEach, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { resolveInboundTenantForMessage } from '@/lib/ediel/core/tenantResolver'
const io = vi.hoisted(() => ({ rows: {} as Record<string, Array<Record<string, unknown>>>, identity: vi.fn(), events: vi.fn() }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.events, getEdielMessageById: vi.fn() }))
vi.mock('@/lib/ediel/tenant/tenantEdielIdentity', () => ({ resolveCanonicalTenantEdielIdentityWithEvidence: io.identity }))
vi.mock('@/lib/ediel/tenant/resolveInboundTenant', () => ({
  extractMarketActorEdielIdFromRawPayload: () => null,
  tenantResolutionForStorage: (resolution: unknown) => resolution,
  resolveInboundTenantFromIdentifiers: async () => ({ status: 'resolved', companyId: 'tenant-a', evidence: [{ companyId: 'tenant-a', source: 'transport_route', score: 200, details: {} }], candidateCompanyIds: ['tenant-a'], reasons: [], warnings: [] }),
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from(table: string) {
  const filters: Array<(row: Record<string, unknown>) => boolean> = []; let update: Record<string, unknown> | null = null; let inserted = false
  const rows = () => (io.rows[table] ?? []).filter(row => filters.every(test => test(row)))
  const result = () => ({ data: rows(), count: rows().length, error: null })
  const chain = { select: () => chain, eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return chain },
    in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return chain },
    limit: () => chain, abortSignal: () => chain, update: (value: Record<string, unknown>) => { update = value; return chain },
    insert: () => { inserted = true; return chain }, maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
    single: async () => ({ data: inserted ? { id: 'issue' } : { ...rows()[0], ...update }, error: null }),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve) }
  return chain
} } }))
function wire(reverse: boolean) {
  return EdifactEnvelopeCodec.encode({ sender: reverse ? 'B' : 'A', receiver: reverse ? 'A' : 'B', environment: 'test', applicationReference: '23-DDQ-E66-T', acknowledgementRequest: false, interchangeReference: reverse ? 'ACK-I' : 'SOURCE-I',
    messages: [{ messageReference: '1', messageTypeToken: reverse ? 'APERAK:D:04A:UN:E5SE5A' : 'UTILTS:D:02B:UN:E5SE5A', businessSegments: reverse
      ? ['BGM+312+ACK-D+9', 'DOC+E66:SVK:260+SOURCE-D', 'NAD+MS+B:SVK:260', 'NAD+MR+A:SVK:260', 'ERC+100::260', 'RFF+DM:ACK-T', 'RFF+ACW:SOURCE-T']
      : ['BGM+E66::260+SOURCE-D+9', 'NAD+MS+A:SVK:260', 'NAD+MR+B:SVK:260', 'IDE+24+SOURCE-T'] }] })
}
const source = () => ({ id: 'source', company_id: 'tenant-b', environment: 'test', direction: 'outbound', message_family: 'UTILTS', raw_payload: wire(false), message_sent_at: '2026-09-30T12:00:00Z' })
const ack = () => ({ id: 'ack', company_id: null, environment: 'test', direction: 'inbound', message_family: 'APERAK', raw_payload: wire(true), parsed_payload: {}, validation_report: {} } as EdielMessageRow)
beforeEach(() => {
  io.rows = { ediel_business_references: [{ source_message_id: 'source', reference_type: 'BGM_REF', reference_value: 'SOURCE-D' }], ediel_messages: [source(), ack() as unknown as Record<string, unknown>] }
  io.identity.mockReset(); io.identity.mockResolvedValue({ identity: { legalActorId: 'actor-b', legalEdielId: 'A', transportEdielId: 'A', roleCodes: ['electricity_supplier'] }, evidence: {} }); io.events.mockReset()
})
it('qualifies the actual sent original before a stronger mutable transport hint', async () => {
  const result = await resolveInboundTenantForMessage({ actorUserId: 'user', message: ack() })
  expect(result).toMatchObject({ status: 'tenant_resolved', companyId: 'tenant-b' })
  expect(io.identity).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'tenant-b', requireExactCounts: true }))
})
it('a shared mailbox hint cannot authorize an invalid original scope', async () => {
  const message = ack(); message.raw_payload = message.raw_payload!.replace('ACW:SOURCE-T', 'ACW:OTHER')
  expect(await resolveInboundTenantForMessage({ actorUserId: 'user', message })).toMatchObject({ status: 'tenant_not_found', companyId: null })
})
it('detects shared legal actor cross-tenant collisions globally before supplied company filtering', async () => {
  io.rows.ediel_messages.push({ ...source(), id: 'other', company_id: 'tenant-a' })
  io.rows.ediel_business_references.push({ ...io.rows.ediel_business_references[0], source_message_id: 'other' })
  const message = ack(); message.company_id = 'tenant-b'
  expect(await resolveInboundTenantForMessage({ actorUserId: 'user', message })).toMatchObject({ companyId: null })
  expect(io.identity).not.toHaveBeenCalled()
})
it('holds a valid physical original when local identity disagrees without reassigning sealed company provenance', async () => {
  io.identity.mockResolvedValue({ identity: { legalActorId: 'wrong', legalEdielId: 'OTHER', transportEdielId: 'A', roleCodes: ['electricity_supplier'] }, evidence: {} })
  const message = ack(); message.company_id = 'tenant-b'
  io.rows.ediel_messages.find(row => row.id === 'ack')!.company_id = 'tenant-b'
  const result = await resolveInboundTenantForMessage({ actorUserId: 'user', message })
  expect(result).toMatchObject({ companyId: null, message: { company_id: 'tenant-b', business_match_status: 'business_blocked' } })
})
