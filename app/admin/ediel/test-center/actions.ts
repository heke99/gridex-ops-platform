'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdminActionAccess } from '@/lib/admin/guards'
import { prepareEdielTestRunTransportMetadata } from '@/lib/ediel/testing/testRunTransportMetadata'

function stringValue(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function prepareEdielTestCenterRunAction(formData: FormData) {
  const context = await requirePlatformAdminActionAccess()
  const companyId = stringValue(formData, 'companyId')
  const testSuite = stringValue(formData, 'testSuite') ?? 'PRODAT'
  const roleCode = stringValue(formData, 'roleCode') ?? 'supplier'
  const testCaseCode = stringValue(formData, 'testCaseCode')
  const environment = stringValue(formData, 'environment') === 'production' ? 'production' : 'test'
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
    productionLike: formData.get('productionLike') === 'true',
    encryptionMode,
  })

  revalidatePath('/admin/ediel/test-center')
  revalidatePath('/admin/ediel/system-tests')
  revalidatePath('/admin/ediel/agt')
}
