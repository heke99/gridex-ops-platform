#!/usr/bin/env node
const fs = require('node:fs')

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function write(path, value) {
  fs.writeFileSync(path, value)
}

function replaceOnce(source, before, after, label) {
  const first = source.indexOf(before)
  if (first < 0) throw new Error(`Missing patch anchor: ${label}`)
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Ambiguous patch anchor: ${label}`)
  }
  return source.slice(0, first) + after + source.slice(first + before.length)
}

function patchCustomerApplicationStatus() {
  const path = 'lib/website/customerApplicationStatus.ts'
  let source = read(path)
  source = replaceOnce(
    source,
    "import { supabaseService } from '@/lib/supabase/service'\n",
    "import { supabaseService } from '@/lib/supabase/service'\nimport { buildTenantCheckoutResult } from '@/lib/website/publicCheckoutResult'\n",
    'customer status import',
  )
  source = replaceOnce(
    source,
    ".from('customer_contracts').select('status,updated_at')",
    ".from('customer_contracts').select('status,contract_number,signed_at,withdrawal_deadline_at,signature_snapshot_sha256,updated_at')",
    'customer status contract projection',
  )
  source = replaceOnce(
    source,
    "  const workflowFailure = clean(workflow?.failure_code)\n\n  return {\n",
    "  const workflowFailure = clean(workflow?.failure_code)\n  const communication = summarizeCommunication(communicationLogs, outbox)\n  const checkout = buildTenantCheckoutResult({\n    applicationNumber: application.application_number,\n    applicationStatus: externalStatus,\n    contractNumber: contract.contract_number,\n    contractStatus: contract.status,\n    signedAt: contract.signed_at,\n    withdrawalDeadlineAt: contract.withdrawal_deadline_at,\n    signatureSnapshotSha256: contract.signature_snapshot_sha256,\n    canSendAgreementConfirmation: ['signed', 'active'].includes(clean(contract.status) ?? ''),\n    communication,\n    automationStatus: clean(job?.status),\n    missingCustomerAction: externalStatus === 'needs_customer_information',\n    nextStep: clean(workflow?.next_action) ?? clean(application.next_step),\n  })\n\n  return {\n",
    'customer status checkout projection',
  )
  source = replaceOnce(
    source,
    "    customer_number: clean(application.customer_number) ?? clean(response.customer_number),\n    contract_status: clean(contract.status),\n",
    "    customer_number: clean(application.customer_number) ?? clean(response.customer_number),\n    contract_number: clean(contract.contract_number),\n    contract_status: clean(contract.status),\n    signed_at: clean(contract.signed_at),\n    withdrawal_deadline_at: clean(contract.withdrawal_deadline_at),\n    signature_snapshot_sha256: clean(contract.signature_snapshot_sha256),\n",
    'customer status agreement fields',
  )
  source = replaceOnce(
    source,
    "    communication: summarizeCommunication(communicationLogs, outbox),\n",
    "    communication,\n    checkout,\n",
    'customer status communication checkout',
  )
  write(path, source)
}

function patchApiAuthLogging() {
  const path = 'lib/integrations/apiAuth.ts'
  let source = read(path)
  source = replaceOnce(
    source,
    "import type { NextRequest } from 'next/server'\n",
    "import { after, type NextRequest } from 'next/server'\n",
    'api auth next/server import',
  )
  const before = `export async function logIntegrationApiRequest(input: {\n  client?: IntegrationApiClient | null\n  request: NextRequest\n  statusCode: number\n  startedAt: number\n  errorCode?: string | null\n  metadata?: Record<string, unknown>\n}) {\n  // Anonymous 401 traffic has no tenant-safe persistence target. Skipping the\n  // database write also prevents unauthenticated requests from turning an\n  // integration-database outage into a slow public endpoint.\n  if (!input.client && input.statusCode === 401) return\n\n  const route = input.request.nextUrl.pathname\n\n  await supabaseService\n    .from('integration_api_requests')\n    .insert({\n      company_id: input.client?.company_id ?? null,\n      api_client_id: input.client?.id ?? null,\n      request_id: input.request.headers.get('x-request-id'),\n      method: input.request.method,\n      route,\n      status_code: input.statusCode,\n      duration_ms: Math.max(0, Date.now() - input.startedAt),\n      ip_address: requestIp(input.request),\n      user_agent: input.request.headers.get('user-agent'),\n      idempotency_key: input.request.headers.get('idempotency-key'),\n      error_code: input.errorCode ?? null,\n      metadata: input.metadata ?? {},\n    })\n    .then(() => null)\n}`
  const afterValue = `export async function logIntegrationApiRequest(input: {\n  client?: IntegrationApiClient | null\n  request: NextRequest\n  statusCode: number\n  startedAt: number\n  errorCode?: string | null\n  metadata?: Record<string, unknown>\n}) {\n  // Anonymous 401 traffic has no tenant-safe persistence target. Skipping the\n  // database write also prevents unauthenticated requests from turning an\n  // integration-database outage into a slow public endpoint.\n  if (!input.client && input.statusCode === 401) return\n\n  const payload = {\n    company_id: input.client?.company_id ?? null,\n    api_client_id: input.client?.id ?? null,\n    request_id: input.request.headers.get('x-request-id'),\n    method: input.request.method,\n    route: input.request.nextUrl.pathname,\n    status_code: input.statusCode,\n    duration_ms: Math.max(0, Date.now() - input.startedAt),\n    ip_address: requestIp(input.request),\n    user_agent: input.request.headers.get('user-agent'),\n    idempotency_key: input.request.headers.get('idempotency-key'),\n    error_code: input.errorCode ?? null,\n    metadata: input.metadata ?? {},\n  }\n\n  const persist = async () => {\n    await supabaseService\n      .from('integration_api_requests')\n      .insert(payload)\n      .then(() => null)\n  }\n\n  // API audit/telemetry is secondary to the tenant response. Next.js after()\n  // keeps the serverless invocation alive while the write completes, without\n  // adding the PostgREST insert latency to every public API request. If this\n  // helper is invoked outside a request context (for example a direct unit\n  // test), fall back to the previous awaited persistence semantics.\n  try {\n    after(persist)\n  } catch {\n    await persist()\n  }\n}`
  source = replaceOnce(source, before, afterValue, 'api request logging after()')
  write(path, source)
}

function patchDomainEventFanout() {
  const path = 'lib/events/domainEvents.ts'
  let source = read(path)
  const before = `async function ensureWebhookFanoutJob(event: DomainEventRow) {\n  const destinationKey = 'webhook_fanout_v1'\n  const existing = await supabaseService\n    .from('event_outbox')\n    .select('id')\n    .eq('domain_event_id', event.id)\n    .eq('destination_type', 'webhook')\n    .eq('destination_key', destinationKey)\n    .maybeSingle()\n  if (existing.error) throw existing.error\n  if (existing.data?.id) return String(existing.data.id)\n\n  const { data, error } = await supabaseService\n    .from('event_outbox')\n    .insert({\n      company_id: event.company_id,\n      domain_event_id: event.id,\n      destination_type: 'webhook',\n      destination_key: destinationKey,\n      status: 'queued',\n      attempts: 0,\n      max_attempts: 12,\n      available_at: new Date().toISOString(),\n      payload: { event_type: event.event_type, aggregate_type: event.aggregate_type, aggregate_id: event.aggregate_id },\n    })\n    .select('id')\n    .single()\n  if (error?.code === '23505') return null\n  if (error) throw error\n  return String(data.id)\n}`
  const afterValue = `async function ensureWebhookFanoutJob(event: DomainEventRow) {\n  const destinationKey = 'webhook_fanout_v1'\n  // The outbox already has a uniqueness invariant for one destination per\n  // domain event. Insert optimistically and treat 23505 as the idempotent\n  // replay path instead of paying for a read-before-write round trip.\n  const { data, error } = await supabaseService\n    .from('event_outbox')\n    .insert({\n      company_id: event.company_id,\n      domain_event_id: event.id,\n      destination_type: 'webhook',\n      destination_key: destinationKey,\n      status: 'queued',\n      attempts: 0,\n      max_attempts: 12,\n      available_at: new Date().toISOString(),\n      payload: { event_type: event.event_type, aggregate_type: event.aggregate_type, aggregate_id: event.aggregate_id },\n    })\n    .select('id')\n    .single()\n  if (error?.code === '23505') return null\n  if (error) throw error\n  return String(data.id)\n}`
  source = replaceOnce(source, before, afterValue, 'webhook outbox optimistic insert')
  write(path, source)
}

function patchContractVersion() {
  const path = 'lib/integrations/websiteIntegrationContract.ts'
  let source = read(path)
  source = replaceOnce(source, "'2026-08-14.1' as const", "'2026-08-19.1' as const", 'website contract version')
  source = replaceOnce(
    source,
    `export const API_COMPATIBILITY_CLASSIFICATION = {\n  release: 'additive-public-boundary-and-tenant-remediation',\n  website: 'additive-public-boundary-and-tenant-remediation',\n  customerPortal: 'additive-public-boundary-and-tenant-remediation',\n} as const`,
    `export const API_COMPATIBILITY_CLASSIFICATION = {\n  release: 'backward-compatible',\n  website: 'backward-compatible',\n  customerPortal: 'backward-compatible',\n} as const`,
    'compatibility classification',
  )
  write(path, source)

  const manifestPath = 'lib/integrations/openApiReleaseManifest.ts'
  let manifest = read(manifestPath)
  manifest = replaceOnce(
    manifest,
    "export const OPENAPI_RELEASED_AT = '2026-08-14T18:26:00.000Z' as const",
    "export const OPENAPI_RELEASED_AT = '2026-08-19T11:20:00.000Z' as const",
    'OpenAPI released at',
  )
  write(manifestPath, manifest)
}

function patchOpenApiFinalizer() {
  const path = 'scripts/finalize-openapi-release.cjs'
  let source = read(path)
  source = replaceOnce(source, "const version = '2026-08-14.1'", "const version = '2026-08-19.1'", 'OpenAPI finalizer version')
  source = replaceOnce(source, "const priorVersion = '2026-08-10.1'", "const priorVersion = '2026-08-14.1'", 'OpenAPI prior version')
  source = replaceOnce(
    source,
    "const publishedVersions = ['2026-08-02.1', '2026-08-03.1', '2026-08-04.3', '2026-08-05.1', '2026-08-05.2', priorVersion, version]",
    "const publishedVersions = ['2026-08-02.1', '2026-08-03.1', '2026-08-04.3', '2026-08-05.1', '2026-08-05.2', '2026-08-10.1', priorVersion, version]",
    'OpenAPI published versions',
  )
  source = replaceOnce(
    source,
    "  'customer_id', 'application_id', 'customer_site_id', 'metering_point_id',\n  'contract_id', 'workflow_id', 'continuation_job_id', 'site_id', 'resolution_id',\n]) delete websiteApplicationData.properties[internalField]",
    "  'customer_id', 'application_id', 'customer_site_id', 'metering_point_id',\n  'contract_id', 'workflow_id', 'continuation_job_id', 'site_id', 'resolution_id',\n]) delete websiteApplicationData.properties[internalField]",
    'OpenAPI application cleanup anchor',
  )

  const checkoutSchema = `const checkoutAgreementStatus = closedObject({\n  status: nullableString,\n  contract_number: nullableString,\n  signed_at: nullableString,\n  withdrawal_deadline_at: nullableString,\n  signature_snapshot_sha256: nullableString,\n}, ['status', 'contract_number', 'signed_at', 'withdrawal_deadline_at', 'signature_snapshot_sha256'])\nconst checkoutConfirmationEmailStatus = closedObject({\n  expected: { type: 'boolean' },\n  status: { type: 'string', enum: ['not_expected', 'pending', 'queued', 'sent', 'delivered', 'failed'] },\n}, ['expected', 'status'])\nwebsite.components.schemas.WebsiteCheckoutResult = closedObject({\n  outcome: { type: 'string', enum: ['agreement_signed', 'customer_action_required', 'application_received'] },\n  thank_you_ready: { type: 'boolean' },\n  page_state: { type: 'string', enum: ['success', 'success_action_required', 'action_required', 'processing'] },\n  customer_action_required: { type: 'boolean' },\n  application: closedObject({\n    application_number: nullableString,\n    status: nullableString,\n  }, ['application_number', 'status']),\n  agreement: checkoutAgreementStatus,\n  confirmation_email: checkoutConfirmationEmailStatus,\n  status_path: nullableString,\n}, [\n  'outcome', 'thank_you_ready', 'page_state', 'customer_action_required',\n  'application', 'agreement', 'confirmation_email', 'status_path',\n])\n`
  source = replaceOnce(
    source,
    "const websiteApplicationData = website.components.schemas.WebsiteCustomerApplicationData\n",
    `${checkoutSchema}const websiteApplicationData = website.components.schemas.WebsiteCustomerApplicationData\n`,
    'OpenAPI checkout schema insertion',
  )
  source = replaceOnce(
    source,
    "  supplier_switch: closedObject({\n",
    "  checkout: { $ref: '#/components/schemas/WebsiteCheckoutResult' },\n  supplier_switch: closedObject({\n",
    'OpenAPI create checkout property',
  )
  source = replaceOnce(
    source,
    "  'application_number',\n  'supplier_switch',\n]))",
    "  'application_number',\n  'checkout',\n  'supplier_switch',\n]))",
    'OpenAPI create checkout required',
  )
  source = replaceOnce(
    source,
    "    'Scope: website_applications.write. Idempotency-Key krävs. Tenant härleds enbart från API-nyckeln. auth_user_id och customer_portal_user_id krävs som samma verifierade UUID. OPS committar canonical kund, kundnummer, site/mätpunkt, avtal, juridik, portalidentitet, workflow och ett beständigt customer_application_continuation-jobb. status=accepted betyder att denna beständiga commit är klar; e-post, anläggningsuppslag, leverantörsbyte och webhooks fortsätter asynkront och följs via statusendpointen.'",
    "    'Scope: website_applications.write. Idempotency-Key krävs. Tenant härleds enbart från API-nyckeln. auth_user_id och customer_portal_user_id krävs som samma verifierade UUID. OPS committar canonical kund, kundnummer, site/mätpunkt, avtal, juridik, portalidentitet, workflow och ett beständigt customer_application_continuation-jobb. data.checkout är tenantens enda maskinläsbara sanning för tack-sidan: thank_you_ready=true betyder att avtalet faktiskt är signerat och kan visas som tecknat. confirmation_email.status visar separat om avtalsbekräftelsen är pending, queued, sent, delivered eller failed. E-post, anläggningsuppslag, leverantörsbyte och webhooks fortsätter asynkront och följs via statusendpointen.'",
    'OpenAPI application POST semantics',
  )
  source = replaceOnce(
    source,
    "  source_of_truth: { type: 'string', const: 'communication_logs' },",
    "  source_of_truth: { type: 'string', const: 'tenant_email_outbox+communication_logs' },",
    'OpenAPI communication source of truth',
  )
  source = replaceOnce(
    source,
    "  customer_number: nullableString,\n  contract_status: nullableString,\n",
    "  customer_number: nullableString,\n  contract_number: nullableString,\n  contract_status: nullableString,\n  signed_at: nullableString,\n  withdrawal_deadline_at: nullableString,\n  signature_snapshot_sha256: nullableString,\n",
    'OpenAPI status agreement fields',
  )
  source = replaceOnce(
    source,
    "  communication: applicationCommunicationStatus,\n  webhook: applicationWebhookStatus,",
    "  communication: applicationCommunicationStatus,\n  checkout: { $ref: '#/components/schemas/WebsiteCheckoutResult' },\n  webhook: applicationWebhookStatus,",
    'OpenAPI status checkout property',
  )
  source = replaceOnce(
    source,
    "  'missing_customer_action', 'automation', 'communication', 'webhook',\n]",
    "  'missing_customer_action', 'automation', 'communication', 'checkout', 'webhook',\n]",
    'OpenAPI status checkout required',
  )
  write(path, source)
}

patchCustomerApplicationStatus()
patchApiAuthLogging()
patchDomainEventFanout()
patchContractVersion()
patchOpenApiFinalizer()
console.log('Tenant API checkout remediation source patches applied.')
