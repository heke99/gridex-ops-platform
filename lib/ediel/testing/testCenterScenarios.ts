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
  const unhIndex = parts.findIndex((segment) => /^UNH\+/i.test(segment))
  const untIndex = parts.findIndex((segment) => /^UNT\+/i.test(segment))
  if (unhIndex >= 0 && untIndex >= unhIndex) {
    const tokens = parts[untIndex].split('+')
    if (tokens.length >= 3) {
      tokens[1] = String(untIndex - unhIndex + 1)
      parts[untIndex] = tokens.join('+')
    }
  }
  return `${parts.join("'")}'`
}

function quantityValue(segment: string, expectedQualifier?: string): { prefix: string; value: number; suffix: string; decimals: number } | null {
  const match = /^(QTY\+([^:+'\s]+):)(-?\d+(?:[.,]\d+)?)(.*)$/.exec(segment)
  if (!match) return null
  if (expectedQualifier && match[2].trim().toUpperCase() !== expectedQualifier.toUpperCase()) return null
  const value = Number(match[3].replace(',', '.'))
  if (!Number.isFinite(value)) return null
  const decimalPart = match[3].replace(',', '.').split('.')[1] ?? ''
  return { prefix: match[1], value, suffix: match[4], decimals: decimalPart.length }
}

function replaceQuantityValue(segment: string, nextValue: number, expectedQualifier: string): string {
  const parsed = quantityValue(segment, expectedQualifier)
  if (!parsed) throw new Error(`Scenario-fixturen kunde inte tolka QTY+${expectedQualifier}.`)
  const rendered = nextValue.toFixed(parsed.decimals)
  return `${parsed.prefix}${rendered}${parsed.suffix}`
}

function removeFirstBillableEnergy(raw: string): string {
  const parts = segments(raw)
  const index = parts.findIndex((segment) => /^QTY\+136:/i.test(segment))
  if (index < 0) throw new Error('missing_values-fixturen kräver minst ett fakturerbart QTY+136-segment.')
  parts.splice(index, 1)
  return rebuild(parts)
}

function meterConstant(parts: string[]): number {
  for (let index = 0; index < parts.length; index += 1) {
    if (!/^CCI\+.*Z02(?:[:+]|$)/i.test(parts[index] ?? '')) continue
    const next = String(parts[index + 1] ?? '')
    const match = /^CAV\+([^:+'\s]+)/i.exec(next)
    if (!match) continue
    const parsed = Number(match[1].replace(',', '.'))
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 1
}

function markCorrectedMessageReference(parts: string[]) {
  const unhIndex = parts.findIndex((segment) => /^UNH\+/i.test(segment))
  if (unhIndex < 0) throw new Error('correction-fixturen saknar UNH.')
  const unh = parts[unhIndex].split('+')
  const originalReference = unh[1]?.trim()
  if (!originalReference) throw new Error('correction-fixturen saknar UNH message reference.')
  const correctedReference = `${originalReference}C`
  unh[1] = correctedReference
  parts[unhIndex] = unh.join('+')

  const untIndex = parts.findIndex((segment) => /^UNT\+/i.test(segment))
  if (untIndex < 0) throw new Error('correction-fixturen saknar UNT.')
  const unt = parts[untIndex].split('+')
  if (unt.length < 3 || unt[2]?.trim() !== originalReference) {
    throw new Error('correction-fixturen har UNH/UNT-referenser som inte matchar före mutation.')
  }
  unt[2] = correctedReference
  parts[untIndex] = unt.join('+')
}

function mutateBillableEnergy(raw: string): string {
  const parts = segments(raw)
  const energyIndex = parts.findIndex((segment) => /^QTY\+136:/i.test(segment))
  if (energyIndex < 0) throw new Error('correction-fixturen kräver minst ett fakturerbart QTY+136-segment.')

  const energy = quantityValue(parts[energyIndex], '136')
  if (!energy) throw new Error('correction-fixturen kunde inte tolka QTY+136-värdet deterministiskt.')
  const energyDelta = 1
  parts[energyIndex] = replaceQuantityValue(parts[energyIndex], energy.value + energyDelta, '136')

  // If the E66 also carries canonical field 517 register readings (QTY+220),
  // keep the register-difference reconciliation internally consistent. A
  // billing correction must alter billable QTY+136, not manufacture an E19 by
  // changing only one side of the register/energy evidence pair.
  const readingIndexes = parts
    .map((segment, index) => /^QTY\+220:/i.test(segment) ? index : -1)
    .filter((index) => index >= 0)
  if (readingIndexes.length >= 2) {
    const lastReadingIndex = readingIndexes[readingIndexes.length - 1]
    const latest = quantityValue(parts[lastReadingIndex], '220')
    if (!latest) throw new Error('correction-fixturen kunde inte tolka senaste QTY+220-mätarställningen.')
    const constant = meterConstant(parts)
    parts[lastReadingIndex] = replaceQuantityValue(
      parts[lastReadingIndex],
      latest.value + energyDelta / constant,
      '220',
    )
  }

  // Preserve the business transaction identity so the normal metering revision
  // engine sees a correction of the same value. The EDIFACT message itself gets
  // a new UNH reference, and UNT is changed to the exact same reference.
  markCorrectedMessageReference(parts)
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
      return { scenario, runs: [{ label: 'missing-billable-energy', rawEdifact: removeFirstBillableEnergy(baseline), expectation: 'blocked_missing_values' }] }
    case 'correction':
      return {
        scenario,
        runs: [
          { label: 'original', rawEdifact: baseline, expectation: 'success' },
          { label: 'correction-plus-1-kwh', rawEdifact: mutateBillableEnergy(baseline), expectation: 'corrected' },
        ],
      }
    case 'rebilling': {
      const corrected = mutateBillableEnergy(baseline)
      return {
        scenario,
        runs: [
          { label: 'original-billing', rawEdifact: baseline, expectation: 'success' },
          { label: 'corrected-metering', rawEdifact: corrected, expectation: 'corrected' },
          { label: 'rebilling-verification', rawEdifact: corrected, expectation: 'rebilled' },
        ],
      }
    }
  }
}
