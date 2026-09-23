import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { supportedUtiltsConsumptionIdentity } from '@/lib/ediel/utilts/consumptionIdentity'

it('retained SQL reservation retries use supported original identities for both physical siblings', () => {
  const sql = readFileSync('scripts/ediel-utilts-committed-retry-regression.sql', 'utf8')
  const raw = sql.match(/'received','((?:[^']|'')*)',clock_timestamp/)?.[1].replaceAll("''", "'")
  expect(raw).toBeTruthy()
  expect(supportedUtiltsConsumptionIdentity(raw!, 0)).toEqual({ transactionId: 'TX-1', point: 'POINT' })
  expect(supportedUtiltsConsumptionIdentity(raw!, 1)).toEqual({ transactionId: 'TX-2', point: 'POINT' })
})
