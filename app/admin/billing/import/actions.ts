'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdminActionAccess, requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { parseBillingUnderlayText, type BillingImportIssue } from '@/lib/billing/importParser'

function done(status: 'success' | 'error', message: string): never {
  const params = new URLSearchParams({ status, message })
  redirect(`/admin/billing/import?${params.toString()}`)
}

function isUuid(value: string | null): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
}

function summarizeIssues(issues: BillingImportIssue[]) {
  return issues.map((issue) => ({
    code: issue.code,
    severity: issue.severity,
    title: issue.title,
    description: issue.description,
  }))
}

export async function importBillingUnderlayFileAction(formData: FormData): Promise<void> {
  try {
    const admin = await requireAdminActionAccess({ anyOf: ['billing_underlay.write', 'billing_underlay.export'] })
    const scope = await getOperationalCompanyScope(admin.userId)
    if (!scope.companyId) throw new Error(scope.message ?? 'Bolagskoppling saknas.')
    await requireCompanyScopedActionAccess(scope.companyId, { anyOf: ['billing_underlay.write', 'billing_underlay.export'] })

    const uploaded = formData.get('billing_file')
    const pasted = String(formData.get('billing_text') ?? '').trim()
    let content = pasted
    let fileName: string | null = null

    if (uploaded && typeof uploaded === 'object' && 'text' in uploaded) {
      const file = uploaded as File
      if (file.size > 0) {
        content = await file.text()
        fileName = file.name
      }
    }

    if (!content.trim()) throw new Error('Importen saknar fil eller inklistrat underlag.')

    const parsed = parseBillingUnderlayText(content)
    if (parsed.rows.length === 0) {
      throw new Error(parsed.issues[0]?.description ?? 'Inga rader kunde läsas från importen.')
    }

    const { data: batch, error: batchError } = await supabaseService
      .from('billing_import_batches')
      .insert({
        company_id: scope.companyId,
        file_name: fileName,
        source_type: fileName ? 'file_upload' : 'manual_paste',
        status: 'previewed',
        rows_total: parsed.rows.length,
        issues: summarizeIssues(parsed.issues),
        metadata: { delimiter: parsed.delimiter },
        created_by: admin.userId,
      })
      .select('id')
      .single()

    if (batchError) throw batchError

    let imported = 0
    let failed = 0

    for (const row of parsed.rows) {
      const hasErrors = row.issues.some((issue) => issue.severity === 'error')
      let billingUnderlayId: string | null = null
      let status: 'imported' | 'failed' = hasErrors ? 'failed' : 'imported'

      if (!hasErrors && row.customerId) {
        const { data: underlay, error: underlayError } = await supabaseService
          .from('billing_underlays')
          .insert({
            company_id: scope.companyId,
            customer_id: row.customerId,
            site_id: isUuid(row.siteId) ? row.siteId : null,
            metering_point_id: isUuid(row.meteringPointId) ? row.meteringPointId : null,
            source_request_id: isUuid(row.sourceRequestId) ? row.sourceRequestId : null,
            grid_owner_id: isUuid(row.gridOwnerId) ? row.gridOwnerId : null,
            underlay_year: row.underlayYear,
            underlay_month: row.underlayMonth,
            status: row.status === 'failed' ? 'failed' : row.status,
            total_kwh: row.totalKwh,
            total_sek_ex_vat: row.totalSekExVat,
            currency: row.currency,
            source_system: row.sourceSystem,
            payload: {
              raw: row.raw,
              externalMeteringPointReference: isUuid(row.meteringPointId) ? null : row.meteringPointId,
              importBatchId: batch.id,
              importRowNumber: row.rowNumber,
            },
            failure_reason: row.status === 'failed' ? row.issues.map((issue) => issue.description).join(' · ') : null,
            readiness_status: 'not_checked',
            readiness_issues: summarizeIssues(row.issues),
            created_by: admin.userId,
            updated_by: admin.userId,
          })
          .select('id')
          .single()

        if (underlayError) {
          status = 'failed'
          row.issues.push({
            code: 'db_insert_failed',
            severity: 'error',
            title: 'Raden kunde inte importeras',
            description: underlayError.message,
          })
        } else {
          billingUnderlayId = underlay.id
        }
      }

      if (status === 'imported') imported += 1
      else failed += 1

      await supabaseService.from('billing_import_rows').insert({
        import_batch_id: batch.id,
        company_id: scope.companyId,
        row_number: row.rowNumber,
        status,
        billing_underlay_id: billingUnderlayId,
        normalized_payload: {
          customerId: row.customerId,
          siteId: row.siteId,
          meteringPointId: row.meteringPointId,
          underlayYear: row.underlayYear,
          underlayMonth: row.underlayMonth,
          totalKwh: row.totalKwh,
          totalSekExVat: row.totalSekExVat,
          sourceSystem: row.sourceSystem,
        },
        issues: summarizeIssues(row.issues),
      })
    }

    await supabaseService
      .from('billing_import_batches')
      .update({
        status: failed > 0 && imported > 0 ? 'partially_imported' : failed > 0 ? 'failed' : 'imported',
        rows_imported: imported,
        rows_failed: failed,
        imported_at: new Date().toISOString(),
      })
      .eq('id', batch.id)

    revalidatePath('/admin/billing/import')
    revalidatePath('/admin/billing')
    revalidatePath('/admin/billing/export-center')

    done('success', `Import klar: ${imported} importerade, ${failed} blockerade/felaktiga rader.`)
  } catch (error) {
    done('error', error instanceof Error ? error.message : 'Importen kunde inte genomföras.')
  }
}
