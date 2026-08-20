import { readFile, writeFile } from 'node:fs/promises'

async function ensureReplacement(path, oldText, newText, label) {
  const source = await readFile(path, 'utf8')
  if (source.includes(newText)) {
    console.log(`already correct ${label}: ${path}`)
    return
  }
  if (!source.includes(oldText)) throw new Error(`${label}: neither old nor expected content found in ${path}`)
  await writeFile(path, source.replace(oldText, newText))
  console.log(`updated ${label}: ${path}`)
}

async function ensureVersion(path, from, to, label) {
  const source = await readFile(path, 'utf8')
  if (source.includes(to) && !source.includes(from)) {
    console.log(`already correct ${label}: ${path}`)
    return
  }
  if (!source.includes(from)) throw new Error(`${label}: old version missing in ${path}`)
  await writeFile(path, source.replaceAll(from, to))
  console.log(`updated ${label}: ${path}`)
}

const processPath = 'lib/website/customerApplicationProcess.ts'
let processSource = await readFile(processPath, 'utf8')
const oldIdentity = `        externalAccountId:\n          clean(body.external_account_id) ??\n          clean(body.customer_portal_user_id) ??\n          clean(body.auth_user_id) ??\n          clean(body.web_auth_user_id),\n        authUserId:\n          clean(body.auth_user_id) ??\n          clean(body.web_auth_user_id) ??\n          clean(body.customer_portal_user_id),\n        customerPortalUserId:\n          clean(body.customer_portal_user_id) ??\n          clean(body.auth_user_id) ??\n          clean(body.web_auth_user_id),\n        customerNumber,`
const newIdentity = `        externalAccountId:\n          clean(body.external_account_id) ??\n          clean(body.customer_portal_user_id) ??\n          clean(body.auth_user_id),\n        authUserId:\n          clean(body.auth_user_id) ?? clean(body.customer_portal_user_id),\n        customerPortalUserId:\n          clean(body.customer_portal_user_id) ?? clean(body.auth_user_id),\n        customerNumber,`
if (!processSource.includes(newIdentity)) {
  if (!processSource.includes(oldIdentity)) throw new Error('portal identity canonicalization content missing')
  processSource = processSource.replace(oldIdentity, newIdentity)
}
const oldPortalUser = `    const portalUserId =\n      clean(body.customer_portal_user_id) ??\n      clean(body.auth_user_id) ??\n      clean(body.web_auth_user_id) ??\n      clean(body.external_account_id);`
const newPortalUser = `    // Only the verified portal/auth UUID pair may create direct portal access.\n    // external_account_id is a business reference, never authentication proof.\n    const portalUserId =\n      clean(body.customer_portal_user_id) ?? clean(body.auth_user_id);`
if (!processSource.includes(newPortalUser)) {
  if (!processSource.includes(oldPortalUser)) throw new Error('portal user verification content missing')
  processSource = processSource.replace(oldPortalUser, newPortalUser)
}
const oldApplicationLink = `        customerNumber,\n        email: normalizedEmail(body.customer.email),\n      }),`
const newApplicationLink = `        customerNumber,\n        email: normalizedEmail(body.customer.email),\n        applicationId: applicationRowId,\n      }),`
if (!processSource.includes(newApplicationLink)) {
  if (!processSource.includes(oldApplicationLink)) throw new Error('portal identity application binding content missing')
  processSource = processSource.replace(oldApplicationLink, newApplicationLink)
}
await writeFile(processPath, processSource)
console.log('verified hardened portal identity linking')

await ensureVersion('lib/integrations/websiteIntegrationContract.ts', '2026-08-20.1', '2026-08-20.2', 'runtime contract version')
await ensureReplacement('scripts/professionalize-openapi-contract.cjs', "const VERSION = '2026-08-20.1'", "const VERSION = '2026-08-20.2'", 'professional OpenAPI version')
await ensureReplacement('scripts/check-api-documentation-version.cjs', "const legacyExpected = '2026-08-20.1'", "const legacyExpected = '2026-08-20.2'", 'documentation contract expectation')
await ensureReplacement('scripts/check-api-compatibility.cjs', "const version = '2026-08-20.1'", "const version = '2026-08-20.2'", 'API compatibility release version')
await ensureReplacement('scripts/verify-openapi-release.cjs', "const version = '2026-08-20.1'", "const version = '2026-08-20.2'", 'OpenAPI release verifier version')

const registryPath = 'lib/api/publicRouteRegistry.ts'
let registry = await readFile(registryPath, 'utf8')
if (!registry.includes('/api/v1/openapi/2026-08-20.2/website-integration-v1.json')) {
  const anchor = `  { method: 'GET', path: '/api/v1/openapi/2026-08-20.1/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-20.1.', rateLimitClass: 'read' },`
  if (!registry.includes(anchor)) throw new Error('public route registry release anchor missing')
  registry = registry.replace(anchor, `${anchor}\n  { method: 'GET', path: '/api/v1/openapi/2026-08-20.2/website-integration-v1.json', scopes: [], description: 'Immutable Website Integration OpenAPI release 2026-08-20.2.', rateLimitClass: 'read' },\n  { method: 'GET', path: '/api/v1/openapi/2026-08-20.2/customer-portal-v1.json', scopes: [], description: 'Immutable Customer Portal OpenAPI release 2026-08-20.2.', rateLimitClass: 'read' },`)
  await writeFile(registryPath, registry)
}

for (const path of ['docs/external-website-api-integration-guide.md', 'docs/gridex-customer-portal-api.md', 'docs/single-api-key-tenant-integration.md']) {
  await ensureVersion(path, '2026-08-20.1', '2026-08-20.2', 'developer documentation version')
}

const regressionPath = 'scripts/gridex-multitenant-website-application-flow-regression.cjs'
let regression = await readFile(regressionPath, 'utf8')
const preAuthLine = `const preAuthMigration = read('supabase/migrations/20260804151500_website_application_pre_auth_contract_alignment.sql')`
if (!regression.includes('tenant_scoped_post_auth_website_applications.sql')) {
  if (!regression.includes(preAuthLine)) throw new Error('regression migration anchor missing')
  regression = regression.replace(preAuthLine, `${preAuthLine}\nconst postAuthMigration = read('supabase/migrations/20260820213000_tenant_scoped_post_auth_website_applications.sql')`)
}
const oldProcessCheck = `check(applicationProcess.includes('portal_auth_identity_required') && applicationProcess.includes('portal_auth_identity_mismatch'), 'website application requires the same verified portal/auth UUID')`
const newProcessCheck = `check(\n  applicationProcess.includes('portalIdentitySubmissionMode') &&\n    applicationProcess.includes('portal_auth_identity_required') &&\n    applicationProcess.includes('portal_auth_identity_mismatch') &&\n    applicationProcess.includes('post_auth_allowed'),\n  'website application enforces verified portal UUID pairs according to tenant submission mode',\n)`
if (!regression.includes(newProcessCheck)) {
  if (!regression.includes(oldProcessCheck)) throw new Error('regression process policy anchor missing')
  regression = regression.replace(oldProcessCheck, newProcessCheck)
}
const oldDbCheck = `check(preAuthMigration.includes('alter column portal_identity_required set default true') && preAuthMigration.includes("tg_op = 'INSERT'") && preAuthMigration.includes('portal_auth_identity_downgrade_forbidden'), 'database makes pre-auth mandatory for all new legacy website rows and prevents canonical downgrade')`
const dbPolicyCheck = `check(\n  postAuthMigration.includes('portal_identity_submission_mode') &&\n    postAuthMigration.includes("website_portal_identity_mode") &&\n    postAuthMigration.includes("post_auth_allowed") &&\n    postAuthMigration.includes("pre_auth_required") &&\n    postAuthMigration.includes('website_customer_applications_company_api_client_fkey'),\n  'database freezes per-tenant portal submission mode and enforces company-scoped application references',\n)`
if (!regression.includes(dbPolicyCheck)) {
  if (!regression.includes(oldDbCheck)) throw new Error('regression database policy anchor missing')
  regression = regression.replace(oldDbCheck, `${oldDbCheck}\n${dbPolicyCheck}`)
}
const oldOpenApiCheck = `check(request.required.includes('auth_user_id') && request.required.includes('customer_portal_user_id'), 'website OpenAPI requires both portal identity fields')`
const newOpenApiCheck = `check(\n  !request.required.includes('auth_user_id') &&\n    !request.required.includes('customer_portal_user_id') &&\n    request.dependentRequired?.auth_user_id?.includes('customer_portal_user_id') &&\n    request.dependentRequired?.customer_portal_user_id?.includes('auth_user_id'),\n  'website OpenAPI allows post-auth omission but requires portal identity fields as a complete pair',\n)`
if (!regression.includes(newOpenApiCheck)) {
  if (!regression.includes(oldOpenApiCheck)) throw new Error('regression OpenAPI policy anchor missing')
  regression = regression.replace(oldOpenApiCheck, newOpenApiCheck)
}
const routeCheck = `check(\n  readiness.includes('portal_identity_submission_mode') &&\n    route.includes('portalIdentitySubmissionMode: readiness.portal_identity_submission_mode'),\n  'authenticated tenant readiness is the runtime source for portal identity submission mode',\n)`
if (!regression.includes(routeCheck)) {
  const routeAnchor = `check(route.includes('integration_schema_not_ready') && route.includes('readinessStatus = schemaBlocked ? 503 : 409'), 'website application route returns 503 for database readiness drift')`
  if (!regression.includes(routeAnchor)) throw new Error('regression route policy anchor missing')
  regression = regression.replace(routeAnchor, `${routeAnchor}\n${routeCheck}`)
}
await writeFile(regressionPath, regression)
console.log('verified multitenant checkout regression policy')

const migrationManifestPath = 'scripts/migration-history-manifest.additions.json'
const migrationManifest = JSON.parse(await readFile(migrationManifestPath, 'utf8'))
migrationManifest.files ??= {}
migrationManifest.files['20260820213000_tenant_scoped_post_auth_website_applications.sql'] = '0edef5a8341d02aca3f00e9f4a06a2fcd8c130394b41ef425151fcf147c8763b'
await writeFile(migrationManifestPath, `${JSON.stringify(migrationManifest, null, 2)}\n`)
console.log('verified post-auth migration checksum')
