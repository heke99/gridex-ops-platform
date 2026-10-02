import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import { describe, expect, it } from 'vitest'

/**
 * Ediel S/MIME round trip with the installed node-forge (see the documented audit exception
 * GHSA-86w9-cpqp-85rv in scripts/dependency-audit-exceptions.json). Proves encryption and
 * decryption of enveloped data still work exactly as lib/ediel/transport uses them, including
 * interop with a counterparty that encrypts with OpenSSL. Synthetic key material only.
 */

const EDIFACT = "UNB+UNOC:3+12345:14+54321:14+261002:0700+1++23-DDQ-PRODAT'UNH+1+PRODAT:D:97A:UN:E5SE1B'UNT+2+1'UNZ+1+1'"

function syntheticRecipient(serial = '0a1b2c3d', commonName = 'gridex-synthetic-ediel-test') {
  const keys = forge.pki.rsa.generateKeyPair(2048)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = serial
  cert.validity.notBefore = new Date(Date.now() - 60_000)
  cert.validity.notAfter = new Date(Date.now() + 86_400_000)
  const attrs = [{ name: 'commonName', value: commonName }]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { cert, privateKey: keys.privateKey, pem: forge.pki.certificateToPem(cert) }
}

function decryptWithForge(der: Buffer, recipient: ReturnType<typeof syntheticRecipient>): string {
  const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der.toString('binary'))) as unknown as {
    findRecipient: (cert: forge.pki.Certificate) => unknown
    decrypt: (r: unknown, key: forge.pki.PrivateKey) => void
    content: forge.util.ByteStringBuffer
  }
  const match = p7.findRecipient(recipient.cert)
  expect(match).toBeTruthy()
  p7.decrypt(match, recipient.privateKey)
  return Buffer.from(p7.content.getBytes(), 'binary').toString('latin1')
}

describe('Ediel S/MIME enveloped-data round trip (node-forge)', () => {
  const recipient = syntheticRecipient()

  it('encrypts outbound like lib/ediel/transport and decrypts back to the exact EDIFACT', () => {
    const envelope = forge.pkcs7.createEnvelopedData()
    envelope.addRecipient(recipient.cert)
    envelope.content = forge.util.createBuffer(EDIFACT)
    envelope.encrypt(undefined, forge.pki.oids['des-EDE3-CBC'])
    const der = Buffer.from(forge.asn1.toDer(envelope.toAsn1()).getBytes(), 'binary')
    expect(der.toString('latin1')).not.toContain('UNB+')
    expect(decryptWithForge(der, recipient)).toBe(EDIFACT)
  })

  it('decrypts inbound mail that a counterparty encrypted with OpenSSL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gridex-smime-roundtrip-'))
    writeFileSync(join(dir, 'in.edi'), EDIFACT, 'latin1')
    writeFileSync(join(dir, 'recipient.pem'), recipient.pem)
    execFileSync('openssl', ['smime', '-encrypt', '-binary', '-des3', '-outform', 'DER',
      '-in', join(dir, 'in.edi'), '-out', join(dir, 'out.p7m'), join(dir, 'recipient.pem')])
    const der = readFileSync(join(dir, 'out.p7m'))
    expect(decryptWithForge(der, recipient)).toBe(EDIFACT)
  })

  it('a different key cannot decrypt the message', () => {
    const other = syntheticRecipient('0f0e0d0c', 'gridex-synthetic-other-party')
    const envelope = forge.pkcs7.createEnvelopedData()
    envelope.addRecipient(recipient.cert)
    envelope.content = forge.util.createBuffer(EDIFACT)
    envelope.encrypt(undefined, forge.pki.oids['des-EDE3-CBC'])
    const der = Buffer.from(forge.asn1.toDer(envelope.toAsn1()).getBytes(), 'binary')
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(der.toString('binary'))) as unknown as {
      findRecipient: (cert: forge.pki.Certificate) => unknown
    }
    expect(p7.findRecipient(other.cert)).toBeNull()
  })
})
