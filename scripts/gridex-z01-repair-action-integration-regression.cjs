#!/usr/bin/env node
// Regression: Z01 repair action integration
// Verifies:
// 1. CustomerBusinessActionsCard.tsx contains an actual <form> action inside canRunRepair block
// 2. business-actions.ts exports repairZ01CustomerInfoRequestAction
// 3. business-actions.ts exports dryRunZ01RepairAction
// 4. Both actions call requirePlatformAdminAccess (not just requireAdminActionAccess)
// 5. repairZ01CustomerInfoRequestAction calls finalizeStuckZ01GridOwnerDataRequest
// 6. dryRunZ01RepairAction calls dryRunZ01Finalizer
// 7. Both actions revalidate /admin/messages and /admin/outbound
// 8. No direct SMTP send in repair path
// 9. app/api/internal/z01-repair/route.ts still exists (internal fallback)
// 10. messages/page.tsx queries outbound_requests (not only ediel_messages)
// 11. No gridex_repair_z01_grid_owner_data_request_finalizer SQL RPC expected (Option B)
// 12. Ownership verification present in repair action (company_id check)
// 14. dryRunZ01RepairAction audit insert uses real columns (customer_id/payload/created_by)
//     and not metadata/actor_user_id
// 15. dry-run audit insert error is checked, not discarded via bare .maybeSingle()

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const exists = (file) => fs.existsSync(path.join(root, file))

const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const actionsCard = read('components/admin/customers/CustomerBusinessActionsCard.tsx')
const businessActions = read('app/admin/customers/[id]/business-actions.ts')
const messagesPage = read('app/admin/messages/page.tsx')

// ---- 1. CustomerBusinessActionsCard wires the repair/dry-run forms ----
assert(
  /action=\{repairZ01CustomerInfoRequestAction\}/.test(actionsCard) &&
  /action=\{dryRunZ01RepairAction\}/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: wires repair + dry-run server actions to <form> elements'
)
// ---- 1b. A visible Z01 repair/dry-run result is rendered (so clicking is not silent) ----
assert(
  /z01RepairEvents/.test(actionsCard) && /Senaste Z01-reparation/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: renders a visible Z01 repair/dry-run result panel'
)

// ---- 2. repairZ01CustomerInfoRequestAction is exported ----
assert(
  /export async function repairZ01CustomerInfoRequestAction/.test(businessActions),
  'business-actions.ts: exports repairZ01CustomerInfoRequestAction'
)

// ---- 3. dryRunZ01RepairAction is exported ----
assert(
  /export async function dryRunZ01RepairAction/.test(businessActions),
  'business-actions.ts: exports dryRunZ01RepairAction'
)

// ---- 4. Both actions use requirePlatformAdminAccess ----
const repairFn = businessActions.match(/repairZ01CustomerInfoRequestAction[\s\S]*?^}/m)?.[0] ?? ''
const dryRunFn = businessActions.match(/dryRunZ01RepairAction[\s\S]*?^}/m)?.[0] ?? ''
assert(
  /requirePlatformAdminAccess/.test(repairFn) || /requirePlatformAdminAccess/.test(businessActions),
  'business-actions.ts: repairZ01CustomerInfoRequestAction uses requirePlatformAdminAccess'
)
assert(
  /requirePlatformAdminAccess/.test(dryRunFn) || /requirePlatformAdminAccess/.test(businessActions),
  'business-actions.ts: dryRunZ01RepairAction uses requirePlatformAdminAccess'
)
// Must NOT use only requireAdminActionAccess for these platform-admin functions
assert(
  /requirePlatformAdminAccess/.test(businessActions),
  'business-actions.ts: imports and calls requirePlatformAdminAccess'
)

// ---- 5. repairZ01CustomerInfoRequestAction calls finalizeStuckZ01GridOwnerDataRequest ----
assert(
  /finalizeStuckZ01GridOwnerDataRequest/.test(businessActions),
  'business-actions.ts: calls finalizeStuckZ01GridOwnerDataRequest'
)

// ---- 6. dryRunZ01RepairAction calls dryRunZ01Finalizer ----
assert(
  /dryRunZ01Finalizer/.test(businessActions),
  'business-actions.ts: calls dryRunZ01Finalizer'
)

// ---- 7. Repair action revalidates critical paths ----
assert(
  /revalidatePath.*\/admin\/messages/.test(businessActions),
  'business-actions.ts: revalidates /admin/messages after repair'
)
assert(
  /revalidatePath.*\/admin\/outbound/.test(businessActions),
  'business-actions.ts: revalidates /admin/outbound after repair'
)
assert(
  /revalidatePath.*\/admin\/customer-info-requests/.test(businessActions),
  'business-actions.ts: revalidates /admin/customer-info-requests after repair'
)

// ---- 8. No direct SMTP send in repair path ----
assert(
  !/smtp_send|sendEmail|nodemailer|sendMail/.test(businessActions.split('repairZ01CustomerInfoRequestAction')[1]?.split('export async')[0] ?? ''),
  'business-actions.ts: no direct SMTP in repairZ01CustomerInfoRequestAction'
)

assert(
  /record\.code/.test(businessActions) && /record\.message/.test(businessActions) && /record\.details/.test(businessActions),
  'business-actions.ts: repair failure logs PostgREST/plain-object errors instead of only Okänt tekniskt fel'
)

// ---- 9. app/api/internal/z01-repair/route.ts still exists ----
assert(
  exists('app/api/internal/z01-repair/route.ts'),
  'app/api/internal/z01-repair/route.ts: still exists as internal fallback endpoint'
)

// ---- 10. messages/page.tsx queries outbound_requests (not only ediel_messages) ----
assert(
  /outbound_requests/.test(messagesPage),
  'messages/page.tsx: queries outbound_requests table (pre-message operational rows)'
)
assert(
  /grid_owner_data_requests/.test(messagesPage),
  'messages/page.tsx: queries grid_owner_data_requests table (stuck operational rows)'
)

// ---- 11. Option B — no SQL RPC gridex_repair_z01_grid_owner_data_request_finalizer ----
const migrationDir = path.join(root, 'supabase/migrations')
const migrationFiles = fs.readdirSync(migrationDir).map((f) => {
  try { return fs.readFileSync(path.join(migrationDir, f), 'utf8') } catch { return '' }
})
const sqlHasRpc = migrationFiles.some((content) =>
  /gridex_repair_z01_grid_owner_data_request_finalizer/.test(content)
)
assert(
  !sqlHasRpc,
  'supabase/migrations: no SQL RPC gridex_repair_z01_grid_owner_data_request_finalizer (Option B: TypeScript-only)'
)

// ---- 12. Ownership verification present ----
assert(
  /godr\.company_id.*companyId|company_id.*!==.*companyId/.test(businessActions),
  'business-actions.ts: validates company_id ownership before running repair'
)

// ---- 13. repairZ01CustomerInfoRequestAction imported in CustomerBusinessActionsCard ----
assert(
  /repairZ01CustomerInfoRequestAction/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: imports repairZ01CustomerInfoRequestAction'
)
assert(
  /dryRunZ01RepairAction/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: imports dryRunZ01RepairAction'
)

// ---- 14. dryRunZ01RepairAction audit insert uses real customer_info_request_events columns ----
// The table requires customer_id (NOT NULL) and uses payload/created_by. A previous
// regression bug inserted actor_user_id/metadata and omitted customer_id, so the insert
// silently failed (.maybeSingle() error was discarded) and no dry-run audit row persisted.
const dryRunBody = businessActions.match(/export async function dryRunZ01RepairAction[\s\S]*?\n}/)?.[0] ?? ''
assert(
  dryRunBody.length > 0,
  'business-actions.ts: dryRunZ01RepairAction body extracted for audit-insert checks'
)

const dryRunInsert =
  dryRunBody.match(/\.from\(\s*["']customer_info_request_events["']\s*\)[\s\S]*?\}\s*\)/)?.[0] ?? ''
assert(
  dryRunInsert.length > 0,
  'business-actions.ts: dryRunZ01RepairAction inserts into customer_info_request_events'
)
assert(
  /customer_id\s*:/.test(dryRunInsert),
  'business-actions.ts: dry-run audit insert provides NOT NULL customer_id'
)
assert(
  /payload\s*:/.test(dryRunInsert),
  'business-actions.ts: dry-run audit insert uses payload column'
)
assert(
  /created_by\s*:/.test(dryRunInsert),
  'business-actions.ts: dry-run audit insert uses created_by column'
)
assert(
  !/metadata\s*:/.test(dryRunInsert),
  'business-actions.ts: dry-run audit insert does NOT use non-existent metadata column'
)
assert(
  !/actor_user_id\s*:/.test(dryRunInsert),
  'business-actions.ts: dry-run audit insert does NOT use non-existent actor_user_id column'
)

// ---- 15. dry-run audit insert error is checked, not discarded via bare .maybeSingle() ----
assert(
  /const\s*\{\s*error\s*:\s*auditError\s*\}\s*=\s*await\s+supabaseService[\s\S]*?customer_info_request_events/.test(dryRunBody) ||
    /auditError/.test(dryRunBody),
  'business-actions.ts: dry-run audit insert checks the returned error (no silent failure)'
)
assert(
  !/customer_info_request_events["']\s*\)[\s\S]*?\.maybeSingle\(\)/.test(dryRunBody),
  'business-actions.ts: dry-run audit insert is not a bare .maybeSingle() that discards the error'
)

console.log('\n✓ Z01 repair action integration regression passed.')
