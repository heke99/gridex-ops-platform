// masterplan: TR-01, AT-TR-01
// masterplan: TR-07, AT-TR-07, SC-061
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))
import { verifyEdielCertificateTrust, type EdielCertificateTrustAuthority } from '@/lib/ediel/security/certificateTrust'
import { verifyRequiredRecipientCertificateSet } from '@/lib/ediel/security/outboundRecipientCertificate'
const scope = { companyId: 'synthetic-company', environment: 'test' as const, receiverEdielId: 'synthetic-receiver' }
let directory: string, leaf: string, secondLeaf: string, authority: EdielCertificateTrustAuthority, cleanCrl: string, revokedCrl: string
function openssl(args: string[]) { return execFileSync('openssl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'ediel-trust-unit-'))
  const path = (name: string) => join(directory, name)
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path('ca.key'), '-out', path('ca.pem'), '-days', '365', '-subj', '/CN=Synthetic unit CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign'])
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', path('leaf.key'), '-out', path('leaf.csr'), '-subj', '/CN=Synthetic unit recipient'])
  writeFileSync(path('index.txt'), ''); writeFileSync(path('serial'), '1000'); writeFileSync(path('crlnumber'), '1000')
  writeFileSync(path('ca.cnf'), `[ca]\ndefault_ca=main\n[main]\ndatabase=${path('index.txt')}\nnew_certs_dir=${directory}\ncertificate=${path('ca.pem')}\nprivate_key=${path('ca.key')}\nserial=${path('serial')}\ncrlnumber=${path('crlnumber')}\ndefault_days=365\ndefault_crl_days=1\ndefault_md=sha256\npolicy=policy\nx509_extensions=recipient\n[policy]\ncommonName=supplied\n[recipient]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=emailProtection\n`)
  openssl(['ca', '-config', path('ca.cnf'), '-batch', '-in', path('leaf.csr'), '-out', path('leaf.pem')])
  openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', path('second.key'), '-out', path('second.csr'), '-subj', '/CN=Synthetic unit overlapping recipient'])
  openssl(['ca', '-config', path('ca.cnf'), '-batch', '-in', path('second.csr'), '-out', path('second.pem')]); secondLeaf = readFileSync(path('second.pem'),'utf8')
  openssl(['ca', '-config', path('ca.cnf'), '-gencrl', '-out', path('clean.crl')])
  leaf = readFileSync(path('leaf.pem'), 'utf8'); cleanCrl = readFileSync(path('clean.crl'), 'utf8')
  openssl(['ca', '-config', path('ca.cnf'), '-revoke', path('leaf.pem')]); openssl(['ca', '-config', path('ca.cnf'), '-gencrl', '-out', path('revoked.crl')]); revokedCrl = readFileSync(path('revoked.crl'), 'utf8')
  const now = Date.now()
  authority = { ...scope, registrationId: 'synthetic-registration', registerVersion: 'synthetic-version', originalReference: 'synthetic://crypto-unit-only', originalSha256: 'a'.repeat(64), authorizationReference: 'synthetic://unit-only-does-not-authorize-live',
    validFrom: new Date(now - 60_000).toISOString(), validTo: new Date(now + 31 * 86400_000).toISOString(), recipientFingerprints: [new X509Certificate(leaf).fingerprint256.replaceAll(':', '').toLowerCase()], anchors: [readFileSync(path('ca.pem'), 'utf8')], intermediates: [], crls: [cleanCrl] }
})
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })
describe('certificate trust cryptography with explicitly synthetic unit keys', () => {
  it('verifies the real signed chain and fresh issuer-bound CRL without proving source authorization', async () => {
    expect(await verifyEdielCertificateTrust({ scope, leafPem: leaf, authority })).toMatchObject({ verified: true, registerVersion: 'synthetic-version' })
  })
  it('holds a genuinely revoked leaf despite valid dates', async () => {
    expect(await verifyEdielCertificateTrust({ scope, leafPem: leaf, authority: { ...authority, crls: [revokedCrl] } })).toMatchObject({ verified: false, code: 'certificate_trust_pkix_or_fresh_authenticated_crl_failed' })
  })
  it('holds an otherwise trusted certificate not registered for the exact legal receiver', async () => {
    expect(await verifyEdielCertificateTrust({ scope, leafPem: leaf, authority: { ...authority, recipientFingerprints: ['b'.repeat(64)] } })).toMatchObject({ verified: false, code: 'certificate_trust_recipient_not_registered' })
  })
  it('holds a stale signed CRL at the actual verification time', async () => {
    expect(await verifyEdielCertificateTrust({ scope, leafPem: leaf, authority, now: new Date(Date.now() + 2 * 86400_000) })).toMatchObject({ verified: false, code: 'certificate_trust_pkix_or_fresh_authenticated_crl_failed' })
  })
  it('holds absent CRL originals rather than trusting a checked flag', async () => {
    expect(await verifyEdielCertificateTrust({ scope, leafPem: leaf, authority: { ...authority, crls: [] } })).toMatchObject({ verified: false, code: 'certificate_trust_originals_missing_or_unbounded' })
  })
  it('holds a corrupted CRL rather than accepting its date or issuer text', async () => {
    const lines = cleanCrl.split('\n'); lines[2] = (lines[2][0] === 'A' ? 'B' : 'A') + lines[2].slice(1)
    expect(await verifyEdielCertificateTrust({ scope, leafPem: leaf, authority: { ...authority, crls: [lines.join('\n')] } })).toMatchObject({ verified: false })
  })
  it.each([{ companyId: 'other' }, { environment: 'production' as const }, { receiverEdielId: 'other' }])('holds source authority from a different tenant/environment/receiver %o', async change => {
    expect(await verifyEdielCertificateTrust({ scope, leafPem: leaf, authority: { ...authority, ...change } })).toMatchObject({ verified: false, code: 'certificate_trust_scope_mismatch' })
  })
  it('holds an expired versioned source registration', async () => {
    expect(await verifyEdielCertificateTrust({ scope, leafPem: leaf, authority: { ...authority, validTo: new Date(Date.now() - 1).toISOString() } })).toMatchObject({ verified: false, code: 'certificate_trust_authority_missing_or_expired' })
  })
})

describe('protected source-owner required recipient set', () => {
  const fingerprint=(pem:string)=>new X509Certificate(pem).fingerprint256.replaceAll(':','').toLowerCase()
  const row=(id:string,pem:string)=>({id,public_certificate_pem:pem,usage:'outbound_recipient',purpose:'encryption',owner_ediel_id:scope.receiverEdielId,environment:'test',status:'active',valid_from:new X509Certificate(pem).validFrom,valid_to:new X509Certificate(pem).validTo})
  const setAuthority=()=>({...authority,recipientFingerprints:[fingerprint(secondLeaf),fingerprint(leaf)]})
  it('returns every verified leaf in source order rather than newest row order',async()=>{
    const result=await verifyRequiredRecipientCertificateSet({scope,authority:setAuthority(),rows:[row('first',leaf),row('second',secondLeaf)]})
    expect(result.map(certificate=>certificate.id)).toEqual(['second','first'])
    expect(result.every(certificate=>certificate.trustEvidence.verified)).toBe(true)
    expect(result.map(certificate=>certificate.serialNumber)).toEqual([new X509Certificate(secondLeaf).serialNumber,new X509Certificate(leaf).serialNumber])
  })
  it('holds the whole set when a required leaf is missing',async()=>{
    await expect(verifyRequiredRecipientCertificateSet({scope,authority:setAuthority(),rows:[row('first',leaf)]})).rejects.toThrow(/saknas eller är tvetydigt/)
  })
  it('holds ambiguous leaf records instead of choosing the latest',async()=>{
    await expect(verifyRequiredRecipientCertificateSet({scope,authority,rows:[row('first',leaf),row('duplicate',leaf)]})).rejects.toThrow(/saknas eller är tvetydigt/)
  })
  it('holds a required leaf from a different legal receiver scope',async()=>{
    await expect(verifyRequiredRecipientCertificateSet({scope,authority,rows:[{...row('first',leaf),owner_ediel_id:'different'}]})).rejects.toThrow(/owner_mismatch/)
  })
  it('holds all recipients when any required leaf is actually revoked',async()=>{
    await expect(verifyRequiredRecipientCertificateSet({scope,authority:{...setAuthority(),crls:[revokedCrl]},rows:[row('first',leaf),row('second',secondLeaf)]})).rejects.toThrow(/pkix_or_fresh_authenticated_crl_failed/)
  })
})
