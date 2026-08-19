#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function write(file, value) {
  fs.writeFileSync(file, value)
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source
  if (!source.includes(from)) throw new Error(`Missing expected source for ${label}`)
  return source.replace(from, to)
}

function replaceAll(source, from, to) {
  return source.split(from).join(to)
}

function edit(file, transform) {
  const before = read(file)
  const after = transform(before)
  if (after === before) console.log(`${file}: already up to date`)
  else {
    write(file, after)
    console.log(`${file}: updated`)
  }
}

// Release version and repeatable OpenAPI finalization pipeline.
edit('scripts/finalize-openapi-release.cjs', (source) => {
  source = replaceRequired(source, "const version = '2026-08-19.1'", "const version = '2026-08-19.2'", 'OpenAPI release version')
  source = replaceRequired(source, "const priorVersion = '2026-08-14.1'", "const priorVersion = '2026-08-19.1'", 'OpenAPI prior version')
  return source
})

edit('package.json', (source) => {
  return replaceRequired(
    source,
    '"api:finalize": "node scripts/finalize-openapi-release.cjs"',
    '"api:finalize": "node scripts/finalize-openapi-release.cjs && node scripts/professionalize-openapi-contract.cjs"',
    'api:finalize pipeline',
  )
})

edit('lib/api/publicRouteRegistry.ts', (source) => {
  const marker = "  { method: 'GET', path: '/api/v1/openapi/2026-08-19.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-19.1.', rateLimitClass: 'read' },"
  const addition = `${marker}\n  { method: 'GET', path: '/api/v1/openapi/2026-08-19.2/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-19.2.', rateLimitClass: 'read' },\n  { method: 'GET', path: '/api/v1/openapi/2026-08-19.2/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-19.2.', rateLimitClass: 'read' },`
  return replaceRequired(source, marker, addition, '2026-08-19.2 registry routes')
})

// Public contract response metadata and ETag representation.
edit('lib/website/publicContractApi.ts', (source) => {
  source = replaceRequired(source, '  tenantReference: string\n  channel:', '  organizationReference: string\n  channel:', 'public contract ETag input')
  source = replaceRequired(source, '    tenant_reference: input.tenantReference,', '    organization_reference: input.organizationReference,', 'public contract ETag organization key')
  source = replaceAll(source, '`${name} får bara anges en gång.`', '`${name} may only be specified once.`')
  source = replaceAll(source, "'customer_type måste vara private eller business. company accepteras tillfälligt som deprecated alias för business.'", "'customer_type must be private or business. company is temporarily accepted as a deprecated alias for business.'")
  source = replaceAll(source, "'Den publika website-endpointen accepterar endast channel=website.'", "'The public website endpoint only accepts channel=website.'")
  source = replaceAll(source, "'diagnostics måste vara 0, 1, false eller true.'", "'diagnostics must be 0, 1, false or true.'")
  return source
})

// Public TypeScript contract terminology.
edit('lib/integrations/websiteApiContract.ts', (source) => {
  source = replaceAll(source, 'export type TenantReference = `tenant_${string}`', 'export type OrganizationReference = `organization_${string}`')
  source = replaceAll(source, "market_price_responsibility: 'ops_quote' | 'not_applicable'", "market_price_responsibility: 'gridex_quote' | 'not_applicable'")
  source = replaceAll(source, 'market_price_supplied_by_ops: boolean', 'market_price_supplied_by_gridex: boolean')
  source = replaceAll(source, '  tenant_reference: TenantReference', '  organization_reference: OrganizationReference')
  return source
})

for (const file of [
  'lib/website/publicContracts.ts',
  'lib/external-contracts/publicationDto.ts',
  'app/api/v1/website/portfolio-prices/route.ts',
]) {
  edit(file, (source) => {
    source = replaceAll(source, '"ops_quote"', '"gridex_quote"')
    source = replaceAll(source, "'ops_quote'", "'gridex_quote'")
    source = replaceAll(source, 'market_price_supplied_by_ops', 'market_price_supplied_by_gridex')
    source = replaceAll(source, 'OPS does not expose internally sourced market indications to tenant\n      // websites. Tenants source the public market value used by calculators.', 'Gridex does not expose internal market indications through the public contract feed.\n      // Customer-facing calculators use the documented Gridex market-price and quote endpoints.')
    return source
  })
}

// General API-channel contract feed.
edit('app/api/v1/contracts/route.ts', (source) => {
  source = replaceRequired(
    source,
    "import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'",
    "import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'\nimport { publicOrganizationReference } from '@/lib/integrations/publicReferences'",
    'contracts organization reference import',
  )
  source = replaceAll(source, '`Query-parametern ${key} stöds inte.`', '`Query parameter ${key} is not supported.`')
  source = replaceAll(source, "'customer_type får bara anges en gång.'", "'customer_type may only be specified once.'")
  source = replaceAll(source, "'customer_type måste vara private eller business. company är ett tillfälligt deprecated alias.'", "'customer_type must be private or business. company is a temporary deprecated alias.'")
  const anchor = `    const headers = {\n      'Cache-Control': 'private, max-age=0, must-revalidate',`
  const replacement = `    const organizationReference = publicOrganizationReference(tenant.tenant_reference)\n    if (!organizationReference) throw new Error('PUBLIC_ORGANIZATION_REFERENCE_UNAVAILABLE')\n\n    const headers = {\n      'Cache-Control': 'private, max-age=0, must-revalidate',`
  source = replaceRequired(source, anchor, replacement, 'contracts public organization derivation')
  source = replaceRequired(source, '          tenant_reference: tenant.tenant_reference,', '          organization_reference: organizationReference,', 'contracts meta organization reference')
  return source
})

// Website public-contract feed.
edit('app/api/v1/website/public-contracts/route.ts', (source) => {
  source = replaceRequired(
    source,
    "import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'",
    "import { assertPublicResponsePayload } from '@/lib/api/publicPayloadSafety'\nimport { publicOrganizationReference } from '@/lib/integrations/publicReferences'",
    'website contracts organization import',
  )
  const anchor = '    currentTenantReference = tenant.tenant_reference\n    const headers = responseHeaders({'
  const replacement = "    currentTenantReference = tenant.tenant_reference\n    const organizationReference = publicOrganizationReference(tenant.tenant_reference)\n    if (!organizationReference) throw new Error('PUBLIC_ORGANIZATION_REFERENCE_UNAVAILABLE')\n    const headers = responseHeaders({"
  source = replaceRequired(source, anchor, replacement, 'website contracts public organization derivation')
  source = replaceRequired(source, '        tenant_reference: tenant.tenant_reference,', '        organization_reference: organizationReference,', 'website contracts meta organization reference')
  source = replaceRequired(source, '      tenantReference: tenant.tenant_reference,', '      organizationReference,', 'website contract representation identity')
  return source
})

// Supplier-switch status surface.
edit('app/api/v1/website/switch-status/route.ts', (source) => {
  source = replaceRequired(
    source,
    "import { loadWebsiteSwitchStatus, WebsiteSwitchStatusError } from '@/lib/website/switchStatus'",
    "import { loadWebsiteSwitchStatus, WebsiteSwitchStatusError } from '@/lib/website/switchStatus'\nimport { publicOrganizationReference } from '@/lib/integrations/publicReferences'",
    'switch-status organization import',
  )
  source = replaceAll(source, '`Query-parametern ${key} stöds inte.`', '`Query parameter ${key} is not supported.`')
  source = replaceAll(source, "'application_number måste anges exakt en gång.'", "'application_number must be specified exactly once.'")
  const anchor = '    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { request_id: requestId, application_number: applicationNumber } })'
  const replacement = "    const organizationReference = publicOrganizationReference(tenant.tenant_reference)\n    if (!organizationReference) throw new Error('PUBLIC_ORGANIZATION_REFERENCE_UNAVAILABLE')\n    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200, startedAt, metadata: { request_id: requestId, application_number: applicationNumber } })"
  source = replaceRequired(source, anchor, replacement, 'switch-status organization derivation')
  source = replaceRequired(source, "{ data: status, meta: { tenant_reference: tenant.tenant_reference, api_version: 'v1', channel: 'website' }, request_id: requestId }", "{ data: status, meta: { organization_reference: organizationReference, api_version: 'v1', channel: 'website' }, request_id: requestId }", 'switch-status organization metadata')
  source = replaceRequired(source, 'message: error.message, field: error.field', "message: error.code === 'application_not_found' ? 'The application could not be found.' : 'The supplier-switch status request could not be processed.', field: error.field", 'switch-status controlled public message')
  source = replaceAll(source, "'Leverantörsbytesstatus kunde inte hämtas.'", "'Supplier-switch status is temporarily unavailable.'")
  return source
})

edit('lib/website/switchStatus.ts', (source) => {
  return replaceAll(source, "'Kundansökan hittades inte för denna tenant.'", "'The application could not be found.'")
})

// Diagnostics stay privileged but must still use public organization terminology.
for (const file of [
  'app/api/v1/website/public-contracts/diagnostics/route.ts',
  'app/api/v1/public-contracts/diagnostics/route.ts',
]) {
  edit(file, (source) => {
    source = replaceRequired(
      source,
      "import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'",
      "import { classifyPublicContractsError } from '@/lib/integrations/publicApiErrors'\nimport { publicOrganizationReference } from '@/lib/integrations/publicReferences'",
      `${file} organization import`,
    )
    const logAnchor = '    await logIntegrationApiRequest({ client: auth.client, request, statusCode: 200,'
    const organizationDerivation = "    const organizationReference = publicOrganizationReference(tenant.tenant_reference)\n    if (!organizationReference) throw new Error('PUBLIC_ORGANIZATION_REFERENCE_UNAVAILABLE')\n"
    if (!source.includes(organizationDerivation)) {
      const index = source.indexOf(logAnchor)
      if (index < 0) throw new Error(`Missing diagnostics log anchor in ${file}`)
      source = source.slice(0, index) + organizationDerivation + source.slice(index)
    }
    source = replaceAll(source, 'tenant_reference: tenant.tenant_reference', 'organization_reference: organizationReference')
    return source
  })
}

// Webhook payloads: external organization reference, internal partition reference remains private.
edit('lib/integrations/webhooks.ts', (source) => {
  source = replaceRequired(
    source,
    "import { PARTNER_API_VERSION } from '@/lib/partner-api/openApi'",
    "import { PARTNER_API_VERSION } from '@/lib/partner-api/openApi'\nimport { publicOrganizationReference } from '@/lib/integrations/publicReferences'",
    'webhook organization import',
  )
  source = replaceAll(source, "'contracts.publication.changed': { dataKeys: ['channel', 'publication_revision', 'reason', 'tenant_reference', 'timestamp'] }", "'contracts.publication.changed': { dataKeys: ['channel', 'publication_revision', 'reason', 'timestamp'] }")
  const buildAnchor = `export function buildPublicWebhookPayload(\n  event: DomainEventRow,\n  tenantReference: string,\n) {\n  const sourceData = event.payload ?? {}`
  const buildReplacement = `export function buildPublicWebhookPayload(\n  event: DomainEventRow,\n  tenantReference: string,\n) {\n  const organizationReference = publicOrganizationReference(tenantReference)\n  if (!organizationReference) throw new Error('webhook_public_organization_reference_unavailable')\n  const sourceData = event.payload ?? {}`
  source = replaceRequired(source, buildAnchor, buildReplacement, 'webhook organization derivation')
  source = replaceRequired(source, '    tenant_reference: tenantReference,', '    organization_reference: organizationReference,', 'webhook public organization field')
  source = replaceRequired(source, "    typeof payload.tenant_reference === 'string' &&", "    typeof payload.organization_reference === 'string' &&", 'stored webhook public identity')
  source = replaceRequired(source, "      const tenantReference = String(storedPayload.tenant_reference ?? '')\n      if (!tenantReference) throw new Error('webhook_tenant_reference_missing')", "      const organizationReference = String(storedPayload.organization_reference ?? '')\n      if (!organizationReference) throw new Error('webhook_organization_reference_missing')", 'webhook dispatch public identity')
  source = replaceRequired(source, "        tenantReference,\n        delivery.id,", "        organizationReference,\n        delivery.id,", 'webhook public delivery reference')
  return source
})

// Authentication: keep database/RPC status terminology internal, map it at the public boundary.
edit('lib/integrations/apiAuth.ts', (source) => {
  const start = source.indexOf('export function tenantApiAccessError(')
  const end = source.indexOf('\nfunction retryAfterSeconds', start)
  if (start < 0 || end < 0) throw new Error('Could not locate tenantApiAccessError')
  const replacement = `export function tenantApiAccessError(status: string | null | undefined): {\n  status: number\n  code: string\n  message: string\n} | null {\n  if (status === 'active') return null\n  if (status === 'onboarding') return { status: 403, code: 'organization_not_operationally_ready', message: 'The organization is not ready for production API access.' }\n  if (status === 'paused') return { status: 423, code: 'organization_paused', message: 'API access for the organization is paused.' }\n  if (status === 'closed') return { status: 410, code: 'organization_closed', message: 'The organization account is closed.' }\n  if (status === 'suspended') return { status: 403, code: 'organization_suspended', message: 'API access for the organization is suspended.' }\n  if (status === 'archived' || status === 'pending_deletion' || status === 'deleted_test_only') return { status: 410, code: 'organization_inactive', message: 'The organization is not active.' }\n  return { status: 503, code: 'organization_status_unavailable', message: 'The organization status could not be verified.' }\n}\n`
  source = source.slice(0, start) + replacement + source.slice(end)
  source = replaceAll(source, "message: credential.malformedAuthorization ? 'Authorization-headern har ogiltigt Bearer-format.' : 'API-token saknas.'", "message: credential.malformedAuthorization ? 'Authorization must use the Bearer token format.' : 'API token is missing.'")
  source = replaceAll(source, "message: 'API:t är tillfälligt avstängt tills databasschemat är verifierat.'", "message: 'The API is temporarily unavailable while the platform schema is being verified.'")
  source = replaceAll(source, "message: 'API-åtkomst och trafikskydd kunde inte verifieras atomiskt.'", "message: 'API access and traffic protection could not be verified.'")
  source = replaceAll(source, "message: 'API-autentiseringen returnerade inget verifierbart resultat.'", "message: 'API authentication returned no verifiable result.'")
  const denialAnchor = `  if (row.auth_outcome !== 'allowed' || !client) {\n    const code = row.error_code ?? 'api_auth_unavailable'\n    const status = authenticationStatus(code, row.tenant_status)`
  const denialReplacement = `  if (row.auth_outcome !== 'allowed' || !client) {\n    const internalCode = row.error_code ?? 'api_auth_unavailable'\n    const code = internalCode.startsWith('tenant_')\n      ? internalCode.replace(/^tenant_/, 'organization_')\n      : internalCode\n    const status = authenticationStatus(internalCode, row.tenant_status)`
  source = replaceRequired(source, denialAnchor, denialReplacement, 'public auth code mapping')
  source = replaceAll(source, "'API-klientens trafikgräns har överskridits (kostnadsjusterad).'", "'The API client rate limit has been exceeded.'")
  source = replaceAll(source, "'API:ts trafikskydd kunde inte verifieras.'", "'API traffic protection could not be verified.'")
  source = replaceAll(source, "'API-token är ogiltig.'", "'The API token is invalid.'")
  source = replaceAll(source, "'API-klienten saknar scope.'", "'The API client does not have the required scope.'")
  source = replaceAll(source, "'API-åtkomsten nekades av den atomiska autentiseringspolicyn.'", "'API access was denied by the authentication policy.'")
  return source
})

// Website application route owns the public error boundary. Deep internal errors
// remain useful for logs but are not returned verbatim to external clients.
edit('app/api/v1/website/customer-applications/route.ts', (source) => {
  const start = source.indexOf('function buildErrorBody(')
  const end = source.indexOf('\n\n\nexport async function POST', start)
  if (start < 0 || end < 0) throw new Error('Could not locate customer application error boundary')
  const replacement = `function publicApplicationErrorCode(value: unknown): string {\n  const code = typeof value === 'string' && value.trim() ? value.trim() : 'website_application_error'\n  return code.startsWith('tenant_') ? code.replace(/^tenant_/, 'organization_') : code\n}\n\nfunction publicApplicationMessage(code: string): string {\n  if (code.includes('idempotency')) return 'The request could not be completed with the supplied Idempotency-Key.'\n  if (code.includes('quote')) return 'The authoritative quote could not be validated for this application.'\n  if (code.includes('legal') || code.includes('acceptance')) return 'The legal acceptance evidence could not be validated.'\n  if (code.includes('power_of_attorney')) return 'The power-of-attorney evidence could not be validated.'\n  if (code.includes('portal_auth')) return 'The verified customer identity could not be validated.'\n  if (code.includes('organization') || code.includes('integration')) return 'The integration is not currently ready to accept this request.'\n  if (code.includes('payload') || code.includes('json') || code.includes('validation') || code.includes('required') || code.includes('invalid')) return 'The customer application could not be validated.'\n  return 'The customer application could not be processed.'\n}\n\nfunction buildErrorBody(body: Record<string, unknown>, requestId: string) {\n  const code = publicApplicationErrorCode(body.code)\n  const stage = (readField(body, 'error_stage') as string | null)\n    ?? (readField(body, 'stage') as string | null)\n    ?? null\n  return canonicalApiError({\n    code,\n    message: publicApplicationMessage(code),\n    requestId,\n    correlationId: typeof body.correlation_id === 'string' ? body.correlation_id : requestId,\n    field: (body.field as string | null | undefined) ?? null,\n    blockers: [],\n    details: null,\n    stage: stage === 'tenant_readiness' ? 'integration_readiness' : stage,\n    hint: null,\n    retryable: body.retryable === true,\n  })\n}`
  source = source.slice(0, start) + replacement + source.slice(end)
  source = replaceAll(source, "? 'tenant_website_schema_not_ready'\n        : 'tenant_website_not_ready'", "? 'integration_schema_not_ready'\n        : 'integration_not_ready'")
  source = replaceAll(source, "? 'Databasschemat för tenantens webbansökningsflöde är inte synkroniserat.'\n            : 'Tenantens webbansökningsflöde är inte produktionsklart.'", "? 'The integration schema is not ready.'\n            : 'The integration is not ready for production checkout.'")
  source = replaceAll(source, "error_stage: 'tenant_readiness'", "error_stage: 'integration_readiness'")
  source = replaceAll(source, "? 'Kör de senaste OPS-migrationerna innan applikationskoden aktiveras.'\n            : 'Åtgärda readiness-blockers i OPS och kör tenantprovisioneringen igen.'", "? 'Contact Gridex support if this condition persists.'\n            : 'Complete the required integration setup before retrying.'")
  source = replaceAll(source, "? 'Förfrågans innehåll är för stort.'\n            : 'Ogiltig JSON i förfrågan.'", "? 'The request payload is too large.'\n            : 'The request body contains invalid JSON.'")
  source = replaceAll(source, "error: 'Kundansökan kunde inte behandlas just nu.'", "error: 'The customer application could not be processed at this time.'")
  return source
})

// Event API errors and support boundary in English.
edit('app/api/v1/events/route.ts', (source) => {
  source = replaceAll(source, '`${name} får bara anges en gång.`', '`${name} may only be specified once.`')
  source = replaceAll(source, "'limit måste vara ett heltal mellan 1 och 100.'", "'limit must be an integer between 1 and 100.'")
  source = replaceAll(source, '`Okänd query-parameter: ${key}.`', '`Unknown query parameter: ${key}.`')
  source = replaceAll(source, "'event_type har ogiltigt format.'", "'event_type has an invalid format.'")
  source = replaceAll(source, "'before måste vara en giltig ISO-tidpunkt.'", "'before must be a valid ISO timestamp.'")
  source = replaceAll(source, "'Händelser kunde inte hämtas just nu.'", "'Events are temporarily unavailable.'")
  source = replaceAll(source, "'Ogiltigt kundevent.'", "'Invalid customer event.'")
  source = replaceAll(source, "'Supporthantering ligger utanför Gridex Ops API.'", "'Support-case management is outside the Gridex public API.'")
  source = replaceAll(source, "'Kundeventet kunde inte behandlas just nu.'", "'The customer event could not be processed at this time.'")
  return source
})

// Runtime/OpenAPI parity must assert the new public names while internal readiness names remain private.
edit('scripts/check-openapi-runtime-parity.cjs', (source) => {
  source = replaceAll(source, "  'complete_tenant_website_ready',", "  'complete_integration_ready',")
  source = replaceAll(source, "    | 'complete_tenant_website_ready'", "    | 'complete_integration_ready'")
  return source
})

console.log('One-shot public API boundary remediation applied.')
