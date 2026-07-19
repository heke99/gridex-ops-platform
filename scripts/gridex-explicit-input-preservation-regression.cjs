/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: submitted energy-context values (grid_area_code,
// price_area_code, grid_owner_id) are treated as CLAIMS, never as an
// authoritative route. The canonical policy (documented in
// mergeResolverWithExplicitInput and saveResolution):
//
//   1. Master-verified resolver data always wins.
//   2. Claimed values are retained ONLY as fallback/review metadata when the
//      resolver has no master-verified answer — they are never silently
//      nulled, and never make automation sendable on their own.
//   3. Any disagreement between claim and resolver is surfaced as a warning
//      and disables automation (no silent overwrite in either direction).
//   4. Manually verified site rows are protected from being overwritten by a
//      NOT fully verified resolver result.
//   5. Address candidate commits carry the full claimed grid trinity so the
//      claim survives into review instead of being dropped.
//
// Covers the generalized LKA/SE4 mismatch class.
const fs = require('fs')

// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
function read(file) {
  const source = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}

const failures = []

function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) {
    failures.push(`Missing "${needle}" in ${file} (${why})`)
  }
}

function mustMatch(file, regex, why) {
  if (!regex.test(read(file))) {
    failures.push(`Pattern ${regex} not found in ${file} (${why})`)
  }
}

const apps = 'lib/website/customerApplications.ts'
const resolver = 'lib/energy/resolver.ts'

// 1. Central merge rule: master-verified resolver wins; claims are fallback
//    only and never null a resolver answer.
mustInclude(apps, 'function mergeResolverWithExplicitInput', 'central claim/resolver merge exists')
mustMatch(apps, /gridAreaCode:\s*masterVerified\s*\?\s*resolution\.gridAreaCode\s*:\s*\(resolution\.gridAreaCode\s*\?\?\s*explicitGridAreaCode\)/, 'claimed grid_area_code is retained only when the resolver has no master-verified answer')
mustMatch(apps, /gridOwnerId:\s*masterVerified\s*\?\s*resolution\.gridOwnerId\s*:\s*\(resolution\.gridOwnerId\s*\?\?\s*explicitOwnerId\)/, 'claimed grid_owner_id is retained only when the resolver has no master-verified answer')

// 2. Disagreement between claim and resolver is surfaced, never silent.
mustInclude(apps, 'resolver_grid_area_disagrees_with_claimed_input', 'grid-area disagreement is surfaced as warning, not silent overwrite')
mustInclude(apps, 'resolver_price_area_disagrees_with_claimed_input', 'price-area disagreement is surfaced as warning, not silent overwrite')
mustInclude(apps, 'resolver_grid_owner_disagrees_with_claimed_input', 'grid-owner disagreement is surfaced as warning, not silent overwrite')
mustInclude(apps, 'claimed_energy_context_not_master_verified', 'claimed-only context is flagged for review')

// 3. Claims can never make automation sendable on their own; any disagreement
//    disables automation.
mustMatch(apps, /automationAllowed:\s*Boolean\(\s*resolution\.automationAllowed\s*&&\s*masterVerified\s*&&\s*!gridAreaDisagrees\s*&&\s*!priceAreaDisagrees\s*&&\s*!gridOwnerDisagrees,?\s*\)/, 'automation requires master verification and no claim disagreement')

// 4. Address candidate commits must carry the full claimed grid trinity.
mustInclude(apps, 'claimedGridOwnerId:', 'address candidate commit carries claimed grid owner')
mustInclude(apps, 'claimedGridAreaCode:', 'address candidate commit carries claimed grid area')
mustInclude(apps, 'claimedPriceAreaCode:', 'address candidate commit carries claimed price area')

// 5. Resolver persistence: manually verified rows are protected from being
//    overwritten by a not-fully-verified result; postal guesses never write
//    grid owner/area as facts.
mustInclude(resolver, 'protectedManualVerification', 'manual verification protection exists in saveResolution')
mustMatch(resolver, /if \(!protectedManualVerification \|\| fullyVerifiedResolution\)/, 'manually verified site rows are only overwritten by fully verified resolutions')
mustMatch(resolver, /grid_owner_id:\s*resolved\.resolutionStatus === 'postal_suggested' \? null : clean\(resolved\.gridOwnerId\)/, 'postal_suggested never records a guessed grid owner as fact')
mustMatch(resolver, /grid_area_code:\s*resolved\.resolutionStatus === 'postal_suggested' \? null : clean\(resolved\.gridAreaCode\)/, 'postal_suggested never records a guessed grid area as fact')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-explicit-input-preservation-regression: all checks passed')
