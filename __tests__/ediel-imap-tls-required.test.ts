// Sim finding 20261029-3f1a8ab1/claude-track3/014: IMAP must never fall back to
// cleartext. Every connection uses IMAPS or mandatory STARTTLS; a server that
// does not offer STARTTLS aborts the connection before any LOGIN is sent.
// Real ImapFlow is used against a loopback fake server; only host/port are
// redirected, the transport options produced by the pollers are kept.
import net from 'node:net'
import { isDeepStrictEqual } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImapFlowOptions } from 'imapflow'
import type { EdielMailboxRow } from '@/lib/inbound-mail/edielMailboxPoller.part-1'

type Row = Record<string, unknown>
const fx = vi.hoisted(() => ({
  port: 0,
  options: [] as Array<Record<string, unknown>>,
  commands: [] as string[],
  manualMailbox: {} as Record<string, unknown>,
}))

vi.mock('imapflow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('imapflow')>()
  return {
    ...actual,
    ImapFlow: class extends actual.ImapFlow {
      private capturedSecure: boolean
      constructor(options: ImapFlowOptions) {
        fx.options.push({ ...options } as Record<string, unknown>)
        super({ ...options, host: '127.0.0.1', port: fx.port, connectionTimeout: 3000, greetingTimeout: 3000 })
        this.capturedSecure = options.secure === true
      }
      async connect() {
        // Implicit TLS is asserted from the captured options only.
        if (this.capturedSecure) throw new Error('fixture: IMAPS not dialled')
        return super.connect()
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
  not(column: string, _op: string, value: unknown) { this.predicates.push(row => row[column] !== value); return this }
  or(value: string) {
    const cutoff = value.split('locked_at.lt.')[1]
    this.predicates.push(row => row.locked_at == null || String(row.locked_at) < cutoff)
    return this
  }
  update(patch: Row) { this.patch = patch; return this }
  private run() {
    const matches = this.predicates.every(p => p(fx.manualMailbox))
    if (matches && this.patch) Object.assign(fx.manualMailbox, this.patch)
    return { data: matches ? [{ ...fx.manualMailbox }] : [], error: null }
  }
  async maybeSingle() { const r = this.run(); return { ...r, data: r.data[0] ?? null } }
  then(resolve: (r: ReturnType<MailboxQuery['run']>) => unknown, reject?: (e: unknown) => unknown) {
    return Promise.resolve().then(() => this.run()).then(resolve, reject)
  }
}

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    if (table !== 'manual_communication_mailboxes') throw new Error(`unexpected table ${table}`)
    return new MailboxQuery()
  },
} }))
vi.mock('@/lib/platform/schemaReadiness', () => ({ assertPlatformSchemaReady: async () => undefined }))
vi.mock('@/lib/email/manualOperationsMailbox', () => ({ resolveManualMailboxSecret: () => 'synthetic-password', isEdielReservedSender: async () => false }))
vi.mock('next/navigation', () => ({
  unstable_rethrow: () => undefined,
  redirect: (url: string) => { throw new Error(`REDIRECT ${decodeURIComponent(url.replace(/\+/g, ' '))}`) },
}))
vi.mock('@/lib/inbound-mail/manualSenderVerification', () => ({ verifyManualMailSender: async () => ({ status: 'unverified' }) }))
vi.mock('@/lib/inbound-mail/manualInboundIngestion', () => ({ ingestManualInboundEmail: vi.fn() }))
vi.mock('@/lib/ediel/aiBiPersonalDataStorage', () => ({ requireAiBiPersonalDataStorage: async () => null }))
vi.mock('@/lib/ediel/transport/smime', () => ({ unpackInboundSmimeIfNeeded: async () => ({ detected: false, decryptedText: null }) }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({ processInboundEmailMessage: vi.fn() }))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', async (orig) => ({
  ...(await orig<typeof import('@/lib/inbound-mail/edielMailboxPoller.part-1')>()),
  markMailboxPollStarted: async (id: string) => ({ id, locked_by: 'w:1', locked_at: '2026-10-29T00:00:00Z' }),
  markMailboxPollFinished: async () => true,
  findExistingInboundEmail: async () => null,
}))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminActionAccess: async () => ({ userId: 'admin-1' }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

import { pollEdielMailbox } from '@/lib/inbound-mail/edielMailboxPoller.part-2'
import { runManualInboundMailEngine } from '@/lib/inbound-mail/manualMailboxPoller'
import { resolveImapTls } from '@/lib/inbound-mail/imapTls'
import { saveSharedMailboxProfileAction } from '@/app/admin/inbound-mail/actions'
import { saveManualMailboxAction } from '@/app/admin/manual-mailboxes/actions'

let server: net.Server | undefined
const sockets = new Set<net.Socket>()

// Server that never advertises STARTTLS (a stripping MITM or a cleartext-only server).
async function startServerWithoutStartTls() {
  server = net.createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN] no starttls here\r\n')
    let buf = ''
    socket.on('data', chunk => {
      buf += chunk.toString('utf8')
      let end: number
      while ((end = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, end); buf = buf.slice(end + 2)
        const sp = line.indexOf(' ')
        const tag = line.slice(0, sp); const cmd = line.slice(sp + 1)
        fx.commands.push(cmd)
        if (cmd === 'CAPABILITY') socket.write(`* CAPABILITY IMAP4rev1 AUTH=PLAIN\r\n${tag} OK done\r\n`)
        else if (/^LOGOUT/i.test(cmd)) socket.end(`* BYE\r\n${tag} OK bye\r\n`)
        else socket.write(`${tag} NO fixture refuses ${cmd.split(' ')[0]}\r\n`)
      }
    })
  })
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  fx.port = (server!.address() as net.AddressInfo).port
}

const credentialCommands = () => fx.commands.filter(c => /^(LOGIN|AUTHENTICATE)\b/i.test(c))

function edielMailbox(over: Partial<Row> = {}): EdielMailboxRow {
  return { id: 'mb-tls', company_id: 'co-1', environment: 'test', mailbox_name: 'unit', email_address: 'u@example.test',
    imap_host: 'imap.example.test', imap_port: 143, username: 'u', secret_reference: 'env:UNIT_IMAP_PASS',
    metadata: { imap_secure: false }, ...over } as unknown as EdielMailboxRow
}

function manualMailbox(over: Row = {}) {
  fx.manualMailbox = {
    id: 'manual-tls', company_id: null, environment: 'test', is_active: true, is_verified: true,
    imap_host: 'imap.example.test', imap_port: 143, imap_username: 'm@example.invalid', from_email: 'm@example.invalid',
    imap_secret_reference: 'env:X', imap_folder: 'INBOX', imap_secure: false, metadata: {}, locked_at: null, last_polled_at: null,
    ...over,
  }
}

beforeEach(async () => {
  fx.options = []; fx.commands = []
  vi.stubEnv('UNIT_IMAP_PASS', 'synthetic')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  await startServerWithoutStartTls()
})
afterEach(async () => {
  for (const s of sockets) s.destroy()
  sockets.clear()
  if (server) await new Promise<void>(r => server!.close(() => r()))
  server = undefined
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('resolveImapTls', () => {
  it('port 993 is IMAPS even if secure=false is requested', () => {
    expect(resolveImapTls({ host: 'imap.x', port: 993, secure: false, environment: 'production', env: {} }))
      .toEqual({ secure: true, tls: { rejectUnauthorized: true } })
  })
  it('port 143 requires STARTTLS', () => {
    expect(resolveImapTls({ host: 'imap.x', port: 143, secure: false, environment: 'test', env: {} }))
      .toEqual({ secure: false, doSTARTTLS: true, tls: { rejectUnauthorized: true } })
  })
  it('cleartext against a non-loopback host is refused even with the server opt-out', () => {
    const env = { GRIDEX_IMAP_ALLOW_PLAINTEXT_LOOPBACK: 'true' }
    expect(resolveImapTls({ host: 'imap.x', port: 143, secure: false, environment: 'test', env })).toMatchObject({ doSTARTTLS: true })
  })
  it('cleartext in production is refused even with opt-out and loopback', () => {
    const env = { GRIDEX_IMAP_ALLOW_PLAINTEXT_LOOPBACK: 'true' }
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      expect(resolveImapTls({ host, port: 143, environment: 'production', env })).toMatchObject({ doSTARTTLS: true })
    }
    expect(resolveImapTls({ host: '127.0.0.1', port: 143, environment: 'test', env: { ...env, VERCEL_ENV: 'production' } }))
      .toMatchObject({ doSTARTTLS: true })
  })
  it('loopback opt-out outside production is cleartext with a warning', () => {
    const warn = vi.mocked(console.warn)
    expect(resolveImapTls({ host: 'localhost', port: 143, environment: 'test', env: { GRIDEX_IMAP_ALLOW_PLAINTEXT_LOOPBACK: 'true' } }))
      .toEqual({ secure: false, doSTARTTLS: false })
    expect(warn).toHaveBeenCalledWith('[inbound-mail] IMAP plaintext loopback opt-out active', expect.any(Object))
  })
  it('never disables certificate verification', () => {
    expect(() => resolveImapTls({ host: 'imap.x', port: 993, environment: 'production', rejectUnauthorized: false, env: {} })).toThrow(/rejectUnauthorized/)
  })
})

describe('Ediel mailbox poller', () => {
  it('metadata imap_secure=false on 143 cannot select cleartext; missing STARTTLS aborts before LOGIN', async () => {
    const r = await pollEdielMailbox({ mailbox: edielMailbox() })
    expect(fx.options[0]).toMatchObject({ secure: false, doSTARTTLS: true, tls: { rejectUnauthorized: true } })
    expect(r.errors.join(' ')).toMatch(/STARTTLS/)
    expect(credentialCommands()).toEqual([])
  })
  it('production loopback with env opt-out still requires STARTTLS', async () => {
    vi.stubEnv('GRIDEX_IMAP_ALLOW_PLAINTEXT_LOOPBACK', 'true')
    const r = await pollEdielMailbox({ mailbox: edielMailbox({ environment: 'production', imap_host: '127.0.0.1' }) })
    expect(fx.options[0]).toMatchObject({ doSTARTTLS: true })
    expect(r.errors.join(' ')).toMatch(/STARTTLS/)
    expect(credentialCommands()).toEqual([])
  })
  it('IMAPS on 993 is used even when metadata says imap_secure=false', async () => {
    await pollEdielMailbox({ mailbox: edielMailbox({ imap_port: 993 }) })
    expect(fx.options[0]).toMatchObject({ secure: true, tls: { rejectUnauthorized: true } })
    expect(fx.options[0].doSTARTTLS).toBeUndefined()
  })
})

describe('manual mailbox poller', () => {
  it('imap_secure=false against a non-loopback host requires STARTTLS; missing STARTTLS aborts before LOGIN', async () => {
    manualMailbox()
    const r = await runManualInboundMailEngine()
    expect(fx.options[0]).toMatchObject({ secure: false, doSTARTTLS: true, tls: { rejectUnauthorized: true } })
    expect(r.errors.join(' ')).toMatch(/STARTTLS/)
    expect(credentialCommands()).toEqual([])
  })
  it('production loopback with env opt-out still requires STARTTLS', async () => {
    vi.stubEnv('GRIDEX_IMAP_ALLOW_PLAINTEXT_LOOPBACK', 'true')
    manualMailbox({ environment: 'production', imap_host: '127.0.0.1' })
    const r = await runManualInboundMailEngine()
    expect(fx.options[0]).toMatchObject({ doSTARTTLS: true })
    expect(r.errors.join(' ')).toMatch(/STARTTLS/)
    expect(credentialCommands()).toEqual([])
  })
  it('port 993 uses IMAPS', async () => {
    manualMailbox({ imap_port: 993 })
    await runManualInboundMailEngine()
    expect(fx.options[0]).toMatchObject({ secure: true })
  })
})

describe('admin save actions', () => {
  function form(fields: Record<string, string>) {
    const f = new FormData()
    for (const [k, v] of Object.entries(fields)) f.set(k, v)
    return f
  }
  it('shared Ediel mailbox: production + cleartext request is rejected before any write', async () => {
    await expect(saveSharedMailboxProfileAction(form({
      environment: 'production', mailbox_name: 'm', email_address: 'e@example.test', imap_host: 'imap.example.test',
      username: 'u', secret_reference: 'env:EDIEL_IMAP_PASS', imap_port: '143', imap_allow_plaintext: 'on',
    }))).rejects.toThrow(/klartext/)
  })
  it('manual mailbox: production + cleartext request is rejected before any write', async () => {
    const write = vi.fn()
    const { supabaseService } = await import('@/lib/supabase/service')
    vi.spyOn(supabaseService, 'from').mockImplementation(((t: string) => { write(t); throw new Error('no db') }) as never)
    await expect(saveManualMailboxAction(form({
      mailbox_name: 'm', mailbox_type: 'general_manual_operations', environment: 'production', from_email: 'm@example.invalid',
      imap_host: 'imap.example.test', imap_port: '143', imap_insecure: 'true',
    }))).rejects.toThrow(/status=error.*klartext/)
    expect(write).not.toHaveBeenCalledWith('manual_communication_mailboxes')
  })
})
