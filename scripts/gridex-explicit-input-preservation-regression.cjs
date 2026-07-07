/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: explicit submitted energy-context values (grid_area_code,
// price_area_code, grid_owner_id) must always win over resolver output and
// must never be nulled by failed/uncertain resolver fallbacks.
// Covers the generalized LKA/SE4 mismatch class.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
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

function mustNotMatch(file, regex, why) {
  if (regex.test(read(file))) {
    failures.push(`Forbidden pattern ${regex} found in ${file} (${why})`)
  }
}

const apps = 'lib/website/customerApplications.ts'
const resolver = 'lib/energy/resolver.ts'

// 1. Central merge rule: explicit wins, resolver enriches.
mustMatch(apps, /gridAreaCode:\s*explicitGridAreaCode\s*\?\?\s*resolution\.gridAreaCode/, 'explicit grid_area_code must take precedence over resolver output')
mustMatch(apps, /priceArea:\s*\(explicitPriceAreaCode[^)]*\)\s*\?\?\s*resolution\.priceArea/, 'explicit price_area_code must take precedence over resolver output')
mustInclude(apps, 'resolver_grid_area_disagrees_with_explicit_input', 'resolver disagreement must be surfaced as warning, not silent overwrite')
mustInclude(apps, 'resolver_price_area_disagrees_with_explicit_input', 'resolver disagreement must be surfaced as warning, not silent overwrite')
mustInclude(apps, 'explicit_grid_area_code_preserved_without_master_match', 'explicit code preserved when master lookup fails')

// 2. upsertSite partial-address insert must not force grid columns to null.
const appsSrc = read(apps)
const fullPayloadIdx = appsSrc.indexOf('const fullPayload = {')
if (fullPayloadIdx === -1) {
  failures.push(`Missing fullPayload block in ${apps}`)
} else {
  const block = appsSrc.slice(fullPayloadIdx, fullPayloadIdx + 1600)
  for (const forbidden of ['price_area_code: null', 'grid_area_code: null', 'grid_owner_id: null']) {
    if (block.includes(forbidden)) {
      failures.push(`upsertSite partial-address insert still nulls explicit value: "${forbidden}" in ${apps}`)
    }
  }
  for (const required of ['grid_area_code: clean(site.grid_area_code)', 'price_area_code: clean(site.price_area_code)', 'grid_owner_id: clean(site.grid_owner_id)']) {
    if (!block.includes(required)) {
      failures.push(`upsertSite partial-address insert must persist explicit value: "${required}" in ${apps}`)
    }
  }
}

// 3. Top-level grid fields must be hoisted into site during normalization.
mustMatch(apps, /grid_area_code:\s*firstDefined\(nestedSite\?\.grid_area_code/, 'normalizeRawApplication must hoist top-level grid_area_code into site')
mustMatch(apps, /grid_owner_id:\s*firstDefined\(nestedSite\?\.grid_owner_id/, 'normalizeRawApplication must hoist top-level grid_owner_id into site')

// 4. Second address commit passes the full claimed grid trinity.
mustInclude(apps, 'claimedGridAreaCode: clean(siteAddress.grid_area_code)', 'address candidate commit must carry claimed grid area')
mustInclude(apps, 'claimedPriceAreaCode: clean(siteAddress.price_area_code)', 'address candidate commit must carry claimed price area')

// 5. Resolver saveResolution must be enrichment-only for site columns.
mustMatch(resolver, /grid_owner_id:\s*currentGridOwnerId\s*\?\?\s*resolvedGridOwnerId/, 'saveResolution must never replace existing grid_owner_id')
mustMatch(resolver, /grid_area_code:\s*currentGridAreaCode\s*\?\?\s*resolvedGridAreaCode/, 'saveResolution must never replace existing grid_area_code')
mustMatch(resolver, /price_area_code:\s*currentPriceAreaCode\s*\?\?\s*resolved\.priceArea/, 'saveResolution must never replace existing price_area_code')
mustNotMatch(resolver, /grid_owner_id:\s*resolved\.resolutionStatus === 'postal_suggested' \? null : resolved\.gridOwnerId,\n\s*grid_area_code/, 'postal_suggested must not null site grid columns')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-explicit-input-preservation-regression: all checks passed')
