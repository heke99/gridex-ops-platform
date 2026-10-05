// masterplan: TR-03, AT-TR-03
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), smtp: vi.fn(), upload: vi.fn(), download: vi.fn(),
  snapshots: [] as Row[], objects: new Map<string, Buffer>(), binding: null as Row | null,
  attemptId: '', observation: null as Row | null, actions: [] as string[] }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from,
  storage: { from: () => ({ upload: io.upload, download: io.download, remove: vi.fn() }) } } }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: io.smtp }) } }))

import { sendCorrectionFencedEmail } from '@/lib/ediel/sources/correctionOutboundDispatch'
import { readVerifiedEdielTransportCopy } from '@/lib/ediel/transport/verifiedCopy'
import { sendEdielMessageViaSmtp } from '@/lib/ediel/transport/index.part-2'

const companyId = '11111111-1111-4111-8111-111111111111'
const messageId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const snapshotId = '44444444-4444-4444-8444-444444444444'
const clock = '2026-10-04T12:00:00Z'
const to = 'counterparty@example.invalid'
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const original = "UNB+SYNTHETIC'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z08+D+9+AB'"
const payload = Buffer.from(original, 'latin1')
const der = Buffer.from('synthetic-opaque-CMS-archive-content')
const rawMime = (smime: boolean) => Buffer.from([
  'From: sender@example.invalid', `To: ${to}`, 'Message-ID: <archived-original@example.invalid>',
  `Content-Type: ${smime ? 'application/pkcs7-mime; smime-type=enveloped-data' : 'application/EDIFACT'}`,
  ...(smime ? ['Content-Transfer-Encoding: base64'] : []), '', smime ? der.toString('base64') : original, '',
].join('\r\n'), 'latin1')
const message = (): EdielMessageRow => ({ id: messageId, company_id: companyId, environment: 'test',
  direction: 'outbound', message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z08',
  rule_profile_key: 'PRODAT:Z08:LK:26.A:r3', raw_payload: original,
} as EdielMessageRow)

// Actual writers, MIME compiler, provider fence and verified reader. Finite DB
// receipt ports and in-memory private storage do not mint production authority,
// prove native SQL, or qualify the opaque synthetic CMS bytes as encryption.
beforeEach(() => {
  vi.clearAllMocks(); io.snapshots = []; io.objects = new Map(); io.binding = null
  io.attemptId = ''; io.observation = null; io.actions = []
  for (const [key, value] of Object.entries({ EMAIL_PROVIDER: 'resend', EDIEL_EMAIL_PROVIDER: 'strato',
    EDIEL_SMTP_HOST: 'smtp.example.invalid', EDIEL_SMTP_PORT: '587', EDIEL_SMTP_SECURE: 'false',
    EDIEL_SMTP_USER: 'synthetic-user', EDIEL_SMTP_PASS: 'synthetic-only', EDIEL_SMTP_FROM: 'sender@example.invalid',
  })) vi.stubEnv(key, value)
  io.upload.mockImplementation(async (path: string, bytes: Buffer) => {
    if (io.objects.has(path)) return { error: new Error('immutable object already exists') }
    io.objects.set(path, Buffer.from(bytes)); return { error: null }
  })
  io.download.mockImplementation(async (path: string) => ({ data: io.objects.has(path) ? new Blob([Uint8Array.from(io.objects.get(path)!).buffer]) : null, error: null }))
  io.smtp.mockResolvedValue({ accepted: [to], rejected: [], messageId: '<provider-distinct@example.invalid>', response: '250 queued as ACTUAL-OBSERVATION' })
  io.from.mockImplementation((table: string) => {
    if (!['ediel_messages', 'ediel_message_payloads'].includes(table)) throw new Error('unexpected table')
    const filters: Array<(row: Row) => boolean> = []
    let update: Row | null = null
    const rows = () => table === 'ediel_messages' ? [{ id: messageId, company_id: companyId, direction: 'outbound' }] : io.snapshots
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query },
      like: (key: string, value: string) => { filters.push(row => String(row[key] ?? '').endsWith(value.slice(1))); return query },
      order: () => query,
      limit: async (count: number) => ({ data: rows().filter(row => filters.every(filter => filter(row))).slice(0, count), error: null }),
      insert: (row: Row) => { io.snapshots.push({ ...row, id: snapshotId }); return { select: () => ({ single: async () => ({ data: { id: snapshotId }, error: null }) }) } },
      update: (patch: Row) => { update = patch; return query },
      maybeSingle: async () => {
        const found = rows().filter(row => filters.every(filter => filter(row)))
        if (found.length !== 1) return { data: null, error: new Error('finite snapshot mismatch') }
        if (update) Object.assign(found[0], update)
        return { data: found[0], error: null }
      },
    }
    return query
  })
  io.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'ediel_require_source_bytes_available_v1') return { data: null, error: null }
    if (name === 'gridex_outbound_dispatch_v1') return { data: { scoped: false, unscopedReason: 'canonical_lk_exemption' }, error: null }
    if (['gridex_ediel_accepted_transport_projection_v1', 'gridex_ediel_repair_accepted_transport_projection_v1'].includes(name)) {
      if (!io.observation || args.p_company_id !== companyId || args.p_actor_user_id !== actorUserId || args.p_message_id !== messageId) return { data: null, error: new Error('finite current actor forbidden') }
      return { data: { status: 'accepted_projection', companyId, messageId, environment: 'test', attemptId: io.attemptId,
        lane: 'generic_journal', originalHash: hash(payload), observedAt: clock, frozenRecipient: to,
        providerReceipt: io.observation, businessExpectationPlan: null, authorizesProviderEntry: false, deliveryProven: false,
        projectionStatus: 'sent' }, error: null }
    }
    if (name === 'gridex_ediel_transport_attempt_v1') {
      const input = args.p_input as Row
      io.actions.push(String(input.action))
      if (input.action === 'prepare') { io.binding = input.binding as Row; io.attemptId = String(input.attemptId) }
      if (input.action === 'observe') io.observation = input.result as Row
      return { data: input.action === 'observe' ? { classification: 'accepted', observedAt: clock } : { proceed: true }, error: null }
    }
    if (name === 'gridex_ediel_transport_copy_v1') {
      if (args.p_company_id !== companyId || args.p_actor_user_id !== actorUserId || args.p_message_id !== messageId) return { data: null, error: new Error('finite current actor forbidden') }
      return { data: { status: 'available', companyId, messageId, environment: 'test', authorizesResend: false, deliveryProven: false,
        copies: [{ ...io.binding, companyId, messageId, environment: 'test', attemptId: io.attemptId,
          lane: 'generic_journal', enteredAt: clock, observedAt: clock, archiveReadbackRequired: true }] }, error: null }
    }
    throw new Error(`unexpected authority ${name}`)
  })
})
afterEach(() => vi.unstubAllEnvs())

for (const mode of ['raw', 'smime', 'attachment'] as const) {
  it(`TR-03 canonical LK ${mode} keeps one archive and binds the exact provider bytes to retrievable content`, async () => {
    const raw = rawMime(mode === 'smime')
    if (mode === 'smime') io.snapshots.push({ id: snapshotId, company_id: companyId, ediel_message_id: messageId,
      payload_kind: 'smime_enveloped', encrypted_payload_ref: `smtp-smime://${messageId}/${hash(der).slice(0, 24)}` })
    const input = mode === 'attachment' ? { to, subject: 'Synthetic PRODAT', attachments: [{ filename: 'message.edi', content: payload }] } : { to, raw }
    expect(await sendCorrectionFencedEmail(input, { message: message(), actorUserId, mimeMode: mode, payload, encoding: 'latin1' }))
      .toMatchObject({ messageId: '<provider-distinct@example.invalid>', dispatchObservedAt: clock })
    expect(io.snapshots).toHaveLength(1)
    expect(io.upload).toHaveBeenCalledTimes(1)
    expect(io.smtp).toHaveBeenCalledTimes(1)
    const sent = io.smtp.mock.calls[0][0].raw as Buffer
    expect(io.binding).toMatchObject({ payloadHash: hash(payload), mimeSha256: hash(sent), mimeLength: sent.length,
      mimePayloadSnapshotId: snapshotId, rawBase64: sent.toString('base64') })
    expect(io.binding!.rfcMessageId).not.toBe(io.observation!.messageId)
    expect(io.observation).toMatchObject({ messageId: '<provider-distinct@example.invalid>', smtpCode: 250, queueId: 'ACTUAL-OBSERVATION' })
    expect(io.actions).toEqual(['prepare', 'enter', 'observe'])
    const retrieved = await readVerifiedEdielTransportCopy({ companyId, actorUserId, messageId, attemptId: io.attemptId })
    expect(retrieved.equals(sent)).toBe(true)
    expect(io.download.mock.invocationCallOrder[0]).toBeLessThan(io.smtp.mock.invocationCallOrder[0])
    const stored = structuredClone(io.snapshots)
    const retainedBinding = structuredClone(io.binding), retainedObservation = structuredClone(io.observation)
    // Public repeat-send must consume the retained receipt before compilation,
    // archival, route selection or another provider/fence entry.
    expect(await sendEdielMessageViaSmtp(message(), { actorUserId })).toEqual({ accepted: [to], rejected: [],
      messageId: '<provider-distinct@example.invalid>', dispatchObservedAt: clock })
    await readVerifiedEdielTransportCopy({ companyId, actorUserId, messageId, attemptId: io.attemptId })
    expect(io.snapshots).toEqual(stored); expect(io.smtp).toHaveBeenCalledTimes(1)
    expect(io.upload).toHaveBeenCalledTimes(1)
    expect(io.binding).toEqual(retainedBinding); expect(io.observation).toEqual(retainedObservation)
    expect(io.actions).toEqual(['prepare', 'enter', 'observe'])
  })
}

it('TR-03 current actor denial returns no archived bytes through the real reader', async () => {
  await expect(readVerifiedEdielTransportCopy({ companyId, actorUserId: snapshotId, messageId, attemptId: snapshotId })).rejects.toThrow(/forbidden/)
  expect(io.download).not.toHaveBeenCalled(); expect(io.smtp).not.toHaveBeenCalled()
})

it('TR-03 refuses altered stored bytes even when the retained receipt still names the original archive', async () => {
  await sendCorrectionFencedEmail({ to, raw: rawMime(false) }, { message: message(), actorUserId, mimeMode: 'raw', payload, encoding: 'latin1' })
  const path = String(io.binding!.mimeArchiveRef).replace('storage://ediel-files/', '')
  const originalBytes = io.objects.get(path)!
  const altered = Buffer.from(originalBytes); altered[altered.length - 1] ^= 1
  io.objects.set(path, altered)
  await expect(readVerifiedEdielTransportCopy({ companyId, actorUserId, messageId, attemptId: io.attemptId })).rejects.toThrow(/archive_changed/)
  expect(io.smtp).toHaveBeenCalledTimes(1)
})

it('TR-03 LK provider failure remains fenced in the generic lane without a second archival/provider call', async () => {
  io.smtp.mockRejectedValue(Object.assign(new Error('synthetic DATA timeout'), { code: 'ETIMEDOUT', command: 'DATA' }))
  await expect(sendCorrectionFencedEmail({ to, raw: rawMime(false) }, { message: message(), actorUserId, mimeMode: 'raw', payload, encoding: 'latin1' }))
    .rejects.toMatchObject({ code: 'ediel_delivery_uncertain' })
  expect(io.actions).toEqual(['prepare', 'enter', 'observe'])
  expect(io.observation).toMatchObject({ smtpCode: null, queueId: null, error: { code: 'ETIMEDOUT', command: 'DATA' } })
  expect(io.snapshots).toHaveLength(1); expect(io.upload).toHaveBeenCalledTimes(1); expect(io.smtp).toHaveBeenCalledTimes(1)
  expect(io.rpc.mock.calls.filter(([name]) => name === 'gridex_outbound_dispatch_v1')).toHaveLength(1)
})
