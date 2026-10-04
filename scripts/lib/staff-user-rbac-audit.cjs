'use strict'

// Static audit of the actual OPS -> shared command -> native guard path.
// Native transaction/permission behavior remains covered by its own regressions.
function auditStaffUserCommandBoundary({ actions, commands, roles, sql }) {
  const invite = commands.slice(commands.indexOf('export async function inviteStaff'), commands.indexOf('async function changeAccess'))
  const change = commands.slice(commands.indexOf('async function changeAccess'), commands.indexOf('export async function changeStaffRole'))
  const guard = sql.match(/\$guard\$([\s\S]*?)\$guard\$/)?.[1] ?? ''
  const access = sql.match(/\$access\$([\s\S]*?)\$access\$/)?.[1] ?? ''
  const invitation = sql.match(/\$invitation\$([\s\S]*?)\$invitation\$/)?.[1] ?? ''
  const checks = [
    ...['inviteStaff', 'changeStaffRole', 'disableStaff', 'reactivateStaff'].map(name => [
      actions, `OPS invokes ${name} with explicit staffOpsContext`,
      new RegExp(`await\\s+${name}\\(\\s*staffOpsContext\\(companyId,\\s*context\\),`),
    ]),
    [roles, 'canonical company role resolver invokes the known-role parser', /const roleKey = parseCompanyAssignableRoleKey\(value\)/],
    [roles, 'known-role parser rejects roles outside the company allowlist', /if\s*\(!COMPANY_ASSIGNABLE_ROLE_KEYS\.has\(normalized\)\)\s*\{\s*throw new Error/],
    [commands, 'shared role validation invokes the canonical company resolver', /role = resolveCanonicalCompanyAccessRole\(requestedRoleKey\)/],
    [commands, 'shared role ceiling compares every profile permission with actor permissions', /getRoleProfilePermissions\(roleKey\)\.every\(permission => current\.has\(permission\)\)/],
    [commands, 'shared role validation rejects the permission ceiling violation', /if\s*\(!roleWithinCeiling\(context, role\.roleKey\)\)\s*\{\s*throw new StaffCommandError\('staff_role_ceiling_exceeded', 403/],
    [invite, 'invitation requires users.write', /requirePermission\(context, 'users\.write'\)/],
    [invite, 'invitation invokes shared role validation', /const role = requireAssignableRole\(context, input\.roleKey\)/],
    [change, 'access mutation requires users.write', /requirePermission\(context, 'users\.write'\)/],
    [change, 'role mutation invokes shared role validation', /input\.operation === 'change_role' \? requireAssignableRole\(context, input\.roleKey \?\? ''\)/],
    [guard, 'native guard resolves current company and actor permissions', /v_permissions\s*:=\s*public\.gridex_staff_actor_permissions_v1\(v_company_id,\s*v_actor_user_id,\s*v_channel\s*=\s*'ops'\)/i],
    [guard, 'native guard rejects role permissions exceeding current actor permissions', /IF\s+NOT\s*\(public\.gridex_staff_role_profile_v1\(v_role_key\)\s*<@\s*v_permissions\)\s+THEN\s+RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='staff_role_ceiling_exceeded'/i],
    [access, 'native access mutation invokes the command guard', /PERFORM public\.gridex_assert_staff_command_v1\(v_command\);/i],
    [access, 'native access replay rechecks the command guard', /PERFORM public\.gridex_assert_staff_command_v1\(p_command,true\);/i],
    [invitation, 'native invitation invokes the command guard', /PERFORM public\.gridex_assert_staff_command_v1\(p_command\);/i],
    [invitation, 'native invitation replay rechecks the command guard', /PERFORM public\.gridex_assert_staff_command_v1\(p_command,true\);/i],
  ]
  return checks.filter(([source, , pattern]) => !pattern.test(source)).map(([, label]) => `Staff command boundary saknar: ${label}`)
}

module.exports = { auditStaffUserCommandBoundary }
