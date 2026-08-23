import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260822224708_canonical_ediel_production_projection_convergence.sql'),
  'utf8',
)
const liveAccess = readFileSync(resolve(process.cwd(), 'lib/tenant/liveAccess.ts'), 'utf8')
const companySettings = readFileSync(resolve(process.cwd(), 'app/admin/company-settings/actions.ts'), 'utf8')

describe('canonical Ediel production projection convergence', () => {
  it('projects every canonical state to a valid compatibility status', () => {
    expect(migration).toContain("when 'live' then 'live'")
    expect(migration).toContain("when 'prepared' then 'production_prepared'")
    expect(migration).toContain("when 'configuring' then 'not_ready'")
    expect(migration).toContain("when 'disabled' then 'not_ready'")
    expect(migration).toContain("when 'retired' then 'blocked'")
  })

  it('keeps company compatibility fields synchronized and protected from direct drift', () => {
    expect(migration).toContain('ediel_production_state_sync_company_projection')
    expect(migration).toContain('companies_enforce_canonical_ediel_projection')
    expect(migration).toContain('new.ediel_production_status := v_projection_status')
    expect(migration).toContain("new.live_ediel_enabled := v_state.state = 'live'")
    expect(migration).toContain("new.ediel_production_enabled := v_state.state = 'live'")
  })

  it.each([
    'gridex_automation_control_center_v',
    'gridex_batch_2b_live_control_tower_v',
    'gridex_batch_2c_control_tower_summary_v',
  ])('reads canonical ediel_production_state in %s', (viewName) => {
    const start = migration.indexOf(`create or replace view public.${viewName}`)
    expect(start).toBeGreaterThanOrEqual(0)
    const nextView = migration.indexOf('create or replace view public.', start + 1)
    const body = migration.slice(start, nextView === -1 ? undefined : nextView)
    expect(body).toContain('left join public.ediel_production_state eps on eps.company_id = c.id')
  })

  it('uses canonical production approval for live outbound access', () => {
    expect(liveAccess).toContain('isCompanyProductionApproved')
    expect(liveAccess).toContain('ediel_production_status')
    expect(liveAccess).toContain('ediel_production_enabled')
    expect(liveAccess).not.toContain("row?.production_status === 'live'")
  })

  it('uses the canonical production status helper when saving company settings', () => {
    expect(companySettings).toContain('getCompanyProductionStatus')
    expect(companySettings).toContain('productionStatus?.productionApproved === true')
    expect(companySettings).not.toContain("currentCompany.production_status === 'live'")
  })
})
