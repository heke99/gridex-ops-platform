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

function mustMatch(file, pattern, why) {
  if (!pattern.test(read(file))) failures.push(`Missing ${pattern} in ${file} (${why})`)
}

const chain = 'lib/legal/authorizationChain.ts'
const adminActions = 'app/admin/customers/actions.ts'
const adminActionOwner = 'app/admin/customers/actions.part-3.ts'
const adminGraphOwner = 'app/admin/customers/actions.part-2.ts'
const opsDb = 'lib/operations/db.ts'
const opsSwitchOwner = 'lib/operations/db.part-2.ts'
const prodatSwitch = 'lib/ediel/flows/prodatSwitch.ts'
const prodatZ01 = 'lib/ediel/flows/prodatCustomerMasterdata.ts'
const z01Gateway = 'lib/ediel/intent/renderGateway.ts'
const z01Renderer = 'lib/ediel/intent/renderers/customerMasterdataZ01.ts'
const website = 'lib/website/customerApplications.ts'
const websiteProcess = 'lib/website/customerApplicationProcess.ts'
const websiteOnboarding = 'lib/website/customerApplicationOnboarding.ts'
const websiteRepair = 'lib/website/customerApplicationRepair.ts'
const websiteLegal = 'lib/website/customerApplicationLegal.ts'
const poaRepair = 'supabase/migrations/20260902100045_fix_website_poa_scope_and_grid_owner_aliases.sql'

// Shared idempotent helpers exist.
mustInclude(chain, 'export async function ensureCustomerAuthorizationDocument', 'idempotent authorization document helper')
mustInclude(chain, 'export async function ensureAuthorizationScopes', 'idempotent scopes helper')
mustInclude(chain, 'export async function ensureAuthorizationDocumentFromPowerOfAttorney', 'full chain helper')
mustInclude(chain, 'export async function resolveAuthorizationDocumentIdForPowerOfAttorney', 'read-only chain resolution for downstream flows')

// Manual admin intake delegates atomically to canonical_onboard_customer_graph,
// whose transaction creates the POA, document and exact authorization scope.
mustMatch(adminActions, /import \* as implementation1 from ['"]\.\/actions\.part-3['"]/, 'manual public action imports its owner')
mustInclude(adminActions, 'return implementation1.createCustomerAction(...args)', 'manual public action delegates to its owner')
mustMatch(adminActionOwner, /import\s*\{[^}]*\bcreateCustomerGraph\b[^}]*\}\s*from ['"]\.\/actions\.part-2['"]/, 'manual action imports its graph owner')
mustInclude(adminActionOwner, 'await createCustomerGraph(params, {', 'manual action calls its graph owner')
mustInclude(adminGraphOwner, 'await onboardCustomerGraph({', 'manual graph uses canonical atomic onboarding')
mustInclude(adminGraphOwner, 'authorization_document: signedScopes.length > 0', 'manual graph passes the signed document command')
mustInclude('supabase/migrations/20260720110000_canonical_customer_onboarding_transaction.sql', "'public.customer_authorization_documents'::regclass", 'canonical onboarding creates authorization document')
mustInclude('supabase/migrations/20260720110000_canonical_customer_onboarding_transaction.sql', "'public.authorization_scopes'::regclass", 'canonical onboarding creates authorization scopes')

// Both ordinary website onboarding and the retry repair path carry the chain.
mustMatch(website, /export \{ processWebsiteCustomerApplication \} from ['"]\.\/customerApplicationProcess['"]/, 'website facade exposes ordinary intake')
mustMatch(websiteProcess, /import \{ onboardCanonicalWebsiteCustomerGraph \} from ['"]\.\/customerApplicationOnboarding['"]/, 'ordinary website intake imports canonical graph owner')
mustInclude(websiteProcess, 'onboardCanonicalWebsiteCustomerGraph({', 'ordinary website intake calls canonical graph owner')
mustInclude(websiteOnboarding, 'await onboardCustomerGraph({', 'website graph uses atomic onboarding')
mustInclude(websiteOnboarding, 'authorization_document: input.structuredPoa?.accepted', 'website passes the accepted authorization command')
mustMatch(website, /export \{[^}]*\brepairWebsiteCustomerApplication\b[^}]*\} from ['"]\.\/customerApplicationRepair['"]/, 'website facade exposes repair')
mustMatch(websiteRepair, /import\s*\{[^}]*\bensureWebsitePowerOfAttorney\b[^}]*\}\s*from ['"]\.\/customerApplicationLegal['"]/, 'repair imports the legal owner')
mustInclude(websiteRepair, 'await ensureWebsitePowerOfAttorney({', 'website repair calls its legal owner')
mustInclude(websiteLegal, 'await ensureWebsiteAuthorizationChainFromPowerOfAttorney({', 'website legal owner materializes the authorization chain')
mustMatch(websiteLegal, /\.from\(['"]authorization_scopes['"]\)\s*\.insert\(\{[^}]*authorization_document_id:\s*authorizationDocumentId/, 'website repair writes scopes linked to the authorization document')

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
mustMatch(opsDb, /export \{[^}]*\bcreateSupplierSwitchRequest\b[^}]*\} from ['"]\.\/db\.part-2['"]/, 'operations facade exports the switch owner')
mustInclude(opsSwitchOwner, 'await resolveAuthorizationDocumentIdForPowerOfAttorney({', 'switch creation resolves the authorization document from POA')
mustInclude(opsSwitchOwner, 'authorization_document_id: authorizationDocumentId', 'switch creation stores the exact authorization document')
mustInclude(prodatSwitch, 'authorization_document_id: authorizationDocumentId', 'switch outbound/intent payload must carry authorization document')
mustInclude(prodatSwitch, 'resolveAuthorizationDocumentIdForPowerOfAttorney', 'Z03 prepare resolves chain for legacy switch rows')

// Z01 passes the same data request through the gateway into the message draft.
mustMatch(prodatZ01, /import \{ renderAndQueueCustomerMasterdataZ01 \} from ['"]@\/lib\/ediel\/intent\/renderGateway['"]/, 'Z01 imports the sanctioned render gateway')
mustMatch(prodatZ01, /await renderAndQueueCustomerMasterdataZ01\(\{[^}]*\bdataRequest,/, 'Z01 passes its data request to the gateway')
mustMatch(z01Gateway, /import\s*\{[^}]*\bbuildCustomerMasterdataZ01Draft\b[^}]*\}\s*from ['"]@\/lib\/ediel\/intent\/renderers\/customerMasterdataZ01['"]/, 'gateway imports the Z01 renderer')
mustMatch(z01Gateway, /await buildCustomerMasterdataZ01Draft\(\{[^}]*dataRequest:\s*params\.dataRequest/, 'gateway passes the same request to the renderer')
mustInclude(z01Renderer, 'authorization_document_id: input.dataRequest.authorization_document_id ?? null', 'Z01 draft payload carries the authorization document')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-poa-authorization-chain-regression: all checks passed')
