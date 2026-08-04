/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')

function read(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf8')
}

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
const context = read('lib/integrations/tenantContext.ts')
const provisioning = read('lib/integrations/tenantWebsiteProvisioning.ts')
const apiClientActions = read('app/admin/platform/api-clients/actions.ts')
const apiClientForm = read('app/admin/platform/api-clients/CreateApiClientForm.tsx')
const application = read('lib/website/customerApplications.ts')
const applicationWorkflow = read('lib/website/applicationWorkflow.ts')
const status = read('lib/website/customerApplicationStatus.ts')
const resolver = read('lib/customer-portal/customerResolver.ts')
const automation = read('lib/customer-operations/automation.ts')
const facility = read('lib/customer-operations/facilityResponseOrchestrator.ts')
const inbound = read('lib/ediel/flows/inboundBusinessStateMachine.ts')
const events = read('lib/events/domainEvents.ts')
const webhooks = read('lib/integrations/webhooks.ts')
const webhookCron = read('app/api/internal/webhooks/dispatch/route.ts')
const migration = read('supabase/migrations/20260804121000_multitenant_website_application_flow_completion.sql')
const docs = read('app/developers/customer-portal-api/page.tsx')
const websiteOpenApi = JSON.parse(read('docs/openapi/website-integration-v1.json'))
const releasedWebsiteOpenApi = JSON.parse(read('docs/openapi/releases/2026-08-04.1/website-integration-v1.json'))

check(route.includes('loadTenantWebsiteFlowReadiness') && route.includes('tenant_website_not_ready'), 'website application route fails closed on canonical tenant readiness')
check(route.includes('tenant_website_schema_not_ready') && route.includes('readinessStatus = schemaBlocked ? 503 : 409'), 'website application route returns 503 for database readiness drift')
for (const operation of ['api_client.execute', 'contract_channel.sell', 'customer_automation.execute', 'facility_lookup.execute', 'email.send']) {
  check(readiness.includes(operation), `tenant readiness enforces operation policy ${operation}`)
}
for (const prerequisite of [
  'public_contracts_present',
  'terms_present',
  'privacy_policy_present',
  'withdrawal_present',
  'power_of_attorney_text_present',
  'price_terms_present',
  'verified_sender_present',
  'required_email_templates_present',
  'required_email_rules_present',
  'automation_user_ready',
  'automation_cron_ready',
  'facility_operations_mailbox_ready',
  'portal_url_schema_ready',
  'portal_url_present',
]) {
  check(readiness.includes(prerequisite), `tenant readiness includes ${prerequisite}`)
}
check(readiness.includes("code: 'api_sales'") && readiness.includes("code: 'website_intake_enabled'"), 'historical and new capability vocabularies reconcile from one source')
check(readiness.includes("!blocker.code.startsWith('tenant_operation_blocked_')") && !readiness.includes('(blocker) =>\n      (blocker) =>'), 'capability prerequisite blockers exclude operation-policy feedback loops')
check(readiness.includes('customer_portal_url_schema_missing'), 'canonical readiness blocks old database schemas without customer_portal_url')
check(readiness.includes('const canonicalPortalUrl') && readiness.includes('portal_url_present: Boolean(canonicalPortalUrl)'), 'launch readiness requires the canonical tenant portal column, not branding-only fallback')
check(context.includes('readiness.complete_tenant_website_ready') && !context.includes('missingRecommendedScopes.length === 0'), 'integration context reports full readiness instead of scopes-only readiness')
check(provisioning.includes('customerPortalUrl: string') && provisioning.includes("state: 'completed' | 'blocked'"), 'provisioning requires tenant portal URL and distinguishes blocked from completed')
check(provisioning.includes('TENANT_WEBSITE_SCHEMA_NOT_READY') && !provisioning.includes('if (fallback.error)'), 'tenant portal persistence fails closed on an old database schema')
check(provisioning.indexOf('await storeTenantPortalUrl') < provisioning.indexOf("supabaseService.rpc("), 'portal schema is verified before a one-time API credential is created')
check(provisioning.includes("row.installation_state === 'failed'") && provisioning.includes('provisioning_retry_in_progress'), 'failed provisioning rotates an unrevealed credential on idempotent resume')
check(!apiClientForm.includes('defaultValue="Gridex hemsida · Mina sidor"'), 'tenant provisioning UI has no Gridex-specific client-name default')
check(provisioning.includes('visible_contract_count') && provisioning.includes('readiness.blockers'), 'launch receipt binds contract visibility and canonical readiness blockers')
check(apiClientActions.includes('reconcileAndPersistTenantWebsiteClientReadiness') && !apiClientActions.includes('launch_ready: missingRecommendedScopes.length === 0'), 'API client status and permission changes re-run canonical readiness')
check(application.includes('portal_auth_identity_required') && application.includes('portal_auth_identity_mismatch'), 'website application requires the same verified portal/auth UUID')
check(!application.includes('getBaseAppUrl() + "/login"') && !application.includes("getBaseAppUrl() + '/login'"), 'customer mail never falls back to the global OPS login')
check(application.includes('strictPortalUrl(data?.customer_portal_url)') && application.includes('strictPortalUrl(branding.customer_portal_url)'), 'customer mail resolves only a tenant-owned HTTPS portal URL')
check(resolver.includes('customer_portal_link_not_persisted') && resolver.includes('customer_portal_link_verification_failed'), 'portal account and identity linking is fail closed')
check(resolver.includes('customer_portal_identity_customer_conflict') && resolver.includes(".eq('customer_id', input.customerId)"), 'portal identities cannot be reassigned across customers within a tenant')
check(resolver.includes("str(verifiedAccount, 'status') !== 'active'") && resolver.includes('verifiedAccount.is_active !== true'), 'portal account is re-read and verified active')
check(status.includes('lineageScore') && status.includes('customer_contract_id') && status.includes('customer_site_id') && status.includes('metering_point_id'), 'status correlates switch and supply to exact application lineage')
check(status.includes("from('customer_contracts')") && status.includes('contract_status: clean(contract.status)'), 'status reads actual customer contract status')
check(status.includes('application_number,customer_number,customer_id') && status.includes('clean(application.customer_number) ?? clean(response.customer_number)'), 'status reads canonical customer_number before legacy response payload')
check(status.includes("from('customer_operation_jobs')") && status.includes("from('communication_logs')") && status.includes("from('tenant_email_outbox')"), 'status exposes continuation and canonical email delivery truth')
check(status.includes("queueStatus ?? logStatus") && status.includes("'blocked_tenant_state'") && status.includes('blocked_reason'), 'email status prefers actual outbox delivery/blocking state over stale queued logs')
check(status.includes("from('event_outbox')") && status.includes("from('webhook_deliveries')") && status.includes('fanout_status'), 'status exposes durable webhook fan-out and delivery truth')
check(status.includes("['failed', 'error'].includes(supplierSwitch)") && status.includes("['rejected', 'cancelled'].includes(supplierSwitch)"), 'supplier switch status participates in external status mapping')
check(status.includes('application_status_schema_not_ready') && !status.includes("if (schemaMissing(result.error)) return"), 'status endpoint fails closed on schema drift')
check(automation.includes('projectCustomerApplicationContinuationState') && automation.includes('resume_customer_application_continuation'), 'terminal continuation failures project to public application/workflow with resumable next action')
check(!/transitionCorrelatedCustomerApplicationWorkflow\(\{[\s\S]{0,1600}\}\)\.catch/.test(facility), 'facility workflow transition failures are not swallowed')
check(!/transitionCorrelatedCustomerApplicationWorkflow\(\{[\s\S]{0,1600}\}\)\.catch/.test(inbound), 'inbound Ediel workflow transition failures are not swallowed')
check(events.includes('ensureWebhookFanoutJob') && events.includes('processDomainEventWebhookFanout'), 'domain event webhook fan-out is durable and retryable')
check(events.includes('attemptWebhookFanoutFastPath') && events.includes('webhook fan-out deferred to cron') && events.indexOf('await ensureWebhookFanoutJob(event)') < events.indexOf('await attemptWebhookFanoutFastPath(event.id)'), 'durable webhook fan-out survives fast-path errors without failing the business operation')
check(events.includes('recoverStaleWebhookFanoutJobs') && events.includes('webhook_fanout_recovered_after_stale_processing_lock'), 'crashed webhook fan-out workers are recovered')
check(webhooks.includes('strict?: boolean') && webhooks.includes("throw new Error('webhook_schema_not_ready')"), 'durable webhook fan-out fails closed on missing schema')
check(webhookCron.includes('processDomainEventWebhookFanout'), 'webhook cron resumes fan-out before delivery dispatch')
check(applicationWorkflow.includes("eventType: 'customer_application.status_changed'") && applicationWorkflow.includes("eventType: 'supplier_switch.updated'"), 'every durable workflow transition emits the canonical tenant status events')
check(applicationWorkflow.includes('SWITCH_WORKFLOW_STATES.has(input.state)') && applicationWorkflow.includes('supplier_switch_status: input.state'), 'switch and supply states emit supplier_switch.updated with their actual workflow status')
check(applicationWorkflow.includes('customer-application-status:') && applicationWorkflow.includes('supplier-switch-status:') && applicationWorkflow.includes('workflowVersion: result.workflowVersion'), 'canonical workflow webhook events are idempotent per applied transition')
check(applicationWorkflow.includes('transition-RPC saknas') && !applicationWorkflow.includes('Compatibility fallback for environments where the new transition RPC'), 'workflow transitions fail closed when the database RPC is missing')
check(application.includes('resumeCommittedIdempotentApplication') && application.includes('resumed_from_failed_or_partial'), 'failed/partial committed applications resume without recreating the customer graph')
check(migration.includes('customer_portal_url') && migration.includes('portal_identity_required'), 'database stores tenant portal URL and enforces portal identity requirement')
check(migration.includes('gridex_project_terminal_application_continuation') && migration.includes('event_outbox_webhook_fanout_due_idx'), 'database adds terminal projection safety and webhook fan-out index')
check(migration.includes('canonical_readiness_revalidation_required') && migration.includes("profile_key = 'tenant_website'"), 'migration invalidates historical scopes-only launch flags')
check(docs.includes('# accepted betyder att canonical') && docs.includes('fortsätter asynkront'), 'developer documentation defines accepted as durable commit plus asynchronous continuation')
check(websiteOpenApi.info.version === '2026-08-04.1', 'website OpenAPI version is 2026-08-04.1')
check(docs.includes('customer_application.status_changed') && docs.includes('supplier_switch.updated'), 'developer documentation promises the two canonical tenant status events that runtime emits')
check(Boolean(websiteOpenApi.webhooks.customerApplicationStatusChanged) && Boolean(websiteOpenApi.webhooks.supplierSwitchUpdated), 'OpenAPI publishes customer-application and supplier-switch webhook callbacks')
check(JSON.stringify(websiteOpenApi) === JSON.stringify(releasedWebsiteOpenApi), 'immutable 2026-08-04.1 website OpenAPI release matches the current published contract')
const request = websiteOpenApi.components.schemas.CustomerApplicationRequest
check(request.required.includes('auth_user_id') && request.required.includes('customer_portal_user_id'), 'OpenAPI requires both portal identity fields')
const statusSchema = websiteOpenApi.components.schemas.WebsiteCustomerApplicationStatusData
for (const property of ['automation', 'communication', 'webhook']) {
  check(Boolean(statusSchema.properties[property]), `OpenAPI status includes ${property}`)
}
check(![readiness, provisioning, status, resolver].some((source) => /tenant_60de87|b3ad1bf6-fa45|gridex\.se\/mina-sidor/i.test(source)), 'canonical flow contains no Gridex tenant ID or domain special case')

if (failures > 0) {
  console.error(`Multitenant website application flow regression failed: ${failures} check(s).`)
  process.exit(1)
}
console.log('Multitenant website application flow regression passed.')
