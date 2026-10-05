import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(__dirname, '..')

function read(relativePath: string) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')
}

describe('customer registry hydration performance invariants', () => {
  it('starts independent site, contract, and authorization reads before awaiting hydration', () => {
    const source = read('lib/customers/getCustomers.ts')

    expect(source).toContain('const siteContextPromise = (async () => {')
    expect(source).toContain('const contractsPromise = (async () => {')
    expect(source).toContain('const powersOfAttorneyPromise = (async () => {')
    expect(source).toContain('const meteringPointsPromise = siteContextPromise.then(async ({ siteIds }) => {')
    expect(source).toMatch(
      /const \[siteContext, contracts, powersOfAttorney, meteringPoints\] = await Promise\.all\(\[\s*siteContextPromise,\s*contractsPromise,\s*powersOfAttorneyPromise,\s*meteringPointsPromise,\s*\]\)/,
    )
  })

  it('keeps metering-point hydration dependent only on the site-id read', () => {
    const source = read('lib/customers/getCustomers.ts')
    const meteringStart = source.indexOf('const meteringPointsPromise = siteContextPromise.then')
    const combinedAwait = source.indexOf('const [siteContext, contracts, powersOfAttorney, meteringPoints] = await Promise.all')

    expect(meteringStart).toBeGreaterThan(-1)
    expect(combinedAwait).toBeGreaterThan(meteringStart)
    expect(source.slice(meteringStart, combinedAwait)).toContain(".from('metering_points')")
  })

  it('preserves missing-relation fallback behavior for every optional hydration relation', () => {
    const source = read('lib/customers/getCustomers.ts')
    const hydration = source.slice(
      source.indexOf('async function hydrateDerivedCustomerData'),
      source.indexOf('function emptyCounts')
    )

    expect(hydration.match(/isMissingRelationError\(error\)/g)?.length).toBe(4)
    expect(hydration).toContain(".from('customer_sites')")
    expect(hydration).toContain(".from('metering_points')")
    expect(hydration).toContain(".from('customer_contracts')")
    expect(hydration).toContain(".from('powers_of_attorney')")
  })
})
