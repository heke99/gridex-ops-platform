#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  canonicalQuoteGridAreaCode,
  canonicalQuoteTimestamptz,
  canonicalQuoteValidUntil,
} from '../lib/pricing/quoteIntegrity.ts'

assert.equal(canonicalQuoteGridAreaCode(null), null)
assert.equal(canonicalQuoteGridAreaCode(undefined), null)
assert.equal(canonicalQuoteGridAreaCode(''), null)
assert.equal(canonicalQuoteGridAreaCode('   '), null)
assert.equal(canonicalQuoteGridAreaCode(' lka '), 'LKA')
assert.equal(
  canonicalQuoteGridAreaCode(null) === canonicalQuoteGridAreaCode(undefined),
  true,
  'Two unresolved grid-area values must not create a quote mismatch.',
)
assert.equal(
  canonicalQuoteGridAreaCode('lka') === canonicalQuoteGridAreaCode('LKA'),
  true,
  'Grid-area comparison must be case-insensitive.',
)
assert.equal(
  canonicalQuoteGridAreaCode(null) === canonicalQuoteGridAreaCode('LKA'),
  false,
  'A missing and a verified grid area must still mismatch.',
)

const source = fs.readFileSync('lib/pricing/websiteQuotes.ts', 'utf8')
assert.ok(source.includes('canonicalQuoteGridAreaCode('))
assert.ok(source.includes('canonicalQuoteTimestamptz('))
assert.ok(
  !source.includes(
    "String(quote.resolution_snapshot?.grid_area_code ?? '') !== canonicalResolution.gridAreaCode",
  ),
)
assert.ok(
  source.includes(
    'canonicalQuoteGridAreaCode(quote.grid_area_code) !== canonicalGridAreaCode',
  ),
)

const route = fs.readFileSync(
  'app/api/v1/website/quote/validate/route.ts',
  'utf8',
)
assert.ok(route.includes('details: error.details ?? null'))
assert.ok(route.includes('field: error.field'))

const integrity = fs.readFileSync('lib/pricing/quoteIntegrity.ts', 'utf8')
assert.ok(integrity.includes('export function canonicalQuoteTimestamptz'))
assert.ok(integrity.includes('export function canonicalQuoteGridAreaCode'))
assert.equal(
  canonicalQuoteValidUntil('2026-08-05T21:51:30.966+00:00'),
  canonicalQuoteTimestamptz('2026-08-05T21:51:30.966Z'),
)

console.log('website quote nullable grid-area regression: ok')
