import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

describe('tenant Ediel readiness revalidation lifecycle', () => {
  const lifecycle = source('supabase/migrations/20260903141500_ediel_tenant_readiness_revalidation.sql')
  const systemAccess = source('supabase/migrations/20260903141600_ediel_system_readiness_snapshot_access.sql')
  const worker = source('lib/tenant/provisioningWorker.ts')

  it('binds readiness jobs to immutable snapshots and expands policy identity', () => {
    expect(lifecycle).toContain("'ediel_readiness_revalidate'")
    expect(lifecycle).toContain('v_snapshot.id::text')
    expect(lifecycle).toContain("'active_rule_packs'")
    expect(lifecycle).toContain("'enabled_message_profiles'")
    expect(lifecycle).toContain("'active_tenant_rule_profile_versions'")
    expect(lifecycle).toContain("'canonical-evidence-v3'")
  })

  it('fans global policy changes out to Ediel-participating active tenants', () => {
    expect(lifecycle).toContain('canonical_snapshot_ediel_rule_versions_global')
    expect(lifecycle).toContain('canonical_snapshot_ediel_rule_packs_global')
    expect(lifecycle).toContain('canonical_snapshot_ediel_message_profiles_global')
    expect(lifecycle).toContain('canonical_snapshot_ediel_rule_profile_versions')
    expect(lifecycle).toContain("c.status = 'active'")
    expect(lifecycle).toContain('public.ediel_production_state')
    expect(lifecycle).toContain('public.ediel_actor_settings')
  })

  it('keeps system snapshot capture service-role only without impersonating a user', () => {
    expect(systemAccess).toContain('if p_actor_user_id is null then')
    expect(systemAccess).toContain('p_company_id,\n      null,\n      p_reason')
    expect(systemAccess).toContain('from public, anon, authenticated')
    expect(systemAccess).toContain('to service_role')
  })

  it('processes readiness revalidation through the durable tenant worker', () => {
    expect(worker).toContain("job.job_key === 'ediel_readiness_revalidate'")
    expect(worker).toContain('getCompanyProductionReadiness(job.company_id')
    expect(worker).toContain('checkedBy: null')
    expect(worker).toContain('persist: true')
    expect(worker).toContain('ediel_readiness_revalidation_failed')
  })

  it('never auto-runs a dry-run or live transition from the background worker', () => {
    expect(worker).not.toContain('runProductionDryRun')
    expect(worker).not.toContain('canonical_transition_ediel_production')
    expect(worker).not.toContain('ACTIVATE PRODUCTION')
    expect(worker).not.toContain('RESUME PRODUCTION')
  })
})
