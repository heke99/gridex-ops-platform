import forge from 'node-forge'
import { createHash } from 'node:crypto'

const serial = (value: string) => value.toUpperCase().replace(/^0+/, '') || '0'
const issuer = (attributes: forge.pki.CertificateField[]) => forge.asn1.toDer(forge.pki.distinguishedNameToAsn1({ attributes })).toHex()
const identity = (attributes: forge.pki.CertificateField[], number: string) => `${issuer(attributes)}:${serial(number)}`

/** Pure cryptographic structure checks. Legal ownership, PKIX and revocation
 * are resolved by the source authority before these certificates reach SMTP. */
export function parseCmsRecipientCertificates(pems: readonly string[]): forge.pki.Certificate[] {
  if (!Array.isArray(pems) || !pems.length || pems.length > 16) throw new Error('ediel_cms_recipient_set_invalid')
  const fingerprints = new Set<string>(), identities = new Set<string>()
  return pems.map(pem => {
    if (typeof pem !== 'string' || pem.length > 65536 || (pem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length !== 1) throw new Error('ediel_cms_recipient_certificate_invalid')
    const certificate = forge.pki.certificateFromPem(pem)
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes()
    const fingerprint = createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex')
    const key = identity(certificate.issuer.attributes, certificate.serialNumber)
    if (fingerprints.has(fingerprint) || identities.has(key)) throw new Error('ediel_cms_recipient_set_ambiguous')
    fingerprints.add(fingerprint); identities.add(key)
    return certificate
  })
}

/** Require exactly the expected issuer-and-serial recipient set. A DER integer
 * occurring elsewhere, a matching serial with another issuer, or an extra CMS
 * recipient cannot prove that the actual intended recipients were encrypted. */
export function inspectCmsRecipientCertificateSet(input: { encryptedDer: Buffer; recipientCertificatePems: readonly string[] }): {
  expectedReceiverPresent: boolean; serialNumbers: string[]; recipientCount: number
} {
  const certificates = parseCmsRecipientCertificates(input.recipientCertificatePems)
  try {
    const asn1 = forge.asn1.fromDer(input.encryptedDer.toString('binary'), true)
    const message = forge.pkcs7.messageFromAsn1(asn1) as forge.pkcs7.PkcsEnvelopedData & { type?: string }
    if (message.type !== forge.pki.oids.envelopedData || !Array.isArray(message.recipients)) throw new Error('ediel_cms_envelope_required')
    const expected = new Set(certificates.map(c => identity(c.issuer.attributes, c.serialNumber)))
    const actual = message.recipients.map(r => identity(r.issuer, r.serialNumber))
    return { expectedReceiverPresent: actual.length === expected.size && new Set(actual).size === actual.length && actual.every(key => expected.has(key)),
      serialNumbers: message.recipients.map(r => serial(r.serialNumber)), recipientCount: actual.length }
  } catch {
    return { expectedReceiverPresent: false, serialNumbers: [], recipientCount: 0 }
  }
}
