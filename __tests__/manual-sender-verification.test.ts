import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyManualMailSender } from '@/lib/inbound-mail/manualSenderVerification'

const strongKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
const weakKey = generateKeyPairSync('rsa', { modulusLength: 1024 })
const body = 'Hej,\r\nAvtalet löper till 2027-03-31.\r\nÄrende: GX-FIR-0123456789ABCDEF0123456789ABCDEF\r\n'
const headerFields = [
  ['From', 'Kundservice <kundservice@example.test>'],
  ['To', 'leverantorsbyte@gridex.test'],
  ['Subject', 'Re: Fullmaktsärende GX-FIR-0123456789ABCDEF0123456789ABCDEF'],
  ['In-Reply-To', '<original@gridex.test>'],
  ['References', '<original@gridex.test>'],
  ['MIME-Version', '1.0'],
  ['Content-Type', 'text/plain; charset=utf-8'],
] as const

// Real RSA signature over RFC 6376 simple/simple canonical headers and body.
// DNS is the only replaced boundary; a tampered signature must fail the actual verifier.
function signedMessage(options: {
  key?: typeof strongKey
  algorithm?: 'sha256' | 'sha1'
  domain?: string
  selector?: string
  bodyLength?: number
  unsigned?: string[]
  extraHeaders?: string[]
  body?: string
} = {}): Buffer {
  const key = options.key ?? strongKey
  const algorithm = options.algorithm ?? 'sha256'
  const signed = headerFields.filter(([name]) => !options.unsigned?.includes(name.toLowerCase()))
  const messageBody = options.body ?? body
  const hashedBody = options.bodyLength === undefined ? Buffer.from(messageBody) : Buffer.from(messageBody).subarray(0, options.bodyLength)
  const bodyHash = createHash(algorithm).update(hashedBody).digest('base64')
  const signatureHeader = `DKIM-Signature: v=1; a=rsa-${algorithm}; c=simple/simple; d=${options.domain ?? 'example.test'}; s=${options.selector ?? 'ops'}; h=${signed.map(([name]) => name.toLowerCase()).join(':')}; ${options.bodyLength === undefined ? '' : `l=${options.bodyLength}; `}bh=${bodyHash}; b=`
  const signedHeaders = signed.map(([name, value]) => `${name}: ${value}\r\n`).join('')
  const signature = sign(algorithm, Buffer.from(`${signedHeaders}${signatureHeader}`), key.privateKey).toString('base64')
  const fields = headerFields.map(([name, value]) => `${name}: ${value}`)
  return Buffer.from([`${signatureHeader}${signature}`, ...fields, ...(options.extraHeaders ?? []), '', messageBody].join('\r\n'))
}

function keyResolver(key = strongKey) {
  const publicKey = key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')
  return async (name: string, type: string): Promise<string[][]> => {
    if (name !== 'ops._domainkey.example.test' || type !== 'TXT') throw new Error('ENOTFOUND')
    return [[`v=DKIM1; k=rsa; p=${publicKey}`]]
  }
}

afterEach(() => vi.useRealTimers())

describe('cryptographic sender verification for manual replies', () => {
  it('verifies the original bytes and preserves signed correlation headers', async () => {
    const raw = signedMessage()
    const result = await verifyManualMailSender(raw, { resolver: keyResolver() })
    expect(result.status).toBe('verified')
    expect(result.from_email).toBe('kundservice@example.test')
    expect(result.signing_domain).toBe('example.test')
    expect(result.raw_sha256).toBe(createHash('sha256').update(raw).digest('hex'))
    expect(result.signed_headers).toEqual(expect.arrayContaining(['from', 'subject', 'in-reply-to', 'references']))
    expect(Number.isFinite(Date.parse(result.verified_at))).toBe(true)
  })

  it('refuses a body changed after the signature was created', async () => {
    const tampered = Buffer.from(signedMessage().toString().replace('2027-03-31', '2026-11-01'))
    const result = await verifyManualMailSender(tampered, { resolver: keyResolver() })
    expect(result.status).toBe('unverified')
  })

  it('refuses a forged author even when the signing domain has a valid key', async () => {
    const forged = Buffer.from(signedMessage().toString().replace('kundservice@example.test', 'kundservice@another.test'))
    const result = await verifyManualMailSender(forged, { resolver: keyResolver() })
    expect(result.status).toBe('unverified')
  })

  it('refuses a valid signature from a domain different from the author domain', async () => {
    const resolver = async () => [[`v=DKIM1; p=${strongKey.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')}`]]
    const result = await verifyManualMailSender(signedMessage({ domain: 'another.test' }), { resolver })
    expect(result.status).toBe('unverified')
  })

  it('refuses partial-body signatures which allow unsigned appended instructions', async () => {
    const partial = signedMessage({ bodyLength: 6 })
    const result = await verifyManualMailSender(partial, { resolver: keyResolver() })
    expect(result.status).toBe('unverified')
  })

  it('refuses weak SHA-1 signatures', async () => {
    const result = await verifyManualMailSender(signedMessage({ algorithm: 'sha1' }), { resolver: keyResolver() })
    expect(result.status).toBe('unverified')
  })

  it('refuses RSA keys shorter than 2048 bits', async () => {
    const result = await verifyManualMailSender(signedMessage({ key: weakKey }), { resolver: keyResolver(weakKey) })
    expect(result.status).toBe('unverified')
  })

  it('does not accept an Authentication-Results claim without a real DKIM signature', async () => {
    const raw = Buffer.from(`Authentication-Results: mx.example.test; dkim=pass header.d=example.test\r\nFrom: kundservice@example.test\r\nSubject: Fullmakt\r\n\r\n${body}`)
    const result = await verifyManualMailSender(raw, { resolver: keyResolver() })
    expect(result.status).toBe('unverified')
  })

  it('keeps missing or failed DNS key lookup unverified', async () => {
    const result = await verifyManualMailSender(signedMessage(), { resolver: async () => { throw new Error('ENOTFOUND') } })
    expect(result.status).toBe('unverified')
  })

  it('refuses duplicate From headers even when one is correctly signed', async () => {
    const result = await verifyManualMailSender(signedMessage({ extraHeaders: ['From: attacker@another.test'] }), { resolver: keyResolver() })
    expect(result.status).toBe('unverified')
  })

  it('refuses a DKIM testing key as authority for automatic application', async () => {
    const result = await verifyManualMailSender(signedMessage(), {
      resolver: async () => [[`v=DKIM1; k=rsa; t=y; p=${strongKey.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')}`]],
    })
    expect(result.status).toBe('unverified')
  })

  it.each(['subject', 'in-reply-to', 'references'])('authenticates the body without presenting unsigned %s as authenticated correlation', async (header) => {
    const result = await verifyManualMailSender(signedMessage({ unsigned: [header] }), { resolver: keyResolver() })
    expect(result.status).toBe('verified')
    expect(result.signed_headers).not.toContain(header)
  })

  it.each([
    ['Re: Fullmaktsärende GX-FIR-0123456789ABCDEF0123456789ABCDEF', 'Another customer'],
    ['In-Reply-To: <original@gridex.test>', 'In-Reply-To: <other@gridex.test>'],
    ['References: <original@gridex.test>', 'References: <other@gridex.test>'],
  ])('refuses tampering with a signed correlation value %s', async (original, changed) => {
    const raw = Buffer.from(signedMessage().toString().replace(original, changed))
    expect((await verifyManualMailSender(raw, { resolver: keyResolver() })).status).toBe('unverified')
  })

  it.each(['content-type', 'mime-version'])('refuses an unsigned %s that changes body interpretation', async (header) => {
    const result = await verifyManualMailSender(signedMessage({ unsigned: [header] }), { resolver: keyResolver() })
    expect(result.status).toBe('unverified')
  })

  it('refuses duplicate correlation headers rather than let parsers disagree', async () => {
    const result = await verifyManualMailSender(signedMessage({ extraHeaders: ['Subject: Another customer'] }), { resolver: keyResolver() })
    expect(result.status).toBe('unverified')
  })

  it('authenticates original signed RFC bytes above the old two-MiB limit for bounded attachments', async () => {
    const raw = signedMessage({ body: `${'A'.repeat(76)}\r\n`.repeat(40_000) })
    expect(raw.length).toBeGreaterThan(2 * 1024 * 1024)
    const result = await verifyManualMailSender(raw, { resolver: keyResolver() })
    expect(result.status).toBe('verified')
    expect(result.raw_sha256).toBe(createHash('sha256').update(raw).digest('hex'))
  })

  it('refuses inputs larger than twelve MiB before making DNS calls', async () => {
    let lookups = 0
    const result = await verifyManualMailSender(Buffer.concat([signedMessage(), Buffer.alloc(12 * 1024 * 1024)]), {
      resolver: async () => { lookups += 1; return [] },
    })
    expect(result.status).toBe('unverified')
    expect(lookups).toBe(0)
  })

  it('bounds signature fan-out before making DNS calls', async () => {
    let lookups = 0
    const signature = signedMessage().toString().split('\r\n')[0]
    const raw = Buffer.from(`${Array(5).fill(signature).join('\r\n')}\r\nFrom: kundservice@example.test\r\nSubject: Fullmakt\r\n\r\n${body}`)
    const result = await verifyManualMailSender(raw, { resolver: async () => { lookups += 1; return [] } })
    expect(result.status).toBe('unverified')
    expect(lookups).toBe(0)
  })

  it('refuses oversized DNS key responses instead of processing arbitrary TXT data', async () => {
    const result = await verifyManualMailSender(signedMessage(), { resolver: async () => [[`${'a'.repeat(20000)}`]] })
    expect(result.status).toBe('unverified')
  })

  it('does not treat an ARC signature as the required DKIM signature', async () => {
    const raw = Buffer.from(signedMessage().toString().replace('DKIM-Signature:', 'ARC-Message-Signature: i=1;'))
    expect((await verifyManualMailSender(raw, { resolver: keyResolver() })).status).toBe('unverified')
  })

  it('returns safely if the DNS resolver never completes', async () => {
    vi.useFakeTimers()
    const pending = verifyManualMailSender(signedMessage(), { resolver: () => new Promise(() => undefined) })
    await vi.advanceTimersByTimeAsync(5000)
    expect((await pending).status).toBe('unverified')
  })

  it.each([null, undefined, {}, '', Buffer.alloc(0)])('does not throw for unusable raw source %j', async (raw) => {
    expect((await verifyManualMailSender(raw)).status).toBe('unverified')
  })
})
