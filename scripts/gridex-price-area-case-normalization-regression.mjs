#!/usr/bin/env node
/**
 * H-011 / H-012 — case-insensitive Swedish price-area normalization for billing
 * base components, public fixed-offer completeness, and portfolio history filters.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  canonicalSwedishPriceArea,
  PRICE_AREAS,
} from '../lib/pricing/types.ts'

assert.equal(canonicalSwedishPriceArea('se3'), 'SE3')
assert.equal(canonicalSwedishPriceArea(' SE2 '), 'SE2')
assert.equal(canonicalSwedishPriceArea('SE1'), 'SE1')
assert.equal(canonicalSwedishPriceArea('xx'), null)
assert.equal(canonicalSwedishPriceArea(null), null)
assert.equal(canonicalSwedishPriceArea(''), null)
assert.equal(canonicalSwedishPriceArea(undefined), null)

for (const area of PRICE_AREAS) {
  assert.equal(canonicalSwedishPriceArea(area.toLowerCase()), area)
  assert.equal(canonicalSwedishPriceArea(` ${area.toLowerCase()} `), area)
}

const sourceResolver = fs.readFileSync('lib/pricing/priceSourceResolver.ts', 'utf8')
assert.ok(
  sourceResolver.includes('canonicalSwedishPriceArea'),
  'priceSourceResolver must normalize component price areas',
)
assert.ok(
  /filterBaseComponentsForUnderlay[\s\S]*canonicalSwedishPriceArea/.test(
    sourceResolver,
  ),
  'Underlay filter must compare canonical price areas',
)
assert.ok(
  !/area === "SE1" \|\|\s*\n\s*area === "SE2" \|\|\s*\n\s*area === "SE3" \|\|\s*\n\s*area === "SE4"/.test(
    sourceResolver,
  ),
  'Inline case-sensitive SE* equality checks must not remain in component parsing',
)

const publicContracts = fs.readFileSync('lib/website/publicContracts.ts', 'utf8')
assert.ok(
  publicContracts.includes('canonicalSwedishPriceArea'),
  'publicContracts must normalize published price areas',
)
assert.ok(
  /price_areas:[\s\S]{0,180}canonicalSwedishPriceArea/.test(publicContracts),
  'Offer price_areas projection must canonicalize area codes',
)
assert.ok(
  /price_area_code:[\s\S]{0,120}canonicalSwedishPriceArea/.test(
    publicContracts,
  ),
  'Portfolio monthly price projection must canonicalize price_area_code',
)

const portfolioRoute = fs.readFileSync(
  'app/api/v1/website/portfolio-prices/route.ts',
  'utf8',
)
assert.ok(
  /canonicalSwedishPriceArea\([\s\S]{0,80}price_area_code/.test(portfolioRoute) ||
    /String\(row\.price_area_code[\s\S]{0,40}toUpperCase\(/.test(portfolioRoute),
  'Portfolio historical filter must compare price areas case-insensitively',
)

const applications = fs.readFileSync(
  'lib/website/customerApplications.ts',
  'utf8',
)
assert.ok(
  /function explicitSiteGridAreaCode[\s\S]{0,220}normaliseGridAreaCode/.test(
    applications,
  ),
  'Application site grid writers must use normaliseGridAreaCode',
)
assert.ok(
  /function explicitMeteringGridAreaCode[\s\S]{0,220}normaliseGridAreaCode/.test(
    applications,
  ),
  'Application metering grid writers must use normaliseGridAreaCode',
)

const websiteQuotes = fs.readFileSync('lib/pricing/websiteQuotes.ts', 'utf8')
assert.ok(
  /grid_area_code:\s*canonicalQuoteGridAreaCode\(/.test(websiteQuotes),
  'Quote create must persist canonical grid_area_code',
)

console.log('price-area case normalization regression: ok')
