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

// Some sources are formatted with double quotes; table-name assertions must be
// quote-style agnostic so a formatter run cannot silently disable the check.
function mustIncludeEither(file, needles, why) {
  const source = read(file)
  if (!needles.some((needle) => source.includes(needle))) {
    failures.push(`Missing any of ${needles.map((needle) => `"${needle}"`).join(' / ')} in ${file} (${why})`)
  }
}

const chain = 'lib/legal/authorizationChain.ts'
const adminActions = 'app/admin/customers/actions.ts'
const opsDb = 'lib/operations/db.ts'
const prodatSwitch = 'lib/ediel/flows/prodatSwitch.ts'
const prodatZ01 = 'lib/ediel/flows/prodatCustomerMasterdata.ts'
const website = 'lib/website/customerApplications.ts'
const poaRepair = 'supabase/migrations/20260902100045_fix_website_poa_scope_and_grid_owner_aliases.sql'

// Shared idempotent helpers exist.
mustInclude(chain, 'export async function ensureCustomerAuthorizationDocument', 'idempotent authorization document helper')
mustInclude(chain, 'export async function ensureAuthorizationScopes', 'idempotent scopes helper')
mustInclude(chain, 'export async function ensureAuthorizationDocumentFromPowerOfAttorney', 'full chain helper')
mustInclude(chain, 'export async function resolveAuthorizationDocumentIdForPowerOfAttorney', 'read-only chain resolution for downstream flows')

// Manual admin intake delegates atomically to canonical_onboard_customer_graph,
// whose transaction creates the POA, document and exact authorization scope.
mustInclude(adminActions, 'onboardCustomerGraph', 'manual intake must use canonical atomic onboarding')
mustInclude(adminActions, 'authorization_document:', 'manual intake must pass the authorization document command')
mustInclude('supabase/migrations/20260720110000_canonical_customer_onboarding_transaction.sql', "'public.customer_authorization_documents'::regclass", 'canonical onboarding creates authorization document')
mustInclude('supabase/migrations/20260720110000_canonical_customer_onboarding_transaction.sql', "'public.authorization_scopes'::regclass", 'canonical onboarding creates authorization scopes')

// Website chain remains intact (canonical implementation).
mustInclude(website, 'ensureWebsiteAuthorizationChainFromPowerOfAttorney', 'website chain implementation')
mustIncludeEither(website, ["from('authorization_scopes')", 'from("authorization_scopes")'], 'website chain writes authorization_scopes')

// Website POAs must also materialize the exact captured scopes into the legacy
// relational scope projection. The admin compatibility projection must not make
// a signed POA disappear because an old expires_at select is still deployed.
mustInclude(poaRepair, 'gridex_materialize_poa_scopes', 'signed website POA scopes are materialized by the database')
mustInclude(poaRepair, 'signed_scope_snapshot', 'scope materialization is derived only from immutable signed scope evidence')
mustInclude(poaRepair, 'power_of_attorney_scopes_poa_scope_uidx', 'scope materialization is idempotent')
mustInclude(poaRepair, 'add column if not exists expires_at', 'legacy admin POA select remains compatible with canonical validity fields')

// The supplier switch readiness gate must verify (and be able to heal) the
// canonical scope coverage before any switch dispatch.
mustInclude(chain, 'export async function verifyAuthorizationScopeCoverage', 'scope coverage verifier for POA-requiring operations')
mustInclude('lib/customer-operations/switchReadiness.ts', 'verifyAuthorizationScopeCoverage', 'switch readiness enforces authorization scope coverage')
mustInclude('lib/customer-operations/switchReadiness.ts', 'authorization_scope_missing', 'switch readiness raises a structured scope blocker')

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
