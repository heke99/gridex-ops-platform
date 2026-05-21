'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdminActionAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { runBatch2BAutomation, createBillingBlockerCasesForCompany } from '@/lib/operations/batch2bAutomation'

async function resolveCompanyId(userId: string): Promise<string> {
  const scope = await getOperationalCompanyScope(userId)
  if (!scope.companyId) throw new Error(scope.message ?? 'Bolagskoppling saknas.')
  return scope.companyId
}

function revalidate() {
  revalidatePath('/admin/operations/automation')
  revalidatePath('/admin/controltower')
  revalidatePath('/admin/customer-cases')
  revalidatePath('/admin/customer-info-requests')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/billing/export-center')
}

function done(status: 'success' | 'error', message: string): never {
  const params = new URLSearchParams({ status, message })
  redirect(`/admin/operations/automation?${params.toString()}`)
}

export async function runBatch2BAutomationAction(_formData: FormData): Promise<void> {
  try {
    const admin = await requireAdminActionAccess({ anyOf: ['customers.write', 'metering.write', 'billing_underlay.export', 'cases.write'] })
    const companyId = await resolveCompanyId(admin.userId)
    const result = await runBatch2BAutomation({ companyId, actorUserId: admin.userId })
    revalidate()
    done('success', `Automation körd. ${result.requestsCreated} requests, ${result.casesCreated} ärenden och ${result.blockersFound} blockerare hanterades.`)
  } catch (error) {
    done('error', error instanceof Error ? error.message : 'Automation kunde inte köras.')
  }
}

export async function createBillingBlockerCasesAction(_formData: FormData): Promise<void> {
  try {
    const admin = await requireAdminActionAccess({ anyOf: ['cases.write', 'billing_underlay.export'] })
    const companyId = await resolveCompanyId(admin.userId)
    const result = await createBillingBlockerCasesForCompany({ companyId, actorUserId: admin.userId })
    revalidate()
    done('success', `${result.casesCreated} ärenden skapades för ${result.blockersFound} blockerade export-/underlagsrader.`)
  } catch (error) {
    done('error', error instanceof Error ? error.message : 'Ärenden kunde inte skapas.')
  }
}
