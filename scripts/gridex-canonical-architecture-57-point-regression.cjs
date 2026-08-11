const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
const controls = []
const control = (id, condition, message) => controls.push({ id, passed: Boolean(condition), message })

const invitations = read('lib/auth/companyInvitationFlow.ts')
const provisionBody = invitations.slice(
  invitations.indexOf('export async function provisionCompanyInvitation'),
  invitations.indexOf('export async function getCompanyInvitationByToken'),
)
const emailFlow = read('lib/auth/authEmailFlow.ts')
const companies = read('app/admin/companies/actions.ts')
const guards = read('lib/admin/guards.ts')
const applications = read('app/admin/website-applications/actions.ts')
const provisioning = read('lib/tenant/provisioningWorker.ts')
const provisioningCron = read('app/api/internal/tenant-provisioning/cron/route.ts')
const reconciliationCron = read('app/api/cron/reconciliation/daily/route.ts')
const vercel = read('vercel.json')
const completion = read('supabase/migrations/20260810213851_canonical_architecture_completion_v2.sql')
const indexes = read('supabase/migrations/20260810214927_canonical_architecture_completion_fk_indexes.sql')
const inviteHotfix = read('supabase/migrations/20260810221500_canonical_invitation_delivery_hotfix.sql')
const review = read('supabase/migrations/20260810224500_canonical_review_remediation_v1.sql')
const migrationManifest = JSON.parse(read('scripts/migration-history-manifest.json'))
const typesManifest = JSON.parse(read('scripts/supabase-types-manifest.json'))
const databaseTypes = read('supabase/database.types.ts')

control('C01', provisionBody.includes("rpc('canonical_create_tenant_invitation'"), 'durable invitation intent does not use the canonical RPC')
control('C02', !provisionBody.includes('deliverCompanyInvitationIntent({'), 'request path still performs provider delivery')
control('C03', !invitations.includes(".from('company_invitations')\n      .insert"), 'application inserts invitation intents directly')
control('C04', provisioning.includes('deliverCompanyInvitationIntent({'), 'leased worker is not the sole invitation delivery owner')
control('C05', provisioning.includes('canonical_claim_company_provisioning_jobs'), 'worker does not claim a lease')
control('C06', provisioning.includes('canonical_complete_company_provisioning_job'), 'worker does not complete through the canonical RPC')
control('C07', provisioning.includes("errorCode: 'invitation_intent_lookup_failed'"), 'lookup errors do not release the claimed job')
control('C08', !emailFlow.includes('acceptPendingCompanyInvitationsForUser'), 'auth callback still accepts invitations competitively')
control('C09', companies.includes("rpc('canonical_transition_tenant_lifecycle'"), 'tenant lifecycle does not use the canonical transition')
control('C10', !companies.includes("'gridex_transition_tenant_lifecycle'"), 'application still calls the revoked lifecycle RPC')
control('C11', companies.includes('p_expected_state_version: expectedStateVersion'), 'lifecycle transition is not bound to the observed version')
control('C12', companies.includes('tenant-lifecycle:${input.companyId}:${input.status}:v${expectedStateVersion}'), 'lifecycle idempotency key is not deterministic')
control('C13', guards.includes("'canonical_authenticated_tenant_context'"), 'admin guard does not use canonical request-scoped context')
control('C14', !guards.includes("'gridex_get_user_roles'"), 'admin guard performs a legacy split role read')
control('C15', applications.includes('const platformAdmin = await requirePlatformAdminActionAccess()'), 'application repair does not require platform admin')
control('C16', reconciliationCron.includes('mapWithConcurrency(companyIds, 4'), 'reconciliation is not tenant-batched with bounded concurrency')
control('C17', !reconciliationCron.includes('p_company_id: companyId'), 'cron can still invoke unscoped reconciliation')
control('C18', reconciliationCron.includes('authorizeScheduledRequest'), 'reconciliation cron is not authenticated')
control('C19', provisioningCron.includes('processCompanyProvisioningJobs'), 'provisioning cron route is missing')
control('C20', vercel.includes('/api/internal/tenant-provisioning/cron'), 'provisioning worker is not scheduled')
control('C21', ['repair_status','repair_owner_user_id','repair_reason_code','repair_sla_due_at'].every((token) => completion.includes(token)), 'application repair contract is incomplete')
control('C22', ['review_owner','review_owner_user_id','review_reason_code','review_sla_due_at','review_environment'].every((token) => completion.includes(token)), 'manual-review ownership contract is incomplete')
control('C23', completion.includes('canonical_run_architecture_reconciliation'), 'canonical reconciliation function is missing')
control('C24', completion.includes('platform_release_receipts'), 'release receipt contract is missing')
control('C25', completion.includes('platform_performance_budgets'), 'performance budget contract is missing')
control('C26', completion.includes('check_error'), 'fail-closed reconciliation evidence is missing')
control('C27', completion.includes('canonical_queue_customer_application_repair'), 'canonical application repair RPC is missing')
control('C28', indexes.includes('customer_operation_jobs_review_owner_user_idx') && indexes.includes('platform_release_receipts_deployed_by_idx'), 'review/release foreign-key indexes are missing')
control('C29', inviteHotfix.includes('extensions, pg_temp'), 'invitation token hashing cannot resolve pgcrypto')
control('C30', review.includes('private.authenticate_integration_request_v1_secret_internal'), 'credential comparison core is not private')
control('C31', !review.includes('readiness.secret_hash') && !review.includes('checked.secret_hash'), 'public authentication wrappers still select secret_hash')
control('C32', review.includes('select distinct role.key as role_key'), 'unscoped context does not aggregate roles')
control('C33', review.includes('select distinct permission.key as permission_key'), 'unscoped context does not aggregate permissions')
control('C34', review.includes("command_type='tenant.lifecycle.transition'"), 'lifecycle replay does not return cached command results first')
control('C35', review.includes("if v_current_status=p_target_status then"), 'lifecycle no-op transitions can still run side effects')
control('C36', review.includes('TENANT_LIFECYCLE_SIDE_EFFECTS_APPLIED'), 'lifecycle side effects lack a canonical audit receipt')
control('C37', review.includes("has_table_privilege(v_owner,'auth.sessions','DELETE')"), 'auth session deletion privilege is not verified')
control('C38', review.includes('v_previous_dead_letter_at') && review.includes('dead_letter_at=v_previous_dead_letter_at'), 'dead-letter history is not preserved')
control('C39', review.includes('canonical_enqueue_invitation_delivery_job'), 'initial-admin invitation intents are not guaranteed a worker job')
control('C40', review.includes("message='reconciliation_company_scope_required'"), 'unbounded reconciliation scope is still allowed')
control('C41', ['membership_without_role','active_client_not_ready','due_stranded_outbox','provisioning_dead_letter','manual_review_over_sla','application_without_repair'].every((token) => review.includes("jsonb_build_object('"+token+"'")), 'reconciliation result omits one or more checks')
control('C42', [
  'check-error:active-membership-missing-role',
  'check-error:active-api-client-not-launch-ready',
  'check-error:due-stranded-canonical-outbox',
  'check-error:provisioning-dead-letter',
  'check-error:manual-review-over-sla',
  'check-error:customer-application-without-repair-workflow',
].every((key) => review.split(key).length >= 3), 'recovered check-error findings are not cleared')
control('C43', review.includes('insert into public.customer_application_workflows'), 'repair RPC does not create the canonical workflow')
control('C44', review.includes('insert into public.customer_operation_jobs'), 'repair RPC does not create the continuation job')
control('C45', review.indexOf("'queued',true") > review.indexOf("if v_job_id is null then raise exception 'canonical_repair_job_not_created'"), 'repair reports queued before a job exists')

const pinnedMigrations = [
  ['C46','20260810185155_gridex_canonical_architecture_p0.sql'],
  ['C47','20260810190410_gridex_canonical_architecture_p0.sql'],
  ['C48','20260810190809_gridex_canonical_architecture_p0_security_hotfix.sql'],
  ['C49','20260810191822_canonical_lifecycle_offboarding_v1.sql'],
  ['C50','20260810193450_canonical_access_provisioning_runtime_v1.sql'],
  ['C51','20260810213851_canonical_architecture_completion_v2.sql'],
  ['C52','20260810214927_canonical_architecture_completion_fk_indexes.sql'],
  ['C53','20260810221500_canonical_invitation_delivery_hotfix.sql'],
  ['C54','20260810224500_canonical_review_remediation_v1.sql'],
]
for (const [id, name] of pinnedMigrations) {
  control(id, migrationManifest.files[name] === hash(`supabase/migrations/${name}`), `migration checksum drifted: ${name}`)
}
control('C55', typesManifest.sha256 === hash(typesManifest.generated_types), 'generated database types hash drifted')
control('C56', typesManifest.latest_migration === '20260811074000_gridex_remaining_gaps_review_fixes.sql', 'generated types are not pinned to the current migration tail')

function returnBlock(name) {
  const start = databaseTypes.indexOf(`      ${name}: {`)
  const returns = databaseTypes.indexOf('        Returns: {', start)
  const end = databaseTypes.indexOf('\n      }', returns)
  return start >= 0 && returns >= 0 && end > returns ? databaseTypes.slice(returns, end) : ''
}
const authReturnBlocks = [
  'authenticate_integration_request_v1',
  'authenticate_integration_request_v1_credential_core',
  'authenticate_provisioning_smoke_request_v1',
].map(returnBlock)
control('C57', authReturnBlocks.every((block) => block && !block.includes('secret_hash:')), 'an authentication RPC still returns secret_hash')

if (controls.length !== 57) {
  console.error(`Gridex canonical architecture regression definition error: expected 57 controls, got ${controls.length}`)
  process.exit(1)
}
const failures = controls.filter((item) => !item.passed)
if (failures.length) {
  console.error(`Gridex canonical architecture regression failed (${failures.length}/57)`)
  for (const failure of failures) console.error(`- ${failure.id}: ${failure.message}`)
  process.exit(1)
}
console.log('Gridex canonical architecture regression passed (57/57 controls)')
