#!/usr/bin/env node

const fs = require('node:fs')

const failures = []

function read(path) {
  return fs.readFileSync(path, 'utf8')
}

function expectIncludes(source, fragment, label) {
  if (!source.includes(fragment)) failures.push(`${label}: missing ${fragment}`)
}

const route = read('app/api/v1/website/quote/route.ts')
const helper = read('lib/integrations/writeIdempotency.ts')
const migration = read(
  'supabase/migrations/20260804200732_usage_event_identity_and_integration_write_idempotency.sql',
)
const contractSource = read('lib/integrations/websiteIntegrationContract.ts')
const guide = read('docs/external-website-api-integration-guide.md')
const developerPage = read('app/developers/customer-portal-api/page.tsx')
const openapi = JSON.parse(read('docs/openapi/website-integration-v1.json'))
const quoteOperation = openapi.paths?.['/api/v1/website/quote']?.post

expectIncludes(
  route,
  'companyId: auth.context.companyId',
  'quote route internal organization scope',
)
expectIncludes(route, 'apiClientId: auth.client.id', 'quote route API client scope')
expectIncludes(route, 'route: QUOTE_ROUTE', 'quote route namespace scope')
expectIncludes(route, 'required: true', 'quote route required idempotency')
expectIncludes(
  route,
  "'Idempotency-Replayed': 'true'",
  'quote replay response header',
)
expectIncludes(
  route,
  "'Idempotency-Replayed': 'false'",
  'quote first response header',
)

for (const scope of [
  ".eq('company_id', input.companyId)",
  ".eq('api_client_id', input.apiClientId)",
  ".eq('route', input.route)",
  ".eq('idempotency_key', idempotencyKey)",
]) {
  expectIncludes(helper, scope, 'idempotency replay lookup')
}
expectIncludes(
  helper,
  "code: 'idempotency_key_required'",
  'required key stable error',
)
expectIncludes(
  migration,
  'unique(company_id, api_client_id, route, idempotency_key)',
  'database organization/client/route uniqueness',
)

if (!quoteOperation) {
  failures.push('OpenAPI: /api/v1/website/quote POST is missing')
} else {
  const idempotencyParameter = (quoteOperation.parameters ?? []).find(
    (parameter) =>
      String(parameter?.name ?? '').toLowerCase() === 'idempotency-key' &&
      parameter?.in === 'header',
  )
  if (!idempotencyParameter?.required) {
    failures.push('OpenAPI: Idempotency-Key must be a required quote header')
  }
  if (idempotencyParameter?.schema?.minLength !== 8) {
    failures.push('OpenAPI: Idempotency-Key minLength must be 8')
  }
  if (idempotencyParameter?.schema?.maxLength !== 200) {
    failures.push('OpenAPI: Idempotency-Key maxLength must be 200')
  }
  const scope = quoteOperation['x-idempotency-scope'] ?? []
  if (scope.includes('company_id') || scope.some((item) => /tenant/i.test(String(item)))) {
    failures.push('OpenAPI: idempotency scope leaks internal database/tenant terminology')
  }
  if (!scope.some((item) => /organization/i.test(String(item)))) {
    failures.push('OpenAPI: idempotency scope must describe the authenticated organization boundary')
  }
  for (const requiredScope of ['api_client_id', 'route', 'idempotency_key']) {
    if (!scope.includes(requiredScope)) {
      failures.push(`OpenAPI: missing idempotency scope ${requiredScope}`)
    }
  }
  const replayHeader = quoteOperation.responses?.['201']?.headers?.[
    'Idempotency-Replayed'
  ]
  if (!replayHeader) {
    failures.push('OpenAPI: 201 response must document Idempotency-Replayed')
  }
  if (!quoteOperation.responses?.['503']) {
    failures.push('OpenAPI: quote must document 503 idempotency store failure')
  }
}

const sourceVersionMatch = contractSource.match(
  /WEBSITE_INTEGRATION_CONTRACT_VERSION = '([^']+)'/,
)
if (!sourceVersionMatch) {
  failures.push('Contract source: version constant missing')
} else if (openapi.info?.version !== sourceVersionMatch[1]) {
  failures.push(
    `Contract version drift: source=${sourceVersionMatch[1]} openapi=${openapi.info?.version}`,
  )
}

const currentVersion = String(openapi.info?.version ?? '')
if (!/^\d{4}-\d{2}-\d{2}\.\d+$/.test(currentVersion)) {
  failures.push(`OpenAPI: invalid current version ${currentVersion}`)
} else {
  for (const contractName of [
    'website-integration-v1',
    'customer-portal-v1',
  ]) {
    const releasePath =
      `docs/openapi/releases/${currentVersion}/${contractName}.json`
    const routePath =
      `app/api/v1/openapi/${currentVersion}/${contractName}.json/route.ts`
    if (!fs.existsSync(releasePath)) {
      failures.push(`Immutable OpenAPI release is missing: ${releasePath}`)
      continue
    }
    if (!fs.existsSync(routePath)) {
      failures.push(`Immutable OpenAPI route is missing: ${routePath}`)
      continue
    }
    const release = JSON.parse(read(releasePath))
    if (release.info?.version !== currentVersion) {
      failures.push(`${releasePath}: info.version drift`)
    }
    const immutableRoute = read(routePath)
    expectIncludes(
      immutableRoute,
      `@/docs/openapi/releases/${currentVersion}/${contractName}.json`,
      `${routePath} release import`,
    )
    expectIncludes(
      immutableRoute,
      'max-age=31536000, immutable',
      `${routePath} immutable caching`,
    )
  }
}

expectIncludes(
  guide,
  'stable idempotency keys',
  'integration guide idempotency responsibility',
)
expectIncludes(
  guide,
  'The API credential determines the organization and permissions.',
  'integration guide organization isolation',
)
expectIncludes(
  developerPage,
  '<code>Idempotency-Key</code>',
  'canonical developer guide idempotency header',
)
expectIncludes(
  developerPage,
  'Gridex identifies the correct organization from the credential',
  'canonical developer guide organization isolation',
)
for (const forbiddenPublicTerm of ['company_id', 'tenant_reference']) {
  if (guide.includes(forbiddenPublicTerm)) {
    failures.push(`Integration guide leaks internal field ${forbiddenPublicTerm}`)
  }
}

for (const forbidden of [
  'b3ad1bf6-fa45-41a6-8054-2e0862e82aca',
  'bf2f3755-4a84-446a-b361-b6aa7149c39a',
]) {
  if (route.includes(forbidden) || helper.includes(forbidden)) {
    failures.push(`Runtime contains hard-coded organization/client UUID: ${forbidden}`)
  }
}

if (failures.length > 0) {
  console.error(`Quote idempotency multitenant regression failed (${failures.length}):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Quote idempotency multitenant regression passed for ${currentVersion}: internal database uniqueness, public organization boundary, immutable OpenAPI release and canonical developer guide are aligned.`,
)
