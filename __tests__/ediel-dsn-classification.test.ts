import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseInboundEmailContent } from '@/lib/inbound-mail/edielEmailParser'
import { splitMimeParts } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { processInboundEmailMessage } from '@/lib/inbound-mail/edielInboundProcessor'
import { ensureDiagnosticEdielMessagesForInboundEmails, listEdielMessageIdsForInboundEmails } from '@/lib/inbound-mail/edielMailboxPoller.part-2'

const mocks = vi.hoisted(() => ({ from: vi.fn(), update: vi.fn(), task: vi.fn(), tenant: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: mocks.from } }))
vi.mock('@/lib/inbound-mail/inboundStatusUpdater', () => ({
  updateInboundEmailProcessingStatus: mocks.update,
  createParseResult: vi.fn(), createInboundEdielMessage: vi.fn(),
  createUnresolvedInboundEdielMessage: vi.fn(), applySafeInboundStatusUpdate: vi.fn(),
}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({ createInboundMailTask: mocks.task }))
vi.mock('@/lib/inbound-mail/inboundTenantResolver', () => ({ resolveTenantForInboundEdiel: mocks.tenant }))

const edi = "UNB+UNOC:3+21660:ZZ+27700:ZZ+260915:1200+REF1'UNH+1+PRODAT:D:96A:UN:E2SE6A'BGM+Z01+DOC1+9'UNT+3+1'UNZ+1+REF1'"
function report(type = 'delivery-status', returned = edi) {
  return [
    'MIME-Version: 1.0', `Content-Type: multipart/report; boundary="bounce";`,
    ` report-type="${type}"`, '', '--bounce', 'Content-Type: text/plain', '',
    'Delivery failed.', '--bounce', `Content-Type: message/${type}`, '',
    'Final-Recipient: rfc822; recipient@example.test', 'Action: failed', 'Status: 5.1.1',
    '', '--bounce', 'Content-Type: message/rfc822', '',
    'Content-Type: application/EDIFACT', '', returned, '--bounce--', '',
  ].join('\r\n')
}

describe('DSN classification before EDIFACT extraction', () => {
  beforeEach(() => vi.clearAllMocks())
  it('does not extract a returned original from a DSN MIME envelope', () => {
    expect(splitMimeParts(report()).rawEdifactPayload).toBeNull()
  })
  it('does not re-extract a DSN original from previously stored attachment payloads', () => {
    expect(parseInboundEmailContent({ rawEmail: report(), attachmentText: edi })).toBeNull()
  })
  it('classifies an attachment-only DSN before extracting its returned original', () => {
    expect(parseInboundEmailContent({ attachmentText: report() })).toBeNull()
  })
  it('classifies a DSN wrapped in a forwarded MIME message', () => {
    const wrapped = `Content-Type: multipart/mixed; boundary=outer\r\n\r\n--outer\r\nContent-Type: message/rfc822\r\n\r\n${report()}\r\n--outer--\r\n`
    expect(splitMimeParts(wrapped).rawEdifactPayload).toBeNull()
    expect(parseInboundEmailContent({ rawEmail: wrapped })).toBeNull()
  })
  it.each(['delivery-status', 'global-delivery-status'])('recognizes %s with folded MIME headers', (type) => {
    expect(parseInboundEmailContent({ rawEmail: report(type) })).toBeNull()
  })
  it('recognizes a delivery-status MIME part without the report-type parameter', () => {
    expect(splitMimeParts(report().replace(' report-type="delivery-status"', '')).rawEdifactPayload).toBeNull()
  })
  it('preserves ordinary EDIFACT and does not classify another report type as DSN', () => {
    expect(parseInboundEmailContent({ rawEmail: `Content-Type: application/EDIFACT\r\n\r\n${edi}` })?.messageCode).toBe('Z01')
    expect(splitMimeParts(report('disposition-notification')).rawEdifactPayload).toContain('BGM+Z01')
  })
  it('does not classify MIME-looking prose or a forwarded DSN as a delivery report', () => {
    const ordinary = `Content-Type: text/plain\r\n\r\nContent-Type: message/delivery-status\r\n${edi}`
    expect(parseInboundEmailContent({ rawEmail: ordinary })?.messageCode).toBe('Z01')
  })
  it('preserves AI list body text', () => {
    expect(splitMimeParts('Content-Type: text/plain\r\n\r\nAI;facility;period;value').bodyText).toBe('AI;facility;period;value')
  })
  it('does not create diagnostic business messages for quarantined DSNs', async () => {
    const insert = vi.fn(() => { throw new Error('DSN must not become an Ediel message') })
    mocks.from.mockImplementation((table) => {
      const rows = table === 'inbound_email_messages' ? [{ id: 'mail1', match_status: 'dsn_transport_review', raw_email: report(), body_text: report() }] : []
      const query = { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), insert,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve) }
      return query
    })
    expect(await ensureDiagnosticEdielMessagesForInboundEmails(['mail1'])).toEqual([])
    expect(insert).not.toHaveBeenCalled()
  })
  it('does not recreate a quarantined DSN from an old parse result', async () => {
    const insert = vi.fn(() => { throw new Error('Old DSN parse result must not become a business message') })
    mocks.from.mockImplementation((table) => {
      const rows = table === 'inbound_email_messages' ? [{ id: 'mail1', match_status: 'dsn_transport_review', raw_email: report() }] :
        table === 'inbound_ediel_parse_results' ? [{ id: 'parse1', inbound_email_message_id: 'mail1', raw_payload: edi, message_family: 'PRODAT' }] : []
      return { select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), insert,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve) }
    })
    expect(await ensureDiagnosticEdielMessagesForInboundEmails(['mail1'])).toEqual([])
    expect(insert).not.toHaveBeenCalled()
  })
  it.each([listEdielMessageIdsForInboundEmails, ensureDiagnosticEdielMessagesForInboundEmails])(
    'filters DSNs once and reads existing business messages once in newest-first order (%#)', async (lookup) => {
      const calls: Array<{ table: string; ids: string[]; order?: unknown }> = []
      mocks.from.mockImplementation((table: string) => {
        if (!['inbound_email_messages', 'ediel_messages'].includes(table)) throw new Error(`Unexpected query: ${table}`)
        const call: typeof calls[number] = { table, ids: [] }
        calls.push(call)
        let columns = ''
        const query = {
          select: vi.fn((selected: string) => { columns = selected; return query }),
          in: vi.fn((_column: string, ids: string[]) => { call.ids = ids; return query }),
          order: vi.fn((column: string, options: unknown) => { call.order = [column, options]; return query }),
          then: (resolve: (value: unknown) => unknown) => {
            const rows = table === 'inbound_email_messages' ? [
              { id: 'safe', raw_email: edi },
              { id: 'dsn', match_status: 'dsn_transport_review' },
              { id: 'raw-dsn', raw_email: report() },
              { id: 'body-dsn', body_text: report() },
            ] : [
              { id: 'newest', inbound_email_message_id: 'safe' },
              { id: 'older', inbound_email_message_id: 'safe' },
              { id: null, inbound_email_message_id: 'safe' },
            ]
            const data = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => columns.split(',').includes(key))))
            return Promise.resolve({ data, error: null }).then(resolve)
          },
        }
        return query
      })
      expect(await lookup(['safe', 'dsn', 'raw-dsn', 'body-dsn', 'missing', 'safe', ''])).toEqual(['newest', 'older'])
      expect(calls).toEqual([
        { table: 'inbound_email_messages', ids: ['safe', 'dsn', 'raw-dsn', 'body-dsn', 'missing'] },
        { table: 'ediel_messages', ids: ['safe'], order: ['created_at', { ascending: false }] },
      ])
    },
  )
  it.each([listEdielMessageIdsForInboundEmails, ensureDiagnosticEdielMessagesForInboundEmails])(
    'fails closed before business lookup when DSN screening fails (%#)', async (lookup) => {
      const failure = new Error('screening unavailable')
      mocks.from.mockReturnValue({ select: vi.fn().mockReturnThis(), in: vi.fn().mockResolvedValue({ data: null, error: failure }) })
      await expect(lookup(['mail1'])).rejects.toBe(failure)
      expect(mocks.from).toHaveBeenCalledTimes(1)
      expect(mocks.from).toHaveBeenCalledWith('inbound_email_messages')
    },
  )
  it('creates diagnostics only for missing screened mail while retaining existing message order', async () => {
    const inserted: Array<Record<string, unknown>> = []
    const selections: Array<[string, string[]]> = []
    mocks.from.mockImplementation((table: string) => {
      let values: string[] = []
      let inserting = false
      const query = {
        select: vi.fn().mockReturnThis(),
        in: vi.fn((_column: string, ids: string[]) => { values = ids; selections.push([table, ids]); return query }),
        order: vi.fn().mockReturnThis(),
        insert: vi.fn((rows: Array<Record<string, unknown>>) => { inserting = true; inserted.push(...rows); return query }),
        then: (resolve: (value: unknown) => unknown) => {
          let data: Array<Record<string, unknown>>
          if (table === 'inbound_email_messages') data = [{ id: 'existing', raw_email: edi }, { id: 'new', raw_email: edi }, { id: 'dsn', raw_email: report() }]
          else if (table === 'inbound_ediel_parse_results') data = [{ id: 'parse-new', inbound_email_message_id: 'new', company_id: 'company-a', raw_payload: edi, message_family: 'PRODAT' }].filter((row) => values.includes(row.inbound_email_message_id))
          else if (table === 'ediel_messages') data = inserting ? [{ id: 'created' }] : [
            { id: 'newest-existing', inbound_email_message_id: 'existing' },
            { id: 'older-existing', inbound_email_message_id: 'existing' },
          ]
          else throw new Error(`Unexpected query: ${table}`)
          return Promise.resolve({ data, error: null }).then(resolve)
        },
      }
      return query
    })
    expect(await ensureDiagnosticEdielMessagesForInboundEmails(['existing', 'new', 'dsn'])).toEqual(['newest-existing', 'older-existing', 'created'])
    expect(selections).toEqual([
      ['inbound_email_messages', ['existing', 'new', 'dsn']],
      ['ediel_messages', ['existing', 'new']],
      ['inbound_ediel_parse_results', ['new']],
    ])
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ inbound_email_message_id: 'new', company_id: 'company-a', raw_payload: edi })
  })
  it.each([listEdielMessageIdsForInboundEmails, ensureDiagnosticEdielMessagesForInboundEmails])(
    'propagates existing-message lookup errors without attempting diagnostic creation (%#)', async (lookup) => {
      const failure = new Error('message lookup unavailable')
      mocks.from.mockImplementation((table: string) => ({
        select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(table === 'inbound_email_messages'
          ? { data: [{ id: 'safe', raw_email: edi }], error: null }
          : { data: null, error: failure }).then(resolve),
      }))
      await expect(lookup(['safe'])).rejects.toBe(failure)
      expect(mocks.from.mock.calls).toEqual([['inbound_email_messages'], ['ediel_messages']])
    },
  )
  it('routes stored DSNs to transport review before attachment loading or tenant/business processing', async () => {
    const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'mail1', company_id: null, raw_email: report(), raw_edifact_payload: edi }, error: null }) }
    mocks.from.mockImplementation((table) => {
      if (table !== 'inbound_email_messages') throw new Error(`Unexpected business query: ${table}`)
      return query
    })
    expect(await processInboundEmailMessage({ inboundEmailMessageId: 'mail1' })).toEqual({ status: 'manual_review', companyId: null, parseResultId: null })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ matchStatus: 'dsn_transport_review' }))
    expect(mocks.tenant).not.toHaveBeenCalled()
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })
})
