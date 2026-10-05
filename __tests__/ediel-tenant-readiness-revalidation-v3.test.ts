import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

describe('tenant Ediel readiness revalidation v3 lifecycle', () => {
  const lifecycle = source('supabase/migrations/20260903162000_ediel_tenant_readiness_revalidation.sql')
  const systemAccess = source('supabase/migrations/20260903163000_ediel_system_readiness_snapshot_access.sql')
  const convergence = source('supabase/migrations/20260903164000_ediel_readiness_trigger_convergence.sql')
  const worker = source('lib/tenant/provisioningWorker.ts')

  it('queues exactly one readiness job per immutable tenant snapshot', () => {
    expect(lifecycle).toContain("'ediel_readiness_revalidate'")
    expect(lifecycle).toContain('v_snapshot.id::text')
    expect(lifecycle).toContain('on conflict (company_id, job_key, idempotency_key) do nothing')
    expect(lifecycle).toContain("'canonical-evidence-v3'")
  })

  it('includes global and tenant policy identity in the snapshot hash', () => {
    expect(lifecycle).toContain("'active_rule_versions'")
    expect(lifecycle).toContain("'active_rule_packs'")
    expect(lifecycle).toContain("'enabled_message_profiles'")
    expect(lifecycle).toContain("'active_tenant_rule_profile_versions'")
  })

  it('fans global policy changes out only to active Ediel-participating tenants', () => {
    expect(lifecycle).toContain('canonical_snapshot_ediel_rule_versions_global')
    expect(lifecycle).toContain('canonical_snapshot_ediel_rule_packs_global')
    expect(lifecycle).toContain('canonical_snapshot_ediel_message_profiles_global')
    expect(lifecycle).toContain('canonical_snapshot_ediel_rule_profile_versions')
    expect(lifecycle).toContain("c.status = 'active'")
    expect(lifecycle).toContain('public.ediel_production_state')
    expect(lifecycle).toContain('public.ediel_actor_settings')
  })

  it('allows system readiness evaluation without impersonating a human admin', () => {
    expect(systemAccess).toContain('if p_actor_user_id is null then')
    expect(systemAccess).toContain('p_company_id,\n      null,\n      p_reason')
    expect(systemAccess).toContain('to service_role')
    expect(systemAccess).toContain('from public, anon, authenticated')
  })

  it('processes readiness only and never auto-runs dry-run or live transition', () => {
    expect(worker).toContain("job.job_key === 'ediel_readiness_revalidate'")
    expect(worker).toContain('getCompanyProductionReadiness(job.company_id')
    expect(worker).toContain('checkedBy: null')
    expect(worker).toContain('persist: true')
    expect(worker).not.toContain('runProductionDryRun')
    expect(worker).not.toContain('canonical_transition_ediel_production')
  })

  it('removes the superseded snapshot-only rule-version trigger from PR 295', () => {
    expect(convergence).toContain('drop trigger if exists canonical_snapshot_ediel_rule_versions')
    expect(convergence).toContain('on public.ediel_rule_versions')
  })
})
