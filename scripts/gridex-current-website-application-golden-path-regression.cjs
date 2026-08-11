const fs = require('node:fs')
const path = require('node:path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
let failures = 0
function check(condition, message) {
  if (!condition) {
    failures += 1
    console.error(`FAIL: ${message}`)
  } else {
    console.log(`OK: ${message}`)
  }
}

const route = read('app/api/v1/website/customer-applications/route.ts')
const readiness = read('lib/integrations/tenantWebsiteReadiness.ts')
const provisioning = read('lib/integrations/tenantWebsiteProvisioning.ts')
const applicationProcess = read('lib/website/customerApplicationProcess.ts')
const persistence = read('lib/website/customerApplicationPersistence.ts')
const communication = read('lib/website/customerApplicationCommunication.ts')
const resolver = read('lib/customer-portal/customerResolver.ts')
const status = read('lib/website/customerApplicationStatus.ts')
const workflow = read('lib/website/applicationWorkflow.ts')
const events = read('lib/events/domainEvents.ts')
const preAuthMigration = read('supabase/migrations/20260804151500_website_application_pre_auth_contract_alignment.sql')
const completionMigration = read('supabase/migrations/20260804121000_multitenant_website_application_flow_completion.sql')
const openapi = JSON.parse(read('docs/openapi/website-integration-v1.json'))

const provisionStart = provisioning.indexOf('export async function provisionTenantWebsiteIntegration')
const provisionBody = provisionStart >= 0 ? provisioning.slice(provisionStart) : ''

check(
  route.includes('loadTenantWebsiteFlowReadiness') && route.includes('tenant_website_not_ready'),
  'website application route fails closed on canonical tenant readiness',
)
check(
  readiness.includes('customer_portal_url_schema_missing') && readiness.includes('portal_url_present'),
  'tenant readiness requires canonical portal schema and URL',
)
check(
  provisionBody.indexOf('await storeTenantPortalUrl') >= 0 &&
    provisionBody.indexOf('await storeTenantPortalUrl') < provisionBody.indexOf("supabaseService.rpc("),
  'portal schema is verified before a one-time API credential is created',
)
check(
  applicationProcess.includes('portal_auth_identity_required') && applicationProcess.includes('portal_auth_identity_mismatch') &&
    applicationProcess.includes('authUserId !== customerPortalUserId'),
  'website application requires the same verified portal/auth UUID',
)
check(
  (persistence.match(/portal_identity_required:\s*true/g) ?? []).length >= 2,
  'reservation and committed application rows both persist portal identity enforcement',
)
check(
  communication.includes('strictPortalUrl') && communication.includes('customer_portal_url') &&
    !communication.includes('getBaseAppUrl() + "/login"') && !communication.includes("getBaseAppUrl() + '/login'"),
  'customer mail resolves only a tenant-owned HTTPS portal URL',
)
check(
  persistence.includes('export async function resumeCommittedIdempotentApplication') &&
    persistence.includes('resumed_from_failed_or_partial') &&
    persistence.includes('commitApplicationProvisioning'),
  'failed or partial committed applications resume without recreating the customer graph',
)
check(
  resolver.includes('customer_portal_link_not_persisted') && resolver.includes('customer_portal_link_verification_failed') &&
    resolver.includes('customer_portal_identity_customer_conflict'),
  'portal account and identity linking fails closed and is tenant/customer bound',
)
check(
  status.includes("from('customer_contracts')") && status.includes("from('customer_operation_jobs')") &&
    status.includes("from('event_outbox')") && status.includes("from('webhook_deliveries')"),
  'status endpoint reads canonical contract, continuation and webhook truth',
)
check(
  workflow.includes("eventType: 'customer_application.status_changed'") &&
    workflow.includes("eventType: 'supplier_switch.updated'") &&
    workflow.includes('workflowVersion: result.workflowVersion'),
  'durable workflow transitions emit idempotent canonical tenant status events',
)
check(
  events.includes('ensureWebhookFanoutJob') && events.includes('processDomainEventWebhookFanout') &&
    events.includes('recoverStaleWebhookFanoutJobs'),
  'domain event webhook fan-out is durable, retryable and stale-lock recoverable',
)
check(
  preAuthMigration.includes('alter column portal_identity_required set default true') &&
    preAuthMigration.includes('portal_auth_identity_downgrade_forbidden'),
  'database makes portal pre-auth mandatory and prevents downgrade',
)
check(
  completionMigration.includes('customer_portal_url') && completionMigration.includes('portal_identity_required') &&
    completionMigration.includes('event_outbox_webhook_fanout_due_idx'),
  'database migration persists portal identity and durable webhook fan-out',
)
const request = openapi.components.schemas.CustomerApplicationRequest
check(
  request.required.includes('auth_user_id') && request.required.includes('customer_portal_user_id'),
  'published OpenAPI requires both portal identity fields',
)
check(
  ![readiness, provisioning, applicationProcess, persistence, communication, status, resolver]
    .some((source) => /tenant_60de87|b3ad1bf6-fa45|gridex\.se\/mina-sidor/i.test(source)),
  'canonical website application flow contains no Gridex tenant/domain special case',
)

if (failures > 0) {
  console.error(`Current website application golden-path regression failed: ${failures} check(s).`)
  process.exit(1)
}
console.log('Current website application golden-path regression passed (15/15 checks).')
