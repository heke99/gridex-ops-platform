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

  it('generates underlays before preparing per-customer invoice drafts and never sends from monthly automation', () => {
    const source = read('lib/billing/monthlyAutomation.ts')
    const underlayIndex = source.indexOf('generateBillingUnderlaysForMonth({')
    const prepareIndex = source.indexOf('prepareInvoiceDraftsForReview({')

    expect(underlayIndex).toBeGreaterThan(-1)
    expect(prepareIndex).toBeGreaterThan(underlayIndex)
    expect(source).toContain("source: 'monthly_billing_prepare_only_v2'")
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

  it('resolves Capway environment from tenant config, not request body overrides', () => {
    const source = read('app/api/internal/invoice-exports/create/route.ts')

    expect(source).toContain('billing_provider_environment')
    expect(source).toContain("billing_provider_environment === 'production' ? 'production' : 'test'")
    expect(source).not.toContain("body.environment === 'production' ? 'production' : 'test'")
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

  it('blocks approve/send when reserved kWh drifts from the live underlay', () => {
    const source = read('lib/billing/invoiceApprovedDispatch.ts')
    const readiness = source.slice(source.indexOf('async function assertItemStillReady'), source.indexOf('async function approveItem'))

    expect(readiness).toContain('context.item.total_kwh')
    expect(readiness).toContain('context.underlay.total_kwh')
    expect(readiness).toContain('Math.abs(underlayKwh - itemKwh) > 0.001')
    expect(readiness).toContain('Math.abs(underlayKwh - invoiceKwh) > 0.001')
  })

  it('fails closed when the named contract price snapshot cannot be loaded', () => {
    const source = read('lib/billing/invoiceReviewPrepare.ts')

    expect(source).toContain('if (!priceSnapshot) throw new Error(')
    expect(source).not.toContain('if (!priceSnapshot && !snapshotId)')
  })

  it('cancels incomplete drafts after enrichment failure and ignores cancelled reservations', () => {
    const source = read('lib/billing/invoiceReviewPrepare.ts')

    expect(source).toContain("status: 'cancelled'")
    expect(source).toContain("calculation_snapshot_enrichment_failed")
    expect(source).toContain(".neq('status', 'cancelled')")
  })

  it('keeps Capway paymentCondition aligned with the caller dueDate for B2B terms', () => {
    const source = read('lib/integrations/billing/capway/payloadBuilder.ts')

    expect(source).toContain('Math.max(1, input.paymentConditionDays ?? 20)')
    expect(source).not.toContain('Math.max(20, input.paymentConditionDays ?? 20)')
  })

  it('keeps Vercel crons on five-field schedules', () => {
    const source = read('vercel.json')

    expect(source).toContain('"schedule": "10 5 * * *"')
    expect(source).not.toContain('"schedule": "10 5 * * * *"')
  })

  it('classifies failed_retryable as failed and prefers locked kWh in review rows', () => {
    const source = read('lib/billing/invoiceReviewData.ts')

    expect(source).toContain("'failed_retryable'")
    expect(source).toContain("num(item?.total_kwh)")
  })

  it('shows sent status before approval on invoice detail', () => {
    const source = read('app/admin/billing/invoices/[id]/page.tsx')

    expect(source).toMatch(/detail\.item\.status === 'sent'[\s\S]*approvalStatus === 'approved'/)
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

  it('surfaces invoice_readiness_status so drafted and sent invoices are not shown as bare underlay-ready', () => {
    const source = read('components/admin/customers/CustomerBillingMeteringCard.tsx')

    expect(source).toContain('invoice_readiness_status')
    expect(source).toContain('Fakturerad')
    expect(source).toContain('Klar för faktura')
  })
})
