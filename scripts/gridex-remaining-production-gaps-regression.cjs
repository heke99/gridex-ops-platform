const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const hash = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')

const migration = read('supabase/migrations/20260811073000_gridex_remaining_production_gaps_v1.sql')
const releaseMigration = read('supabase/migrations/20260811073500_gridex_release_identity_completion.sql')
const reviewFixMigration = read('supabase/migrations/20260811074000_gridex_remaining_gaps_review_fixes.sql')
const inboundActions = read('app/admin/inbound-mail/actions.ts')
const inboundDetail = read('app/admin/inbound-mail/[id]/page.tsx')
const eventRuntime = read('lib/events/domainEvents.ts')
const additions = JSON.parse(read('scripts/migration-history-manifest.additions.json'))

const controls = []
const control = (id, condition, message) =>
  controls.push({ id, passed: Boolean(condition), message })

control(
  'R01',
  !/\bcreate\s+table\b/i.test(migration) &&
    !/\bcreate\s+table\b/i.test(releaseMigration) &&
    !/\bcreate\s+table\b/i.test(reviewFixMigration),
  'remaining-gap remediation creates a parallel table instead of strengthening existing schema',
)
control(
  'R02',
  ['review_owner','review_owner_user_id','review_priority','review_reason_code','review_sla_due_at','review_resolution','review_resolved_at','review_resolved_by']
    .every((token) => migration.includes(token)),
  'inbound manual-review lifecycle fields are incomplete',
)
control(
  'R03',
  migration.includes('canonical_resolve_inbound_manual_review'),
  'manual review does not have one canonical resolution function',
)
control(
  'R04',
  migration.includes("'INBOUND_MANUAL_REVIEW_RESOLVED'"),
  'manual-review resolution lacks an audit receipt',
)
control(
  'R05',
  migration.includes("where job.status = 'manual_review'") &&
    migration.includes("'platform_operations'") &&
    migration.includes("job.created_at + interval '24 hours'"),
  'legacy manual-review work is not truthfully assigned and SLA-classified',
)
control(
  'R06',
  inboundActions.includes('requirePlatformAdminActionAccess()') &&
    inboundActions.includes('resolveInboundManualReviewAction') &&
    inboundActions.includes('canonical_resolve_inbound_manual_review'),
  'existing inbound admin flow does not use canonical guarded resolution',
)
control(
  'R07',
  inboundDetail.includes("from('inbound_processing_jobs')") &&
    inboundDetail.includes('InboundManualReviewForm') &&
    !inboundDetail.includes('manual_review_jobs'),
  'inbound UI uses a parallel review model',
)

control(
  'R08',
  migration.includes('delete from public.user_permission_overrides where user_id=target_user_id'),
  'account anonymisation leaves permission overrides',
)
control(
  'R09',
  migration.includes('delete from public.user_roles where user_id=target_user_id'),
  'account anonymisation leaves role grants',
)
control(
  'R10',
  migration.includes('delete from public.company_memberships where user_id=target_user_id'),
  'account anonymisation leaves tenant memberships',
)
control(
  'R11',
  migration.includes('update public.company_invitations') &&
    migration.includes("status='revoked'") &&
    migration.includes('accept_token_hash=null'),
  'account anonymisation leaves usable invitation authorization material',
)
control(
  'R12',
  migration.includes('delete from auth.refresh_tokens') &&
    migration.includes('delete from auth.sessions where user_id=target_user_id'),
  'account anonymisation does not revoke active sessions and refresh tokens transactionally',
)
control(
  'R13',
  migration.includes('Active companies must be transferred or archived first'),
  'account anonymisation lost the existing active-owner safety guard',
)

control(
  'R14',
  migration.includes('gridex_sync_company_org_number_compatibility') &&
    migration.includes('new.organization_number := new.org_number'),
  'organisation-number compatibility does not converge on org_number',
)
control(
  'R15',
  !/\bdrop\s+column\s+(?:if\s+exists\s+)?(?:"?(?:organization_number|org_number)"?)/i.test(migration),
  'organisation-number remediation breaks legacy readers instead of converging safely',
)
control(
  'R16',
  migration.includes('where organization_number is distinct from org_number'),
  'existing organisation-number data is not normalized before compatibility enforcement',
)

control(
  'R17',
  ['migration_manifest_hash','database_schema_fingerprint','generated_types_hash','openapi_contract_version','openapi_hash','reconciliation_result','performance_snapshot']
    .every((token) => migration.includes(token)),
  'existing release receipt table lacks complete release identity fields',
)
control(
  'R18',
  releaseMigration.includes('canonical_record_platform_release_receipt') &&
    releaseMigration.includes("message='release_identity_incomplete'"),
  'complete release identity is not enforced by a canonical writer',
)
control(
  'R19',
  releaseMigration.includes('on conflict(environment,release_sha,schema_migration_version) do update'),
  'release receipt writer is not idempotent on the existing release identity key',
)
control(
  'R20',
  releaseMigration.includes('to service_role') &&
    releaseMigration.includes('from public, anon, authenticated'),
  'release receipt writer is exposed outside service-role operations',
)

const reconciliationKeys = [
  'role_without_auth_identity',
  'stale_privileged_role',
  'duplicate_membership',
  'duplicate_role',
  'accepted_invite_without_access',
  'stuck_provisioning',
  'provisioning_dead_letter',
  'due_stranded_active_outbox',
  'contract_without_customer',
  'contract_without_site',
  'contract_without_metering_point',
  'switch_without_contract',
  'ediel_live_without_valid_tenant',
  'invalid_lifecycle',
  'customer_operation_review_over_sla',
  'inbound_manual_review_without_owner',
  'inbound_manual_review_over_sla',
  'application_without_repair',
]
control(
  'R21',
  reconciliationKeys.every((key) => migration.includes(`'${key}'`)),
  'bounded reconciliation result omits required invariant coverage',
)
control(
  'R22',
  migration.includes("message='reconciliation_company_scope_required'") &&
    migration.includes('where id=p_company_id'),
  'reconciliation is not explicitly tenant-bounded',
)
control(
  'R23',
  [
    'check-error:role-without-auth-identity',
    'check-error:stale-privileged-role',
    'check-error:accepted-invite-without-access',
    'check-error:stuck-provisioning-job',
    'check-error:due-stranded-event-outbox',
    'check-error:contract-without-customer',
    'check-error:contract-without-site',
    'check-error:contract-without-metering-point',
    'check-error:switch-without-contract',
    'check-error:ediel-live-without-valid-tenant',
  ].every((key) => migration.includes(key)),
  'new reconciliation checks do not fail closed on query errors',
)
control(
  'R24',
  migration.includes('from public.event_outbox outbox') &&
    migration.includes('from public.canonical_event_outbox outbox') &&
    reviewFixMigration.includes('from public.event_outbox outbox') &&
    reviewFixMigration.includes('from public.canonical_event_outbox outbox'),
  'reconciliation ignores either the active outbox or compatibility outbox during convergence',
)
control(
  'R25',
  eventRuntime.includes("from('domain_events')") || eventRuntime.includes('from("domain_events")'),
  'existing active domain event store is no longer the runtime source',
)
control(
  'R26',
  eventRuntime.includes("from('event_outbox')") || eventRuntime.includes('from("event_outbox")'),
  'existing active event_outbox is no longer the runtime queue',
)
control(
  'R27',
  !/\b(?:canonical_)?(?:domain_events|event_outbox)_v2\b/i.test(migration) &&
    !/\b(?:canonical_)?(?:domain_events|event_outbox)_v2\b/i.test(reviewFixMigration),
  'event remediation introduces a parallel v2 event system',
)

const migrationName = '20260811073000_gridex_remaining_production_gaps_v1.sql'
const releaseMigrationName = '20260811073500_gridex_release_identity_completion.sql'
const reviewFixMigrationName = '20260811074000_gridex_remaining_gaps_review_fixes.sql'
control(
  'R28',
  additions.files[migrationName] === hash(`supabase/migrations/${migrationName}`),
  'remaining-gap migration checksum is not pinned correctly',
)
control(
  'R29',
  additions.files[releaseMigrationName] === hash(`supabase/migrations/${releaseMigrationName}`),
  'release-identity migration checksum is not pinned correctly',
)
control(
  'R30',
  migration.includes('grant execute on function public.canonical_run_architecture_reconciliation(uuid)') &&
    migration.includes('to service_role'),
  'expanded reconciliation is not service-role-only',
)
control(
  'R31',
  migration.includes('canonical_actor_is_platform_admin(p_actor_user_id)'),
  'manual-review resolution does not use existing platform-admin authorization',
)
control(
  'R32',
  migration.includes('set local lock_timeout') &&
    migration.includes('set local statement_timeout') &&
    releaseMigration.includes('set local lock_timeout') &&
    releaseMigration.includes('set local statement_timeout') &&
    reviewFixMigration.includes('set local lock_timeout') &&
    reviewFixMigration.includes('set local statement_timeout'),
  'forward migrations lack bounded lock/statement timeouts',
)
control(
  'R33',
  reviewFixMigration.includes("outbox.status in ('queued','failed')") &&
    reviewFixMigration.includes("outbox.status='processing'"),
  'active event_outbox health check does not match queued/processing/failed status semantics',
)
control(
  'R34',
  reviewFixMigration.includes("outbox.status in ('pending','failed')") &&
    reviewFixMigration.includes("outbox.status='processing'"),
  'compatibility outbox health check does not match pending/processing/failed status semantics',
)
control(
  'R35',
  reviewFixMigration.includes("where public.platform_release_receipts.status in ('candidate','verified')") &&
    reviewFixMigration.includes("message='release_receipt_not_reverifiable'"),
  'release receipt writer can overwrite a failed or superseded release verdict',
)
control(
  'R36',
  additions.files[reviewFixMigrationName] === hash(`supabase/migrations/${reviewFixMigrationName}`),
  'review-fix migration checksum is not pinned correctly',
)

if (controls.length !== 36) {
  console.error(`Remaining production gaps regression definition error: expected 36 controls, got ${controls.length}`)
  process.exit(1)
}

const failures = controls.filter((item) => !item.passed)
if (failures.length) {
  console.error(`Gridex remaining production gaps regression failed (${failures.length}/36)`)
  for (const failure of failures) console.error(`- ${failure.id}: ${failure.message}`)
  process.exit(1)
}

console.log('Gridex remaining production gaps regression passed (36/36 controls)')
