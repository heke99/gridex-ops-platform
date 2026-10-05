// masterplan: DB-01, AT-DB-01
import { beforeEach, describe, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ tables: [] as string[], writes: [] as { table: string; op: string }[], lookup: vi.fn(), audit: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: vi.fn(async () => ({ userId: 'admin-1' })) }))
vi.mock('@/lib/audit/actionLogger', () => ({ logAdminActionAndUsage: io.audit, logUsageEvent: vi.fn() }))
vi.mock('@/lib/ediel/security/expisoftCertificateDirectory', () => ({ fetchReceiverCertificatesFromExpisoft: io.lookup }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: (table: string) => {
  io.tables.push(table)
  const chain: Record<string, unknown> = {}
  const self = () => chain
  for (const m of ['select', 'eq', 'is', 'in', 'order', 'limit']) chain[m] = self
  chain.maybeSingle = async () => ({ data: null, error: null })
  chain.single = async () => ({ data: { id: 'party-1' }, error: null })
  for (const op of ['insert', 'update', 'upsert', 'delete']) chain[op] = () => { io.writes.push({ table, op }); return chain }
  return chain
} } }))
import { saveEdielPartyRegistryEntryAction } from '@/app/admin/ediel/actors/actions'

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) for (const v of ([] as string[]).concat(value)) data.append(key, v)
  return data
}
beforeEach(() => { io.tables = []; io.writes = []; io.audit.mockReset(); io.lookup.mockReset()
  io.lookup.mockResolvedValue({ lookupEmail: '11900@example.invalid', certificatesFound: 1, certificates: [{ status: 'valid', certificateId: 'cert-1' }], ldapUrl: 'ldap://example.invalid' }) })

describe('DB-01: the party registry creates no parallel route authority', () => {
  it('prohibited: saving a grid owner with SMTP/subaddress never reads or writes ediel_party_addresses', async () => {
    await saveEdielPartyRegistryEntryAction(form({ name: 'Nät AB', edielId: '11900', roles: 'grid_owner', status: 'verified', source: 'manual_verified',
      messageFamily: 'PRODAT', subaddress: 'PRODAT-SE', smtpAddress: '11900@example.invalid', lookupCertificateOnSave: 'true', businessCode: 'Z13', environment: 'production' }))
    expect(io.tables).not.toContain('ediel_party_addresses')
    expect(io.writes.every(w => w.table === 'ediel_parties')).toBe(true)
  })
  it('on_pass: the existing party authority is extended (insert/update of ediel_parties only)', async () => {
    await saveEdielPartyRegistryEntryAction(form({ name: 'Nät AB', edielId: '11900', roles: 'grid_owner' }))
    expect(io.writes).toEqual([{ table: 'ediel_parties', op: 'insert' }])
  })
  it('the receiver certificate lookup still runs from the SMTP address and is recorded in the audit, not as a route', async () => {
    await saveEdielPartyRegistryEntryAction(form({ name: 'Nät AB', edielId: '11900', roles: 'grid_owner', messageFamily: 'PRODAT', subaddress: 'prodat-se', smtpAddress: '11900@example.invalid', lookupCertificateOnSave: 'true' }))
    expect(io.lookup).toHaveBeenCalledWith(expect.objectContaining({ smtpEmail: '11900@example.invalid', edielId: '11900', subaddress: 'PRODAT-SE', partyId: 'party-1' }))
    expect(io.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ certificateLookup: expect.objectContaining({ certificatesFound: 1 }) }) }))
  })
  it('without a lookup request no certificate directory call is made', async () => {
    await saveEdielPartyRegistryEntryAction(form({ name: 'Nät AB', edielId: '11900', roles: 'grid_owner', smtpAddress: '11900@example.invalid' }))
    expect(io.lookup).not.toHaveBeenCalled()
  })
})
