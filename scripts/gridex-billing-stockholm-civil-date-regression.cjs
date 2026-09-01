const assert = require('node:assert/strict')
const fs = require('node:fs')

const source = fs.readFileSync('lib/billing/underlayEngine.ts', 'utf8')

assert.match(source, /export function stockholmCivilDate/)
assert.match(source, /timeZone:\s*["']Europe\/Stockholm["']/)
assert.match(source, /const date = stockholmCivilDate\(segmentStart\)/)
assert.doesNotMatch(source, /const date = segmentStart\.slice\(0, 10\)/)
assert.match(source, /const segmentStartDate = stockholmCivilDate\(segmentStart\)/)
assert.match(source, /const segmentEndExclusiveDate = stockholmCivilDate\(segmentEnd\)/)
assert.match(source, /addDays\(stockholmCivilDate\(endsAt\), 1\)/)

function stockholmDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const get = (type) => parts.find((part) => part.type === type)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

assert.equal(stockholmDate('2026-06-30T22:00:00.000Z'), '2026-07-01', 'CEST month start')
assert.equal(stockholmDate('2026-07-31T22:00:00.000Z'), '2026-08-01', 'CEST exclusive month end')
assert.equal(stockholmDate('2026-11-30T23:00:00.000Z'), '2026-12-01', 'CET month start')
assert.equal(stockholmDate('2026-12-31T23:00:00.000Z'), '2027-01-01', 'CET exclusive month end')

console.log('Billing Stockholm civil-date regression PASS')
