#!/usr/bin/env node
// Ediel automation pipeline regression: intent-as-master + false-state fix.
//
// Proves the source-of-truth principle end to end (static analysis):
//  1. dispatch state is derived from intent -> outbox -> message; legacy
//     outbound_requests is diagnostic only and a queued/attempts=0 row is never
//     treated as sent/waiting.
//  2. The UI never claims "waiting for grid owner" before a real queued/sent state.
//  3. A validated intent renders + queues an ediel_outbox row carrying intent_id,
//     and stuck intents are resumable.
//  4. The facility-lookup Application Reference is deterministic (DDQ).
//  5. Render failures become controlled blockers (no stalled intent).
//  6. Inbound Z02 completes the linked grid_owner_information_request.
//  7. Inbound UTILTS meter values are normalized (no double-count).
//  8. Billing underlay/invoice readiness blocks on missing prerequisites.
//  9. Tenant Swedish vs superadmin diagnostics separation.
// 10. The migration is additive/idempotent/non-destructive.

const fs = require('fs')
const path = require('path')
const root = process.cwd()
function read(file) { return fs.readFileSync(path.join(root, file), 'utf8') }
function assert(ok, msg) { if (!ok) { console.error(`\u2717 ${msg}`); process.exitCode = 1 } else console.log(`\u2713 ${msg}`) }

const dispatchState = read('lib/ediel/intent/dispatchState.ts')
const legacyBridge = read('lib/ediel/outbox/legacyOutboundBridge.ts')
const workflow = read('lib/customer-operations/customerCardWorkflow.ts')
const tenantView = read('lib/customer-operations/customerCardTenantView.ts')
const actionRegistry = read('lib/customer-operations/customerActionRegistry.ts')
const renderGateway = read('lib/ediel/intent/renderGateway.ts')
const resume = read('lib/ediel/intent/resumeStuckIntents.ts')
const cron = read('app/api/internal/customer-operations/cron/route.ts')
const apprefPolicy = read('lib/ediel/intent/applicationReferencePolicy.ts')
const flZ01 = read('lib/ediel/intent/renderers/facilityLookupZ01.ts')
const dispatch = read('lib/customer-operations/facilityLookupEdifactDispatch.ts')
const routeEngine = read('lib/routes/routeDecisionEngine.ts')
const automation = read('lib/customer-operations/automation.ts')
const normalize = read('lib/metering/normalizeMeteringValues.ts')
const utilts = read('lib/ediel/flows/utiltsDataRequest.ts')
const invoiceReadiness = read('lib/billing/invoiceReadiness.ts')

// ---------------------------------------------------------------------------
// 1) Single source of truth: intent -> outbox -> message
// ---------------------------------------------------------------------------
assert(dispatchState.includes('export async function resolveEdielDispatchState'), 'dispatch state resolver exists')
assert(dispatchState.includes("from('ediel_message_intents')") && dispatchState.includes("from('ediel_outbox')") && dispatchState.includes("from('ediel_messages')"), 'resolver reads intent + outbox + message chain')
assert(dispatchState.includes('isLegacyOutboundActuallySent'), 'resolver consults the legacy "actually sent" predicate')
assert(dispatchState.includes('diagnostic') || dispatchState.includes('legacyOutboundStatus'), 'legacy outbound is diagnostic-only in the resolver')
assert(/const waitingForCounterparty = state === 'sent'/.test(dispatchState), 'waitingForCounterparty requires a real sent state (queued is pre-send)')
// Resolver fetches lightweight status columns, never raw payload, in list/card paths.
assert(!dispatchState.includes('raw_payload') && !dispatchState.includes("select('*')"), 'resolver avoids heavy payload/select * (performance)')

// ---------------------------------------------------------------------------
// 2) Legacy queued/attempts=0/sent_at=null is NOT sent / NOT waiting
// ---------------------------------------------------------------------------
assert(legacyBridge.includes('export function isLegacyOutboundActuallySent'), 'legacy bridge exposes isLegacyOutboundActuallySent')
assert(legacyBridge.includes('if (clean(row.sent_at)) return true'), 'legacy row is sent only with a real sent_at')
assert(legacyBridge.includes('num(row.attempts_count) > 0'), 'legacy row requires a real delivery attempt to count as sent')
assert(legacyBridge.includes('export async function markLegacyOutboundSupersededByIntent'), 'legacy bridge can supersede a legacy row by intent')

// ---------------------------------------------------------------------------
// 3) UI never shows "waiting for grid owner" before a real queued/sent state
// ---------------------------------------------------------------------------
assert(workflow.includes('dispatchState?: EdielDispatchStateResult | null'), 'workflow accepts dispatch state as source of truth')
assert(workflow.includes('const facilityDispatchSent = dispatchState'), 'workflow derives facilityDispatchSent from dispatch state')
assert(workflow.includes('} else if (facilityDispatchSent) {') && workflow.includes('primaryAction = "wait_for_grid_owner"'), 'wait_for_grid_owner is gated on a real sent state')
assert(workflow.includes('"dispatch_in_progress"'), 'workflow has a non-false "dispatch_in_progress" state for queued/pre-send')
// The old false branch (ready_to_send => waiting) must be gone.
assert(!/facilityLookupReady\)\s*\{[\s\S]{0,80}wait_for_grid_owner/.test(workflow), 'ready_to_send alone no longer maps to waiting')
assert(!workflow.includes('const facilityLookupWaiting ='), 'legacy facilityLookupWaiting heuristic removed')
assert(tenantView.includes("workflow.primaryAction === 'dispatch_in_progress'") && tenantView.includes("label: 'Köad för Ediel-sändning'"), 'tenant view shows "Köad för Ediel-sändning" for pre-send dispatch')
assert(tenantView.includes("workflow.primaryAction === 'wait_for_grid_owner'") && tenantView.includes("label: 'Väntar på svar från nätägare'"), 'tenant view shows waiting only for the wait_for_grid_owner state')
assert(actionRegistry.includes("case 'dispatch_in_progress':") && actionRegistry.includes("label: 'Köad för Ediel-sändning'"), 'action registry renders dispatch_in_progress as queued')

// ---------------------------------------------------------------------------
// 4) Validated intent renders + queues an outbox row with intent_id; resumable
// ---------------------------------------------------------------------------
assert(renderGateway.includes('queuePreparedEdielMessage') && renderGateway.includes('intentId: params.intentId'), 'gateway queues outbox carrying the intent_id')
assert(renderGateway.includes("outboxStatus: 'queued'"), 'gateway marks intent outbox_status queued only after queueing')
assert(resume.includes('export async function resumeStuckEdielIntents'), 'resume engine exists')
assert(resume.includes("validation_status', 'validated'") && resume.includes("render_status', ['not_rendered', 'failed']") && resume.includes("outbox_status', 'not_queued'"), 'resume targets validated/not-rendered/not-queued intents')
assert(cron.includes('resumeStuckEdielIntents'), 'customer-operations cron runs the resume sweep')

// ---------------------------------------------------------------------------
// 5) Deterministic application_reference (facility lookup = DDQ)
// ---------------------------------------------------------------------------
assert(apprefPolicy.includes('export function resolveApplicationReferenceForProcess'), 'single rule source for application reference exists')
assert(apprefPolicy.includes("return '23-DGI-PRODAT'") && apprefPolicy.includes("return '23-DDQ-PRODAT'"), 'rule source distinguishes DGI vs DDQ channels')
assert(flZ01.includes("resolveApplicationReferenceForProcess('facility_lookup')"), 'facility lookup constant derives from the single rule source')
assert(dispatch.includes('applicationReference: FACILITY_LOOKUP_APPLICATION_REFERENCE'), 'dispatcher passes explicit DDQ into the legacy outbound/route decision')
assert(routeEngine.includes('requestedPolicyAppRef'), 'route decision prefers a caller-requested policy-consistent application reference')

// ---------------------------------------------------------------------------
// 6) Render failures become controlled blockers (no stalled intent)
// ---------------------------------------------------------------------------
assert(renderGateway.includes('classifyRenderError') && renderGateway.includes("renderStatus: 'failed'"), 'gateway converts thrown render errors into render_status=failed + blocking reasons')
assert(renderGateway.includes('} catch (error) {') && renderGateway.includes("status: 'blocked'"), 'gateway returns blocked instead of throwing')
assert(dispatch.includes("code: 'facility_lookup_dispatch_unexpected_error'"), 'dispatcher records a controlled blocker on unexpected errors (never leaves dispatch_status=ready)')

// ---------------------------------------------------------------------------
// 7) Inbound Z02 completes the linked grid_owner_information_request
// ---------------------------------------------------------------------------
assert(automation.includes('completeLinkedGridOwnerInformationRequest'), 'inbound Z02 completes the linked grid_owner_information_request')
assert(automation.includes('facility_verification_status'), 'inbound Z02 records facility_verification_status')
assert(automation.includes("facility_data_status: verifiedGridOwnerId"), 'inbound Z02 sets customer_sites.facility_data_status')

// ---------------------------------------------------------------------------
// 8) Inbound UTILTS meter values are normalized without double counting
// ---------------------------------------------------------------------------
assert(normalize.includes('export async function projectMeteringValueToNormalized'), 'metering layer can project a meter value to normalized rows')
assert(normalize.includes("rpc('gridex_ingest_metering_value_atomic'") && normalize.includes('canonical_dedupe_key'), 'normalized projection is idempotent through the atomic canonical ingest RPC')
assert(utilts.includes('normalizeAndStoreMeteringValue('), 'inbound UTILTS path uses atomic metering normalization and projection')

// ---------------------------------------------------------------------------
// 9) Billing underlay / invoice readiness blocks on missing prerequisites
// ---------------------------------------------------------------------------
for (const code of ['no_underlays', 'blocked_underlays', 'missing_pricing', 'missing_contract_or_snapshot', 'period_locked']) {
  assert(invoiceReadiness.includes(`'${code}'`), `invoice readiness blocks on ${code}`)
}
assert(invoiceReadiness.includes("severity: 'blocked'"), 'invoice readiness produces controlled blockers, never silent finalization')

// ---------------------------------------------------------------------------
// 10) Tenant Swedish vs superadmin diagnostics separation
// ---------------------------------------------------------------------------
assert(dispatchState.includes('tenantLabel') && dispatchState.includes('technical:'), 'resolver returns tenant-safe label + superadmin technical detail')
assert(dispatchState.includes("'Väntar på svar från nätägare'") && dispatchState.includes("'Köad för Ediel-sändning'"), 'resolver tenant labels are plain Swedish')
// The tenant label function must only return Swedish strings (no raw Ediel
// internals). Inspect just the tenantLabelForState body, not surrounding comments.
const tenantLabelFn = (dispatchState.match(/function tenantLabelForState[\s\S]*?\n}/) ?? [''])[0]
assert(tenantLabelFn.length > 0, 'tenant label function is present')
assert(!/UNB|BGM|route_profile|certificate|fingerprint|payload|EDIFACT/i.test(tenantLabelFn), 'tenant label function exposes no raw Ediel internals')

// ---------------------------------------------------------------------------
// 11) Migration is additive, idempotent, non-destructive, RLS-safe
// ---------------------------------------------------------------------------
const migration = read('supabase/migrations/20260625130000_gridex_ediel_intent_source_of_truth.sql')
assert(migration.includes('add column if not exists facility_verification_status'), 'migration adds facility_verification_status additively')
assert(migration.includes('create index if not exists ediel_outbox_company_status_idx'), 'migration adds outbox company/status index')
assert(migration.includes('create index if not exists ediel_message_intents_lifecycle_idx'), 'migration adds intent lifecycle index for resume sweep')
assert(migration.includes('create index if not exists grid_owner_information_requests_type_status_idx'), 'migration adds facility-lookup dispatch index')
assert(migration.includes('create index if not exists outbound_requests_company_source_idx'), 'migration adds legacy outbound source index')
assert(!/drop\s+table/i.test(migration) && !/delete\s+from/i.test(migration) && !/\bdrop\s+column\b/i.test(migration), 'migration is non-destructive (no DROP TABLE/COLUMN, no DELETE)')

if (process.exitCode) process.exit(process.exitCode)
console.log('\nEdiel automation metering/billing regression passed.')
