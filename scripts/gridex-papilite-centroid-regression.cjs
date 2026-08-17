#!/usr/bin/env node
const fs = require('node:fs')

const resolver = fs.readFileSync('lib/energy/resolver.ts', 'utf8')
const binding = fs.readFileSync('lib/energy/resolutionBinding.ts', 'utf8')
const business = fs.readFileSync('lib/partner-api/business.ts', 'utf8')
const migration = fs.readFileSync('supabase/migrations/20260817094125_papilite_verified_postal_learning.sql', 'utf8')
const materializationGuard = fs.readFileSync('supabase/migrations/20260817124500_site_resolution_materialization_guard.sql', 'utf8')

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
assert(resolver.includes('postal_centroid_not_facility_location'), 'centroid result carries non-facility warning')
assert(resolver.includes("resolutionStatus: 'postal_suggested'"), 'centroid result remains postal suggestion')
assert(resolver.includes('automationAllowed: false'), 'centroid result cannot enable Ediel automation')
assert(resolver.includes('function priceAreaCanMaterialize'), 'site price-area materialization has a dedicated trust gate')
assert(resolver.includes("resolved.priceAreaAssurance.status === 'verified'"), 'verified price area can materialize')
assert(resolver.includes("resolved.priceAreaAssurance.status === 'estimated'"), 'estimated price area is explicitly handled')
assert(resolver.includes('resolved.priceAreaAssurance.confidence >= MIN_POSTAL_PRICE_ASSURANCE_CONFIDENCE'), 'persistent site materialization keeps the stronger 0.8 trust floor')
assert(/resolvedGridOwnerId\s*=\s*resolved\.resolutionStatus === 'postal_suggested' \? null/.test(resolver), 'postal suggestion never materializes grid owner')
assert(/resolvedGridAreaCode\s*=\s*resolved\.resolutionStatus === 'postal_suggested' \? null/.test(resolver), 'postal suggestion never materializes grid area')
assert(binding.includes("normalized === 'postal_centroid'"), 'resolution binding preserves postal-centroid provenance')
assert(binding.includes('const MIN_ESTIMATED_PRICE_ASSURANCE_CONFIDENCE = 0.8'), 'normal estimated price-area evidence keeps 0.8 floor')
assert(binding.includes('const MIN_POSTAL_CENTROID_PRICE_ASSURANCE_CONFIDENCE = 0.7'), 'postal centroid has a separate indicative-pricing floor')
assert(binding.includes("assurance.source === 'postal_centroid'"), 'weaker centroid threshold is source-scoped, not global')
assert(business.includes("import { EnergyResolutionBindingError } from '@/lib/energy/resolutionBinding'"), 'Partner API imports canonical readiness error')
assert(business.includes('error instanceof EnergyResolutionBindingError'), 'Partner API preserves readiness failures instead of converting them to 500')
assert(migration.includes("not in ('facility_verified', 'manual_verified')"), 'global mapping learns only from verified sites')
assert(!migration.includes('company_id'), 'global mapping contains no tenant ID')
assert(!migration.includes('customer_id'), 'global mapping contains no customer ID')
assert(!migration.includes('customer_site_id'), 'global mapping contains no site ID')
assert(materializationGuard.includes("v_resolution.price_area_assurance_status = 'verified'"), 'database guard accepts verified price-area materialization')
assert(materializationGuard.includes("v_resolution.price_area_assurance_status = 'estimated'"), 'database guard handles estimated price-area materialization explicitly')
assert(materializationGuard.includes('v_resolution.price_area_assurance_confidence >= 0.8'), 'database guard keeps persistent estimated price-area floor at 0.8')
assert(materializationGuard.includes("lower(coalesce(v_resolution.resolution_status, '')) = 'postal_suggested'"), 'database guard identifies postal suggestions')
assert(materializationGuard.includes('new.grid_owner_id := null'), 'database guard clears unsafe/stale grid owner')
assert(materializationGuard.includes('new.grid_area_code := null'), 'database guard clears unsafe/stale grid area')
assert(materializationGuard.includes('else null\n  end;'), 'database guard clears unsafe/stale price area')
assert(materializationGuard.includes("v_resolution.result_snapshot->'coordinates'"), 'database guard sources exact coordinates from bound canonical resolution only')
assert(materializationGuard.includes("customer_site_id = new.id"), 'database guard prevents cross-site resolution binding')

if (process.exitCode) process.exit(process.exitCode)