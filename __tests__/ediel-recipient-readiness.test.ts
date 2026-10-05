// masterplan: TR-06, AT-TR-06
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielCertificateTrustAuthority } from '@/lib/ediel/security/certificateTrust'
import { createSyntheticEdielRecipientFixture } from './helpers/syntheticEdielRecipientFixture'

type Row = Record<string, unknown>
const database = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  authority: null as EdielCertificateTrustAuthority | null,
  updates: [] as Row[],
}))

// Only the external database is substituted. Readiness selection calls the
// actual resolver, source-authority binding, recipient-set and PKIX/CRL guard.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  async rpc(name: string, args: Row) {
    if (name !== 'gridex_ediel_certificate_trust_read_v1') throw new Error(`unexpected_rpc:${name}`)
    const authority = database.authority
    const matches = authority && args.p_company_id === authority.companyId
      && args.p_environment === authority.environment && args.p_receiver_ediel_id === authority.receiverEdielId
    return { data: matches ? authority : null, error: null }
  },
  from(table: string) {
    if (!(table in database.tables)) throw new Error(`unexpected_table:${table}`)
    const filters: Array<(row: Row) => boolean> = []
    let maximum = Infinity
    let payload: Row | null = null
    let executed = false
    let affected: Row[] = []
    const execute = () => {
      if (!executed) {
        executed = true
        affected = database.tables[table].filter(row => filters.every(filter => filter(row))).slice(0, maximum)
        if (payload) {
          if (table !== 'ediel_route_profiles') throw new Error('unexpected_write')
          database.updates.push(payload)
          const update = payload
          affected.forEach(row => Object.assign(row, update))
        }
      }
      return { data: affected, error: null }
    }
    const query = {
      select() { return query },
      eq(column: string, value: unknown) { filters.push(row => row[column] === value); return query },
      in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return query },
      or(expression: string) {
        const tenant = expression.match(/^company_id\.eq\.([^,]+),and\(company_id\.is\.null,scope\.eq\.platform_shared\)$/)
        if (!tenant) throw new Error(`unexpected_or:${expression}`)
        filters.push(row => row.company_id === tenant[1] || (row.company_id === null && row.scope === 'platform_shared'))
        return query
      },
      order() { return query },
      limit(count: number) { maximum = count; return query },
      update(value: Row) { payload = value; return query },
      async maybeSingle() {
        const result = execute()
        return { data: result.data[0] ?? null, error: result.data.length > 1 ? new Error('ambiguous_read') : null }
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(execute()).then(resolve, reject)
      },
    }
    return query
  },
} }))

import { evaluateRouteProfileProductionReadiness } from '@/lib/ediel/routeProfileProductionReadiness'

const companyId = '10000000-0000-4000-8000-000000000001'
const otherCompanyId = '20000000-0000-4000-8000-000000000002'
const receiverEdielId = '91100'
let fixture: ReturnType<typeof createSyntheticEdielRecipientFixture>
beforeAll(() => { fixture = createSyntheticEdielRecipientFixture() })
afterAll(() => { fixture?.dispose() })

function authority(): EdielCertificateTrustAuthority {
  return {
    companyId, environment: 'production', receiverEdielId,
    registrationId: 'synthetic-readiness-registration', registerVersion: 'synthetic-unit-v1',
    originalReference: 'synthetic://readiness-unit-only', originalSha256: 'a'.repeat(64),
    authorizationReference: 'synthetic://does-not-authorize-live-traffic',
    validFrom: new Date(Date.now() - 60_000).toISOString(), validTo: new Date(Date.now() + 86_400_000).toISOString(),
    recipientFingerprints: [fixture.fingerprint], anchors: [fixture.anchorPem], intermediates: [], crls: [fixture.cleanCrl],
  }
}

beforeEach(() => {
  database.authority = authority()
  database.updates = []
  database.tables = { ediel_route_profiles: [], communication_routes: [], ediel_certificates: [] }
})

function arrange(selection: 'explicit' | 'candidate', changes: Row = {}) {
  database.tables.ediel_certificates = [{
    id: 'recipient', company_id: companyId, scope: 'tenant_owned', environment: 'production',
    usage: 'outbound_recipient', purpose: 'encryption', owner_ediel_id: receiverEdielId,
    owner_subaddress: 'PRODAT', message_family: 'PRODAT', business_code: 'Z04', status: 'active',
    public_certificate_pem: fixture.leafPem, fingerprint_sha256: fixture.fingerprint,
    valid_from: fixture.leaf.validFrom, valid_to: fixture.leaf.validTo, ...changes,
  }]
  const profile: Row = {
    id: 'profile', company_id: companyId, communication_route_id: 'communication-route',
    is_enabled: true, is_active: true, is_production_ready: true, production_mode: 'live',
    environment: 'production', transport_mode: 'smtp', encryption_mode: 'smime',
    allow_unencrypted_production: false, application_reference: 'synthetic-system-reference',
    sender_ediel_id: 'synthetic-sender', receiver_ediel_id: receiverEdielId,
    receiver_message_subaddress: 'PRODAT', receiver_subaddress: null, receiver_sub_address: null,
    message_family: 'PRODAT', business_code: 'Z04', message_code: 'Z04',
    smtp_to: 'synthetic-receiver@example.invalid', receiver_email: 'synthetic-receiver@example.invalid',
    receiver_certificate_id: selection === 'explicit' ? 'recipient' : null, certificate_id: null,
    security_policy_status: 'approved',
    metadata: {
      production_send_lock_status: 'approved', receiver_certificate_status: 'approved',
      receiver_certificate_id: 'previous-recipient', receiver_certificate_fingerprint: 'b'.repeat(64),
    },
  }
  database.tables.ediel_route_profiles = [profile]
  database.tables.communication_routes = [{
    id: 'communication-route', company_id: companyId, is_active: true,
    target_email: 'synthetic-receiver@example.invalid', counterparty_ediel_id: receiverEdielId,
  }]
  return profile
}

const evaluate = (persist: boolean) => evaluateRouteProfileProductionReadiness({
  routeProfileId: 'profile', actorUserId: 'synthetic-admin', applyFixes: persist, approveProduction: persist,
})

describe.each(['explicit', 'candidate'] as const)('production recipient readiness via %s', selection => {
  it('approves only the actually trusted own recipient and records its fingerprint', async () => {
    const profile = arrange(selection)
    const result = await evaluate(true)
    expect(result).toMatchObject({
      ready: true, status: 'ready', blockers: [],
      updates: { receiver_certificate_id: 'recipient', security_policy_status: 'approved', is_production_ready: true, production_mode: 'live' },
      evidence: { certificate: { id: 'recipient', fingerprintSha256: fixture.fingerprint, ownerEdielId: receiverEdielId } },
    })
    expect(profile).toMatchObject({
      company_id: companyId, receiver_certificate_id: 'recipient', security_policy_status: 'approved',
      metadata: { receiver_certificate_status: 'approved', receiver_certificate_id: 'recipient', receiver_certificate_fingerprint: fixture.fingerprint },
    })
    expect(database.updates).toHaveLength(1)
  })

  it('records the verified PEM fingerprint instead of a forged stored label without changing the row', async () => {
    const forgedFingerprint = 'f'.repeat(64)
    const profile = arrange(selection, { fingerprint_sha256: forgedFingerprint })
    const rawRow = database.tables.ediel_certificates[0]
    const result = await evaluate(true)
    expect(result.ready).toBe(true)
    expect(result.evidence.certificate).toMatchObject({ id: 'recipient', fingerprintSha256: fixture.fingerprint })
    expect(profile.metadata).toMatchObject({ receiver_certificate_fingerprint: fixture.fingerprint })
    expect(rawRow.fingerprint_sha256).toBe(forgedFingerprint)
  })

  it.each([
    { name: 'foreign company', change: { company_id: otherCompanyId } },
    { name: 'wrong business code', change: { business_code: 'Z03' } },
    { name: 'wrong receiver message subaddress', change: { owner_subaddress: 'OTHER' } },
  ])('blocks $name and withdraws cached security approval', async ({ change }) => {
    const profile = arrange(selection, change)
    const result = await evaluate(true)
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'receiver_certificate_missing' }))
    expect(result.evidence.certificate).toEqual({})
    expect(result.updates).toMatchObject({ security_policy_status: 'blocked', is_production_ready: false, production_mode: 'disabled' })
    expect(profile).toMatchObject({ security_policy_status: 'blocked', is_production_ready: false, production_mode: 'disabled', metadata: { receiver_certificate_status: 'blocked', receiver_certificate_id: null, receiver_certificate_fingerprint: null } })
    expect(database.updates).toHaveLength(1)
  })

  it.each(['missing authority', 'unregistered leaf', 'revoked leaf'] as const)('blocks %s and cannot persist cached certificate approval', async failure => {
    const profile = arrange(selection)
    database.authority = failure === 'missing authority' ? null : {
      ...authority(),
      ...(failure === 'unregistered leaf' ? { recipientFingerprints: ['b'.repeat(64)] } : { crls: [fixture.revokedCrl] }),
    }
    const result = await evaluate(true)
    expect(result.ready).toBe(false)
    expect(result.blockers).toContainEqual(expect.objectContaining({ code: 'receiver_certificate_missing' }))
    expect(result.evidence.certificate).toEqual({})
    expect(result.updates).toMatchObject({ security_policy_status: 'blocked', is_production_ready: false, production_mode: 'disabled' })
    expect(profile).toMatchObject({ security_policy_status: 'blocked', is_production_ready: false, production_mode: 'disabled', metadata: { receiver_certificate_status: 'blocked', receiver_certificate_id: null, receiver_certificate_fingerprint: null } })
    expect(database.updates).toHaveLength(1)
  })

  it('reports held trust during read-only checks without writing the profile', async () => {
    const profile = arrange(selection)
    database.authority = null
    const result = await evaluate(false)
    expect(result.ready).toBe(false)
    expect(result.updates.security_policy_status).toBe('blocked')
    expect(profile.security_policy_status).toBe('approved')
    expect(database.updates).toEqual([])
  })
})
