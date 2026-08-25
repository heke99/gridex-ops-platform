import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Papilite and OPS precision hardening', () => {
  const resolver = read('lib/energy/resolver.ts')
  const binding = read('lib/energy/resolutionBinding.ts')
  const websiteRoute = read('app/api/v1/website/energy-area/resolve/route.ts')
  const websiteCache = read('lib/energy/websiteResolutionCache.ts')
  const pendingExact = read('lib/energy/pendingExactAddressResolution.ts')
  const opsPrecision = read('lib/energy/opsPrecisionGridOwnerResolution.ts')
  const lantmateriet = read('lib/energy/lantmaterietExactAddress.ts')
  const sourceContractMigration = read('supabase/migrations/20260825091402_allow_postal_centroid_price_area_assurance_source.sql')
  const precisionMigration = read('supabase/migrations/20260825112000_ops_precision_resolution_authority.sql')

  it('keeps the public website Papilite-first and independent of exact-address providers', () => {
    expect(resolver).toContain("const PAPILITE_DEFAULT_URL = 'https://api.papapi.se/lite/'")
    expect(resolver).toContain("endpoint.searchParams.set('query', postalCode)")
    expect(resolver).toContain("endpoint.searchParams.set('format', 'json')")
    expect(resolver).toContain("endpoint.searchParams.set('apikey', apiKey)")
    expect(resolver).not.toContain("endpoint.searchParams.set('street'")
    expect(resolver).not.toContain("endpoint.searchParams.set('street_number'")
    expect(websiteCache).toContain("const CACHE_SCHEMA_VERSION = 'website-energy-resolution-v2-papilite-first'")
    expect(websiteCache).toContain('street: null')
    expect(websiteCache).toContain('streetNumber: null')
    expect(websiteCache).toContain("resolution_mode: 'website_price_area_only'")
    expect(websiteCache).toContain('exact_address_provider_allowed: false')
    expect(websiteCache).not.toContain('ensureLantmaterietExactAddressPoint')
  })

  it('keeps public Papilite provenance price-area-only', () => {
    expect(resolver).toContain("provider: 'papilite_postal_centroid'")
    expect(resolver).toContain("coordinate_scope: 'postal_centroid'")
    expect(resolver).toContain('postal_centroid_not_facility_location')
    expect(resolver).toContain("resolutionStatus: 'postal_suggested'")
    expect(resolver).toContain("'price_area_only'")
    expect(resolver).toContain('automationAllowed: false')
    expect(binding).toContain('const MIN_POSTAL_CENTROID_PRICE_ASSURANCE_CONFIDENCE = 0.7')
    expect(binding).toContain("assurance.source === 'postal_centroid'")
  })

  it('keeps the internal source compatible with the public V1 contract', () => {
    expect(sourceContractMigration).toContain('customer_site_resolution_price_area_assurance_source_check')
    expect(sourceContractMigration).toContain("'postal_centroid'::text")
    expect(websiteRoute).toContain("if (source === 'postal_centroid') return 'postal_consensus'")
    expect(websiteRoute).toContain('source: publicPriceAreaAssuranceSource(resolution.priceAreaAssurance.source)')
    expect(websiteRoute).not.toContain('source: resolution.priceAreaAssurance.source,')
  })

  it('allows Papilite to become an OPS precision candidate only through SVK authority', () => {
    expect(opsPrecision).toContain('export const DEFAULT_OPS_PAPILITE_GRID_OWNER_MIN_CONFIDENCE = 0.95')
    expect(opsPrecision).toContain("process.env.OPS_PAPILITE_GRID_OWNER_MIN_CONFIDENCE")
    expect(opsPrecision).toContain("supabaseService.rpc('gridex_lonlat_to_grid_area'")
    expect(opsPrecision).toContain("'ops_precision', 'papilite', 'postal_centroid', 'svk_arcgis_polygon', 'platform_grid_areas'")
    expect(opsPrecision).toContain("authority: 'svk_grid_area_geometry'")
    expect(opsPrecision).toContain("precision_provider: 'papilite_postal_centroid'")
    expect(opsPrecision).toContain('operational_route_verification_required_separately: true')
    expect(opsPrecision).toContain('normalizeGridOwnerIdToOps')
    expect(opsPrecision).toContain(".eq('provider', 'svk_arcgis')")
    expect(opsPrecision).toContain("if (geodata.stale)")
    expect(opsPrecision).toContain("if (currentPriceArea && currentPriceArea !== resolvedPriceArea)")
  })

  it('creates a canonical resolution instead of materializing a Papilite centroid as a site position', () => {
    expect(opsPrecision).toContain(".from('customer_site_resolution')")
    expect(opsPrecision).toContain("resolution_status: 'grid_area_master_validated'")
    expect(opsPrecision).toContain("price_area_assurance_source: 'postal_centroid'")
    expect(opsPrecision).toContain("resolver_version: 'ops-precision-v1'")
    expect(opsPrecision).toContain('automation_allowed: false')
    expect(opsPrecision).toContain("resolution_id: resolutionId")
    expect(opsPrecision).toContain(".from('customer_sites')")
    expect(opsPrecision).not.toContain("latitude: input.centroid.latitude")
    expect(opsPrecision).not.toContain("longitude: input.centroid.longitude")
    expect(opsPrecision).toContain('exact_address_point_materialized: false')
  })

  it('runs Papilite/SVK before GeoTorget and uses GeoTorget only on insufficient precision', () => {
    expect(pendingExact).toContain('const papilite = await resolveOpsPapiliteGridOwnerForSite')
    expect(pendingExact).toContain('const exact = await ensureLantmaterietExactAddressPoint')
    expect(pendingExact.indexOf('const papilite = await resolveOpsPapiliteGridOwnerForSite'))
      .toBeLessThan(pendingExact.indexOf('const exact = await ensureLantmaterietExactAddressPoint'))
    expect(pendingExact).toContain("resolutionMode: 'canonical_papilite_svk'")
    expect(pendingExact).toContain("resolutionMode: 'canonical_svk_exact_point'")
    expect(pendingExact).toContain("exact_address_status: 'papilite_precision_insufficient_lantmateriet_not_configured'")
    expect(pendingExact).not.toContain('applyUniqueSvkPostalGridOwnerToSite')
    expect(pendingExact).not.toContain('applyPapiliteProvisionalGridOwner')
    expect(lantmateriet).toContain("const DEFAULT_BASE_URL = 'https://api.lantmateriet.se/distribution/produkter/belagenhetsadress/v4.2'")
  })

  it('derives high Papilite confidence from one unique SVK area and distance to its boundary', () => {
    expect(precisionMigration).toContain('select distinct g.grid_area_code')
    expect(precisionMigration).toContain('where u.match_count = 1')
    expect(precisionMigration).toContain('extensions.ST_Covers(g.geometry, p.geom)')
    expect(precisionMigration).toContain('extensions.ST_Distance(p.geom, extensions.ST_Boundary(a.geometry))')
    expect(precisionMigration).toContain('when s.boundary_distance_m >= 1500 then 0.95::numeric')
    expect(precisionMigration).toContain('when s.boundary_distance_m >= 2500 then 0.97::numeric')
    expect(precisionMigration).toContain('when s.boundary_distance_m >= 5000 then 0.99::numeric')
  })

  it('makes bound customer_site_resolution the canonical site geography authority', () => {
    expect(precisionMigration).toContain('canonical_site_geography_requires_resolution_binding')
    expect(precisionMigration).toContain("lower(coalesce(new.resolution_status, '')) in")
    expect(precisionMigration).toContain('new.grid_owner_id is distinct from old.grid_owner_id')
    expect(precisionMigration).toContain('new.grid_area_code is distinct from old.grid_area_code')
    expect(precisionMigration).toContain('new.price_area_code is distinct from old.price_area_code')
    expect(precisionMigration).toContain('customer_site_id = new.id')
    expect(precisionMigration).toContain('new.grid_owner_id := v_resolution.grid_owner_id')
    expect(precisionMigration).toContain('new.grid_area_code := v_resolution.grid_area_code')
  })

  it('makes facility completion create and bind one atomic facility-verified resolution', () => {
    expect(precisionMigration).toContain('facility_request_requires_bound_canonical_site_owner')
    expect(precisionMigration).toContain('insert into public.customer_site_resolution')
    expect(precisionMigration).toContain("'facility_verified',1")
    expect(precisionMigration).toContain("'verified','facility_data',1")
    expect(precisionMigration).toContain('resolution_id=v_resolution_id')
    expect(precisionMigration).toContain("resolver_version")
    expect(precisionMigration).toContain("'facility-response-v2'")
    expect(precisionMigration).toContain("'atomic_completion',true")
  })
})