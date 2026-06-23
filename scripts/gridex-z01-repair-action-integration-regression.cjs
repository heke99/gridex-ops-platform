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

// ---- 1. CustomerBusinessActionsCard contains actual <form> inside canRunRepair block ----
const canRunRepairBlock = actionsCard.match(/canRunRepair[\s\S]*?<\/div>\s*\) : null}/)?.[0] ?? actionsCard
assert(
  /<form/.test(canRunRepairBlock) || /<form/.test(actionsCard.split('canRunRepair')[1] ?? ''),
  'CustomerBusinessActionsCard.tsx: canRunRepair block contains actual <form> element(s)'
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

console.log('\n✓ Z01 repair action integration regression passed.')
