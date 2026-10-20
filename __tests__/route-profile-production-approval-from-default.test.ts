// FINDINGS F38: production approval of a route profile was blocked by the profile's own default state
// (is_production_ready=false, production_mode='disabled'), so no new profile could ever be approved.
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
const receiverEdielId = '91100'
let fixture: ReturnType<typeof createSyntheticEdielRecipientFixture>
beforeAll(() => { fixture = createSyntheticEdielRecipientFixture({ subjectEmail: 'synthetic-receiver@example.invalid' }) })
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

function arrange(changes: { profile?: Row; metadata?: Row } = {}) {
  database.tables.ediel_certificates = [{
    id: 'recipient', company_id: companyId, scope: 'tenant_owned', environment: 'production',
    usage: 'outbound_recipient', purpose: 'encryption', owner_ediel_id: receiverEdielId,
    owner_subaddress: 'PRODAT', message_family: 'PRODAT', business_code: 'Z01', status: 'active',
    public_certificate_pem: fixture.leafPem, fingerprint_sha256: fixture.fingerprint,
    valid_from: fixture.leaf.validFrom, valid_to: fixture.leaf.validTo,
  }]
  // A freshly materialized profile: the column defaults, nothing approved yet.
  const profile: Row = {
    id: 'profile', company_id: companyId, communication_route_id: 'communication-route',
    is_enabled: true, is_active: true, is_production_ready: false, production_mode: 'disabled',
    environment: 'production', transport_mode: 'smtp', encryption_mode: 'smime',
    allow_unencrypted_production: false, application_reference: 'synthetic-system-reference',
    sender_ediel_id: 'synthetic-sender', receiver_ediel_id: receiverEdielId,
    receiver_message_subaddress: 'PRODAT', receiver_subaddress: null, receiver_sub_address: null,
    message_family: 'PRODAT', business_code: 'Z01', message_code: 'Z01',
    smtp_to: 'synthetic-receiver@example.invalid', receiver_email: 'synthetic-receiver@example.invalid',
    receiver_certificate_id: null, certificate_id: null, security_policy_status: 'receiver_certificate_required',
    metadata: { production_send_lock_status: 'approved', ...changes.metadata },
    ...changes.profile,
  }
  database.tables.ediel_route_profiles = [profile]
  database.tables.communication_routes = [{
    id: 'communication-route', company_id: companyId, is_active: true,
    target_email: 'synthetic-receiver@example.invalid', counterparty_ediel_id: receiverEdielId,
  }]
  return profile
}

const run = (approveProduction: boolean) => evaluateRouteProfileProductionReadiness({
  routeProfileId: 'profile', actorUserId: 'synthetic-admin', applyFixes: true, approveProduction,
})

describe('route profile production approval from the materialized default state', () => {
  it('approves a new profile when every real condition holds', async () => {
    const profile = arrange()
    const result = await run(true)
    expect(result).toMatchObject({ ready: true, blockers: [], updates: { is_production_ready: true, production_mode: 'live', security_policy_status: 'approved', receiver_certificate_id: 'recipient' } })
    expect(profile).toMatchObject({ is_production_ready: true, production_mode: 'live' })
  })

  it('a status evaluation still reports the profile as not production ready', async () => {
    const profile = arrange()
    const result = await run(false)
    expect(result.ready).toBe(false)
    expect(result.blockers.map(b => b.code)).toEqual(['production_route_profile_not_ready'])
    expect(profile).toMatchObject({ is_production_ready: false, production_mode: 'disabled' })
  })

  it.each([
    ['send lock not approved', { metadata: { production_send_lock_status: 'locked' } }, 'production_send_locked'],
    ['route profile disabled', { profile: { is_enabled: false } }, 'route_profile_disabled'],
    ['application reference missing', { profile: { application_reference: null } }, 'application_reference_missing'],
  ])('approval stays blocked by a real condition: %s', async (_case, changes, code) => {
    const profile = arrange(changes)
    const result = await run(true)
    expect(result.ready).toBe(false)
    expect(result.blockers.map(b => b.code)).toContain(code)
    expect(result.blockers.map(b => b.code)).not.toContain('production_route_profile_not_ready')
    expect(profile).toMatchObject({ is_production_ready: false, production_mode: 'disabled' })
  })

  it('approval stays blocked without a published certificate trust authority', async () => {
    database.authority = null
    const profile = arrange()
    const result = await run(true)
    expect(result.ready).toBe(false)
    expect(result.blockers.map(b => b.code)).toEqual(expect.arrayContaining(['receiver_certificate_missing', 'security_policy_not_approved']))
    expect(profile).toMatchObject({ is_production_ready: false, production_mode: 'disabled' })
  })
})
