const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const failures = []
const check = (condition, message) => { if (!condition) failures.push(message) }

const invitations = read('lib/auth/companyInvitationFlow.ts')
const provisionBody = invitations.slice(
  invitations.indexOf('export async function provisionCompanyInvitation'),
  invitations.indexOf('export async function getCompanyInvitationByToken'),
)
const emailFlow = read('lib/auth/authEmailFlow.ts')
const companies = read('app/admin/companies/actions.ts')
const guards = read('lib/admin/guards.ts')
const provisioning = read('lib/tenant/provisioningWorker.ts')
const cron = read('app/api/internal/tenant-provisioning/cron/route.ts')
const migration = read('supabase/migrations/20260810213851_canonical_architecture_completion_v2.sql')
const invitationHotfix = read('supabase/migrations/20260810221500_canonical_invitation_delivery_hotfix.sql')

check(provisionBody.includes("rpc('canonical_create_tenant_invitation'"), 'invitation intent is not created through canonical_create_tenant_invitation')
check(!provisionBody.includes('deliverCompanyInvitationIntent({'), 'request path still competes with the leased worker for provider delivery')
check(!invitations.includes(".from('company_invitations')\n      .insert"), 'application still inserts invitations directly')
check(!emailFlow.includes('acceptPendingCompanyInvitationsForUser'), 'auth callback still contains the competing invitation acceptance path')
check(!emailFlow.includes("accepted_via: 'auth_email_action'"), 'auth callback still writes invitation acceptance')
check(companies.includes("rpc('canonical_transition_tenant_lifecycle'"), 'company lifecycle does not use the canonical transition RPC')
check(!companies.includes("'gridex_transition_tenant_lifecycle'"), 'company lifecycle still calls the revoked legacy RPC')
check(guards.includes("rpc(\n    'canonical_authenticated_tenant_context'"), 'admin guard does not use the canonical request-scoped access context')
check(!guards.includes("'gridex_get_user_roles'"), 'admin guard still performs the legacy split role read')
check(provisioning.includes('canonical_claim_company_provisioning_jobs'), 'provisioning worker does not use the canonical lease claim')
check(provisioning.includes('canonical_complete_company_provisioning_job'), 'provisioning worker does not use canonical completion')
check(provisioning.includes('deliverCompanyInvitationIntent({'), 'leased provisioning worker is not the sole invitation delivery owner')
check(cron.includes('processCompanyProvisioningJobs'), 'provisioning cron route is missing')
for (const token of [
  'repair_status',
  'repair_owner_user_id',
  'repair_reason_code',
  'repair_sla_due_at',
  'canonical_run_architecture_reconciliation',
  'platform_release_receipts',
  'check_error',
]) check(migration.includes(token), `completion migration is missing ${token}`)
check(invitationHotfix.includes('extensions, pg_temp'), 'invitation token hashing does not resolve the Supabase extensions schema')

if (failures.length) {
  console.error(`Gridex canonical architecture regression failed (${failures.length})`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('Gridex canonical architecture regression passed')
