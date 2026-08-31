import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'lib/inbound-mail/inboundStatusUpdater.ts'), 'utf8')

describe('inbound Ediel metering customer binding', () => {
  it('persists customer/site ownership from an exact matched metering point when outbound correlation is missing', () => {
    expect(source).toContain("const matchedMetering = input.meteringPointMatch?.status === 'matched'")
    expect(source).toContain("typeof matchedMetering.customer_id === 'string'")
    expect(source).toContain("typeof matchedMetering.site_id === 'string'")
    expect(source).toContain("typeof matchedMetering.grid_owner_id === 'string'")
  })

  it('only trusts metering candidate ownership when meteringPointMatch is explicitly matched', () => {
    const guard = source.indexOf("const matchedMetering = input.meteringPointMatch?.status === 'matched'")
    const customerFallback = source.indexOf("typeof matchedMetering.customer_id === 'string'")
    expect(guard).toBeGreaterThan(-1)
    expect(customerFallback).toBeGreaterThan(guard)
  })
})
