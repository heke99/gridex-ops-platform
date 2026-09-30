'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { requireAdminActionAccess, requireCompanyScopedActionAccess } from '@/lib/admin/guards'
import { getOperationalCompanyScope } from '@/lib/tenant/scope'
import { supabaseService } from '@/lib/supabase/service'
import { parseBillingUnderlayText, type BillingImportIssue } from '@/lib/billing/importParser'
import { safeLogError } from '@/lib/logging/redaction'

type ImportNotice = { status: 'success' | 'partial' | 'error'; message: string }

function done(status: ImportNotice['status'], message: string): never {
  const params = new URLSearchParams({ status, message })
  redirect(`/admin/billing/import?${params.toString()}`)
}

class ImportValidationError extends Error {}

function safeImportError(error: unknown, companyId: string | null): string {
  const reference = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()
  const safe = safeLogError(error)
  console.error('[billing-import-error]', { reference, companyId, ...safe })
  const message = error instanceof ImportValidationError ? error.message
    : /Forbidden|Unauthorized|saknar.*behörighet/i.test(safe.message)
      ? 'Du saknar behörighet att importera faktureringsunderlag.'
      : 'Importen kunde inte slutföras. Kontrollera senaste importen innan du försöker igen.'
  return `${message} Referens: ${reference}.`
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
  let companyId: string | null = null
  let persistedUnderlays = 0
  let notice: ImportNotice
  try {
    const admin = await requireAdminActionAccess({ anyOf: ['billing_underlay.write', 'billing_underlay.export'] })
    const scope = await getOperationalCompanyScope(admin.userId)
    if (!scope.companyId) throw new ImportValidationError('Välj ett aktivt bolag före import.')
    companyId = scope.companyId
    if (!admin.isPlatformAdmin && admin.companyId !== scope.companyId) {
      throw new ImportValidationError('Bolagsvalet ändrades. Läs om sidan innan du importerar.')
    }
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

    if (!content.trim()) throw new ImportValidationError('Importen saknar fil eller inklistrat underlag.')

    const parsed = parseBillingUnderlayText(content)
    if (parsed.rows.length === 0) {
      throw new ImportValidationError(parsed.issues[0]?.description ?? 'Inga rader kunde läsas från importen.')
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
    if (!batch?.id) throw new Error('billing_import_batch_not_confirmed')

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

        if (underlayError || !underlay?.id) {
          status = 'failed'
          row.issues.push({
            code: 'db_insert_failed',
            severity: 'error',
            title: 'Raden kunde inte importeras',
            description: safeImportError(underlayError ?? new Error('billing_import_underlay_not_confirmed'), companyId),
          })
        } else {
          billingUnderlayId = underlay.id
          persistedUnderlays += 1
        }
      }

      const rowResult = await supabaseService.from('billing_import_rows').insert({
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
      }).select('id').single()
      if (rowResult.error) throw rowResult.error
      if (!rowResult.data?.id) throw new Error('billing_import_row_not_confirmed')
      if (status === 'imported') imported += 1
      else failed += 1
    }

    const batchStatus = failed > 0 && imported > 0 ? 'partially_imported' : failed > 0 ? 'failed' : 'imported'
    const batchResult = await supabaseService
      .from('billing_import_batches')
      .update({
        status: batchStatus,
        rows_imported: imported,
        rows_failed: failed,
        imported_at: new Date().toISOString(),
      })
      .eq('id', batch.id)
      .eq('company_id', scope.companyId)
      .select('id,status,rows_imported,rows_failed')
      .single()
    if (batchResult.error) throw batchResult.error
    if (batchResult.data?.id !== batch.id || batchResult.data.status !== batchStatus
      || batchResult.data.rows_imported !== imported || batchResult.data.rows_failed !== failed) {
      throw new Error('billing_import_final_counts_not_confirmed')
    }
    notice = {
      status: batchStatus === 'partially_imported' ? 'partial' : batchStatus === 'failed' ? 'error' : 'success',
      message: `${batchStatus === 'partially_imported' ? 'Import delvis klar' : batchStatus === 'failed' ? 'Importen är blockerad' : 'Import klar'}: ${imported} importerade, ${failed} blockerade/felaktiga rader.`,
    }
  } catch (error) {
    notice = { status: 'error', message: safeImportError(error, companyId)
      + (persistedUnderlays > 0 ? ` ${persistedUnderlays} underlag har redan sparats; importens slutresultat kunde inte bekräftas.` : '') }
  }
  try {
    revalidatePath('/admin/billing/import')
    revalidatePath('/admin/billing')
    revalidatePath('/admin/billing/export-center')
  } catch (error) {
    safeImportError(error, companyId)
    notice.message += ' Läs om sidan för att se det sparade importläget.'
  }
  // Next's redirect is control flow: it must not be caught as an import error.
  done(notice.status, notice.message)
}
