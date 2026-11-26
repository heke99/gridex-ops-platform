const assert = require('node:assert/strict')
const fs = require('node:fs')

const source = fs.readFileSync('lib/billing/underlayEngine.ts', 'utf8')
const intervalSource = fs.readFileSync('lib/billing/underlayIntervals.ts', 'utf8')

const civilDate = source.match(/^export function stockholmCivilDate\([\s\S]*?^}$/m)?.[0] ?? ''
const snapshotTimeline = source.match(/^async function loadSnapshotTimeline\([\s\S]*?^}$/m)?.[0] ?? ''
const contractCoverage = source.match(/^function contractCoversSegment\([\s\S]*?^}$/m)?.[0] ?? ''
const lastIncludedDate = source.match(/^function lastIncludedBillingDate\([\s\S]*?^}$/m)?.[0] ?? ''
const localBoundary = intervalSource.match(/^export function localDateBoundary\([\s\S]*?^}$/m)?.[0] ?? ''

assert.match(civilDate, /timeZone:\s*["']Europe\/Stockholm["']/)
assert.match(snapshotTimeline, /const date = stockholmCivilDate\(segmentStart\)/)
assert.match(snapshotTimeline, /const lastDate = lastIncludedBillingDate\(segmentEnd\)/)
assert.doesNotMatch(snapshotTimeline, /segment(?:Start|End)\.slice\(0, 10\)/)
assert.match(contractCoverage, /const contractStartDate = startsAt \? stockholmCivilDate\(startsAt\)/)
assert.match(contractCoverage, /contractStartDate > stockholmCivilDate\(segmentStart\)/)
assert.match(contractCoverage, /const contractEndDate = endsAt \? stockholmCivilDate\(endsAt\)/)
assert.match(contractCoverage, /contractEndDate < lastIncludedBillingDate\(segmentEnd\)/)
assert.match(lastIncludedDate, /const date = stockholmCivilDate\(exclusiveEnd\)/)
assert.match(lastIncludedDate, /instantMicros\(exclusiveEnd\) === instantMicros\(localDateBoundary\(date\)\)\s*\? addDays\(date, -1\)\s*:\s*date/)
assert.match(localBoundary, /return stockholmLocalToUtc\(/)

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
