#!/usr/bin/env node
// Static regression for the website customer-application production fixes.
// This guards the real `/api/v1/website/customer-applications` code path from
// regressing back to metadata-only canonical fields or final legal e-mail
// dispatch when readiness says agreement confirmation is not allowed.

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
let failures = 0

function expect(condition, message) {
  if (!condition) {
    failures += 1
    console.error(`FAIL: ${message}`)
  } else {
    console.log(`OK: ${message}`)
  }
}

const website = read('lib/website/customerApplications.ts')
const manual = read('lib/customer-operations/requestMissingFacilityInformation.ts')
const requests = read('lib/energy/gridOwnerRequests.ts')
const migration = read('supabase/migrations/20260708210000_website_application_canonical_dispatch_alignment.sql')

expect(
  /function explicitMeteringGridAreaCode/.test(website) &&
    /function explicitMeteringPriceAreaCode/.test(website) &&
    /function explicitMeteringGridOwnerId/.test(website),
  'website flow has canonical metering context helpers',
)
expect(
  /async function patchMeteringPointCanonicalFields/.test(website) &&
    /\.from\('metering_points'\)[\s\S]{0,220}\.update\(patch\)/.test(website) &&
    /await patchMeteringPointCanonicalFields\(\{[\s\S]{0,260}existing\.id/.test(website),
  'existing idempotent metering_points rows are patched with canonical fields',
)
expect(
  /grid_area_code:\s*gridAreaCode/.test(website) &&
    /price_area_code:\s*priceAreaCode/.test(website) &&
    /bidding_zone_code:\s*priceAreaCode/.test(website) &&
    /grid_owner_id:\s*gridOwnerId/.test(website) &&
    /estimated_annual_consumption_kwh:\s*annualConsumption/.test(website),
  'metering_points insert writes grid area, price area, bidding zone, grid owner and consumption canonical columns',
)
expect(
  /const canDispatchFinalAgreementMail = Boolean\([\s\S]*readiness\.canSendAgreementConfirmation === true[\s\S]*!facilityMissing[\s\S]*applicationStatus === 'ready_for_switch'/.test(website) &&
    /\.\.\.\(canDispatchFinalAgreementMail \? \['contract\.confirmation_sent', 'contract\.cooling_off_sent'\] : \[\]\)/.test(website),
  'final agreement/cooling-off e-mails are gated by readiness and never by legal evidence alone',
)
expect(
  /if \(readiness\.canSendAgreementConfirmation === true && !facilityMissing && applicationStatus === 'ready_for_switch'\)[\s\S]{0,120}pushWarning\(warnings, 'legal_email_pending'\)/.test(website),
  'legal_email_pending warning is only used when final agreement e-mail was allowed',
)
expect(
  /function resolveRequestPriceArea/.test(manual) &&
    /price_area_code/.test(manual) &&
    /bidding_zone_code/.test(manual) &&
    /energy_resolution', 'priceArea'/.test(manual),
  'manual facility request resolves price_area from site canonical fields and energy_resolution',
)
expect(
  /price_area:\s*requestPriceArea/.test(manual) &&
    /price_area:\s*input2\.priceArea \?\? null/.test(manual) &&
    /price_area:\s*normalizePriceArea\(request\.price_area\) \?\? requestPriceArea/.test(manual),
  'grid_owner_information_requests.price_area is written on insert, blocker rows and queued updates',
)
expect(
  /async function patchRequestCanonicalContext/.test(requests) &&
    /price_area:\s*input\.priceArea/.test(requests) &&
    /await patchRequestCanonicalContext\(\{[\s\S]{0,220}manualOpen/.test(requests) &&
    /await patchRequestCanonicalContext\(\{[\s\S]{0,220}existing/.test(requests),
  'shared grid-owner request helper patches existing manual/ediel requests with canonical context',
)
expect(
  /add column if not exists bidding_zone_code text/.test(migration) &&
    /update public\.metering_points/.test(migration) &&
    /update public\.grid_owner_information_requests/.test(migration) &&
    /create or replace function public\.gridex_metering_points_canonical_defaults/.test(migration) &&
    /create or replace function public\.gridex_grid_owner_information_request_defaults/.test(migration),
  'migration backfills and guards metering_points + grid_owner_information_requests canonical columns',
)

if (failures > 0) {
  console.error(`\n${failures} regression check(s) failed.`)
  process.exit(1)
}

console.log('\nWebsite application canonical/dispatch regression passed.')
