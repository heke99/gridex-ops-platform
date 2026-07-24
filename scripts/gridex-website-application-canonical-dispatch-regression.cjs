#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
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
const context = read('lib/energy/meteringPointContext.ts')
const migration = read('supabase/migrations/20260708210000_website_application_canonical_dispatch_alignment.sql')

expect(
  /import \{ patchMeteringPointEnergyContext \} from ["']@\/lib\/energy\/meteringPointContext["']/.test(website) &&
    /patchMeteringPointEnergyContext\(\{[\s\S]{0,220}companyId:[\s\S]{0,120}meteringPointId:[\s\S]{0,120}resolution:/.test(website),
  'website flow applies the shared tenant-bound canonical metering context helper after onboarding',
)
expect(
  /\.from\(['"]metering_points['"]\)/.test(context) &&
    /\.eq\(['"]company_id['"], input\.companyId\)/.test(context) &&
    /\.eq\(['"]id['"], input\.meteringPointId\)/.test(context) &&
    /energy_resolution_id: input\.resolution\.resolutionId/.test(context),
  'shared helper patches the exact tenant metering point and binds it to the canonical resolution',
)
expect(
  /grid_area_code: input\.resolution\.gridAreaCode/.test(context) &&
    /price_area: canonicalArea/.test(context) &&
    /price_area_code: canonicalArea/.test(context) &&
    /bidding_zone_code: canonicalArea/.test(context) &&
    /grid_owner_id: input\.resolution\.gridOwnerId/.test(context) &&
    /resolution_status: ['"]needs_review['"]/.test(context) &&
    /energy_context_conflicts/.test(context),
  'canonical helper synchronizes full area context and blocks conflicting existing values for review',
)
expect(
  /const legalMailReady = Boolean\([\s\S]*WEBSITE_APPLICATION_SIGNED_CONTRACT_STATUS[\s\S]*agreementAttachment[\s\S]*contractLegalMailEvidenceReady/.test(website) &&
    /\.\.\.\(legalMailReady[\s\S]{0,80}contract\.confirmation_sent[\s\S]{0,80}contract\.cooling_off_sent/.test(website),
  'final agreement/cooling-off e-mails require a signed contract, immutable PDF and exact legal evidence',
)
expect(
  /const failedCommunication = communication\.results\.filter\(\(item\) => !item\.ok\)/.test(website) &&
    website.includes('initial_customer_communication_failed:'),
  'failed legal e-mail creation fails the durable continuation job so reconciliation can retry it',
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
    /metering_points_customer_site_canonical_idx/.test(migration) &&
    /grid_owner_information_requests_price_area_idx/.test(migration) &&
    /No trigger DDL here by design/.test(migration),
  'migration backfills and indexes canonical metering/request columns without unsafe trigger DDL',
)

if (failures > 0) {
  console.error(`\n${failures} regression check(s) failed.`)
  process.exit(1)
}

console.log('\nWebsite application canonical/dispatch regression passed.')
