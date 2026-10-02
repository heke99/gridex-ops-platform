'use server'

import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'
import { requireAdminActionAccess, requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { createCasesForBatch2CQueues, resolveBatch2CQueueItem, runBatch2CPeriodMotor } from '@/lib/operations/batch2cAutomation'

async function resolveCompanyId(userId: string): Promise<string> {
  const scope = await getOperationalCompanyScope(userId)
  if (!scope.companyId) throw new Error(scope.message ?? 'Bolagskoppling saknas.')
  return scope.companyId
}

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim()
}

function revalidate() {
  revalidatePath('/admin/controltower')
  revalidatePath('/admin/operations/automation')
  revalidatePath('/admin/operations/tasks')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/billing/export-center')
}

function done(status: 'success' | 'error', message: string): never {
  const params = new URLSearchParams({ status, message })
  redirect(`/admin/controltower?${params.toString()}`)
}

export async function runControlTowerPeriodMotorAction(formData: FormData): Promise<void> {
  try {
    const sessionAdmin = await requireAdminActionAccess({ anyOf: ['metering.write', 'billing_underlay.export', 'cases.write'] })
    const companyId = await resolveCompanyId(sessionAdmin.userId)
    const admin = await requireCompanyScopedActionAccess(companyId, { anyOf: ['metering.write', 'billing_underlay.export', 'cases.write'] })
    const result = await runBatch2CPeriodMotor({
      companyId,
      actorUserId: admin.userId,
      startMonth: text(formData, 'start_month') || null,
      endMonth: text(formData, 'end_month') || null,
    })
    revalidate()
    done('success', `Periodmotor körd. ${result.gapsCreated} luckor, ${result.outboundRequestsCreated} requests och ${result.casesCreated} driftuppgifter hanterades.`)
  } catch (error) {
    unstable_rethrow(error)
    done('error', error instanceof Error ? error.message : 'Periodmotorn kunde inte köras.')
  }
}

export async function createControlTowerCasesAction(): Promise<void> {
  try {
    const sessionAdmin = await requireAdminActionAccess({ anyOf: ['cases.write', 'metering.write', 'billing_underlay.export'] })
    const companyId = await resolveCompanyId(sessionAdmin.userId)
    const admin = await requireCompanyScopedActionAccess(companyId, { anyOf: ['cases.write', 'metering.write', 'billing_underlay.export'] })
    const result = await createCasesForBatch2CQueues({ companyId, actorUserId: admin.userId })
    revalidate()
    done('success', `${result.casesCreated} driftuppgifter skapades/återanvändes från ${result.queuesScanned} driftköer.`)
  } catch (error) {
    unstable_rethrow(error)
    done('error', error instanceof Error ? error.message : 'Driftuppgifter kunde inte skapas från driftköer.')
  }
}

export async function resolveControlTowerQueueItemAction(formData: FormData): Promise<void> {
  try {
    // The queue row's own tenant, authorised for the actor; never the session default.
    const companyId = text(formData, 'company_id')
    if (!companyId) throw new Error('Bolag saknas för driftkön.')
    const admin = await requireCompanyScopedActionAccess(companyId, { anyOf: ['cases.write', 'metering.write', 'billing_underlay.export', 'partner_exports.write'] })
    const queueType = text(formData, 'queue_type')
    const sourceId = text(formData, 'source_id')
    if (!queueType || !sourceId) throw new Error('Kötyp eller källa saknas.')
    await resolveBatch2CQueueItem({ companyId, actorUserId: admin.userId, queueType, sourceId })
    revalidate()
    done('success', 'Driftkön markerades som hanterad eller redo för nästa steg.')
  } catch (error) {
    unstable_rethrow(error)
    done('error', error instanceof Error ? error.message : 'Kön kunde inte uppdateras.')
  }
}
