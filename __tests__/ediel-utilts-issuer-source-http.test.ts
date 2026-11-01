// Actual HTTP handlers + schemas + adapters. Authentication/native RPC are
// finite ports; these tests do not attest native permissions or TEST authority.
import { beforeEach, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const port = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/admin/apiGuards', () => ({ requireAdminApiAccess: port.access }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: port.rpc } }))
import { POST as archive, GET as metadata } from '@/app/api/ediel/utilts-issuer-sources/route'
import { POST as review } from '@/app/api/ediel/utilts-issuer-sources/[artifactId]/review/route'
import { ISSUER_SOURCE_BODY_MAX_BYTES } from '@/lib/ediel/utilts/issuerSourceIntake'
import { createHash } from 'node:crypto'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const companyId = id(1), userId = id(2), artifactId = id(3), hash = 'a'.repeat(64), scopeHash = 'b'.repeat(64)
const input = { version: 1, commandId: id(4), environment: 'test', kind: 'test_replay', body: { epochId: id(10), applicationId: id(11), issuanceId: id(12) }, originals: [] }
const receipt = (extra: Record<string, unknown> = {}) => ({ version: 1, commandId: id(4), companyId, environment: 'test', kind: 'test_replay', artifactId, artifactSha256: hash, scopeSha256: scopeHash, status: 'held', assurance: 'custody_only', reasonCodes: ['controlled_policy_unavailable'], reviewId: null, reviewedAt: null, epochId: null, namespaceId: null, issuerVersionId: null, mandateVersionId: null, sourceMessageId: null, sourcePayloadSha256: null, namespaceEpoch: null, issuanceId: null, internetMessageId: null, mimeSha256: null, journalSequence: null, journalHeadSha256: null, testEpochBornAt: null, measurementUsageFrom: null, measurementUsageUntil: null, legalIdentity: [], transportSender: [], retentionArtifactId: null, applicationInventorySha256: null, applicationBindings: [], originals: [], marketActivationGranted: false, productionAuthorityGranted: false, ...extra })
const request = (data: unknown) => new NextRequest('http://localhost/api/ediel/utilts-issuer-sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
const context = { params: Promise.resolve({ artifactId }) }
beforeEach(() => { vi.clearAllMocks(); port.access.mockResolvedValue({ guard: { companyId, userId }, response: null }); port.rpc.mockResolvedValue({ data: receipt(), error: null }) })
it('uses authenticated server actor/company and exact submit permission, preserving missing-policy HOLD', async () => {
  const response = await archive(request(input))
  expect(response.status).toBe(409); expect((await response.json()).reasonCodes).toEqual(['controlled_policy_unavailable'])
  expect(port.access).toHaveBeenCalledExactlyOnceWith({ allOf: ['ediel.utilts_issuer_source.submit'] })
  expect(port.rpc).toHaveBeenCalledExactlyOnceWith('archive_utilts_issuer_source_v1', { p_company_id: companyId, p_actor_user_id: userId, p_submission: input })
  expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('x-content-type-options')).toBe('nosniff')
})
it.each(['actorUserId', 'companyId', 'reviewerUserId', 'approved', 'approvedAt', 'trustPolicy', 'rootKey', 'signatureValid'])('rejects caller %s and never calls the native adapter', async key => {
  expect((await archive(request({ ...input, [key]: true }))).status).toBe(400); expect(port.rpc).not.toHaveBeenCalled()
})
it('checks authentication before touching the body or RPC', async () => {
  port.access.mockResolvedValue({ response: new Response('{}', { status: 403 }) })
  const req = request(input); const reader = vi.spyOn(req.body!, 'getReader')
  expect((await archive(req)).status).toBe(403); expect(reader).not.toHaveBeenCalled(); expect(port.rpc).not.toHaveBeenCalled()
})
it('auth-read failure and missing selected company do not produce source authority', async () => {
  port.access.mockRejectedValueOnce(Error('PRIVATE auth details')); const response = await archive(request(input))
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('PRIVATE')
  port.access.mockResolvedValueOnce({ guard: { companyId: null, userId, isPlatformAdmin: true } }); expect((await archive(request(input))).status).toBe(403)
  expect(port.rpc).not.toHaveBeenCalled()
})
it('rejects declared oversize and malformed UTF-8/JSON without any native write', async () => {
  const tooLarge = request(input); tooLarge.headers.set('content-length', String(ISSUER_SOURCE_BODY_MAX_BYTES + 1))
  expect((await archive(tooLarge)).status).toBe(413)
  for (const body of ['{bad', new Uint8Array([255])]) {
    expect((await archive(new NextRequest('http://localhost', { method: 'POST', body }))).status).toBe(400)
  }
  expect(port.rpc).not.toHaveBeenCalled()
})
it('counts actual streamed bytes without Content-Length', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(ISSUER_SOURCE_BODY_MAX_BYTES)); controller.enqueue(new Uint8Array(1)); controller.close() } })
  const req = new NextRequest('http://localhost', { method: 'POST', body: stream, duplex: 'half' })
  expect((await archive(req)).status).toBe(413); expect(port.rpc).not.toHaveBeenCalled()
})
it.each(['?artifactId=bad', '?artifactId=' + artifactId + '&artifactId=' + artifactId, '?companyId=' + companyId, '?artifactId=' + artifactId + '&include_bytes=true'])('rejects ambiguous or broadened metadata selector %s', async query => {
  expect((await metadata(new NextRequest('http://localhost/' + query))).status).toBe(400); expect(port.rpc).not.toHaveBeenCalled()
})
it('reads only scoped metadata, not original bytes or private native scope', async () => {
  port.rpc.mockResolvedValueOnce({ data: { ...receipt(), originals: [], scope: { opaque: 'PRIVATE SCOPE' } }, error: null })
  const response = await metadata(new NextRequest('http://localhost/?artifactId=' + artifactId))
  expect(response.status).toBe(200); expect(await response.text()).not.toContain('PRIVATE SCOPE')
  expect(port.rpc).toHaveBeenCalledWith('read_utilts_issuer_source_v1', { p_company_id: companyId, p_actor_user_id: userId, p_artifact_id: artifactId, p_include_bytes: false })
})
it('review uses only separate reviewer permission and exact path/hash/command binding', async () => {
  const command = { version: 1, commandId: id(6), decision: 'approve', reason: 'Independent review input', artifactSha256: hash, scopeSha256: scopeHash }
  port.rpc.mockResolvedValueOnce({ data: receipt({ commandId: id(6) }), error: null })
  expect((await review(request(command), context)).status).toBe(409)
  expect(port.access).toHaveBeenCalledWith({ allOf: ['ediel.utilts_issuer_source.review'] })
  expect(port.rpc).toHaveBeenCalledWith('review_utilts_issuer_source_v1', { p_company_id: companyId, p_actor_user_id: userId, p_artifact_id: artifactId, p_review: command })
})
it('maps revoke to the distinct native port; path supplies artifact and caller decision is not native authority', async () => {
  const raw = Buffer.from('COMPONENT withdrawal original'), decisionOriginal = { reference: 'withdrawal', version: '1', uri: 'test:withdrawal', mimeType: 'text/plain', bytesBase64: raw.toString('base64'), sha256: createHash('sha256').update(raw).digest('hex') }
  const command = { version: 1, commandId: id(7), environment: 'test', decision: 'revoke', targetKind: 'epoch', targetId: id(10), decisionOriginal, reason: 'Independent withdrawal input' }
  port.rpc.mockResolvedValueOnce({ data: receipt({ commandId: id(7), status: 'revoked', assurance: 'controlled_test_only', reasonCodes: [], reviewId: id(9), reviewedAt: '2026-11-01T20:00:00Z', epochId: id(10), namespaceId: id(11), issuerVersionId: id(12), mandateVersionId: id(13), testEpochBornAt: '2026-11-01T19:00:00Z', measurementUsageFrom: '2026-01-01T00:00:00Z', measurementUsageUntil: '2027-01-01T00:00:00Z', legalIdentity: ['SYNTHETIC', 'SE1', '89'], transportSender: ['SYNTHETIC'], retentionArtifactId: artifactId, applicationInventorySha256: hash, applicationBindings: [{ applicationReference: 'app', applicationId: id(14), actorUserId: userId, entrySha256: hash }] }), error: null })
  expect((await review(request(command), context)).status).toBe(200)
  const submission = { version: command.version, commandId: command.commandId, environment: command.environment, targetKind: command.targetKind, targetId: command.targetId, decisionOriginal: command.decisionOriginal, reason: command.reason }
  expect(port.rpc).toHaveBeenCalledExactlyOnceWith('revoke_utilts_issuer_source_v1', { p_company_id: companyId, p_actor_user_id: userId, p_submission: { ...submission, artifactId } })
})
it('never exposes native errors or accepts malformed secret-bearing success data', async () => {
  port.rpc.mockResolvedValueOnce({ data: null, error: Error('PRIVATE SQL KEY') })
  const refused = await archive(request(input)); expect(refused.status).toBe(403); expect(await refused.text()).not.toContain('PRIVATE')
  port.rpc.mockResolvedValueOnce({ data: receipt({ status: 'approved', privateMacKey: 'PRIVATE' }), error: null })
  const malformed = await archive(request(input)); expect(malformed.status).toBe(403); expect(await malformed.text()).not.toContain('PRIVATE')
})
