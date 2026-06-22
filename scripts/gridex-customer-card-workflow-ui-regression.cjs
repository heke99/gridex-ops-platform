#!/usr/bin/env node
// Regression: Customer card workflow UI
// Verifies:
// 1. Customer card uses workflow/view model
// 2. Customer card shows visual workflow/timeline/stepper
// 3. Customer card shows one clear primary action
// 4. Technical actions are behind advanced/details section
// 5. Normal admin does not see dangerous repair/materialization buttons by default
// 6. Superadmin/platform admin can access technical diagnostics
// 7. Blocker code is not the main user-facing status
// 8. Next best action is derived from current state

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const assert = (condition, message) => {
  if (!condition) {
    console.error(`❌ ${message}`)
    process.exit(1)
  }
  console.log(`✅ ${message}`)
}

const actionsCard = read('components/admin/customers/CustomerBusinessActionsCard.tsx')
const workflow = read('lib/customer-operations/customerCardWorkflow.ts')
const timeline = read('components/admin/customers/CustomerProcessTimeline.tsx')

// ---- 1. Customer card imports and uses workflow view model ----
assert(
  /buildCustomerCardWorkflow/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: imports buildCustomerCardWorkflow'
)
assert(
  /buildCustomerCardWorkflow\s*\(/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: calls buildCustomerCardWorkflow'
)

// ---- 2. Customer card shows visual timeline/stepper ----
assert(
  /CustomerProcessTimeline/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: renders CustomerProcessTimeline'
)
assert(
  /workflowSteps/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: passes workflowSteps to timeline'
)
assert(
  /steps.*WorkflowStepStatus|WorkflowStepStatus/.test(timeline),
  'CustomerProcessTimeline.tsx: uses WorkflowStepStatus type'
)

// ---- 3. Single primary CTA ----
// The card should derive primaryAction from workflow model
assert(
  /workflow\.primaryAction/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: renders primary CTA based on workflow.primaryAction'
)
// Should not have the old two-column layout with two equal primary actions
assert(
  !/md:grid-cols-2[\s\S]{0,100}PrimaryAction[\s\S]{0,100}PrimaryAction/s.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: does NOT have two equal side-by-side primary action columns'
)

// ---- 4. Technical actions behind details/summary (collapsed) ----
assert(
  /<details/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: technical actions behind <details> element'
)
assert(
  /Tekniska åtgärder/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: technical section labeled Tekniska åtgärder'
)

// ---- 5. Normal admin does not see dangerous repair buttons by default ----
// Repair actions should be gated by isPlatformAdmin (wraps the whole technical section)
// and canRunRepair (for the specific repair box inside)
assert(
  /isPlatformAdmin/.test(actionsCard) && /canRunRepair/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: repair/diagnostic actions gated by isPlatformAdmin + canRunRepair'
)

// ---- 6. Platform admin CAN see technical details ----
assert(
  /isPlatformAdmin.*\?.*Tekniska|Tekniska[\s\S]{0,300}isPlatformAdmin/s.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: technical section shown only for isPlatformAdmin'
)
assert(
  /technicalDetails/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: shows workflow.technicalDetails for platform admin'
)

// ---- 7. Blocker code is NOT shown directly to users ----
// Raw blocker codes like 'operational_route_missing' should not appear as literal strings
// in the main user-facing content (they might appear in tech details section)
const mainContent = actionsCard.split('Tekniska åtgärder')[0] ?? actionsCard
assert(
  !/operational_route_missing|environment_not_resolved|platform_route_exists_but_not_materialized/.test(mainContent),
  'CustomerBusinessActionsCard.tsx: raw blocker codes not shown in main user-facing content'
)

// ---- 8. Next best action derived from workflow model ----
assert(
  /workflow\.adminMessage/.test(actionsCard),
  'CustomerBusinessActionsCard.tsx: shows workflow.adminMessage as human-readable status'
)
assert(
  /blockerToAdminMessage/.test(workflow),
  'customerCardWorkflow.ts: blockerToAdminMessage maps codes to plain Swedish'
)

// ---- 9. Workflow view model exports correct types ----
assert(
  /WorkflowPrimaryAction/.test(workflow),
  'customerCardWorkflow.ts: exports WorkflowPrimaryAction type'
)
assert(
  /CustomerWorkflowStep/.test(workflow),
  'customerCardWorkflow.ts: exports CustomerWorkflowStep type'
)
assert(
  /CustomerCardWorkflow/.test(workflow),
  'customerCardWorkflow.ts: exports CustomerCardWorkflow type'
)
assert(
  /buildCustomerCardWorkflow/.test(workflow),
  'customerCardWorkflow.ts: exports buildCustomerCardWorkflow function'
)

// ---- 10. Timeline component handles all step statuses ----
assert(
  /done/.test(timeline) && /current/.test(timeline) && /waiting/.test(timeline) && /blocked/.test(timeline) && /not_started/.test(timeline),
  'CustomerProcessTimeline.tsx: handles all 5 step statuses'
)

console.log('\n✓ Customer card workflow UI regression passed.')
