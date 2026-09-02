/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs')

const migration = 'supabase/migrations/20260902100045_fix_website_poa_scope_and_grid_owner_aliases.sql'
const adminPage = 'app/admin/website-applications/[id]/page.tsx'
const source = fs.readFileSync(migration, 'utf8')
const admin = fs.readFileSync(adminPage, 'utf8')

const assertions = [
  [source.includes('add column if not exists expires_at'), 'legacy POA admin projection must exist'],
  [admin.includes("'id,status,scope,source,created_at,signed_at,expires_at'"), 'regression must cover the exact admin POA query that previously disappeared'],
  [source.includes('gridex_materialize_poa_scopes'), 'signed POA scope trigger must exist'],
  [source.includes('jsonb_array_elements_text(new.signed_scope_snapshot)'), 'scope trigger must derive only captured signed scopes'],
  [source.includes('power_of_attorney_scopes_poa_scope_uidx'), 'scope writes must be idempotent'],
  [source.includes('gridex_grid_owner_name_key'), 'grid-owner legal/trading-name normalization must exist'],
  [source.includes('candidate_count = 1'), 'grid-owner alias rebinding must fail closed on ambiguity'],
  [source.includes("nullif(btrim(ediel_id), '') is not null"), 'canonical grid owner must carry Ediel identity'],
  [source.includes('ops_grid_owner_id is not null'), 'canonical grid owner must be connected to OPS'],
]

const failures = assertions.filter(([ok]) => !ok).map(([, message]) => message)
if (failures.length) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log(`gridex-arbel-pipeline-regression: ${assertions.length} checks passed`)
