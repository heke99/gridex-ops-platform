import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Z02 receipt is not verification', () => {
  it('does not write verified payload or link customer/site before canonical gates', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/onboarding/inboundEdielLinking.ts'), 'utf8')
    const start = source.indexOf('export async function applyInboundProdatZ02ToCustomerInfoRequest')
    const enqueue = source.indexOf('enqueueInboundGridOwnerResponseAutomation({', start)
    const preGate = source.slice(start, enqueue)
    expect(preGate).not.toContain('verified_payload:')
    expect(preGate).not.toContain('linkEdielMessage({')
    expect(preGate).not.toContain("status: 'z02_received'")
  })
  it('fails closed when DB does not return atomic proof', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'lib/onboarding/inboundEdielLinking.ts'), 'utf8')
    expect(source).toContain('z02_atomic_apply_not_confirmed')
    expect(source).toContain('z02_processing_enqueue_failed')
    expect(source).toContain("gateResult.z02_snapshot_freshness_status === 'valid'")
  })
})
