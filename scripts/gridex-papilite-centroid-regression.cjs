#!/usr/bin/env node
const fs = require('node:fs')

const resolver = fs.readFileSync('lib/energy/resolver.ts', 'utf8')
const binding = fs.readFileSync('lib/energy/resolutionBinding.ts', 'utf8')
const websiteRoute = fs.readFileSync('app/api/v1/website/energy-area/resolve/route.ts', 'utf8')
const websiteCache = fs.readFileSync('lib/energy/websiteResolutionCache.ts', 'utf8')
const pendingExact = fs.readFileSync('lib/energy/pendingExactAddressResolution.ts', 'utf8')
const svkPostal = fs.readFileSync('lib/energy/svkPostalGridOwnerVerification.ts', 'utf8')
const business = fs.readFileSync('lib/partner-api/business.ts', 'utf8')
const migration = fs.readFileSync('supabase/migrations/20260817094125_papilite_verified_postal_learning.sql', 'utf8')
const postalMaterialization = fs.readFileSync('supabase/migrations/20260817083859_partner_postal_grid_materialization.sql', 'utf8')
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
assert(resolver.includes("resolutionStatus: 'postal_suggested'"), 'Papilite centroid remains a price-area suggestion')
assert(resolver.includes('automationAllowed: false'), 'Papilite centroid cannot enable Ediel automation')
assert(resolver.includes('function priceAreaCanMaterialize'), 'site price-area materialization has a dedicated trust gate')
assert(resolver.includes("resolved.priceAreaAssurance.status === 'verified'"), 'verified price area can materialize')
assert(resolver.includes("resolved.priceAreaAssurance.status === 'estimated'"), 'estimated price area is explicitly handled')
assert(binding.includes("normalized === 'postal_centroid'"), 'resolution binding preserves postal-centroid provenance')
assert(binding.includes('const MIN_POSTAL_CENTROID_PRICE_ASSURANCE_CONFIDENCE = 0.7'), 'postal centroid has a separate indicative-pricing floor')

assert(websiteRoute.includes("if (source === 'postal_centroid') return 'postal_consensus'"), 'website API keeps internal postal-centroid provenance compatible with public V1 source enum')
assert(websiteRoute.includes('source: publicPriceAreaAssuranceSource(resolution.priceAreaAssurance.source)'), 'website API maps internal source before emitting the response')
assert(!websiteRoute.includes('source: resolution.priceAreaAssurance.source,'), 'website API never leaks unsupported internal postal-centroid enum directly')
assert(websiteCache.includes("const CACHE_SCHEMA_VERSION = 'website-energy-resolution-v2-papilite-first'"), 'website cache version invalidates old exact-address results')
assert(websiteCache.includes('street: null'), 'website resolver strips street from the public price-area lookup')
assert(websiteCache.includes('streetNumber: null'), 'website resolver strips house number from the public price-area lookup')
assert(websiteCache.includes("resolution_mode: 'website_price_area_only'"), 'website resolver records price-area-only mode')
assert(websiteCache.includes('exact_address_provider_allowed: false'), 'website resolver explicitly forbids exact-address providers')

assert(postalMaterialization.includes('postal_polygon_grid_area_intersection'), 'postcode mapping is materialized by postcode-polygon × grid-area intersection')
assert(postalMaterialization.includes('st_area(st_intersection(p.geometry, g.geometry)) / p.postal_area'), 'postcode confidence is the spatial overlap share')
assert(postalMaterialization.includes('Multiple candidates are intentionally preserved'), 'postcode materialization preserves ambiguity instead of guessing')

assert(svkPostal.includes('export const MIN_SVK_POSTAL_GRID_OWNER_CONFIDENCE = 0.65'), 'SVK postcode canonical threshold is 65 percent')
assert(svkPostal.includes("authority: 'svk_grid_area_geometry'"), 'SVK grid geometry is the grid-owner authority')
assert(svkPostal.includes("method: 'postal_polygon_grid_area_intersection'"), 'grid-owner verification uses postcode polygon intersection evidence')
assert(svkPostal.includes('gridAreaCodes.length !== 1'), 'multiple SVK grid-area candidates fail closed')
assert(svkPostal.includes('confidence <= MIN_SVK_POSTAL_GRID_OWNER_CONFIDENCE'), '65 percent and below requires precision fallback')
assert(svkPostal.includes("status: 'verified'"), 'unique high-confidence SVK postcode match becomes verified')
assert(svkPostal.includes('grid_owner_id: verification.gridOwnerId'), 'verified SVK postcode match writes canonical grid_owner_id')
assert(svkPostal.includes('grid_area_code: verification.gridAreaCode'), 'verified SVK postcode match writes canonical grid_area_code')
assert(svkPostal.includes("resolution_status: 'grid_area_master_validated'"), 'canonical postcode match records master-validated resolution status')
assert(svkPostal.includes('operational_route_verification_required_separately: true'), 'geographical owner verification remains separate from Ediel route readiness')

assert(pendingExact.includes('applyUniqueSvkPostalGridOwnerToSite'), 'OPS continuation checks canonical SVK postcode mapping first')
assert(!pendingExact.includes('applyPapiliteProvisionalGridOwner'), 'Papilite is not used as grid-owner authority')
assert(!pendingExact.includes('papilite_postal_centroid_svk_polygon'), 'Papilite centroid is not promoted to a grid-owner decision')
assert(pendingExact.includes("resolutionMode: 'canonical_svk_postal'"), 'unique postcode/SVK match wakes the job as canonical')
assert(pendingExact.includes("resolutionMode: 'canonical_svk_exact_point'"), 'exact-address fallback still resolves owner through SVK')
assert(pendingExact.includes('const exact = await ensureLantmaterietExactAddressPoint'), 'Lantmateriet exists only as exact-address precision fallback')
assert(
  pendingExact.indexOf('const svkPostal = await applyUniqueSvkPostalGridOwnerToSite') < pendingExact.indexOf('const exact = await ensureLantmaterietExactAddressPoint'),
  'SVK postcode verification runs before Lantmateriet precision fallback',
)
assert(pendingExact.includes("exact_address_status: 'svk_postal_insufficient_lantmateriet_not_configured'"), 'missing Lantmateriet does not change the SVK fail-closed result')
assert(pendingExact.includes('grid_owner_operational_verification_status'), 'operational route verification is recorded but does not define geographical owner identity')

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
assert(materializationGuard.includes('new.grid_owner_id := null'), 'database guard clears unsafe/stale grid owner when binding a postal-only resolution')
assert(materializationGuard.includes('new.grid_area_code := null'), 'database guard clears unsafe/stale grid area when binding a postal-only resolution')
assert(materializationGuard.includes("customer_site_id = new.id"), 'database guard prevents cross-site resolution binding')

if (process.exitCode) process.exit(process.exitCode)