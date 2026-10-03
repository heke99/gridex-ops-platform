import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {} }))

import { evaluateCompanyRoleChange } from '@/lib/tenant/roleChangeGuard'

const base = {
  actorUserId: 'actor',
  actorIsPlatformAdmin: false,
  targetUserId: 'target',
  currentMembershipRole: 'operations',
  nextMembershipRole: 'support',
  otherActiveAdminCount: 1,
}

describe('evaluateCompanyRoleChange', () => {
  it('blocks tenant users from changing their own role', () => {
    expect(evaluateCompanyRoleChange({ ...base, targetUserId: 'actor', nextMembershipRole: 'company_admin' })).toMatch(/egen roll/)
  })
  it('lets platform admins change any role', () => {
    expect(evaluateCompanyRoleChange({ ...base, actorIsPlatformAdmin: true, targetUserId: 'actor' })).toBeNull()
  })
  it('blocks demoting the last active administrator, even for platform admins', () => {
    const lastAdmin = { ...base, currentMembershipRole: 'company_admin', otherActiveAdminCount: 0 }
    expect(evaluateCompanyRoleChange(lastAdmin)).toMatch(/minst en aktiv administratör/)
    expect(evaluateCompanyRoleChange({ ...lastAdmin, actorIsPlatformAdmin: true })).toMatch(/minst en aktiv administratör/)
  })
  it('allows demoting an admin when another admin remains, and admin-to-admin changes', () => {
    expect(evaluateCompanyRoleChange({ ...base, currentMembershipRole: 'admin', otherActiveAdminCount: 1 })).toBeNull()
    expect(evaluateCompanyRoleChange({ ...base, currentMembershipRole: 'admin', nextMembershipRole: 'company_admin', otherActiveAdminCount: 0 })).toBeNull()
  })
})
