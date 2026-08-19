import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => fs.readFileSync(path, 'utf8')

describe('Partner API developer route stays supplier-facing', () => {
  it('does not wrap the customer-portal URL in internal production/readiness terminology', () => {
    const layout = read('app/developers/customer-portal-api/layout.tsx')
    const page = read('app/developers/customer-portal-api/page.tsx')

    expect(layout).toContain('return <>{children}</>')
    for (const internalTerm of [
      'Production readiness',
      'tenantens canonical',
      'tenant-ID',
      'api_client_not_launch_ready',
      'integration_receipt_not_verified',
      'integration_capability_not_ready',
      'company_id',
      'tenant_reference',
      'tenant_email_outbox',
    ]) {
      expect(layout).not.toContain(internalTerm)
      expect(page).not.toContain(internalTerm)
    }
    expect(page).toContain("from '@/lib/partner-api/openApi'")
    expect(page).toContain('partnerOpenApi')
    expect(page).toContain('Successful checkout response')
    expect(page).toContain('data.checkout')
    expect(page).toContain('thank_you_ready')
    expect(page).toContain('Gridex platform')
    expect(page).toContain('Your integration')
  })
})
