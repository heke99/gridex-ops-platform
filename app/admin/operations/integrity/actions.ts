// app/admin/operations/integrity/actions.ts
'use server'

import { redirect } from 'next/navigation'
import {
  bulkQueueMissingBillingUnderlaysAction,
  bulkQueueMissingMeterValuesAction,
  bulkQueueReadySupplierSwitchesAction,
} from '@/app/admin/cis/actions'
import { bulkQueueReadyBillingExportsAction } from '@/app/admin/operations/control-actions'

function buildRedirectUrl(params: {
  status: 'success' | 'error'
  action: string
  period?: string | null
  message?: string | null
  createdCount?: number | null
  skippedCount?: number | null
  candidateCount?: number | null
  batchKey?: string | null
}): string {
  const search = new URLSearchParams()
  search.set('status', params.status)
  search.set('action', params.action)

  if (params.period) search.set('period', params.period)
  if (params.message) search.set('message', params.message)
  if (typeof params.createdCount === 'number') {
    search.set('createdCount', String(params.createdCount))
  }
  if (typeof params.skippedCount === 'number') {
    search.set('skippedCount', String(params.skippedCount))
  }
  if (typeof params.candidateCount === 'number') {
    search.set('candidateCount', String(params.candidateCount))
  }
  if (params.batchKey) search.set('batchKey', params.batchKey)

  return `/admin/operations/integrity?${search.toString()}`
}

function getPeriod(formData: FormData): string | null {
  const value = String(formData.get('period_month') ?? '').trim()
  return value || null
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  return 'Åtgärden misslyckades. Kontrollera data, behörigheter och köstatus.'
}

export async function runBulkQueueMissingMeterValuesFromIntegrityAction(
  formData: FormData
): Promise<void> {
  const period = getPeriod(formData)

  try {
    const result = await bulkQueueMissingMeterValuesAction(formData)

    redirect(
      buildRedirectUrl({
        status: 'success',
        action: 'bulk_queue_missing_meter_values',
        period,
        createdCount: result.createdCount,
        skippedCount: result.skippedCount,
        batchKey: result.batchKey,
      })
    )
  } catch (error) {
    redirect(
      buildRedirectUrl({
        status: 'error',
        action: 'bulk_queue_missing_meter_values',
        period,
        message: normalizeErrorMessage(error),
      })
    )
  }
}

export async function runBulkQueueMissingBillingUnderlaysFromIntegrityAction(
  formData: FormData
): Promise<void> {
  const period = getPeriod(formData)

  try {
    const result = await bulkQueueMissingBillingUnderlaysAction(formData)

    redirect(
      buildRedirectUrl({
        status: 'success',
        action: 'bulk_queue_missing_billing_underlays',
        period,
        createdCount: result.createdCount,
        skippedCount: result.skippedCount,
        batchKey: result.batchKey,
      })
    )
  } catch (error) {
    redirect(
      buildRedirectUrl({
        status: 'error',
        action: 'bulk_queue_missing_billing_underlays',
        period,
        message: normalizeErrorMessage(error),
      })
    )
  }
}

export async function runBulkQueueReadySupplierSwitchesFromIntegrityAction(): Promise<void> {
  try {
    const result = await bulkQueueReadySupplierSwitchesAction()

    redirect(
      buildRedirectUrl({
        status: 'success',
        action: 'bulk_queue_ready_supplier_switches',
        createdCount: result.createdCount,
        skippedCount: result.skippedCount,
        batchKey: result.batchKey,
      })
    )
  } catch (error) {
    redirect(
      buildRedirectUrl({
        status: 'error',
        action: 'bulk_queue_ready_supplier_switches',
        message: normalizeErrorMessage(error),
      })
    )
  }
}

export async function runBulkQueueReadyBillingExportsFromIntegrityAction(
  formData: FormData
): Promise<void> {
  const period = getPeriod(formData)

  try {
    const result = await bulkQueueReadyBillingExportsAction(formData)

    redirect(
      buildRedirectUrl({
        status: 'success',
        action: 'bulk_queue_ready_billing_exports',
        period,
        createdCount: result.createdCount,
        skippedCount: result.skippedCount,
        candidateCount: result.candidateCount,
        batchKey: result.batchKey,
      })
    )
  } catch (error) {
    redirect(
      buildRedirectUrl({
        status: 'error',
        action: 'bulk_queue_ready_billing_exports',
        period,
        message: normalizeErrorMessage(error),
      })
    )
  }
}