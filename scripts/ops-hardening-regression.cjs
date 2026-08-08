const fs = require('fs')
const path = require('path')

function read(relative) {
  return fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
}
function assertIncludes(relative, token) {
  if (!read(relative).includes(token)) throw new Error(`${relative} is missing ${token}`)
}

const checks = [
  ['lib/opsMaster/readiness.ts', 'Documents are evidence only'],
  ['lib/opsMaster/readiness.ts', 'routeReadyBySiteId'],
  ['lib/customer-operations/automation.ts', 'site_address_changed_after_operation_started'],
  ['lib/customer-operations/automation.ts', 'customer_operation_request_snapshots'],
  ['supabase/migrations/20260802160000_website_application_committed_canonical_event.sql', 'WEBSITE_APPLICATION_COMMITTED'],
  ['lib/email/emailOutbox.ts', 'delivery_uncertain'],
  ['app/api/internal/email/outbox/process/route.ts', 'timingSafeEqual'],
  ['app/api/internal/webhooks/dispatch/route.ts', 'timingSafeEqual'],
  ['lib/ops/health.ts', 'gridex_ops_health_checks'],
  ['supabase/migrations/20260618213000_ops_completion_workflows_health.sql', 'gridex_ops_health_checks'],
  ['supabase/migrations/20260618213000_ops_completion_workflows_health.sql', 'customer_sites_invalidate_operations_on_address_change'],
  ['supabase/migrations/20260618213000_ops_completion_workflows_health.sql', 'gridex_commit_customer_site_address'],
  ['lib/customer-sites/addressIntake.ts', 'gridex_commit_customer_site_address'],
  ['lib/website/applicationWorkflow.ts', 'customer_application_workflows'],
  ['lib/website/customerApplicationShared.ts', 'application_workflow_transition'],
  ['lib/integrations/webhooks.ts', 'finalizeClaimedDelivery'],
  ['lib/energy/svkGeometryImport.ts', 'runSvkGeometryImport'],
  ['app/api/internal/platform/grid-areas/import/cron/route.ts', 'svk_import_resume_failed'],
]
for (const [file, token] of checks) assertIncludes(file, token)
console.log(`OPS hardening regression passed (${checks.length} checks).`)
