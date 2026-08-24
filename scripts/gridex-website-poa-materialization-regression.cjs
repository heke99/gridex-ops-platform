#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const wrapper = fs.readFileSync(path.join(root, 'lib/customer-operations/requestMissingFacilityInformation.ts'), 'utf8')
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260824140830_website_poa_materialization_and_grid_owner_send_guard.sql'), 'utf8')
const corePath = path.join(root, 'lib/customer-operations/requestMissingFacilityInformationCore.ts')

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

expect(fs.existsSync(corePath), 'facility information core implementation must remain available')
expect(wrapper.includes(".select('id,grid_owner_id,selected_grid_owner_id,resolution_status')"), 'wrapper must inspect canonical grid owner separately from selected candidate')
expect(wrapper.includes('if (!canonicalGridOwnerId)'), 'wrapper must block when exact site has no canonical grid owner')
expect(wrapper.includes("'grid_owner_verification_required'"), 'wrapper must expose a typed manual-review blocker')
expect(wrapper.includes('verified_for_customer_flow === true'), 'wrapper must require a customer-flow verified owner')
expect(wrapper.includes('technical_owner_only !== true'), 'wrapper must reject technical-only owners')
expect(wrapper.includes("clean(owner.verification_status) === 'verified'"), 'wrapper must require verified owner status')

expect(migration.includes('gridex_materialize_signed_website_poa_snapshot'), 'migration must materialize signed website POA snapshot')
expect(migration.includes("'source', 'locked_legal_bundle_document'"), 'POA snapshot must derive from locked legal bundle document')
expect(migration.includes("'scopes', new.signed_scope_snapshot"), 'snapshot must preserve exact signed scopes')
expect(migration.includes('gridex_bind_poa_authorization_document'), 'migration must bind canonical authorization document back to POA')
expect(migration.includes('gridex_assert_verified_site_owner_for_manual_outbox'), 'transport must have a database-level verified-site-owner guard')
expect(migration.includes("new.status not in ('queued','sending')"), 'transport guard must protect both queue and send transitions')
expect(migration.includes('v_request_grid_owner_id is distinct from v_site_grid_owner_id'), 'transport guard must require exact request/site owner match')

console.log('gridex website POA materialization regression: ok')
