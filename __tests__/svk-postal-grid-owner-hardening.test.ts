import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('SVK postcode grid-owner hardening', () => {
  const verifier = read('lib/energy/svkPostalGridOwnerVerification.ts')
  const pending = read('lib/energy/pendingExactAddressResolution.ts')
  const websiteCache = read('lib/energy/websiteResolutionCache.ts')
  const postalMaterialization = read('supabase/migrations/20260817083859_partner_postal_grid_materialization.sql')

  it('keeps postcode polygon intersection with canonical SVK geometry as an authoritative optional source', () => {
    expect(postalMaterialization).toContain('postal_polygon_grid_area_intersection')
    expect(postalMaterialization).toContain('st_area(st_intersection(p.geometry, g.geometry)) / p.postal_area')
    expect(verifier).toContain("const SVK_POSTAL_MATERIALIZATION_METHOD = 'postal_polygon_grid_area_intersection'")
    expect(verifier).toContain("authority: 'svk_grid_area_geometry'")
    expect(verifier).toContain('method: SVK_POSTAL_MATERIALIZATION_METHOD')
  })

  it('accepts only a unique >65% postcode/SVK match and binds it through customer_site_resolution', () => {
    expect(verifier).toContain('export const MIN_SVK_POSTAL_GRID_OWNER_CONFIDENCE = 0.65')
    expect(verifier).toContain('gridAreaCodes.length !== 1')
    expect(verifier).toContain('confidence <= MIN_SVK_POSTAL_GRID_OWNER_CONFIDENCE')
    expect(verifier).toContain(".from('customer_site_resolution')")
    expect(verifier).toContain("resolution_status: 'grid_area_master_validated'")
    expect(verifier).toContain("resolver_version: 'svk-postal-polygon-v2'")
    expect(verifier).toContain('resolution_id: resolutionId')
    expect(verifier).not.toContain('selected_grid_owner_id: verification.gridOwnerId')
  })

  it('reconciles incomplete site area when the matching SVK owner is already bound', () => {
    // Sites with grid_owner_id set but null/stale grid_area_code cannot use the
    // null-owner insert filter. Rebind a fresh resolution under the matching owner
    // so the materialization guard can project grid_area_code.
    expect(verifier).toContain('.eq(\'grid_owner_id\', verification.gridOwnerId)')
    expect(verifier).toContain('incomplete_matching_owner_reconcile')
    expect(verifier).toContain('resolution_id: resolutionId')
  })

  it('keeps learned and Papilite mappings out of postcode-polygon authority', () => {
    expect(verifier).toContain('SVK_POSTAL_MATERIALIZATION_METHOD')
    expect(verifier).toContain('const svkRows = allRows.filter')
    expect(verifier).toContain('active_non_svk_mapping_count')
  })

  it('keeps geographical owner identity separate from supplier-switch/Ediel readiness', () => {
    expect(verifier).toContain('operational_route_verification_required_separately: true')
    expect(pending).toContain('grid_owner_operational_verification_status')
    expect(pending).not.toContain("resolved.gridOwnerVerificationStatus === 'verified'")
  })

  it('uses the new OPS Papilite/SVK precision path before Lantmateriet', () => {
    const papiliteIndex = pending.indexOf('const papilite = await resolveOpsPapiliteGridOwnerForSite')
    const lantmaterietIndex = pending.indexOf('const exact = await ensureLantmaterietExactAddressPoint')
    expect(papiliteIndex).toBeGreaterThanOrEqual(0)
    expect(lantmaterietIndex).toBeGreaterThan(papiliteIndex)
    expect(pending).not.toContain('applyUniqueSvkPostalGridOwnerToSite')
    expect(pending).not.toContain('applyPapiliteProvisionalGridOwner')
  })

  it('keeps the public website price-area lookup Papilite/postcode-only', () => {
    expect(websiteCache).toContain("const CACHE_SCHEMA_VERSION = 'website-energy-resolution-v2-papilite-first'")
    expect(websiteCache).toContain('street: null')
    expect(websiteCache).toContain('streetNumber: null')
    expect(websiteCache).toContain('exact_address_provider_allowed: false')
  })
})