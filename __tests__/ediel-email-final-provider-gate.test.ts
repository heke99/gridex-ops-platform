// masterplan: OPS-04, AT-OPS-04
// Component controls use finite archive, journal, MIME-composer and SMTP ports.
// SQL authority, durable one-use and actual transport are qualified separately.
import {beforeEach, describe, expect, it, vi} from 'vitest'
import {createHash} from 'node:crypto'
import type {SendEdielEmailInput} from '@/lib/email/sendEdielEmail'

const finalIo = vi.hoisted(() => ({
  events: [] as string[], sent: [] as unknown[], archived: [] as Buffer[],
  compiled: Buffer.from('Message-ID: <finite-attachment@example.invalid>\r\n\r\nFINITE ATTACHMENT'),
}))
vi.mock('nodemailer', () => ({default: {createTransport: () => ({sendMail: async (input: unknown) => {
  finalIo.events.push('provider'); finalIo.sent.push(input)
  return {accepted: ['receiver@example.invalid'], rejected: [], messageId: 'finite-provider', response: '250 finite'}
}})}}))
vi.mock('nodemailer/lib/mail-composer', () => ({default: class {
  compile() { return {build: async () => {finalIo.events.push('compile'); return Buffer.from(finalIo.compiled)}} }
}}))
vi.mock('@/lib/ediel/mailReadiness', () => ({
  assertEdielSmtpReadiness: () => ({provider: 'strato'}),
  edielSmtpConfig: () => ({from: 'sender@example.invalid', replyTo: 'reply@example.invalid',
    host: 'smtp.example.invalid', port: 465, secure: true, user: 'finite', password: 'FINITE_ONLY'}),
}))
vi.mock('@/lib/ediel/transport/rawMimeArchive', () => ({archiveTransportRawMime: async (raw: Buffer) => {
  finalIo.events.push('archive'); finalIo.archived.push(Buffer.from(raw))
  return {mimeArchiveRef: 'finite://archive', mimeSha256: createHash('sha256').update(raw).digest('hex'),
    mimeLength: raw.length, rfcMessageId: '<finite@example.invalid>', mimePayloadSnapshotId: 'finite-snapshot'}
}}))
import {sendEdielEmail} from '@/lib/email/sendEdielEmail'

beforeEach(() => {finalIo.events = []; finalIo.sent = []; finalIo.archived = []})
function finalInput(mode: 'raw' | 'attachment'): SendEdielEmailInput {
  return mode === 'raw'
    ? {raw: Buffer.from('Message-ID: <finite-raw@example.invalid>\r\n\r\nFINITE RAW'),
      to: 'receiver@example.invalid', envelopeFrom: 'sender@example.invalid'}
    : {to: 'receiver@example.invalid', from: 'sender@example.invalid', subject: 'FINITE', text: 'FINITE',
      attachments: [{filename: 'finite.edi', content: Buffer.from('FINITE PAYLOAD'), contentType: 'application/EDIFACT'}]}
}
function finalEntry(prepare?: () => Promise<void>, enter?: () => Promise<void>) {
  return {archiveContext: {companyId: 'finite-company', messageId: 'finite-message'},
    beforeProviderCall: async () => {
      finalIo.events.push('prepare'); await prepare?.()
      finalIo.events.push('enter'); await enter?.()
      finalIo.events.push('journal-return')
    }}
}
for (const mode of ['raw', 'attachment'] as const) describe('OPS04 final provider hook: ' + mode, () => {
  it('awaits the existing journal then the final authority before the same provider call', async () => {
    const input = finalInput(mode)
    input.finalProviderGate = async actual => {
      finalIo.events.push('final-authority')
      expect(finalIo.events.slice(-4)).toEqual(['prepare', 'enter', 'journal-return', 'final-authority'])
      expect(finalIo.sent).toHaveLength(0)
      expect(actual.to).toBe('receiver@example.invalid')
      expect(actual.mimeSha256).toBe(createHash('sha256').update(finalIo.archived[0]).digest('hex'))
      expect(Buffer.from(actual.rawBase64 as string, 'base64')).toEqual(finalIo.archived[0])
    }
    await sendEdielEmail(input, finalEntry())
    expect(finalIo.events.slice(-2)).toEqual(['final-authority', 'provider'])
    expect(finalIo.sent).toHaveLength(1)
    expect((finalIo.sent[0] as {raw: Buffer}).raw).toEqual(finalIo.archived[0])
  })
  it('does not run the final hook or provider when the existing journal refuses entry', async () => {
    const input = finalInput(mode), gate = vi.fn(async () => undefined)
    input.finalProviderGate = gate
    const denied = new Error('FINITE_EXISTING_ENTRY_DENIED')
    await expect(sendEdielEmail(input, finalEntry(undefined, async () => {throw denied}))).rejects.toBe(denied)
    expect(gate).not.toHaveBeenCalled(); expect(finalIo.sent).toHaveLength(0)
    expect(finalIo.archived).toHaveLength(1)
  })
  for (const waitAt of ['prepare', 'enter'] as const) it('refuses newly revoked authority after the actual ' + waitAt + ' wait', async () => {
    const input = finalInput(mode), authority = {active: true}, refused = new Error('FINITE_AUTHORITY_REVOKED')
    input.finalProviderGate = async () => {finalIo.events.push('final-authority'); if (!authority.active) throw refused}
    const revoke = async () => {await Promise.resolve(); authority.active = false}
    const entry = waitAt === 'prepare' ? finalEntry(revoke) : finalEntry(undefined, revoke)
    await expect(sendEdielEmail(input, entry)).rejects.toBe(refused)
    expect(finalIo.events.slice(-2)).toEqual(['journal-return', 'final-authority'])
    expect(finalIo.sent).toHaveLength(0); expect(finalIo.archived).toHaveLength(1)
  })
  it('does not enter the provider while final authority consumption is still pending', async () => {
    let arrive!: () => void, release!: () => void
    const arrived = new Promise<void>(resolve => {arrive = resolve})
    const released = new Promise<void>(resolve => {release = resolve})
    const input = finalInput(mode)
    input.finalProviderGate = async () => {arrive(); await released}
    const sending = sendEdielEmail(input, finalEntry())
    await arrived; expect(finalIo.sent).toHaveLength(0)
    release(); await sending; expect(finalIo.sent).toHaveLength(1)
  })
  it('captures the gate and actual envelope/bytes before asynchronous caller mutation', async () => {
    const input = finalInput(mode), originalRaw = 'raw' in input ? Buffer.from(input.raw) : Buffer.from(finalIo.compiled)
    const captured = vi.fn(async (actual: Readonly<Record<string, unknown>>) => {
      expect(actual.to).toBe('receiver@example.invalid'); expect(actual.from).toBe('sender@example.invalid')
      expect(Buffer.from(actual.rawBase64 as string, 'base64')).toEqual(originalRaw)
    })
    const replacement = vi.fn(async () => {throw new Error('CALLER_REPLACED_GATE')})
    input.finalProviderGate = captured
    await sendEdielEmail(input, finalEntry(async () => {
      await Promise.resolve(); input.to = 'wrong@example.invalid'; input.finalProviderGate = replacement
      if ('raw' in input) {input.raw.fill(0); input.envelopeFrom = 'wrong-sender@example.invalid'}
      else input.from = 'wrong-sender@example.invalid'
    }))
    expect(captured).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled()
    expect(finalIo.sent).toHaveLength(1)
    expect(finalIo.sent[0]).toMatchObject({envelope: {from: 'sender@example.invalid', to: ['receiver@example.invalid']}})
    expect((finalIo.sent[0] as {raw: Buffer}).raw).toEqual(originalRaw)
  })
  it('keeps a separate final binding snapshot if the earlier callback mutates its argument', async () => {
    const input = finalInput(mode)
    input.finalProviderGate = async actual => {
      expect(actual.to).toBe('receiver@example.invalid'); expect(actual.rawBase64).not.toBe('MUTATED')
      expect(Object.isFrozen(actual)).toBe(true)
    }
    await sendEdielEmail(input, {archiveContext: {companyId: 'finite-company', messageId: 'finite-message'},
      beforeProviderCall: async actual => {actual.to = 'wrong@example.invalid'; actual.rawBase64 = 'MUTATED'}})
    expect(finalIo.sent).toHaveLength(1)
  })
  it('preserves the existing ordinary send through the required journal when no final hook is selected', async () => {
    await sendEdielEmail(finalInput(mode), finalEntry())
    expect(finalIo.events.slice(-2)).toEqual(['journal-return', 'provider'])
    expect(finalIo.sent).toHaveLength(1)
    expect((finalIo.sent[0] as {raw: Buffer}).raw).toEqual(finalIo.archived[0])
  })
  it('fails closed for a malformed supplied hook before any archive or provider work', async () => {
    const input = finalInput(mode)
    Reflect.set(input, 'finalProviderGate', true)
    await expect(sendEdielEmail(input, finalEntry())).rejects.toThrow('ediel_final_provider_gate_invalid')
    expect(finalIo.archived).toHaveLength(0); expect(finalIo.sent).toHaveLength(0)
  })
  it('retains the mandatory existing archive/journal entry contract even when a hook is supplied', async () => {
    const input = finalInput(mode), gate = vi.fn(async () => undefined)
    input.finalProviderGate = gate
    await expect(sendEdielEmail(input)).rejects.toThrow('ediel_transport_archive_context_required')
    expect(gate).not.toHaveBeenCalled(); expect(finalIo.archived).toHaveLength(0); expect(finalIo.sent).toHaveLength(0)
  })
})
