import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

describe('Test Center raw EDIFACT import contract', () => {
  it('reuses the canonical inbound parser and processor before the metering-to-invoice runtime', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain("parseInboundEmailContent")
    expect(source).toContain("processInboundEmailMessage")
    expect(source).toContain("runTestCenterMeteringToInvoiceChain")

    const parseAt = source.indexOf('assertRawTestEdifactPreflight(rawEdifact)')
    const inboundAt = source.indexOf('await processInboundEmailMessage')
    const runtimeAt = source.indexOf('await runTestCenterMeteringToInvoiceChain')
    expect(parseAt).toBeGreaterThanOrEqual(0)
    expect(inboundAt).toBeGreaterThan(parseAt)
    expect(runtimeAt).toBeGreaterThan(inboundAt)
  })

  it('fails closed to UTILTS and selected customer/tenant metering ownership', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain("parsed.messageFamily !== 'UTILTS'")
    expect(source).toContain(".eq('company_id', input.companyId)")
    expect(source).toContain(".eq('customer_id', input.customerId)")
    expect(source).toContain("EDIFACT-mätpunkten tillhör inte vald testkund")
    expect(source).toContain("row.environment !== 'test'")
    expect(source).toContain("row.customer_id !== input.customerId")
  })

  it('persists only a test-scoped inbound envelope and records side effects as disabled', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain("environment: 'test'")
    expect(source).toContain("match_status: 'test_center_raw_import'")
    expect(source).toContain("external_side_effects_allowed: false")
    expect(source).not.toContain('invoiceApprovedDispatch')
    expect(source).not.toContain('dispatchApproved')
  })

  it('deduplicates identical test uploads before insert', () => {
    const source = read('lib/ediel/testing/testCenterRawEdifactImport.ts')
    expect(source).toContain('findExistingTestInboundEnvelope')
    expect(source).toContain(".eq('raw_edifact_payload', input.rawEdifact)")
    expect(source).toContain(".eq('environment', 'test')")
    expect(source).toContain('if (existing) return { id: existing, reused: true }')
    expect(source.indexOf('findExistingTestInboundEnvelope')).toBeLessThan(source.indexOf(".from('inbound_email_messages').insert"))
  })

  it('accepts file or pasted EDIFACT in the superadmin server action and caps files at 2 MB', () => {
    const actions = read('app/admin/ediel/test-center/actions.ts')
    const page = read('app/admin/ediel/test-center/metering-to-invoice/page.tsx')
    expect(actions).toContain("requirePlatformAdminActionAccess()")
    expect(actions).toContain("formData.get('edifactFile')")
    expect(actions).toContain('2 * 1024 * 1024')
    expect(actions).toContain('importRawEdifactAndRunTestCenterChain')
    expect(page).toContain('type="file"')
    expect(page).toContain('name="rawEdifact"')
    expect(page).toContain('name="testScenario"')
    expect(page).toContain('Importera, kör och öppna trace')
  })
})
