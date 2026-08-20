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

for (const path of [
  'docs/external-website-api-integration-guide.md',
  'docs/gridex-customer-portal-api.md',
  'docs/single-api-key-tenant-integration.md',
]) {
  await replaceAllRequired(path, '2026-08-20.1', '2026-08-20.2', 'developer documentation version')
}
