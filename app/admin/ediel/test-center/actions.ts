'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { prepareEdielTestRunTransportMetadata } from '@/lib/ediel/testing/testRunTransportMetadata'
import { resolveEdielTestCenterIsolation } from '@/lib/ediel/testing/testCenterSafety'
import { runTestCenterMeteringToInvoiceChain } from '@/lib/ediel/testing/testCenterRuntimeChain'
import { importRawEdifactAndRunTestCenterChain } from '@/lib/ediel/testing/testCenterRawEdifactImport'
import { supabaseService } from '@/lib/supabase/service'
import { formatErrorMessage } from '@/lib/errors'

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

async function rawEdifactFromForm(formData: FormData): Promise<{ raw: string; filename: string | null }> {
  const pasted = stringValue(formData, 'rawEdifact')
  const file = formData.get('edifactFile')
  if (file instanceof File && file.size > 0) {
    if (file.size > 2 * 1024 * 1024) throw new Error('EDIFACT-filen får vara högst 2 MB.')
    const raw = (await file.text()).trim()
    if (!raw) throw new Error('Den uppladdade EDIFACT-filen är tom.')
    return { raw, filename: file.name || null }
  }
  if (!pasted) throw new Error('Ladda upp en EDIFACT-fil eller klistra in EDIFACT-innehåll.')
  return { raw: pasted, filename: null }
}

export async function prepareEdielTestCenterRunAction(formData: FormData) {
  let status: 'success' | 'error' = 'success'
  let message = 'Test-run förbereddes i isolerad testmiljö. Du kan fortsätta i AGT/Systemtester.'
  try {
    const context = await requirePlatformAdminActionAccess()
    const companyId = stringValue(formData, 'companyId')
    const testSuite = stringValue(formData, 'testSuite') ?? 'PRODAT'
    const roleCode = stringValue(formData, 'roleCode')
    const testCaseCode = stringValue(formData, 'testCaseCode')
    const isolation = resolveEdielTestCenterIsolation({
      environmentType: stringValue(formData, 'environmentType') ?? 'agt_test',
      productionLike: formData.get('productionLike') === 'true',
    })
    const encryptionMode = stringValue(formData, 'encryptionMode') ?? 'none'

    if (!companyId) throw new Error('Välj bolag/tenant.')
    if (!roleCode || !['supplier', 'esco'].includes(roleCode)) throw new Error('Välj en giltig aktörsroll explicit.')
    if (!testCaseCode) throw new Error('Välj testfall.')

    await prepareEdielTestRunTransportMetadata({
      actorUserId: context.userId,
      companyId,
      testSuite,
      roleCode,
      testCaseCode,
      environment: isolation.environment,
      environmentType: isolation.environmentType,
      productionLike: isolation.productionLike,
      encryptionMode,
    })

    revalidatePath('/admin/ediel/test-center')
    revalidatePath('/admin/ediel/system-tests')
    revalidatePath('/admin/ediel/agt')
  } catch (error) {
    status = 'error'
    message = formatErrorMessage(error, 'Test-run kunde inte förberedas.')
  }
  redirect(`/admin/ediel/test-center?runStatus=${status}&runMessage=${encodeURIComponent(message)}`)
}

export async function importRawEdifactAndRunTestCenterAction(formData: FormData) {
  let status: 'success' | 'error' = 'success'
  let message = 'EDIFACT importerades och testkedjan kördes.'

  try {
    const context = await requirePlatformAdminActionAccess()
    const companyId = stringValue(formData, 'runtimeCompanyId')
    const customerId = stringValue(formData, 'runtimeCustomerId')
    const billingMonth = stringValue(formData, 'runtimeBillingMonth')
    if (!companyId || !customerId || !billingMonth) {
      throw new Error('Bolag, testkund och fakturamånad krävs.')
    }
    const source = await rawEdifactFromForm(formData)
    const result = await importRawEdifactAndRunTestCenterChain({
      actorUserId: context.userId,
      companyId,
      customerId,
      billingMonth,
      rawEdifact: source.raw,
      filename: source.filename,
    })

    message = result.runtime.billingUnderlayId
      ? `EDIFACT verifierad och behandlad via canonical inbound. ${result.runtime.meteringValueIds.length} mätvärdesrader skapades, billing-underlag ${result.runtime.billingUnderlayId} och fakturautkast förbereddes i testmiljö. SHA256 ${result.sourceSha256.slice(0, 12)}…`
      : `EDIFACT verifierad och behandlad via canonical inbound. ${result.runtime.meteringValueIds.length} mätvärdesrader skapades. Inget faktureringsunderlag skapades. SHA256 ${result.sourceSha256.slice(0, 12)}…`

    revalidatePath('/admin/ediel/test-center')
    revalidatePath('/admin/ediel/test-center/metering-to-invoice')
    revalidatePath('/admin/metering')
    revalidatePath('/admin/billing')
  } catch (error) {
    status = 'error'
    message = formatErrorMessage(error, 'EDIFACT-importen eller testkedjan misslyckades.')
  }

  redirect(`/admin/ediel/test-center/metering-to-invoice?runStatus=${status}&runMessage=${encodeURIComponent(message)}`)
}

export async function runTestCenterMeteringToInvoiceAction(formData: FormData) {
  let status: 'success' | 'error' = 'success'
  let message = 'Testkedjan kördes i isolerad testmiljö.'

  try {
    const context = await requirePlatformAdminActionAccess()
    const companyId = stringValue(formData, 'runtimeCompanyId')
    const customerId = stringValue(formData, 'runtimeCustomerId')
    const edielMessageId = stringValue(formData, 'runtimeEdielMessageId')
    const billingMonth = stringValue(formData, 'runtimeBillingMonth')

    if (!companyId || !customerId || !edielMessageId || !billingMonth) {
      throw new Error('Bolag, testkund, Ediel-meddelande och fakturamånad krävs.')
    }

    const result = await runTestCenterMeteringToInvoiceChain({
      actorUserId: context.userId,
      companyId,
      customerId,
      edielMessageId,
      billingMonth,
    })

    message = result.billingUnderlayId
      ? `Testkedjan kördes: ${result.meteringValueIds.length} mätvärdesrader, billing-underlag ${result.billingUnderlayId} och fakturautkast förbereddes i testmiljö.`
      : `UTILTS behandlades i testmiljö och ${result.meteringValueIds.length} mätvärdesrader skapades. Inget faktureringsunderlag skapades för detta meddelande.`

    revalidatePath('/admin/ediel/test-center')
    revalidatePath('/admin/metering')
    revalidatePath('/admin/billing')
  } catch (error) {
    status = 'error'
    message = formatErrorMessage(error, 'Testkedjan kunde inte köras.')
  }

  redirect(`/admin/ediel/test-center?runStatus=${status}&runMessage=${encodeURIComponent(message)}`)
}

export async function releaseEdielTestRunLockAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const lockId = stringValue(formData, 'lockId')
  if (!lockId) throw new Error('Testlås saknas.')

  const { error } = await supabaseService
    .from('ediel_test_run_locks')
    .update({
      released_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: {
        releasedBy: context.userId,
        releaseReason: stringValue(formData, 'releaseReason') ?? 'Manual release from Test Center.',
      },
    })
    .eq('id', lockId)

  if (error) throw error
  revalidatePath('/admin/ediel/test-center')
  revalidatePath('/admin/ediel/readiness')
}
