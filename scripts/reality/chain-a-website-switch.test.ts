// Reality scenario A: new customers buy electricity on the supplier's website
// and the supplier switch runs against a simulated grid owner, as if live.
//
// The platform runs as `next start` with its real cron endpoints. The grid owner
// is its own process that only talks e-mail (SMTPS/IMAPS); the website is a
// client of the public website API with the tenant's own API key. The test
// only starts the world, lets it run on Vercel's cron cadence and inspects the
// outcome. Synthetic data only (E2E-, example.invalid).
import { writeFileSync } from 'node:fs'
import { afterAll, describe, expect, it } from 'vitest'
import { supabaseService } from '@/lib/supabase/service'
import { configurePlatformMailbox, configureTenant, LIVE, literal, sql, type LiveTenant } from '../helpers/live-chain-fixture'
import { goLiveOnWebsite, WEBSITE_ORIGIN } from '../helpers/reality/tenantWebsite'
import { startGridOwner, type GridOwnerSim } from '../helpers/reality/world'
import { detectStuckStates } from '../helpers/reality/stuckDetector'

const report: Record<string, unknown> = { scenario: 'A website switch', startedAt: new Date().toISOString() }
let tenant: LiveTenant
let gridOwner: GridOwnerSim
let apiKey = ''

describe.sequential('reality A — website customers switch supplier', () => {
  afterAll(() => {
    gridOwner?.stop()
    report.finishedAt = new Date().toISOString()
    writeFileSync(process.env.GRIDEX_REALITY_REPORT ?? '/tmp/reality-a-report.json', JSON.stringify(report, null, 2))
  })

  it('A1 the supplier goes live: Ediel identity, grid owner, published offer and website integration', async () => {
    expect(LIVE.cronSecret && LIVE.automationUserId).toBeTruthy()
    expect(configurePlatformMailbox()).toBe(1)
    tenant = await configureTenant(supabaseService as never)
    gridOwner = await startGridOwner({ edielId: tenant.issuerEdielId, email: tenant.gridOwnerEmail, pollMs: 10_000 })
    const provisioned = await goLiveOnWebsite(tenant, tenant.adminUserId)
    report.tenant = { companyId: tenant.companyId, supplier: tenant.supplierEdielId, gridOwner: tenant.issuerEdielId }
    report.websiteGoLive = { state: provisioned.state, launchReady: provisioned.launchReady, visibleContracts: provisioned.visibleContractCount,
      blockers: provisioned.readinessBlockers, warnings: provisioned.readinessWarnings }
    apiKey = provisioned.credential?.token ?? ''
    expect(provisioned.readinessBlockers, JSON.stringify(provisioned.readinessBlockers)).toEqual([])
    expect(apiKey).toBeTruthy()
  })

  it('A1b the website sees the published offer through its own API key', async () => {
    const response = await fetch(new URL('/api/v1/website/public-contracts', LIVE.appUrl), { headers: { authorization: `Bearer ${apiKey}`, origin: WEBSITE_ORIGIN } })
    const body = await response.json().catch(() => null) as { contracts?: unknown[]; data?: unknown[] } | null
    report.publicContracts = { status: response.status, count: (body?.contracts ?? body?.data ?? []).length }
    expect(response.status, JSON.stringify(body).slice(0, 500)).toBe(200)
  })

  it('A9 nothing is left stuck in any queue of this tenant', () => {
    const stuck = detectStuckStates({ graceSeconds: 600, companyIds: [tenant.companyId] })
    report.stuck = stuck
    expect(stuck.filter(row => row.kind === 'stuck')).toEqual([])
    expect(sql(`SELECT to_jsonb(count(*)) FROM public.companies WHERE id=${literal(tenant.companyId)}`)).toBe(1)
  })
})
