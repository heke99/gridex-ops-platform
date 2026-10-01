import { beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose'
import { scannerSha256, scannerTrustEntry, scanBinding, SUPPORT_SCAN_PURPOSE, type SupportScanChallenge } from '@/lib/customer-cases/scannerProof'
import { assessSupportAttachmentScan, prepareSupportAttachmentScan, recordSupportAttachmentScannerVerdict } from '@/lib/customer-cases/attachmentScan'

const f = vi.hoisted(() => ({ challenge: {} as Record<string,unknown>,bytes: 'Synthetic private bytes',
  events: [] as string[],proofs: [] as Record<string,unknown>[],verdict: 'clean',
  reservePatch: {} as Record<string,unknown>,assessmentPatch: {} as Record<string,unknown>,revokeAfterRead: false,revokeServerOnDownload: false }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string,args: Record<string,unknown>) => {
    f.events.push(name)
    if (name === 'gridex_reserve_support_attachment_scan_v1') return { data: { ...f.challenge,...f.reservePatch },error: null }
    if (name === 'gridex_record_support_attachment_scan_v1') {
      const proof = args.p_proof as Record<string,unknown>; f.proofs.push(proof)
      return { data: { nonceId: f.challenge.nonceId,attachmentId: f.challenge.attachmentId,verdict: proof.verdict,
        outcome: 'blocked_provider_qualification',releaseAllowed: false,replayed: false },error: null }
    }
    if (f.revokeAfterRead && args.p_witness) return { data: null,error: { code: '42501',message: 'support_actor_forbidden' } }
    const { nonceId: _nonce,issuedAt: _issued,expiresAt: _expiry,issuerHash: _issuer,subjectHash: _subject,keyHash: _key,...binding } = f.challenge
    void [_nonce,_issued,_expiry,_issuer,_subject,_key]
    return { data: { binding,verdict: f.verdict,releaseAllowed: false,quarantine: 'quarantined',
      physicalHashVerified: Boolean(args.p_witness),outcome: f.verdict === 'clean' ? 'blocked_provider_qualification' : 'blocked_scan_verdict',
      ...f.assessmentPatch },error: null }
  },
  storage: { from: (bucket: string) => ({ download: async (key: string) => {
    f.events.push('private_download:' + bucket + ':' + key)
    if (f.revokeServerOnDownload) process.env.GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST = '{}'
    return { data: new Blob([f.bytes]),error: null }
  } }) },
} }))
const uuid = (n: number) => 'ed410000-0000-4000-8000-' + String(n).padStart(12,'0')
let key: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'],jwk: JWK,configuration: string
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); key = pair.privateKey
  jwk = { ...await exportJWK(pair.publicKey),alg: 'RS256',use: 'sig',kid: 'synthetic-scan-key' }
  configuration = JSON.stringify({ [uuid(1)]: { issuer: 'https://synthetic-scanner.example.invalid',audience: 'isolated-scanner-proof',
    subject: 'synthetic-scanner-principal',kid: jwk.kid,purpose: SUPPORT_SCAN_PURPOSE,jwks: { keys: [jwk] } } })
})
beforeEach(async () => {
  vi.stubEnv('GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST',configuration)
  f.events = []; f.proofs = []; f.bytes = 'Synthetic private bytes'; f.verdict = 'clean'
  f.reservePatch = {}; f.assessmentPatch = {}; f.revokeAfterRead = false; f.revokeServerOnDownload = false
  const now = Math.floor(Date.now()/1000),entry = await scannerTrustEntry(uuid(1),configuration)
  f.challenge = { companyId: uuid(1),customerId: uuid(2),caseId: uuid(3),attachmentId: uuid(4),scanIntentId: uuid(5),
    reservationHash: 'a'.repeat(64),revision: 1,bucket: 'customer-support-quarantine',objectKey: `${uuid(1)}/${uuid(2)}/${uuid(3)}/${uuid(4)}`,
    sha256: scannerSha256(f.bytes),byteSize: Buffer.byteLength(f.bytes),objectId: uuid(6),objectVersion: 'synthetic-v1',
    objectUpdatedAt: '2026-09-30T10:00:00+00:00',nonceId: uuid(7),issuedAt: now,expiresAt: now+120,...entry!.trust }
})
const challenge = () => f.challenge as SupportScanChallenge
async function token(patch: Record<string,unknown> = {},signingKey = key,typ = 'gridex-support-attachment-scan+jwt') {
  const c = challenge()
  return new SignJWT({ purpose: SUPPORT_SCAN_PURPOSE,binding_sha256: scannerSha256(scanBinding(c)),verdict: 'clean',
    iss: 'https://synthetic-scanner.example.invalid',sub: 'synthetic-scanner-principal',aud: 'isolated-scanner-proof',
    iat: c.issuedAt,exp: c.expiresAt,jti: c.nonceId,...patch }).setProtectedHeader({ alg: 'RS256',kid: jwk.kid,typ }).sign(signingKey)
}
const context = () => ({ companyId: uuid(1),customerId: uuid(2),actor: { kind: 'ops' as const,userId: uuid(10),sessionId: uuid(11) } })
it('actual local signature verification records exact stored bytes privately and never releases a clean file', async () => {
  const prepared = await prepareSupportAttachmentScan({ companyId: uuid(1),attachmentId: uuid(4) })
  expect(prepared).toEqual(challenge())
  expect(await recordSupportAttachmentScannerVerdict({ challenge: prepared,token: await token() })).toMatchObject({
    verdict: 'clean',outcome: 'blocked_provider_qualification',releaseAllowed: false,replayed: false,
  })
  expect(f.proofs).toHaveLength(1)
  expect(f.proofs[0]).toMatchObject({ requestHash: scannerSha256(scanBinding(prepared)),nonceHash: scannerSha256(prepared.nonceId),
    physicalSha256: prepared.sha256,physicalByteSize: prepared.byteSize })
})
it.each([
  { purpose: 'gridex_support_sensitive_contact_v1' },{ jti: uuid(99) },{ binding_sha256: 'b'.repeat(64) },
  { sub: 'untrusted-scanner' },{ company_id: uuid(99) },{ verdict: 'released' },{ exp: 1 },
])('signed wrong purpose/nonce/hash/principal/fields/verdict/expiry is denied before storage or RPC: %j', async patch => {
  await expect(recordSupportAttachmentScannerVerdict({ challenge: challenge(),token: await token(patch) })).rejects.toThrow('support_attachment_scan_unavailable')
  expect(f.events).toEqual([]); expect(f.proofs).toEqual([])
})
it('unconfigured, revoked server key and forged signatures cannot confer scanner authority', async () => {
  const valid = await token(),other = await generateKeyPair('RS256')
  for (const signed of [await token({},other.privateKey),await token({},key,'gridex-support-sensitive+jwt')]) {
    await expect(recordSupportAttachmentScannerVerdict({ challenge: challenge(),token: signed })).rejects.toThrow('support_attachment_scan_unavailable')
  }
  vi.stubEnv('GRIDEX_SUPPORT_ATTACHMENT_SCANNER_TRUST','{}')
  await expect(recordSupportAttachmentScannerVerdict({ challenge: challenge(),token: valid })).rejects.toThrow('support_attachment_scan_unavailable')
  await expect(prepareSupportAttachmentScan({ companyId: uuid(1),attachmentId: uuid(4) })).rejects.toThrow('support_attachment_scan_unavailable')
  expect(f.events).toEqual([]); expect(f.proofs).toEqual([])
})
it('an equal-size changed physical object cannot consume a correctly signed verdict', async () => {
  const valid = await token(); f.bytes = 'Changedxx private bytes'
  expect(Buffer.byteLength(f.bytes)).toBe(challenge().byteSize)
  await expect(recordSupportAttachmentScannerVerdict({ challenge: challenge(),token: valid })).rejects.toThrow('support_attachment_scan_unavailable')
  expect(f.events.filter(event => event.startsWith('gridex_record'))).toEqual([]); expect(f.proofs).toEqual([])
})
it('a forged reservation owner or storage path is rejected before reading any object', async () => {
  f.reservePatch = { companyId: uuid(99) }
  await expect(prepareSupportAttachmentScan({ companyId: uuid(1),attachmentId: uuid(4) })).rejects.toThrow('support_attachment_scan_unavailable')
  f.reservePatch = { objectKey: 'foreign/object' }
  await expect(prepareSupportAttachmentScan({ companyId: uuid(1),attachmentId: uuid(4) })).rejects.toThrow('support_attachment_scan_unavailable')
  expect(f.events.filter(event => event.startsWith('private_download:'))).toEqual([])
})
it('current protected authority is rechecked after actual private byte inspection and no bytes/path leave the blocked result', async () => {
  const result = await assessSupportAttachmentScan(context(),uuid(4))
  expect(result).toEqual({ releaseAllowed: false,quarantine: 'quarantined',outcome: 'blocked_provider_qualification',
    verdict: 'clean',physicalHashVerified: true })
  expect(f.events[0]).toBe('gridex_assess_support_attachment_scan_v1')
  expect(f.events[1]).toMatch(/^private_download:/)
  expect(f.events[2]).toBe('gridex_assess_support_attachment_scan_v1')
  f.revokeAfterRead = true
  await expect(assessSupportAttachmentScan(context(),uuid(4))).rejects.toThrow('support_attachment_scan_unavailable')
})
it('malicious evidence stays blocked and an asserted release receipt is never trusted', async () => {
  f.verdict = 'malicious'
  expect(await assessSupportAttachmentScan(context(),uuid(4))).toMatchObject({ outcome: 'blocked_scan_verdict',releaseAllowed: false })
  f.assessmentPatch = { releaseAllowed: true }
  const downloads = f.events.filter(event => event.startsWith('private_download:')).length
  await expect(assessSupportAttachmentScan(context(),uuid(4))).rejects.toThrow('support_attachment_scan_unavailable')
  expect(f.events.filter(event => event.startsWith('private_download:'))).toHaveLength(downloads)
})
it('server trust revocation during private byte inspection prevents the previously verified proof from being persisted', async () => {
  const valid = await token(); f.revokeServerOnDownload = true
  await expect(recordSupportAttachmentScannerVerdict({ challenge: challenge(),token: valid })).rejects.toThrow('support_attachment_scan_unavailable')
  expect(f.proofs).toEqual([])
})
