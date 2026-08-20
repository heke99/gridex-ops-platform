import { readFile, writeFile } from 'node:fs/promises'

async function replaceRequired(path, from, to, label) {
  const source = await readFile(path, 'utf8')
  if (!source.includes(from)) throw new Error(`${label}: anchor missing in ${path}`)
  await writeFile(path, source.replace(from, to))
  console.log(`updated ${label}: ${path}`)
}

async function replaceAllRequired(path, from, to, label) {
  const source = await readFile(path, 'utf8')
  if (!source.includes(from)) throw new Error(`${label}: anchor missing in ${path}`)
  await writeFile(path, source.replaceAll(from, to))
  console.log(`updated ${label}: ${path}`)
}

const processPath = 'lib/website/customerApplicationProcess.ts'
let source = await readFile(processPath, 'utf8')

const oldIdentity = `        externalAccountId:\n          clean(body.external_account_id) ??\n          clean(body.customer_portal_user_id) ??\n          clean(body.auth_user_id) ??\n          clean(body.web_auth_user_id),\n        authUserId:\n          clean(body.auth_user_id) ??\n          clean(body.web_auth_user_id) ??\n          clean(body.customer_portal_user_id),\n        customerPortalUserId:\n          clean(body.customer_portal_user_id) ??\n          clean(body.auth_user_id) ??\n          clean(body.web_auth_user_id),\n        customerNumber,`
const newIdentity = `        externalAccountId:\n          clean(body.external_account_id) ??\n          clean(body.customer_portal_user_id) ??\n          clean(body.auth_user_id),\n        authUserId:\n          clean(body.auth_user_id) ?? clean(body.customer_portal_user_id),\n        customerPortalUserId:\n          clean(body.customer_portal_user_id) ?? clean(body.auth_user_id),\n        customerNumber,`
if (!source.includes(oldIdentity)) throw new Error('portal identity canonicalization anchor missing')
source = source.replace(oldIdentity, newIdentity)

const oldPortalUser = `    const portalUserId =\n      clean(body.customer_portal_user_id) ??\n      clean(body.auth_user_id) ??\n      clean(body.web_auth_user_id) ??\n      clean(body.external_account_id);`
const newPortalUser = `    // Only the verified portal/auth UUID pair may create direct portal access.\n    // external_account_id is a business reference, never authentication proof.\n    const portalUserId =\n      clean(body.customer_portal_user_id) ?? clean(body.auth_user_id);`
if (!source.includes(oldPortalUser)) throw new Error('portal user legacy fallback anchor missing')
source = source.replace(oldPortalUser, newPortalUser)

const oldCustomerNumber = `        customerNumber,\n        email: normalizedEmail(body.customer.email),\n      }),`
const newCustomerNumber = `        customerNumber,\n        email: normalizedEmail(body.customer.email),\n        applicationId: applicationRowId,\n      }),`
if (!source.includes(oldCustomerNumber)) throw new Error('portal identity application anchor missing')
source = source.replace(oldCustomerNumber, newCustomerNumber)

await writeFile(processPath, source)
console.log('hardened verified portal identity linking')

await replaceAllRequired(
  'lib/integrations/websiteIntegrationContract.ts',
  '2026-08-20.1',
  '2026-08-20.2',
  'runtime contract version',
)
await replaceRequired(
  'scripts/professionalize-openapi-contract.cjs',
  "const VERSION = '2026-08-20.1'",
  "const VERSION = '2026-08-20.2'",
  'professional OpenAPI version',
)
await replaceRequired(
  'scripts/check-api-documentation-version.cjs',
  "const legacyExpected = '2026-08-20.1'",
  "const legacyExpected = '2026-08-20.2'",
  'documentation contract expectation',
)
await replaceRequired(
  'scripts/check-api-compatibility.cjs',
  "const version = '2026-08-20.1'",
  "const version = '2026-08-20.2'",
  'API compatibility release version',
)
await replaceRequired(
  'scripts/verify-openapi-release.cjs',
  "const version = '2026-08-20.1'",
  "const version = '2026-08-20.2'",
  'OpenAPI release verifier version',
)

const registryPath = 'lib/api/publicRouteRegistry.ts'
let registry = await readFile(registryPath, 'utf8')
const registryAnchor = `  { method: 'GET', path: '/api/v1/openapi/2026-08-20.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-20.1.', rateLimitClass: 'read' },`
const registryAddition = `${registryAnchor}\n  { method: 'GET', path: '/api/v1/openapi/2026-08-20.2/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-20.2.', rateLimitClass: 'read' },\n  { method: 'GET', path: '/api/v1/openapi/2026-08-20.2/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-20.2.', rateLimitClass: 'read' },`
if (!registry.includes(registryAnchor)) throw new Error('public route registry release anchor missing')
if (!registry.includes('/api/v1/openapi/2026-08-20.2/website-integration-v1.json')) {
  registry = registry.replace(registryAnchor, registryAddition)
  await writeFile(registryPath, registry)
  console.log('registered immutable OpenAPI 2026-08-20.2 routes')
}

for (const path of [
  'docs/external-website-api-integration-guide.md',
  'docs/gridex-customer-portal-api.md',
  'docs/single-api-key-tenant-integration.md',
]) {
  await replaceAllRequired(path, '2026-08-20.1', '2026-08-20.2', 'developer documentation version')
}
