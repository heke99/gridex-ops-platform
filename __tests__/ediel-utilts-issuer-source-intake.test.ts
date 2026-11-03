// Finite adapter tests. Mocked native receipts never attest SQL authority or a
// controlled data birth, actual independent review, issuance or market approval.
import { beforeEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn() } }))
import { supabaseService } from '@/lib/supabase/service'
import { archiveUtiltsIssuerSource, readUtiltsIssuerSource, reviewUtiltsIssuerSource, revokeUtiltsIssuerSource, issuerSourceSubmission, ISSUER_SOURCE_MAX_BYTES } from '@/lib/ediel/utilts/issuerSourceIntake'
const rpc = vi.mocked(supabaseService.rpc)
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const scope = { companyId: id(1), actorUserId: id(2) }, artifactId = id(3), hash = 'a'.repeat(64), scopeHash = 'b'.repeat(64)
const sha = (v: Buffer) => createHash('sha256').update(v).digest('hex')
const original = (role: string, raw = Buffer.from('SYNTHETIC COMPONENT INPUT ONLY'), mimeType = 'text/plain') => ({ role, reference: 'component input', version: '1', uri: 'test:component', mimeType, bytesBase64: raw.toString('base64'), sha256: sha(raw) })
const application = { applicationReference: 'component-app', actorUserId: id(2), repository: 'test:repo', commit: 'c'.repeat(40), tree: 'd'.repeat(40), entryPath: 'scripts/issue.ts', entrySha256: hash, producerReference: 'test:producer' }
const birth = () => issuerSourceSubmission.parse({ version: 1, commandId: id(4), environment: 'test', kind: 'test_birth', body: { legalIdentity: ['SYNTHETIC', 'SE1', '89'], transportSender: ['SYNTHETIC'], validUntil: '2027-01-01T00:00:00Z', measurementUsageFrom: '2026-01-01T00:00:00Z', measurementUsageUntil: '2027-01-01T00:00:00Z', mailboxId: id(5), applications: [application] }, originals: ['test_policy', 'test_mandate', 'test_retention_decision', 'test_application_inventory'].map(role => original(role)) })
const metadata = (originals: ReturnType<typeof original>[]) => originals.map(({ bytesBase64, ...value }) => ({ ...value, byteLength: Buffer.from(bytesBase64, 'base64').length }))
const receipt = (extra: Record<string, unknown> = {}) => ({ version: 1, commandId: id(4), companyId: id(1), environment: 'test', kind: 'test_birth', artifactId, artifactSha256: hash, scopeSha256: scopeHash, status: 'archived', assurance: 'custody_only', reasonCodes: [], reviewId: null, reviewedAt: null, epochId: null, namespaceId: null, issuerVersionId: null, mandateVersionId: null, sourceMessageId: null, sourcePayloadSha256: null, namespaceEpoch: null, issuanceId: null, internetMessageId: null, mimeSha256: null, journalSequence: null, journalHeadSha256: null, testEpochBornAt: null, measurementUsageFrom: null, measurementUsageUntil: null, legalIdentity: [], transportSender: [], retentionArtifactId: null, applicationInventorySha256: null, applicationBindings: [], originals: metadata(birth().originals), marketActivationGranted: false, productionAuthorityGranted: false, ...extra })
const respond = (r: unknown) => rpc.mockResolvedValueOnce({ data: r, error: null } as never)
const approved = (extra: Record<string, unknown> = {}) => receipt({ status: 'approved', assurance: 'controlled_test_only', reviewId: id(9), reviewedAt: '2026-11-01T20:00:00Z', epochId: id(10), namespaceId: id(11), issuerVersionId: id(12), mandateVersionId: id(13), testEpochBornAt: '2026-11-01T19:00:00Z', measurementUsageFrom: '2026-01-01T00:00:00Z', measurementUsageUntil: '2027-01-01T00:00:00Z', legalIdentity: ['SYNTHETIC', 'SE1', '89'], transportSender: ['SYNTHETIC'], retentionArtifactId: artifactId, applicationInventorySha256: hash, applicationBindings: [{ applicationReference: application.applicationReference, applicationId: id(14), actorUserId: application.actorUserId, entrySha256: application.entrySha256 }], ...extra })
beforeEach(() => rpc.mockReset())
it('archives exact original bytes once with server-selected actor/company, without a second write', async () => {
  const input = birth(); respond(receipt())
  expect((await archiveUtiltsIssuerSource({ ...scope, ...input })).status).toBe('archived')
  expect(rpc).toHaveBeenCalledExactlyOnceWith('archive_utilts_issuer_source_v1', { p_company_id: scope.companyId, p_actor_user_id: scope.actorUserId, p_submission: input })
})
it.each(['actorUserId', 'companyId', 'approved', 'approvedAt', 'reviewerUserId', 'namespaceEpoch', 'signatureValid', 'rootKey'])('rejects caller authority %s before native writes', async field => {
  const input = { ...birth(), [field]: true }
  expect(issuerSourceSubmission.safeParse(input).success).toBe(false)
  if (!['actorUserId', 'companyId'].includes(field)) {
    await expect(archiveUtiltsIssuerSource({ ...input, ...scope } as never)).rejects.toThrow()
    expect(rpc).not.toHaveBeenCalled()
  }
})
it.each(['', '%%%', 'AB==', 'U1lOVEhFVElD\n'])('rejects invalid/noncanonical original base64 %j without RPC', async bytesBase64 => {
  const input = birth(); input.originals[0] = { ...input.originals[0], bytesBase64 }
  await expect(archiveUtiltsIssuerSource({ ...scope, ...input })).rejects.toThrow(); expect(rpc).not.toHaveBeenCalled()
})
it('verifies every original hash and aggregate byte cap before RPC', async () => {
  const input = birth(); input.originals[0].sha256 = '0'.repeat(64)
  await expect(archiveUtiltsIssuerSource({ ...scope, ...input })).rejects.toThrow('bytes_invalid')
  const large = birth(); large.originals = large.originals.map(o => original(o.role, Buffer.alloc(ISSUER_SOURCE_MAX_BYTES / 2))) as typeof large.originals
  await expect(archiveUtiltsIssuerSource({ ...scope, ...large })).rejects.toThrow('bytes_invalid'); expect(rpc).not.toHaveBeenCalled()
})
it.each([{ field: 'companyId', value: id(99) }, { field: 'commandId', value: id(99) }, { field: 'environment', value: 'production' }, { field: 'kind', value: 'history' }, { field: 'artifactSha256', value: 'bad' }, { field: 'marketActivationGranted', value: true }, { field: 'privateMacKey', value: 'SECRET' }])('rejects misbound native receipt $field', async ({ field, value }) => {
  respond(receipt({ [field]: value })); await expect(archiveUtiltsIssuerSource({ ...scope, ...birth() })).rejects.toThrow('unqualified')
})
it.each([{ field: 'sha256', value: 'f'.repeat(64) }, { field: 'byteLength', value: 1 }, { field: 'reference', value: 'other' }, { field: 'version', value: 'other' }, { field: 'uri', value: 'test:other' }, { field: 'mimeType', value: 'application/pdf' }])('binds archived original $field to independently checked submitted bytes', async ({ field, value }) => {
  const originals = metadata(birth().originals)
  respond(receipt({ originals: [{ ...originals[0], [field]: value }, ...originals.slice(1)] }))
  await expect(archiveUtiltsIssuerSource({ ...scope, ...birth() })).rejects.toThrow('unqualified')
})
it('preserves explicit missing-trust HOLD, does not retry a native exception', async () => {
  respond(receipt({ status: 'held', reasonCodes: ['unsupported_trust_policy'] }))
  expect((await archiveUtiltsIssuerSource({ ...scope, ...birth() })).status).toBe('held')
  rpc.mockRejectedValueOnce(Error('PRIVATE native refusal'))
  await expect(archiveUtiltsIssuerSource({ ...scope, ...birth() })).rejects.toThrow('PRIVATE'); expect(rpc).toHaveBeenCalledTimes(2)
})
it('metadata asks for no bytes and omits opaque native scope', async () => {
  respond({ ...receipt(), originals: [], scope: { internalReference: 'not public' } })
  expect(await readUtiltsIssuerSource({ ...scope, artifactId })).not.toHaveProperty('scope')
  expect(rpc).toHaveBeenCalledWith('read_utilts_issuer_source_v1', { p_company_id: id(1), p_actor_user_id: id(2), p_artifact_id: artifactId, p_include_bytes: false })
  respond({ ...receipt(), originals: [{ ...original('test_policy'), byteLength: 29 }] })
  await expect(readUtiltsIssuerSource({ ...scope, artifactId })).rejects.toThrow('unqualified')
})
it.each([{ artifactId: id(99) }, { sourceMessageId: 'foreign' }, { status: 'approved', assurance: 'controlled_test_only' }, { status: 'held', reasonCodes: [] }])('rejects incomplete or foreign metadata %j', async bad => {
  respond({ ...receipt(bad), originals: [] }); await expect(readUtiltsIssuerSource({ ...scope, artifactId })).rejects.toThrow('unqualified')
})
it('binds independent review command/artifact/scope hashes and accepts only actual complete test approval receipt', async () => {
  const command = { version: 1 as const, commandId: id(6), decision: 'approve' as const, reason: 'Independent component input', artifactSha256: hash, scopeSha256: scopeHash }
  respond(approved({ commandId: id(6) })); expect((await reviewUtiltsIssuerSource({ ...scope, artifactId, ...command })).status).toBe('approved')
  expect(rpc).toHaveBeenLastCalledWith('review_utilts_issuer_source_v1', { p_company_id: id(1), p_actor_user_id: id(2), p_artifact_id: artifactId, p_review: command })
  for (const bad of [{ artifactSha256: 'f'.repeat(64) }, { namespaceId: null }, { environment: 'production' }, { reasonCodes: ['missing_key'] }]) {
    respond(approved({ commandId: id(6), ...bad })); await expect(reviewUtiltsIssuerSource({ ...scope, artifactId, ...command })).rejects.toThrow('unqualified')
  }
})
it('verifies minted MIME bytes, one exact Message-ID and issuer/effect identity before returning issued bytes', async () => {
  const raw = Buffer.from('Message-ID: <00000000-0000-4000-8000-000000000015@test.gridex.invalid>\r\nContent-Type: application/edifact\r\n\r\nSYNTHETIC\r\n')
  const input = issuerSourceSubmission.parse({ version: 1, commandId: id(4), environment: 'test', kind: 'test_issue', body: { epochId: id(10), applicationId: id(14), mailboxId: id(5), fromAddress: 'a@test.invalid', toAddress: 'b@test.invalid', payloadOriginalRole: 'payload' }, originals: [original('payload', Buffer.from('SYNTHETIC'), 'application/edifact')] })
  const issued = { ...approved(), kind: 'test_issue', status: 'issued', reviewId: null, reviewedAt: null, issuanceId: id(15), internetMessageId: '<00000000-0000-4000-8000-000000000015@test.gridex.invalid>', mimeSha256: sha(raw), journalSequence: '1', journalHeadSha256: hash, originals: [{ ...original('issued_mime', raw, 'message/rfc822'), byteLength: raw.length }] }
  respond(issued); expect((await archiveUtiltsIssuerSource({ ...scope, ...input })).status).toBe('issued')
  for (const bad of [{ internetMessageId: '<other@test.invalid>' }, { mimeSha256: 'f'.repeat(64) }, { issuanceId: null }, { journalHeadSha256: null }]) {
    respond({ ...issued, ...bad }); await expect(archiveUtiltsIssuerSource({ ...scope, ...input })).rejects.toThrow('unqualified')
  }
})
it('revoke sends one independently scoped original decision to its separate native RPC', async () => {
  const source = original('decision')
  const decisionOriginal = { reference: source.reference, version: source.version, uri: source.uri, mimeType: 'text/plain' as const, bytesBase64: source.bytesBase64, sha256: source.sha256 }
  const command = { version: 1 as const, commandId: id(7), environment: 'test' as const, artifactId, targetKind: 'epoch' as const, targetId: id(10), decisionOriginal, reason: 'Withdrawal component input' }
  respond(approved({ commandId: id(7), status: 'revoked' })); expect((await revokeUtiltsIssuerSource({ ...scope, ...command })).status).toBe('revoked')
  expect(rpc).toHaveBeenCalledExactlyOnceWith('revoke_utilts_issuer_source_v1', { p_company_id: id(1), p_actor_user_id: id(2), p_submission: command })
})
it('every frozen operation has an exact body and required original role set', async () => {
  const base = birth(), epochId = id(10), applicationId = id(14), issuanceId = id(15), retentionArtifactId = id(16)
  const cases = [
    base,
    { ...base, kind: 'prospective', originals: ['registry', 'legal_decision', 'transport_mandate'].map(role => original(role)) },
    { ...base, kind: 'history', body: { epochId, sourceMessageId: id(17), currentIssuanceId: issuanceId, checkpointArtifactId: id(18) }, originals: [] },
    { ...base, kind: 'test_issue', body: { epochId, applicationId, mailboxId: id(5), fromAddress: 'a@test.invalid', toAddress: 'b@test.invalid', payloadOriginalRole: 'payload' }, originals: [original('payload', Buffer.from('SYNTHETIC'), 'application/edifact')] },
    { ...base, kind: 'test_correction', body: { epochId, applicationId, priorIssuanceId: issuanceId, mailboxId: id(5), fromAddress: 'a@test.invalid', toAddress: 'b@test.invalid', payloadOriginalRole: 'payload' }, originals: [original('payload', Buffer.from('SYNTHETIC'), 'application/edifact')] },
    { ...base, kind: 'test_replay', body: { epochId, applicationId, issuanceId }, originals: [] },
    { ...base, kind: 'test_delete', body: { epochId, applicationId, issuanceId, retentionArtifactId, reason: 'Test tombstone input' }, originals: [] },
    { ...base, kind: 'test_retention', body: { epochId, retentionArtifactId, reason: 'Test retention input' }, originals: [original('test_retention_decision')] },
    { ...base, kind: 'test_checkpoint', body: { epochId, expectedSequence: '1', expectedHeadSha256: hash, applicationInventorySha256: hash }, originals: [original('checkpoint_approval')] },
  ]
  for (const candidate of cases) {
    const input = issuerSourceSubmission.parse(candidate)
    respond(receipt({ originals: metadata(input.originals), kind: input.kind, status: 'held', reasonCodes: ['native_review_required'] }))
    expect((await archiveUtiltsIssuerSource({ ...scope, ...input })).status).toBe('held')
    expect(issuerSourceSubmission.safeParse({ ...candidate, body: { ...candidate.body, approved: true } }).success).toBe(false)
  }
  expect(rpc).toHaveBeenCalledTimes(9)
})
it('closed TEST cannot be selected in production, while prospective production custody remains visibly held', async () => {
  expect(issuerSourceSubmission.safeParse({ ...birth(), environment: 'production' }).success).toBe(false)
  const prospective = issuerSourceSubmission.parse({ ...birth(), environment: 'production', kind: 'prospective', originals: ['registry', 'legal_decision', 'transport_mandate'].map(role => original(role)) })
  respond(receipt({ originals: metadata(prospective.originals), environment: 'production', kind: 'prospective', status: 'held', reasonCodes: ['unsupported_trust_policy'] }))
  expect((await archiveUtiltsIssuerSource({ ...scope, ...prospective })).status).toBe('held')
})
it.each(['missing', 'extra', 'duplicate', 'wrong-mime'] as const)('rejects %s original custody roles before native action', async mode => {
  const input = birth()
  if (mode === 'missing') input.originals.pop()
  if (mode === 'extra') input.originals.push(original('secret_key') as typeof input.originals[number])
  if (mode === 'duplicate') input.originals[1] = input.originals[0]
  if (mode === 'wrong-mime') input.originals[0].mimeType = 'message/rfc822'
  await expect(archiveUtiltsIssuerSource({ ...scope, ...input })).rejects.toThrow(); expect(rpc).not.toHaveBeenCalled()
})
it.each(['../escape.ts', '/absolute.ts', 'a\\b.ts', 'a/./b.ts'])('rejects noncanonical application entry %s as a claim, not a capability', entryPath => {
  const input = birth(); if (input.kind !== 'test_birth') throw Error('test input')
  input.body.applications[0].entryPath = entryPath
  expect(issuerSourceSubmission.safeParse(input).success).toBe(false)
})
