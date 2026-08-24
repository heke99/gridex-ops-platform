/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: manual grid-owner e-mail recipient resolution is explicit and
// auditable — the system records WHICH address was selected and WHY
// (real contact vs safe override), warns loudly when production uses a safe
// override, and never silently sends to the wrong address.
const fs = require('fs')

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

const failures = []
function mustInclude(file, needle, why) {
  if (!read(file).includes(needle)) failures.push(`Missing "${needle}" in ${file} (${why})`)
}

const rmfi = 'lib/customer-operations/requestMissingFacilityInformationCore.ts'
const migration = 'supabase/migrations/20260707130000_gridex_manual_email_recipient_resolution.sql'

// Resolution model.
mustInclude(rmfi, 'ManualRecipientResolutionMode', 'resolution mode type')
for (const mode of ["'real_grid_owner_contact'", "'safe_recipient_override'", "'manual_override'", "'missing_contact'"]) {
  mustInclude(rmfi, mode, `resolution mode ${mode} modelled`)
}
mustInclude(rmfi, 'actual_grid_owner_contact_email', 'actual contact recorded even when overridden')
mustInclude(rmfi, 'selected_to_email', 'selected recipient recorded')
mustInclude(rmfi, 'contact_source_table', 'contact provenance recorded')
mustInclude(rmfi, 'contact_verified', 'verification state recorded')
mustInclude(rmfi, 'MANUAL_GRID_OWNER_SAFE_RECIPIENT', 'explicit env-gated safe recipient override')
mustInclude(rmfi, 'production_safe_override_warning', 'production override warning flag')
mustInclude(rmfi, 'production_safe_recipient_override', 'production override surfaces as visible warning')

// Persistence: outbox row + request metadata + operation event.
mustInclude(rmfi, 'recipient_resolution: recipientResolution', 'resolution persisted on outbox row')
mustInclude(rmfi, 'recipient_email: selectedToEmail', 'request stores the actually selected recipient')
mustInclude(migration, 'add column if not exists recipient_resolution jsonb', 'schema column for resolution evidence')

// Missing contact still blocks with a persisted request (never silent).
mustInclude(rmfi, "code: 'grid_owner_contact_required'", 'missing contact keeps precise blocker')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-manual-email-recipient-resolution-regression: all checks passed')