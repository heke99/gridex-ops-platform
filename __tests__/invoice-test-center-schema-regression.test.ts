import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

function generatedTableBlock(types: string, table: string): string {
  const startNeedle = `      ${table}: {`
  const start = types.indexOf(startNeedle)
  if (start < 0) return ''
  const rest = types.slice(start + startNeedle.length)
  const next = rest.search(/\n      [a-z0-9_]+: \{/)
  return next < 0 ? types.slice(start) : types.slice(start, start + startNeedle.length + next)
}

describe('Fakturatest generated schema contract', () => {
  it('reads customer_contracts.starts_at and never the nonexistent customer_contracts.start_date', () => {
    const materialization = read('lib/ediel/testing/invoiceTestEdifactMaterialization.ts')
    const types = read('supabase/database.types.ts')
    const contractSchema = generatedTableBlock(types, 'customer_contracts')

    expect(contractSchema).not.toBe('')
    expect(contractSchema).toMatch(/\n\s+starts_at: string \| null/)
    expect(contractSchema).not.toMatch(/\n\s+start_date:/)
    expect(materialization).toContain(".select('id,status,starts_at,metering_point_id,site_id,customer_site_id,metadata')")
    expect(materialization).toContain('const startDate = text(contract.starts_at)?.slice(0, 10) ?? null')
    expect(materialization).not.toContain('start_date,starts_at')
    expect(materialization).not.toContain('contract.start_date')
  })
})
