/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const failures = []
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const exists = (relative) => fs.existsSync(path.join(root, relative))
const assert = (condition, message) => { if (!condition) failures.push(message) }

const actionAccess = read('lib/ediel/actionAccess.ts')
assert(actionAccess.includes("read: 'communication.read'"), 'Ediel read permission must be explicit')
for (const permission of [
  'ediel_testing.write',
  'ediel.send',
  'ediel_testing.attest',
  'ediel.production.activate',
  'ediel.production.pause',
  'ediel.profile.write',
]) assert(actionAccess.includes(permission), `Dedicated permission ${permission} is missing`)

const permissionServer = read('lib/auth/requirePermissionServer.ts')
assert(permissionServer.includes('export async function requireAllPermissionsServer'), 'requireAllPermissionsServer is missing')

const mutatingActionFiles = [
  'app/admin/ediel/actions.ts',
  'app/admin/ediel/agt/actions.ts',
  'app/admin/ediel/system-tests/actions.ts',
  'app/admin/ediel/portal-feedback/actions.ts',
  'app/admin/ediel/outbox/actions.ts',
  'app/admin/platform/actor-testing/actions.ts',
]
for (const relative of mutatingActionFiles) {
  const source = read(relative)
  assert(!/require(?:AnyPermissionServer|AdminActionAccess)\s*\(\s*\[[\s\S]{0,250}communication\.write[\s\S]{0,250}communication\.read/.test(source), `${relative} still offers read as an alternative to write`)
  assert(!/require(?:AnyPermissionServer|AdminActionAccess)\s*\(\s*\[[\s\S]{0,250}communication\.read[\s\S]{0,250}communication\.write/.test(source), `${relative} still offers read as an alternative to write`)
  assert(!/\.catch\(\(\)\s*=>\s*(?:null|undefined)\)/.test(source), `${relative} still swallows a critical write failure`)
}

const actorActions = read('app/admin/platform/actor-testing/actions.ts')
assert(actorActions.includes("rpc('canonical_transition_ediel_production'"), 'Production actions must delegate to canonical_transition_ediel_production')
assert(actorActions.includes("rpc('canonical_save_ediel_actor_profile'"), 'Profile writes must delegate to canonical_save_ediel_actor_profile')
assert(!actorActions.includes('ignorePaused'), 'ignorePaused bypass must not exist')
assert(!/from\(["']companies["']\)[\s\S]{0,300}\.update\([\s\S]{0,300}(?:production_status|ediel_production_status|live_ediel_enabled|ediel_production_enabled)/.test(actorActions), 'Actor testing actions write production state directly to companies')
assert(!/status\s*:\s*["']passed["']/.test(actorActions), 'Actor testing action can still set passed directly')
assert(actorActions.includes("rpc('canonical_request_actor_test_attestation'"), 'Manual verification requests must use the canonical attestation RPC')
assert(actorActions.includes("rpc('canonical_approve_actor_test_attestation'"), 'Manual verification approvals must use the canonical attestation RPC')
assert((actorActions.match(/configurationSnapshotId:\s*readiness\.configurationSnapshot\.id/g) ?? []).length >= 5, 'Production transitions must carry the current configuration snapshot')
assert(!actorActions.includes("action: 'SUPERADMIN_COMPANY_REACTIVATED'"), 'Actor testing must not reuse tenant-reactivation audit events')
assert(!actorActions.includes("action: 'SUPERADMIN_COMPANY_PAUSED'"), 'Actor testing must not reuse tenant-pause audit events')

const db = read('lib/ediel/db.ts')
assert(db.includes("rpc('canonical_capture_ediel_configuration_snapshot'"), 'Test-run creation must capture a configuration snapshot')
assert(db.includes("String(message.environment ?? '').toLowerCase() !== 'test'"), 'Message attachment must reject non-test environments')
assert(db.includes('Number(message.test_flag ?? 0) !== 1'), 'Message attachment must require test_flag=1')
assert(db.includes('message_predates_test_run'), 'Message attachment must reject evidence created before run start')
assert(db.includes('manual_pass_forbidden_use_machine_evidence_rpc'), 'Direct manual passed status must be forbidden')

const evidence = read('lib/ediel/actorTestingEngine.ts')
const sentFunction = /function isSentLike[\s\S]*?\n}/.exec(evidence)?.[0] ?? ''
for (const status of ['provider_accepted', 'sent', 'delivered', 'acknowledged']) assert(sentFunction.includes(status), `Strict sent evidence is missing ${status}`)
for (const forbidden of ['prepared', 'queued', 'validated']) assert(!sentFunction.includes(forbidden), `isSentLike still accepts ${forbidden}`)
assert(evidence.includes("rpc('canonical_record_actor_test_evidence'"), 'Passed evidence must be committed through canonical_record_actor_test_evidence')
assert(evidence.includes("message.environment !== 'test' || message.test_flag !== 1"), 'Evidence engine must reject production/non-test messages')
assert(!evidence.includes('.catch(() => null)'), 'Evidence engine must not swallow critical failures')
assert(!evidence.includes('.catch(() => undefined)'), 'Evidence engine must not swallow critical failures')

const importActions = read('app/admin/ediel/actions.ts')
assert(importActions.includes('if (mode === "tgt")'), 'Import path lacks explicit TGT branch')
assert(importActions.includes('if (mode === "agt")'), 'Import path lacks explicit AGT branch')
const importSection = importActions.slice(importActions.indexOf('if (mode === "tgt")'), importActions.indexOf('revalidateEdiel', importActions.indexOf('if (mode === "tgt")')))
assert(!/mode === "production"[\s\S]{0,800}attach/.test(importSection), 'Production import can still attach test evidence')

const operationPolicy = read('lib/tenant/operationPolicy.ts')
assert(operationPolicy.includes("rpc('canonical_tenant_operation_decision'"), 'Runtime tenant operation policy RPC is not used')
for (const relative of [
  'lib/ediel/outbox/claimOutboxItems.ts',
  'lib/ediel/outbox/sendOutboxItem.ts',
  'lib/email/emailOutbox.ts',
  'lib/integrations/webhooks.ts',
]) {
  const source = read(relative)
  assert(source.includes('getTenantOperationDecision') || source.includes('requireTenantOperationAllowed'), `${relative} lacks tenant operation guard`)
  assert(source.includes('blocked_tenant_state'), `${relative} does not preserve blocked tenant jobs`)
}

const requiredMigrations = [
  'supabase/migrations/20260802010000_canonical_tenant_operation_policy_lifecycle.sql',
  'supabase/migrations/20260802011000_canonical_ediel_production_state.sql',
  'supabase/migrations/20260802012000_ediel_configuration_snapshots.sql',
  'supabase/migrations/20260802013000_ediel_test_evidence_v2.sql',
  'supabase/migrations/20260802014000_canonical_provisioning_access.sql',
  'supabase/migrations/20260802015000_canonical_backfill_constraints.sql',
]
for (const relative of requiredMigrations) assert(exists(relative), `Forward-only migration is missing: ${relative}`)

const lifecycleMigration = read(requiredMigrations[0])
assert(lifecycleMigration.includes('canonical_tenant_operation_decision'), 'Canonical operation decision function is missing')
assert(lifecycleMigration.includes('canonical_transition_tenant_lifecycle'), 'Canonical lifecycle transition function is missing')
assert(lifecycleMigration.includes('for update'), 'Lifecycle transition must lock state')
assert(lifecycleMigration.includes('canonical_domain_events'), 'Lifecycle transition must write domain events')

const productionMigration = read(requiredMigrations[1])
assert(productionMigration.includes('ediel_production_state'), 'Canonical Ediel production state table is missing')
assert(productionMigration.includes('canonical_transition_ediel_production'), 'Canonical Ediel production transition is missing')
assert(productionMigration.includes("v_company.status<>'active'"), 'Production live/prepared must require active tenant')

const snapshotMigration = read(requiredMigrations[2])
assert(snapshotMigration.includes('ediel_configuration_snapshots'), 'Configuration snapshot table is missing')
assert(snapshotMigration.includes('configuration_hash'), 'Configuration snapshot hash is missing')
assert(snapshotMigration.includes('is_stale'), 'Snapshot invalidation fields are missing')
for (const required of ['active_test_configurations', 'active_rule_versions', 'canonical-evidence-v2']) {
  assert(snapshotMigration.includes(required), `Configuration snapshot payload is missing ${required}`)
}

const evidenceMigration = read(requiredMigrations[3])
for (const required of [
  'actor_test_attempts',
  'actor_test_manual_attestations',
  'canonical_record_actor_test_evidence',
  'canonical_request_actor_test_attestation',
  'canonical_approve_actor_test_attestation',
  'actor_test_attempt_evidence_company_attempt_fk',
  'actor_test_manual_attestations_company_attempt_fk',
  'ediel_test_run_messages_company_run_fk_v2',
  'ediel_test_run_messages_company_message_fk_v2',
  'terminal_actor_test_attempts_are_immutable',
  'guard_ediel_test_run_message_evidence',
  'production_message_cannot_be_test_evidence',
]) assert(evidenceMigration.includes(required), `Evidence migration is missing ${required}`)
assert(evidenceMigration.includes("if tg_op='DELETE' then"), 'Immutable attempt trigger must return OLD for allowed deletes')

const provisioningMigration = read(requiredMigrations[4])
assert(provisioningMigration.includes('canonical_provisioning_requests'), 'Global provisioning idempotency registry is missing')
assert(provisioningMigration.includes('pg_advisory_xact_lock'), 'Provisioning idempotency must serialize concurrent retries')
assert(provisioningMigration.includes('canonical_change_tenant_user_access'), 'Atomic tenant access RPC is missing')
assert(provisioningMigration.includes('canonical_actor_is_platform_admin'), 'Access RPC must derive platform authorization from the database')
assert(!provisioningMigration.includes("p_command->>'actor_membership_role'"), 'Access RPC still trusts a client-supplied actor role')
assert(provisioningMigration.includes('target_user_profile_missing_or_inactive'), 'Access RPC must reject inactive target profiles')
assert(provisioningMigration.includes('before insert or update on public.company_invitations'), 'Invitation acceptance guard must cover insert and update')

const edielClaimWorker = read('lib/ediel/outbox/claimOutboxItems.ts')
assert(edielClaimWorker.includes('export async function claimEdielOutboxItem'), 'Single-item Ediel claims must be guarded')
assert((edielClaimWorker.match(/getTenantOperationDecision/g) ?? []).length >= 2, 'Both bulk and single Ediel claims must evaluate tenant operation policy')
const edielSendWorker = read('lib/ediel/outbox/sendOutboxItem.ts')
assert(edielSendWorker.includes('const transportDecision = await getTenantOperationDecision'), 'Ediel transport must recheck tenant state immediately before SMTP')
assert(edielSendWorker.indexOf('const transportDecision = await getTenantOperationDecision') < edielSendWorker.indexOf('await sendEdielMessageViaSmtp'), 'Final tenant decision must happen before irreversible Ediel transport')

const preflightSql = read('scripts/canonical-production-hardening-preflight.sql')
assert(preflightSql.includes('ediel_tenant_relation_quarantine'), 'Preflight must query the canonical tenant-relation quarantine table')
assert(!preflightSql.includes('canonical_tenant_quarantine'), 'Preflight references a nonexistent legacy quarantine table')

const packageJson = JSON.parse(read('package.json'))
assert(packageJson.scripts?.['ops:canonical-production-hardening'] === 'node scripts/canonical-production-hardening-regression.cjs', 'Package regression command is missing')
assert(packageJson.scripts?.['ops:canonical-production-preflight'], 'Package preflight command is missing')
assert(packageJson.scripts?.['ops:canonical-production-db-regression'], 'Package DB regression command is missing')
assert(packageJson.scripts?.['ops:canonical-production-rls-regression'], 'Package RLS regression command is missing')

if (failures.length) {
  console.error(`Canonical production hardening regression failed (${failures.length})`)
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}
console.log('Canonical production hardening regression passed (permissions, tenant scope, evidence, lifecycle, workers, migrations).')
