/* eslint-disable @typescript-eslint/no-require-imports */
// Regression: offer_reference -> price_plan_id UUID -> price_plan_version_id
// UUID resolution. A valid public offer must never produce a price_plan
// blocker or the price_plan_id_not_verified_uuid warning; an offer with a
// broken price plan mapping must fail closed with a precise error.
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

const apps = 'lib/website/customerApplications.ts'
const review = 'lib/website/applicationReview.ts'

// 1. Resolved offer UUIDs merged into the application body before readiness.
mustInclude(apps, 'price_plan_id: selectedPublicOffer.price_plan_id ?? body.price_plan_id', 'resolved offer UUIDs must reach readiness assessment')
mustInclude(apps, 'price_plan_version_id: selectedPublicOffer.price_plan_version_id ?? body.price_plan_version_id', 'version UUID merged too')

// 2. Readiness no longer treats offer_reference as a price plan id.
const reviewSrc = read(review)
const pricePlanIdx = reviewSrc.indexOf('const pricePlanId = firstText(input, [')
const pricePlanBlock = reviewSrc.slice(pricePlanIdx, reviewSrc.indexOf(']', pricePlanIdx))
if (pricePlanBlock.includes('offer_reference')) {
  failures.push('applicationReview pricePlanId candidates must not include offer_reference')
}
mustInclude(review, 'const offerReference = firstText(input, [', 'offer reference detected separately')
mustInclude(review, 'isUuid(pricePlanId) || offerReference || pricePlanDefinition', 'offer reference counts as valid price plan source at readiness')

// 3. Fail-closed contract creation on broken offer mapping.
mustInclude(apps, 'public_offer_price_plan_mapping_invalid', 'precise blocker code for broken offer mapping')
mustInclude(apps, '!isUuid(selected.pricePlanId) || !isUuid(selected.pricePlanVersionId)', 'both UUIDs required when offer resolved')

// 4. selectedOfferFields keeps offer-first UUID precedence with UUID-gated client fallbacks.
mustInclude(apps, 'pricePlanId: offer?.price_plan_id ?? cleanUuid(contract?.price_plan_id)', 'offer wins; client fallback UUID-gated')

// 5. public-contracts chain: the offer reference produced by the public API is
//    resolvable by the applications API (same resolver module).
mustInclude('lib/website/publicContracts.ts', 'publicOfferReference', 'offer reference issuing')
mustInclude(apps, 'resolvePublicContractOffer', 'applications API resolves the same references')

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`)
  process.exit(1)
}
console.log('gridex-price-plan-offer-mapping-regression: all checks passed')
