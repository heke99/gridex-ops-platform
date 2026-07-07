/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: the legal authorization chain
//   powers_of_attorney.document_id
//     = customer_authorization_documents.id
//     = authorization_scopes.authorization_document_id
//     = downstream requests / outbound / intent payload / message payload
// must be created idempotently by ALL intake paths and propagated through the
// supplier switch and Z01 pipelines.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}

const chain = 'lib/legal/authorizationChain.ts'
const adminActions = 'app/admin/customers/actions.ts'
const opsDb = 'lib/operations/db.ts'
const prodatSwitch = 'lib/ediel/flows/prodatSwitch.ts'
const prodatZ01 = 'lib/ediel/flows/prodatCustomerMasterdata.ts'
const website = 'lib/website/customerApplications.ts'

// Shared idempotent helpers exist.
mustInclude(chain, 'export async function ensureCustomerAuthorizationDocument', 'idempotent authorization document helper')
mustInclude(chain, 'export async function ensureAuthorizationScopes', 'idempotent scopes helper')
mustInclude(chain, 'export async function ensureAuthorizationDocumentFromPowerOfAttorney', 'full chain helper')
mustInclude(chain, 'export async function resolveAuthorizationDocumentIdForPowerOfAttorney', 'read-only chain resolution for downstream flows')

// Manual admin intake produces the same chain as website intake.
mustInclude(adminActions, 'ensureAuthorizationDocumentFromPowerOfAttorney', 'manual intake POA must create authorization document + scopes')
mustInclude(adminActions, 'ensureAuthorizationScopes', 'uploaded intake POA must create authorization scopes')

// Website chain remains intact (canonical implementation).
mustInclude(website, 'ensureWebsiteAuthorizationChainFromPowerOfAttorney', 'website chain implementation')
mustInclude(website, "from('authorization_scopes')", 'website chain writes authorization_scopes')

// Supplier switch chain propagation.
mustInclude(opsDb, 'resolveAuthorizationDocumentIdForPowerOfAttorney', 'switch creation must resolve authorization document from POA')
mustInclude(prodatSwitch, 'authorization_document_id: authorizationDocumentId', 'switch outbound/intent payload must carry authorization document')
mustInclude(prodatSwitch, 'resolveAuthorizationDocumentIdForPowerOfAttorney', 'Z03 prepare resolves chain for legacy switch rows')

// Z01 message payload carries the chain.
mustInclude(prodatZ01, "authorization_document_id: params.dataRequest.authorization_document_id", 'Z01 rendered message parsedPayload must carry authorization document')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-poa-authorization-chain-regression: all checks passed')
