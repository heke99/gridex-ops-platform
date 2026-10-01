import forge from 'node-forge'
import { beforeAll, expect, it } from 'vitest'
import { encryptSmimeEnvelopedData, encryptSmimeEnvelopedDataWithForge, inspectCmsRecipientInfoWithForge } from '@/lib/ediel/transport/index.part-1'
import { inspectCmsRecipientCertificateSet } from '@/lib/ediel/transport/cmsRecipientSet'

const recipients: { certificate: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey; pem: string }[] = []
const payload = Buffer.from('Content-Type: application/EDIFACT\r\n\r\nsynthetic recipient-set regression', 'ascii')
beforeAll(() => {
  for (const name of ['current issuer', 'overlap issuer']) {
    const pair = forge.pki.rsa.generateKeyPair(1024)
    const certificate = forge.pki.createCertificate()
    certificate.publicKey = pair.publicKey; certificate.serialNumber = '04d2'
    certificate.validity.notBefore = new Date('2026-01-01'); certificate.validity.notAfter = new Date('2027-01-01')
    certificate.setSubject([{ name: 'commonName', value: 'synthetic recipient' }])
    certificate.setIssuer([{ name: 'commonName', value: name }]); certificate.sign(pair.privateKey)
    recipients.push({ certificate, key: pair.privateKey, pem: forge.pki.certificateToPem(certificate) })
  }
})

it.each(['openssl', 'forge'])('encrypts the entire required set through %s and each recipient decrypts the same bytes', async backend => {
  const pems = recipients.map(r => r.pem)
  const encryptedDer = backend === 'openssl'
    ? await encryptSmimeEnvelopedData({ innerMime: payload, recipientCertificatePems: pems })
    : encryptSmimeEnvelopedDataWithForge({ innerMime: payload, recipientCertificatePems: pems })
  expect(inspectCmsRecipientCertificateSet({ encryptedDer, recipientCertificatePems: pems })).toMatchObject({ expectedReceiverPresent: true, recipientCount: 2 })
  for (const recipient of recipients) {
    const envelope = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(encryptedDer.toString('binary'))) as forge.pkcs7.PkcsEnvelopedData
    const addressed = envelope.findRecipient(recipient.certificate)
    expect(addressed).not.toBeNull(); envelope.decrypt(addressed!, recipient.key)
    expect(Buffer.from((envelope.content as forge.util.ByteBuffer).getBytes(), 'binary')).toEqual(payload)
  }
})

it('rejects omitted recipients and an extra unintended recipient', () => {
  const pems = recipients.map(r => r.pem)
  const single = encryptSmimeEnvelopedDataWithForge({ innerMime: payload, recipientCertificatePem: pems[0] })
  expect(inspectCmsRecipientCertificateSet({ encryptedDer: single, recipientCertificatePems: pems }).expectedReceiverPresent).toBe(false)
  const both = encryptSmimeEnvelopedDataWithForge({ innerMime: payload, recipientCertificatePems: pems })
  expect(inspectCmsRecipientCertificateSet({ encryptedDer: both, recipientCertificatePems: [pems[0]] }).expectedReceiverPresent).toBe(false)
})

it('does not accept a matching serial belonging to a different issuer', () => {
  const encryptedDer = encryptSmimeEnvelopedDataWithForge({ innerMime: payload, recipientCertificatePem: recipients[0].pem })
  expect(inspectCmsRecipientCertificateSet({ encryptedDer, recipientCertificatePems: [recipients[1].pem] }).expectedReceiverPresent).toBe(false)
})

it('rejects duplicate, empty and ambiguous certificate sets before encryption', async () => {
  await expect(encryptSmimeEnvelopedData({ innerMime: payload, recipientCertificatePems: [] })).rejects.toThrow('recipient_set_invalid')
  await expect(encryptSmimeEnvelopedData({ innerMime: payload, recipientCertificatePems: [recipients[0].pem, recipients[0].pem] })).rejects.toThrow('recipient_set_ambiguous')
  await expect(encryptSmimeEnvelopedData({ innerMime: payload, recipientCertificatePem: recipients[0].pem, recipientCertificatePems: [recipients[1].pem] })).rejects.toThrow('inputs_ambiguous')
})

it('never accepts a serial integer embedded in bytes that are not an enveloped CMS message', () => {
  const encryptedDer = Buffer.from('3006020204d20500', 'hex')
  expect(inspectCmsRecipientInfoWithForge({ encryptedDer, expectedSerialNumber: '04D2' }).expectedReceiverPresent).toBe(false)
  expect(inspectCmsRecipientCertificateSet({ encryptedDer, recipientCertificatePems: [recipients[0].pem] }).expectedReceiverPresent).toBe(false)
})
