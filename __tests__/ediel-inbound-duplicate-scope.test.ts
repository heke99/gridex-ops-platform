// masterplan: ACK-09, AT-ACK-09
import {beforeEach, describe, expect, it, vi} from 'vitest'

const store = vi.hoisted(() => ({rows: [] as Record<string, unknown>[], reads: [] as Array<Array<[string, unknown]>>}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {from: () => {
  const filters: Array<[string, unknown]> = []; store.reads.push(filters)
  const query = {select: () => query, eq: (key: string, value: unknown) => {filters.push([key, value]); return query},
    is: (key: string, value: unknown) => {filters.push([key, value]); return query}, order: () => query,
    limit: async (count: number) => ({data: store.rows.filter(row => filters.every(([key, value]) => row[key] === value)).slice(0, count), error: null}),
    maybeSingle: async () => ({data: store.rows.find(row => filters.every(([key, value]) => row[key] === value)) ?? null, error: null})}
  return query
}}}))
vi.mock('@/lib/ediel/core/ackPolicy', () => ({findExistingAckForSource: vi.fn()}))
import {buildInboundCanonicalIdentity, findInboundDuplicateByCanonicalIdentity} from '@/lib/ediel/core/dedupe'

const identity = (patch: Record<string, unknown> = {}) => buildInboundCanonicalIdentity({companyId: 'tenant-a', environment: 'test',
  receiverEdielId: '12345', applicationReference: 'SUPPLIER', senderEdielId: '54321', interchangeReference: 'SAME', ...patch})
const row = (patch: Record<string, unknown> = {}) => ({id: 'own', direction: 'inbound', company_id: 'tenant-a',
  environment: 'test', receiver_ediel_id: '12345', application_reference: 'SUPPLIER', sender_ediel_id: '54321',
  interchange_reference: 'SAME', mailbox: null, mailbox_message_id: null, ...patch})

beforeEach(() => {store.rows = []; store.reads = []})
describe('inbound duplicate lookup selects its actual tenant and wire scope', () => {
  it('returns the own source even when newer foreign sources share the UNB reference', async () => {
    const own = row(); store.rows = [row({id: 'foreign', company_id: 'tenant-b'}), own]
    expect(await findInboundDuplicateByCanonicalIdentity(identity())).toBe(own)
    expect(store.reads[0]).toEqual(expect.arrayContaining([['company_id', 'tenant-a'], ['environment', 'test'],
      ['receiver_ediel_id', '12345'], ['application_reference', 'SUPPLIER']]))
  })
  it.each([{company_id: 'tenant-b'}, {environment: 'production'}, {receiver_ediel_id: 'other'},
    {application_reference: 'other'}])('never returns a foreign source %j', async patch => {
    store.rows = [row(patch)]
    expect(await findInboundDuplicateByCanonicalIdentity(identity())).toBeNull()
  })
  it('holds two matching originals instead of choosing the newest one', async () => {
    store.rows = [row(), row({id: 'ambiguous'})]
    await expect(findInboundDuplicateByCanonicalIdentity(identity())).rejects.toThrow('ediel_inbound_duplicate_identity_ambiguous')
  })
  it('does not use a global sender reference to choose an unattributed source', async () => {
    store.rows = [row({company_id: null})]
    expect(await findInboundDuplicateByCanonicalIdentity(identity({companyId: null}))).toBeNull()
    expect(store.reads).toHaveLength(0)
  })
  it('preserves null tenant scope for a genuine own mailbox receipt', async () => {
    const own = row({company_id: null, mailbox: 'own@example.invalid', mailbox_message_id: 'same-mail'})
    store.rows = [row({mailbox: 'own@example.invalid', mailbox_message_id: 'same-mail'}), own]
    expect(await findInboundDuplicateByCanonicalIdentity(identity({companyId: null, mailbox: 'own@example.invalid', mailboxMessageId: 'same-mail'}))).toBe(own)
  })
  it('requires a real environment before any privileged duplicate read', async () => {
    await expect(findInboundDuplicateByCanonicalIdentity(identity({environment: null}))).rejects.toThrow('ediel_inbound_duplicate_scope_required')
    expect(store.reads).toHaveLength(0)
  })
})
