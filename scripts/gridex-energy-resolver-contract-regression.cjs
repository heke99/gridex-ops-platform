#!/usr/bin/env node
const fs = require('node:fs')
function read(path) { return fs.readFileSync(path, 'utf8') }
function assert(condition, message) {
  if (!condition) { console.error(`✗ ${message}`); process.exitCode = 1 } else { console.log(`✓ ${message}`) }
}
const types = read('lib/energy/types.ts')
const resolver = read('lib/energy/resolver.ts')
assert(/suggestedGridAreaCode/.test(types), 'resolver result has suggested grid area fields')
assert(/suggestionSource/.test(types), 'resolver result has suggestion source')
assert(/providerHttpStatus/.test(types) && /providerErrorCode/.test(types), 'resolver diagnostics include provider status fields')
assert(/geocodeStatus\?: EnergyGeocodeStatus/.test(types), 'geocodeStatus is typed to the allowed external contract')
assert(/suggestedGridAreaCode: clean\(best\.grid_area_code\)/.test(resolver), 'postal fallback writes suggestion fields')
assert(/gridAreaCode: null/.test(resolver) && /gridOwnerId: null/.test(resolver), 'postal fallback does not mark grid area/grid owner as verified')
// Enrichment-only site update (explicit-input preservation batch): a
// postal_suggested resolution resolves to null and the update only ever fills
// missing values (currentGridOwnerId ?? resolvedGridOwnerId) — a suggestion is
// never written to customer_sites as a send-ready grid owner and an existing
// explicit value is never overwritten.
assert(/resolved\.resolutionStatus === 'postal_suggested' \? null : clean\(resolved\.gridOwnerId\)/.test(resolver), 'postal suggestions are not saved to customer_sites as send-ready grid owner')
assert(/grid_owner_id: currentGridOwnerId \?\? resolvedGridOwnerId/.test(resolver), 'site update is enrichment-only (existing explicit grid owner preserved)')
assert(/providerErrorCode: url \? 'address_not_complete' : 'missing_base_url'/.test(resolver), 'not configured geocoding reports missing_base_url instead of provider no-result')
if (process.exitCode) process.exit(process.exitCode)
