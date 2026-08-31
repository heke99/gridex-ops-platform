import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(__dirname, '..', 'lib/ediel/testing/invoiceTestCenterArchive.ts'),
  'utf8',
)

describe('Fakturatest safe archive pre-import contract', () => {
  it('allows the intentional zero-metering-point state before first EDIFACT import', () => {
    expect(source).toContain('points.length > 1')
    expect(source).not.toContain('points.length !== 1')
    expect(source).toContain("if (points.length === 1) assertMarkedGraphRow(points[0], 'testmätpunkten')")
    expect(source).toContain('const point = points[0] ?? null')
    expect(source).toContain('if (point && pointId && archivedMeteringPointId)')
  })

  it('still requires exactly one test site and exactly one canonical contract', () => {
    expect(source).toContain('sites.length !== 1')
    expect(source).toContain('contracts.length !== 1')
    expect(source).toContain("assertMarkedGraphRow(sites[0], 'testanläggningen')")
    expect(source).toContain("assertMarkedGraphRow(contracts[0], 'testavtalet')")
  })

  it('releases every external metering identity when an imported point exists', () => {
    expect(source).toContain('ediel_metering_point_id: archivedMeteringPointId')
    expect(source).toContain('ediel_reference: null')
    expect(source).toContain('anlage_id: null')
    expect(source).toContain('archived_original_identifiers')
  })
})
