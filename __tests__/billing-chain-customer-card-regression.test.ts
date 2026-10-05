import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')

describe('canonical billing chain regression', () => {
  it('routes every customer-card meter request entrypoint through E73 preparation', () => {
    const source = read('app/admin/customers/[id]/actions.ts')

    expect(source).toContain("utiltsCode: 'E73'")
    expect(source).toContain('runCustomerActionWithMeterValuePreparation')
    expect(source).toMatch(/createGridOwnerDataRequestAction[\s\S]*runCustomerActionWithMeterValuePreparation/)
    expect(source).toMatch(/createAuthorizationRequestPackageAction[\s\S]*runCustomerActionWithMeterValuePreparation/)
    expect(source).toMatch(/createCustomerDataRequestPackageAction[\s\S]*runCustomerActionWithMeterValuePreparation/)
  })

  it('runs metering autopilot before underlays, then prepares per-customer invoice drafts and never sends from monthly automation', () => {
    const source = read('lib/billing/monthlyAutomation.ts')
    const meteringIndex = source.indexOf('runMeteringMarketDataAutopilot({')
    const underlayIndex = source.indexOf('generateBillingUnderlaysForMonth({')
    const prepareIndex = source.indexOf('prepareInvoiceDraftsForReview({')

    expect(meteringIndex).toBeGreaterThan(-1)
    expect(underlayIndex).toBeGreaterThan(meteringIndex)
    expect(prepareIndex).toBeGreaterThan(underlayIndex)
    expect(source).toContain("source: 'monthly_billing_prepare_only_v3'")
    expect(source).toContain('approval_required: true')
    expect(source).not.toContain('sendInvoiceExportRun')
    expect(source).not.toContain('sendToPartner')
  })

  it('keeps the internal invoice-create API prepare-only instead of requiring a fully green month', () => {
    const source = read('app/api/internal/invoice-exports/create/route.ts')

    expect(source).toContain('prepareInvoiceDraftsForReview')
    expect(source).toContain("mode: 'prepare_only'")
    expect(source).toContain('approval_required: true')
    expect(source).toContain('blocked_customers_are_not_reserved_or_sent: true')
    expect(source).not.toContain('sendInvoiceExportRun')
    expect(source).not.toContain('evaluateBillingMonthInvoiceReadiness')
  })

  it('requires explicit approval and revalidates readiness before provider dispatch', () => {
    const source = read('lib/billing/invoiceApprovedDispatch.ts')
    const approvalGate = source.indexOf("itemApproval.status !== 'approved'")
    const readinessGate = source.indexOf('await assertItemStillReady(context)', approvalGate)
    const providerSend = source.indexOf('client.createInvoices([payload], providerKey)')

    expect(approvalGate).toBeGreaterThan(-1)
    expect(source).toContain("invoiceApproval.status !== 'approved'")
    expect(readinessGate).toBeGreaterThan(approvalGate)
    expect(providerSend).toBeGreaterThan(readinessGate)
    expect(source).toContain(".eq('status', 'failed_retryable')")
    expect(source).toContain("approval(item.metadata).status !== 'approved'")
  })

  it('verifies export items and draft invoice mirrors against the same underlays', () => {
    const source = read('lib/billing/invoiceGraphCoverage.ts')

    expect(source).toContain(".from('invoice_export_items')")
    expect(source).toContain(".from('customer_invoices')")
    expect(source).toContain('missingUnderlayIds')
    expect(source).toContain('missingInvoiceItemIds')
    expect(source).toContain('mismatchedInvoiceItemIds')
  })
})

describe('customer billing card regression', () => {
  it('keeps the customer card compact and removes legacy technical controls', () => {
    const source = read('components/admin/customers/CustomerBillingMeteringCard.tsx')

    expect(source).toContain('Mätdata')
    expect(source).toContain('Underlag')
    expect(source).toContain('Senaste period')
    expect(source).not.toContain('SmartOutboundForm')
    expect(source).not.toContain('SmartPartnerExportForm')
    expect(source).not.toContain('CustomerPartnerExportsPanel')
    expect(source).not.toContain('CustomerOutboundHistoryPanel')
    expect(source).not.toContain('QuickActionButton')
  })
})
