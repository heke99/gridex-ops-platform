// reality-defects: H-B5b
// H-B5b: the grid-owner simulator stamped an E66 with its registration time 06:00 +0100 the morning after the day,
// also when it sent the day just after it ended. Scenario H crossed midnight UTC, the file for 26 October was stamped
// 27 October 06:00 while the clock said 00:19Z, and the platform refused it as a future message date
// (UTILTS_MESSAGE_DATE_INVALID, ERC 42 field 205). dailyE66 now takes `notAfter`, and the simulator caps every file
// at the current time (a correction stays later than an original of the same batch).
import { expect, it } from 'vitest'
import { dailyE66, dayProfile } from '../scripts/helpers/live-chain-wire'

const base = { issuer: '16700', receiver: '70432', meterId: '735999317790886155', day: '2026-10-26', values: dayProfile(0), reference: 'H5B' }
const dtm137 = (raw: string) => /DTM\+137:(\d{12}):203/.exec(raw)?.[1]

it('without a cap the registration is 06:00 +0100 the morning after the day (unchanged)', () => {
  expect(dtm137(dailyE66(base))).toBe('202610270600')
})

it('the registration never lies after notAfter', () => {
  const now = Date.parse('2026-10-27T00:19:00Z')
  const raw = dailyE66({ ...base, notAfter: now - 120_000 })
  // 00:17Z is 01:17 +0100.
  expect(dtm137(raw)).toBe('202610270117')
  expect(raw).toContain('DTM+597:202610270117:203')
})

it('a correction capped a minute later stays later than the capped original', () => {
  const now = Date.parse('2026-10-27T00:19:00Z')
  const original = dtm137(dailyE66({ ...base, notAfter: now - 120_000 }))!
  const correction = dtm137(dailyE66({ ...base, reference: 'H5BC', registeredAfterHours: 2, notAfter: now - 60_000 }))!
  expect(correction > original).toBe(true)
})
