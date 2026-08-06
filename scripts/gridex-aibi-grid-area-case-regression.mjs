import assert from 'node:assert/strict'
import { discrepancyReasonsForAiBiRow } from '../lib/ediel/aiBiImportParser.ts'

const baseRow = {
  rowNumber: 2,
  rawColumns: {},
  meteringPointExternalId: '735999999999999999',
  customerIdentity: null,
  customerName: null,
  gridAreaCode: 'lka',
  gridOwnerEdielId: null,
}

const matched = {
  grid_area_code: 'LKA',
  grid_owner_ediel_id: null,
}

assert.deepEqual(
  discrepancyReasonsForAiBiRow({
    row: baseRow,
    matchedMeteringPoint: matched,
  }),
  [],
  'Case-only grid area differences must not raise grid_area_mismatch',
)

assert.ok(
  discrepancyReasonsForAiBiRow({
    row: { ...baseRow, gridAreaCode: 'STH' },
    matchedMeteringPoint: matched,
  }).includes('grid_area_mismatch'),
  'Distinct grid areas must still raise grid_area_mismatch',
)

assert.ok(
  discrepancyReasonsForAiBiRow({
    row: { ...baseRow, gridAreaCode: ' LKA ' },
    matchedMeteringPoint: { ...matched, grid_area_code: 'lka' },
  }).length === 0,
  'Whitespace and case must normalize before grid-area compare',
)

console.log('AI/BI grid-area case normalization regression: ok')
