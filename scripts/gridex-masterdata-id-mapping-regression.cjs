/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: customer_sites.grid_owner_id must always reference the OPS
// grid_owners namespace. Submitted platform_grid_owners ids must be bridged
// via ops_grid_owner_id and unmappable ids must be dropped with a precise
// warning — never written as-is.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []

function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}

function mustNotMatch(file, regex, why) {
  if (regex.test(read(file))) failures.push(`Forbidden pattern ${regex} in ${file} (${why})`)
}

const bridge = 'lib/grid-owners/platformGridOwnerResolver.ts'
const apps = 'lib/website/customerApplications.ts'
const adminActions = 'app/admin/customers/actions.ts'

// Normalization helper exists and covers all namespaces.
mustInclude(bridge, 'export async function normalizeGridOwnerIdToOps', 'central OPS namespace normalization helper')
mustInclude(bridge, "source: 'platform_mapped'", 'platform ids must be bridged via ops_grid_owner_id')
mustInclude(bridge, 'platform_to_ops_grid_owner_mapping_missing', 'precise blocker warning when platform owner has no OPS mapping')
mustInclude(bridge, 'explicit_grid_owner_id_not_in_ops_masterdata', 'precise warning for unknown grid owner ids')

// Website intake normalizes explicit grid owner ids before merge/persist.
mustInclude(apps, 'normalizeGridOwnerIdToOps', 'website intake must normalize explicit grid_owner_id')
mustInclude(apps, 'explicitGridOwnerNormalization', 'normalization result must feed the merge rule')
// enrichApplicationWithEnergyResolution must not fall back to the raw explicit id.
mustNotMatch(apps, /grid_owner_id:\s*resolution\.gridOwnerId\s*\?\?\s*explicitGridOwnerIdFromInput/, 'raw explicit grid_owner_id must never bypass OPS normalization')

// Manual admin intake normalizes before customer_sites/metering_points insert.
mustInclude(adminActions, 'normalizeGridOwnerIdToOps', 'manual intake must normalize submitted grid_owner_id')
mustInclude(adminActions, 'gridOwnerNormalization.opsGridOwnerId', 'site insert must use OPS-normalized id')

// The resolver keeps mapping platform -> OPS for geo/master resolution paths.
mustInclude('lib/energy/resolver.ts', 'mapPlatformGridOwnerToOpsGridOwner', 'resolver platform->OPS bridge must remain')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-masterdata-id-mapping-regression: all checks passed')
