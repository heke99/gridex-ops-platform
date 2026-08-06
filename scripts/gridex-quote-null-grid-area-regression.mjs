#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'

function normalizedGridArea(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().toUpperCase()
    : null
}

assert.equal(normalizedGridArea(null), null)
assert.equal(normalizedGridArea(undefined), null)
assert.equal(normalizedGridArea(''), null)
assert.equal(normalizedGridArea(' lka '), 'LKA')
assert.equal(
  normalizedGridArea(null) === normalizedGridArea(null),
  true,
  'Two unresolved grid-area values must not create a quote mismatch.',
)
assert.equal(
  normalizedGridArea('lka') === normalizedGridArea('LKA'),
  true,
  'Grid-area comparison must be case-insensitive.',
)
assert.equal(
  normalizedGridArea(null) === normalizedGridArea('LKA'),
  false,
  'A missing and a verified grid area must still mismatch.',
)

const source = fs.readFileSync('lib/pricing/websiteQuotes.ts', 'utf8')
assert.ok(source.includes('const snapshotGridAreaCode ='))
assert.ok(source.includes('const canonicalResolutionGridAreaCode ='))
assert.ok(!source.includes("String(quote.resolution_snapshot?.grid_area_code ?? '') !== canonicalResolution.gridAreaCode"))

const route = fs.readFileSync('app/api/v1/website/quote/validate/route.ts', 'utf8')
assert.ok(route.includes('details: error.details ?? null'))
assert.ok(route.includes('field: error.field'))

console.log('website quote nullable grid-area regression: ok')
