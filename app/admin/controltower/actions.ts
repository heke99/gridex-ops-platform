'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdminActionAccess } from '@/lib/admin/guards'
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
  revalidatePath('/admin/customer-cases')
  revalidatePath('/admin/outbound')
  revalidatePath('/admin/billing/export-center')
}

function done(status: 'success' | 'error', message: string): never {
  const params = new URLSearchParams({ status, message })
  redirect(`/admin/controltower?${params.toString()}`)
}

export async function runControlTowerPeriodMotorAction(formData: FormData): Promise<void> {
  try {
    const admin = await requireAdminActionAccess({ anyOf: ['metering.write', 'billing_underlay.export', 'cases.write'] })
    const companyId = await resolveCompanyId(admin.userId)
    const result = await runBatch2CPeriodMotor({
      companyId,
      actorUserId: admin.userId,
      startMonth: text(formData, 'start_month') || null,
      endMonth: text(formData, 'end_month') || null,
    })
    revalidate()
    done('success', `Periodmotor körd. ${result.gapsCreated} luckor, ${result.outboundRequestsCreated} requests och ${result.casesCreated} ärenden hanterades.`)
  } catch (error) {
    done('error', error instanceof Error ? error.message : 'Periodmotorn kunde inte köras.')
  }
}

export async function createControlTowerCasesAction(_formData: FormData): Promise<void> {
  try {
    const admin = await requireAdminActionAccess({ anyOf: ['cases.write', 'metering.write', 'billing_underlay.export'] })
    const companyId = await resolveCompanyId(admin.userId)
    const result = await createCasesForBatch2CQueues({ companyId, actorUserId: admin.userId })
    revalidate()
    done('success', `${result.casesCreated} ärenden skapades/återanvändes från ${result.queuesScanned} driftköer.`)
  } catch (error) {
    done('error', error instanceof Error ? error.message : 'Ärenden kunde inte skapas från driftköer.')
  }
}

export async function resolveControlTowerQueueItemAction(formData: FormData): Promise<void> {
  try {
    const admin = await requireAdminActionAccess({ anyOf: ['cases.write', 'metering.write', 'billing_underlay.export', 'partner_exports.write'] })
    const companyId = await resolveCompanyId(admin.userId)
    const queueType = text(formData, 'queue_type')
    const sourceId = text(formData, 'source_id')
    if (!queueType || !sourceId) throw new Error('Kötyp eller källa saknas.')
    await resolveBatch2CQueueItem({ companyId, actorUserId: admin.userId, queueType, sourceId })
    revalidate()
    done('success', 'Driftkön markerades som hanterad eller redo för nästa steg.')
  } catch (error) {
    done('error', error instanceof Error ? error.message : 'Kön kunde inte uppdateras.')
  }
}
