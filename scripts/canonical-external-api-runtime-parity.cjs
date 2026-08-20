#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { currentContractVersion, currentReleasePath } = require('./lib/current-api-contract.cjs')

const root = path.resolve(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const json = (relative) => JSON.parse(read(relative))

let failed = 0
function check(condition, message) {
  if (condition) {
    console.log(`PASS ${message}`)
  } else {
    failed += 1
    console.error(`FAIL ${message}`)
  }
}

const version = currentContractVersion
const website = json('docs/openapi/website-integration-v1.json')
const portal = json('docs/openapi/customer-portal-v1.json')
const appStatus = read('lib/website/customerApplicationStatus.ts')
const appStatusRoute = read('app/api/v1/website/customer-applications/[applicationId]/route.ts')
const appPublicDto = read('lib/website/publicCustomerApplication.ts')
const externalApi = read('lib/customer-portal/externalApi.ts')
const apiAuth = read('lib/integrations/apiAuth.ts')
const profileContract = read('lib/customer-portal/profileUpdateContract.ts')
const profileRoute = read('app/api/v1/customer/profile-update/route.ts')
const notificationRoute = read('app/api/v1/customer/notifications/read/route.ts')
const eventService = read('lib/customer-portal/customerEvents.ts')
const websiteEventsRoute = read('app/api/v1/website/customer-events/route.ts')
const eventsRoute = read('app/api/v1/events/route.ts')
const legalRoute = read('app/api/v1/website/legal-bundle/route.ts')
const quoteValidationRoute = read('app/api/v1/website/quote/validate/route.ts')
const tenantContext = read('lib/integrations/tenantContext.ts')
const integrationContextRoute = read('app/api/v1/integration/context/route.ts')
const projectionStart = tenantContext.indexOf('export function projectPublicExternalTenantContext')
const projectionEnd = tenantContext.indexOf('export async function loadExternalTenantReference', projectionStart)
const publicContextProjection = projectionStart >= 0 && projectionEnd > projectionStart
  ? tenantContext.slice(projectionStart, projectionEnd)
  : ''

check(website.info.version === version && portal.info.version === version, 'both public OpenAPI documents use one canonical release version')
check(
  integrationContextRoute.includes('projectPublicExternalTenantContext('),
  'integration context route projects the internal readiness object to the public OpenAPI DTO',
)
for (const internalField of [
  'portal_identity_required', 'portal_url', 'webhook_delivery_ready',
  'status_delivery_modes', 'blockers', 'warnings', 'checks',
]) {
  check(
    !publicContextProjection.includes(`${internalField}:`),
    `integration context public projection excludes internal field ${internalField}`,
  )
}
check(
  website.paths['/api/v1/website/customer-applications/{application_number}']?.get,
  'website application status is documented by public application_number',
)
check(
  appStatus.includes(".eq('company_id', input.companyId)") &&
    appStatus.includes(".eq('application_number', input.applicationNumber)"),
  'application status lookup is tenant-bound and uses application_number',
)
check(
  appStatusRoute.includes('applicationNumber') && !appStatusRoute.includes("eq('id'"),
  'status HTTP route never treats the public path value as an internal database UUID',
)
check(
  !appStatusRoute.includes('meta:') && appStatusRoute.includes('correlation_id: requestId'),
  'application status response matches the closed public envelope without undocumented metadata',
)
const quoteValidationSchema = website.components.schemas.QuoteValidationRequest
check(
  quoteValidationSchema?.properties?.application_number &&
    !quoteValidationSchema?.properties?.application_id &&
    quoteValidationRoute.includes(".eq('company_id', input.companyId)") &&
    quoteValidationRoute.includes(".eq('application_number', input.applicationNumber)"),
  'quote validation accepts application_number and resolves its internal relation inside the authenticated tenant',
)
const applicationSchema = website.components.schemas.WebsiteCustomerApplicationData
const applicationProperties = applicationSchema?.properties ?? {}
check(applicationSchema?.required?.includes('application_number'), 'application create response requires application_number')
for (const internalField of [
  'customer_id', 'application_id', 'customer_site_id', 'metering_point_id',
  'contract_id', 'workflow_id', 'continuation_job_id', 'site_id', 'resolution_id',
]) {
  check(!(internalField in applicationProperties), `website application DTO does not publish internal field ${internalField}`)
}
check(
  ['customer_reference', 'application_reference', 'facility_reference', 'metering_point_reference', 'contract_reference']
    .every((key) => key in applicationProperties),
  'website application DTO publishes tenant-bound external resource references',
)
check(
  appPublicDto.includes('request_reference') && !appPublicDto.includes('request_id: internalRequestId'),
  'supplier-switch application projection does not expose a raw request UUID',
)

for (const schemaName of ['ErrorEnvelope', 'ApiError', 'ErrorResponse', 'MarketPriceErrorEnvelope']) {
  const schema = website.components.schemas[schemaName] ?? portal.components.schemas[schemaName]
  if (!schema) continue
  check(
    schema.additionalProperties === false &&
      ['error', 'request_id', 'correlation_id', 'contract_schema_version'].every((field) => schema.required?.includes(field)),
    `${schemaName} uses the closed canonical error envelope`,
  )
  check(
    ['code', 'message', 'retryable', 'field', 'blockers'].every((field) => schema.properties?.error?.required?.includes(field)),
    `${schemaName} requires canonical nested error details`,
  )
}
check(externalApi.includes("if (!headers.has('Cache-Control'))"), 'shared response helper preserves explicit route cache policy')
check(externalApi.includes("headers.set('X-Request-ID'"), 'shared response helper returns X-Request-ID')
check(
  externalApi.includes("headers.set('X-RateLimit-Limit'") &&
    externalApi.includes("headers.set('X-RateLimit-Remaining'") &&
    externalApi.includes("headers.set('X-RateLimit-Reset'") &&
    externalApi.includes("headers.set('Retry-After'"),
  'shared response helper returns canonical rate-limit headers',
)
check(apiAuth.includes('anyOf?: readonly string[]') && apiAuth.includes('anyOf.some'), 'integration auth supports explicit OR scope requirements')

const profileOperation = portal.paths['/api/v1/customer/profile-update']?.post
check(profileOperation?.['x-scope-mode']?.startsWith('any-per-request'), 'profile-update documents operation-dependent OR scope semantics')
check(
  profileRoute.includes("anyOf: ['customer_contact.write', 'customer_facility_data.write']") &&
    profileRoute.includes('missingIntegrationApiScopes'),
  'profile-update requires the relevant scope and both scopes when both mutations are submitted',
)
check(
  profileContract.includes('profileSchema') && profileContract.includes('facilityDataSchema') && profileContract.includes('.strict()'),
  'profile-update runtime uses a closed operation-specific request contract',
)
check(
  portal.components.schemas.CustomerProfile?.minProperties === 1 &&
    portal.components.schemas.CustomerFacilityUpdate?.properties?.address?.minProperties === 1,
  'profile and facility address updates reject empty mutation objects in OpenAPI',
)
check(
  profileRoute.includes(".eq('company_id', input.companyId)") && profileRoute.includes(".eq('customer_id', input.customerId)"),
  'profile and facility writes remain tenant/customer scoped',
)

const notificationRequest = portal.components.schemas.CustomerNotificationReadRequest
check(notificationRequest?.required?.includes('notification_references'), 'notification read request has one canonical notification_references field')
check(notificationRoute.includes('payload.notification_references'), 'notification runtime reads the documented notification_references field')
check(notificationRoute.includes('executeIdempotentPortalWrite'), 'notification write requires durable tenant-bound idempotency')
check(
  notificationRoute.includes('notification_references: references') &&
    !notificationRoute.includes('data: data ?? []') &&
    portal.components.schemas.CustomerNotificationReadData?.required?.includes('updated_count'),
  'notification runtime response matches the operation-specific OpenAPI data object',
)

const canonicalEventRequest = portal.components.schemas.CustomerEventRequest
check(
  canonicalEventRequest?.required?.includes('event_reference') && canonicalEventRequest?.required?.includes('subject'),
  'customer event POST uses one closed canonical event request schema',
)
check(eventService.includes('executeIdempotentPortalWrite') && eventService.includes('requireIdempotencyKey'), 'event writes require durable idempotency and payload conflict detection')
check(websiteEventsRoute.includes("operation: '/api/v1/website/customer-events'"), 'website event route uses the canonical event service')
const websiteEventParameters = website.paths['/api/v1/website/customer-events']?.post?.parameters ?? []
check(
  websiteEventParameters.some((parameter) => parameter.$ref === '#/components/parameters/IdempotencyKey'),
  'website customer-event OpenAPI requires Idempotency-Key',
)
check(eventsRoute.includes("operation: '/api/v1/events'"), 'partner event route uses the same canonical event service')
check(eventsRoute.includes('customerPortalJson({') && eventsRoute.includes('next_before:'), 'event list returns the canonical versioned response envelope')
check(!eventsRoute.includes("singleQueryValue(request, 'customer_id')"), 'event list does not accept an internal customer_id query parameter')
const eventGetParameters = portal.paths['/api/v1/events']?.get?.parameters ?? []
check(eventGetParameters.some((parameter) => parameter.name === 'external_customer_id'), 'event list documents external_customer_id filtering')
check(!eventGetParameters.some((parameter) => parameter.name === 'customer_id'), 'event list OpenAPI does not expose internal customer_id filtering')
check(
  new Set(eventGetParameters.map((parameter) => parameter.$ref ?? `${parameter.in}:${parameter.name}`)).size === eventGetParameters.length,
  'event list OpenAPI contains no duplicate parameters after repeatable generation',
)

const legalOperation = website.paths['/api/v1/website/legal-bundle']?.get
check(legalOperation?.['x-scope-mode'] === 'any', 'legal bundle OpenAPI declares alternative scopes explicitly')
check(
  legalRoute.includes("anyOf: ['website_legal.read', 'website_contracts.read']"),
  'legal bundle runtime accepts either documented read scope',
)

for (const [documentName, document] of [['website', website], ['customer portal', portal]]) {
  for (const [route, item] of Object.entries(document.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const operation = item?.[method]
      if (!operation) continue
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        if (!String(status).match(/^(2\d\d|4\d\d|5\d\d)$/)) continue
        const effectiveResponse = response?.$ref?.startsWith('#/components/responses/')
          ? document.components?.responses?.[response.$ref.split('/').at(-1)]
          : response
        const headers = effectiveResponse?.headers ?? {}
        if (String(status).match(/^[45]\d\d$/)) {
          const errorSchema = effectiveResponse?.content?.['application/json']?.schema
          check(
            errorSchema?.$ref === '#/components/schemas/ErrorEnvelope',
            `${documentName} ${method.toUpperCase()} ${route} ${status} uses the canonical error envelope`,
          )
        }
        check(Boolean(headers['X-Gridex-Contract-Version']), `${documentName} ${method.toUpperCase()} ${route} ${status} documents contract-version header`)
        check(Boolean(headers['X-Request-ID']), `${documentName} ${method.toUpperCase()} ${route} ${status} documents request-id header`)
      }
    }
  }
}

if (failed > 0) {
  console.error(`\nCanonical external API runtime/OpenAPI parity failed with ${failed} error(s).`)
  process.exit(1)
}
console.log('\nCanonical external API runtime/OpenAPI parity passed.')
