#!/usr/bin/env node
const fs = require('node:fs')

const resolver = fs.readFileSync('lib/energy/resolver.ts', 'utf8')
const migration = fs.readFileSync('supabase/migrations/20260817094125_papilite_verified_postal_learning.sql', 'utf8')

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ ${message}`)
    process.exitCode = 1
  } else {
    console.log(`✓ ${message}`)
  }
}

assert(resolver.includes("const PAPILITE_DEFAULT_URL = 'https://api.papapi.se/lite/'"), 'uses canonical PAP/API Lite endpoint')
assert(resolver.includes("endpoint.searchParams.set('query', postalCode)"), 'queries Papilite by postcode')
assert(resolver.includes("endpoint.searchParams.set('format', 'json')"), 'requests Papilite JSON format')
assert(resolver.includes("endpoint.searchParams.set('apikey', apiKey)"), 'sends Papilite API key as documented')
assert(!resolver.includes("endpoint.searchParams.set('street'"), 'does not send street to postcode centroid endpoint')
assert(!resolver.includes("endpoint.searchParams.set('street_number'"), 'does not pretend Papilite knows house numbers')
assert(resolver.includes("provider: 'papilite_postal_centroid'"), 'stores postcode centroid under explicit provider identity')
assert(resolver.includes("coordinate_scope: 'postal_centroid'"), 'marks Papilite coordinates as postcode centroid')
assert(resolver.includes('papilite_postal_centroid_not_facility_verification'), 'centroid result carries non-verification warning')
assert(resolver.includes("resolutionStatus: 'postal_suggested'"), 'centroid result remains postal suggestion')
assert(resolver.includes('automationAllowed: false'), 'centroid result cannot enable Ediel automation')
assert(/resolvedPriceAreaCode\s*=\s*resolved\.priceAreaAssurance\.status === 'verified' \|\| resolved\.priceAreaAssurance\.status === 'estimated'/.test(resolver), 'verified/estimated price area can be materialized to site')
assert(/resolvedGridOwnerId\s*=\s*resolved\.resolutionStatus === 'postal_suggested' \? null/.test(resolver), 'postal suggestion never materializes grid owner')
assert(/resolvedGridAreaCode\s*=\s*resolved\.resolutionStatus === 'postal_suggested' \? null/.test(resolver), 'postal suggestion never materializes grid area')
assert(migration.includes("not in ('facility_verified', 'manual_verified')"), 'global mapping learns only from verified sites')
assert(!migration.includes('company_id'), 'global mapping contains no tenant ID')
assert(!migration.includes('customer_id'), 'global mapping contains no customer ID')
assert(!migration.includes('customer_site_id'), 'global mapping contains no site ID')

if (process.exitCode) process.exit(process.exitCode)
