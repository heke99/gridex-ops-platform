// reality-defects: F115
// Owner decision 2026-10-23 "Spärra go-live": go-live readiness requires a selected invoice provider, by the same
// definition the monthly billing cron uses (requireTenantInvoiceProvider), and the tenant's admin gets the action
// (Fakturering → Integrationer, /admin/billing/integrations). The real readiness evaluator and the real go-live
// server actions run; only the database transport, auth guards, framework redirect and the independently owned
// certification/test-authority/scoped-capability evidence are finite ports. Synthetic data only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const COMPANY = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const MESSAGE = '33333333-3333-4333-8333-333333333333'

const port = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  rpcCalls: [] as Array<{ name: string; args: Row }>,
  redirects: [] as string[],
  seq: 0,
}))

vi.mock('@/lib/supabase/service', () => {
  class Query {
    filters: Array<(row: Row) => boolean> = []
    countMode = false
    maximum = Infinity
    inserted: Row | null = null
    constructor(readonly table: string) {}
    select(_fields?: string, options?: { count?: string; head?: boolean }) { if (options?.head) this.countMode = true; return this }
    eq(key: string, value: unknown) { this.filters.push(row => (row[key] ?? null) === value); return this }
    in(key: string, values: readonly unknown[]) { this.filters.push(row => values.includes(row[key])); return this }
    gt(key: string, value: unknown) { this.filters.push(row => String(row[key] ?? '') > String(value)); return this }
    order() { return this }
    limit(value: number) { this.maximum = value; return this }
    insert(row: Row) {
      const stored = { id: `${this.table}-${++port.seq}`, checked_at: new Date().toISOString(), created_at: new Date().toISOString(), ...row }
      ;(port.tables[this.table] ??= []).push(stored)
      this.inserted = stored
      return this
    }
    rows() {
      if (this.inserted) return [this.inserted]
      return (port.tables[this.table] ?? []).filter(row => this.filters.every(filter => filter(row))).slice(0, this.maximum)
    }
    async run(single: boolean) {
      if (this.countMode) return { count: this.rows().length, error: null }
      const rows = structuredClone(this.rows())
      return { data: single ? rows[0] ?? null : rows, error: null }
    }
    maybeSingle() { return this.run(true) }
    single() { return this.run(true) }
    then(done: (value: unknown) => unknown, failed?: (reason: unknown) => unknown) { return this.run(false).then(done, failed) }
  }
  return {
    supabaseService: {
      from: (table: string) => new Query(table),
      rpc: async (name: string, args: Row) => {
        port.rpcCalls.push({ name, args: structuredClone(args) })
        if (name === 'canonical_capture_ediel_configuration_snapshot') return { data: { id: 'snapshot-1', configuration_hash: 'hash-1' }, error: null }
        if (name === 'gridex_company_go_live_readiness') return { data: {}, error: null }
        if (name === 'canonical_transition_ediel_production') return { data: { state: args.p_target_state }, error: null }
        if (name === 'canonical_approve_first_live_send') return { data: { ok: true }, error: null }
        throw Error(`Unexpected RPC ${name}`)
      },
    },
  }
})
// Independently owned evidence: certified and complete for this synthetic tenant.
vi.mock('@/lib/ediel/certificationEvidence', () => ({ getEdielCertificationEvidenceReadiness: async () => ({ ready: true, missing: [] }) }))
vi.mock('@/lib/ediel/operations/runtimeHealth', () => ({ getLatestSystemClockHealth: async () => ({ status: 'healthy' }) }))
vi.mock('@/lib/ediel/productionReadinessTestAuthority', () => ({
  evaluateCanonicalActorTestReadiness: () => ({ ready: true, prodatPassed: 1, prodatTotal: 1, utiltsPassed: 1, utiltsTotal: 1, reason: null }),
}))
vi.mock('@/lib/ediel/scopedCapabilityReadiness', () => ({
  getScopedEdielProductionReadiness: async () => ({ ready: true, evidenceId: 'evidence-1', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scope: {}, dependencyHash: 'dep' }),
  assertScopedEdielProductionCapability: async () => undefined,
}))
vi.mock('@/lib/ediel/db', () => ({
  getEdielMessageById: async () => ({ id: MESSAGE, company_id: COMPANY, environment: 'production', direction: 'outbound', message_family: 'PRODAT', raw_payload: 'UNA:+.? \'' }),
}))
vi.mock('@/lib/integrations/tenantWebsiteReadiness', () => ({ reconcileTenantOperationalCapabilities: async () => [] }))
vi.mock('@/lib/ediel/actorTestingEngine', () => ({ runActorTestAutomation: vi.fn(), syncAllActorTestsForCompany: vi.fn() }))
vi.mock('@/lib/ediel/actorTestProjection', () => ({ projectCanonicalActorTestState: vi.fn() }))
vi.mock('@/lib/tenant/governance', () => ({ logTenantGovernanceEvent: vi.fn() }))
vi.mock('@/lib/admin/guards', () => {
  const admin = async () => ({ userId: ACTOR, email: 'platform@example.invalid', isPlatformAdmin: true })
  return { isPlatformAdminContext: () => true, requireAdminActionAccess: admin, requireCompanyScopedActionAccess: admin, requirePlatformAdminActionAccess: admin }
})
vi.mock('@/lib/ediel/actionAccess', () => {
  const admin = async () => ({ userId: ACTOR, email: 'platform@example.invalid', isPlatformAdmin: true })
  return {
    requireEdielProductionActivateActionAccess: admin, requireEdielTestAttestActionAccess: admin, requireEdielWriteActionAccess: admin,
    requireEdielProductionPauseActionAccess: admin, requireEdielProfileWriteActionAccess: admin,
  }
})
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { port.redirects.push(url); throw Object.assign(Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT' }) },
  unstable_rethrow: (error: unknown) => { if ((error as { digest?: string })?.digest === 'NEXT_REDIRECT') throw error },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }))

import { evaluateTenantInvoiceProviderReadiness, requireTenantInvoiceProvider } from '@/lib/billing/providers/registry'
import { getCompanyProductionReadiness } from '@/lib/ediel/productionReadiness'
import { activateLiveEdielAction, approveFirstLiveSendAction, resumeProductionEdielAction } from '@/app/admin/platform/actor-testing/actions'
import { approveCompanyProductionAction } from '@/app/admin/platform/go-live/approval-actions'

/** A tenant that passes every other go-live check: certified, routed, with BRP, tests and a valid dry run. */
function seedCertifiedTenant(company: Row = {}) {
  const future = new Date(Date.now() + 3_600_000).toISOString()
  port.tables = {
    companies: [{
      id: COMPANY, name: 'E2E Elhandel AB', org_number: '559999-0000', status: 'active', esett_status: 'ready',
      technical_contact_email: 'teknik@example.invalid', ediel_id: '73999',
      invoice_export_target_system: null, billing_provider_environment: null, invoice_export_enabled: false, ...company,
    }],
    ediel_actor_settings: [
      { id: 'actor-test', company_id: COMPANY, environment: 'test', is_active: true, ediel_id: '73998', actor_role: 'supplier' },
      { id: 'actor-production', company_id: COMPANY, environment: 'production', is_active: true, ediel_id: '73999', actor_role: 'supplier',
        sender_sub_address: 'SUB', operations_contact_email: 'drift@example.invalid' },
    ],
    ediel_route_profiles: [
      { id: 'route-test', company_id: COMPANY, environment: 'test', is_active: true, is_enabled: true, communication_route_id: 'cr-test', transport_type: 'smtp' },
      ...['PRODAT', 'UTILTS'].map(family => ({
        id: `route-${family}`, company_id: COMPANY, environment: 'production', is_active: true, is_enabled: true, message_family: family,
        communication_route_id: `cr-${family}`, encryption_mode: 'smime', tls_required: true, transport_type: 'smtp', mailbox_id: 'mailbox-production',
        receiver_source: 'selected_metering_point_grid_owner', dynamic_receiver_strategy: 'metering_point_grid_owner',
      })),
    ],
    ediel_mailboxes: [{ id: 'mailbox-production', company_id: null, environment: 'production', is_active: true, secret_reference: 'env:SYNTHETIC', username: 'ediel', last_poll_at: '2026-10-22T08:00:00Z' }],
    ediel_brp_settings: [{ id: 'brp-1', company_id: COMPANY, environment: 'production', brp_ediel_id: '48800', is_default: true, is_active: true }],
    ediel_send_locks: [],
    ediel_production_readiness_checks: [],
    ediel_go_live_events: [{ id: 'dry-run-1', company_id: COMPANY, event_type: 'production_dry_run', to_status: 'allowed', configuration_snapshot_id: 'snapshot-1',
      configuration_hash: 'hash-1', is_stale: false, expires_at: future, created_at: new Date().toISOString(), metadata: {} }],
    ediel_production_state: [{ company_id: COMPANY, state: company.ediel_production_status === 'paused' ? 'paused' : 'prepared', state_version: 3,
      first_live_send_approved_at: company.ediel_first_live_send_approved_at ?? null }],
    ediel_unresolved_items: [], ediel_messages: [], ediel_certificates: [],
  }
}

function form(fields: Row) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ company_id: COMPANY, ...fields })) data.set(key, String(value))
  return data
}

async function settle(action: Promise<unknown>) {
  await action.catch((error: unknown) => { if ((error as { digest?: string })?.digest !== 'NEXT_REDIRECT') throw error })
  const url = new URL(port.redirects.at(-1) ?? 'http://none', 'http://local')
  return { status: url.searchParams.get('status'), message: url.searchParams.get('message') ?? '' }
}

const transitions = (target: string) => port.rpcCalls.filter(call => call.name === 'canonical_transition_ediel_production' && call.args.p_target_state === target)
const persistedChecks = () => port.tables.ediel_production_readiness_checks as Array<{ status: string; blocking_issues: Array<{ code: string }> }>

beforeEach(() => {
  port.rpcCalls = []
  port.redirects = []
  seedCertifiedTenant()
})

describe('F115 shared predicate: go-live uses the billing cron definition of "a provider is selected"', () => {
  const cases: Row[] = [
    {},
    { invoice_export_target_system: null, billing_provider_environment: 'test' },
    { invoice_export_target_system: '', billing_provider_environment: 'production' },
    { invoice_export_target_system: 'nordfin', billing_provider_environment: null },
    { invoice_export_target_system: 'nordfin', billing_provider_environment: 'staging' },
    { invoice_export_target_system: 'fortnox', billing_provider_environment: 'production' },
    { invoice_export_target_system: 'nordfin', billing_provider_environment: 'test' },
    { invoice_export_target_system: 'capway_aptic', billing_provider_environment: 'production' },
    { invoice_export_target_system: 'file_export', billing_provider_environment: 'test' },
  ]
  it.each(cases)('agrees with requireTenantInvoiceProvider for %j', (company) => {
    let cronCode: string | null = null
    try { requireTenantInvoiceProvider(company) } catch (error) { cronCode = (error as { code: string }).code }
    const readiness = evaluateTenantInvoiceProviderReadiness(company)
    expect(readiness.ready).toBe(cronCode === null)
    if (!readiness.ready) {
      expect(readiness).toMatchObject({ code: 'invoice_provider_missing', reason: cronCode, actionHref: '/admin/billing/integrations', actionLabel: 'Välj fakturaleverantör' })
      expect(readiness.message).toMatch(/Fakturering → Integrationer/)
      expect(readiness.message).toMatch(/Go-live kräver en vald fakturaleverantör/)
    }
  })
})

describe('F115 go-live readiness requires a selected invoice provider', () => {
  it('a certified tenant without an invoice provider is not ready for go-live, with the action for its admin', async () => {
    const readiness = await getCompanyProductionReadiness(COMPANY, { checkedBy: ACTOR })
    const blocker = readiness.blockingIssues.find(issue => issue.code === 'invoice_provider_missing')
    expect(blocker, JSON.stringify(readiness.blockingIssues)).toMatchObject({
      severity: 'blocking', area: 'billing', label: 'Fakturaleverantör saknas',
      actionLabel: 'Välj fakturaleverantör', actionHref: '/admin/billing/integrations',
    })
    expect(blocker?.message).toContain('Ingen fakturaleverantör är vald för bolaget.')
    // It is the only gap: everything else about this tenant is ready.
    expect(readiness.blockingIssues.map(issue => issue.code)).toEqual(['invoice_provider_missing'])
    expect(readiness.status).toBe('not_ready')
  })

  it('the same tenant with a provider and environment chosen passes the check', async () => {
    seedCertifiedTenant({ invoice_export_target_system: 'nordfin', billing_provider_environment: 'test' })
    const readiness = await getCompanyProductionReadiness(COMPANY, { checkedBy: ACTOR })
    expect(readiness.blockingIssues).toEqual([])
    expect(readiness.passedChecks.map(issue => issue.code)).toContain('invoice_provider_selected')
    expect(['ready', 'warning']).toContain(readiness.status)
  })

  it('a provider without an environment is refused exactly as the cron refuses it', async () => {
    seedCertifiedTenant({ invoice_export_target_system: 'nordfin', billing_provider_environment: null })
    const readiness = await getCompanyProductionReadiness(COMPANY, { checkedBy: ACTOR })
    expect(readiness.blockingIssues.map(issue => issue.code)).toEqual(['invoice_provider_missing'])
    expect(readiness.blockingIssues[0].message).toContain('Fakturaleverantörens miljö (test/produktion) är inte vald för bolaget.')
  })

  it('a tenant already live is not retroactively blocked: the gap is a warning with the same action', async () => {
    seedCertifiedTenant({ ediel_production_status: 'live', ediel_production_enabled: true, live_ediel_enabled: true,
      live_approved_at: '2026-09-01T08:00:00Z', ediel_production_enabled_at: '2026-09-01T08:00:00Z', ediel_first_live_send_approved_at: '2026-09-01T08:05:00Z' })
    const readiness = await getCompanyProductionReadiness(COMPANY, { checkedBy: ACTOR })
    expect(readiness.status).toBe('live')
    expect(readiness.blockingIssues).toEqual([])
    expect(readiness.warnings.find(issue => issue.code === 'invoice_provider_missing')).toMatchObject({
      severity: 'warning', actionHref: '/admin/billing/integrations', actionLabel: 'Välj fakturaleverantör' })
  })
})

describe('F115 the server-side go-live transition refuses while the provider is missing', () => {
  it('activateLiveEdielAction does not take the tenant live and persists the blocker the canonical SQL gate refuses', async () => {
    const result = await settle(activateLiveEdielAction(form({ confirmation: 'ACTIVATE PRODUCTION' })))
    expect(result.status).toBe('blocked')
    expect(result.message).toContain('Ingen fakturaleverantör är vald för bolaget.')
    expect(transitions('live')).toEqual([])
    // canonical_company_readiness refuses prepared/live for a check with blocking_issues (20260802170000).
    expect(persistedChecks().at(-1)?.blocking_issues.map(issue => issue.code)).toContain('invoice_provider_missing')
  })

  it('the one-click production approval refuses before any transition or first-send approval', async () => {
    const result = await settle(approveCompanyProductionAction(form({ message_id: MESSAGE })))
    expect(result.status).toBe('blocked')
    expect(result.message).toContain('Ingen fakturaleverantör är vald för bolaget.')
    expect(port.rpcCalls.filter(call => ['canonical_transition_ediel_production', 'canonical_approve_first_live_send'].includes(call.name))).toEqual([])
  })

  it('the first live send cannot be approved without a provider', async () => {
    const result = await settle(approveFirstLiveSendAction(form({ confirmation: 'APPROVE FIRST LIVE SEND' })))
    expect(result.status).toBe('blocked')
    expect(port.rpcCalls.filter(call => call.name === 'canonical_approve_first_live_send')).toEqual([])
  })

  it('once the tenant admin has chosen a provider, the same go-live goes through', async () => {
    seedCertifiedTenant({ invoice_export_target_system: 'nordfin', billing_provider_environment: 'test' })
    const result = await settle(activateLiveEdielAction(form({ confirmation: 'ACTIVATE PRODUCTION' })))
    expect(result).toMatchObject({ status: 'live' })
    expect(transitions('live')).toHaveLength(1)
  })

  it('a paused tenant that was already live resumes without a provider (live traffic is not broken)', async () => {
    seedCertifiedTenant({ ediel_production_status: 'paused', live_approved_at: '2026-09-01T08:00:00Z', ediel_production_enabled_at: '2026-09-01T08:00:00Z',
      ediel_first_live_send_approved_at: '2026-09-01T08:05:00Z' })
    const result = await settle(resumeProductionEdielAction(form({ confirmation: 'RESUME PRODUCTION' })))
    expect(result).toMatchObject({ status: 'live' })
    expect(transitions('live')).toHaveLength(1)
    expect(persistedChecks().at(-1)?.blocking_issues).toEqual([])
  })
})
