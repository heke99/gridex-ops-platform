// Regression 20261029-3f1a8ab1/claude-track3/004: an EDIFACT attachment copied into
// raw_edifact_payload must not be concatenated with itself into two interchanges.
import {createHash} from 'node:crypto'
import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'
const io = vi.hoisted(() => ({row: {} as Record<string, unknown>, attachments: [] as Record<string, unknown>[],
  calls: [] as Array<{args: Record<string, unknown>; result?: unknown; error?: string}>, status: vi.fn(), task: vi.fn(), insert: vi.fn(), read: vi.fn(), platformAccess: vi.fn(), rpc: vi.fn(), lookup: new Map<string, Record<string, unknown>[]>()}))
vi.mock('@/lib/supabase/service', () => ({supabaseService: {
  rpc: async (name: string, args: Record<string, unknown>) => ({data: io.rpc(name, args) ?? null, error: null}),
  from: (table: string) => {
    io.read(table)
    const predicates: Array<(row: Record<string, unknown>) => boolean> = []
    function candidates() {
      const available = io.lookup.get(table)
      if (available) return available.filter(row => predicates.every(pass => pass(row)))
      return table === 'inbound_email_messages' ? [io.row] : table === 'inbound_email_attachments' ? io.attachments : []
    }
    const rows = () => ({data: candidates(), error: null})
    const query = {select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation(function (key, value) { predicates.push(row => row[key] === value); return query }),
      in: vi.fn().mockImplementation(function (key, values) { predicates.push(row => values.includes(row[key])); return query }),
      not: vi.fn().mockImplementation(function (key, _operator, value) { predicates.push(row => row[key] !== value); return query }),
      or: vi.fn().mockImplementation(function (filter) {
        const values = (filter as string).split(',').map(clause => clause.split('.eq.'))
        predicates.push(row => values.some(([column, value]) => row[column] === value)); return query
      }),
      insert: vi.fn().mockImplementation(function (values) { io.insert(table, values); return query }),
      limit: vi.fn((limit: number) => Promise.resolve({data: candidates().slice(0, limit), error: null})),
      maybeSingle: vi.fn(() => Promise.resolve({data: candidates()[0] ?? null, error: null})),
      then: (resolve: (value: unknown) => void) => Promise.resolve(rows()).then(resolve)}
    return query
  }}}))
vi.mock('@/lib/inbound-mail/edielEmailParser', async (orig) => {
  const actual = await orig<typeof import('@/lib/inbound-mail/edielEmailParser')>()
  return {...actual, parseInboundEmailContent: (args: Parameters<typeof actual.parseInboundEmailContent>[0]) => {
    const call: (typeof io.calls)[number] = {args: args as Record<string, unknown>}
    io.calls.push(call)
    try { call.result = actual.parseInboundEmailContent(args) } catch (e) { call.error = (e as Error).message }
    return null // stop after parsing; downstream flow is out of scope
  }}
})
vi.mock('@/lib/inbound-mail/inboundStatusUpdater', () => ({updateInboundEmailProcessingStatus: io.status}))
vi.mock('@/lib/inbound-mail/inboundTaskFactory', () => ({createInboundMailTask: io.task}))
vi.mock('@/lib/inbound-mail/dsnTransportCandidates', () => ({projectDsnTransportCandidates: vi.fn().mockResolvedValue([])}))
vi.mock('@/lib/admin/guards', () => ({requirePlatformAdminAccess: io.platformAccess}))
vi.mock('@/components/admin/AdminHeader', () => ({default: () => null}))
vi.mock('@/app/admin/inbound-mail/actions', () => ({reprocessInboundEmailAction: vi.fn()}))
vi.mock('@/app/admin/inbound-mail/[id]/InboundManualReviewForm', () => ({default: () => null}))
import InboundMailDetailPage from '@/app/admin/inbound-mail/[id]/page'
import {ensureDiagnosticEdielMessagesForInboundEmails} from '@/lib/inbound-mail/edielMailboxPoller.part-2'
import {processInboundEmailMessage} from '@/lib/inbound-mail/edielInboundProcessor'
import {readRetainedImapMime, splitMimeParts} from '@/lib/inbound-mail/edielMailboxPoller.part-1'

const payload = (una: boolean, ref = 'FXREF1') => `${una ? "UNA:+.? '" : ''}UNB+UNOC:3+70007:14+16700:14+261029:1200+${ref}'UNH+1+UTILTS:D:02B:UN:E5SE1B'BGM+E66+FXDOC1+9'UNT+3+1'UNZ+1+${ref}'`
const head = 'From: dso@t3.sim.invalid\r\nTo: ediel@t3.sim.invalid\r\nSubject: fx\r\nMIME-Version: 1.0\r\n'
function mime(kind: 'edifact-b64' | 'text-att' | 'inline', una: boolean) {
  const p = payload(una)
  if (kind === 'inline') return head + 'Content-Type: text/plain; charset=utf-8\r\n\r\n' + p + '\r\n'
  const part = kind === 'edifact-b64'
    ? 'Content-Type: application/EDIFACT; name="fx.edi"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="fx.edi"\r\n\r\n' + Buffer.from(p).toString('base64') + '\r\n'
    : 'Content-Type: text/plain; charset=utf-8; name="fx.txt"\r\nContent-Disposition: attachment; filename="fx.txt"\r\n\r\n' + p + '\r\n'
  return head + 'Content-Type: multipart/mixed; boundary="B1"\r\n\r\n--B1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nSe bilaga.\r\n--B1\r\n' + part + '--B1--\r\n'
}
function load(raw: string) {
  const s = splitMimeParts(Buffer.from(raw))
  io.row = {id: 'mail1', company_id: '10000000-0000-4000-8000-000000000001', environment: 'test', raw_email: raw,
    body_text: s.bodyText, raw_edifact_payload: s.rawEdifactPayload}
  io.attachments = s.attachments.map((a, i) => ({id: `att${i}`, raw_text: a.rawText, filename: a.filename}))
}
const unb = (v: unknown) => (String(v ?? '').match(/UNB\+/g) ?? []).length
const run = () => processInboundEmailMessage({inboundEmailMessageId: 'mail1', actorUserId: '30000000-0000-4000-8000-000000000001'})
beforeEach(() => { vi.clearAllMocks(); io.calls.length = 0; io.lookup.clear(); io.rpc.mockReset() })

describe('single physical interchange is parsed once (finding 004)', () => {
  for (const [kind, una] of [['edifact-b64', true], ['edifact-b64', false], ['text-att', true], ['text-att', false], ['inline', true], ['inline', false]] as const) {
    it(`${kind} una=${una}: exactly one UNB is parsed and parsing does not throw`, async () => {
      load(mime(kind, una))
      await run()
      expect(io.calls).toHaveLength(1)
      const call = io.calls[0]
      expect(call.error).toBeUndefined()
      expect(unb(call.args.attachmentText) + (kind === 'inline' && !call.args.attachmentText ? 1 : 0)).toBe(1)
      const result = call.result as {messageCode?: string; interchangeReference?: string; rawPayload: string}
      expect(result).toMatchObject({messageCode: 'E66', interchangeReference: 'FXREF1'})
      expect(unb(result.rawPayload)).toBe(1)
    })
  }
  it('two genuinely different interchanges are not silently collapsed', async () => {
    load(mime('edifact-b64', false))
    io.row.raw_edifact_payload = payload(false, 'OTHERREF')
    await expect(run()).resolves.toMatchObject({status: 'manual_review', parseResultId: null})
    expect(io.calls).toHaveLength(0)
    expect(io.status).toHaveBeenCalledWith(expect.objectContaining({matchStatus: 'multiple_edifact_originals'}))
  })
})

describe('verified IMAP custody for multiple originals', () => {
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
  const edi = Buffer.from(payload(false).replace('FXDOC1', 'Räkningsunderlag'), 'latin1')
  const nestedPart = Buffer.from('Content-Type: application/EDIFACT; name="same.edi"\r\n' +
    'Content-Transfer-Encoding: base64\r\n\r\n' + edi.toString('base64'))
  const inlinePart = Buffer.concat([Buffer.from('Content-Type: text/plain; charset=iso-8859-1\r\n\r\n'), edi])
  const outer = Buffer.concat([
    Buffer.from(head + 'Content-Type: multipart/mixed; boundary="outer"\r\n\r\n--outer\r\n' +
      'Content-Type: multipart/mixed; boundary="inner"\r\n\r\n--inner\r\n'),
    nestedPart,
    Buffer.from('\r\n--inner--\r\n--outer\r\n'),
    inlinePart,
    Buffer.from('\r\n--outer--\r\n'),
  ])
  const manifest = [
    {position: '1.1.1', sourceSha256: sha(nestedPart), decodedSha256: sha(edi), decodedBytes: edi.length, filename: 'same.edi'},
    {position: '1.2', sourceSha256: sha(inlinePart), decodedSha256: sha(edi), decodedBytes: edi.length, filename: null},
  ]

  function loadVerified(original = outer) {
    load(original.toString('latin1'))
    Object.assign(io.row, {
      mailbox_id: '20000000-0000-4000-8000-000000000001',
      imap_account_scope: 'f'.repeat(64),
      imap_folder: 'INBOX',
      imap_uid_validity: 7,
      imap_uid: 42,
      raw_mailbox_bytes_sha256: sha(original),
    })
  }

  it('holds disjoint nested and inline positions and recomputes exact bytes after attachment order and projection change', async () => {
    loadVerified()
    await expect(run()).resolves.toMatchObject({status: 'manual_review', parseResultId: null})
    expect(io.status).toHaveBeenLastCalledWith(expect.objectContaining({
      matchStatus: 'multiple_edifact_originals',
    }))

    expect(io.status.mock.lastCall?.[0].matchPayload).toBeUndefined()
    expect(readRetainedImapMime(io.row, true)).toMatchObject({kind: 'verified', mime: {physicalEdifactParts: manifest}})

    io.row.match_status = 'multiple_edifact_originals'
    io.row.match_payload = {physicalMimeParts: [{position: 'unverified-projection'}]}
    io.attachments = [{id: 'different-row', raw_text: payload(false, 'DIFFERENT')}]
    await expect(run()).resolves.toMatchObject({status: 'manual_review', parseResultId: null})
    expect(io.status).toHaveBeenLastCalledWith(expect.objectContaining({
      matchStatus: 'multiple_edifact_originals',
    }))
    expect(io.calls).toHaveLength(0)
  })

  it('holds the verified compound original before considering stored AI/BI or attachment projections', async () => {
    loadVerified()
    io.row.body_text = 'AI;stored-projection'
    io.attachments = [{id: 'diagnostic-copy', raw_text: 'BI;stored-projection'}]
    await expect(run()).resolves.toMatchObject({status: 'manual_review', parseResultId: null})
    expect(io.status).toHaveBeenLastCalledWith(expect.objectContaining({
      matchStatus: 'multiple_edifact_originals',
    }))
    expect(io.calls).toHaveLength(0)
  })

  it('keeps a structured DSN with multiple EDIFACT candidates in the DSN quarantine', async () => {
    const report = Buffer.from('--outer\r\nContent-Type: message/delivery-status\r\n\r\n' +
      'Reporting-MTA: dns; mx.example.invalid\r\n\r\nFinal-Recipient: rfc822; ignored@example.invalid\r\n' +
      'Action: failed\r\nStatus: 5.1.1\r\n--outer--\r\n')
    loadVerified(Buffer.concat([outer.subarray(0, -Buffer.byteLength('--outer--\r\n')), report]))
    await expect(run()).resolves.toMatchObject({status: 'manual_review', parseResultId: null})
    expect(io.status).toHaveBeenLastCalledWith(expect.objectContaining({matchStatus: 'dsn_transport_review'}))
    expect(io.calls).toHaveLength(0)
  })

  it('only requires the new fetch hash for rows with a native UID', async () => {
    const ordinary = Buffer.from(mime('edifact-b64', false))
    loadVerified(ordinary)
    delete io.row.raw_mailbox_bytes_sha256
    await expect(run()).resolves.toMatchObject({status: 'manual_review', parseResultId: null})
    expect(io.status).toHaveBeenLastCalledWith(expect.objectContaining({matchStatus: 'imap_original_custody_unverified'}))
    expect(io.calls).toHaveLength(0)

    load(ordinary.toString())
    await run()
    expect(io.calls).toHaveLength(1)
  })

  it('holds an altered parent without substituting a retained attachment', async () => {
    loadVerified()
    io.row.raw_email = String(io.row.raw_email).replace('Subject: fx', 'Subject: altered')
    await expect(run()).resolves.toMatchObject({status: 'manual_review', parseResultId: null})
    expect(io.status).toHaveBeenLastCalledWith(expect.objectContaining({matchStatus: 'imap_original_custody_unverified'}))
    expect(io.calls).toHaveLength(0)
  })

  it('prevents diagnostics from minting an original before worker classification', async () => {
    loadVerified()
    io.row.match_status = 'not_checked'
    await expect(ensureDiagnosticEdielMessagesForInboundEmails(['mail1'])).resolves.toEqual([])
    expect(io.insert).not.toHaveBeenCalled()

    io.row.raw_email = String(io.row.raw_email).replace('Subject: fx', 'Subject: other')
    await expect(ensureDiagnosticEdielMessagesForInboundEmails(['mail1'])).resolves.toEqual([])
    expect(io.insert).not.toHaveBeenCalled()
  })

  it('shows only reverified MIME positions and hashes behind the existing platform guard', async () => {
    loadVerified()
    io.row.match_status = 'multiple_edifact_originals'
    io.row.match_payload = {physicalMimeParts: [{position: 'stored-projection'}]}
    const detail = () => InboundMailDetailPage({params: Promise.resolve({id: 'mail1'})})
    io.platformAccess.mockRejectedValueOnce(new Error('platform_role_required'))
    await expect(detail()).rejects.toThrow('platform_role_required')
    expect(io.read).not.toHaveBeenCalled()

    io.platformAccess.mockResolvedValue({email: 'operator@example.invalid', permissions: []})
    const html = renderToStaticMarkup(await detail())
    expect(html).toContain('MIME-position 1.1.1')
    expect(html).toContain('MIME-position 1.2')
    expect(html).toContain(manifest[0].sourceSha256)
    expect(html).toContain(manifest[1].sourceSha256)
    expect(html).toContain(manifest[0].decodedSha256)
    expect(html).not.toContain('stored-projection')

    io.row.raw_email = String(io.row.raw_email).replace('Subject: fx', 'Subject: other')
    expect(renderToStaticMarkup(await detail())).not.toContain('Verifierade EDIFACT-delar')
  })

  it.each([
    ['inbound_original_environment_unverified', 'Verifiera originalets Ediel-miljö mot brevlådan'],
    ['imap_original_custody_unverified', 'Det sparade mejlet kunde inte verifieras'],
  ])('explains manual review for %s in the ordinary detail view', async (status, guidance) => {
    loadVerified()
    io.row.match_status = status
    io.platformAccess.mockResolvedValue({email: 'operator@example.invalid', permissions: []})

    const detail = await InboundMailDetailPage({params: Promise.resolve({id: 'mail1'})})
    expect(renderToStaticMarkup(detail)).toContain(guidance)
    expect(io.insert).not.toHaveBeenCalled()
  })

  const owner = '10000000-0000-4000-8000-000000000001'
  const actor = '30000000-0000-4000-8000-000000000001'
  const targets = ['a', 'b'].map((suffix, index) => ({
    reference: `SENT-${suffix.toUpperCase()}`, point: `73599900000000000${index + 1}`, pointId: `point-${suffix}`,
    site: `site-${suffix}`, customer: `customer-${suffix}`, request: `request-${suffix}`,
  }))
  function response(target: typeof targets[number], broken = false) {
    return `UNB+UNOC:3+70007:14+16700:14+261029:1200+REF${target.reference}++23-DDQ-E66-T++1++1'` +
      `UNH+1+UTILTS:D:02B:UN:E5SE5A'BGM+E66+DATA+9'RFF+ACW:${target.reference}'IDE+24+TX'` +
      `LOC+172+${target.point}::9'UNT+${broken ? '8' : '6'}+1'UNZ+1+REF${target.reference}'`
  }
  function reviewSource(brokenSecond = false) {
    const [first, second] = targets
    const boundary = '--retained'
    const validParts = [response(first), response(second, brokenSecond)]
    loadVerified(Buffer.from(head + 'Content-Type: multipart/mixed; boundary="retained"\r\n\r\n' +
      validParts.map(payload => `${boundary}\r\nContent-Type: application/edifact\r\n\r\n${payload}\r\n`).join('') +
      `${boundary}--\r\n`))
    io.row.match_status = 'multiple_edifact_originals'
    io.platformAccess.mockResolvedValue({email: 'operator@example.invalid', userId: actor, companyId: owner, permissions: ['customers.read', 'masterdata.read']})
    io.lookup.set('ediel_mailboxes', [{id: io.row.mailbox_id, company_id: owner, environment: 'test', is_shared_platform_mailbox: false}])
    io.lookup.set('company_memberships', [{user_id: actor, company_id: owner, status: 'active', is_active: true, accepted_at: '2026-11-01'}])
    io.lookup.set('user_profiles', [{id: actor, user_status: 'active'}])
    io.lookup.set('metering_points', targets.map(target => ({id: target.pointId, company_id: owner, meter_point_id: target.point, site_id: target.site})))
    io.lookup.set('customer_sites', targets.map(target => ({id: target.site, company_id: owner, customer_id: target.customer})))
    io.lookup.set('grid_owner_data_requests', targets.map(target => ({id: target.request, company_id: owner, request_scope: 'meter_values',
      status: 'sent', metering_point_id: target.pointId, customer_id: target.customer, site_id: target.site})))
    io.lookup.set('ediel_messages', targets.map(target => ({id: target.request + '-message', company_id: owner, environment: 'test',
      grid_owner_data_request_id: target.request, metering_point_id: target.pointId, direction: 'outbound', message_standard: 'edifact',
      message_family: 'UTILTS', message_code: 'E73', status: 'sent', message_sent_at: '2026-10-29T11:00:00Z',
      sender_ediel_id: '16700', receiver_ediel_id: '70007', sender_sub_address: null, receiver_sub_address: null})))
    io.rpc.mockImplementation((name, args) => {
      if (name === 'gridex_actor_has_company_permission') return args.p_company_id === owner && args.p_actor_user_id === actor
      if (name === 'gridex_match_e66_to_sent_e73_reference_v1' && args.p_company_id === owner && args.p_environment === 'test' && args.p_actor_user_id === actor) {
        return targets.filter(target => target.reference === args.p_reference).map(target => target.request)
      }
      return null
    })
  }
  const renderReview = async (part?: string) => renderToStaticMarkup(await InboundMailDetailPage({
    params: Promise.resolve({id: 'mail1'}), searchParams: Promise.resolve({part}),
  }))

  it('independently looks up each selected part against that part’s physically referenced E73 and point', async () => {
    reviewSource()
    const initial = await renderReview()
    expect(initial.match(/Kuvertets syntax är giltig/g)).toHaveLength(2)
    expect(io.rpc).not.toHaveBeenCalled()
    for (const [index, target] of targets.entries()) {
      const html = await renderReview(`1.${index + 1}`)
      expect(html).toContain(`/admin/customers/${target.customer}?tab=sites&amp;site=${target.site}`)
      expect(html).not.toContain(`/admin/customers/${targets[1 - index].customer}`)
      expect(io.rpc).toHaveBeenLastCalledWith('gridex_match_e66_to_sent_e73_reference_v1', {
        p_company_id: owner, p_environment: 'test', p_actor_user_id: actor, p_reference: target.reference,
      })
    }
    expect(io.insert).not.toHaveBeenCalled()
  })

  it('keeps the malformed sibling separate and withholds links for false, unassigned or ambiguous scope', async () => {
    reviewSource(true)
    expect(await renderReview('1.2')).toContain('UNT/0074')
    expect(io.rpc).not.toHaveBeenCalled()
    expect(await renderReview('1.1')).toContain('/admin/customers/customer-a')

    io.rpc.mockClear()
    io.row.environment = 'production'
    expect(await renderReview('1.1')).not.toContain('/admin/customers/')
    io.row.environment = 'test'
    io.row.company_id = null
    expect(await renderReview('1.1')).not.toContain('/admin/customers/')
    io.row.company_id = owner
    io.platformAccess.mockResolvedValueOnce({email: 'operator@example.invalid', userId: actor, companyId: 'foreign-tenant', permissions: ['customers.read', 'masterdata.read']})
    expect(await renderReview('1.1')).not.toContain('/admin/customers/')
    io.platformAccess.mockResolvedValueOnce({email: 'operator@example.invalid', userId: actor, companyId: owner, permissions: ['masterdata.read']})
    expect(await renderReview('1.1')).not.toContain('/admin/customers/')
    const [mailbox] = io.lookup.get('ediel_mailboxes')!
    mailbox.is_shared_platform_mailbox = true
    expect(await renderReview('1.1')).not.toContain('/admin/customers/')
    expect(io.rpc).not.toHaveBeenCalled()
    mailbox.is_shared_platform_mailbox = false

    const points = io.lookup.get('metering_points')!
    points.push({...points[0], id: 'another-physical-point'})
    expect(await renderReview('1.1')).not.toContain('/admin/customers/')
    points.pop()
    const [message] = io.lookup.get('ediel_messages')!
    message.receiver_ediel_id = 'unrelated-party'
    expect(await renderReview('1.1')).not.toContain('/admin/customers/')
    expect(io.insert).not.toHaveBeenCalled()
  })

  it('does not publish physical byte custody for a legacy projection', async () => {
    loadVerified()
    delete io.row.imap_uid
    await expect(run()).resolves.toMatchObject({status: 'manual_review', parseResultId: null})
    expect(io.status.mock.lastCall?.[0].matchPayload).toBeUndefined()
    expect(io.calls).toHaveLength(0)
  })
})

import {segmentUntrimmedRaw, tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
describe('released trailing space before a segment terminator (finding 004, track4/2 variant)', () => {
  const ic = "UNA:+.? 'UNB+UNOC:3+70007:14+16700:14+261029:1200+FXREF1'\r\nFTX+AAA+++ABC? '\r\nUNZ+1+FXREF1'\r\n"
  it('keeps the released space as data and does not throw', () => {
    const ftx = tokenizeEdifact(ic).segments.find(s => s.tag === 'FTX')!
    expect(ftx.raw).toBe('FTX+AAA+++ABC? ')
    expect(ftx.elements[4]).toBe('ABC ')
    expect(segmentUntrimmedRaw(ftx)).toBe('FTX+AAA+++ABC? ')
  })
  it('still trims unreleased whitespace and line breaks around segments', () => {
    const segs = tokenizeEdifact("  UNB+UNOC:3+A+B+261029:1200+R1'\n  FTX+AAA+++X  '\r\nUNZ+1+R1'  \n").segments
    expect(segs.map(s => s.raw)).toEqual(['UNB+UNOC:3+A+B+261029:1200+R1', 'FTX+AAA+++X', 'UNZ+1+R1'])
    expect(segmentUntrimmedRaw(segs[1])).toBe('  FTX+AAA+++X  ')
  })
  it('a double release (escaped release char) followed by space is still trimmed', () => {
    const ftx = tokenizeEdifact("UNB+UNOC:3+A+B+261029:1200+R1'FTX+AAA+++X??  'UNZ+1+R1'").segments[1]
    expect(ftx.raw).toBe('FTX+AAA+++X??'); expect(ftx.elements[4]).toBe('X?')
  })
})

describe('UNA service advice that is not at offset 0 is never released data (finding 004 follow-up)', () => {
  const tail = "UNB+UNOC:3+A+B+261029:1200+R1'FTX+AAA+++ABC? 'UNZ+1+R1'"
  it.each(['unexpected-prefix', '  junk\r\n', "UNB+UNOC:3+A+B+261029:1200+R0'UNZ+0+R0'"])('rejects %j before UNA', prefix => {
    expect(() => tokenizeEdifact(`${prefix}UNA:+.? '${tail}`)).toThrow('edifact_dangling_release_character')
  })
  it('a leading UNA still allows the released trailing space', () => {
    expect(tokenizeEdifact(`UNA:+.? '${tail}`).segments.find(s => s.tag === 'FTX')!.elements[4]).toBe('ABC ')
  })
})
