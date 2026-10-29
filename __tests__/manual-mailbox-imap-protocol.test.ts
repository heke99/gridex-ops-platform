import net from 'node:net'
import { isDeepStrictEqual } from 'node:util'
import { afterEach, expect, it, vi } from 'vitest'
import type { ImapFlow as ImapFlowClient, ImapFlowOptions } from 'imapflow'
import type { ManualInboundEmail } from '@/lib/inbound-mail/manualInboundIngestion'

type Row = Record<string, unknown>

const fixture = vi.hoisted(() => ({
  port: 0,
  clients: [] as ImapFlowClient[],
  mailbox: {} as Row,
  ingested: [] as ManualInboundEmail[],
}))

// Keep the installed client's command queue and FETCH backpressure intact.
// Only connection configuration is adapted to this test's loopback server.
vi.mock('imapflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('imapflow')>()
  return {
    ...actual,
    ImapFlow: class extends actual.ImapFlow {
      constructor(options: ImapFlowOptions) {
        super({ ...options, host: '127.0.0.1', port: fixture.port, secure: false, doSTARTTLS: false, disableAutoIdle: true })
        fixture.clients.push(this)
      }
    },
  }
})

class MailboxQuery {
  private predicates: Array<(row: Row) => boolean> = []
  private patch: Row | undefined
  select() { return this }
  eq(column: string, value: unknown) {
    this.predicates.push(row => {
      if (row[column] && typeof row[column] === 'object' && typeof value === 'string') {
        try { return isDeepStrictEqual(row[column], JSON.parse(value)) } catch { return false }
      }
      return row[column] === value
    })
    return this
  }
  is(column: string, value: unknown) { this.predicates.push(row => (row[column] ?? null) === value); return this }
  not(column: string, _operator: string, value: unknown) { this.predicates.push(row => row[column] !== value); return this }
  or(value: string) {
    const cutoff = value.split('locked_at.lt.')[1]
    this.predicates.push(row => row.locked_at == null || String(row.locked_at) < cutoff)
    return this
  }
  update(patch: Row) { this.patch = patch; return this }
  private run() {
    const matches = this.predicates.every(predicate => predicate(fixture.mailbox))
    if (matches && this.patch) Object.assign(fixture.mailbox, this.patch)
    return { data: matches ? [{ ...fixture.mailbox }] : [], error: null }
  }
  async maybeSingle() { const result = this.run(); return { ...result, data: result.data[0] ?? null } }
  then(resolve: (result: ReturnType<MailboxQuery['run']>) => unknown, reject?: (error: unknown) => unknown) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject)
  }
}

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    if (table !== 'manual_communication_mailboxes') throw new Error(`Unexpected test table: ${table}`)
    return new MailboxQuery()
  },
} }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/email/manualOperationsMailbox', () => ({ resolveManualMailboxSecret: () => 'synthetic-loopback-password' }))
vi.mock('@/lib/inbound-mail/manualSenderVerification', () => ({
  verifyManualMailSender: async () => ({ status: 'unverified', reason: 'synthetic_protocol_fixture' }),
}))
vi.mock('@/lib/inbound-mail/manualInboundIngestion', () => ({
  async ingestManualInboundEmail(email: ManualInboundEmail) {
    fixture.ingested.push(email)
    return { inboundId: `fixture-${fixture.ingested.length}`, resolutionStatus: 'unmatched', companyId: null, requestId: null }
  },
}))

import { runManualInboundMailEngine } from '@/lib/inbound-mail/manualMailboxPoller'

let server: net.Server | undefined
const sockets = new Set<net.Socket>()

afterEach(async () => {
  for (const client of fixture.clients) client.close()
  for (const socket of sockets) socket.destroy()
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()))
  server = undefined
  fixture.clients = []
  sockets.clear()
  vi.unstubAllEnvs()
})

// Regression: awaiting UID STORE while a streaming FETCH generator is yielded
// leaves ImapFlow's command queue blocked and prevents the next email's intake.
it('bootstraps unread replies and ingests new replies even after an operator marks them Seen', async () => {
  fixture.ingested = []
  fixture.mailbox = {
    id: 'protocol-mailbox', company_id: null, environment: 'test',
    is_active: true, is_verified: true, imap_host: '127.0.0.1',
    imap_username: 'manual@example.invalid', from_email: 'manual@example.invalid',
    imap_secret_reference: 'env:PROTOCOL_FIXTURE_ONLY', imap_folder: 'INBOX',
    imap_secure: false, metadata: {}, locked_at: null, last_polled_at: null,
  }
  vi.stubEnv('MANUAL_INBOUND_MESSAGE_LIMIT_PER_MAILBOX', '2')
  const seen: number[] = []
  const seenFlags = new Set([100])
  const commands: string[] = []
  const unexpected: string[] = []
  const makeMessage = (uid: number, sequence: number) => ({
    uid,
    sequence,
    source: Buffer.from(`From: Grid owner <reply@owner.invalid>\r\nTo: manual@example.invalid\r\nSubject: Fixture ${uid}\r\nMessage-ID: <reply-${uid}@owner.invalid>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nAnläggningsuppgifter ${uid}.\r\n`),
  })
  const messages = [100, 101, 102].map((uid, index) => makeMessage(uid, index + 1))
  // IMAP sequence sets are inclusive and unordered. In particular, 104:*
  // includes UID103 when 103 is the largest existing UID; it is not empty.
  const inUidRange = (uid: number, range: string) => range.split(',').some(part => {
    const [start, last = start] = part.split(':')
    const highestUid = Math.max(...messages.map(message => message.uid))
    const lower = start === '*' ? highestUid : Number(start)
    const upper = last === '*' ? highestUid : Number(last)
    return uid >= Math.min(lower, upper) && uid <= Math.max(lower, upper)
  })

  server = net.createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    socket.write('* PREAUTH [CAPABILITY IMAP4rev1 NAMESPACE] Loopback fixture ready\r\n')
    let buffered = ''
    socket.on('data', chunk => {
      buffered += chunk.toString('utf8')
      let end: number
      while ((end = buffered.indexOf('\r\n')) >= 0) {
        const line = buffered.slice(0, end)
        buffered = buffered.slice(end + 2)
        const space = line.indexOf(' ')
        const tag = line.slice(0, space)
        const command = line.slice(space + 1)
        commands.push(command)
        const ok = () => socket.write(`${tag} OK completed\r\n`)
        if (command === 'CAPABILITY') {
          socket.write('* CAPABILITY IMAP4rev1 NAMESPACE\r\n'); ok()
        } else if (command === 'NAMESPACE') {
          socket.write('* NAMESPACE (("" "/")) NIL NIL\r\n'); ok()
        } else if (/^LIST /i.test(command)) {
          socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n'); ok()
        } else if (/^LSUB /i.test(command)) {
          socket.write('* LSUB (\\HasNoChildren) "/" "INBOX"\r\n'); ok()
        } else if (/^SELECT /i.test(command)) {
          const nextUid = Math.max(...messages.map(message => message.uid)) + 1
          socket.write(`* FLAGS (\\Seen)\r\n* ${messages.length} EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY 1] stable\r\n* OK [UIDNEXT ${nextUid}] next\r\n* OK [PERMANENTFLAGS (\\Seen \\*)] allowed\r\n`)
          socket.write(`${tag} OK [READ-WRITE] selected\r\n`)
        } else if (/^UID SEARCH /i.test(command)) {
          const criteria = command.slice('UID SEARCH '.length).split(' ')
          let selected = messages.slice()
          let unsupported = false
          for (let index = 0; index < criteria.length; index += 1) {
            const criterion = criteria[index].toUpperCase()
            if (criterion === 'UNSEEN') selected = selected.filter(message => !seenFlags.has(message.uid))
            else if (criterion === 'SEEN') selected = selected.filter(message => seenFlags.has(message.uid))
            else if (criterion === 'UID' && criteria[index + 1]) {
              const range = criteria[++index]
              selected = selected.filter(message => inUidRange(message.uid, range))
            } else if (criterion !== 'ALL') unsupported = true
          }
          if (unsupported) {
            unexpected.push(command)
            socket.write(`${tag} BAD unsupported fixture search\r\n`)
          } else {
            socket.write(`* SEARCH ${selected.map(message => message.uid).join(' ')}\r\n`); ok()
          }
        } else if (/^UID FETCH /i.test(command)) {
          const range = /^UID FETCH ([^ ]+)/i.exec(command)?.[1] ?? ''
          const selected = messages.filter(message => inUidRange(message.uid, range))
          for (const message of selected) {
            const envelope = `("Sun, 18 Oct 2026 12:00:00 +0000" "Fixture ${message.uid}" (("Grid owner" NIL "reply" "owner.invalid")) NIL NIL ((NIL NIL "manual" "example.invalid")) NIL NIL NIL "<reply-${message.uid}@owner.invalid>")`
            const internalDate = /INTERNALDATE/i.test(command) ? ' INTERNALDATE "18-Oct-2026 21:55:00 +0000"' : ''
            socket.write(`* ${message.sequence} FETCH (UID ${message.uid}${internalDate} ENVELOPE ${envelope} BODY[] {${message.source.length}}\r\n`)
            socket.write(message.source)
            socket.write(')\r\n')
          }
          ok()
        } else if (/^UID STORE \d+ \+FLAGS(?:\.SILENT)? \(\\Seen\)/i.test(command)) {
          const uid = Number(/^UID STORE (\d+)/i.exec(command)?.[1])
          seenFlags.add(uid)
          seen.push(uid); ok()
        } else if (command === 'LOGOUT') {
          socket.end(`* BYE closing\r\n${tag} OK logout\r\n`)
        } else {
          unexpected.push(command)
          socket.write(`${tag} BAD unsupported fixture command\r\n`)
        }
      }
    })
  })
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject)
    server!.listen(0, '127.0.0.1', resolve)
  })
  fixture.port = (server.address() as net.AddressInfo).port

  // This is a deadlock guard, not a production latency/SLO assertion. The fake
  // server and all external boundaries answer immediately on local loopback.
  async function pollWithoutDeadlock() {
    let deadline: ReturnType<typeof setTimeout> | undefined
    const polling = runManualInboundMailEngine({ environment: 'test' })
    const outcome = await Promise.race([
      polling.then(result => ({ completed: true as const, result })),
      new Promise<{ completed: false }>(resolve => { deadline = setTimeout(() => resolve({ completed: false }), 5_000) }),
    ])
    clearTimeout(deadline)
    if (!outcome.completed) {
      for (const client of fixture.clients) client.close()
      await polling
    }
    expect(unexpected).toEqual([])
    expect(outcome.completed, JSON.stringify({ commands, seen, ingested: fixture.ingested.length })).toBe(true)
    if (!outcome.completed) throw new Error('Loopback IMAP poll did not complete')
    return outcome.result
  }

  expect(await pollWithoutDeadlock()).toMatchObject({ polled: 1, fetched: 2, ingested: 2, errors: [] })
  expect(fixture.ingested.map(email => ({ id: email.providerMessageId, text: email.bodyText }))).toEqual([
    { id: '<reply-101@owner.invalid>', text: 'Anläggningsuppgifter 101.' },
    { id: '<reply-102@owner.invalid>', text: 'Anläggningsuppgifter 102.' },
  ])
  expect(seen).toEqual([101, 102])
  expect(fixture.ingested[0][Symbol.for('gridex.manual-mail.imap-receipt.v1') as keyof ManualInboundEmail]).toMatchObject({
    source: 'imap_internal_date', receivedAt: '2026-10-18T21:55:00.000Z', uid: 101, uidValidity: '1',
    mailbox: 'manual@example.invalid', mailboxId: 'protocol-mailbox',
  })
  expect(commands.some(command => /^UID FETCH /i.test(command) && /INTERNALDATE/i.test(command))).toBe(true)
  expect(fixture.mailbox).toMatchObject({ locked_at: null, locked_by: null, last_error: null })

  // Arrival after the bootstrap. Reading it in STRATO before the cron runs
  // must not lose the new reply; the historical Seen UID100 stays excluded.
  messages.push(makeMessage(103, 4))
  seenFlags.add(103)
  fixture.mailbox.last_polled_at = null
  const next = await pollWithoutDeadlock()
  expect(next, JSON.stringify({ commands, seen })).toMatchObject({ polled: 1, fetched: 1, ingested: 1, errors: [] })
  expect(fixture.ingested.map(email => email.providerMessageId)).toEqual([
    '<reply-101@owner.invalid>', '<reply-102@owner.invalid>', '<reply-103@owner.invalid>',
  ])
  expect(seen).toEqual([101, 102, 103])
  expect(fixture.mailbox).toMatchObject({ locked_at: null, locked_by: null, last_error: null })

  // Nothing arrived. A real IMAP server may still return UID103 for 104:*,
  // so the cursor's lower boundary must prevent another fetch/ingestion.
  fixture.mailbox.last_polled_at = null
  expect(await pollWithoutDeadlock(), JSON.stringify({ commands, seen })).toMatchObject({
    polled: 1, fetched: 0, ingested: 0, errors: [],
  })
  expect(fixture.ingested.map(email => email.providerMessageId)).toEqual([
    '<reply-101@owner.invalid>', '<reply-102@owner.invalid>', '<reply-103@owner.invalid>',
  ])
  expect(seen).toEqual([101, 102, 103])
}, 10_000)
