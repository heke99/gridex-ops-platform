import { createHash } from 'node:crypto'
import forge from 'node-forge'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboundPrivateCertificateProfile } from '@/lib/ediel/security/privateCertificateStore'
import { unpackInboundSmimeIfNeeded } from '@/lib/ediel/transport/smime'
import type { EdielMailboxRow } from '@/lib/inbound-mail/edielMailboxPoller.part-1'
import { storeMailboxFetchMessage } from '@/lib/inbound-mail/edielMailboxPoller.part-2'

type Row = Record<string, unknown>
const io = vi.hoisted(() => ({
  loadCertificates: vi.fn(),
  writes: [] as Array<{ table: string; row: Row }>,
}))
vi.mock('@/lib/ediel/security/privateCertificateStore', () => ({ loadInboundPrivateCertificates: io.loadCertificates }))
vi.mock('@/lib/ediel/aiBiPersonalDataStorage', () => ({ requireAiBiPersonalDataStorage: async () => null }))
vi.mock('@/lib/inbound-mail/edielMailboxPoller.part-1', async original => ({
  ...await original<Record<string, unknown>>(),
  findExistingInboundEmail: async () => null,
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  from(table: string) {
    return {
      insert(value: Row | Row[]) {
        for (const row of Array.isArray(value) ? value : [value]) io.writes.push({ table, row })
        const result = { data: { id: `synthetic-${table}` }, error: null }
        const query = {
          select: () => query,
          single: async () => result,
          then: (resolve: (result: unknown) => unknown) => Promise.resolve(result).then(resolve),
        }
        return query
      },
    }
  },
} }))

const tenant = 'synthetic-tenant'
const environment = 'test'
const rawEdifact = "UNA:+.? 'UNB+UNOC:3+7300000000002:14+7300000000001:14+261004:1200+A-1++23-DDQ-PRODAT'"
  + "UNH+1+CONTRL:2:2:UN:EDIEL2'UCI+ORIG-I+7300000000001:14+7300000000002:14+1'UNT+3+1'UNZ+1+A-1'"
let der: Buffer
let encoded: string
let profile: InboundPrivateCertificateProfile

beforeAll(() => {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048 })
  const certificate = forge.pki.createCertificate()
  certificate.publicKey = keys.publicKey
  certificate.serialNumber = '01'
  certificate.validity.notBefore = new Date('2026-01-01T00:00:00Z')
  certificate.validity.notAfter = new Date('2030-01-01T00:00:00Z')
  const subject = [{ name: 'commonName', value: 'Synthetic local S/MIME fixture' }]
  certificate.setSubject(subject)
  certificate.setIssuer(subject)
  certificate.sign(keys.privateKey, forge.md.sha256.create())

  const cms = forge.pkcs7.createEnvelopedData()
  cms.addRecipient(certificate)
  cms.content = forge.util.createBuffer(rawEdifact)
  cms.encrypt(undefined, forge.pki.oids['des-EDE3-CBC'])
  der = Buffer.from(forge.asn1.toDer(cms.toAsn1()).getBytes(), 'binary')
  encoded = der.toString('base64').match(/.{1,76}/g)!.join('\r\n')
  profile = {
    id: 'synthetic-cert', companyId: tenant, environment, ownerEdielId: null,
    ownerSubaddress: null, displayName: 'Synthetic fixture', fingerprintSha256: null,
    serialNumber: certificate.serialNumber, issuer: null, subject: null, certificate,
    privateKey: keys.privateKey, source: 'database_secret_reference', sourceReference: null, warnings: [],
  }
})

beforeEach(() => {
  io.writes.length = 0
  io.loadCertificates.mockReset().mockResolvedValue({ profiles: [profile], warnings: [] })
})

function part(mimeType: string, body = encoded, transfer: string | null = 'base64') {
  return [
    `Content-Type: ${mimeType}; name="smime.p7m"`,
    'Content-Disposition: attachment; filename="smime.p7m"',
    ...(transfer ? [`Content-Transfer-Encoding: ${transfer}`] : []), '', body,
  ].join('\r\n')
}

function multipart(parts: string[], boundary = 'synthetic-boundary') {
  return [
    `Content-Type: multipart/mixed; boundary="${boundary}"`, '',
    ...parts.flatMap(entity => [`--${boundary}`, entity]), `--${boundary}--`, '',
  ].join('\r\n')
}

const mimeType = 'application/pkcs7-mime'
const generic = 'application/octet-stream'
const prose = 'Content-Type: text/plain\r\n\r\nSynthetic test message.'
const scope = { companyId: tenant, environment }

function unpack(rawEmail: string) {
  return unpackInboundSmimeIfNeeded({ rawEmail, ...scope })
}

async function store(rawEmail: string) {
  const mailbox = { id: 'synthetic-mailbox', company_id: tenant, environment } as EdielMailboxRow
  return storeMailboxFetchMessage({
    mailbox,
    message: { uid: 1, internalDate: new Date('2026-10-04T12:30:30.000Z'), source: Buffer.from(rawEmail) },
  })
}

function saved(table: string) {
  return io.writes.find(entry => entry.table === table)?.row
}

describe('physical inbound S/MIME MIME selection', () => {
  it.each([
    ['standalone PKCS#7 MIME', (): string => part(mimeType)],
    ['ordinary multipart PKCS#7 MIME', (): string => multipart([prose, part(mimeType)])],
    ['standalone legacy generic p7m', (): string => part(generic)],
    ['multipart legacy generic p7m', (): string => multipart([prose, part(generic)])],
    ['nested multipart legacy generic p7m', (): string => multipart([prose, multipart([part(generic)], 'nested')])],
    ['multipart base64 with literal whitespace', (): string => {
      const spaced = encoded.split('\r\n').map(line => `${line.slice(0, 20)} \t${line.slice(20)}`).join('\r\n')
      expect(Buffer.from(spaced, 'base64')).toEqual(der)
      return multipart([prose, part(mimeType, spaced)])
    }],
    ['legacy unlabelled base64', (): string => part(mimeType, encoded, null)],
  ] as const)('stores unchanged EDIFACT through the actual mailbox entry for %s', async (_label, fixture) => {
    const message = fixture()
    await store(message)
    expect(saved('ediel_message_payloads')).toMatchObject({
      security_status: 'decrypted',
      raw_payload: rawEdifact,
      encrypted_payload_ref: `inbound-smime://${createHash('sha256').update(message).digest('hex').slice(0, 32)}`,
    })
    expect(saved('inbound_email_messages')).toMatchObject({
      company_id: tenant, raw_edifact_payload: rawEdifact,
      received_at: '2026-10-04T12:30:30.000Z',
    })
    expect(saved('inbound_processing_jobs')).toMatchObject({ status: 'queued' })
    expect(io.loadCertificates).toHaveBeenCalledExactlyOnceWith(scope)
  })

  it.each([
    ['two CMS parts', (): string => multipart([part(mimeType), part(generic)]), 'ambiguous'],
    ['invalid base64', (): string => multipart([part(mimeType, `?${encoded}`)]), 'invalid'],
    ['missing closing delimiter', (): string => multipart([part(mimeType)]).replace('--synthetic-boundary--', ''), 'invalid'],
    ['body prose mentioning a filename', (): string => `${prose} Mention of smime.p7m.`, 'missing'],
    ['an attached RFC822 message', (): string => multipart([`Content-Type: message/rfc822\r\n\r\n${part(mimeType)}`]), 'missing'],
  ] as const)('holds %s before looking up a private certificate', async (_label, fixture, reason) => {
    const result = await unpack(fixture())
    expect(result).toMatchObject({
      securityStatus: 'decrypt_failed', decryptedText: null, evidence: { mimeSelection: reason },
    })
    expect(result.validationError).toContain('MIME-del')
    expect(io.loadCertificates).not.toHaveBeenCalled()
  })

  it('preserves the genuine missing certificate outcome for valid MIME', async () => {
    io.loadCertificates.mockResolvedValue({ profiles: [], warnings: [] })
    const result = await unpack(multipart([part(generic)]))
    expect(result.validationError).toContain('inget läsbart privat PFX-certifikat')
    expect(io.loadCertificates).toHaveBeenCalledExactlyOnceWith(scope)
  })

  it('keeps corrupt cryptographic data separate from a missing certificate', async () => {
    const corrupted = Buffer.alloc(100, 0xff).toString('base64')
    const result = await unpack(part(mimeType, corrupted))
    expect(result).toMatchObject({ securityStatus: 'decrypt_failed', decryptedText: null })
    expect(result.validationError).toContain('CMS recipientInfo')
    expect(io.loadCertificates).toHaveBeenCalledExactlyOnceWith(scope)
  })

  it('passes ordinary plaintext without looking up a certificate', async () => {
    expect(await unpack(prose)).toMatchObject({ detected: false, securityStatus: 'not_encrypted' })
    expect(io.loadCertificates).not.toHaveBeenCalled()
  })
})
