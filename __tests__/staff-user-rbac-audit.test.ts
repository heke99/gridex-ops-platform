import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

type Sources = { actions: string; commands: string; roles: string; sql: string }
const require = createRequire(import.meta.url)
const { readSourceFamily } = require('../scripts/lib/read-source-family.cjs') as {
  readSourceFamily: (root: string, path: string) => string
}
const { auditStaffUserCommandBoundary } = require('../scripts/lib/staff-user-rbac-audit.cjs') as {
  auditStaffUserCommandBoundary: (sources: Sources) => string[]
}
const source = (path: string) => readSourceFamily(process.cwd(), path)
const sources: Sources = {
  actions: source('app/admin/companies/actions.ts'),
  commands: source('lib/tenant/staffCommands.ts'),
  roles: source('lib/tenant/companyUserRoles.ts'),
  sql: source('supabase/migrations/20261004083640_staff_user_commands.sql'),
}

describe('staff user RBAC static boundary audit', () => {
  it('runs the complete audit against the shared-command implementation', () => {
    expect(auditStaffUserCommandBoundary(sources)).toEqual([])
    expect(execFileSync(process.execPath, ['scripts/security-audit-rbac.mjs'], { encoding: 'utf8' })).toContain('RBAC audit passed:')
  })

  it.each(['inviteStaff', 'changeStaffRole', 'disableStaff', 'reactivateStaff'])('rejects disconnecting the %s OPS adapter', name => {
    const needle = `await ${name}(staffOpsContext(companyId, context),`
    expect(sources.actions).toContain(needle)
    expect(auditStaffUserCommandBoundary({ ...sources, actions: sources.actions.replace(needle, `await bypass${name}(`) }))
      .toContain(`Staff command boundary saknar: OPS invokes ${name} with explicit staffOpsContext`)
  })

  const mutations: Array<[keyof Sources, string, string]> = [
    ['roles', 'const roleKey = parseCompanyAssignableRoleKey(value)', 'canonical company role resolver invokes the known-role parser'],
    ['roles', 'if (!COMPANY_ASSIGNABLE_ROLE_KEYS.has(normalized))', 'known-role parser rejects roles outside the company allowlist'],
    ['commands', 'role = resolveCanonicalCompanyAccessRole(requestedRoleKey)', 'shared role validation invokes the canonical company resolver'],
    ['commands', 'getRoleProfilePermissions(roleKey).every(permission => current.has(permission))', 'shared role ceiling compares every profile permission with actor permissions'],
    ['commands', 'if (!roleWithinCeiling(context, role.roleKey))', 'shared role validation rejects the permission ceiling violation'],
    ['commands', 'const role = requireAssignableRole(context, input.roleKey)', 'invitation invokes shared role validation'],
    ['commands', "input.operation === 'change_role' ? requireAssignableRole(context, input.roleKey ?? '')", 'role mutation invokes shared role validation'],
    ['sql', "v_permissions := public.gridex_staff_actor_permissions_v1(v_company_id,v_actor_user_id,v_channel='ops')", 'native guard resolves current company and actor permissions'],
    ['sql', 'IF NOT (public.gridex_staff_role_profile_v1(v_role_key)<@v_permissions)', 'native guard rejects role permissions exceeding current actor permissions'],
    ['sql', 'PERFORM public.gridex_assert_staff_command_v1(v_command);', 'native access mutation invokes the command guard'],
    ['sql', 'PERFORM public.gridex_assert_staff_command_v1(p_command);', 'native invitation invokes the command guard'],
    ['sql', 'PERFORM public.gridex_assert_staff_command_v1(p_command,true);', 'native access replay rechecks the command guard'],
  ]
  it.each(mutations)('rejects removing %s protection: %s', (key, needle, label) => {
    expect(sources[key]).toContain(needle)
    expect(auditStaffUserCommandBoundary({ ...sources, [key]: sources[key].replace(needle, '') }))
      .toContain(`Staff command boundary saknar: ${label}`)
  })

  it.each([
    ['export async function inviteStaff', 'invitation requires users.write'],
    ['async function changeAccess', 'access mutation requires users.write'],
  ])('rejects dropping users.write in %s', (marker, label) => {
    const index = sources.commands.indexOf(marker)
    expect(index).toBeGreaterThan(0)
    const commands = sources.commands.slice(0, index) + sources.commands.slice(index).replace("requirePermission(context, 'users.write')", '')
    expect(auditStaffUserCommandBoundary({ ...sources, commands })).toContain(`Staff command boundary saknar: ${label}`)
  })

  it('still rejects removing the invitation replay guard after retaining the access replay guard', () => {
    const needle = 'PERFORM public.gridex_assert_staff_command_v1(p_command,true);'
    const index = sources.sql.lastIndexOf(needle)
    expect(index).toBeGreaterThan(sources.sql.indexOf(needle))
    const sql = sources.sql.slice(0, index) + sources.sql.slice(index + needle.length)
    expect(auditStaffUserCommandBoundary({ ...sources, sql })).toContain('Staff command boundary saknar: native invitation replay rechecks the command guard')
  })
})
