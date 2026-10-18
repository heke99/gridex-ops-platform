import { describe, expect, it } from 'vitest'
import { parseMimeSource } from '@/lib/inbound-mail/manualMailboxPoller'
import { extractManualFacilityFields } from '@/lib/customer-operations/manualFacilityResponseParser'

const CRLF = '\r\n'
const currentReply = 'Se bifogad gammal historik.'
const oldReply = 'Anläggnings-ID: 735999100000000001\r\nAvtalsslut: 2027-03-31'
const oldMessage = [
  'From: old-counterparty@example.test', 'Subject: Gammalt ärende', 'Content-Type: text/plain; charset=utf-8', '', oldReply,
].join(CRLF)

function mixed(parts: string[]): Buffer {
  return Buffer.from([
    'From: current-counterparty@example.test', 'Subject: Re: Aktuellt ärende', 'Content-Type: multipart/mixed; boundary="outer"', '',
    ...parts.flatMap((part) => ['--outer', part]), '--outer--', '',
  ].join(CRLF), 'utf8')
}

const plainCurrent = `Content-Type: text/plain; charset=utf-8${CRLF}${CRLF}${currentReply}`

describe('manual mail authored MIME body isolation', () => {
  it.each(['message/rfc822', 'message/global'])('does not promote attached %s history into the current reply', (contentType) => {
    const parsed = parseMimeSource(mixed([
      plainCurrent,
      [`Content-Type: ${contentType}; name="history.eml"`, 'Content-Disposition: attachment; filename="history.eml"', '', oldMessage].join(CRLF),
    ]))
    expect(parsed.bodyText).toBe(currentReply)
    expect(parsed.bodyHtml).toBeNull()
    expect(extractManualFacilityFields(parsed.bodyText ?? '')).toMatchObject({ facility_id: null, current_contract_end_date: null })
    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0]).toMatchObject({ filename: 'history.eml', contentType, text: null })
  })

  it('does not treat an inline forwarded message without filename as newly authored', () => {
    const parsed = parseMimeSource(mixed([plainCurrent, `Content-Type: message/rfc822${CRLF}${CRLF}${oldMessage}`]))
    expect(parsed.bodyText).toBe(currentReply)
    expect(extractManualFacilityFields(parsed.bodyText ?? '')).toMatchObject({ facility_id: null, current_contract_end_date: null })
    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0]).toMatchObject({ filename: null, contentType: 'message/rfc822', text: null })
  })

  it('excludes multiple levels of forwarded MIME ancestry', () => {
    const forwarded = `Content-Type: message/rfc822${CRLF}${CRLF}Content-Type: message/global${CRLF}${CRLF}${oldMessage}`
    const parsed = parseMimeSource(mixed([plainCurrent, forwarded]))
    expect(parsed.bodyText).toBe(currentReply)
    expect(extractManualFacilityFields(parsed.bodyText ?? '')).toMatchObject({ facility_id: null, current_contract_end_date: null })
    expect(parsed.attachments).toHaveLength(1)
  })

  it.each([
    ['Content-Disposition: attachment; filename="history.mime"', 'history.mime'],
    ['Content-Disposition: inline; filename="history.mime"', 'history.mime'],
  ])('excludes descendants of an attached multipart container: %s', (disposition, filename) => {
    const attachedMultipart = [
      'Content-Type: multipart/alternative; boundary="history"', disposition, '',
      '--history', 'Content-Type: text/plain; charset=utf-8', '', oldReply,
      '--history', 'Content-Type: text/html; charset=utf-8', '', '<p>Avtalsslut: 2027-03-31</p>', '--history--',
    ].join(CRLF)
    const parsed = parseMimeSource(mixed([plainCurrent, attachedMultipart]))
    expect(parsed.bodyText).toBe(currentReply)
    expect(parsed.bodyHtml).toBeNull()
    expect(extractManualFacilityFields(parsed.bodyText ?? '')).toMatchObject({ facility_id: null, current_contract_end_date: null })
    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0]).toMatchObject({ filename, contentType: 'multipart/alternative', text: null })
  })

  it('keeps a text attachment separate from the authored reply', () => {
    const parsed = parseMimeSource(mixed([
      plainCurrent,
      ['Content-Type: text/plain; charset=utf-8', 'Content-Disposition: attachment; filename="history.txt"', '', oldReply].join(CRLF),
    ]))
    expect(parsed.bodyText).toBe(currentReply)
    expect(extractManualFacilityFields(parsed.bodyText ?? '')).toMatchObject({ facility_id: null, current_contract_end_date: null })
    expect(parsed.attachments[0]).toMatchObject({ filename: 'history.txt', contentType: 'text/plain', text: oldReply })
  })

  it('retains the current text and HTML alternatives separately', () => {
    const alternative = [
      'Content-Type: multipart/alternative; boundary="current"', '',
      '--current', 'Content-Type: text/plain; charset=utf-8', '', 'Anläggnings-ID: 735999100000000002',
      '--current', 'Content-Type: text/html; charset=utf-8', '', '<p>Anläggnings-ID: 735999100000000003</p>', '--current--',
    ].join(CRLF)
    const parsed = parseMimeSource(mixed([alternative]))
    expect(parsed.bodyText).toBe('Anläggnings-ID: 735999100000000002')
    expect(parsed.bodyHtml).toBe('<p>Anläggnings-ID: 735999100000000003</p>')
    expect(extractManualFacilityFields(parsed.bodyText ?? parsed.bodyHtml ?? '')).toMatchObject({ facility_id: '735999100000000002' })
    expect(parsed.attachments).toEqual([])
  })

  it('does not let forwarded plain text override the current HTML-only reply', () => {
    const parsed = parseMimeSource(mixed([
      'Content-Type: text/html; charset=utf-8\r\n\r\n<p>Se bifogad gammal historik.</p>',
      `Content-Type: message/rfc822${CRLF}${CRLF}${oldMessage}`,
    ]))
    expect(parsed.bodyText).toBeNull()
    expect(parsed.bodyHtml).toBe('<p>Se bifogad gammal historik.</p>')
  })

  it('does not invent authored text when the root is only a forwarded message', () => {
    const parsed = parseMimeSource(Buffer.from(`Content-Type: message/rfc822${CRLF}${CRLF}${oldMessage}`))
    expect(parsed.bodyText).toBeNull()
    expect(parsed.bodyHtml).toBeNull()
    expect(parsed.attachments).toHaveLength(1)
  })

  it('keeps charset decoding for the actual current reply', () => {
    const parsed = parseMimeSource(Buffer.from([
      'Content-Type: text/plain; charset=windows-1252', 'Content-Transfer-Encoding: quoted-printable', '', 'V=E4ster=E5s =80',
    ].join(CRLF)))
    expect(parsed.bodyText).toBe('Västerås €')
    expect(parsed.attachments).toEqual([])
  })

  it('marks a clipped final authored MIME condition for review instead of trusting the first facts', () => {
    const first = 'Content-Type: text/plain\r\n\r\nTidigaste start: 2027-04-01\r\nBrytavgift: Ingen'
    const padding = Array.from({ length: 254 }, () => 'Content-Type: text/plain\r\n\r\nInformation.')
    const last = 'Content-Type: text/plain\r\n\r\nDatumet gäller endast om kunden först säger upp avtalet.'
    const parsed = parseMimeSource(mixed([first, ...padding, last]))
    expect(parsed.bodyText).toContain('Tidigaste start: 2027-04-01')
    expect(parsed.mimeRequiresReview).toBe(true)
  })

  it.each([
    'Content-Type: text/plain\r\nContent-Type: text/html\r\n\r\nTidigaste start: 2027-04-01',
    'Content-Type: multipart/mixed; boundary="missing"\r\n\r\nUnclosed boundary',
    'Content-Type: text/plain\r\nContent-Transfer-Encoding: base64\r\n\r\n%%%invalid%%%',
    'Content-Type: text/plain\r\nContent-Transfer-Encoding: unknown\r\n\r\nTidigaste start: 2027-04-01',
  ])('retains a structural review flag for malformed MIME %s', (raw) => {
    expect(parseMimeSource(Buffer.from(raw)).mimeRequiresReview).toBe(true)
  })

  it('does not add a MIME review hold to a fully parsed ordinary reply', () => {
    expect(parseMimeSource(Buffer.from('Content-Type: text/plain\r\n\r\nAktuellt svar')).mimeRequiresReview).toBe(false)
  })
})
