// masterplan: TR-01, AT-TR-01
// masterplan: TR-06, AT-TR-06, SC-060, TR-07, AT-TR-07, SC-061
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
const database = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], routes: [] as Record<string, unknown>[], authority: null as unknown, ignoreTenantFilter: false }))
// Only the external database read is substituted. Selection, scope, validity,
// source-authority binding, X509 chain and signed CRL verification are real.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  async rpc(name: string, args: Record<string, string>) {
    if (name !== 'gridex_ediel_certificate_trust_read_v1') throw new Error('unexpected_rpc')
    if (args.p_company_id !== '10000000-0000-4000-8000-000000000001' || args.p_environment !== 'test' || args.p_receiver_ediel_id !== 'synthetic-receiver') return { data: null, error: null }
    return { data: database.authority, error: null }
  },
  from(table: string) {
    if (!['ediel_certificates', 'ediel_route_profiles'].includes(table)) throw new Error('unexpected_table')
    const filters: ((row: Record<string, unknown>) => boolean)[] = []
    let maximum = Infinity
    const read = () => (table === 'ediel_certificates' ? database.rows : database.routes).filter(row => filters.every(filter => filter(row))).slice(0, maximum)
    const query = {
      select() { return query },
      eq(column: string, value: unknown) { filters.push(row => row[column] === value); return query },
      or(expression: string) {
        const match = expression.match(/^company_id\.eq\.([^,]+),and\(company_id\.is\.null,scope\.eq\.platform_shared\)$/)
        if (!match) throw new Error('unexpected_tenant_expression')
        if (!database.ignoreTenantFilter) filters.push(row => row.company_id === match[1] || (row.company_id === null && row.scope === 'platform_shared'))
        return query
      },
      in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return query },
      order() { return query },
      limit(count: number) { maximum = count; return query },
      async maybeSingle() { const rows = read(); return { data: rows[0] ?? null, error: rows.length > 1 ? new Error('ambiguous_read') : null } },
      then(resolve: (value: { data: Record<string, unknown>[]; error: null }) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve({ data: read(), error: null }).then(resolve, reject)
      },
    }
    return query
  },
} }))
import { verifyEdielCertificateTrust, type EdielCertificateTrustAuthority } from '@/lib/ediel/security/certificateTrust'
import { resolveOutboundRecipientCertificate, verifyRequiredRecipientCertificateSet } from '@/lib/ediel/security/outboundRecipientCertificate'
const scope = { companyId: '10000000-0000-4000-8000-000000000001', environment: 'test' as const, receiverEdielId: 'synthetic-receiver' }
let directory: string, leaf: string, secondLeaf: string, signingLeaf: string, authority: EdielCertificateTrustAuthority, cleanCrl: string, revokedCrl: string
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
  writeFileSync(path('ca.cnf'), readFileSync(path('ca.cnf'), 'utf8') + '\n[signing_only]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=codeSigning\n')
  openssl(['req', '-new', '-key', path('leaf.key'), '-out', path('signing.csr'), '-subj', '/CN=Synthetic signing-only recipient'])
  openssl(['ca', '-config', path('ca.cnf'), '-batch', '-extensions', 'signing_only', '-in', path('signing.csr'), '-out', path('signing.pem')])
  signingLeaf = readFileSync(path('signing.pem'), 'utf8')
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
  const row=(id:string,pem:string)=>({id,company_id:scope.companyId,scope:'tenant_owned',public_certificate_pem:pem,usage:'outbound_recipient',purpose:'encryption',owner_ediel_id:scope.receiverEdielId,environment:'test',status:'active',valid_from:new X509Certificate(pem).validFrom,valid_to:new X509Certificate(pem).validTo})
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

describe.each(['explicit ID', 'candidate search'] as const)('TR-06 actual recipient resolution through %s', selection => {
  const fingerprint = (pem: string) => new X509Certificate(pem).fingerprint256.replaceAll(':', '').toLowerCase()
  const row = (pem = leaf) => ({
    id: 'recipient', company_id: scope.companyId, scope: 'tenant_owned',
    public_certificate_pem: pem, usage: 'outbound_recipient', purpose: 'encryption',
    owner_ediel_id: scope.receiverEdielId, owner_subaddress: 'PRODAT',
    message_family: 'PRODAT', message_type: 'PRODAT', environment: 'test',
    status: 'active', encryption_status: 'valid', secret_reference: 'public://synthetic-recipient',
    valid_from: new X509Certificate(pem).validFrom, valid_to: new X509Certificate(pem).validTo,
  })
  const resolve = () => resolveOutboundRecipientCertificate({
    ...scope, receiverSubaddress: 'PRODAT', messageFamily: 'PRODAT', businessCode: 'Z03',
    certificateEnvironment: 'test', ...(selection === 'explicit ID' ? { certificateId: 'recipient' } : {}),
  })
  beforeEach(() => {
    database.rows = [row()]
    database.routes = []
    database.ignoreTenantFilter = false
    database.authority = authority
  })
  afterEach(() => vi.useRealTimers())

  it('returns only the verified legal recipient with real chain and signed revocation evidence', async () => {
    const before = structuredClone(database.rows)
    const result = await resolve()
    expect(result).toMatchObject({ id: 'recipient', ownerEdielId: scope.receiverEdielId, environment: 'test' })
    expect(result.recipientCertificates.map(certificate => certificate.id)).toEqual(['recipient'])
    expect(result.trustEvidence).toMatchObject({ verified: true, registrationId: 'synthetic-registration', leafFingerprint: fingerprint(leaf) })
    expect(result.trustEvidence.chainFingerprints).toHaveLength(2)
    expect(result.trustEvidence.crlSha256).toHaveLength(1)
    expect(database.rows).toEqual(before)
  })

  it.each([
    ['expired one hour ago', { valid_to: new Date(Date.now() - 3_600_000).toISOString() }],
    ['not valid until tomorrow', { valid_from: new Date(Date.now() + 86_400_000).toISOString() }],
    ['revoked', { status: 'revoked' }],
    ['security status revoked', { encryption_status: 'revoked' }],
    ['inactive', { status: 'inactive' }],
    ['wrong usage', { usage: 'inbound_private' }],
    ['wrong purpose', { purpose: 'signing' }],
    ['wrong receiver', { owner_ediel_id: 'other-receiver' }],
    ['wrong subaddress', { owner_subaddress: 'UTILTS' }],
    ['wrong family', { message_family: 'UTILTS' }],
    ['wrong business code', { message_type: 'Z01' }],
    ['wrong environment', { environment: 'production' }],
    ['malformed start', { valid_from: 'invalid' }],
  ])('holds %s without changing the certificate record', async (_name, change) => {
    database.rows = [{ ...row(), ...change }]
    const before = structuredClone(database.rows)
    await expect(resolve()).rejects.toThrow()
    expect(database.rows).toEqual(before)
  })

  it.each([-1, 0, 1])('enforces the exact mutable row expiry instant at offset %d ms', async offset => {
    const instant = new Date()
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(instant)
    database.rows = [{ ...row(), valid_to: new Date(instant.getTime() + offset).toISOString() }]
    if (offset > 0) expect((await resolve()).id).toBe('recipient')
    else await expect(resolve()).rejects.toThrow()
  })

  it.each(['before notBefore', 'at notAfter'] as const)('does not extend real PEM validity using permissive row dates: %s', async boundary => {
    const certificate = new X509Certificate(leaf)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(boundary === 'before notBefore' ? Date.parse(certificate.validFrom) - 1 : Date.parse(certificate.validTo))
    database.rows = [{ ...row(), valid_from: '2020-01-01T00:00:00Z', valid_to: '2040-01-01T00:00:00Z' }]
    await expect(resolve()).rejects.toThrow()
  })

  it('holds an actual signing-only X509 certificate despite an encryption label', async () => {
    database.rows = [row(signingLeaf)]
    database.authority = { ...authority, recipientFingerprints: [fingerprint(signingLeaf)] }
    await expect(resolve()).rejects.toThrow('certificate_trust_pkix_or_fresh_authenticated_crl_failed')
  })

  it.each([
    ['missing authority', null],
    ['foreign tenant authority', () => ({ ...authority, companyId: 'foreign-company' })],
    ['other environment authority', () => ({ ...authority, environment: 'production' })],
    ['other receiver authority', () => ({ ...authority, receiverEdielId: 'other-receiver' })],
    ['expired authority', () => ({ ...authority, validTo: new Date(Date.now() - 1).toISOString() })],
    ['unregistered leaf', () => ({ ...authority, recipientFingerprints: [fingerprint(secondLeaf)] })],
    ['missing authenticated CRL', () => ({ ...authority, crls: [] })],
    ['revoked signed CRL', () => ({ ...authority, crls: [revokedCrl] })],
    ['missing issuer chain', () => ({ ...authority, anchors: [secondLeaf] })],
  ])('holds %s instead of accepting mutable certificate metadata as authority', async (_name, source) => {
    database.authority = typeof source === 'function' ? source() : source
    await expect(resolve()).rejects.toThrow()
  })

  it('holds a stale issuer-signed CRL at the live verification time', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 2 * 86_400_000)
    await expect(resolve()).rejects.toThrow('certificate_trust_pkix_or_fresh_authenticated_crl_failed')
  })

  it('holds a foreign tenant record even when its public certificate matches the registered receiver', async () => {
    database.rows = [{ ...row(), company_id: '20000000-0000-4000-8000-000000000002' }]
    await expect(resolve()).rejects.toThrow()
  })

  it('enforces runtime tenant ownership even when the database read returns a foreign row', async () => {
    database.ignoreTenantFilter = true
    database.rows = [{ ...row(), company_id: '20000000-0000-4000-8000-000000000002' }]
    await expect(resolve()).rejects.toThrow()
  })

  it('ignores a foreign duplicate of the same public leaf without blocking its own registered row', async () => {
    database.rows = [{ ...row(), id: 'foreign', company_id: '20000000-0000-4000-8000-000000000002' }, row()]
    expect((await resolve()).recipientCertificates.map(certificate => certificate.id)).toEqual(['recipient'])
  })

  it('excludes foreign duplicates during required-set verification even when a database result includes them', async () => {
    database.ignoreTenantFilter = true
    database.rows = [{ ...row(), id: 'foreign', company_id: '20000000-0000-4000-8000-000000000002' }, row()]
    expect((await resolve()).recipientCertificates.map(certificate => certificate.id)).toEqual(['recipient'])
  })

  it('does not resolve a route profile owned by another tenant', async () => {
    database.routes = [{ id: 'route', company_id: '20000000-0000-4000-8000-000000000002', receiver_certificate_id: 'recipient', own_ediel_id: 'sender' }]
    await expect(resolveOutboundRecipientCertificate({ ...scope, routeProfileId: 'route', receiverSubaddress: 'PRODAT', messageFamily: 'PRODAT', businessCode: 'Z03' })).rejects.toThrow('route saknas i aktuell tenant')
  })

  it('uses the own tenant route to resolve its verified certificate', async () => {
    database.routes = [{ id: 'route', company_id: scope.companyId, receiver_certificate_id: 'recipient', own_ediel_id: 'sender' }]
    expect((await resolveOutboundRecipientCertificate({ ...scope, routeProfileId: 'route', receiverSubaddress: 'PRODAT', messageFamily: 'PRODAT', businessCode: 'Z03' })).id).toBe('recipient')
  })

  it.each([null, '', 'not-a-uuid', 'company,scope.eq.platform_shared'])('holds absent or malformed tenant identity %s', async companyId => {
    await expect(resolveOutboundRecipientCertificate({ ...scope, companyId })).rejects.toThrow('verifierad tenant/miljö')
  })

  it('preserves explicitly shared platform public certificates', async () => {
    database.rows = [{ ...row(), company_id: null, scope: 'platform_shared' }]
    expect((await resolve()).id).toBe('recipient')
  })

  it.each(['tenant_owned', 'route_specific'])('holds an unowned %s record', async recordScope => {
    database.rows = [{ ...row(), company_id: null, scope: recordScope }]
    await expect(resolve()).rejects.toThrow()
  })
})
