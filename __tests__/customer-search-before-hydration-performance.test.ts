import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('advanced customer registry filtering performance invariants', () => {
  it('filters base customer rows before relation hydration', () => {
    const source = read('lib/customers/getCustomers.ts')
    const fallbackStart = source.indexOf("const includeHiddenRows = status === 'archived'")
    const fallbackEnd = source.indexOf('const total = filteredRows.length', fallbackStart)
    const fallback = source.slice(fallbackStart, fallbackEnd)

    const baseRowsIndex = fallback.indexOf('const baseRows = await loadCustomerRows')
    const visibleRowsIndex = fallback.indexOf('const visibleRows = excludeTestData')
    const candidatesIndex = fallback.indexOf('const hydrationCandidates = visibleRows.filter')
    const hydrationIndex = fallback.indexOf('const hydratedRows = await hydrateDerivedCustomerData(hydrationCandidates, companyId)')

    expect(baseRowsIndex).toBeGreaterThan(-1)
    expect(visibleRowsIndex).toBeGreaterThan(baseRowsIndex)
    expect(candidatesIndex).toBeGreaterThan(visibleRowsIndex)
    expect(hydrationIndex).toBeGreaterThan(candidatesIndex)
    expect(fallback).toContain('matchesText(row, query) && matchesCustomerType(row, customerType)')
  })

  it('keeps derived contract and operational flags after hydration', () => {
    const source = read('lib/customers/getCustomers.ts')
    const fallbackStart = source.indexOf("const includeHiddenRows = status === 'archived'")
    const fallbackEnd = source.indexOf('const total = filteredRows.length', fallbackStart)
    const fallback = source.slice(fallbackStart, fallbackEnd)

    expect(fallback).toContain('matchesContract(row, contractFilter)')
    expect(fallback).toContain('matchesFlag(row, flag)')
    expect(fallback.indexOf('matchesContract(row, contractFilter)')).toBeGreaterThan(
      fallback.indexOf('const hydratedRows = await hydrateDerivedCustomerData')
    )
  })
})
