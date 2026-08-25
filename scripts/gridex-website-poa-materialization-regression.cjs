#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const wrapper = fs.readFileSync(path.join(root, 'lib/customer-operations/requestMissingFacilityInformation.ts'), 'utf8')
const poaMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260824140830_website_poa_materialization_and_grid_owner_send_guard.sql'), 'utf8')
const routingMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20260825093400_facility_geographic_owner_outbox_guard.sql'), 'utf8')
const corePath = path.join(root, 'lib/customer-operations/requestMissingFacilityInformationCore.ts')

function expect(condition, message) {
  if (!condition) throw new Error(message)
}

expect(fs.existsSync(corePath), 'facility information core implementation must remain available')
expect(wrapper.includes(".select('id,grid_owner_id,selected_grid_owner_id,grid_area_code,resolution_status,resolution_id')"), 'wrapper must inspect canonical geography separately from selected candidate')
expect(wrapper.includes('hasCanonicalGeographicGridOwner'), 'wrapper must require canonical site geography')
expect(wrapper.includes("'grid_area_master_validated'"), 'wrapper must accept canonical grid-area master validation')
expect(wrapper.includes("'grid_owner_verification_required'"), 'wrapper must expose a typed manual-review blocker')
expect(!wrapper.includes(".from('grid_owners')"), 'facility wrapper must not gate geography on grid-owner operational readiness')
expect(!wrapper.includes('verified_for_customer_flow'), 'facility wrapper must keep Ediel/customer-flow readiness separate from geographical ownership')
expect(!wrapper.includes('technical_owner_only'), 'facility wrapper must not treat technical-owner classification as geographical authority')

expect(poaMigration.includes('gridex_materialize_signed_website_poa_snapshot'), 'migration must materialize signed website POA snapshot')
expect(poaMigration.includes("'source', 'locked_legal_bundle_document'"), 'POA snapshot must derive from locked legal bundle document')
expect(poaMigration.includes("'scopes', new.signed_scope_snapshot"), 'snapshot must preserve exact signed scopes')
expect(poaMigration.includes('gridex_bind_poa_authorization_document'), 'migration must bind canonical authorization document back to POA')

expect(routingMigration.includes('gridex_assert_verified_site_owner_for_manual_outbox'), 'transport must retain a database-level site-owner guard')
expect(routingMigration.includes("v_request_type in ('facility_lookup', 'facility_identifier_lookup')"), 'transport guard must identify facility mail explicitly')
expect(routingMigration.includes('v_request_grid_owner_id is distinct from v_site_grid_owner_id'), 'facility transport must require exact request/site owner match')
expect(routingMigration.includes('v_site_grid_area_code'), 'facility transport must require canonical grid-area identity')
expect(routingMigration.includes('manual_facility_outbox_requires_canonical_geographic_site_owner'), 'facility transport must expose a dedicated geographical invariant')
expect(routingMigration.includes('v_owner_verified is distinct from true'), 'non-facility transport must retain stricter operational readiness')
expect(routingMigration.includes("new.status not in ('queued','sending')"), 'transport guard must protect both queue and send transitions')

console.log('gridex website POA materialization regression: ok')
