#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
function read(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}
function ok(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`)
    process.exitCode = 1
  } else {
    console.log(`OK: ${message}`)
  }
}

const automation = read('lib/customer-operations/automation.ts')
ok(automation.includes('function safeRunAfter'), 'customer operations has safeRunAfter helper')
ok(automation.includes('run_after: nowIso()'), 'new customer operation jobs set run_after at enqueue time')
ok(!automation.includes('run_after: outcome.runAfter ?? null'), 'completed jobs no longer write run_after null')
ok(!automation.includes('run_after: terminal ? null : retryAt'), 'terminal error path no longer writes run_after null')
ok(automation.includes('run_after: safeRunAfter(outcome.runAfter)'), 'job outcome update guards run_after')

const shared = read('lib/ediel/flows/shared.ts')
ok(shared.includes("import { createOutboxItem } from '@/lib/ediel/outbox/createOutboxItem'"), 'queuePreparedEdielMessage imports createOutboxItem')
ok(shared.includes('await createOutboxItem({'), 'queuePreparedEdielMessage creates ediel_outbox rows')
ok(shared.includes("status: 'queued'"), 'prepared Ediel message is queued to transport outbox')
ok(shared.includes('edielOutboxQueued'), 'outbound response payload records transport queue state')

const dispatch = read('lib/customer-operations/facilityLookupEdifactDispatch.ts')
// The hardcoded '23-DDQ-PRODAT' constant moved to the single rule source:
// the renderer derives it via resolveApplicationReferenceForProcess and the
// dispatcher imports that canonical constant.
ok(
  dispatch.includes("import { FACILITY_LOOKUP_APPLICATION_REFERENCE } from '@/lib/ediel/intent/renderers/facilityLookupZ01'") &&
    read('lib/ediel/intent/renderers/facilityLookupZ01.ts').includes("resolveApplicationReferenceForProcess('facility_lookup')"),
  'facility lookup application reference is deterministic',
)
ok(dispatch.includes("request.ediel_message_id && request.outbound_request_id"), 'facility request does not short-circuit with only outbound_request_id')
// The repair path evolved: half-created dispatches are repaired in place and
// flagged with repairedFacilityLookupEdifactDispatch + repaired_and_queued.
ok(dispatch.includes('repairedFacilityLookupEdifactDispatch: true') && dispatch.includes("'repaired_and_queued'"), 'half-created facility outbounds are repaired')
ok(dispatch.includes(".in('status', ['ready_to_send', 'waiting_response'])"), 'facility dispatcher scans repairable waiting_response rows')
ok(dispatch.includes("row.status === 'waiting_response' && Boolean(row.outbound_request_id) && !row.ediel_message_id"), 'dispatcher filters waiting_response rows missing ediel_message_id')
ok(dispatch.includes('grid_owner_information_request_id: request.id'), 'outbound first-class facility request link is patched')
ok(dispatch.includes('customer_site_id: request.customer_site_id'), 'outbound first-class customer site link is patched')

const actor = read('lib/ediel/automationActor.ts')
ok(actor.includes('ediel_actor_missing_auth_user'), 'automation actor reports missing auth user explicitly')
ok(actor.includes('hasActiveMembership'), 'automation actor accepts active company membership when profile is absent')
ok(actor.includes('auth.admin.getUserById'), 'automation actor validates auth.users')

const inbound = read('app/api/internal/inbound-mail/cron/route.ts')
ok(inbound.includes('safeInboundErrorCode'), 'inbound cron returns categorized safe error code')
ok(inbound.includes('mailbox_config_missing'), 'inbound diagnostics include mailbox config error')
ok(inbound.includes('imap_credentials_missing'), 'inbound diagnostics include IMAP credential error')

const migration = read('supabase/migrations/20260625100000_gridex_customer_operations_runtime_hotfix.sql')
ok(migration.includes('gridex_customer_operation_jobs_run_after_guard'), 'migration adds run_after trigger guard')
ok(migration.includes('grid_owner_information_request_id'), 'migration adds/backfills outbound facility request link')
ok(migration.includes('customer_site_id'), 'migration adds/backfills outbound customer_site_id')
ok(migration.includes('ediel_outbox_runtime_claim_idx'), 'migration adds transport outbox runtime claim index')

const pkg = read('package.json')
ok(pkg.includes('gridex:customer-operations-runtime-hotfix-regression'), 'package exposes runtime hotfix regression script')

if (process.exitCode) process.exit(process.exitCode)
console.log('Customer operations runtime hotfix regression passed')
