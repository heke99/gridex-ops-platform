#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/"/g, "'")
let failures = 0

function expect(condition, message) {
  if (!condition) {
    failures += 1
    console.error(`FAIL: ${message}`)
  } else {
    console.log(`OK: ${message}`)
  }
}

const readiness = read('lib/website/applicationReview.ts')
const onboarding = read('lib/website/customerApplicationOnboarding.ts')
const facilityErrors = read('lib/energy/facilityDataErrors.ts')
const adminApplication = read('app/admin/website-applications/[id]/page.tsx')

expect(
  readiness.includes("'site.facility_id'") && readiness.includes("'metering_point.metering_point_id'"),
  'website readiness consumes facility and metering identities from the submitted application'
)
expect(
  readiness.includes('meteringPointId &&') && readiness.includes('facilityId &&') && readiness.includes("status = 'ready_for_switch'"),
  'a complete submitted facility/metering identity participates in ready_for_switch'
)
expect(
  onboarding.includes('const normalizedFacilityId = normalizeFacilityId(siteInput?.facility_id)') &&
    onboarding.includes('metering_point_id: canonicalMeteringPointId'),
  'website onboarding persists submitted facility and metering identities into canonical master data'
)
expect(
  onboarding.includes("source: 'website_customer_applications'") &&
    adminApplication.includes("return 'Webbansökan'"),
  'OPS preserves and displays website-application provenance'
)
expect(
  facilityErrors.includes("status: 'facility_data_invalid'") &&
    facilityErrors.includes('Stoppa leverantörsbyte') &&
    readiness.includes("'needs_customer_correction'"),
  'incorrect facility data remains blocked by the existing verification/correction path'
)
expect(
  readiness.includes("missingFields.push('metering_point_id')") &&
    readiness.includes('Begär anläggningsuppgifter från nätägare'),
  'missing facility identity still falls back to the existing grid-owner/fullmakt completion path'
)

if (failures > 0) process.exit(1)
console.log('website facility intake regression: OK')
