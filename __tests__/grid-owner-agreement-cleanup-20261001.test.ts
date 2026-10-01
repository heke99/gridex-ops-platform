import { beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ rpc: vi.fn(), remove: vi.fn(), buckets: [] as string[], token: '' }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: f.rpc,
  storage: { from: (bucket: string) => { f.buckets.push(bucket); return { remove: f.remove } } },
} }))
import { POST } from '@/app/api/internal/grid-owner-agreements/cleanup/route'
import { processAgreementCleanup } from '@/lib/routes/gridOwnerAgreementCleanup'
const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0')
const secret = 'owned-private-cleanup-test-secret-20261001'
function receipt(token = f.token) {
  return { uploadIntentId: id(11), companyId: id(1), actorUserId: id(3), claimToken: token, attempt: 1,
    bucket: 'grid-owner-agreements', path: id(1) + '/' + id(7) + '/' + id(11) + '-owned.pdf',
    fileSha256: 'a'.repeat(64), leaseExpiresAt: Math.floor(Date.now() / 1000) + 120 }
}
function request(body: unknown = { companyId: id(1), limit: 1 }, authorization = 'Bearer ' + secret) {
  return new Request('http://127.0.0.1:3000/api/internal/grid-owner-agreements/cleanup', { method: 'POST', headers: { 'content-type': 'application/json', authorization }, body: JSON.stringify(body) })
}
beforeEach(() => {
  vi.clearAllMocks(); f.buckets = []; f.token = ''; process.env.GRIDEX_AGREEMENT_CLEANUP_SECRET = secret
  f.remove.mockResolvedValue({ error: null })
  f.rpc.mockImplementation(async (name: string, params: Record<string, unknown>) => {
    if (name === 'gridex_claim_agreement_cleanup_v1') { f.token = params.p_claim_token as string; return { data: [receipt()], error: null } }
    return { data: name === 'gridex_validate_agreement_cleanup_v1' ? true : { finished: true, replayed: false }, error: null }
  })
})
describe('actual internal agreement cleanup route and consumer', () => {
  it.each([undefined, 'short'])('requires its exact dedicated configured secret before DB', async configured => {
    if (configured === undefined) delete process.env.GRIDEX_AGREEMENT_CLEANUP_SECRET; else process.env.GRIDEX_AGREEMENT_CLEANUP_SECRET = configured
    expect((await POST(request())).status).toBe(503); expect(f.rpc).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled()
  })
  it.each(['', 'Bearer wrong-current-secret', 'Basic ' + secret])('denies anonymous/foreign credentials before DB', async authorization => {
    expect((await POST(request(undefined, authorization))).status).toBe(401); expect(f.rpc).not.toHaveBeenCalled()
  })
  it.each([{ limit: 1 }, { companyId: id(1), limit: 11 }, { companyId: id(1), bucket: 'foreign' }, { companyId: id(1), actorUserId: id(3) }])('denies implicit global sweep, excessive limit and supplied authority/object fields', async body => {
    expect((await POST(request(body))).status).toBe(422); expect(f.rpc).not.toHaveBeenCalled()
  })
  it('derives a new claim token, verifies current lease and deletes only the exact DB receipt', async () => {
    const response = await POST(request())
    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ result: { claimed: 1, removed: 1, retried: 0, stale: 0, errors: 0 } })
    expect(f.token).toMatch(/^[0-9a-f-]{36}$/)
    expect(f.rpc.mock.calls.map(call => call[0])).toEqual(['gridex_claim_agreement_cleanup_v1', 'gridex_validate_agreement_cleanup_v1', 'gridex_finish_agreement_cleanup_v1'])
    expect(f.buckets).toEqual(['grid-owner-agreements']); expect(f.remove).toHaveBeenCalledWith([receipt().path])
  })
  it('NULL explicitly scopes only genuine global rows', async () => {
    f.rpc.mockImplementation(async name => name === 'gridex_claim_agreement_cleanup_v1' ? { data: [], error: null } : { data: true, error: null })
    await processAgreementCleanup({ companyId: null, limit: 1 })
    expect(f.rpc).toHaveBeenCalledWith('gridex_claim_agreement_cleanup_v1', expect.objectContaining({ p_company_id: null, p_limit: 1 }))
    expect(f.remove).not.toHaveBeenCalled()
  })
  it.each(['company', 'token', 'bucket', 'path', 'expired', 'duplicate'])('rejects malformed/foreign %s claim receipts before Storage', async change => {
    f.rpc.mockImplementation(async (_name, params) => {
      f.token = params.p_claim_token
      const row = receipt()
      if (change === 'company') row.companyId = id(2)
      if (change === 'token') row.claimToken = id(40)
      if (change === 'bucket') row.bucket = 'customer-support-quarantine'
      if (change === 'path') row.path = '../foreign.pdf'
      if (change === 'expired') row.leaseExpiresAt = 1
      return { data: change === 'duplicate' ? [row, row] : [row], error: null }
    })
    await expect(processAgreementCleanup({ companyId: id(1), limit: 2 })).rejects.toThrow('agreement_cleanup_unavailable')
    expect(f.remove).not.toHaveBeenCalled()
  })
  it('does not delete after current lease or reference validation denies', async () => {
    f.rpc.mockImplementation(async (name, params) => {
      if (name === 'gridex_claim_agreement_cleanup_v1') { f.token = params.p_claim_token; return { data: [receipt()], error: null } }
      return { data: false, error: null }
    })
    expect(await processAgreementCleanup({ companyId: id(1) })).toMatchObject({ stale: 1, removed: 0 })
    expect(f.remove).not.toHaveBeenCalled()
  })
  it('records Storage failure as durable retry, without claiming removal', async () => {
    f.remove.mockRejectedValue(new Error('PRIVATE_STORAGE_OUTCOME'))
    expect(await processAgreementCleanup({ companyId: id(1) })).toMatchObject({ removed: 0, retried: 1 })
    expect(f.rpc).toHaveBeenLastCalledWith('gridex_finish_agreement_cleanup_v1', expect.objectContaining({ p_outcome: 'retry' }))
  })
  it('does not claim confirmed removal when finish CAS is stale or unavailable', async () => {
    f.rpc.mockImplementation(async (name, params) => {
      if (name === 'gridex_claim_agreement_cleanup_v1') { f.token = params.p_claim_token; return { data: [receipt()], error: null } }
      return name === 'gridex_validate_agreement_cleanup_v1' ? { data: true, error: null } : { data: null, error: { message: 'PRIVATE_FINISH_UNCERTAINTY' } }
    })
    expect(await processAgreementCleanup({ companyId: id(1) })).toMatchObject({ removed: 0, errors: 1 })
  })
  it('returns constant private failure without database/role/path/secret canaries', async () => {
    f.rpc.mockRejectedValue(new Error('PRIVATE_ROLE_SQL_PATH_SECRET'))
    const response = await POST(request())
    expect(response.status).toBe(503); expect(await response.text()).toBe('{"error":"agreement_cleanup_unavailable"}')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })
  it('refuses streamed body overflow before SQL', async () => {
    expect((await POST(request({ companyId: id(1), padding: 'x'.repeat(600) }))).status).toBe(422)
    expect(f.rpc).not.toHaveBeenCalled()
  })
})
