#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const root = process.cwd()
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx|cjs|json)$/.test(file) ? source.replace(/"/g, "'") : source
}
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
const businessKey = read('lib/website/customerApplicationSchemas.ts')
const normalizeCore = read('lib/website/customerApplicationCore.ts')
const packageJson = read('package.json')
const goldenPath = read('scripts/gridex-remaining-masterpoints-golden-path-regression.cjs')

expect(
  readiness.includes("'site.facility_id'") && readiness.includes("'metering_point.metering_point_id'"),
  'website readiness consumes facility and metering identities from the submitted application'
)
expect(
  readiness.includes("'metering_point.site_facility_id'") &&
    readiness.includes("'metering_point.anlage_id'"),
  'readiness treats metering_point.site_facility_id/anlage_id as facility identity (aligned with business key)'
)
expect(
  readiness.includes('meteringPointId &&') && readiness.includes('facilityId &&') && readiness.includes("status = 'ready_for_switch'"),
  'a complete submitted facility/metering identity participates in ready_for_switch'
)
expect(
  onboarding.includes('normalizeFacilityId(siteInput?.facility_id)') &&
    onboarding.includes('normalizeFacilityId(meterInput?.site_facility_id)') &&
    onboarding.includes('normalizeFacilityId(meterInput?.anlage_id)') &&
    onboarding.includes('metering_point_id: canonicalMeteringPointId'),
  'website onboarding persists facility identity from site or metering_point into canonical master data'
)
expect(
  onboarding.includes('normalizeMeteringPointId(') &&
    facilityErrors.includes('export function normalizeMeteringPointId'),
  'website onboarding normalizes metering point IDs the same way as facility IDs'
)
expect(
  businessKey.includes('metering?.site_facility_id ?? metering?.anlage_id') &&
    businessKey.includes('normalizedFacilityToken'),
  'business-key hash already treats metering facility aliases as facility identity'
)
expect(
  normalizeCore.includes('nestedMeteringPoint?.site_facility_id') &&
    normalizeCore.includes('nestedMeteringPoint?.anlage_id'),
  'raw application normalization lifts metering facility aliases onto site.facility_id'
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
expect(
  packageJson.includes('gridex-website-facility-intake-regression.cjs') &&
    goldenPath.includes('gridex-website-facility-intake-regression.cjs'),
  'facility intake regression is wired into package.json and the OPS hardening golden path'
)

if (failures > 0) process.exit(1)
console.log('website facility intake regression: OK')
