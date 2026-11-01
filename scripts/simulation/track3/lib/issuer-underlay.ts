// Controlled TEST producer, invoked only by its separately admitted runtime.
// Fixture foundation is not issuer authority. Every authority mutation uses the
// authenticated ordinary HTTP API; the service client is foundation/read only.
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync, lstatSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createServerClient } from '@supabase/ssr'
import { z } from 'zod'
import { Evidence } from './evidence'
import { adminClient, lit, sqlJson, newRunContext } from './seed.mjs'
import { buildE02Utilts } from './e02-edifact'
import { buildEdifactMime } from './mime'
import { appendToInbox } from './counterparty'
import { triggerInbound } from './app'
import { E02OutboxAdmission } from './e02-outbox'
import type { InboundEngineRunResult } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'

export async function issuerAuthorityFingerprint(query: (statement: string) => unknown | Promise<unknown> = sqlJson) {
  return Promise.all(['namespaces', 'issuer_versions', 'transport_mandate_versions', 'source_absence_grounds'].map(table => query(`SELECT encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),'[]')::text,'UTF8')),'hex') FROM gridex_utilts_issuer.${table} x`)))
}

export function buildUnapprovedChallenge(raw: string, to: string, prefix: string) {
  return buildEdifactMime({ from: 'prebirth-challenge@t3.sim.invalid', to, subject: `PREBIRTH_CHALLENGE ${prefix}`, raw, placement: 'inline' })
}

export const UNDERLAY_NAMES = [
  'IU01 actual actors and denied access are independently observed',
  'IU02 separate unapproved physical challenge stays held and is never retrofitted',
  'IU03 independent birth creates only a new controlled TEST epoch',
  'IU04 two registered applications issue distinct retained originals',
  'IU05 exact issued MIME reaches ordinary physical source admission',
  'IU06 independent checkpoint and source history qualify the exact admitted issuance',
  'IU07 replay retains issuance while equal-payload new issuance preserves collisions',
  'IU08 correction and tombstone retention preserve prior identifiers',
  'IU09 revocation holds subsequent operations without rewriting originals',
  'IU10 actual outputs and private evidence remain complete and unchanged',
] as const
export const UNDERLAY_MATRIX = {
  schema: 'controlled-test-issuer-underlay-matrix-v2', purpose: 'controlled_issuer_underlay', environment: 'test', assurance: 'controlled_test_only',
  marketActivationGranted: false, productionAuthorityGranted: false,
  requiredEvidence: ['actual_auth_actor_and_own_permission_foundation', 'denied_actor_http_and_unchanged_authority', 'separate_unapproved_physical_challenge_hold_and_no_retrofit',
    'new_birth_originals_and_independent_review', 'two_application_inventory_and_issuance_journal', 'issued_mime_tls_append_and_ordinary_source_binding',
    'independent_checkpoint_and_exact_source_history', 'replay_identity_and_equal_payload_distinct_issuance', 'correction_tombstone_retention_identifier_preservation',
    'revocation_future_hold_and_immutable_originals', 'actual_effect_ids_hashes_and_complete_private_manifest', 'three_active_clean_delivery_sources_with_current_qualified_history'],
  nativeAcceptance: 'requires_independent_actual_output_reviews',
} as const
const text = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.-]+$/)
export const underlayInput = z.object({ schema: z.literal('track3-controlled-issuer-underlay-input-v2'), runLabel: z.string().regex(/^[a-zA-Z0-9_-]{1,24}$/),
  validityHours: z.number().int().min(1).max(24), measurementUsageFrom: z.string().datetime({ offset: true }), measurementUsageUntil: z.string().datetime({ offset: true }),
  periodStart: z.string().regex(/^[0-9]{12}$/), quantity: z.string().regex(/^[0-9]+(?:\.[0-9]{1,4})?$/), meteringPoint: z.string().regex(/^[0-9]{18}$/),
  deliveryLegalIdentity: z.array(text).min(3).max(8), negativeLegalIdentity: z.array(text).min(3).max(8), legalIdentity: z.array(text).min(3).max(8), transportSender: z.array(text).min(1).max(8),
}).strict()
type Input = z.infer<typeof underlayInput>
type Row = Record<string, unknown>
export type ActorName = 'A' | 'B' | 'R' | 'D'
export type Foundation = { companyId: string; mailboxId: string; receiver: string; actors: Record<ActorName, { id: string; email: string }>; applications: Row[] }
type Http = { status: number; body: unknown }
export type UnderlayPorts = {
  input: Input; prefix: string; evidence: Pick<Evidence, 'save' | 'observe'>
  preflight: () => Promise<void>; foundation: () => Promise<Foundation>; cleanup: () => Promise<void>
  http: (actor: ActorName, path: string, body?: unknown) => Promise<Http>
  fingerprint: () => Promise<unknown>; reviewerProof: () => Promise<Row>; challenge: (raw: string) => Promise<Row>; receive: (issued: Row, replay: boolean, originalPayload: string) => Promise<Row>
  issuer: (sourceId: string) => Promise<Row>; immutable: (sourceId: string) => Promise<unknown>
}
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
function need(value: unknown, reason: string): asserts value { if (!value) throw new Error(`T3_UNDERLAY_PRECONDITION: ${reason}`) }
function row(value: unknown): Row { need(value && typeof value === 'object' && !Array.isArray(value), 'object receipt required'); return value as Row }
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b) }
function original(role: string, data: unknown) {
  const bytes = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data))
  return { role, reference: 'CONTROLLED SYNTHETIC TEST original', version: '1', uri: `test:issuer-underlay:${role}`, mimeType: 'application/json', bytesBase64: bytes.toString('base64'), sha256: sha(bytes) }
}
export function createIssuerUnderlay(ports: UnderlayPorts) {
  let held = false, running = false, next = 0, foundation: Foundation, birth: Row, epoch: Row, last: Row, a: Row, b: Row, source: Row
  let originalRaw = '', originalSource: unknown, negativeSource: Row, negativeOriginal: unknown
  const completed: string[] = []
  let checkedSeparation = false
  async function operation(label: string, action: () => Promise<unknown>, qualify: (out: unknown) => void) {
    need(!held, 'prior outcome requires observation'); held = true
    ports.evidence.save(`${label}/intent.json`, { label, attempt: 1 })
    let out: unknown
    try { out = await action() } catch (error) { ports.evidence.save(`${label}/unknown.json`, { outcome: 'unknown', retry: false }); throw error }
    ports.evidence.save(`${label}/result.json`, out); qualify(out); held = false; return out
  }
  async function request(actor: ActorName, path: string, body: unknown, statuses: number[]) {
    const label = `http-${randomUUID()}`
    ports.evidence.save(`${label}/request.json`, { actor: foundation?.actors[actor]?.id, path, method: body === undefined ? 'GET' : 'POST', body })
    return row(await operation(label, () => ports.http(actor, path, body), value => need(statuses.includes(row(value).status as number), 'unexpected HTTP outcome')))
  }
  async function archive(actor: ActorName, kind: string, body: Row, originals: Row[], expected = 'archived') {
    const commandId = randomUUID(), http = await request(actor, '/api/ediel/utilts-issuer-sources', { version: 1, commandId, environment: 'test', kind, body, originals }, expected === 'held' ? [409] : [201])
    const out = row(http.body)
    need(out.commandId === commandId && out.companyId === foundation.companyId && out.kind === kind && out.environment === 'test'
      && out.status === expected && out.marketActivationGranted === false && out.productionAuthorityGranted === false, 'exact ordinary archive receipt')
    if (epoch && out.epochId) need(['epochId', 'namespaceId', 'issuerVersionId', 'mandateVersionId'].every(key => out[key] === epoch[key]), 'unchanged actual controlled epoch tuple')
    if (out.journalHeadSha256) last = out
    return out
  }
  async function review(artifact: Row, decision: 'approve' | 'hold' | 'reject', expected: string) {
    const commandId = randomUUID(), http = await request('R', `/api/ediel/utilts-issuer-sources/${artifact.artifactId}/review`, { version: 1, commandId, decision,
      reason: 'Independent CONTROLLED SYNTHETIC TEST review of retained originals', artifactSha256: artifact.artifactSha256, scopeSha256: artifact.scopeSha256 }, expected === 'held' ? [409] : [200])
    const out = row(http.body)
    need(out.commandId === commandId && out.artifactId === artifact.artifactId && out.artifactSha256 === artifact.artifactSha256 && out.scopeSha256 === artifact.scopeSha256
      && out.status === expected && out.companyId === foundation.companyId && out.environment === 'test', 'exact independent native review')
    if (epoch && out.epochId) need(['epochId', 'namespaceId', 'issuerVersionId', 'mandateVersionId'].every(key => out[key] === epoch[key]), 'unchanged actual controlled epoch tuple')
    if (out.journalHeadSha256) last = out
    return out
  }
  function raw(seq: number, quantity = ports.input.quantity, legal = ports.input.legalIdentity) {
    return buildE02Utilts({ prefix: ports.prefix, seq, meteringPoint: ports.input.meteringPoint, sender: ports.input.transportSender[0], receiver: foundation.receiver,
      periodStart: ports.input.periodStart, quantity, latestUpdate: ports.input.periodStart, now: new Date(),
      mutate: segments => segments.map(segment => {
        if (segment.startsWith('NAD+MS+')) return 'NAD+MS+' + legal.join(':')
        if (segment.startsWith('UNB+')) { const parts = segment.split('+'); parts[2] = ports.input.transportSender.join(':'); return parts.join('+') }
        return segment.startsWith('DTM+735:') ? 'DTM+735:?+0000:406' : segment
      }) }).raw.replace(/\r?\n/g, '\r\n')
  }
  function app(actor: 'A' | 'B') {
    const found = (epoch.applicationBindings as Row[]).filter(binding => binding.actorUserId === foundation.actors[actor].id)
    need(found.length === 1, 'actual server application binding'); return found[0].applicationId
  }
  async function issue(actor: 'A' | 'B', payload: string, prior?: Row) {
    const data = original('payload', payload); data.mimeType = 'application/edifact'
    return archive(actor, prior ? 'test_correction' : 'test_issue', { epochId: epoch.epochId, applicationId: app(actor), mailboxId: foundation.mailboxId,
      fromAddress: 'issuer@t3.sim.invalid', toAddress: process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid', payloadOriginalRole: 'payload', ...(prior ? { priorIssuanceId: prior.issuanceId } : {}) }, [data], 'issued')
  }
  async function deniedReview(artifact: Row) {
    const before = await ports.fingerprint()
    await request('R', `/api/ediel/utilts-issuer-sources/${artifact.artifactId}/review`, { version: 1, commandId: randomUUID(), decision: 'approve', reason: 'Intentional controlled invalid source or journal coverage probe', artifactSha256: artifact.artifactSha256, scopeSha256: artifact.scopeSha256 }, [403])
    const current = row((await request('R', `/api/ediel/utilts-issuer-sources?artifactId=${artifact.artifactId}`, undefined, [200])).body)
    need(current.status === 'archived' && current.reviewId === null && same(before, await ports.fingerprint()), 'native invalid source/coverage denial leaves authority unchanged')
  }
  async function checkpointHistory(issued: Row, received: Row) {
    if (!checkedSeparation) {
      const self = await archive('R', 'test_checkpoint', { epochId: epoch.epochId, expectedSequence: last.journalSequence, expectedHeadSha256: last.journalHeadSha256,
        applicationInventorySha256: epoch.applicationInventorySha256 }, [original('checkpoint_approval', { assurance: 'CONTROLLED SYNTHETIC TEST ONLY', purpose: 'native independent-review denial probe' })])
      const proof = await ports.reviewerProof(); ports.evidence.save('underlay/actual-reviewer-permission.json', proof)
      need(proof.actorId === foundation.actors.R.id && proof.companyId === foundation.companyId && proof.allowed === true, 'current genuine reviewer permission required for native separation probe')
      const before = await ports.fingerprint()
      await request('R', `/api/ediel/utilts-issuer-sources/${self.artifactId}/review`, { version: 1, commandId: randomUUID(), decision: 'approve', reason: 'Intentional own-checkpoint negative probe with actual review permission', artifactSha256: self.artifactSha256, scopeSha256: self.scopeSha256 }, [403])
      const current = row((await request('R', `/api/ediel/utilts-issuer-sources?artifactId=${self.artifactId}`, undefined, [200])).body)
      need(current.artifactId === self.artifactId && current.status === 'archived' && current.reviewId === null && same(before, await ports.fingerprint()), 'native self-review denial leaves actual checkpoint unapproved')
      const stale = await archive('A', 'test_checkpoint', { epochId: epoch.epochId, expectedSequence: '1', expectedHeadSha256: '0'.repeat(64), applicationInventorySha256: epoch.applicationInventorySha256 }, [original('checkpoint_approval', { purpose: 'stale incomplete journal cutoff negative' })])
      await deniedReview(stale)
      const uncovered = await archive('A', 'history', { epochId: epoch.epochId, sourceMessageId: received.sourceMessageId, currentIssuanceId: issued.issuanceId, checkpointArtifactId: self.artifactId }, [])
      await deniedReview(uncovered)
      checkedSeparation = true
    }
    const cp = await archive('A', 'test_checkpoint', { epochId: epoch.epochId, expectedSequence: last.journalSequence, expectedHeadSha256: last.journalHeadSha256,
      applicationInventorySha256: epoch.applicationInventorySha256 }, [original('checkpoint_approval', { assurance: 'CONTROLLED_SYNTHETIC_TEST_ONLY', inventory: epoch.applicationBindings, sequence: last.journalSequence, head: last.journalHeadSha256 })])
    const approved = await review(cp, 'approve', 'approved')
    if (received.sourceMessageId === source.sourceMessageId) {
      const mismatch = await archive('A', 'history', { epochId: epoch.epochId, sourceMessageId: received.sourceMessageId, currentIssuanceId: b.issuanceId, checkpointArtifactId: approved.artifactId }, [])
      await deniedReview(mismatch)
    }
    const history = await archive('A', 'history', { epochId: epoch.epochId, sourceMessageId: received.sourceMessageId, currentIssuanceId: issued.issuanceId, checkpointArtifactId: approved.artifactId }, [])
    const accepted = await review(history, 'approve', 'approved')
    need(accepted.sourceMessageId === received.sourceMessageId && accepted.sourcePayloadSha256 === received.sourcePayloadSha256, 'source-bound actual history effect')
    return ports.issuer(String(received.sourceMessageId))
  }
  const steps = [
    async () => {
      need(new Set([ports.input.legalIdentity, ports.input.negativeLegalIdentity, ports.input.deliveryLegalIdentity].map(value => JSON.stringify(value))).size === 3, 'three distinct full legal identities required')
      await ports.preflight()
      foundation = await operation('foundation', ports.foundation, value => { const f = value as Foundation; need(f.companyId && f.mailboxId && new Set(Object.values(f.actors).map(actor => actor.id)).size === 4, 'four actual independent Auth actors') }) as Foundation
      const before = await ports.fingerprint()
      const body = { legalIdentity: ports.input.legalIdentity, transportSender: ports.input.transportSender, mailboxId: foundation.mailboxId,
        validUntil: new Date(Date.now() + ports.input.validityHours * 3600000).toISOString(), measurementUsageFrom: ports.input.measurementUsageFrom,
        measurementUsageUntil: ports.input.measurementUsageUntil, applications: foundation.applications }
      const originals = ['test_policy', 'test_mandate', 'test_retention_decision', 'test_application_inventory'].map(role => original(role, role === 'test_application_inventory' ? foundation.applications : { assurance: 'CONTROLLED SYNTHETIC TEST ONLY', purpose: 'custody-only denied-permission control; never approve this artifact', legalIdentity: ports.input.legalIdentity, transportSender: ports.input.transportSender }))
      await request('D', '/api/ediel/utilts-issuer-sources', { version: 1, commandId: randomUUID(), environment: 'test', kind: 'test_birth', body, originals }, [403])
      need(same(before, await ports.fingerprint()), 'denied actor cannot change actual authority')
      const control = await archive('A', 'test_birth', body, originals)
      need(control.epochId === null && same(before, await ports.fingerprint()), 'same valid authorized custody control succeeds without issuer authority')
      ports.evidence.save('underlay/denied-permission-control.json', { custodyOnly: true, neverReview: true, sameBodyAndOriginalsSha256: sha(Buffer.from(JSON.stringify({ body, originals }))), artifactId: control.artifactId })
    },
    async () => {
      need(!same(ports.input.negativeLegalIdentity, ports.input.legalIdentity), 'separate negative physical identity')
      const challenge = negativeSource = await ports.challenge(raw(90, ports.input.quantity, ports.input.negativeLegalIdentity))
      negativeOriginal = await ports.immutable(String(challenge.sourceMessageId))
      const rejected = await ports.issuer(String(challenge.sourceMessageId))
      need(rejected.status === 'held' && rejected.authorityVersionId === null, 'actual prebirth challenge remains held without issuer authority')
      ports.evidence.save('underlay/unapproved-challenge.json', { label: 'UNAPPROVED_CHALLENGE; never an approved managed issuance or a retrofitted namespace', source: challenge, issuer: rejected })
      birth = await archive('A', 'test_birth', { legalIdentity: ports.input.legalIdentity, transportSender: ports.input.transportSender, mailboxId: foundation.mailboxId,
        validUntil: new Date(Date.now() + ports.input.validityHours * 3600000).toISOString(), measurementUsageFrom: ports.input.measurementUsageFrom,
        measurementUsageUntil: ports.input.measurementUsageUntil, applications: foundation.applications },
      ['test_policy', 'test_mandate', 'test_retention_decision', 'test_application_inventory'].map(role => original(role, role === 'test_application_inventory' ? foundation.applications : {
        assurance: 'CONTROLLED SYNTHETIC TEST ONLY; no market authority', legalIdentity: ports.input.legalIdentity, transportSender: ports.input.transportSender,
        usageFrom: ports.input.measurementUsageFrom, usageUntil: ports.input.measurementUsageUntil, retention: 'retain original bytes and all identifiers for this disposable test' })))
      need(birth.epochId === null, 'unreviewed custody is not an issuer epoch')
      const heldReceipt = await review(birth, 'hold', 'held'); need(heldReceipt.epochId === null, 'explicit hold creates no authority')
    },
    async () => {
      epoch = await review(birth, 'approve', 'approved'); last = epoch
      need(epoch.assurance === 'controlled_test_only' && epoch.epochId && epoch.namespaceId && epoch.issuerVersionId && epoch.mandateVersionId
        && same(epoch.legalIdentity, ports.input.legalIdentity) && Array.isArray(epoch.applicationBindings) && epoch.applicationBindings.length === 2, 'actual new closed TEST birth effects')
      const negative = await ports.issuer(String(negativeSource.sourceMessageId)); need(negative.status === 'held' && negative.authorityVersionId === null && same(negativeOriginal, await ports.immutable(String(negativeSource.sourceMessageId))), 'main birth cannot retrofit the separate unapproved source')
    },
    async () => {
      const damaged = original('payload', raw(80)); damaged.mimeType = 'application/edifact'; damaged.sha256 = '0'.repeat(64)
      const before = await ports.fingerprint()
      await request('A', '/api/ediel/utilts-issuer-sources', { version: 1, commandId: randomUUID(), environment: 'test', kind: 'test_issue', body: { epochId: epoch.epochId, applicationId: app('A'), mailboxId: foundation.mailboxId, fromAddress: 'issuer@t3.sim.invalid', toAddress: process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid', payloadOriginalRole: 'payload' }, originals: [damaged] }, [400])
      need(same(before, await ports.fingerprint()), 'damaged original rejected before authority effects')
      originalRaw = raw(1); a = await issue('A', originalRaw); b = await issue('B', raw(2)); need(a.issuanceId !== b.issuanceId && a.internetMessageId !== b.internetMessageId, 'two actual distinct issuances') },
    async () => { source = await ports.receive(a, false, originalRaw); const read = await ports.issuer(String(source.sourceMessageId)); need(read.status === 'held' && read.authorityVersionId === epoch.issuerVersionId, 'actual prospective issuer admission awaits reviewed absence history'); originalSource = await ports.immutable(String(source.sourceMessageId)) },
    async () => { const read = await checkpointHistory(a, source); need(read.status === 'qualified' && read.messageReferenceCollision === false && Array.isArray(read.transactionReferenceCollisions) && read.transactionReferenceCollisions.length === 0, 'actual exact-source qualified no-collision result') },
    async () => {
      const replay = await archive('A', 'test_replay', { epochId: epoch.epochId, applicationId: app('A'), issuanceId: a.issuanceId }, [], 'issued')
      need(replay.issuanceId === a.issuanceId && replay.internetMessageId === a.internetMessageId && replay.mimeSha256 === a.mimeSha256, 'replay retains exact issuance')
      const sameSource = await ports.receive(replay, true, originalRaw); need(sameSource.sourceMessageId === source.sourceMessageId, 'replay retains actual physical source')
      const equal = await issue('A', originalRaw); need(equal.issuanceId !== a.issuanceId && equal.mimeSha256 !== a.mimeSha256, 'equal payload is a distinct physical issuance')
      const equalSource = await ports.receive(equal, false, originalRaw), read = await checkpointHistory(equal, equalSource)
      const transaction = /IDE\+24\+([^'\r\n]+)/.exec(originalRaw)?.[1]
      need(transaction && read.messageReferenceCollision === true && Array.isArray(read.transactionReferenceCollisions) && read.transactionReferenceCollisions.some((value: Row) => value.transactionId === transaction && value.transactionIndex === 0), 'distinct equal-payload issuance preserves exact 203 and 505 collisions')
    },
    async () => {
      const correctedRaw = originalRaw.replace('QTY+136:' + ports.input.quantity, 'QTY+136:' + String(Number(ports.input.quantity) + 1))
      const correction = await issue('B', correctedRaw, a)
      need(correction.issuanceId !== a.issuanceId, 'correction has a new actual issuance')
      const retention = await archive('A', 'test_retention', { epochId: epoch.epochId, retentionArtifactId: epoch.retentionArtifactId, reason: 'Retain all originals and identifiers in this controlled TEST' }, [original('test_retention_decision', { assurance: 'CONTROLLED SYNTHETIC TEST ONLY', mode: 'retain originals and identifiers', prior: epoch.retentionArtifactId })])
      const approved = await review(retention, 'approve', 'approved')
      const deletion = await archive('A', 'test_delete', { epochId: epoch.epochId, applicationId: app('A'), issuanceId: a.issuanceId, retentionArtifactId: approved.artifactId, reason: 'Retained-byte tombstone, no deletion or identity erasure' }, [], 'archived')
      await review(deletion, 'approve', 'approved')
      const retained = await archive('A', 'test_replay', { epochId: epoch.epochId, applicationId: app('A'), issuanceId: a.issuanceId }, [], 'issued')
      need(retained.issuanceId === a.issuanceId && retained.mimeSha256 === a.mimeSha256 && same(retained.originals, a.originals), 'approved tombstone retains original issued MIME and identity')
      const correctedSource = await ports.receive(correction, false, correctedRaw)
      const read = await checkpointHistory(correction, correctedSource)
      const transaction = /IDE\+24\+([^'\r\n]+)/.exec(originalRaw)?.[1]
      need(transaction && read.status === 'qualified' && read.messageReferenceCollision === true && Array.isArray(read.transactionReferenceCollisions) && read.transactionReferenceCollisions.some((value: Row) => value.transactionId === transaction && value.transactionIndex === 0), 'correction/retention/checkpoint preserves exact 203 and 505 identifiers')
      need(same(originalSource, await ports.immutable(String(source.sourceMessageId))), 'correction/retention/tombstone cannot rewrite original source/admission')
    },
    async () => {
      const commandId = randomUUID(), decisionOriginal = original('decision', { assurance: 'CONTROLLED SYNTHETIC TEST ONLY', epochId: epoch.epochId, action: 'revoke future eligibility' })
      const decision = { reference: decisionOriginal.reference, version: decisionOriginal.version, uri: decisionOriginal.uri, mimeType: decisionOriginal.mimeType, bytesBase64: decisionOriginal.bytesBase64, sha256: decisionOriginal.sha256 }
      const result = await request('R', `/api/ediel/utilts-issuer-sources/${birth.artifactId}/review`, { version: 1, commandId, environment: 'test', decision: 'revoke', targetKind: 'epoch', targetId: epoch.epochId, decisionOriginal: decision, reason: 'Independent controlled TEST epoch withdrawal' }, [200])
      need(row(result.body).status === 'revoked' && row(result.body).epochId === epoch.epochId, 'actual native revocation')
      const read = await ports.issuer(String(source.sourceMessageId)); need(read.status === 'held' && typeof read.holdReason === 'string' && read.holdReason.includes('revoked'), 'existing protected reader observes revocation')
      const before = await ports.fingerprint(), payload = original('payload', raw(9)); payload.mimeType = 'application/edifact'
      await request('A', '/api/ediel/utilts-issuer-sources', { version: 1, commandId: randomUUID(), environment: 'test', kind: 'test_issue', body: { epochId: epoch.epochId, applicationId: app('A'), mailboxId: foundation.mailboxId, fromAddress: 'issuer@t3.sim.invalid', toAddress: process.env.T3_MAILBOX_ADDRESS ?? 'ediel@t3.sim.invalid', payloadOriginalRole: 'payload' }, originals: [payload] }, [403])
      need(same(before, await ports.fingerprint()) && same(originalSource, await ports.immutable(String(source.sourceMessageId))), 'revoked operation cannot change actual authority or originals')
    },
    async () => {
      need(completed.length === 9, 'complete preceding actual effects')
      const validation = { birth, epoch, issuanceA: a, issuanceB: b, source, originalSource }
      need(same(negativeOriginal, await ports.immutable(String(negativeSource.sourceMessageId))), 'unapproved physical original remains unchanged')
      // Separate new namespace: never restore, amend or adopt the revoked validation epoch.
      epoch = undefined as unknown as Row
      const deliveryBody = { legalIdentity: ports.input.deliveryLegalIdentity, transportSender: ports.input.transportSender, mailboxId: foundation.mailboxId,
        validUntil: new Date(Date.now() + ports.input.validityHours * 3600000).toISOString(), measurementUsageFrom: ports.input.measurementUsageFrom,
        measurementUsageUntil: ports.input.measurementUsageUntil, applications: foundation.applications }
      const deliveryBirth = await archive('A', 'test_birth', deliveryBody, ['test_policy', 'test_mandate', 'test_retention_decision', 'test_application_inventory'].map(role => original(role, role === 'test_application_inventory' ? foundation.applications : { assurance: 'CONTROLLED SYNTHETIC TEST ONLY', purpose: 'separate active delivery issuer; no billing or FINAL qualification', legalIdentity: ports.input.deliveryLegalIdentity, transportSender: ports.input.transportSender, usageFrom: ports.input.measurementUsageFrom, usageUntil: ports.input.measurementUsageUntil, retention: 'retain all original bytes and identifiers' })))
      epoch = await review(deliveryBirth, 'approve', 'approved'); last = epoch
      need(epoch.epochId !== validation.epoch.epochId && epoch.namespaceId !== validation.epoch.namespaceId && same(epoch.legalIdentity, ports.input.deliveryLegalIdentity), 'separate actual new delivery epoch and identity required')
      const deliveries: Row[] = []
      for (let index = 0; index < 3; index++) {
        const payload = raw(101 + index, ports.input.quantity, ports.input.deliveryLegalIdentity)
        const issued = await issue(index === 1 ? 'B' : 'A', payload), received = await ports.receive(issued, false, payload)
        const cp = await archive('A', 'test_checkpoint', { epochId: epoch.epochId, expectedSequence: last.journalSequence, expectedHeadSha256: last.journalHeadSha256, applicationInventorySha256: epoch.applicationInventorySha256 }, [original('checkpoint_approval', { assurance: 'CONTROLLED SYNTHETIC TEST ONLY', deliveryIndex: index, sequence: last.journalSequence, head: last.journalHeadSha256 })])
        const approved = await review(cp, 'approve', 'approved')
        const history = await archive('A', 'history', { epochId: epoch.epochId, sourceMessageId: received.sourceMessageId, currentIssuanceId: issued.issuanceId, checkpointArtifactId: approved.artifactId }, [])
        const grounded = await review(history, 'approve', 'approved')
        need(grounded.sourceMessageId === received.sourceMessageId && grounded.sourcePayloadSha256 === received.sourcePayloadSha256, 'actual delivery source-bound history effect')
        deliveries.push({ issued, source: received, history: grounded, immutable: await ports.immutable(String(received.sourceMessageId)) })
      }
      need(new Set(deliveries.map(value => row(value.issued).issuanceId)).size === 3 && new Set(deliveries.map(value => row(value.source).sourceMessageId)).size === 3, 'three distinct actual delivery issuances and physical sources')
      for (const delivery of deliveries) {
        const received = row(delivery.source), current = await ports.issuer(String(received.sourceMessageId))
        need(current.status === 'qualified' && current.authorityVersionId === epoch.issuerVersionId && current.messageReferenceCollision === false && Array.isArray(current.transactionReferenceCollisions) && current.transactionReferenceCollisions.length === 0 && same(delivery.immutable, await ports.immutable(String(received.sourceMessageId))), 'every delivery source remains currently qualified clean and immutable')
        delivery.currentRead = current
      }
      const revoked = await ports.issuer(String(validation.source.sourceMessageId))
      need(revoked.status === 'held' && typeof revoked.holdReason === 'string' && revoked.holdReason.includes('revoked') && same(validation.originalSource, await ports.immutable(String(validation.source.sourceMessageId))), 'old validation epoch remains revoked and immutable')
      const negative = await ports.issuer(String(negativeSource.sourceMessageId))
      need(negative.status === 'held' && negative.authorityVersionId === null && same(negativeOriginal, await ports.immutable(String(negativeSource.sourceMessageId))), 'delivery never retrofits the negative identity')
      ports.evidence.observe('evidenceMatrix', UNDERLAY_MATRIX)
      ports.evidence.save('underlay/actual-effects.json', { actors: foundation.actors, mailboxId: foundation.mailboxId, validation, delivery: { birth: deliveryBirth, epoch, sources: deliveries, billingQualification: 'NOT_RUN', finalQualification: 'NOT_RUN' }, completed })
    },
  ]
  return {
    async step(index: number) {
      need(!held && !running && index === next, 'ordered one-attempt producer phase required'); running = true
      try { await steps[index](); completed.push(UNDERLAY_NAMES[index]); next++ } catch (error) { held = true; try { ports.evidence.save(`underlay/failure-${index}.json`, { test: UNDERLAY_NAMES[index], outcome: 'unknown_or_unqualified', automaticRetry: false }) } catch (evidenceError) { throw new AggregateError([error, evidenceError], 'Original producer failure and private evidence failure') }; throw error } finally { running = false }
    },
    hold() { held = true },
    async close() { await ports.cleanup() },
  }
}

// Production ports follow below. Tests substitute I/O ports around this actual
// state machine; neither a mocked result nor a source-shaped object is authority.
export async function createNativeIssuerUnderlay(evidence: Evidence) {
  const home = process.env.SIM_HOME, app = process.env.SIM_RUN_DIR
  need(home && app && process.env.T3_MODE === 'test', 'admitted TEST runtime required')
  const homeStat = lstatSync(home)
  need(realpathSync(home) === home && homeStat.isDirectory() && homeStat.uid === process.getuid!() && (homeStat.mode & 0o777) === 0o700, 'canonical owned private runtime home required')
  const track = resolve(fileURLToPath(new URL('..', import.meta.url))), harness = resolve(track, '../../..')
  function readPrivate(name: string) {
    const file = join(home!, name), stat = lstatSync(file)
    need(realpathSync(file) === file && stat.isFile() && stat.uid === process.getuid!() && (stat.mode & 0o777) === 0o600, 'private original file required')
    const bytes = readFileSync(file); return { bytes, value: row(JSON.parse(bytes.toString('utf8'))) }
  }
  function canonical(value: unknown): unknown { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)])) : value }
  const authorization = readPrivate('authorized-execution.json'), execution = row(authorization.value.execution)
  need(authorization.value.executionSha256 === sha(JSON.stringify(canonical(execution))) && authorization.value.environment === 'test', 'unchanged authorized execution bytes required')
  need(authorization.value.schema === 'track3-authorized-execution-v1' && execution.purpose === 'controlled_issuer_underlay'
    && execution.scenarioFile === 'scenarios/issuer-underlay.test.ts' && same(execution.expectedTestNames, UNDERLAY_NAMES.map(name => 'Controlled TEST issuer underlay ' + name))
    && same(execution.evidenceMatrix, UNDERLAY_MATRIX) && execution.inputFile === 'inputs/issuer-underlay-input.json', 'actual authorized underlay descriptor required')
  const inputFile = readPrivate('inputs/issuer-underlay-input.json'), input = underlayInput.parse(inputFile.value)
  need(sha(inputFile.bytes) === execution.inputSha256 && new Set([input.legalIdentity, input.negativeLegalIdentity, input.deliveryLegalIdentity].map(value => JSON.stringify(value))).size === 3
    && [input.legalIdentity, input.negativeLegalIdentity, input.deliveryLegalIdentity].every(value => value[0] !== '70007'), 'frozen new controlled input required')
  const fixtureFile = readPrivate('fixture.json'), fixture = fixtureFile.value, run = newRunContext(input.runLabel)
  const admin = adminClient(), sessions = new Map<ActorName, Map<string, string>>()
  const userClients = new Map<ActorName, ReturnType<typeof createServerClient>>()
  let foundation: Foundation | undefined, admission: E02OutboxAdmission | undefined, childSnapshot: Row | undefined
  const issuedSources = new Map<string, Row>(), ownedOutboxes = new Set<string>()
  const origin = process.env.T3_APP_URL!, api = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const save = (name: string, value: unknown) => evidence.save('underlay/' + name, value)
  async function checked<T>(promise: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> { const out = await promise; if (out.error) throw out.error; need(out.data !== null && out.data !== undefined, 'actual service result required'); return out.data as NonNullable<T> }
  function quiet() {
    const counts = row(sqlJson(`SELECT jsonb_build_object('inbound',(SELECT count(*) FROM public.inbound_processing_jobs WHERE status IN ('queued','retry','received','processing')),
      'customer',(SELECT count(*) FROM public.customer_operation_jobs WHERE status IN ('queued','running')),
      'overdue',(SELECT count(*) FROM public.outbound_requests WHERE company_id IS NOT NULL AND status IN ('sent','prepared','queued','syntax_accepted','application_accepted','acknowledged')))`))
    need(Object.values(counts).every(count => count === 0), 'global ingress has unassigned work')
    if (admission) {
      admission.admit([...ownedOutboxes])
      const active = sqlJson(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status)),'[]') FROM public.ediel_outbox WHERE status IN ('prepared','queued','sending')`)
      need(Array.isArray(active) && active.every(value => value && typeof value === 'object' && ownedOutboxes.has(value.id) && ['prepared', 'queued'].includes(value.status)), 'all-environment active outbox assignment required')
    }
    else need(sqlJson(`SELECT count(*) FROM public.ediel_outbox WHERE status IN ('prepared','queued','sending')`) === 0, 'empty initial global outbox required')
  }
  async function preflight() {
    const identity = row(JSON.parse(execFileSync(process.execPath, [join(track, 'lib/seed-cli.mjs'), '--run-identity'], { encoding: 'utf8' })))
    const assignment = readPrivate('runtime-assignment.json'), ready = readPrivate('runtime-ready.json'), prepared = readPrivate('prepared-runtime.json'), preparation = readPrivate('preparation-run.json')
    const sourceTuple = row(authorization.value.source)
    need(['appCommit', 'appTree', 'harnessCommit', 'harnessTree'].every(key => sourceTuple[key] === identity[key]), 'actual admitted source tuple required')
    need(identity.assignmentSha256 === sha(assignment.bytes) && authorization.value.runtimeAssignmentSha256 === sha(assignment.bytes)
      && ready.value.assignmentSha256 === sha(assignment.bytes) && assignment.value.preparedReceiptSha256 === sha(prepared.bytes)
      && prepared.value.preparationRunSha256 === sha(preparation.bytes) && preparation.value.planSha256 === authorization.value.planSha256
      && fixture.companyId && row(fixture.mailboxes).test && fixture.actorUserId === process.env.EDIEL_AUTOMATION_ACTOR_USER_ID, 'actual runtime/fixture receipt chain required')
    const qualification = row(execution.sourceQualification)
    need(qualification.owner === 'T4-serial-GEN' && qualification.appCommit === identity.appCommit && qualification.appTree === identity.appTree
      && qualification.schemaSha256 === sha(readFileSync(join(app!, 'supabase/schema.sql')))
      && typeof qualification.migrationPath === 'string' && /^supabase\/migrations\/[0-9]{14}_[A-Za-z0-9_]+\.sql$/.test(qualification.migrationPath)
      && qualification.migrationSha256 === sha(readFileSync(join(app!, qualification.migrationPath))), 'genuine serial GEN source qualification required')
    const reviews = qualification.originalFiles as Row[]
    need(Array.isArray(reviews) && reviews.length === 3 && new Set(reviews.map(value => value.role)).size === 3
      && ['qualified-output', 'independent-review-1', 'independent-review-2'].every(role => reviews.some(value => value.role === role && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256))), 'actual independent source output reviews required')
    need(sha(readFileSync(join(track, 'scenarios/issuer-underlay.test.ts'))) === execution.scenarioSha256, 'exact underlay source required')
    for (const endpoint of [origin, api]) need(new URL(endpoint).hostname === '127.0.0.1' && new URL(endpoint).protocol === 'http:', 'assigned local origins required')
    const period = input.periodStart, periodAt = Date.UTC(+period.slice(0, 4), +period.slice(4, 6) - 1, +period.slice(6, 8), +period.slice(8, 10), +period.slice(10, 12))
    need(new Date(periodAt).toISOString().replace(/[-:TZ.]/g, '').slice(0, 12) === period && periodAt >= Date.parse(input.measurementUsageFrom)
      && periodAt + 900000 <= Date.parse(input.measurementUsageUntil), 'actual declared measurement usage window required')
    quiet(); save('preflight.json', { identity, fixtureSha256: sha(fixtureFile.bytes), inputSha256: sha(inputFile.bytes), executionSha256: authorization.value.executionSha256, qualification, run })
  }
  async function actorFoundation(): Promise<Foundation> {
    const permissions = await checked(admin.from('permissions').select('id,key').in('key', ['ediel.utilts_issuer_source.submit', 'ediel.utilts_issuer_source.review']))
    need(permissions.length === 2 && new Set(permissions.map(value => value.key)).size === 2, 'actual new permission definitions required')
    const actors = {} as Foundation['actors']
    for (const name of ['A', 'B', 'R', 'D'] as const) {
      const email = `t3-${run.runId}-${name.toLowerCase()}@t3.sim.invalid`, password = randomBytes(32).toString('hex')
      // Secrets are private runtime inputs, deliberately outside evidence/CI.
      writeFileSync(join(home!, `underlay-auth-${name}.json`), JSON.stringify({ email, password }) + '\n', { flag: 'wx', mode: 0o600 })
      save(`auth-${name}-intent.json`, { operation: 'new actual local Auth user', email, attempt: 1 })
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Controlled TEST issuer ${name}` } })
      if (created.error) throw created.error
      need(created.data.user && created.data.user.email === email, 'actual newly created Auth user required')
      const id = created.data.user.id
      save(`auth-${name}-own-row-intent.json`, { actorId: id, companyId: fixture.companyId, profile: 'active', membership: 'accepted member', permissions: name === 'D' ? [] : name === 'R' ? permissions.map(value => value.key) : ['ediel.utilts_issuer_source.submit'], attempt: 1 })
      const profile = await checked(admin.from('user_profiles').upsert({ id, email, full_name: `Controlled TEST issuer ${name}`, user_status: 'active' }).select('id,email,user_status').single())
      const membership = await checked(admin.from('company_memberships').insert({ company_id: fixture.companyId, user_id: id, status: 'active', is_active: true,
        membership_role: 'member', role: null, role_key: null, role_id: null, accepted_at: new Date().toISOString(), joined_at: new Date().toISOString() }).select('id,user_id,company_id,status,is_active,accepted_at').single())
      const keys = name === 'D' ? [] : name === 'R' ? permissions : permissions.filter(value => value.key === 'ediel.utilts_issuer_source.submit')
      const grants = keys.length ? await checked(admin.from('user_permissions').insert(keys.map(value => ({ user_id: id, company_id: fixture.companyId, permission_id: value.id,
        permission_key: value.key, is_active: true, status: 'active', effect: 'allow' }))).select('id,user_id,company_id,permission_key,effect')) : []
      need(profile.id === id && profile.email === email && profile.user_status === 'active' && membership.user_id === id && membership.company_id === fixture.companyId
        && membership.status === 'active' && membership.is_active === true && membership.accepted_at
        && grants.length === keys.length && grants.every(value => value.user_id === id && value.company_id === fixture.companyId && value.effect === 'allow' && keys.some(key => key.key === value.permission_key)), 'actual owned profile/membership required')
      const jar = new Map<string, string>(), client = createServerClient(api, anon, { cookies: { getAll: () => [...jar].map(([name, value]) => ({ name, value })), setAll: values => { for (const value of values) jar.set(value.name, value.value) } } })
      const signed = await client.auth.signInWithPassword({ email, password }); if (signed.error) throw signed.error
      const current = await client.auth.getUser(); if (current.error) throw current.error
      need(current.data.user?.id === id && jar.size > 0, 'genuine GoTrue session and SSR cookies required')
      const context = await checked(client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: fixture.companyId }))
      need(row(context).user_id === id && row(context).selected_company_id === fixture.companyId, 'actual authenticated own tenant context required')
      // This selector is routing data, not a JWT or a permission. Its value was
      // just verified by the ordinary authenticated current tenant resolver.
      jar.set('gridex_admin_selected_company_id', String(fixture.companyId))
      userClients.set(name, client); sessions.set(name, jar); actors[name] = { id, email }
      save(`auth-${name}-foundation.json`, { actor: actors[name], profile, membership, grants, sessionUserVerified: true,
        canonicalContext: { authorized: row(context).authorized, user_id: row(context).user_id, selected_company_id: row(context).selected_company_id, permissions: row(context).permissions } })
    }
    const parent = row(await checked(admin.from('ediel_mailboxes').select('*').eq('id', row(fixture.mailboxes).test).single())), metadata = row(parent.metadata)
    need(parent.id === row(fixture.mailboxes).test && parent.company_id === null && parent.environment === 'test' && metadata.scope === 'platform_shared'
      && parent.imap_host === '127.0.0.1' && parent.imap_port === Number(process.env.T3_IMAP_TLS_PORT) && parent.tls_required === true && parent.is_active === true
      && metadata.imap_secure === true && parent.secret_reference === 'env:EDIEL_IMAP_PASS' && parent.username === process.env.T3_IMAP_USER
      && parent.email_address === process.env.T3_MAILBOX_ADDRESS, 'actual exact assigned private TLS parent mailbox required')
    const child = { company_id: fixture.companyId, environment: 'test', mailbox_name: `Controlled TEST ${run.runId}`, email_address: parent.email_address,
      imap_host: parent.imap_host, imap_port: parent.imap_port, username: parent.username, secret_reference: parent.secret_reference, smtp_from: parent.smtp_from,
      tls_required: true, transport_mode: parent.transport_mode, encryption_mode: parent.encryption_mode, signing_mode: parent.signing_mode, poll_interval_minutes: parent.poll_interval_minutes,
      mailbox_type: 'company', is_active: true, metadata: { ...metadata, scope: 'company', controlled_issuer_underlay: run.runId } }
    save('mailbox-intent.json', { companyId: fixture.companyId, parentId: parent.id, fixtureSha256: sha(fixtureFile.bytes), credentialReferenceSha256: sha(String(parent.secret_reference)), attempt: 1 })
    childSnapshot = row(await checked(admin.from('ediel_mailboxes').insert(child).select('*').single()))
    need(childSnapshot.company_id === fixture.companyId && childSnapshot.environment === 'test' && typeof childSnapshot.id === 'string', 'actual owned child mailbox required')
    const company = row(await checked(admin.from('companies').select('id,ediel_id').eq('id', fixture.companyId).single()))
    need(company.id === fixture.companyId && typeof company.ediel_id === 'string', 'actual assigned receiving company required')
    const entryPath = 'scripts/simulation/track3/lib/issuer-underlay.ts', repository = execFileSync('git', ['-C', harness, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
    const commit = execFileSync('git', ['-C', harness, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), tree = execFileSync('git', ['-C', harness, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim()
    foundation = { companyId: String(fixture.companyId), mailboxId: String(childSnapshot.id), receiver: company.ediel_id,
      actors, applications: (['A', 'B'] as const).map(name => ({ applicationReference: `controlled-${name}`, actorUserId: actors[name].id, repository, commit, tree, entryPath,
        entrySha256: sha(readFileSync(join(harness, entryPath))), producerReference: `controlled_issuer_underlay:${run.runId}:${name}` })) }
    admission = new E02OutboxAdmission({ companyId: foundation.companyId, environment: 'test', mailboxId: foundation.mailboxId })
    save('mailbox-foundation.json', { parentId: parent.id, childId: childSnapshot.id, companyId: fixture.companyId, environment: 'test', imapHost: parent.imap_host, imapPort: parent.imap_port, tls: true, credentialReferenceSha256: sha(String(parent.secret_reference)) })
    return foundation
  }
  async function http(actor: ActorName, path: string, body?: unknown): Promise<Http> {
    need(sessions.has(actor) && (path === '/api/ediel/utilts-issuer-sources' || /^\/api\/ediel\/utilts-issuer-sources\?artifactId=[a-f0-9-]+$/.test(path) || /^\/api\/ediel\/utilts-issuer-sources\/[a-f0-9-]+\/review$/.test(path)), 'exact authenticated owned API path required')
    const jar = sessions.get(actor)!, response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', cookie: [...jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ') },
      body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(170000) })
    for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(';', 1)[0], index = pair.indexOf('='); jar.set(pair.slice(0, index), decodeURIComponent(pair.slice(index + 1))) }
    return { status: response.status, body: JSON.parse(await response.text()) }
  }
  async function receiveRaw(mime: Buffer, internetMessageId: string, expectedPayload: string, replay: boolean): Promise<Row> {
    need(foundation && admission, 'actual mailbox foundation required'); quiet()
    const parsed = parseInboundEmailContent({ rawEmail: mime.toString('utf8') })
    need(parsed?.rawPayload === expectedPayload && parsed.messageFamily === 'UTILTS', 'independent full MIME payload must match exact original')
    const child = row(await checked(admin.from('ediel_mailboxes').select('id,company_id,environment,locked_at,locked_by,secret_reference,imap_host,imap_port,username,email_address,tls_required,is_active,metadata').eq('id', foundation.mailboxId).single()))
    need(child.company_id === foundation.companyId && child.environment === 'test' && child.locked_at === null && child.locked_by === null
      && child.secret_reference === childSnapshot!.secret_reference && child.imap_host === childSnapshot!.imap_host && child.imap_port === childSnapshot!.imap_port
      && child.username === childSnapshot!.username && child.email_address === childSnapshot!.email_address && child.tls_required === true && child.is_active === true && same(child.metadata, childSnapshot!.metadata), 'owned unchanged unlocked mailbox required')
    const updated = await checked(admin.from('ediel_mailboxes').update({ last_polled_at: null }).eq('id', foundation.mailboxId).eq('company_id', foundation.companyId).eq('environment', 'test').is('locked_at', null).is('locked_by', null).select('id'))
    need(updated.length === 1 && updated[0].id === foundation.mailboxId, 'exact owned schedule preparation required')
    const folder = `underlay/physical-${sha(mime)}`; evidence.save(`${folder}/input.eml`, mime); evidence.save(`${folder}/intent.json`, { internetMessageId, mimeSha256: sha(mime), attempt: 1, replay })
    await appendToInbox(mime); admission.rememberMime(mime); quiet()
    const response = await triggerInbound('test', foundation.mailboxId); evidence.save(`${folder}/http.json`, response)
    const body = row(response.body); need(response.ok && response.status === 200 && body.ok === true, 'ordinary HTTP intake must complete')
    const { qualifiedEngine } = await import('./e01-chain')
    const result = qualifiedEngine({ ok: true, result: body.result as InboundEngineRunResult })
    need(result.debug.customerOperationJobs?.claimed === 0 && result.overdueTasks && Object.values(result.overdueTasks).every(count => count === 0), 'no unassigned global intake effects')
    const ids = replay ? result.results.flatMap(value => value.dedupedInboundEmailMessageIds) : result.inboundEmailMessageIds
    need(ids.length === 1 && result.edielMessageIds.length === 1 && (!replay || result.storedEmails === 0), 'exact actual physical intake result required')
    admission.observePoll(replay ? [] : ids, result.edielMessageIds)
    const source = admission.sources.find(value => value.sourceMessageId === result.edielMessageIds[0])
    need(source && source.mimeSha256 === sha(mime) && source.sourcePayloadSha256 === sha(expectedPayload) && source.inboundEmailMessageId === ids[0], 'exact physical email/source receipt required')
    const physical = row(sqlJson(`SELECT jsonb_build_object('internetMessageId',internet_message_id,'mimeSha256',raw_message_sha256) FROM public.inbound_email_messages WHERE id=${lit(source.inboundEmailMessageId)}`))
    need(physical.internetMessageId === internetMessageId && physical.mimeSha256 === sha(mime), 'actual stored RFC/MIME original required')
    if (!replay) {
      const receipts = admission.captureOutboxes([source.sourceMessageId])
      need(receipts.filter(value => value.ackFamily === 'CONTRL').length === 1, 'one causal technical CONTRL receipt required')
      for (const receipt of receipts) ownedOutboxes.add(receipt.id)
    }
    admission.admit([...ownedOutboxes]); save(`physical-${sha(mime)}-receipts.json`, { source, outboxes: admission.outboxes, physical })
    const actualAdmission = row(sqlJson(`SELECT to_jsonb(a) FROM gridex_utilts_issuer.source_admissions a WHERE a.source_message_id=${lit(source.sourceMessageId)}`))
    need(actualAdmission.source_payload_hash === source.sourcePayloadSha256 && actualAdmission.company_id === foundation.companyId, 'actual immutable issuer admission tuple required')
    const received = { ...source, internetMessageId, issuerAdmission: actualAdmission }; issuedSources.set(internetMessageId, received); return received
  }
  const ports: UnderlayPorts = { input, prefix: run.prefix, evidence, preflight, foundation: actorFoundation, http,
    reviewerProof: async () => {
      const client = userClients.get('R'); need(client && foundation, 'actual reviewer session required')
      const current = await client.auth.getUser(); if (current.error) throw current.error
      const context = row(await checked(client.rpc('canonical_authenticated_tenant_context', { p_selected_company_id: foundation.companyId })))
      return { actorId: current.data.user?.id, companyId: context.selected_company_id, allowed: context.user_id === current.data.user?.id && Array.isArray(context.permissions) && context.permissions.includes('ediel.utilts_issuer_source.review') && Array.isArray(context.active_permission_keys) && context.active_permission_keys.includes('ediel.utilts_issuer_source.review') && Array.isArray(context.denied_permissions) && !context.denied_permissions.includes('ediel.utilts_issuer_source.review') }
    },
    fingerprint: () => issuerAuthorityFingerprint(),
    issuer: async sourceId => row(await checked(admin.rpc('gridex_read_utilts_issuer_identity_authority_v1', { p_company_id: foundation!.companyId, p_message_id: sourceId }))),
    immutable: async sourceId => sqlJson(`SELECT jsonb_build_object('id',m.id,'company',m.company_id,'environment',m.environment,'raw',m.raw_payload,'email',m.inbound_email_message_id,'admission',to_jsonb(a),'protectedReceivedSource',to_jsonb(r)) FROM public.ediel_messages m LEFT JOIN gridex_utilts_issuer.source_admissions a ON a.source_message_id=m.id LEFT JOIN gridex_received_sources.sources r ON r.source_message_id=m.id WHERE m.id=${lit(sourceId)}`),
    challenge: async raw => { const built = buildUnapprovedChallenge(raw, process.env.T3_MAILBOX_ADDRESS!, run.prefix); return receiveRaw(built.mime, built.messageId, raw, false) },
    receive: async (issued, replay, originalPayload) => {
      const originals = issued.originals as Row[], full = originals?.filter(value => value.role === 'issued_mime'); need(full?.length === 1 && typeof full[0].bytesBase64 === 'string', 'actual API-minted full MIME required')
      const mime = Buffer.from(full[0].bytesBase64, 'base64'); need(sha(mime) === issued.mimeSha256 && typeof issued.internetMessageId === 'string', 'API issuance original binding required')
      const parsed = parseInboundEmailContent({ rawEmail: mime.toString('utf8') }); need(parsed?.rawPayload === originalPayload, 'independently decoded issued MIME must equal authored original payload')
      if (replay) need(issuedSources.has(issued.internetMessageId), 'replay requires a previously observed physical receipt')
      return receiveRaw(mime, issued.internetMessageId, parsed.rawPayload, replay)
    },
    cleanup: async () => {
      if (!childSnapshot) return
      const current = row(await checked(admin.from('ediel_mailboxes').select('id,company_id,environment,secret_reference,imap_host,imap_port,email_address,username,smtp_from,tls_required,transport_mode,encryption_mode,signing_mode,mailbox_type,metadata').eq('id', childSnapshot.id).single()))
      need(['id', 'company_id', 'environment', 'secret_reference', 'imap_host', 'imap_port', 'email_address', 'username', 'smtp_from', 'tls_required', 'transport_mode', 'encryption_mode', 'signing_mode', 'mailbox_type'].every(key => current[key] === childSnapshot![key]), 'owned child cleanup scope changed')
      need(same(current.metadata, childSnapshot.metadata), 'owned child metadata changed before cleanup')
      const updated = await checked(admin.from('ediel_mailboxes').update({ is_active: false }).eq('id', childSnapshot.id).eq('company_id', fixture.companyId).eq('environment', 'test').select('id'))
      need(updated.length === 1 && updated[0].id === childSnapshot.id, 'actual owned child deactivation required'); save('mailbox-cleanup.json', { id: childSnapshot.id, deactivated: true })
    },
  }
  return createIssuerUnderlay(ports)
}
