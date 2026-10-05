// masterplan: SC-013
import { beforeEach, expect, it, vi } from 'vitest'
import { EdifactEnvelopeCodec } from '@/lib/ediel/core/edifactEnvelopeCodec'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { resolveInboundTenantForMessage } from '@/lib/ediel/core/tenantResolver'
const io = vi.hoisted(() => ({ rows: {} as Record<string, Array<Record<string, unknown>>>, identity: vi.fn(), events: vi.fn(),
  writes: [] as { table: string; ids: unknown[]; body: Record<string, unknown> }[] }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.events, getEdielMessageById: vi.fn() }))
vi.mock('@/lib/ediel/tenant/sourceLegalContext', () => ({ requireEdielInboundLegalContext: io.identity }))
vi.mock('@/lib/ediel/tenant/resolveInboundTenant', () => ({
  extractMarketActorEdielIdFromRawPayload: () => null,
  inboundLegalReceiverEdielId: (_rawPayload: unknown, receiver: string | null) => receiver ?? null,
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
    single: async () => {
      if (update) {
        const matched = rows()
        io.writes.push({ table, ids: matched.map(row => row.id), body: structuredClone(update) })
        for (const row of matched) Object.assign(row, update)
      }
      return { data: inserted ? { id: 'issue' } : { ...rows()[0], ...update }, error: null }
    },
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
  io.identity.mockReset(); io.identity.mockResolvedValue({ legalActorId: 'actor-b', legalEdielId: 'A', transportEdielId: 'A', actorRole: 'electricity_supplier' }); io.events.mockReset()
  io.writes = []
})
it('qualifies the actual sent original before a stronger mutable transport hint', async () => {
  const result = await resolveInboundTenantForMessage({ actorUserId: 'user', message: ack() })
  expect(result).toMatchObject({ status: 'tenant_resolved', companyId: 'tenant-b' })
  expect(io.identity).toHaveBeenCalledWith('tenant-b', 'source')
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
  io.identity.mockResolvedValue({ legalActorId: 'wrong', legalEdielId: 'OTHER', transportEdielId: 'A', actorRole: 'electricity_supplier' })
  const message = ack(); message.company_id = 'tenant-b'
  io.rows.ediel_messages.find(row => row.id === 'ack')!.company_id = 'tenant-b'
  const result = await resolveInboundTenantForMessage({ actorUserId: 'user', message })
  expect(result).toMatchObject({ companyId: null, message: { company_id: 'tenant-b', business_match_status: 'business_blocked' } })
})

it.each(['APERAK', 'CONTRL'])('SC013 shared mailbox selects actor B for %s with colliding references and leaves all actor A rows intact', async family => {
  // The SDK/identity ports are declared substitutes; physical envelope parsing,
  // global candidate selection and the actual resolver update are production code.
  const originalWire = EdifactEnvelopeCodec.encode({ sender: 'A', receiver: 'B', environment: 'test',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: true, interchangeReference: 'SOURCE-I',
    messages: [{ messageReference: '1', messageTypeToken: 'PRODAT:D:97A:UN:E2SE6A', businessSegments:
      ['BGM+Z03+SOURCE-D+9+AB', 'NAD+FR+A:160:SVK', 'NAD+DO+B:160:SVK', 'LIN+1', 'RFF+LI:SOURCE-T'] }] })
  const actorB = { ...source(), message_family: 'PRODAT', raw_payload: originalWire }
  const beforeB = structuredClone(actorB)
  const actorA = { ...actorB, id: 'source-a', company_id: 'tenant-a',
    raw_payload: originalWire.replace('+A:ZZ+B:ZZ+', '+X:ZZ+Y:ZZ+')
      .replace('NAD+FR+A:', 'NAD+FR+X:').replace('NAD+DO+B:', 'NAD+DO+Y:') }
  const actorACase = { id: 'case-a', company_id: 'tenant-a', source_message_id: actorA.id, status: 'sent', response_payload: null }
  io.rows.ediel_messages = [actorB, actorA, ack() as unknown as Record<string, unknown>]
  io.rows.ediel_business_references.push({ ...io.rows.ediel_business_references[0], source_message_id: actorA.id })
  io.rows.outbound_requests = [actorACase]
  const beforeA = structuredClone({ source: actorA, request: actorACase })
  const message = ack()
  message.raw_payload = EdifactEnvelopeCodec.encode({ sender: 'B', receiver: 'A', environment: 'test',
    applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: false, interchangeReference: 'ACK-I',
    messages: [{ messageReference: '1', messageTypeToken: 'APERAK:D:96A:UN:E2SE6A', businessSegments:
      ['BGM+++34', 'RFF+ACW:SOURCE-D', 'NAD+FR+B:160:SVK', 'NAD+DO+A:160:SVK', 'ERC+100', 'RFF+LI:SOURCE-T'] }] })
  if (family === 'CONTRL') {
    message.message_family = 'CONTRL'
    message.raw_payload = EdifactEnvelopeCodec.encode({ sender: 'B', receiver: 'A', environment: 'test',
      applicationReference: '23-DDQ-PRODAT', acknowledgementRequest: false, interchangeReference: 'ACK-I',
      messages: [{ messageReference: '1', messageTypeToken: 'CONTRL:2:2:UN', businessSegments: ['UCI+SOURCE-I+A:ZZ+B:ZZ+1'] }] })
    io.rows.ediel_business_references = ['source', 'source-a'].map(source_message_id =>
      ({ source_message_id, reference_type: 'UNB_REF', reference_value: 'SOURCE-I' }))
  }
  const result = await resolveInboundTenantForMessage({ actorUserId: 'user', message })
  expect(result).toMatchObject({ status: 'tenant_resolved', companyId: 'tenant-b',
    evidence: expect.arrayContaining([expect.objectContaining({ details: expect.objectContaining({ sourceMessageId: 'source' }) })]) })
  expect(io.identity).toHaveBeenCalledExactlyOnceWith('tenant-b', 'source')
  expect(io.writes).toHaveLength(1)
  expect(io.writes[0]).toMatchObject({ table: 'ediel_messages', ids: ['ack'], body: { company_id: 'tenant-b' } })
  expect({ source: actorA, request: actorACase }).toEqual(beforeA)
  expect(io.rows.ediel_messages.find(row => row.id === 'source')).toEqual(beforeB)
})
