/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')

const checks = [
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'platform_grid_owners'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'platform_grid_areas'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'platform_grid_area_geometries'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'customer_site_resolution'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'grid_owner_information_requests'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'gridex_point_to_grid_area'],
  ['supabase/migrations/20260611100000_energy_resolver_grid_area_operations.sql', 'gridex_import_grid_area_geojson_feature'],
  ['lib/energy/resolver.ts', 'resolveEnergyContext'],
  ['lib/energy/resolver.ts', 'publicPriceAreaByPostalCode'],
  ['lib/energy/gridOwnerRequests.ts', 'ensureGridOwnerInformationRequest'],
  ['lib/energy/gridOwnerRequests.ts', 'markFacilityDataReceived'],
  ['lib/website/applicationReview.ts', 'canRequestGridOwnerInformation'],
  ['lib/website/applicationReview.ts', 'facilityVerified'],
  ['lib/website/customerApplications.ts', 'runEnergyResolution'],
  ['lib/website/customerApplications.ts', 'ensureGridOwnerInformationRequest'],
  ['app/admin/website-applications/actions.ts', 'resolveWebsiteApplicationEnergyAction'],
  ['app/admin/website-applications/actions.ts', 'requestWebsiteApplicationGridOwnerInfoAction'],
  ['app/admin/website-applications/actions.ts', 'markWebsiteApplicationFacilityDataReceivedAction'],
  ['app/admin/website-applications/page.tsx', 'Kör adressmatchning'],
  ['app/admin/website-applications/page.tsx', 'Begär uppgifter från nätägare'],
  ['app/api/platform/energy/resolve/route.ts', 'resolveEnergyContext'],
  ['app/api/platform/energy/import/svk-geometries/route.ts', 'N%C3%A4tomr%C3%A5den_240524_2_WFL1'],
  ['app/api/public/energy-area/route.ts', 'publicPriceAreaByPostalCode'],
]

let ok = true
for (const [file, needle] of checks) {
  const content = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (!content.includes(needle)) {
    ok = false
    console.error(`Missing ${needle} in ${file}`)
  }
}

if (!ok) process.exit(1)
console.log(`energy-resolver-grid-owner-regression: ${checks.length} checks passed`)
