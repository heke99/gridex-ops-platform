// reality-defects: J3-01, J3-02, J3-05, J3-06, J3-10 (inbound Ediel robustness: framing of the physical interchange)
//
// Production path: storeMailboxFetchMessage -> splitMimeParts stores raw_edifact_payload plus every decoded
// attachment; processInboundEmailMessage then picks the EDIFACT to parse. Real MIME is built with nodemailer's
// MailComposer (the transport the grid-owner simulator uses) and decoded by the production splitMimeParts.
//   J3-01 an attachment ending with CRLF (or starting with a BOM) differs from the extracted payload, so both were
//         joined: two copies of a UNA interchange -> edifact_dangling_release_character on every retry (F3 variant).
//   J3-02 two EDIFACT attachments were merged into one payload (first UNA/UNB to the LAST "UNZ" of all texts), and a
//         cover letter mentioning "unzip" extended a valid file into free text.
//   J3-05 a test interchange (UNB 0035=1) in the production mailbox was attributed and processed as production.
//   J3-06 a truncated file (dangling release character) threw in the pure parser: five job retries, then "failed",
//         with the mail itself still "received" and no reason on it.
//   J3-10 the extractor matched "UNA"/"UNB" case-insensitively anywhere: an inline file after prose such as "We are
//         unable to attach" was framed from "unable", and "unable to" became the service string advice.
import MailComposer from 'nodemailer/lib/mail-composer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { splitMimeParts } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { countInterchanges, selectInboundEdifactInterchange, strictEdifactPayload, unbTestIndicator } from '@/lib/inbound-mail/inboundEdifactSources'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  mail: {} as Row,
  attachments: [] as Row[],
  parsedInputs: [] as Array<{ attachmentText?: string | null }>,
  parsed: [] as Array<Record<string, unknown> | null>,
  parseErrors: [] as string[],
}))
const mocks = vi.hoisted(() => ({ update: vi.fn(), task: vi.fn(), tenant: vi.fn(), create: vi.fn() }))

vi.mock('@/lib/inbound-mail/edielEmailParser', async (original) => {
  const actual = await original<typeof import('@/lib/inbound-mail/edielEmailParser')>()
  return { ...actual, parseInboundEmailContent: (input: Parameters<typeof actual.parseInboundEmailContent>[0]) => {
    io.parsedInputs.push(input)
    try { const result = actual.parseInboundEmailContent(input); io.parsed.push(result as never); return result }
    catch (error) { io.parseErrors.push((error as Error).message); throw error }
  } }
})
vi.mock('@/lib/ediel/inbound/receptions', () => ({
  InboundReceptionHeldError: class extends Error {},
  readUnattributedTechnicalIntake: async () => null,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from: (table: string) => {
    const result = () => table === 'inbound_email_messages' ? { data: { ...io.mail }, error: null }
      : table === 'inbound_email_attachments' ? { data: io.attachments.map(row => ({ ...row })), error: null }
        : { data: null, error: null }
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'order', 'limit', 'not', 'or', 'is', 'update']) query[method] = () => query
    query.maybeSingle = async () => result()
    query.single = async () => result()
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve)
    return query
  },
  rpc: async () => ({ data: null, error: null }),
} }))
vi.mock('@/lib/inbound-mail/inboundStatusUpdater', () => ({
  updateInboundEmailProcessingStatus: mocks.update,
  createParseResult: vi.fn(async () => 'parse-1'),
  createInboundEdielMessage: mocks.create,
  createUnresolvedInboundEdielMessage: vi.fn(), applySafeInboundStatusUpdate: vi.fn(),
}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({ createInboundMailTask: mocks.task }))
vi.mock('@/lib/inbound-mail/inboundMatcher', () => ({
  matchOutboundRequestForInbound: async () => ({ status: 'missing', entityId: null, entityType: null, reasons: [], candidates: [] }),
  matchMeteringPointForInbound: async () => ({ status: 'missing', entityId: null, entityType: null, reasons: [], candidates: [] }),
}))
vi.mock('@/lib/inbound-mail/inboundTenantResolver', () => ({ resolveTenantForInboundEdiel: mocks.tenant }))

import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'

/** A complete UTILTS E66 interchange (same wire as the F3 regression), CRLF segment lines. */
function e66(reference: string, receiver: string, options: { testIndicator?: '' | '1'; eol?: string } = {}) {
  const indicator = options.testIndicator ?? '1'
  const body = [
    `UNB+UNOC:3+80001:ZZ+${receiver}:ZZ+260902:0600+${reference}++23-DDQ-E66-T${indicator === '1' ? '++++1' : ''}'`,
    "UNH+1+UTILTS:D:02B:UN:E5SE5A'", `BGM+E66::260+M${reference}+9+AB'`, "DTM+137:202609020600:203'", "DTM+735:?+0200:406'",
    "MKS+23+E02::260'", "NAD+MS+80001:SVK:260'", `NAD+MR+${receiver}:SVK:260'`, "IDE+24+T260901000001'", "LOC+172+735999000000000017::9'",
    "LIN+++8716867000030:::9'", "DTM+324:202609010000202609020000:719'", "QTY+136:0.125'",
  ]
  return ["UNA:+.? '", ...body, `UNT+${body.length - 1}+1'`, `UNZ+1+${reference}'`].join(options.eol ?? '\r\n')
}

async function mime(input: { attachments: Array<{ filename: string; content: string | Buffer; contentType: string }>; text?: string }) {
  return await new Promise<Buffer>((resolve, reject) => new MailComposer({ from: 'natagare@example.invalid', to: 'gridex-ediel@example.invalid',
    subject: 'UTILTS E66', text: input.text ?? 'Ediel', attachments: input.attachments })
    .compile().build((error: Error | null, message: Buffer) => error ? reject(error) : resolve(message)))
}

/** What storeMailboxFetchMessage stores for this mail (production splitMimeParts). */
async function storeLikeReception(raw: Buffer, environment: 'test' | 'production' = 'test') {
  const parts = splitMimeParts(raw)
  io.mail = { id: 'mail1', company_id: null, mailbox_id: 'mb1', environment, raw_email: raw.toString('utf8'), body_text: parts.bodyText,
    raw_edifact_payload: parts.rawEdifactPayload, has_attachments: parts.attachments.length > 0, ediel_mailboxes: { id: 'mb1', environment } }
  io.attachments = parts.attachments.map((attachment, index) => ({ id: `att${index}`, inbound_email_message_id: 'mail1', filename: attachment.filename,
    mime_type: attachment.mimeType, raw_text: attachment.rawText, is_edifact_candidate: attachment.isEdifactCandidate }))
  return parts
}

const lastUpdate = () => mocks.update.mock.calls.at(-1)?.[0] as Record<string, unknown> | undefined

beforeEach(() => {
  io.parsedInputs = []; io.parsed = []; io.parseErrors = []
  vi.clearAllMocks()
  mocks.tenant.mockResolvedValue({ status: 'unassigned', companyId: null, reasons: ['fixture stops after tenant resolution'], candidates: [], evidence: [], shared: null })
})

describe('J3-01 one EDIFACT attachment ending with a newline is parsed once', () => {
  it('parses a CRLF-terminated UNA interchange instead of failing with a doubled copy', async () => {
    const file = e66('REFA0001', '70001') + '\r\n'
    const parts = await storeLikeReception(await mime({ attachments: [{ filename: 'E66.edi', content: file, contentType: 'application/edifact' }] }))
    // The stored projections really differ: the extracted payload is trimmed, the decoded attachment is not.
    expect(parts.rawEdifactPayload).not.toBe(parts.attachments[0].rawText)
    await processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' })
    expect(io.parseErrors).toEqual([])
    expect(io.parsedInputs[0].attachmentText?.match(/UNA:/g)).toHaveLength(1)
    expect(io.parsed[0]).toMatchObject({ messageFamily: 'UTILTS', messageCode: 'E66', interchangeReference: 'REFA0001' })
    expect(mocks.tenant).toHaveBeenCalledTimes(1)
  })

  it('also when the attachment starts with a byte-order mark', async () => {
    const file = '﻿' + e66('REFB0001', '70001')
    await storeLikeReception(await mime({ attachments: [{ filename: 'E66.edi', content: Buffer.from(file, 'utf8'), contentType: 'application/edifact' }] }))
    await processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' })
    expect(io.parseErrors).toEqual([])
    expect(io.parsed[0]).toMatchObject({ interchangeReference: 'REFB0001' })
  })
})

describe('J3-02 several interchanges in one mail are never merged', () => {
  it('holds a mail with two EDIFACT attachments visibly, without parsing, routing or acknowledging a merged payload', async () => {
    await storeLikeReception(await mime({ attachments: [
      { filename: 'E66_A.edi', content: e66('REFA0002', '70001', { eol: '\n' }), contentType: 'application/edifact' },
      { filename: 'E66_B.edi', content: e66('REFB0002', '70002', { eol: '\n' }), contentType: 'application/edifact' },
    ] }))
    const outcome = await processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' })
    expect(outcome.status).toBe('manual_review')
    expect(io.parsedInputs).toEqual([])
    expect(mocks.tenant).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(lastUpdate()).toMatchObject({ status: 'manual_review', matchStatus: 'multiple_interchanges',
      matchPayload: { interchangeCount: 2, interchangeReferences: ['REFA0002', 'REFB0002'], authorizesBusinessEffect: false } })
  })

  it('does not extend a valid file into a cover letter that mentions "unzip"', async () => {
    const file = e66('REFC0002', '70001')
    await storeLikeReception(await mime({ attachments: [
      { filename: 'E66.edi', content: file, contentType: 'application/edifact' },
      { filename: 'readme.txt', content: 'Hej! Please unzip the archive if needed.\nMvh Hans Kunz', contentType: 'text/plain' },
    ] }))
    await processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' })
    expect(io.parseErrors).toEqual([])
    expect(io.parsedInputs[0].attachmentText).toBe(file)
    expect((io.parsed[0]?.segments as string[]).at(-1)).toBe('UNZ+1+REFC0002')
  })

  it('counts two interchanges inside one attachment', () => {
    const two = [e66('REFD0001', '70001'), e66('REFD0002', '70001').replace(/^UNA[^\n]*\n/, '')].join('\r\n')
    expect(countInterchanges(two)).toBe(2)
    expect(selectInboundEdifactInterchange([{ text: two }])).toMatchObject({ kind: 'multiple', interchangeCount: 2 })
  })

  it('does not count an S/MIME container that repeats the decrypted MIME as another interchange', () => {
    const file = e66('REFE0001', '70001')
    const decryptedMime = `Content-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: application/edifact\r\n\r\n${file}\r\n--b--\r\n`
    expect(selectInboundEdifactInterchange([{ text: file }, { text: decryptedMime, filename: 'smime.p7m', mimeType: 'application/pkcs7-mime' }]))
      .toMatchObject({ kind: 'single', payload: file })
  })

  it('finds an inline interchange after prose ("unable", "Kunz") at its real UNB, not inside a word', () => {
    const file = e66('REFF0001', '70001').replace(/^UNA[^\n]*\n/, '')
    expect(strictEdifactPayload(`We are unable to attach files.\nMvh Hans Kunz\n${file}`)).toBe(file)
  })
})

describe('J3-05 a test interchange in the production mailbox', () => {
  it('is held before tenant routing instead of being processed as production', async () => {
    await storeLikeReception(await mime({ attachments: [{ filename: 'E66.edi', content: e66('REFG0001', '70001', { testIndicator: '1' }), contentType: 'application/edifact' }] }), 'production')
    const outcome = await processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' })
    expect(outcome.status).toBe('manual_review')
    expect(mocks.tenant).not.toHaveBeenCalled()
    expect(lastUpdate()).toMatchObject({ matchStatus: 'environment_mismatch', matchPayload: { unbTestIndicator: '1', interchangeReference: 'REFG0001' } })
  })

  it('lets a production interchange (0035 omitted) in the production mailbox reach tenant routing', async () => {
    const file = e66('REFH0001', '70001', { testIndicator: '' })
    expect(unbTestIndicator(file)).toBe('')
    await storeLikeReception(await mime({ attachments: [{ filename: 'E66.edi', content: file, contentType: 'application/edifact' }] }), 'production')
    await processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' })
    expect(mocks.tenant).toHaveBeenCalledTimes(1)
    expect(mocks.tenant.mock.calls[0][0]).toMatchObject({ environment: 'production' })
  })
})

describe('J3-06 a truncated file', () => {
  it('is held on the mail with the parser reason instead of throwing into five blind job retries', async () => {
    const file = e66('REFI0001', '70001')
    const truncated = file.slice(0, file.indexOf("DTM+735")) + 'FTX+AAO+++avkortad?'
    await storeLikeReception(await mime({ attachments: [{ filename: 'E66.edi', content: truncated, contentType: 'application/edifact' }] }))
    const outcome = await processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' })
    expect(outcome.status).toBe('manual_review')
    expect(io.parseErrors).toEqual(['edifact_dangling_release_character'])
    expect(mocks.tenant).not.toHaveBeenCalled()
    expect(lastUpdate()).toMatchObject({ status: 'manual_review', matchStatus: 'edifact_unparseable', matchPayload: { reason: 'edifact_dangling_release_character' } })
  })
})

describe('J3-10 an inline interchange after prose', () => {
  it('is framed at its UNB, not at "unable" in the sentence before it', async () => {
    const file = e66('REFJ0001', '70001').replace(/^UNA[^\n]*\n/, '')
    const raw = Buffer.from(['From: natagare@example.invalid', 'To: gridex-ediel@example.invalid', 'Subject: E66', 'Message-ID: <j3-inline@example.invalid>',
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=us-ascii', '', 'Hej! We are unable to attach files, the file follows.', file, ''].join('\r\n'), 'latin1')
    const parts = await storeLikeReception(raw)
    // Reception itself stores the misframed text (the store-time extractor is shared and unchanged).
    expect(parts.rawEdifactPayload?.startsWith('unable')).toBe(true)
    await processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' })
    expect(io.parseErrors).toEqual([])
    expect(io.parsed[0]).toMatchObject({ messageFamily: 'UTILTS', interchangeReference: 'REFJ0001', receiverEdielId: '70001' })
  })
})

describe('J3-03 a file in the wrong encoding', () => {
  it('is held as a mail without readable EDIFACT', async () => {
    const utf16 = Buffer.from(e66('REFK0001', '70001'), 'utf16le').toString('base64')
    const raw = Buffer.from(['From: natagare@example.invalid', 'To: gridex-ediel@example.invalid', 'Subject: E66', 'Message-ID: <j3-utf16@example.invalid>',
      'MIME-Version: 1.0', 'Content-Type: application/edifact', 'Content-Transfer-Encoding: base64', '', utf16, ''].join('\r\n'), 'latin1')
    await storeLikeReception(raw)
    io.mail.body_text = String(io.mail.body_text).replace(/\u0000/g, '\uFFFD')
    const outcome = await processInboundEmailMessage({ inboundEmailMessageId: 'mail1', actorUserId: 'actor-1' })
    expect(outcome.status).toBe('manual_review')
    expect(lastUpdate()).toMatchObject({ matchStatus: 'missing_payload' })
  })
})
