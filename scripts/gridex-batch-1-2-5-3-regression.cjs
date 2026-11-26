#!/usr/bin/env node
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const root = path.resolve(__dirname, '..')
// TypeScript sources are formatter-dependent (single vs double quotes); the
// static assertions below are structural, so quotes are normalized for
// .ts/.tsx haystacks to keep the checks meaningful across formatter runs.
const read = (file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8')
  return /\.(ts|tsx)$/.test(file) ? source.replace(/"/g, "'") : source
}

const unit = read('lib/pricing/unitConversion.ts')
const options = read('lib/pricing/unitOptions.ts')
const pricingPage = read('app/admin/pricing/page.tsx')
const invoiceReadiness = read('lib/billing/invoiceReadiness.ts')
const underlay = read('lib/billing/underlayEngine.ts')
const capwayAuth = read('lib/integrations/billing/capway/auth.ts')
const capwayClient = read('lib/integrations/billing/capway/client.ts')
const payload = read('lib/integrations/billing/capway/payloadBuilder.ts')
const exportCore = read('lib/integrations/billing/invoiceExportCore.ts')
const migration = read('supabase/migrations/20260609100000_batch_1_2_5_3_capway_invoice_foundation.sql')
const prepareRoute = read('app/api/internal/invoice-exports/create/route.ts')
const prepareInvoices = read('lib/billing/invoiceReviewPrepare.ts')
const sendRoute = read('app/api/internal/invoice-exports/[id]/send/route.ts')
const approvedDispatch = read('lib/billing/invoiceApprovedDispatch.ts')
const approvedItemDispatch = approvedDispatch.slice(
  approvedDispatch.indexOf('async function sendApprovedItem('),
  approvedDispatch.indexOf('export async function sendApprovedInvoiceExportRun('),
)
const fileSubmit = read('app/admin/billing/invoice-files/submit.ts')
const purchaseRoute = read('app/api/internal/invoices/[id]/purchase/route.ts')

function assertBefore(source, first, second, failure) {
  const firstIndex = source.indexOf(first)
  assert(firstIndex >= 0 && source.indexOf(second) > firstIndex, failure)
}

assert(unit.includes('Explicit unit from admin/customer price setup is source of truth'), 'Batch 1 must make explicit unit source of truth')
assert(unit.includes("normalizeSingleUnit(input.unit)"), 'Batch 1 must evaluate unit before component type')
assert(unit.includes("if (unit === 'ore_per_kwh') return component.amount / 100"), 'Batch 1 must convert öre/kWh to SEK/kWh')
assert(options.includes('sek_invoice') && options.includes('kr/faktura'), 'Batch 1 UI unit options must include kr/faktura')
assert(pricingPage.includes('PRICE_UNIT_OPTIONS'), 'Batch 1 pricing UI must render central unit options')

assert(invoiceReadiness.includes('evaluateBillingMonthInvoiceReadiness'), 'Batch 2 invoice readiness evaluator missing')
assert(invoiceReadiness.includes('lockBillingPeriodForInvoiceExport'), 'Batch 2 invoice period lock missing')
assert(underlay.includes('assertBillingPeriodOpen'), 'Batch 2 underlay generation must respect locked invoice periods')
assert(migration.includes('invoice_readiness_status'), 'Batch 2 SQL invoice readiness fields missing')

assert(capwayAuth.includes('CAPWAY_APTIC_TEST_TOKEN_URL'), 'Batch 5 Capway test token env missing')
assert(capwayClient.includes('/v1/Invoices'), 'Batch 5 Capway invoices endpoint missing')
assert(payload.includes('purchasableValue(financingMode)'), 'Batch 5 Capway factoring mapping missing')
assert(payload.includes('assertCapwayDebtRowsAreExVat'), 'Batch 5 Capway VAT/ex VAT payload guard missing')
assert(payload.includes("vatCode: vatCodeForRate(vatRate)"), 'Batch 5 Capway debtRows must include vatCode')
assert(payload.includes('includingVAT: false'), 'Batch 5 Capway debtRows must be ex VAT')
assert(exportCore.includes('sendInvoiceExportRun'), 'Batch 5 invoice export send flow missing')
assert(migration.includes('billing_provider_connections'), 'Batch 5 provider connection table missing')
assert(migration.includes('invoice_export_runs'), 'Batch 5 invoice export runs table missing')
assert(migration.includes('invoice_purchase_events'), 'Batch 5 purchase event table missing')
assertBefore(prepareRoute, "await requireAdminApiAccess(['billing_underlay.export']",
  'await prepareInvoiceDraftsForReview(', 'Batch 5 preparation must require export permission first')
assert(prepareRoute.includes('await assertUserCanOperateCompany(') && prepareRoute.includes('await requireAdminOperationalCompany(') &&
  prepareRoute.includes('actorUserId: access.guard.userId') && prepareRoute.includes("mode: 'prepare_only'") &&
  prepareRoute.includes('approval_required: true') && prepareRoute.includes('blocked_customers_are_not_reserved_or_sent: true'),
  'Batch 5 preparation must remain tenant-scoped, prepare-only, and hold blocked customers')
assert(!/\b(?:createInvoiceExportRun|sendInvoiceExportRun|sendApprovedInvoiceExportRun|approveAndSendReadyInvoicesForMonth|createInvoiceFile)\b/.test(prepareRoute),
  'Batch 5 preparation must not invoke export or dispatch')
assert(prepareInvoices.includes("status: 'pending_review'") &&
  prepareInvoices.includes("'gridex_create_capway_invoice_review_draft_v1'") &&
  prepareInvoices.includes("'gridex_create_invoice_review_draft_v1'"),
  'Batch 5 preparation must reserve review drafts through their native owners')

assertBefore(sendRoute, "await requireAdminApiAccess(['billing_underlay.export']", 'await sendApprovedInvoiceExportRun(',
  'Batch 5 explicit send must require export permission first')
assert(sendRoute.includes('await assertUserCanOperateCompany(') && sendRoute.includes('await requireAdminOperationalCompany(') &&
  sendRoute.includes('actorUserId: access.guard.userId') && sendRoute.includes('approval_enforced: true'),
  'Batch 5 explicit send must remain tenant-scoped and use the approved dispatch boundary')
assertBefore(approvedItemDispatch, "if (itemApproval.status !== 'approved' || invoiceApproval.status !== 'approved') throw",
  'await assertOutboundAllowed(', 'Batch 5 dispatch requires approval of the item and invoice before outbound access')
assertBefore(approvedItemDispatch, 'await assertOutboundAllowed(', 'await assertItemStillReady(context)',
  'Batch 5 dispatch must check outbound policy and current invoice readiness')
assertBefore(fileSubmit, 'readSignedInvoiceFileIntent(token)', 'await createInvoiceFile(',
  'Batch 5 file export must validate the signed export intent before new file creation')
assertBefore(fileSubmit, "await requireAdminActionAccess(['billing_underlay.export'])", 'await createInvoiceFile(',
  'Batch 5 file creation must require export authority')
assertBefore(purchaseRoute, "await reserve('gridex_reserve_manual_capway_purchase_v1'", 'await requestCapwayInvoicePurchase(',
  'Batch 5 purchase must reserve the exact invoice before calling Capway')
assertBefore(purchaseRoute, 'if (claimed !== true) return purchaseNeedsReconciliation()', 'await requestCapwayInvoicePurchase(',
  'Batch 5 purchase must hold an unconfirmed reservation')

const customerIntake = read('app/admin/customers/intake/page.tsx')
const intakeForm = read('components/admin/customers/CustomerIntakeForm.tsx')
const intakeAction = read('app/admin/customers/actions.part-3.ts')
const actorResolvers = read('app/admin/customers/actions.part-1.ts')
const intakeGridOwner = actorResolvers.slice(
  actorResolvers.indexOf('export async function resolveOrCreateGridOwnerForIntake('),
  actorResolvers.indexOf('export async function resolveOrCreateCurrentSupplierForIntake('),
)
assert(customerIntake.includes('listGridOwners(supabase, { customerFlowOnly: true })') &&
  customerIntake.includes('gridOwners={gridOwners.map(') &&
  intakeForm.includes("name='gridOwnerId'") && intakeForm.includes('Välj nätägare (eller lämna tomt om du inte vet)'),
  'Batch 3 customer intake must offer the verified list and a safe no-owner choice')
assert(intakeAction.includes('await resolveOrCreateGridOwnerForIntake(') &&
  intakeGridOwner.includes('row.is_active === true') && intakeGridOwner.includes("row.lifecycle_status !== 'blocked'") &&
  intakeGridOwner.includes('row.verified_for_customer_flow === true') &&
  intakeGridOwner.includes("row.actor_registry_status === 'verified'") && intakeGridOwner.includes('Boolean(row.ediel_id)') &&
  /if \(!verified\) \{\s*return \{\s*gridOwnerId: null/.test(intakeGridOwner),
  'Batch 3 intake must qualify the selected actor on the server before binding it')
assert(migration.includes('verified_for_customer_flow'), 'Batch 3 actor registry verification fields missing')
assert(read('app/admin/network-owners/page.tsx').includes('Endast platform/teknisk admin'), 'Batch 3 network owner UI guard copy missing')

console.log('gridex-batch-1-2-5-3-regression: OK')
