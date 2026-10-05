// masterplan: TR-06, AT-TR-06
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { X509Certificate } from 'node:crypto'
import { createSyntheticEdielRecipientFixture } from './helpers/syntheticEdielRecipientFixture'
import type { EdielCertificateTrustAuthority } from '@/lib/ediel/security/certificateTrust'
import type { ExpisoftCertificateLookupResult } from '@/lib/ediel/security/expisoftCertificateDirectory'

type Row = Record<string, unknown>
const external = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  authority: null as EdielCertificateTrustAuthority | null,
  mutations: [] as Array<{ table: string; operation: string; payload: Row }>,
  directoryInputs: [] as Row[],
  directoryRow: null as Row | null,
  directoryResult: null as ExpisoftCertificateLookupResult | null,
}))

// Only the external database and directory are substituted. The actual caller,
// resolver, required recipient set, environment gate and persistence helper run.
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  async rpc(name: string, args: Row) {
    if (name === 'gridex_ediel_certificate_trust_read_v1') {
      const authority = external.authority
      const matches = authority && args.p_company_id === authority.companyId
        && args.p_environment === authority.environment && args.p_receiver_ediel_id === authority.receiverEdielId
      return { data: matches ? authority : null, error: null }
    }
    if (name === 'canonical_capture_ediel_configuration_snapshot') {
      if (args.p_company_id !== '10000000-0000-4000-8000-000000000001') throw new Error('unexpected_snapshot_company')
      external.mutations.push({ table: 'configuration_snapshot', operation: 'rpc', payload: args })
      return { data: { id: 'snapshot', configuration_hash: 'c'.repeat(64) }, error: null }
    }
    throw new Error(`unexpected_rpc:${name}`)
  },
  from(table: string) {
    if (!(table in external.tables)) throw new Error(`unexpected_table:${table}`)
    const filters: Array<(row: Row) => boolean> = []
    let maximum = Infinity
    let operation: 'insert' | 'update' | null = null
    let payload: Row = {}
    let executed = false
    let affected: Row[] = []
    const read = () => external.tables[table].filter(row => filters.every(filter => filter(row))).slice(0, maximum)
    const execute = () => {
      if (!executed) {
        executed = true
        if (operation) {
          external.mutations.push({ table, operation, payload: { ...payload } })
          if (operation === 'insert') {
            const row = { id: `${table}-${external.tables[table].length + 1}`, released_at: null, ...payload }
            external.tables[table].push(row)
            affected = [row]
          } else {
            affected = read()
            affected.forEach(row => Object.assign(row, payload))
          }
        } else affected = read()
      }
      return { data: affected, error: null }
    }
    const query = {
      select() { return query },
      eq(column: string, value: unknown) { filters.push(row => row[column] === value); return query },
      is(column: string, value: unknown) { filters.push(row => row[column] === value); return query },
      gt(column: string, value: string) { filters.push(row => String(row[column]) > value); return query },
      in(column: string, values: unknown[]) { filters.push(row => values.includes(row[column])); return query },
      or(expression: string) {
        const tenant = expression.match(/^company_id\.eq\.([^,]+),and\(company_id\.is\.null,scope\.eq\.platform_shared\)$/)
        const code = expression.match(/^business_code\.eq\.([^,]+),message_code\.eq\.\1,business_code\.is\.null,message_code\.is\.null$/)
        if (tenant) filters.push(row => row.company_id === tenant[1] || (row.company_id === null && row.scope === 'platform_shared'))
        else if (code) filters.push(row => row.business_code === code[1] || row.message_code === code[1] || row.business_code === null || row.message_code === null)
        else throw new Error(`unexpected_or:${expression}`)
        return query
      },
      order() { return query },
      limit(count: number) { maximum = count; return query },
      insert(value: Row) { operation = 'insert'; payload = value; return query },
      update(value: Row) { operation = 'update'; payload = value; return query },
      async maybeSingle() {
        const result = execute()
        return { data: result.data[0] ?? null, error: result.data.length > 1 ? new Error('ambiguous_read') : null }
      },
      async single() {
        const result = execute()
        if (result.data.length !== 1) throw new Error('expected_one_row')
        return { data: result.data[0], error: null }
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown, reject: (reason: unknown) => unknown) {
        return Promise.resolve(execute()).then(resolve, reject)
      },
    }
    return query
  },
} }))
vi.mock('@/lib/ediel/security/expisoftCertificateDirectory', () => ({
  async fetchReceiverCertificatesFromExpisoft(input: Row) {
    external.directoryInputs.push(input)
    if (external.directoryRow && !external.tables.ediel_certificates.some(row => row.id === external.directoryRow?.id)) {
      external.tables.ediel_certificates.push(external.directoryRow)
    }
    if (!external.directoryResult) throw new Error('unexpected_directory_lookup')
    return external.directoryResult
  },
}))

import { resolveEffectiveSystemTestCertificateId } from '@/app/admin/ediel/system-tests/actions.part-1'
import { prepareEdielTestRunTransportMetadata } from '@/lib/ediel/testing/testRunTransportMetadata'

const companyId = '10000000-0000-4000-8000-000000000001'
const otherCompanyId = '20000000-0000-4000-8000-000000000002'
const receiverEdielId = '91100'
const portalEmail = 'synthetic-receiver@example.invalid'
let fixture: ReturnType<typeof createSyntheticEdielRecipientFixture>
let leaf: X509Certificate
let leafPem: string
let anchorPem: string
let cleanCrl: string
let revokedCrl: string
let fingerprint: string

beforeAll(() => {
  fixture = createSyntheticEdielRecipientFixture({ subjectEmail: portalEmail })
  ;({ leaf, leafPem, anchorPem, cleanCrl, revokedCrl, fingerprint } = fixture)
})
afterAll(() => { fixture?.dispose() })

function authority(environment: 'test' | 'production'): EdielCertificateTrustAuthority {
  return {
    companyId, environment, receiverEdielId,
    registrationId: 'synthetic-preparation-registration', registerVersion: 'synthetic-unit-v1',
    originalReference: 'synthetic://preparation-unit-only', originalSha256: 'a'.repeat(64),
    authorizationReference: 'synthetic://does-not-authorize-live-traffic',
    validFrom: new Date(Date.now() - 60_000).toISOString(), validTo: new Date(Date.now() + 86_400_000).toISOString(),
    recipientFingerprints: [fingerprint], anchors: [anchorPem], intermediates: [], crls: [cleanCrl],
  }
}

function recipientRow(changes: Row = {}): Row {
  return {
    id: 'recipient', company_id: companyId, scope: 'tenant_owned', environment: 'production',
    usage: 'outbound_recipient', purpose: 'encryption', owner_ediel_id: receiverEdielId,
    owner_subaddress: 'PRODAT', message_family: 'PRODAT', business_code: null,
    status: 'active', public_certificate_pem: leafPem, valid_from: leaf.validFrom, valid_to: leaf.validTo,
    ...changes,
  }
}

beforeEach(() => {
  external.tables = {
    ediel_certificates: [], ediel_route_profiles: [], ediel_agt_readiness: [],
    ediel_test_runs: [], ediel_test_run_steps: [], ediel_test_run_locks: [],
  }
  external.authority = authority('production')
  external.mutations = []
  external.directoryInputs = []
  external.directoryRow = null
  external.directoryResult = null
})

function arrangeSystemSetup(selection: 'explicit' | 'local' | 'directory', changes: Row = {}) {
  const row = recipientRow(changes)
  if (selection !== 'directory') external.tables.ediel_certificates = [row]
  external.directoryRow = row
  external.directoryResult = {
    lookupEmail: portalEmail, ldapUrl: 'ldap://synthetic.invalid', fetchedFromLdap: true, throttled: false,
    certificatesFound: 1, diagnostics: { synthetic: true },
    certificates: [{
      certificateId: 'recipient', fingerprintSha256: fingerprint, pem: leafPem, subject: leaf.subject,
      issuer: leaf.issuer, serialNumber: leaf.serialNumber, validFrom: leaf.validFrom, validTo: leaf.validTo,
      status: 'valid', crlStatus: 'not_checked', subjectAltNames: null, crlDistributionPoints: null,
    }],
  }
  return {
    companyId, portalEmail, portalEdielId: receiverEdielId, receiverSubaddress: 'PRODAT',
    certificateId: selection === 'explicit' ? 'recipient' : null,
  }
}

describe.each(['explicit', 'local', 'directory'] as const)('system-test recipient preparation via %s', selection => {
  it('returns a genuinely trusted recipient for the selected company', async () => {
    expect(await resolveEffectiveSystemTestCertificateId(arrangeSystemSetup(selection))).toBe('recipient')
    expect(external.mutations).toEqual([])
    expect(external.directoryInputs).toEqual(selection === 'directory' ? [{
      smtpEmail: portalEmail, edielId: receiverEdielId, subaddress: 'PRODAT', companyId, forceRefresh: false,
    }] : [])
  })
  it('rejects an actually revoked recipient even when the directory calls it valid', async () => {
    external.authority = { ...authority('production'), crls: [revokedCrl] }
    await expect(resolveEffectiveSystemTestCertificateId(arrangeSystemSetup(selection))).rejects.toThrow(/pkix_or_fresh_authenticated_crl_failed/)
    expect(external.mutations).toEqual([])
  })
  it('rejects another company certificate even when the directory calls it valid', async () => {
    await expect(resolveEffectiveSystemTestCertificateId(arrangeSystemSetup(selection, { company_id: otherCompanyId }))).rejects.toThrow(/certifikatet recipient finns inte/)
    expect(external.mutations).toEqual([])
  })
  it('holds a changed mailbox despite a valid directory label for the old signed recipient', async () => {
    const input = arrangeSystemSetup(selection)
    await expect(resolveEffectiveSystemTestCertificateId({ ...input, portalEmail: 'new-recipient@example.invalid' })).rejects.toThrow('receiver_certificate_smtp_identity_unqualified')
    expect(external.mutations).toEqual([])
  })
})

function arrangeTestRun(changes: Row = {}) {
  external.authority = authority('test')
  external.tables.ediel_certificates = [recipientRow({ business_code: 'Z04', ...changes })]
  external.tables.ediel_route_profiles = [{
    id: 'route', company_id: companyId, is_enabled: true, environment: 'test', environment_type: 'agt_test',
    message_family: 'PRODAT', business_code: 'Z04', message_code: 'Z04', encryption_mode: 'smime',
    receiver_certificate_id: 'recipient', receiver_ediel_id: receiverEdielId,
    receiver_message_subaddress: 'PRODAT', sender_ediel_id: 'synthetic-sender', smtp_to: portalEmail,
    certificate_environment: 'test', target_system: 'ediel_portalen_agt', mailbox: '',
  }]
  external.tables.ediel_agt_readiness = [{
    company_id: companyId, actor_role: 'supplier', message_family: 'PRODAT', needs_retest: false,
    test_resource_confirmed: true, ediel_portal_login_confirmed: true,
    application_system_selected: true, edi_system_selected: true, readiness_status: 'portal_ready',
  }]
  external.tables.ediel_test_runs = [{
    id: 'prior-tgt', company_id: companyId, environment_type: 'tgt_test', role_code: 'supplier',
    message_family: 'PRODAT', status: 'approved',
  }]
  return {
    actorUserId: 'synthetic-admin', companyId, testSuite: 'PRODAT', roleCode: 'supplier', testCaseCode: 'L2',
    environment: 'test' as const, environmentType: 'agt_test', encryptionMode: 'smime',
  }
}

describe('test-run recipient preparation with actual AGT gates and persistence', () => {
  it('stores the company and verified Z04 recipient fingerprint before waiting for inbound', async () => {
    const run = await prepareEdielTestRunTransportMetadata(arrangeTestRun())
    expect(run).toMatchObject({
      company_id: companyId, role_code: 'supplier', test_case_code: 'L2', message_family: 'PRODAT',
      business_code: 'Z04', encryption_mode: 'smime', certificate_id: 'recipient',
      certificate_fingerprint_sha256: fingerprint, route_profile_id: 'route', environment_type: 'agt_test',
      configuration_snapshot_id: 'snapshot', configuration_hash: 'c'.repeat(64),
      raw_edifact: null, encrypted_payload_ref: null,
      actual_flow: [{ action: 'waiting_for_inbound_or_existing_runner' }],
    })
    expect(external.tables.ediel_test_run_steps).toMatchObject([{ company_id: companyId, test_run_id: run.id, expected_code: 'Z04' }])
    expect(external.tables.ediel_test_run_locks).toMatchObject([{ company_id: companyId, active_test_run_id: run.id }])
    expect(external.directoryInputs).toEqual([])
  })
  it.each([
    { name: 'foreign company', change: { company_id: otherCompanyId }, want: /certifikatet recipient finns inte/ },
    { name: 'wrong business code', change: { business_code: 'Z03' }, want: /message_code_mismatch/ },
  ])('rejects $name before locks, snapshots or run writes', async ({ change, want }) => {
    await expect(prepareEdielTestRunTransportMetadata(arrangeTestRun(change))).rejects.toThrow(want)
    expect(external.mutations).toEqual([])
  })
  it('rejects missing tenant/test source authority before locks, snapshots or run writes', async () => {
    const input = arrangeTestRun()
    external.authority = null
    await expect(prepareEdielTestRunTransportMetadata(input)).rejects.toThrow(/trust_and_revocation_evidence_missing/)
    expect(external.mutations).toEqual([])
  })
  it('rejects an actual revocation before locks, snapshots or run writes', async () => {
    const input = arrangeTestRun()
    external.authority = { ...authority('test'), crls: [revokedCrl] }
    await expect(prepareEdielTestRunTransportMetadata(input)).rejects.toThrow(/pkix_or_fresh_authenticated_crl_failed/)
    expect(external.mutations).toEqual([])
  })
  it('holds a changed mailbox before locks, snapshots or run writes', async () => {
    const input = arrangeTestRun()
    external.tables.ediel_route_profiles[0].smtp_to = 'new-recipient@example.invalid'
    await expect(prepareEdielTestRunTransportMetadata(input)).rejects.toThrow('receiver_certificate_smtp_identity_unqualified')
    expect(external.mutations).toEqual([])
  })
})
