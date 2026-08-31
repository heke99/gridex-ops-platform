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

function appendCorrectionSuffix(value: string, maxLength = 35): string {
  const base = value.trim()
  if (!base) throw new Error('correction-fixturen saknar referensvärde.')
  return `${base.slice(0, Math.max(1, maxLength - 1))}C`
}

function markCorrectedMessageEnvelope(parts: string[]) {
  const unbIndex = parts.findIndex((segment) => /^UNB\+/i.test(segment))
  const unzIndex = parts.findIndex((segment) => /^UNZ\+/i.test(segment))
  if (unbIndex < 0 || unzIndex < 0) throw new Error('correction-fixturen saknar UNB/UNZ.')
  const unb = parts[unbIndex].split('+')
  const originalInterchangeReference = unb[5]?.trim()
  if (!originalInterchangeReference) throw new Error('correction-fixturen saknar UNB interchange reference.')
  const correctedInterchangeReference = appendCorrectionSuffix(originalInterchangeReference)
  unb[5] = correctedInterchangeReference
  parts[unbIndex] = unb.join('+')

  const unz = parts[unzIndex].split('+')
  if (unz.length < 3 || unz[2]?.trim() !== originalInterchangeReference) {
    throw new Error('correction-fixturen har UNB/UNZ-referenser som inte matchar före mutation.')
  }
  unz[2] = correctedInterchangeReference
  parts[unzIndex] = unz.join('+')

  const unhIndex = parts.findIndex((segment) => /^UNH\+/i.test(segment))
  if (unhIndex < 0) throw new Error('correction-fixturen saknar UNH.')
  const unh = parts[unhIndex].split('+')
  const originalMessageReference = unh[1]?.trim()
  if (!originalMessageReference) throw new Error('correction-fixturen saknar UNH message reference.')
  const correctedMessageReference = appendCorrectionSuffix(originalMessageReference, 14)
  unh[1] = correctedMessageReference
  parts[unhIndex] = unh.join('+')

  const untIndex = parts.findIndex((segment) => /^UNT\+/i.test(segment))
  if (untIndex < 0) throw new Error('correction-fixturen saknar UNT.')
  const unt = parts[untIndex].split('+')
  if (unt.length < 3 || unt[2]?.trim() !== originalMessageReference) {
    throw new Error('correction-fixturen har UNH/UNT-referenser som inte matchar före mutation.')
  }
  unt[2] = correctedMessageReference
  parts[untIndex] = unt.join('+')

  // The inbound database also has duplicate protection on transaction/external
  // message identity. Keep IDE+24 unchanged so metering revision semantics refer
  // to the same business value, but give the corrected message a new BGM document
  // reference so the envelope itself is independently ingestible and traceable.
  const bgmIndex = parts.findIndex((segment) => /^BGM\+/i.test(segment))
  if (bgmIndex < 0) throw new Error('correction-fixturen saknar BGM.')
  const bgm = parts[bgmIndex].split('+')
  if (!bgm[2]?.trim()) throw new Error('correction-fixturen saknar BGM document reference.')
  bgm[2] = appendCorrectionSuffix(bgm[2])
  parts[bgmIndex] = bgm.join('+')
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

  markCorrectedMessageEnvelope(parts)
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
