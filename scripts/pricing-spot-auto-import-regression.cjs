const assert = require('assert')

function previousBillingMonth(now) {
  const year = now.getUTCFullYear()
  const monthIndex = now.getUTCMonth()
  const previous = new Date(Date.UTC(year, monthIndex - 1, 1))
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`
}

function normalizeMonth(value, now) {
  if (!value || value === 'previous') return previousBillingMonth(now)
  if (/^\d{4}-\d{2}$/.test(value)) return value
  throw new Error('billing_month måste anges som YYYY-MM eller previous.')
}

function normalizeAreas(values) {
  const valid = new Set(['SE1', 'SE2', 'SE3', 'SE4'])
  if (!values) return ['SE1', 'SE2', 'SE3', 'SE4']
  const raw = Array.isArray(values) ? values : String(values).split(',')
  const areas = [...new Set(raw.map((value) => String(value).trim()).filter(Boolean))]
  for (const area of areas) assert(valid.has(area), `Ogiltigt elområde: ${area}`)
  return areas
}

assert.strictEqual(previousBillingMonth(new Date(Date.UTC(2026, 5, 8))), '2026-05')
assert.strictEqual(previousBillingMonth(new Date(Date.UTC(2026, 0, 3))), '2025-12')
assert.strictEqual(normalizeMonth(null, new Date(Date.UTC(2026, 5, 8))), '2026-05')
assert.strictEqual(normalizeMonth('previous', new Date(Date.UTC(2026, 5, 8))), '2026-05')
assert.strictEqual(normalizeMonth('2026-04', new Date(Date.UTC(2026, 5, 8))), '2026-04')
assert.deepStrictEqual(normalizeAreas('SE1,SE2,SE2'), ['SE1', 'SE2'])
assert.deepStrictEqual(normalizeAreas(undefined), ['SE1', 'SE2', 'SE3', 'SE4'])
assert.throws(() => normalizeMonth('2026/05', new Date()), /billing_month/)
assert.throws(() => normalizeAreas('SE5'), /Ogiltigt/)

console.log('pricing spot auto import regression passed')
