import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseMimeSource } from '@/lib/inbound-mail/manualMailboxPoller'
import { inspectMimeStructure } from '@/lib/inbound-mail/mimeStructure'

type Attachment = {
  filename: string | null; contentType: string; sizeBytes: number; text: string | null
  contentBase64?: string; sha256: string; mimePart: number
  sourceRole: 'forwarded' | 'attachment' | 'inline'; capturedIssue?: string
}
const MiB = 1024 * 1024
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\r\n'), Buffer.from([0, 255, 128, 13, 10])])
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBd0AAAAASUVORK5CYII=', 'base64')
// Opaque ZIP bytes: this suite verifies MIME transport, not workbook validity.
const xlsx = Buffer.from([0x50, 0x4b, 3, 4, 0, 255, 128, 13, 10])

function part(bytes: Buffer, options: { type: string; filename?: string; encoding?: 'base64' | 'quoted-printable' | '8bit' | 'binary'; disposition?: string }): string {
  const encoding = options.encoding ?? 'base64'
  const encoded = encoding === 'base64' ? bytes.toString('base64')
    : encoding === 'quoted-printable' ? [...bytes].map(byte => `=${byte.toString(16).padStart(2, '0').toUpperCase()}`).join('')
      : bytes.toString('latin1')
  return [`Content-Type: ${options.type}`, `Content-Transfer-Encoding: ${encoding}`,
    ...(options.filename ? [`Content-Disposition: ${options.disposition ?? 'attachment'}; filename="${options.filename}"`] : []), '', encoded].join('\r\n')
}
function mixed(parts: string[]): Buffer {
  return Buffer.from(['From: reply@example.test', 'Subject: Current answer', 'Content-Type: multipart/mixed; boundary="capture"', '',
    '--capture', 'Content-Type: text/plain; charset=utf-8', '', 'Current answer.',
    ...parts.flatMap(value => ['--capture', value]), '--capture--', ''].join('\r\n'), 'latin1')
}
function records(result: ReturnType<typeof parseMimeSource>): Attachment[] { return result.attachments as Attachment[] }

describe('manual mail immutable binary MIME attachments', () => {
  it.each([
    ['application/pdf', 'answer.pdf', pdf],
    ['image/png', 'answer.png', png],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'answer.xlsx', xlsx],
  ] as const)('preserves decoded %s bytes, SHA and stable MIME location in JSONB-safe data', (type, filename, bytes) => {
    const result = parseMimeSource(mixed([part(bytes, { type, filename })]))
    const saved = records(result)[0]
    expect(saved).toMatchObject({ filename, contentType: type, sizeBytes: bytes.length, text: null,
      sha256: hash(bytes), mimePart: 2, sourceRole: 'attachment' })
    expect(Buffer.from(saved.contentBase64 ?? '', 'base64')).toEqual(bytes)
    expect(JSON.parse(JSON.stringify(saved))).toEqual(saved)
    expect(saved.capturedIssue).toBeUndefined()
    expect(result.mimeRequiresReview).toBe(false)
  })

  it('decodes quoted-printable attachment octets without a UTF-8 round trip', () => {
    const result = parseMimeSource(mixed([part(pdf, { type: 'application/pdf', filename: 'answer.pdf', encoding: 'quoted-printable' })]))
    expect(Buffer.from(records(result)[0].contentBase64 ?? '', 'base64')).toEqual(pdf)
    expect(records(result)[0].sha256).toBe(hash(pdf))
  })

  it.each(['8bit', 'binary'] as const)('preserves original linebreak bytes inside a multipart %s attachment', encoding => {
    const bytes = Buffer.from([255, 0, 65, 10, 66, 13, 67, 13, 10, 68, 10])
    const result = parseMimeSource(mixed([part(bytes, { type: 'application/pdf', filename: 'original.pdf', encoding })]))
    expect(Buffer.from(records(result)[0].contentBase64 ?? '', 'base64').equals(bytes)).toBe(true)
    expect(records(result)[0].sizeBytes).toBe(bytes.length)
    expect(records(result)[0].sha256).toBe(hash(bytes))
  })

  it('keeps boundary-like payload lines that are not exact delimiter lines', () => {
    const bytes = Buffer.from('A\n --capture\nB\r\n--capture-suffix\r\nC')
    const result = parseMimeSource(mixed([part(bytes, { type: 'application/pdf', filename: 'original.pdf', encoding: 'binary' })]))
    expect(Buffer.from(records(result)[0].contentBase64 ?? '', 'base64').equals(bytes)).toBe(true)
    expect(records(result)[0].sha256).toBe(hash(bytes))
    expect(result.mimeRequiresReview).toBe(false)
  })

  it('keeps inline binary parts even without a filename or Content-ID', () => {
    const result = parseMimeSource(mixed([part(png, { type: 'image/png' })]))
    expect(records(result)).toHaveLength(1)
    expect(records(result)[0]).toMatchObject({ filename: null, sourceRole: 'inline', sha256: hash(png) })
    expect(Buffer.from(records(result)[0].contentBase64 ?? '', 'base64')).toEqual(png)
    expect(result.bodyText).toBe('Current answer.')
  })

  it('distinguishes equal-size changed binary evidence despite identical filename and media type', () => {
    const changed = Buffer.from(pdf); changed[changed.length - 1] ^= 1
    const a = records(parseMimeSource(mixed([part(pdf, { type: 'application/pdf', filename: 'same.pdf' })])))[0]
    const b = records(parseMimeSource(mixed([part(changed, { type: 'application/pdf', filename: 'same.pdf' })])))[0]
    expect(a.sizeBytes).toBe(b.sizeBytes)
    expect(a.sha256).not.toBe(b.sha256)
    expect(a.contentBase64).not.toBe(b.contentBase64)
  })

  it('retains a forwarded original as evidence without promoting its text or nested file', () => {
    const old = Buffer.from(['From: old@example.test', 'Content-Type: multipart/mixed; boundary="old"', '', '--old',
      'Content-Type: text/plain', '', 'Anläggnings-ID: 735999100000000001', '--old',
      part(pdf, { type: 'application/pdf', filename: 'old.pdf' }), '--old--', ''].join('\r\n'))
    const result = parseMimeSource(mixed([part(old, { type: 'message/rfc822', filename: 'old.eml' })]))
    expect(result.bodyText).toBe('Current answer.')
    expect(records(result)).toHaveLength(1)
    expect(records(result)[0]).toMatchObject({ sourceRole: 'forwarded', sha256: hash(old), text: null })
    expect(Buffer.from(records(result)[0].contentBase64 ?? '', 'base64')).toEqual(old)
  })

  it('never promotes descendants of a named attached multipart container', () => {
    const container = ['Content-Type: multipart/alternative; boundary="old"; name="history.mime"',
      'Content-Disposition: attachment; filename="history.mime"', '', '--old', 'Content-Type: text/plain', '',
      'Anläggnings-ID: 735999100000000001', '--old--', ''].join('\r\n')
    const result = parseMimeSource(mixed([container]))
    expect(result.bodyText).toBe('Current answer.')
    expect(records(result)).toHaveLength(1)
    expect(records(result)[0].sourceRole).toBe('attachment')
    expect(records(result)[0].contentBase64).toEqual(expect.any(String))
  })
})

describe('manual mail bounded complete attachment capture', () => {
  it('counts forwarded originals and inline images in the same document budget', () => {
    const forwarded = Buffer.from('From: old@example.test\r\nContent-Type: text/plain\r\n\r\nOld evidence.\r\n')
    const result = parseMimeSource(mixed([part(forwarded, { type: 'message/rfc822', filename: 'old.eml' }),
      ...Array.from({ length: 3 }, () => part(pdf, { type: 'application/pdf', filename: 'same.pdf' })),
      part(png, { type: 'image/png' }), part(pdf, { type: 'application/pdf', filename: 'sixth.pdf' })]))
    const saved = records(result)
    expect(saved.map(row => row.sourceRole)).toEqual(['forwarded', 'attachment', 'attachment', 'attachment', 'inline', 'attachment'])
    expect(saved.map(row => row.mimePart)).toHaveLength(new Set(saved.map(row => row.mimePart)).size)
    expect(saved[5].contentBase64).toBeUndefined()
    expect(saved[5].capturedIssue).toBe('attachment_count_limit')
    expect(result.mimeRequiresReview).toBe(true)
  })

  it('retains descriptors for a sixth document and holds the whole answer instead of dropping the last condition', () => {
    const result = parseMimeSource(mixed(Array.from({ length: 6 }, (_, i) => part(Buffer.from(`%PDF-${i}`), { type: 'application/pdf', filename: `${i}.pdf` }))))
    const saved = records(result)
    expect(saved).toHaveLength(6)
    expect(saved.slice(0, 5).every(row => typeof row.contentBase64 === 'string')).toBe(true)
    expect(saved[5]).toMatchObject({ sizeBytes: 6, sha256: hash(Buffer.from('%PDF-5')), capturedIssue: expect.any(String) })
    expect(saved[5].contentBase64).toBeUndefined()
    expect(result.mimeRequiresReview).toBe(true)
  })

  it('preserves a full four-MiB document including base64 transport', () => {
    const bytes = Buffer.alloc(4 * MiB, 0x61)
    const result = parseMimeSource(mixed([part(bytes, { type: 'application/pdf', filename: 'limit.pdf' })]))
    expect(result.mimeRequiresReview).toBe(false)
    expect(records(result)[0].sha256).toBe(hash(bytes))
    expect(Buffer.from(records(result)[0].contentBase64 ?? '', 'base64').equals(bytes)).toBe(true)
  })

  it('keeps the full size and hash but no truncated payload beyond four MiB per document', () => {
    const bytes = Buffer.alloc(4 * MiB + 1, 0x61)
    const result = parseMimeSource(mixed([part(bytes, { type: 'application/pdf', filename: 'large.pdf', encoding: '8bit' })]))
    expect(records(result)[0]).toMatchObject({ sizeBytes: bytes.length, sha256: hash(bytes), capturedIssue: expect.any(String) })
    expect(records(result)[0].contentBase64).toBeUndefined()
    expect(result.mimeRequiresReview).toBe(true)
  })

  it('holds total decoded content above six MiB without retaining a prefix of the final document', () => {
    const first = Buffer.alloc(3 * MiB, 0x61), last = Buffer.alloc(3 * MiB + 1, 0x62)
    const result = parseMimeSource(mixed([part(first, { type: 'application/pdf', filename: 'first.pdf', encoding: '8bit' }),
      part(last, { type: 'application/pdf', filename: 'last.pdf', encoding: '8bit' })]))
    expect(Buffer.from(records(result)[0].contentBase64 ?? '', 'base64').equals(first)).toBe(true)
    expect(records(result)[1]).toMatchObject({ sizeBytes: last.length, sha256: hash(last), capturedIssue: expect.any(String) })
    expect(records(result)[1].contentBase64).toBeUndefined()
    expect(result.mimeRequiresReview).toBe(true)
  })

  it('captures the full inclusive six-MiB total without a review hold', () => {
    const first = Buffer.alloc(3 * MiB, 0x61), second = Buffer.alloc(3 * MiB, 0x62)
    const result = parseMimeSource(mixed([part(first, { type: 'application/pdf', filename: 'first.pdf', encoding: '8bit' }),
      part(second, { type: 'application/pdf', filename: 'second.pdf', encoding: '8bit' })]))
    expect(result.mimeRequiresReview).toBe(false)
    expect(Buffer.from(records(result)[0].contentBase64 ?? '', 'base64').equals(first)).toBe(true)
    expect(Buffer.from(records(result)[1].contentBase64 ?? '', 'base64').equals(second)).toBe(true)
  })

  it('holds empty document evidence with its size/hash rather than treating the body as the full answer', () => {
    const result = parseMimeSource(mixed([part(Buffer.alloc(0), { type: 'application/pdf', filename: 'empty.pdf' })]))
    expect(records(result)[0]).toMatchObject({ sizeBytes: 0, sha256: hash(Buffer.alloc(0)), capturedIssue: expect.any(String) })
    expect(result.mimeRequiresReview).toBe(true)
  })

  it('does not silently clip a long text attachment while retaining its original bytes', () => {
    const bytes = Buffer.from('a'.repeat(200_001) + '\nDatumet gäller endast om kunden först säger upp avtalet.')
    const result = parseMimeSource(mixed([part(bytes, { type: 'text/plain; charset=utf-8', filename: 'terms.txt' })]))
    expect(records(result)[0].text).toBeNull()
    expect(records(result)[0].sha256).toBe(hash(bytes))
    expect(records(result)[0].capturedIssue).toEqual(expect.any(String))
    expect(Buffer.from(records(result)[0].contentBase64 ?? '', 'base64').equals(bytes)).toBe(true)
    expect(result.mimeRequiresReview).toBe(true)
  })
})

describe('shared MIME decoding compatibility', () => {
  it.each(['Y', 'YQ', 'YQ=', 'YQ===', 'Y=Q=', 'YQ==AAAA', '!!!!', 'YQ==?'])('still flags malformed base64 %s', encoded => {
    const result = inspectMimeStructure(`Content-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${encoded}`, { preserveBytes: true })
    expect(result.issues).toContain('mime_transfer_encoding_invalid')
  })

  it.each(['YQ==', 'YWI=', 'YWJj', 'YWJj\r\nZA=='])('accepts valid complete base64 with terminal padding or whitespace %s', encoded => {
    const result = inspectMimeStructure(`Content-Type: application/pdf\r\nContent-Transfer-Encoding: base64\r\n\r\n${encoded}`, { preserveBytes: true })
    expect(result.issues).toEqual([])
    expect(Buffer.from(result.entities[0].body, 'latin1').equals(Buffer.from(encoded, 'base64'))).toBe(true)
  })

  it('keeps legacy non-byte-preserving text normalization and traversal order', () => {
    const raw = mixed([part(Buffer.from('a\nb'), { type: 'application/pdf', filename: 'legacy.pdf', encoding: '8bit' })])
    const result = inspectMimeStructure(raw.toString('latin1'))
    expect(result.entities.slice(1).map(entity => entity.mediaType)).toEqual(['application/pdf', 'text/plain'])
    expect(result.entities.find(entity => entity.mediaType === 'application/pdf')?.body).toBe('a\r\nb')
  })
})
