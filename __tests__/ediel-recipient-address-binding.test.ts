// IMP-05 recipient/address component only; return-path/history remain separate.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielCertificateTrustAuthority } from '@/lib/ediel/security/certificateTrust'
import { createSyntheticEdielRecipientFixture } from './helpers/syntheticEdielRecipientFixture'

type Row = Record<string, unknown>
const database = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, authority: null as EdielCertificateTrustAuthority | null, writes: [] as Row[] }))
// Finite external DB only. Resolver, required-set, X509/PKIX/CRL and readiness
// are actual implementations; these source receipts authorize no live traffic.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  async rpc(name: string, args: Row) {
    if (name !== 'gridex_ediel_certificate_trust_read_v1') throw Error(`unexpected_rpc:${name}`)
    const owner = database.authority
    return { data: owner && args.p_company_id === owner.companyId && args.p_environment === owner.environment && args.p_receiver_ediel_id === owner.receiverEdielId ? owner : null, error: null }
  },
  from(table: string) {
    if (!(table in database.tables)) throw Error(`unexpected_table:${table}`)
    const filters: Array<(row: Row) => boolean> = []
    let maximum = Infinity
    let payload: Row | null = null
    let executed = false
    let rows: Row[] = []
    const read = () => {
      if (!executed) {
        executed = true
        rows = database.tables[table].filter(row => filters.every(filter => filter(row))).slice(0, maximum)
        if (payload) {
          if (table !== 'ediel_route_profiles') throw Error('unexpected_write')
          database.writes.push(payload)
          const update = payload
          rows.forEach(row => Object.assign(row, update))
        }
      }
      return { data: rows, error: null }
    }
    const query = {
      select() { return query },
      eq(key: string, value: unknown) { filters.push(row => row[key] === value); return query },
      in(key: string, values: unknown[]) { filters.push(row => values.includes(row[key])); return query },
      or(expression: string) {
        const match = /^company_id\.eq\.([^,]+),and\(company_id\.is\.null,scope\.eq\.platform_shared\)$/.exec(expression)
        if (!match) throw Error(`unexpected_or:${expression}`)
        filters.push(row => row.company_id === match[1] || row.company_id === null && row.scope === 'platform_shared')
        return query
      },
      order() { return query },
      limit(value: number) { maximum = value; return query },
      update(value: Row) { payload = value; return query },
      async maybeSingle() { const result = read(); return { data: result.data[0] ?? null, error: result.data.length > 1 ? Error('ambiguous_read') : null } },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve(read()).then(resolve, reject) },
    }
    return query
  },
} }))

import { resolveOutboundRecipientCertificate } from '@/lib/ediel/security/outboundRecipientCertificate'
import { verifyEdielCertificateTrust } from '@/lib/ediel/security/certificateTrust'
import { evaluateRouteProfileProductionReadiness } from '@/lib/ediel/routeProfileProductionReadiness'
const companyId = '10000000-0000-4000-8000-000000000001'
const target = 'recipient@example.invalid'
const oldTarget = 'old-recipient@example.invalid'
const scope = { companyId, environment: 'production' as const, receiverEdielId: 'synthetic-receiver' }
type Fixture = ReturnType<typeof createSyntheticEdielRecipientFixture>
let subject: Fixture, alias: Fixture, old: Fixture, unbound: Fixture, wildcard: Fixture
beforeAll(() => {
  subject = createSyntheticEdielRecipientFixture({ caCommonName: 'Synthetic subject CA', subjectEmail: target })
  alias = createSyntheticEdielRecipientFixture({ caCommonName: 'Synthetic alias CA', subjectEmail: oldTarget, subjectAltEmails: [oldTarget, target] })
  old = createSyntheticEdielRecipientFixture({ caCommonName: 'Synthetic old CA', subjectEmail: oldTarget, subjectAltEmails: [oldTarget] })
  unbound = createSyntheticEdielRecipientFixture({ caCommonName: 'Synthetic unbound CA', commonName: target })
  wildcard = createSyntheticEdielRecipientFixture({ caCommonName: 'Synthetic wildcard CA', subjectAltEmails: ['*@example.invalid'] })
})
afterAll(() => { for (const fixture of [subject, alias, old, unbound, wildcard]) fixture?.dispose() })
function owner(fixtures: Fixture[]): EdielCertificateTrustAuthority {
  return { ...scope, registrationId: 'synthetic-binding-owner', registerVersion: 'synthetic-v1',
    originalReference: `synthetic://${target}/not-address-authority`, originalSha256: 'a'.repeat(64), authorizationReference: `synthetic://${target}/not-address-authority`,
    validFrom: new Date(Date.now() - 60_000).toISOString(), validTo: new Date(Date.now() + 86_400_000).toISOString(),
    recipientFingerprints: fixtures.map(fixture => fixture.fingerprint), anchors: fixtures.map(fixture => fixture.anchorPem), intermediates: [], crls: fixtures.map(fixture => fixture.cleanCrl) }
}
function row(fixture: Fixture, id = 'recipient'): Row {
  return { id, company_id: companyId, scope: 'tenant_owned', environment: 'production', usage: 'outbound_recipient', purpose: 'encryption',
    owner_ediel_id: scope.receiverEdielId, owner_subaddress: 'PRODAT', message_family: 'PRODAT', business_code: 'Z04', status: 'active',
    public_certificate_pem: fixture.leafPem, valid_from: fixture.leaf.validFrom, valid_to: fixture.leaf.validTo,
    // Deliberately forged mutable address labels must never override signed bytes.
    subject: `emailAddress=${target}`, metadata: { lookupMail: target, subjectAltName: `email:${target}` } }
}
beforeEach(() => {
  database.tables = { ediel_certificates: [], ediel_route_profiles: [], communication_routes: [] }
  database.authority = null
  database.writes = []
})
function arrange(fixture: Fixture) {
  database.tables.ediel_certificates = [row(fixture)]
  database.authority = owner([fixture])
}
const input = { ...scope, receiverSubaddress: 'PRODAT', messageFamily: 'PRODAT', businessCode: 'Z04', smtpTo: target }
describe.each(['explicit', 'candidate'] as const)('actual signed SMTP binding via %s selection', selection => {
  const resolve = (smtpTo: string | null | undefined = target) => resolveOutboundRecipientCertificate({ ...input, smtpTo, ...(selection === 'explicit' ? { certificateId: 'recipient' } : {}) })
  it('accepts a real signed Subject-email without requiring SAN', async () => {
    arrange(subject)
    const result = await resolve('  RECIPIENT@EXAMPLE.INVALID  ')
    expect(result.id).toBe('recipient')
    expect(result.trustEvidence.verified).toBe(true)
    expect(database.writes).toEqual([])
  })
  it('accepts a literal signed SAN alias even when the Subject-email is the old address', async () => {
    arrange(alias)
    expect((await resolve()).recipientCertificates.map(leaf => leaf.id)).toEqual(['recipient'])
  })
  it.each(['old', 'unbound', 'wildcard'] as const)('holds %s signed identity despite mutable labels and opaque owner references', async kind => {
    const fixture = { old, unbound, wildcard }[kind]
    arrange(fixture)
    expect(await verifyEdielCertificateTrust({ scope, leafPem: fixture.leafPem, authority: database.authority! })).toMatchObject({ verified: true })
    const before = structuredClone(database.tables)
    await expect(resolve()).rejects.toThrow('receiver_certificate_smtp_identity_unqualified')
    expect(database.tables).toEqual(before)
    expect(database.writes).toEqual([])
  })
  it.each([null, '', '   '])('holds absent actual SMTP target %j rather than deriving one', async smtpTo => {
    arrange(subject)
    await expect(resolve(smtpTo)).rejects.toThrow('receiver_certificate_smtp_target_missing')
  })
  it('holds an omitted target even when certificate and route metadata supply an address', async () => {
    arrange(subject)
    await expect(resolveOutboundRecipientCertificate({ ...scope, ...(selection === 'explicit' ? { certificateId: 'recipient' } : {}), receiverSubaddress: 'PRODAT', messageFamily: 'PRODAT', businessCode: 'Z04' })).rejects.toThrow('receiver_certificate_smtp_target_missing')
  })
  it('holds the complete required set when its non-primary leaf belongs only to the old SMTP address', async () => {
    database.tables.ediel_certificates = [row(subject), row(old, 'other')]
    database.authority = owner([subject, old])
    await expect(resolve()).rejects.toThrow('receiver_certificate_smtp_identity_unqualified')
    expect(database.writes).toEqual([])
  })
  it('preserves all mandatory leaves and source order when every signed identity binds the target', async () => {
    database.tables.ediel_certificates = [row(subject), row(alias, 'alias')]
    database.authority = owner([alias, subject])
    const result = await resolve()
    expect(result.recipientCertificates.map(leaf => leaf.id)).toEqual(['alias', 'recipient'])
    expect(result.recipientCertificates.every(leaf => leaf.trustEvidence.verified)).toBe(true)
  })
})
describe('actual readiness observes a changed SMTP target', () => {
  function profile(smtpTo: string) {
    database.tables.ediel_route_profiles = [{ id: 'profile', company_id: companyId, communication_route_id: 'route', is_enabled: true, is_active: true,
      is_production_ready: true, production_mode: 'live', environment: 'production', transport_mode: 'smtp', encryption_mode: 'smime',
      application_reference: 'synthetic-reference', sender_ediel_id: 'synthetic-sender', receiver_ediel_id: scope.receiverEdielId,
      receiver_subaddress: 'PRODAT', message_family: 'PRODAT', message_code: 'Z04', receiver_certificate_id: 'recipient', smtp_to: smtpTo,
      metadata: { production_send_lock_status: 'approved' } }]
    database.tables.communication_routes = [{ id: 'route', target_email: smtpTo, endpoint: smtpTo, is_active: true }]
  }
  it('does not approve the new mailbox under a genuine old-only signed leaf and unchanged synthetic owner', async () => {
    arrange(old)
    profile(oldTarget)
    expect((await evaluateRouteProfileProductionReadiness({ routeProfileId: 'profile' })).ready).toBe(true)
    profile(target)
    const result = await evaluateRouteProfileProductionReadiness({ routeProfileId: 'profile', applyFixes: true, approveProduction: true })
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'receiver_certificate_missing' }))
    expect(database.tables.ediel_route_profiles[0]).toMatchObject({ is_production_ready: false, production_mode: 'disabled', security_policy_status: 'blocked' })
    expect(database.tables.ediel_certificates).toEqual([row(old)])
  })
  it('accepts the changed mailbox when its exact address is already signed into the registered leaf', async () => {
    arrange(alias)
    profile(target)
    const result = await evaluateRouteProfileProductionReadiness({ routeProfileId: 'profile', applyFixes: true, approveProduction: true })
    expect(result.ready).toBe(true)
    expect(database.tables.ediel_route_profiles[0]).toMatchObject({ is_production_ready: true, production_mode: 'live', security_policy_status: 'approved' })
  })
})
