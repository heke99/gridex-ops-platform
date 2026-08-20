import { readFile, writeFile } from 'node:fs/promises'

const path = 'lib/website/customerApplicationProcess.ts'
let source = await readFile(path, 'utf8')

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

await writeFile(path, source)
console.log('hardened verified portal identity linking')
