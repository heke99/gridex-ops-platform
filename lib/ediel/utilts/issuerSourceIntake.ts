// Original custody and controlled TEST operations. Native policy, not this
// adapter or a request flag, supplies current actor and independent authority.
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'

export const ISSUER_SOURCE_MAX_BYTES = 8 * 1024 * 1024
export const ISSUER_SOURCE_BODY_MAX_BYTES = Math.ceil(ISSUER_SOURCE_MAX_BYTES / 3) * 4 + 128 * 1024
export const ISSUER_SOURCE_SUBMIT = 'ediel.utilts_issuer_source.submit'
export const ISSUER_SOURCE_REVIEW = 'ediel.utilts_issuer_source.review'
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim() === value, 'canonical text required')
const uuid = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/), commit = z.string().regex(/^[a-f0-9]{40}$/)
const instant = z.string().datetime({ offset: true }), sequence = z.string().regex(/^(0|[1-9][0-9]*)$/)
const environment = z.enum(['test', 'production'])
const role = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)
const mimeType = z.enum(['application/edifact', 'message/rfc822', 'application/json', 'text/plain', 'application/pdf'])
const originalMetadata = z.object({ role, reference: text(2000), version: text(200), uri: text(2000), mimeType, sha256: digest,
  byteLength: z.number().int().positive().max(ISSUER_SOURCE_MAX_BYTES) }).strict()
const originalInput = originalMetadata.omit({ byteLength: true }).extend({ bytesBase64: z.string().min(4).max(Math.ceil(ISSUER_SOURCE_MAX_BYTES / 3) * 4) }).strict()
const application = z.object({ applicationReference: text(200), actorUserId: uuid, repository: text(2000), commit, tree: commit,
  entryPath: text(1024).refine(value => !value.startsWith('/') && !value.includes('\\') && value.split('/').every(part => part !== '..' && part !== '.' && part !== ''), 'relative POSIX entry required'), entrySha256: digest, producerReference: text(2000) }).strict()
const birthBody = z.object({ legalIdentity: z.array(text(200)).min(3).max(8), transportSender: z.array(text(200)).min(1).max(8),
  validUntil: instant, mailboxId: uuid, measurementUsageFrom: instant, measurementUsageUntil: instant, applications: z.array(application).min(1).max(16) }).strict()
const issueBody = z.object({ epochId: uuid, applicationId: uuid, mailboxId: uuid, fromAddress: text(320).regex(/^[\x21-\x7e]+$/), toAddress: text(320).regex(/^[\x21-\x7e]+$/), payloadOriginalRole: z.literal('payload') }).strict()
const envelope = { version: z.literal(1), commandId: uuid, environment, originals: z.array(originalInput).max(16) }
export const issuerSourceSubmission = z.discriminatedUnion('kind', [
  z.object({ ...envelope, kind: z.literal('prospective'), body: birthBody }).strict(),
  z.object({ ...envelope, environment: z.literal('test'), kind: z.literal('test_birth'), body: birthBody }).strict(),
  z.object({ ...envelope, kind: z.literal('history'), body: z.object({ epochId: uuid, sourceMessageId: uuid, currentIssuanceId: uuid, checkpointArtifactId: uuid }).strict() }).strict(),
  z.object({ ...envelope, environment: z.literal('test'), kind: z.literal('test_issue'), body: issueBody }).strict(),
  z.object({ ...envelope, environment: z.literal('test'), kind: z.literal('test_correction'), body: issueBody.extend({ priorIssuanceId: uuid }).strict() }).strict(),
  z.object({ ...envelope, environment: z.literal('test'), kind: z.literal('test_replay'), body: z.object({ epochId: uuid, applicationId: uuid, issuanceId: uuid }).strict() }).strict(),
  z.object({ ...envelope, environment: z.literal('test'), kind: z.literal('test_delete'), body: z.object({ epochId: uuid, applicationId: uuid, issuanceId: uuid, reason: text(2000), retentionArtifactId: uuid }).strict() }).strict(),
  z.object({ ...envelope, environment: z.literal('test'), kind: z.literal('test_retention'), body: z.object({ epochId: uuid, retentionArtifactId: uuid, reason: text(2000) }).strict() }).strict(),
  z.object({ ...envelope, environment: z.literal('test'), kind: z.literal('test_checkpoint'), body: z.object({ epochId: uuid, expectedSequence: sequence, expectedHeadSha256: digest, applicationInventorySha256: digest }).strict() }).strict(),
])
export const issuerSourceReview = z.object({ version: z.literal(1), commandId: uuid, decision: z.enum(['approve', 'hold', 'reject']),
  reason: text(2000), artifactSha256: digest, scopeSha256: digest }).strict()
export const issuerSourceRevoke = z.object({ version: z.literal(1), commandId: uuid, environment, artifactId: uuid,
  targetKind: z.enum(['issuer', 'mandate', 'epoch', 'application']), targetId: uuid, decisionOriginal: originalInput.omit({ role: true }).strict(), reason: text(2000) }).strict()
export const issuerSourceReviewHttp = z.union([issuerSourceReview, issuerSourceRevoke.omit({ artifactId: true }).extend({ decision: z.literal('revoke') }).strict()])
export const issuerSourceArtifactId = uuid
export type IssuerSourceSubmission = z.infer<typeof issuerSourceSubmission>
export type IssuerSourceReview = z.infer<typeof issuerSourceReview>
export type IssuerSourceRevoke = z.infer<typeof issuerSourceRevoke>
type Scope = { companyId: string; actorUserId: string }
const actorScope = z.object({ companyId: uuid, actorUserId: uuid }).strict()
const kinds = z.enum(['prospective', 'history', 'test_birth', 'test_issue', 'test_replay', 'test_correction', 'test_delete', 'test_retention', 'test_checkpoint'])
const applicationBinding = z.object({ applicationReference: text(200), applicationId: uuid, actorUserId: uuid, entrySha256: digest }).strict()
const receipt = z.object({ version: z.literal(1), commandId: uuid, companyId: uuid, environment, kind: kinds, artifactId: uuid,
  artifactSha256: digest, scopeSha256: digest, status: z.enum(['archived', 'issued', 'approved', 'held', 'rejected', 'revoked']),
  assurance: z.enum(['custody_only', 'controlled_test_only']), reasonCodes: z.array(text(200)), reviewId: uuid.nullable(), reviewedAt: instant.nullable(),
  epochId: uuid.nullable(), namespaceId: uuid.nullable(), issuerVersionId: uuid.nullable(), mandateVersionId: uuid.nullable(),
  sourceMessageId: uuid.nullable(), sourcePayloadSha256: digest.nullable(), namespaceEpoch: sequence.nullable(), issuanceId: uuid.nullable(),
  internetMessageId: text(998).nullable(), mimeSha256: digest.nullable(), journalSequence: sequence.nullable(), journalHeadSha256: digest.nullable(),
  testEpochBornAt: instant.nullable(), measurementUsageFrom: instant.nullable(), measurementUsageUntil: instant.nullable(),
  legalIdentity: z.array(text(200)).max(8), transportSender: z.array(text(200)).max(8), retentionArtifactId: uuid.nullable(),
  applicationInventorySha256: digest.nullable(), applicationBindings: z.array(applicationBinding).max(16), originals: z.array(originalMetadata),
  marketActivationGranted: z.literal(false), productionAuthorityGranted: z.literal(false),
})
type Receipt = z.infer<typeof receipt>
const roles: Record<IssuerSourceSubmission['kind'], readonly string[]> = {
  prospective: ['registry', 'legal_decision', 'transport_mandate'], history: [], test_birth: ['test_policy', 'test_mandate', 'test_retention_decision', 'test_application_inventory'],
  test_issue: ['payload'], test_correction: ['payload'], test_replay: [], test_delete: [], test_retention: ['test_retention_decision'], test_checkpoint: ['checkpoint_approval'],
}
function native<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> { const result = schema.safeParse(value); if (!result.success) invalid(); return result.data }
function invalid(): never { throw new Error('utilts_issuer_source_result_unqualified') }
function bytes(value: { bytesBase64: string; sha256: string }): Buffer {
  const raw = Buffer.from(value.bytesBase64, 'base64')
  if (!raw.length || raw.length > ISSUER_SOURCE_MAX_BYTES || raw.toString('base64') !== value.bytesBase64
    || createHash('sha256').update(raw).digest('hex') !== value.sha256) throw new SyntaxError('utilts_issuer_source_bytes_invalid')
  return raw
}
function validateOriginals(input: IssuerSourceSubmission): void {
  const expected = roles[input.kind], actual = input.originals.map(value => value.role)
  if (actual.length !== expected.length || new Set(actual).size !== actual.length || actual.some(value => !expected.includes(value))) throw new SyntaxError('utilts_issuer_source_roles_invalid')
  let total = 0
  for (const original of input.originals) {
    if (original.role === 'payload' ? original.mimeType !== 'application/edifact' : !['application/json', 'text/plain', 'application/pdf'].includes(original.mimeType)) throw new SyntaxError('utilts_issuer_source_mime_invalid')
    total += bytes(original).length
  }
  if (total > ISSUER_SOURCE_MAX_BYTES) throw new SyntaxError('utilts_issuer_source_bytes_invalid')
}
async function call(name: string, params: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabaseService.rpc(name, params)
  if (error) throw error
  return data
}
function bound(result: Receipt, scope: Scope, expected: Partial<Receipt>): void {
  if (result.companyId !== scope.companyId || Object.entries(expected).some(([key, value]) => result[key as keyof Receipt] !== value)) invalid()
  if (['approved', 'issued', 'revoked'].includes(result.status) && (result.environment !== 'test' || result.assurance !== 'controlled_test_only' || result.reasonCodes.length)) invalid()
  if (['approved', 'revoked'].includes(result.status) && (!result.reviewId || !result.reviewedAt || result.kind === 'prospective')) invalid()
  if (['approved', 'issued', 'revoked'].includes(result.status) && (!result.epochId || !result.namespaceId || !result.issuerVersionId || !result.mandateVersionId)) invalid()
  if (result.status === 'approved' && result.kind === 'history' && (!result.sourceMessageId || !result.sourcePayloadSha256 || result.namespaceEpoch === null)) invalid()
  if ((result.status === 'issued' || result.status === 'approved' && result.kind === 'test_checkpoint') && (result.journalSequence === null || !result.journalHeadSha256)) invalid()
  if (result.epochId && (!result.testEpochBornAt || !result.measurementUsageFrom || !result.measurementUsageUntil
    || Date.parse(result.measurementUsageFrom) >= Date.parse(result.measurementUsageUntil)
    || result.legalIdentity.length < 3 || result.transportSender.length < 1 || !result.retentionArtifactId)) invalid()
  if (result.epochId && (!result.applicationInventorySha256 || !result.applicationBindings.length
    || new Set(result.applicationBindings.map(row => row.applicationId)).size !== result.applicationBindings.length
    || new Set(result.applicationBindings.map(row => row.applicationReference)).size !== result.applicationBindings.length)) invalid()
  if (result.status === 'held' && !result.reasonCodes.length) invalid()
}
/** Immutable original archive/controlled operation. A selector, digest or
 * caller actor claim never supplies native policy or reviewer authority. */
export async function archiveUtiltsIssuerSource(input: Scope & IssuerSourceSubmission) {
  const { companyId, actorUserId, ...rawSubmission } = input, scope = actorScope.parse({ companyId, actorUserId })
  const submission = issuerSourceSubmission.parse(rawSubmission)
  validateOriginals(submission)
  const outputSchema = receipt.extend({ originals: z.array(originalMetadata.extend({ bytesBase64: z.string().optional() }).strict()) }).strict()
  const result = native(outputSchema, await call('archive_utilts_issuer_source_v1', { p_company_id: companyId, p_actor_user_id: actorUserId, p_submission: submission }))
  bound(result, scope, { commandId: submission.commandId, kind: submission.kind, environment: submission.environment })
  if (!['archived', 'issued', 'held'].includes(result.status)) invalid()
  if (result.status === 'issued') {
    if (!['test_issue', 'test_replay', 'test_correction'].includes(result.kind) || !result.issuanceId || !result.internetMessageId || !result.mimeSha256) invalid()
    if (result.internetMessageId !== `<${result.issuanceId}@test.gridex.invalid>`) invalid()
    if (submission.kind === 'test_replay' && result.issuanceId !== submission.body.issuanceId) invalid()
    const originals = result.originals?.filter(value => value.role === 'issued_mime')
    if (!originals || originals.length !== 1 || !originals[0].bytesBase64 || originals[0].mimeType !== 'message/rfc822') invalid()
    const original = originals[0], raw = bytes({ bytesBase64: original.bytesBase64!, sha256: original.sha256 })
    const headers = raw.toString('latin1').split('\r\n\r\n', 1)[0].replace(/\r\n[ \t]+/g, ' ')
    const ids = [...headers.matchAll(/^message-id:\s*(.+)$/gim)].map(match => match[1].trim())
    if (raw.length !== original.byteLength || original.sha256 !== result.mimeSha256 || ids.length !== 1 || ids[0] !== result.internetMessageId) invalid()
    if (result.originals!.some(value => value.role !== 'issued_mime')) invalid()
  } else {
    if (result.originals.some(value => value.bytesBase64 !== undefined) || result.originals.length !== submission.originals.length) invalid()
    for (const original of submission.originals) {
      const matches = result.originals.filter(row => row.role === original.role)
      if (matches.length !== 1) invalid()
      const row = matches[0]
      if (row.byteLength !== bytes(original).length || ['reference', 'version', 'uri', 'mimeType', 'sha256'].some(key => row[key as keyof typeof row] !== original[key as keyof typeof original])) invalid()
    }
  }
  return result
}
/** Public metadata projection deliberately omits opaque native scope and all
 * original bytes; SQL secrets are never accepted as unknown response fields. */
export async function readUtiltsIssuerSource(input: Scope & { artifactId: string }) {
  const { companyId, actorUserId, artifactId } = actorScope.extend({ artifactId: uuid }).strict().parse(input)
  const outputSchema = receipt.extend({ originals: z.array(originalMetadata), scope: z.unknown().optional() }).strict()
  const result = native(outputSchema, await call('read_utilts_issuer_source_v1', { p_company_id: companyId, p_actor_user_id: actorUserId, p_artifact_id: artifactId, p_include_bytes: false }))
  bound(result, input, { artifactId })
  const metadata = { ...result }; delete metadata.scope
  return metadata
}
export async function reviewUtiltsIssuerSource(input: Scope & { artifactId: string } & IssuerSourceReview) {
  const { companyId, actorUserId, artifactId, ...rawReview } = input, scope = actorScope.extend({ artifactId: uuid }).strict().parse({ companyId, actorUserId, artifactId })
  const review = issuerSourceReview.parse(rawReview)
  const result = native(receipt.strict(), await call('review_utilts_issuer_source_v1', { p_company_id: companyId, p_actor_user_id: actorUserId, p_artifact_id: artifactId, p_review: review }))
  bound(result, scope, { commandId: review.commandId, artifactId, artifactSha256: review.artifactSha256, scopeSha256: review.scopeSha256 })
  if (!['approved', 'held', 'rejected'].includes(result.status) || review.decision === 'hold' && result.status !== 'held' || review.decision === 'reject' && result.status !== 'rejected') invalid()
  return result
}
export async function revokeUtiltsIssuerSource(input: Scope & IssuerSourceRevoke) {
  const { companyId, actorUserId, ...rawSubmission } = input, scope = actorScope.parse({ companyId, actorUserId })
  const submission = issuerSourceRevoke.parse(rawSubmission)
  if (!['application/json', 'text/plain', 'application/pdf'].includes(submission.decisionOriginal.mimeType)) throw new SyntaxError('utilts_issuer_source_mime_invalid')
  bytes(submission.decisionOriginal)
  const result = native(receipt.strict(), await call('revoke_utilts_issuer_source_v1', { p_company_id: companyId, p_actor_user_id: actorUserId, p_submission: submission }))
  bound(result, scope, { commandId: submission.commandId, artifactId: submission.artifactId, environment: submission.environment })
  if (!['held', 'revoked'].includes(result.status)) invalid()
  return result
}
