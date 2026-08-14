import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COMPANY_LIFECYCLE_TRANSITIONS,
  canTransitionCompanyStatus,
  isCompanyVisibleInTenantWorkspace,
  isCompanyWritableInTenantWorkspace,
} from '@/lib/tenant/lifecycle'

const actions = readFileSync('app/admin/companies/actions.ts', 'utf8')
const page = readFileSync('app/admin/companies/page.tsx', 'utf8')
const scope = readFileSync('lib/tenant/scope.ts', 'utf8')
const guards = readFileSync('lib/admin/guards.ts', 'utf8')
const lifecycleMigration = readFileSync('supabase/migrations/20260802010000_canonical_tenant_operation_policy_lifecycle.sql', 'utf8')
const offboardingMigration = readFileSync('supabase/migrations/20260810191822_canonical_lifecycle_offboarding_v1.sql', 'utf8')

describe('company lifecycle consistency', () => {
  it('mirrors the canonical database transition graph and keeps terminal states terminal', () => {
    expect(COMPANY_LIFECYCLE_TRANSITIONS.active).toEqual([
      'paused', 'suspended', 'archived', 'pending_deletion', 'closed',
    ])
    expect(COMPANY_LIFECYCLE_TRANSITIONS.archived).toEqual(['pending_deletion', 'closed'])
    expect(COMPANY_LIFECYCLE_TRANSITIONS.closed).toEqual([])
    expect(COMPANY_LIFECYCLE_TRANSITIONS.deleted_test_only).toEqual([])
    expect(canTransitionCompanyStatus('paused', 'active')).toBe(true)
    expect(canTransitionCompanyStatus('archived', 'active')).toBe(false)
    expect(lifecycleMigration).toContain("when 'archived' then p_target_status in ('pending_deletion','closed')")
  })

  it('treats paused as read-only and hides stopped tenants from normal tenant workspaces', () => {
    expect(isCompanyVisibleInTenantWorkspace('active')).toBe(true)
    expect(isCompanyVisibleInTenantWorkspace('onboarding')).toBe(true)
    expect(isCompanyVisibleInTenantWorkspace('paused')).toBe(true)
    for (const status of ['suspended', 'archived', 'pending_deletion', 'closed', 'deleted_test_only']) {
      expect(isCompanyVisibleInTenantWorkspace(status)).toBe(false)
    }
    expect(isCompanyWritableInTenantWorkspace('paused')).toBe(false)
    expect(isCompanyWritableInTenantWorkspace('active')).toBe(true)
    expect(scope).toContain('.filter((row) => isCompanyVisibleInTenantWorkspace(row.companyStatus))')
    expect(guards).toContain('isCompanyWritableInTenantWorkspace(membership.companyStatus)')
  })

  it('accepts the real canonical transition contract instead of requiring a nonexistent ok flag', () => {
    expect(actions).toContain('result.ok === true || result.changed === true')
    expect(actions).toContain("result.changed === false && result.status === requestedStatus")
    expect(lifecycleMigration).toContain("'changed', true, 'company_id', p_company_id")
  })

  it('only renders lifecycle actions that are valid for the current company state', () => {
    expect(page).toContain('canTransitionCompanyStatus(currentStatus, status)')
    expect(page).toContain("company.status === 'closed' || company.status === 'deleted_test_only'")
    expect(page).toContain('Bolaget är terminalt stängt. Inga fler lifecycle-åtgärder är tillåtna.')
  })

  it('makes test deletion a terminal tombstone and refuses it when operational history exists', () => {
    expect(actions).toContain("status: 'pending_deletion'")
    expect(actions).toContain("status: 'deleted_test_only'")
    expect(actions).toContain('if (blockers.length > 0)')
    expect(actions).toContain("action: 'SUPERADMIN_COMPANY_DELETED_TEST_ONLY'")
    expect(actions).not.toContain("message: blockers.length > 0\n        ? 'Hård radering är avstängd. Bolaget arkiverades")
  })

  it('keeps deleted_test_only exclusive to the blocker-gated test deletion action', () => {
    // setCompanyOperationalStatusAction accepts crafted next_status values. If
    // deleted_test_only is allowed there, history blockers are skipped even
    // though the DB transition graph permits onboarding/pending_deletion →
    // deleted_test_only.
    expect(actions).toContain("nextStatus === 'deleted_test_only'")
    expect(actions).toContain(
      'Terminal test-radering måste gå via Radera test-/felregistrering så att historikblockerare kontrolleras.',
    )
    expect(actions).toContain('deleteTestCompanyAction')
  })

  it('requires writable lifecycle status for tenant operate assertions, not only paused visibility', () => {
    expect(scope).toContain('isCompanyWritableInTenantWorkspace')
    expect(scope).toMatch(
      /assertUserCanOperateCompany[\s\S]*isCompanyWritableInTenantWorkspace\(membership\.companyStatus\)/,
    )
    expect(scope).not.toContain(
      'Du saknar en aktiv eller pausad bolagskoppling för valt elhandelsbolag.',
    )
  })

  it('pauses dependent runtime surfaces through the canonical offboarding function', () => {
    for (const surface of [
      'integration_api_clients',
      'webhook_subscriptions',
      'tenant_contract_channels',
      'company_provisioning_jobs',
      'customer_operation_jobs',
      'customer_portal_identities',
    ]) {
      expect(offboardingMigration).toContain(surface)
    }
    expect(offboardingMigration).toContain("p_target_status in ('paused','suspended','archived','pending_deletion','closed')")
    expect(offboardingMigration).toContain("client.launch_ready is true")
  })

  it('keeps tenant website activation guard compatible with lifecycle resume of launch-ready clients', () => {
    // Offboarding pauses active clients with lifecycle_paused_by_tenant and
    // resumes only launch_ready ones. The post-go-live activation guard must
    // not require provisioning_preflight_pending for that resume path.
    const activationLifecycleResume = readFileSync(
      'supabase/migrations/20260814180000_tenant_website_activation_lifecycle_resume.sql',
      'utf8',
    )
    expect(offboardingMigration).toContain("'lifecycle_paused_by_tenant', true")
    expect(offboardingMigration).toContain("client.launch_ready is true")
    expect(offboardingMigration).toContain("p_target_status = 'active'")
    expect(activationLifecycleResume).toContain('lifecycle_paused_by_tenant')
    expect(activationLifecycleResume).toContain("old.status = 'paused'")
    expect(activationLifecycleResume).toContain('new.launch_ready is true')
  })
})
