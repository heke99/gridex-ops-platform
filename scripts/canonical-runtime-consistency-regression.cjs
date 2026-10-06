/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const failures = []
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const assert = (condition, message) => { if (!condition) failures.push(message) }

const migrationName = '20260802203000_canonical_runtime_consistency_hardening.sql'
const migration = read(`supabase/migrations/${migrationName}`)

for (const required of [
  'canonical_tenant_access_role_mapping',
  'canonical_manage_platform_user_access',
  'canonical_accept_tenant_invitation',
  'canonical_platform_access_command_results',
  'canonical_platform_access_audit_events',
  'IDEMPOTENCY_KEY_REUSE_MISMATCH',
  'company_id is null',
  'delivery_uncertain',
  'operation_decision_snapshot',
  'environment_type public.ediel_environment_type',
  'active_canonical_test_configuration_missing',
  'canonical_project_actor_test_result_state',
  'canonical_guard_ediel_test_run_authoritative_status',
  'canonical_guard_actor_test_result_authoritative_status',
  'direct_test_run_pass_forbidden_without_canonical_attempt',
  'canonical_block_claimed_ediel_outbox_item',
]) assert(migration.toLowerCase().includes(required.toLowerCase()), `Migration is missing ${required}`)

assert(migration.includes('drop constraint if exists user_roles_user_id_role_id_key'), 'Global user-role uniqueness still blocks the same role across tenants')
assert(migration.includes('user_roles_global_user_role_uidx'), 'Global platform-role uniqueness replacement is missing')
assert(migration.includes('user_roles_company_user_role_active_uidx'), 'Tenant-qualified active role uniqueness is missing')
assert(
  /declare[\s\S]*v_active_user_role_id\s+uuid;[\s\S]*v_existing_mapped_role_id\s+uuid;[\s\S]*select ur\.id into v_active_user_role_id/i.test(migration),
  'Canonical tenant access wrapper uses undeclared role-row variables',
)

assert(
  migration.includes("'queued','sending','sent','failed','delivery_uncertain','blocked_tenant_state'"),
  'Manual email blocked_tenant_state is not allowed by the database constraint',
)
assert(
  /create unique index ediel_active_test_configurations_active_key[\s\S]*environment_type/i.test(migration),
  'Active test configuration identity does not include environment_type',
)
assert(
  /ediel_test_runs_status_check[\s\S]*'completed'[\s\S]*'passed'/i.test(migration),
  'Internal self-test completed status is not supported by the database constraint',
)
assert(
  /revoke all on function public\.canonical_manage_platform_user_access\(jsonb\)[\s\S]*from public, anon, authenticated/i.test(migration),
  'Canonical platform access RPC is exposed to Data API roles',
)

const platformHelper = read('lib/admin/platformUserAccess.ts')
assert(platformHelper.includes("rpc(\n    'canonical_manage_platform_user_access'"), 'Platform access helper does not use the canonical RPC')

for (const relative of ['app/admin/users/actions.ts', 'app/admin/users/[id]/actions.ts']) {
  const source = read(relative)
  assert(source.includes('runCanonicalPlatformAccessCommand'), `${relative} does not use canonical platform access`)
  assert(!/\.from\(['"]user_roles['"]\)[\s\S]{0,220}\.(?:insert|update|delete|upsert)\(/.test(source), `${relative} still mutates platform roles directly`)
  assert(!/\.from\(['"]user_permission_overrides['"]\)[\s\S]{0,220}\.(?:insert|update|delete|upsert)\(/.test(source), `${relative} still mutates platform permission overrides directly`)
}

const inviteForm = read('components/admin/companies/CompanyUserInviteForm.tsx')
assert(!inviteForm.includes('temporary_password'), 'Company invite form still collects a temporary password')
assert(!inviteForm.includes('membership_role'), 'Company invite form still allows independent membership-role selection')

const companyActions = read('app/admin/companies/actions.ts')
// Follow the actual OPS adapter into the shared canonical Staff command.
const ts = require('typescript')
const companyTree = ts.createSourceFile('company-actions.ts', companyActions, ts.ScriptTarget.Latest, true)
const staffSource = read('lib/tenant/staffCommands.ts')
const staffTree = ts.createSourceFile('staff-commands.ts', staffSource, ts.ScriptTarget.Latest, true)
const roleSource = read('lib/tenant/companyUserRoles.ts')
const roleTree = ts.createSourceFile('company-user-roles.ts', roleSource, ts.ScriptTarget.Latest, true)
const printer = ts.createPrinter({ removeComments: true })
const [companyFunctions, staffFunctions, roleFunctions] = [companyTree, staffTree, roleTree].map((tree) => new Map(
  tree.statements.filter(ts.isFunctionDeclaration).filter((node) => node.name && node.body)
    .map((node) => [node.name.text, printer.printNode(ts.EmitHint.Unspecified, node.body, tree)]),
))
assert(/from ['"]@\/lib\/tenant\/staffCommands['"]/.test(companyActions), 'Company actions do not import the shared Staff commands')
const companyGuard = companyFunctions.get('assertCanManageCompanyUsers') ?? ''
assert(/requireAdminActionAccess\(\{\s*allOf:\s*\[['"]users\.write['"]\]/.test(companyGuard), 'Company staff actions do not require server-side users.write')
assert(/listOperationalCompaniesForUser\(context\.userId\)/.test(companyGuard) && /row\.companyId === companyId/.test(companyGuard) && /!membership/.test(companyGuard), 'Company staff authorization does not bind the current actor to the requested company')
const opsContext = companyFunctions.get('staffOpsContext') ?? ''
assert(/return\s*\{\s*companyId,\s*actorUserId:\s*context\.userId,\s*permissions:\s*context\.permissions,\s*channel:\s*['"]ops['"]/.test(opsContext), 'Company Staff context does not preserve verified company, actor and permissions')
for (const [action, command] of [
  ['inviteCompanyUserAction', 'inviteStaff'],
  ['setCompanyUserRoleAction', 'changeStaffRole'],
  ['removeUserFromCompanyAction', 'disableStaff'],
  ['reactivateCompanyUserAction', 'reactivateStaff'],
]) {
  const body = companyFunctions.get(action) ?? ''
  assert(/const companyId = normalizeText\(formData\.get\(['"]company_id['"]\)\)/.test(body), `${action} does not use the requested company scope`)
  assert(new RegExp(`const context = await assertCanManageCompanyUsers\\(companyId\\)[\\s\\S]*await ${command}\\(staffOpsContext\\(companyId, context\\),`).test(body), `${action} does not delegate with the authorized company and server actor`)
}
assert(/resolveCanonicalCompanyAccessRole[\s\S]*from ['"]@\/lib\/tenant\/companyUserRoles['"]/.test(staffSource), 'Staff commands do not import the canonical company-role mapper')
const assignableRole = staffFunctions.get('requireAssignableRole') ?? ''
assert(/role = resolveCanonicalCompanyAccessRole\(requestedRoleKey\)/.test(assignableRole) && /!roleWithinCeiling\(context, role\.roleKey\)/.test(assignableRole) && /return role/.test(assignableRole), 'Staff commands do not derive an assignable canonical role within the actor ceiling')
const roleMapping = roleFunctions.get('resolveCanonicalCompanyAccessRole') ?? ''
assert(/const roleKey = parseCompanyAssignableRoleKey\(value\)/.test(roleMapping) && /candidate\.value === roleKey/.test(roleMapping) && /return\s*\{\s*roleKey,\s*membershipRole:\s*option\.recommendedMembershipRole\s*\}/.test(roleMapping), 'Canonical company roles do not derive membership from the selected system-role option')
const invite = staffFunctions.get('inviteStaff') ?? ''
assert(/requirePermission\(context, ['"]users\.write['"]\)/.test(invite) && /const role = requireAssignableRole\(context, input\.roleKey\)/.test(invite), 'Staff invitation does not validate the requested canonical role')
const invitationDeclaration = staffTree.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'inviteStaff')
  ?.body?.statements.find(ts.isTryStatement)?.tryBlock.statements.filter(ts.isVariableStatement)
  .flatMap((node) => [...node.declarationList.declarations]).find((node) => node.name.getText(staffTree) === 'invitation')
const invitationCall = invitationDeclaration?.initializer && ts.isAwaitExpression(invitationDeclaration.initializer) && ts.isCallExpression(invitationDeclaration.initializer.expression)
  ? invitationDeclaration.initializer.expression : null
const invitationInput = invitationCall?.expression.getText(staffTree) === 'provisionCompanyInvitation' && invitationCall.arguments.length === 1 && ts.isObjectLiteralExpression(invitationCall.arguments[0])
  ? printer.printNode(ts.EmitHint.Unspecified, invitationCall.arguments[0], staffTree) : ''
assert(/companyId:\s*context\.companyId/.test(invitationInput) && /membershipRole:\s*role\.membershipRole,\s*roleKey:\s*role\.roleKey/.test(invitationInput) && /actorUserId:\s*context\.actorUserId/.test(invitationInput), 'Staff invitation does not preserve company, server actor and the mapped role pair')
const change = staffFunctions.get('changeAccess') ?? ''
assert(/requirePermission\(context, ['"]users\.write['"]\)/.test(change) && /requireAssignableRole\(context, input\.roleKey/.test(change), 'Staff access changes do not validate the canonical role')
assert(/rpc\(['"]canonical_change_tenant_user_access['"],\s*\{\s*p_command:\s*\{\s*company_id:\s*context\.companyId,\s*actor_user_id:\s*context\.actorUserId,\s*user_id:\s*userId/.test(change), 'Staff access changes do not bind the canonical RPC to the authorized company and server actor')
assert(/role_key:\s*role\.roleKey,\s*membership_role:\s*role\.membershipRole/.test(change), 'Staff access changes do not emit the canonical mapped role pair')
for (const [command, operation] of [['changeStaffRole', 'change_role'], ['disableStaff', 'disable'], ['reactivateStaff', 'enable']]) {
  const body = staffFunctions.get(command) ?? ''
  assert(new RegExp(`return changeAccess\\(context, \\{ \\.\\.\\.input, operation: ['"]${operation}['"] \\}\\)`).test(body), `${command} does not use the shared guarded access command`)
}
assert(!companyActions.includes("formData.get('membership_role')"), 'Company actions still trust client-selected membership_role')


const companyAccess = read('lib/auth/companyUserAccess.ts')
assert(companyAccess.includes("rpc('canonical_change_tenant_user_access'"), 'Central company access helper does not use canonical_change_tenant_user_access')
assert(companyAccess.includes("rpc('canonical_accept_tenant_invitation'"), 'Invitation acceptance does not use a dedicated canonical RPC')
assert(!/\.from\(['"](?:company_memberships|user_roles)['"]\)[\s\S]{0,220}\.(?:insert|update|upsert|delete)\(/.test(companyAccess), 'Central company access helper still mutates membership or role tables directly')

const invitationFlow = read('lib/auth/companyInvitationFlow.ts')
assert(invitationFlow.includes('acceptCompanyInvitationAccess'), 'Verified invitation flow does not delegate access creation to the canonical helper')
assert(!/\.from\(['"](?:company_memberships|user_roles)['"]\)[\s\S]{0,220}\.(?:insert|update|upsert|delete)\(/.test(invitationFlow), 'Invitation flow still compensates membership/roles with direct writes')

const actorEngine = read('lib/ediel/actorTestingEngine.ts')
const companyResolver = /async function findCompanyForMessage[\s\S]*?\n}/.exec(actorEngine)?.[0] ?? ''
assert(companyResolver.includes('message.company_id'), 'Actor testing does not require the message company_id')
assert(!companyResolver.includes("order('updated_at'"), 'Actor testing still chooses the latest matching tenant')
assert(!companyResolver.includes('test_ediel_id'), 'Actor testing still guesses tenant from Ediel identifiers')

assert(!/\.from\(['"]actor_test_results['"]\)[\s\S]{0,220}\.(?:insert|update|upsert|delete)\(/.test(actorEngine), 'Actor testing engine still writes the legacy actor_test_results table directly')
assert(actorEngine.includes('projectCanonicalActorTestState'), 'Actor testing engine does not use the canonical non-authoritative projection command')

const actorTestingActions = read('app/admin/platform/actor-testing/actions.ts')
assert(!/\.from\(['"]actor_test_results['"]\)[\s\S]{0,220}\.(?:insert|update|upsert|delete)\(/.test(actorTestingActions), 'Actor-testing admin actions still write actor_test_results directly')
assert(actorTestingActions.includes('projectCanonicalActorTestState'), 'Actor-testing admin actions do not use canonical projection')

const selfTest = read('lib/ediel/testing/selftest.ts')
assert(!/setTestRunStatus\([\s\S]{0,160}status:\s*['"]passed['"]/.test(selfTest), 'Internal self-test still creates authoritative passed status without canonical evidence')
assert(selfTest.includes("status: 'completed'"), 'Internal self-test does not use non-authoritative completed status')

for (const relative of ['lib/ediel/testing/agtRuntime.ts', 'lib/customer-operations/z01Finalizer.ts']) {
  const source = read(relative)
  assert(!source.includes(".or(`company_id.is.null,company_id.eq."), `${relative} still mixes global and tenant routes in one latest-row lookup`)
  assert(!/\.order\(['"]updated_at['"][\s\S]{0,80}\.limit\(1\)/.test(source), `${relative} still resolves route by updated_at LIMIT 1`)
}

for (const relative of [
  'lib/ediel/testing/testRunTransportMetadata.ts',
  'lib/ediel/config.ts',
  'lib/ediel/systemTestSettings.ts',
  'app/admin/companies/[id]/ediel-actions.ts',
  'app/admin/platform/go-live/[companyId]/route-wizard/actions.ts',
  'app/admin/ediel/agt/actions.ts',
]) {
  const source = read(relative)
  assert(!/\.order\(['"]updated_at['"][\s\S]{0,80}\.limit\(1\)/.test(source), `${relative} still selects a canonical Ediel route/profile with updated_at LIMIT 1`)
}

const edielClaim = read('lib/ediel/outbox/claimOutboxItems.ts')
assert(edielClaim.includes('canonical_block_claimed_ediel_outbox_item'), 'Claimed Ediel rows are not blocked through the canonical RPC')
assert(!edielClaim.includes("from('ediel_outbox').update"), 'Ediel claim module still updates queue state directly')

const edielOutbox = read('lib/ediel/outbox/sendOutboxItem.ts')
assert(edielOutbox.includes("status: 'delivery_uncertain'"), 'Ediel outbox lacks uncertain-delivery handling')
assert(edielOutbox.includes("['provider_accepted', 'sent', 'delivered', 'acknowledged']"), 'Ediel outbox does not suppress resends of technically sent messages')
assert(edielOutbox.includes("last_error: 'outbox_item_missing_message'"), 'Missing Ediel message does not transition the row to a terminal blocked state')
assert(edielOutbox.includes('const transportDecision = await getTenantOperationDecision'), 'Ediel outbox does not recheck tenant state before SMTP')
assert(edielOutbox.indexOf('const transportDecision = await getTenantOperationDecision') < edielOutbox.indexOf('await sendEdielMessageViaSmtp'), 'Ediel pretransport tenant check occurs after SMTP')

const manualEmail = read('lib/email/manualEmailOutbox.ts')
assert((manualEmail.match(/getTenantOperationDecision/g) ?? []).length >= 2, 'Manual email is not guarded at claim and pretransport')
assert(manualEmail.includes("status: 'delivery_uncertain'"), 'Manual email lacks uncertain-delivery handling')
assert(manualEmail.includes('deliveryPersisted = true'), 'Manual email cannot distinguish provider acceptance from local terminal persistence')
assert(manualEmail.includes("status: 'blocked_tenant_state'"), 'Manual email does not preserve tenant-blocked rows')
assert(!manualEmail.includes('assertOutboundAllowed'), 'Manual email still uses the legacy outbound guard')

const webhooks = read('lib/integrations/webhooks.ts')
assert((webhooks.match(/getTenantOperationDecision/g) ?? []).length >= 3, 'Webhook delivery is not guarded at claim and pretransport')
assert(webhooks.includes('providerAcceptedWebhook'), 'Webhook handling cannot distinguish accepted and rejected provider responses')
assert(webhooks.includes('markDeliveryUncertain'), 'Webhook delivery lacks uncertain-delivery persistence')
assert(webhooks.includes("'x-gridex-delivery-id'"), 'Webhook delivery has no deterministic public delivery ID header')
assert(webhooks.includes('request_body_hash'), 'Webhook delivery does not persist the request-body fingerprint')

const orchestrator = read('lib/ediel/orchestrator.ts')
assert(!orchestrator.includes('// Bridge is best-effort'), 'Direct Ediel send still silently treats outbox reconciliation as best effort')
assert(orchestrator.includes('direct-send outbox reconciliation failed'), 'Direct Ediel send does not surface bridge reconciliation failure')

const manifest = JSON.parse(read('scripts/migration-history-manifest.json'))
assert(Boolean(manifest.files?.[migrationName]), 'New migration is missing from migration-history-manifest.json')

const packageJson = JSON.parse(read('package.json'))
assert(
  packageJson.scripts?.['ops:canonical-runtime-consistency'] === 'node scripts/canonical-runtime-consistency-regression.cjs',
  'Package command ops:canonical-runtime-consistency is missing',
)

if (failures.length) {
  console.error(`Canonical runtime consistency regression failed (${failures.length})`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Canonical runtime consistency regression passed (access atomicity, tenant resolution, route priority and delivery uncertainty).')
