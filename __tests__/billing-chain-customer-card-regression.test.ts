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
    expect(source).toMatch(/processApprovedInvoiceRetryQueue\(input,\s*sendApprovedItem\)/)
    const queue = read('lib/billing/approvedInvoiceRetryQueue.ts')
    const claim = read('supabase/migrations/20260930225911_partner_email_invoice_retry_fair_claims.sql')
    expect(queue).toContain("rpc('gridex_claim_approved_invoice_retries_fair_v1'")
    expect(queue).toContain("row.status !== 'failed_retryable'")
    expect(queue).toContain("approval.status !== 'approved'")
    expect(queue).toContain('!text(approval.approved_by)')
    expect(claim).toContain("q.status='failed_retryable' and q.next_retry_at<=$4")
    expect(claim).toContain("q.metadata#>>'{approval,status}'='approved'")
    expect(claim).toContain("nullif(btrim(q.metadata#>>'{approval,approved_by}'),'') is not null")
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
