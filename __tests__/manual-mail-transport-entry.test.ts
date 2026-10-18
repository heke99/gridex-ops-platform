import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { SendEdielEmailInput } from '@/lib/email/sendEdielEmail'

type Row = Record<string, unknown>
type EntryDenial = 'manual_supplier_transport_not_ready' | 'manual_supplier_transport_start_before_floor'
const io = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), smtp: vi.fn(), upload: vi.fn(), download: vi.fn(),
  objects: new Map<string, Buffer>(), snapshots: [] as Row[], actions: [] as string[],
  denialAfterPrepare: null as EntryDenial | null, entryError: null as Row | null,
  binding: null as Row | null, attemptId: '',
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: io.rpc, from: io.from,
  storage: { from: () => ({ upload: io.upload, download: io.download }) },
} }))
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail: io.smtp }) } }))

import { createGenericEdielAttemptGate } from '@/lib/ediel/transport/outboundAttempt'
import { sendCorrectionFencedEmail } from '@/lib/ediel/sources/correctionOutboundDispatch'
import { sendEdielEmail } from '@/lib/email/sendEdielEmail'

const companyId = '11111111-1111-4111-8111-111111111111'
const messageId = '22222222-2222-4222-8222-222222222222'
const actorUserId = '33333333-3333-4333-8333-333333333333'
const snapshotId = '44444444-4444-4444-8444-444444444444'
const switchRequestId = '55555555-5555-4555-8555-555555555555'
const customerId = '66666666-6666-4666-8666-666666666666'
const siteId = '77777777-7777-4777-8777-777777777777'
const observedAt = '2026-10-18T18:30:00Z'
const recipient = 'counterparty@example.invalid'
const original = "UNB+SYNTHETIC'UNH+M+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+NORMAL-SWITCH+9'DTM+137:20261018:102'"
const payload = Buffer.from(original, 'latin1')
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const raw = Buffer.from([
  'From: sender@example.invalid', `To: ${recipient}`, 'Message-ID: <normal-switch@example.invalid>',
  'Content-Type: application/EDIFACT', '', original, '',
].join('\r\n'), 'latin1')
const message: EdielMessageRow = {
  id: messageId, company_id: companyId, environment: 'production', direction: 'outbound',
  message_standard: 'edifact', message_family: 'PRODAT', message_code: 'Z03',
  switch_request_id: switchRequestId, customer_id: customerId, site_id: siteId,
  communication_route_id: null, raw_payload: original,
} as EdielMessageRow
const context = { message, actorUserId, mimeMode: 'raw', payload, encoding: 'latin1' }

// Real MIME archival/readback, provider-entry callback, attempt gate and sender.
// The external RPC supplies the new SQL trigger's denial; separate SQL tests
// prove the trigger's actual supplier-state/date decision. No mail is delivered.
beforeEach(() => {
  vi.clearAllMocks()
  io.objects = new Map(); io.snapshots = []; io.actions = []
  io.denialAfterPrepare = null; io.entryError = null; io.binding = null; io.attemptId = ''
  for (const [key, value] of Object.entries({
    EMAIL_PROVIDER: 'resend', EDIEL_EMAIL_PROVIDER: 'strato', EDIEL_SMTP_HOST: 'smtp.example.invalid',
    EDIEL_SMTP_PORT: '587', EDIEL_SMTP_SECURE: 'false', EDIEL_SMTP_USER: 'synthetic-user',
    EDIEL_SMTP_PASS: 'synthetic-local-only', EDIEL_SMTP_FROM: 'sender@example.invalid',
  })) vi.stubEnv(key, value)
  io.upload.mockImplementation(async (path: string, bytes: Buffer) => {
    io.objects.set(path, Buffer.from(bytes))
    return { error: null }
  })
  io.download.mockImplementation(async (path: string) => ({
    data: io.objects.has(path) ? new Blob([Uint8Array.from(io.objects.get(path)!).buffer]) : null, error: null,
  }))
  io.from.mockImplementation((table: string) => {
    if (table === 'ediel_message_payloads') return {
      insert: (row: Row) => {
        io.snapshots.push(row)
        return { select: () => ({ single: async () => ({ data: { id: snapshotId }, error: null }) }) }
      },
    }
    if (table !== 'ediel_messages') throw new Error(`unexpected external table ${table}`)
    const filters = new Map<string, unknown>()
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.set(key, value); return query },
      maybeSingle: async () => ({
        data: filters.get('id') === messageId && filters.get('company_id') === companyId ? message : null,
        error: null,
      }),
    }
    return query
  })
  io.rpc.mockImplementation(async (name: string, args: Row) => {
    if (name === 'ediel_require_source_bytes_available_v1') return { data: null, error: null }
    if (name !== 'gridex_ediel_transport_attempt_v1') throw new Error(`unexpected external RPC ${name}`)
    const input = args.p_input as Row
    if (input.companyId !== companyId || input.messageId !== messageId || input.actorUserId !== actorUserId
      || input.environment !== 'production') throw new Error('external attempt scope mismatch')
    io.actions.push(String(input.action))
    if (input.action === 'prepare') {
      io.binding = input.binding as Row; io.attemptId = String(input.attemptId)
      return { data: { proceed: true }, error: null }
    }
    if (input.attemptId !== io.attemptId) throw new Error('external attempt identity changed')
    if (input.action === 'enter' && io.denialAfterPrepare) {
      io.entryError = { code: '23514', message: io.denialAfterPrepare, details: null, hint: null }
      return { data: null, error: io.entryError }
    }
    if (input.action === 'observe') return { data: { classification: 'accepted', observedAt }, error: null }
    if (input.action === 'enter') return { data: { proceed: true }, error: null }
    throw new Error(`unexpected external attempt action ${String(input.action)}`)
  })
  io.smtp.mockImplementation(async () => {
    io.actions.push('smtp')
    return { accepted: [recipient], rejected: [], messageId: '<synthetic-provider@example.invalid>', response: '250 queued as SYNTHETIC' }
  })
})
afterEach(() => vi.unstubAllEnvs())

function inputFor(mode: 'raw' | 'attachment'): SendEdielEmailInput {
  return mode === 'raw' ? { to: recipient, raw } : {
    to: recipient, subject: 'Synthetic normal supplier switch',
    attachments: [{ filename: 'switch.edi', content: payload }],
  }
}
async function send(lane: 'direct_gate' | 'correction_wrapper', mode: 'raw' | 'attachment') {
  const input = inputFor(mode)
  const dispatchContext = { ...context, mimeMode: mode }
  if (lane === 'correction_wrapper') return sendCorrectionFencedEmail(input, dispatchContext)
  const gate = createGenericEdielAttemptGate(input, dispatchContext)
  return gate.capture(await sendEdielEmail(input, gate.entry))
}

describe.each(['direct_gate', 'correction_wrapper'] as const)('%s respects manual supplier checks at provider entry', lane => {
  for (const mode of ['raw', 'attachment'] as const) {
    it.each(['manual_supplier_transport_not_ready', 'manual_supplier_transport_start_before_floor'] as const)(
      `stops ${mode} before SMTP when entry rejects with %s after successful preparation`, async denial => {
        io.denialAfterPrepare = denial
        const attempt = send(lane, mode)
        if (lane === 'direct_gate') await expect(attempt).rejects.toMatchObject({ code: '23514', message: denial })
        else await expect(attempt).rejects.toMatchObject({ code: 'ediel_delivery_uncertain', cause: { code: '23514', message: denial } })
        expect(io.smtp).not.toHaveBeenCalled()
        expect(io.actions.slice(0, 2)).toEqual(['prepare', 'enter'])
        expect(io.snapshots).toHaveLength(1)
        expect(io.binding).toMatchObject({ payloadHash: hash(payload), payloadLength: payload.length, mimePayloadSnapshotId: snapshotId })
      },
    )

    it(`sends the exact archived ${mode} bytes only after the entry RPC permits them`, async () => {
      await expect(send(lane, mode)).resolves.toMatchObject({ accepted: [recipient], rejected: [], dispatchObservedAt: observedAt })
      expect(io.actions).toEqual(['prepare', 'enter', 'smtp', 'observe'])
      expect(io.smtp).toHaveBeenCalledTimes(1)
      const sent = io.smtp.mock.calls[0][0] as { envelope: { from: string; to: string[] }; raw: Buffer }
      expect(sent.envelope).toEqual({ from: 'sender@example.invalid', to: [recipient] })
      expect(io.binding).toMatchObject({ rawBase64: sent.raw.toString('base64'), mimeSha256: hash(sent.raw), mimeLength: sent.raw.length })
      expect([...io.objects.values()][0].equals(sent.raw)).toBe(true)
      expect(io.download.mock.invocationCallOrder[0]).toBeLessThan(io.smtp.mock.invocationCallOrder[0])
      if (mode === 'raw') expect(sent.raw.equals(raw)).toBe(true)
      else {
        const mime = sent.raw.toString('latin1')
        expect(mime).toContain('Content-Transfer-Encoding: base64\r\n')
        expect(Buffer.from(mime.slice(mime.indexOf('\r\n\r\n') + 4), 'base64').equals(payload)).toBe(true)
      }
    })
  }
})
