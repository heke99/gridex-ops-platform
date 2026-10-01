import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { supportedUtiltsConsumptionIdentity } from '@/lib/ediel/utilts/consumptionIdentity'
import {validateEdifactEnvelope} from '@/lib/ediel/core/edifactValidation'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'

it('retained SQL reservation retries use supported original identities for both physical siblings', () => {
  const sql = readFileSync('scripts/ediel-utilts-committed-retry-regression.sql', 'utf8')
  const raw = sql.match(/raw text:='((?:[^']|'')*)';/)?.[1].replaceAll("''", "'").replace('DOCUMENT_DATE','202609301000')
  expect(raw).toBeTruthy()
  expect(validateEdifactEnvelope(raw!).ok).toBe(true)
  expect(supportedUtiltsConsumptionIdentity(raw!, 0)).toEqual({ transactionId: 'TX-1', point: '735999260731000007' })
  expect(supportedUtiltsConsumptionIdentity(raw!, 1)).toEqual({ transactionId: 'TX-2', point: '735999260731000014' })
})

it('does not treat an IDE with LOC+175 after its first SEQ as an ordinary point identity', () => {
  const raw = energyHandoffMessage().raw_payload!
    .replace("SEQ++1'", "SEQ++1'\nLOC+175+735999260731000007::9'")
    .replace("UNT+19+1'", "UNT+20+1'")
  expect(supportedUtiltsConsumptionIdentity(raw, 0)).toBeNull()
})

it('does not select a point from an IDE with another LOC+172 after SEQ', () => {
  const raw = energyHandoffMessage().raw_payload!
    .replace("SEQ++1'", "SEQ++1'\nLOC+172+735999260731000014::9'")
    .replace("UNT+19+1'", "UNT+20+1'")
  expect(supportedUtiltsConsumptionIdentity(raw, 0)).toBeNull()
})
