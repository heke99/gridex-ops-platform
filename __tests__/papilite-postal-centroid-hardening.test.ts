import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Papilite postal centroid hardening', () => {
  const resolver = read('lib/energy/resolver.ts')
  const binding = read('lib/energy/resolutionBinding.ts')
  const websiteRoute = read('app/api/v1/website/energy-area/resolve/route.ts')
  const websiteCache = read('lib/energy/websiteResolutionCache.ts')
  const pendingExact = read('lib/energy/pendingExactAddressResolution.ts')
  const migration = read('supabase/migrations/20260817094125_papilite_verified_postal_learning.sql')
  const materializationGuard = read('supabase/migrations/20260817124500_site_resolution_materialization_guard.sql')

  it('uses PAP/API Lite as postcode-only enrichment', () => {
    expect(resolver).toContain("const PAPILITE_DEFAULT_URL = 'https://api.papapi.se/lite/'")
    expect(resolver).toContain("endpoint.searchParams.set('query', postalCode)")
    expect(resolver).toContain("endpoint.searchParams.set('format', 'json')")
    expect(resolver).toContain("endpoint.searchParams.set('apikey', apiKey)")
    expect(resolver).not.toContain("endpoint.searchParams.set('street'")
    expect(resolver).not.toContain("endpoint.searchParams.set('street_number'")
  })

  it('keeps postcode coordinates separate from exact address cache', () => {
    expect(resolver).toContain('postal_centroid|')
    expect(resolver).toContain("provider: 'papilite_postal_centroid'")
    expect(resolver).toContain("coordinate_scope: 'postal_centroid'")
    expect(resolver).toContain("raw.coordinate_scope === 'postal_centroid'")
    expect(resolver).toContain("clean(data.provider) === 'papilite_postal_centroid'")
  })

  it('lets the website obtain SE1-SE4 without exact-address providers', () => {
    expect(binding).toContain('const MIN_POSTAL_CENTROID_PRICE_ASSURANCE_CONFIDENCE = 0.7')
    expect(binding).toContain("assurance.source === 'postal_centroid'")
    expect(websiteCache).toContain("const CACHE_SCHEMA_VERSION = 'website-energy-resolution-v2-papilite-first'")
    expect(websiteCache).toContain('street: null')
    expect(websiteCache).toContain('streetNumber: null')
    expect(websiteCache).toContain("resolution_mode: 'website_price_area_only'")
    expect(websiteCache).toContain('exact_address_provider_allowed: false')
  })

  it('keeps internal Papilite provenance compatible with the public V1 response contract', () => {
    expect(websiteRoute).toContain("if (source === 'postal_centroid') return 'postal_consensus'")
    expect(websiteRoute).toContain('source: publicPriceAreaAssuranceSource(resolution.priceAreaAssurance.source)')
    expect(websiteRoute).not.toContain('source: resolution.priceAreaAssurance.source,')
  })

  it('never promotes Papilite centroid to Ediel-capable canonical grid-owner verification', () => {
    expect(resolver).toContain("resolutionStatus: 'postal_suggested'")
    expect(resolver).toContain('automationAllowed: false')
    expect(resolver).toContain('postal_centroid_not_facility_location')
    expect(resolver).toContain("'price_area_only'")
    expect(pendingExact).toContain('selected_grid_owner_id: normalizedOwner.opsGridOwnerId')
    expect(pendingExact).not.toMatch(/\n\s+grid_owner_id:\s*normalizedOwner\.opsGridOwnerId/)
    expect(pendingExact).toContain("grid_owner_resolution_mode: 'provisional_facility_lookup_only'")
  })

  it('uses Papilite-derived provisional owner above 65 percent and Lantmateriet only as fallback', () => {
    expect(pendingExact).toContain('const MIN_PAPILITE_GRID_OWNER_CONFIDENCE = 0.65')
    expect(pendingExact).toContain(".eq('provider', 'papilite_postal_centroid')")
    expect(pendingExact).toContain("supabaseService.rpc('gridex_lonlat_to_grid_area'")
    expect(pendingExact).toContain('confidence <= MIN_PAPILITE_GRID_OWNER_CONFIDENCE')
    expect(pendingExact).toContain("source: 'papilite_postal_centroid_svk_polygon'")
    expect(pendingExact).toContain("purpose: 'facility_information_routing'")
    expect(pendingExact.indexOf('const papilite = await applyPapiliteProvisionalGridOwner'))
      .toBeLessThan(pendingExact.indexOf('const exact = await ensureLantmaterietExactAddressPoint'))
    expect(pendingExact).toContain("exact_address_status: 'papilite_insufficient_lantmateriet_not_configured'")
  })

  it('materializes only safe price area while leaving suggested grid context unbound', () => {
    expect(resolver).toContain('function priceAreaCanMaterialize')
    expect(resolver).toContain("resolved.priceAreaAssurance.status === 'verified'")
    expect(resolver).toContain("resolved.priceAreaAssurance.status === 'estimated'")
    expect(resolver).toContain('resolved.priceAreaAssurance.confidence >= MIN_POSTAL_PRICE_ASSURANCE_CONFIDENCE')
    expect(resolver).toContain("const resolvedGridOwnerId = resolved.resolutionStatus === 'postal_suggested' ? null")
    expect(resolver).toContain("const resolvedGridAreaCode = resolved.resolutionStatus === 'postal_suggested' ? null")
  })

  it('enforces fail-closed materialization again at the database boundary', () => {
    expect(materializationGuard).toContain("v_resolution.price_area_assurance_status = 'verified'")
    expect(materializationGuard).toContain("v_resolution.price_area_assurance_status = 'estimated'")
    expect(materializationGuard).toContain('v_resolution.price_area_assurance_confidence >= 0.8')
    expect(materializationGuard).toContain("lower(coalesce(v_resolution.resolution_status, '')) = 'postal_suggested'")
    expect(materializationGuard).toContain('new.grid_owner_id := null')
    expect(materializationGuard).toContain('new.grid_area_code := null')
    expect(materializationGuard).toContain("v_resolution.result_snapshot->'coordinates'")
    expect(materializationGuard).toContain('customer_site_id = new.id')
  })

  it('learns shared mapping only from verified tenant sites and copies no tenant identity', () => {
    expect(migration).toContain("not in ('facility_verified', 'manual_verified')")
    expect(migration).toContain("'learned_from', 'verified_customer_site'")
    expect(migration).not.toContain('company_id')
    expect(migration).not.toContain('customer_id')
    expect(migration).not.toContain('customer_site_id')
  })
})