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
assert(/suggestedGridAreaCode: best\?\.gridAreaCode \?\? null/.test(resolver), 'postal fallback writes suggestion fields')
assert(/gridAreaCode: null/.test(resolver) && /gridOwnerId: null/.test(resolver), 'postal fallback does not mark grid area/grid owner as verified')
// Resolver persistence policy (claim-based model): a postal_suggested
// resolution resolves to null (a suggestion is never written to
// customer_sites as a send-ready grid owner) and manually verified rows are
// only overwritten by a FULLY verified resolution — stale values never win
// merely because they are non-null, and guesses never become facts.
assert(/resolved\.resolutionStatus === 'postal_suggested' \? null : clean\(resolved\.gridOwnerId\)/.test(resolver), 'postal suggestions are not saved to customer_sites as send-ready grid owner')
assert(/protectedManualVerification/.test(resolver) && /if \(!protectedManualVerification \|\| fullyVerifiedResolution\)/.test(resolver), 'manually verified site grid owner is only replaced by a fully verified resolution')
assert(/providerErrorCode: url \? null : 'missing_base_url'/.test(resolver), 'not configured geocoding reports missing_base_url instead of provider no-result')
if (process.exitCode) process.exit(process.exitCode)
