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
assert(/resolved\.resolutionStatus === 'postal_suggested' \? null : resolved\.gridOwnerId/.test(resolver), 'postal suggestions are not saved to customer_sites as send-ready grid owner')
assert(/providerErrorCode: url \? 'address_not_complete' : 'missing_base_url'/.test(resolver), 'not configured geocoding reports missing_base_url instead of provider no-result')
if (process.exitCode) process.exit(process.exitCode)
