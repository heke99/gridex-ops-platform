import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('OPS Papilite-first GeoTorget precision architecture', () => {
  const worker = read('lib/energy/pendingExactAddressResolution.ts')
  const precision = read('lib/energy/opsPrecisionGridOwnerResolution.ts')
  const website = read('lib/energy/websiteResolutionCache.ts')
  const cron = read('app/api/internal/customer-operations/cron/route.ts')
  const facility = read('lib/facility/facilityLookupWorkflow.ts')
  const processContext = read('lib/customer-operations/customerSiteProcessContext.ts')
  const facilityCore = read('lib/customer-operations/requestMissingFacilityInformationCore.ts')
  const migration = read('supabase/migrations/20260825112000_ops_precision_resolution_authority.sql')

  it('keeps GeoTorget behind the internal OPS worker', () => {
    expect(cron).toContain('processPendingExactAddressResolutions')
    expect(worker).toContain('ensureLantmaterietExactAddressPoint')
    expect(website).not.toContain('ensureLantmaterietExactAddressPoint')
    expect(website).toContain('exact_address_provider_allowed: false')
  })

  it('accepts Papilite only after independent SVK verification at high confidence', () => {
    expect(precision).toContain('DEFAULT_OPS_PAPILITE_GRID_OWNER_MIN_CONFIDENCE = 0.95')
    expect(precision).toContain("supabaseService.rpc('gridex_lonlat_to_grid_area'")
    expect(precision).toContain("authority: 'svk_grid_area_geometry'")
    expect(migration).toContain('when s.boundary_distance_m >= 1500 then 0.95::numeric')
  })

  it('falls back to GeoTorget instead of guessing', () => {
    expect(worker.indexOf('resolveOpsPapiliteGridOwnerForSite'))
      .toBeLessThan(worker.indexOf('ensureLantmaterietExactAddressPoint'))
    expect(worker).toContain("exact_address_status: 'papilite_precision_insufficient_lantmateriet_not_configured'")
  })

  it('keeps site geography and facility verification resolution-bound', () => {
    expect(migration).toContain('canonical_site_geography_requires_resolution_binding')
    expect(migration).toContain('insert into public.customer_site_resolution')
    expect(facility).not.toContain('function updateResolution')
    expect(facility).toContain('TypeScript must not mutate that resolution in a second step')
  })

  it('never promotes selected_grid_owner_id into operational or external-send authority', () => {
    expect(processContext).not.toContain('site.selected_grid_owner_id')
    expect(processContext).toContain('clean(meteringPoint?.grid_owner_id) ?? clean(site.grid_owner_id)')
    expect(facilityCore).not.toContain('clean(site.selected_grid_owner_id)')
    expect(facilityCore).toContain('const gridOwnerId = clean(site.grid_owner_id)')
  })
})
