'use server'

import { createHash } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect, unstable_rethrow } from 'next/navigation'
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

    // Batch, underlays and row log are written in one transaction; the same content imports once.
    const contentSha256 = createHash('sha256').update(content).digest('hex')
    const rows = parsed.rows.map((row) => {
      const hasErrors = row.issues.some((issue) => issue.severity === 'error')
      return {
        row_number: row.rowNumber,
        has_errors: hasErrors,
        issues: summarizeIssues(row.issues),
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
        underlay: hasErrors || !row.customerId ? null : {
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
            importRowNumber: row.rowNumber,
          },
          failure_reason: row.status === 'failed' ? row.issues.map((issue) => issue.description).join(' · ') : null,
          readiness_status: 'not_checked',
          readiness_issues: summarizeIssues(row.issues),
        },
      }
    })

    const { data, error } = await supabaseService.rpc('gridex_import_billing_underlays_v1', {
      p_company_id: scope.companyId,
      p_actor_user_id: admin.userId,
      p_batch: {
        file_name: fileName,
        source_type: fileName ? 'file_upload' : 'manual_paste',
        issues: summarizeIssues(parsed.issues),
        metadata: { delimiter: parsed.delimiter },
        content_sha256: contentSha256,
      },
      p_rows: rows,
    })
    if (error) throw error
    const result = (data ?? {}) as { duplicate?: boolean; imported?: number; failed?: number }
    if (result.duplicate) {
      done('error', 'Den här filen är redan importerad. Inga nya underlag skapades.')
    }
    const imported = Number(result.imported ?? 0)
    const failed = Number(result.failed ?? 0)

    revalidatePath('/admin/billing/import')
    revalidatePath('/admin/billing')
    revalidatePath('/admin/billing/export-center')

    done('success', `Import klar: ${imported} importerade, ${failed} blockerade/felaktiga rader.`)
  } catch (error) {
    unstable_rethrow(error)
    done('error', error instanceof Error ? error.message : 'Importen kunde inte genomföras.')
  }
}
