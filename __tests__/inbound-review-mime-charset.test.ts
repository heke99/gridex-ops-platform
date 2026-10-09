// inbound-review: #3
// inbound-review: #4
// inbound-review: #7
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { from: () => { throw new Error('no db in parser tests') } } }))

import { manualMessageDedupKey, parseMimeSource } from '@/lib/inbound-mail/manualMailboxPoller'
import { decodeMimePart, decodeQuotedPrintable, splitMimeParts } from '@/lib/inbound-mail/edielMailboxPoller.part-1'

const CRLF = '\r\n'
const latin1Base64 = Buffer.from('Västerås', 'latin1').toString('base64')

describe('#3 nested multipart bodies are not lost', () => {
  it('reads text and html from multipart/mixed > multipart/alternative and keeps the attachment', () => {
    const raw = [
      'From: natagare@example.se',
      'Subject: Re: [GX-FIR-ABCDEF12]',
      'In-Reply-To: <req-1@gridex.se>',
      'Content-Type: multipart/mixed; boundary="outer"',
      '',
      '--outer',
      'Content-Type: multipart/alternative; boundary="inner"',
      '',
      '--inner',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Anl=C3=A4ggnings-ID: 735999100000000001',
      '--inner',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>Anläggnings-ID</p>',
      '--inner--',
      '--outer',
      'Content-Type: text/plain; charset=iso-8859-1; name="svar.txt"',
      'Content-Disposition: attachment; filename="svar.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      latin1Base64,
      '--outer--',
      '',
    ].join(CRLF)
    const parsed = parseMimeSource(Buffer.from(raw, 'utf8'))
    expect(parsed.bodyText).toBe('Anläggnings-ID: 735999100000000001')
    expect(parsed.bodyHtml).toBe('<p>Anläggnings-ID</p>')
    expect(parsed.inReplyTo).toBe('<req-1@gridex.se>')
    expect(parsed.attachments).toEqual([{ filename: 'svar.txt', contentType: 'text/plain', sizeBytes: 8, text: 'Västerås' }])
  })
})

describe('#4 charset-correct decoding', () => {
  it('manual poller: UTF-8 quoted-printable', () => {
    const raw = ['Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', 'M=C3=A4tpunkt V=C3=A4ster=C3=A5s', ''].join(CRLF)
    expect(parseMimeSource(Buffer.from(raw)).bodyText).toBe('Mätpunkt Västerås')
  })

  it('manual poller: ISO-8859-1 base64 and windows-1252 quoted-printable', () => {
    const latin = ['Content-Type: text/plain; charset=ISO-8859-1', 'Content-Transfer-Encoding: base64', '', latin1Base64, ''].join(CRLF)
    expect(parseMimeSource(Buffer.from(latin)).bodyText).toBe('Västerås')
    const cp = ['Content-Type: text/plain; charset=windows-1252', 'Content-Transfer-Encoding: quoted-printable', '', 'V=E4ster=E5s =80', ''].join(CRLF)
    expect(parseMimeSource(Buffer.from(cp)).bodyText).toBe('Västerås €')
  })

  it('ediel: quoted-printable and base64 respect the charset', () => {
    expect(decodeQuotedPrintable('M=C3=A4tpunkt V=C3=A4ster=C3=A5s')).toBe('Mätpunkt Västerås')
    expect(decodeMimePart(latin1Base64, 'base64', 'iso-8859-1')).toBe('Västerås')
    expect(decodeMimePart('V=E4ster=E5s', 'quoted-printable', 'iso-8859-1')).toBe('Västerås')
  })

  it('ediel: an 8-bit UNOC EDIFACT attachment keeps ÅÄÖ and its byte size', () => {
    const edifact = "UNA:+.? 'UNB+UNOC:3+7350000000001:14+7365560000000:14+261009:1000+1'UNH+1+UTILMD:D:02B:UN:E5SE1B'NAD+DP++ÅÄÖ Gatan 1'UNT+3+1'UNZ+1+1'"
    const head = [
      'From: ediel@natagare.se',
      'Content-Type: multipart/mixed; boundary="b1"',
      '',
      '--b1',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Se bifogad fil',
      '--b1',
      'Content-Type: application/edifact',
      'Content-Disposition: attachment; filename="msg.edi"',
      'Content-Transfer-Encoding: 8bit',
      '',
      '',
    ].join(CRLF)
    const source = Buffer.concat([Buffer.from(head, 'ascii'), Buffer.from(edifact, 'latin1'), Buffer.from(`${CRLF}--b1--${CRLF}`, 'ascii')])
    const parsed = splitMimeParts(source)
    expect(parsed.attachments[0].rawText).toContain("NAD+DP++ÅÄÖ Gatan 1'")
    expect(parsed.attachments[0].sizeBytes).toBe(Buffer.byteLength(edifact, 'latin1'))
    expect(parsed.rawEdifactPayload).toContain('ÅÄÖ Gatan 1')
  })

  it('ediel: a base64 UNOC payload is decoded via the UNB syntax identifier, UNOW as UTF-8', () => {
    const unoc = Buffer.from("UNB+UNOC:3+1:14+2:14+261009:1000+1'NAD+DP++ÅÄÖ'UNZ+1+1'", 'latin1').toString('base64')
    expect(decodeMimePart(unoc, 'base64')).toContain('NAD+DP++ÅÄÖ')
    const unow = Buffer.from("UNB+UNOW:3+1:14+2:14+261009:1000+1'NAD+DP++ÅÄÖ'UNZ+1+1'", 'utf8').toString('base64')
    expect(decodeMimePart(unow, 'base64', 'iso-8859-1')).toContain('NAD+DP++ÅÄÖ')
  })

  it('ediel: string sources keep their existing behaviour', () => {
    expect(splitMimeParts('Content-Type: text/plain\r\n\r\nAI;facility;period;value').bodyText).toBe('AI;facility;period;value')
  })
})

describe('#7 fallback dedup key', () => {
  it('uses Message-ID when present and sha256 of the raw source otherwise', () => {
    expect(manualMessageDedupKey('<a@b>', Buffer.from('x'))).toBe('<a@b>')
    const key = manualMessageDedupKey(null, Buffer.from('raw mail'))
    expect(key).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(manualMessageDedupKey(null, Buffer.from('raw mail'))).toBe(key)
    expect(manualMessageDedupKey(null, Buffer.from('other mail'))).not.toBe(key)
  })
})
