'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { prepareEdielTestRunTransportMetadata } from '@/lib/ediel/testing/testRunTransportMetadata'
import { supabaseService } from '@/lib/supabase/service'
import { formatErrorMessage } from '@/lib/errors'

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function prepareEdielTestCenterRunAction(formData: FormData) {
  let status: 'success' | 'error' = 'success'
  let message = 'Test-run förbereddes. Du kan fortsätta i AGT/Systemtester.'
  try {
    const context = await requirePlatformAdminActionAccess()
    const companyId = stringValue(formData, 'companyId')
    const testSuite = stringValue(formData, 'testSuite') ?? 'PRODAT'
    const roleCode = stringValue(formData, 'roleCode') ?? 'supplier'
    const testCaseCode = stringValue(formData, 'testCaseCode')
    const environmentType = stringValue(formData, 'environmentType') ?? 'agt_test'
    const environment = environmentType === 'production' ? 'production' : 'test'
    const encryptionMode = stringValue(formData, 'encryptionMode') ?? 'none'

    if (!companyId) throw new Error('Välj bolag/tenant.')
    if (!testCaseCode) throw new Error('Välj testfall.')

    await prepareEdielTestRunTransportMetadata({
      actorUserId: context.userId,
      companyId,
      testSuite,
      roleCode,
      testCaseCode,
      environment,
      environmentType,
      productionLike: formData.get('productionLike') === 'true',
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
