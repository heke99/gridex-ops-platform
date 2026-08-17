#!/usr/bin/env node

import assert from 'node:assert/strict'
import {
  isValidSwedishOrganizationNumber,
  syntheticSwedishOrganizationNumber,
} from '../e2e/production/helpers/swedish-organization-number.mjs'

const generated = new Set()

for (let index = 0; index < 100; index += 1) {
  const seed = `gridex-production-certification-regression-${index}`
  const first = syntheticSwedishOrganizationNumber(seed)
  const replay = syntheticSwedishOrganizationNumber(seed)

  assert.equal(first, replay, `Generator must be deterministic for seed ${seed}`)
  assert.match(first, /^\d{6}-\d{4}$/, `Unexpected organization-number format for ${seed}`)
  assert.equal(isValidSwedishOrganizationNumber(first), true, `Generated invalid organization number for ${seed}`)

  const digits = first.replace(/\D/g, '')
  assert.equal(digits.length, 10)
  assert.ok(Number(digits[2]) >= 2, `Third digit must identify an organization number for ${seed}`)
  generated.add(first)
}

assert.equal(generated.size, 100, 'Regression seeds unexpectedly produced duplicate organization numbers.')
assert.equal(
  isValidSwedishOrganizationNumber('E2E-1234567890'),
  false,
  'Legacy E2E-* fixture must never be considered a valid Swedish organization number.',
)
assert.throws(
  () => syntheticSwedishOrganizationNumber(''),
  /seed is required/i,
  'Empty run IDs must fail closed.',
)

console.log('Gridex synthetic Swedish organization-number regression passed.')
