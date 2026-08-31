'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { formatErrorMessage } from '@/lib/errors'
import { buildCreateCustomerParams } from '@/app/admin/customers/actions.part-1'
import { createCustomerGraph } from '@/app/admin/customers/actions.part-2'
import { importRawEdifactAndRunTestCenterChain } from '@/lib/ediel/testing/testCenterRawEdifactImport'
import { runTestCenterMeteringToInvoiceChain } from '@/lib/ediel/testing/testCenterRuntimeChain'
import { materializeTestCenterScenario, type TestCenterScenario } from '@/lib/ediel/testing/testCenterScenarios'
import {
  archiveInvoiceTestCustomer,
  assertInvoiceTestCustomer,
  markInvoiceTestCustomerGraph,
  resetInvoiceTestCustomerRun,
} from '@/lib/ediel/testing/invoiceTestCenterWorkspace'
import { approveAndSendInvoiceTestItem } from '@/lib/billing/invoiceTestCenterDispatch'

const WORKSPACE = '/admin/ediel/test-center/invoice-test'

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function scenarioValue(formData: FormData): TestCenterScenario {
  const value = stringValue(formData, 'testScenario') ?? 'baseline'
  if (!['baseline', 'duplicate', 'missing_values', 'correction', 'rebilling'].includes(value)) {
    throw new Error('Ogiltigt Fakturatest-scenario.')
  }
  return value as TestCenterScenario
}

async function rawEdifactFromForm(formData: FormData) {
  const pasted = stringValue(formData, 'rawEdifact')
  const file = formData.get('edifactFile')
  if (file instanceof File && file.size > 0) {
    if (file.size > 2 * 1024 * 1024) throw new Error('EDIFACT-filen får vara högst 2 MB.')
    const raw = (await file.text()).trim()
    if (!raw) throw new Error('Den uppladdade EDIFACT-filen är tom.')
    return { raw, filename: file.name || null }
  }
  if (!pasted) throw new Error('Ladda upp en EDIFACT-fil eller klistra in rå EDIFACT.')
  return { raw: pasted, filename: null }
}

function workspaceRedirect(input: {
  status: 'success' | 'error'
  message: string
  companyId?: string | null
  customerId?: string | null
  traceHref?: string | null
}) {
  const query = new URLSearchParams({ runStatus: input.status, runMessage: input.message })
  if (input.companyId) query.set('companyId', input.companyId)
  if (input.customerId) query.set('customerId', input.customerId)
  if (input.traceHref) query.set('traceHref', input.traceHref)
  redirect(`${WORKSPACE}?${query.toString()}`)
}

function traceHref(input: { edielMessageId: string; billingMonth: string; underlayId?: string | null }) {
  const query = new URLSearchParams({ billingMonth: input.billingMonth })
  if (input.underlayId) query.set('underlayId', input.underlayId)
  return `/admin/ediel/test-center/metering-to-invoice/trace/${encodeURIComponent(input.edielMessageId)}?${query.toString()}`
}

export async function createInvoiceTestCustomerAction(formData: FormData) {
  let companyId: string | null = null
  try {
    const context = await requirePlatformAdminActionAccess()
    companyId = stringValue(formData, 'companyId')
    if (!companyId) throw new Error('Välj bolag/tenant.')
    if (!stringValue(formData, 'contractOfferId')) throw new Error('Välj ett riktigt internt avtal för testkunden.')
    const built = buildCreateCustomerParams(formData, context.userId, companyId)
    const startDate = stringValue(formData, 'contractStartDate')
    const email = stringValue(formData, 'email')
    const street = stringValue(formData, 'street')
    const postalCode = stringValue(formData, 'postalCode')
    const city = stringValue(formData, 'city')
    if (!startDate) throw new Error('Avtalsstart krävs för testkunden.')
    const customer = await createCustomerGraph({
      ...built,
      actorUserId: context.userId,
      companyId,
      customerType: 'private',
      intakeFlowType: null,
      email,
      phone: stringValue(formData, 'phone') ?? '0701234567',
      siteType: 'consumption',
      currentSupplierId: null,
      currentSupplierName: null,
      currentSupplierOrgNumber: null,
      currentSupplierUnknown: true,
      customerConfirmationStatus: 'confirmed',
      authorizationStatus: null,
      authorizationValidFrom: null,
      authorizationValidTo: null,
      expectedStartDate: startDate,
      confirmedStartDate: startDate,
      actualStartDate: startDate,
      startDateSource: 'manual_admin',
      street,
      postalCode,
      city,
      country: 'SE',
      contractStartDate: startDate,
      contractStatus: 'active',
      overrideReason: null,
      contractTypeOverride: null,
      fixedPriceOrePerKwh: null,
      spotMarkupOrePerKwh: null,
      variableFeeOrePerKwh: null,
      monthlyFeeSek: null,
      invoiceFeeSek: null,
      startFeeSek: null,
      adminFeeSek: null,
      breakFeeSek: null,
      greenFeeMode: null,
      greenFeeValue: null,
      bindingMonths: null,
      noticeMonths: null,
      optionalFeeLines: [],
      duplicateResolution: 'create_separate_confirmed',
      existingCustomerId: null,
      duplicateOverrideReason: 'Isolerad Fakturatest-kund skapad av superadmin.',
      invoiceRecipient: stringValue(formData, 'invoiceRecipient') ?? `${stringValue(formData, 'firstName') ?? 'Test'} ${stringValue(formData, 'lastName') ?? 'Kund'}`,
      invoiceEmail: stringValue(formData, 'invoiceEmail') ?? email,
      invoiceReference: 'GRIDEX-FAKTURATEST',
      billingStreet: street,
      billingPostalCode: postalCode,
      billingCity: city,
      billingCountry: 'SE',
      billingAddressSameAsSite: true,
      billingLevel: 'customer',
      consolidatedInvoice: false,
      intakeCreateMode: 'create',
      signedAgreementFile: null,
      signedPowerOfAttorneyFile: null,
      gridInvoiceFile: null,
      postCreateAction: 'open_customer',
      postCreateRequestTarget: 'both',
    })
    await markInvoiceTestCustomerGraph({
      companyId,
      customerId: customer.id,
      siteId: customer.__createdSiteId,
      meteringPointId: customer.__createdMeteringPointId,
      contractId: null,
      actorUserId: context.userId,
    })
    revalidatePath(WORKSPACE)
    workspaceRedirect({
      status: 'success',
      message: `Testkund ${customer.customer_number ?? customer.id} skapades via canonical kundintag och märktes is_test_data.`,
      companyId,
      customerId: customer.id,
    })
  } catch (error) {
    workspaceRedirect({ status: 'error', message: formatErrorMessage(error, 'Testkunden kunde inte skapas.'), companyId })
  }
}

export async function importInvoiceTestEdifactAction(formData: FormData) {
  let companyId: string | null = null
  let customerId: string | null = null
  try {
    const context = await requirePlatformAdminActionAccess()
    companyId = stringValue(formData, 'companyId')
    customerId = stringValue(formData, 'customerId')
    const billingMonth = stringValue(formData, 'billingMonth')
    if (!companyId || !customerId || !billingMonth) throw new Error('Bolag, testkund och fakturamånad krävs.')
    await assertInvoiceTestCustomer({ companyId, customerId })
    const source = await rawEdifactFromForm(formData)
    const scenario = scenarioValue(formData)
    const plan = materializeTestCenterScenario(source.raw, scenario)
    let last: Awaited<ReturnType<typeof importRawEdifactAndRunTestCenterChain>> | null = null
    let expectedBlock: string | null = null
    for (const run of plan.runs) {
      try {
        last = await importRawEdifactAndRunTestCenterChain({
          actorUserId: context.userId,
          companyId,
          customerId,
          billingMonth,
          rawEdifact: run.rawEdifact,
          filename: source.filename ? `${run.label}-${source.filename}` : `invoice-test-${scenario}-${run.label}.edi`,
        })
      } catch (error) {
        if (run.expectation === 'blocked_missing_values') {
          expectedBlock = formatErrorMessage(error, 'Missing-values blockerades som väntat.')
          continue
        }
        throw error
      }
    }
    if (scenario === 'missing_values') {
      if (last) throw new Error('Missing-values-scenariot skapade oväntat ett godkänt fakturaflöde.')
      revalidatePath(WORKSPACE)
      workspaceRedirect({ status: 'success', message: `Missing-values verifierat: ${expectedBlock ?? 'kedjan blockerades.'}`, companyId, customerId })
    }
    if (!last) throw new Error('Fakturatest gav inget verifierbart körresultat.')
    revalidatePath(WORKSPACE)
    workspaceRedirect({
      status: 'success',
      message: `${scenario} kördes genom canonical UTILTS → mätvärden → billing → pricing → fakturautkast.`,
      companyId,
      customerId,
      traceHref: traceHref({ edielMessageId: last.edielMessageId, billingMonth, underlayId: last.billingUnderlayId }),
    })
  } catch (error) {
    workspaceRedirect({ status: 'error', message: formatErrorMessage(error, 'EDIFACT/Fakturatest misslyckades.'), companyId, customerId })
  }
}

export async function rerunInvoiceTestMessageAction(formData: FormData) {
  let companyId: string | null = null
  let customerId: string | null = null
  try {
    const context = await requirePlatformAdminActionAccess()
    companyId = stringValue(formData, 'companyId')
    customerId = stringValue(formData, 'customerId')
    const billingMonth = stringValue(formData, 'billingMonth')
    const edielMessageId = stringValue(formData, 'edielMessageId')
    if (!companyId || !customerId || !billingMonth || !edielMessageId) throw new Error('Välj testkund, månad och testmeddelande.')
    await assertInvoiceTestCustomer({ companyId, customerId })
    const result = await runTestCenterMeteringToInvoiceChain({
      actorUserId: context.userId,
      companyId,
      customerId,
      billingMonth,
      edielMessageId,
    })
    revalidatePath(WORKSPACE)
    workspaceRedirect({
      status: 'success',
      message: 'Befintlig test-UTILTS kördes om genom samma fakturakedja.',
      companyId,
      customerId,
      traceHref: traceHref({ edielMessageId, billingMonth, underlayId: result.billingUnderlayId }),
    })
  } catch (error) {
    workspaceRedirect({ status: 'error', message: formatErrorMessage(error, 'Omkörningen misslyckades.'), companyId, customerId })
  }
}

export async function sendInvoiceTestToProviderAction(formData: FormData) {
  let companyId: string | null = null
  let customerId: string | null = null
  try {
    const context = await requirePlatformAdminActionAccess()
    companyId = stringValue(formData, 'companyId')
    customerId = stringValue(formData, 'customerId')
    const itemId = stringValue(formData, 'invoiceExportItemId')
    if (!companyId || !customerId || !itemId) throw new Error('Testkund och fakturautkast krävs.')
    await assertInvoiceTestCustomer({ companyId, customerId })
    const result = await approveAndSendInvoiceTestItem({ companyId, itemId, actorUserId: context.userId })
    revalidatePath(WORKSPACE)
    workspaceRedirect({
      status: result.status === 'sent' ? 'success' : 'error',
      message: result.status === 'sent'
        ? `Testfakturan skapades hos Capway/Aptic TEST. Provider-ID: ${result.invoiceGuid ?? 'saknas'}.`
        : `Capway/Aptic TEST returnerade ${result.status}. ${'error' in result ? result.error ?? '' : ''}`,
      companyId,
      customerId,
    })
  } catch (error) {
    workspaceRedirect({ status: 'error', message: formatErrorMessage(error, 'Testfakturan kunde inte skickas till Capway/Aptic TEST.'), companyId, customerId })
  }
}

export async function resetInvoiceTestCustomerAction(formData: FormData) {
  let companyId: string | null = null
  let customerId: string | null = null
  try {
    const context = await requirePlatformAdminActionAccess()
    companyId = stringValue(formData, 'companyId')
    customerId = stringValue(formData, 'customerId')
    if (!companyId || !customerId) throw new Error('Välj testkund.')
    const result = await resetInvoiceTestCustomerRun({ companyId, customerId, actorUserId: context.userId })
    revalidatePath(WORKSPACE)
    workspaceRedirect({ status: 'success', message: `Testkörningen återställdes. ${result.cancelledDrafts} oskickade fakturautkast avbröts; audit och skickade providerfakturor bevarades.`, companyId, customerId })
  } catch (error) {
    workspaceRedirect({ status: 'error', message: formatErrorMessage(error, 'Testkörningen kunde inte återställas.'), companyId, customerId })
  }
}

export async function archiveInvoiceTestCustomerAction(formData: FormData) {
  let companyId: string | null = null
  let customerId: string | null = null
  try {
    const context = await requirePlatformAdminActionAccess()
    companyId = stringValue(formData, 'companyId')
    customerId = stringValue(formData, 'customerId')
    if (!companyId || !customerId) throw new Error('Välj testkund.')
    await archiveInvoiceTestCustomer({ companyId, customerId, actorUserId: context.userId })
    revalidatePath(WORKSPACE)
    workspaceRedirect({ status: 'success', message: 'Testkunden togs bort från Fakturatest genom säker arkivering. Provider- och auditspår bevarades.', companyId })
  } catch (error) {
    workspaceRedirect({ status: 'error', message: formatErrorMessage(error, 'Testkunden kunde inte arkiveras.'), companyId, customerId })
  }
}
