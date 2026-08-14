import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260814162500_tenant_rls_lifecycle_hardening.sql',
  'utf8',
)

describe('tenant lifecycle RLS hardening', () => {
  it('keeps paused tenants read-only and hides stopped tenants from normal members', () => {
    expect(migration).toContain("company.status in ('active', 'onboarding', 'paused')")
    expect(migration).toContain('public.gridex_company_status_is_writable(p_company_id)')
    expect(migration).toContain('public.gridex_is_current_session_allowed()')
  })

  it('adds restrictive lifecycle guards instead of widening existing permissive policies', () => {
    expect(migration).toContain('as restrictive for select to authenticated')
    expect(migration).toContain('as restrictive for insert to authenticated')
    expect(migration).toContain('as restrictive for update to authenticated')
    expect(migration).toContain('as restrictive for delete to authenticated')
    expect(migration).toContain('tenant_lifecycle_anon_deny_guard')
    expect(migration).toContain('as restrictive for all to anon using (false) with check (false)')
  })

  it('forces lifecycle and access writes through canonical server commands', () => {
    for (const table of ['companies', 'company_memberships', 'user_roles', 'company_invitations']) {
      expect(migration).toContain(`revoke insert, update, delete on public.${table} from anon, authenticated`)
    }
  })

  it('does not expose public security-definer helpers to anon', () => {
    expect(migration).toContain('revoke all on function public.gridex_can_read_company(uuid) from public, anon')
    expect(migration).toContain('revoke all on function public.gridex_can_write_company(uuid) from public, anon')
    expect(migration).toContain('revoke all on function public.gridex_user_can_manage_company(uuid) from public, anon')
    expect(migration).toContain('grant execute on function public.gridex_can_read_company(uuid) to authenticated, service_role')
  })

  it('fails the migration if a company-scoped table escapes RLS or lifecycle guards', () => {
    expect(migration).toContain("raise exception 'tenant_rls_missing:%'")
    expect(migration).toContain("raise exception 'tenant_lifecycle_rls_guard_missing:%'")
    expect(migration).toContain("raise exception 'companies_authenticated_direct_write_still_granted'")
    expect(migration).toContain("raise exception 'tenant_security_definer_helper_exposed_to_anon'")
  })
})
