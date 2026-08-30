export type TestCenterScenario = 'baseline' | 'duplicate' | 'missing_values' | 'correction' | 'rebilling'

export type TestCenterScenarioMaterialization = {
  scenario: TestCenterScenario
  runs: Array<{
    label: string
    rawEdifact: string
    expectation: 'success' | 'duplicate_or_idempotent' | 'blocked_missing_values' | 'corrected' | 'rebilled'
  }>
}

function normalize(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('Scenario-fixture kräver EDIFACT-innehåll.')
  return value
}

function segments(raw: string): string[] {
  return normalize(raw).split("'").map((segment) => segment.trim()).filter(Boolean)
}

function rebuild(parts: string[]): string {
  return `${parts.join("'")}'`
}

function removeFirstQuantity(raw: string): string {
  const parts = segments(raw)
  const index = parts.findIndex((segment) => segment.startsWith('QTY+'))
  if (index < 0) throw new Error('missing_values-fixturen kräver minst ett QTY-segment.')
  parts.splice(index, 1)
  return rebuild(parts)
}

function mutateFirstQuantity(raw: string): string {
  const parts = segments(raw)
  const index = parts.findIndex((segment) => segment.startsWith('QTY+'))
  if (index < 0) throw new Error('correction-fixturen kräver minst ett QTY-segment.')

  const match = /^(QTY\+[^:+'\s]+:)(-?\d+(?:[.,]\d+)?)(.*)$/.exec(parts[index])
  if (!match) throw new Error('correction-fixturen kunde inte tolka första QTY-värdet deterministiskt.')
  const original = Number(match[2].replace(',', '.'))
  if (!Number.isFinite(original)) throw new Error('correction-fixturen hittade ett ogiltigt QTY-värde.')
  const corrected = (original + 1).toFixed(Number.isInteger(original) ? 0 : 3)
  parts[index] = `${match[1]}${corrected}${match[3]}`

  const unhIndex = parts.findIndex((segment) => segment.startsWith('UNH+'))
  if (unhIndex >= 0) {
    const tokens = parts[unhIndex].split('+')
    if (tokens[1]) tokens[1] = `${tokens[1]}C`
    parts[unhIndex] = tokens.join('+')
  }
  return rebuild(parts)
}

export function materializeTestCenterScenario(rawEdifact: string, scenario: TestCenterScenario): TestCenterScenarioMaterialization {
  const baseline = normalize(rawEdifact)
  switch (scenario) {
    case 'baseline':
      return { scenario, runs: [{ label: 'baseline', rawEdifact: baseline, expectation: 'success' }] }
    case 'duplicate':
      return {
        scenario,
        runs: [
          { label: 'original', rawEdifact: baseline, expectation: 'success' },
          { label: 'duplicate', rawEdifact: baseline, expectation: 'duplicate_or_idempotent' },
        ],
      }
    case 'missing_values':
      return { scenario, runs: [{ label: 'missing-first-qty', rawEdifact: removeFirstQuantity(baseline), expectation: 'blocked_missing_values' }] }
    case 'correction':
      return {
        scenario,
        runs: [
          { label: 'original', rawEdifact: baseline, expectation: 'success' },
          { label: 'correction-plus-1-kwh', rawEdifact: mutateFirstQuantity(baseline), expectation: 'corrected' },
        ],
      }
    case 'rebilling':
      return {
        scenario,
        runs: [
          { label: 'original-billing', rawEdifact: baseline, expectation: 'success' },
          { label: 'corrected-metering', rawEdifact: mutateFirstQuantity(baseline), expectation: 'corrected' },
          { label: 'rebilling-verification', rawEdifact: mutateFirstQuantity(baseline), expectation: 'rebilled' },
        ],
      }
  }
}
