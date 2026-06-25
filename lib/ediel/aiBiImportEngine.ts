import { supabaseService } from '@/lib/supabase/service'
import {
  discrepancyReasonsForAiBiRow,
  parseAiBiListCsv,
  type AiBiListType,
  type AiBiParsedRow,
} from '@/lib/ediel/aiBiImportParser'
import { defaultRetentionUntil } from '@/lib/ediel/aiBiReconciliation'

type MatchedMeteringPoint = {
  id: string
  customer_id: string | null
  site_id: string | null
  customer_site_id?: string | null
  metering_point_id?: string | null
  meter_point_id?: string | null
  ediel_reference?: string | null
  grid_area_code?: string | null
  grid_owner_ediel_id?: string | null
}

async function findMeteringPoint(companyId: string, row: AiBiParsedRow): Promise<MatchedMeteringPoint | null> {
  const externalId = row.meteringPointExternalId
  if (!externalId) return null
  const columns = ['metering_point_id', 'meter_point_id', 'ediel_reference', 'site_facility_id'] as const
  const matches: MatchedMeteringPoint[] = []

  for (const column of columns) {
    const { data, error } = await supabaseService
      .from('metering_points')
      .select('id, customer_id, site_id, customer_site_id, metering_point_id, meter_point_id, ediel_reference, grid_area_code, grid_owner_ediel_id')
      .eq('company_id', companyId)
      .eq(column, externalId)
      .limit(2)

    if (error) throw error
    for (const candidate of (data ?? []) as MatchedMeteringPoint[]) {
      if (!matches.some((match) => match.id === candidate.id)) matches.push(candidate)
    }
    if (matches.length > 1) return null
  }

  return matches.length === 1 ? matches[0] : null
}

export async function importAiBiListCsv(input: {
  companyId: string
  listType: AiBiListType
  rawCsv: string
  filename?: string | null
  gridOwnerId?: string | null
  actorUserId?: string | null
}): Promise<{ importId: string; rowCount: number; discrepancyCount: number }> {
  const parsed = parseAiBiListCsv({ raw: input.rawCsv, listType: input.listType })

  const { data: importRow, error: importError } = await supabaseService
    .from('ai_list_imports')
    .insert({
      company_id: input.companyId,
      list_type: input.listType,
      filename: input.filename ?? null,
      grid_owner_id: input.gridOwnerId ?? null,
      status: 'parsed',
      row_count: parsed.rows.length,
      raw_payload: input.rawCsv,
      retention_until: defaultRetentionUntil(),
      gdpr_basis: 'legitimate_interest_metering_reconciliation',
      metadata: {
        delimiter: parsed.delimiter,
        headers: parsed.headers,
        parser: 'gridcore_ai_bi_import_v1',
        reconciliationOnly: true,
        masterdataAutoOverwrite: false,
        retentionDays: 365,
      },
      created_by: input.actorUserId ?? null,
    })
    .select('id')
    .single()

  if (importError) throw importError
  const importId = (importRow as { id: string }).id
  let discrepancyCount = 0

  for (const row of parsed.rows) {
    const matched = await findMeteringPoint(input.companyId, row)
    const reasons = discrepancyReasonsForAiBiRow({ row, matchedMeteringPoint: matched })
    const matchStatus = reasons.length === 0 && matched ? 'matched' : matched ? 'discrepancy' : 'unmatched'

    const { data: rowRecord, error: rowError } = await supabaseService
      .from('ai_list_import_rows')
      .insert({
        company_id: input.companyId,
        import_id: importId,
        row_number: row.rowNumber,
        raw_columns: row.rawColumns,
        metering_point_external_id: row.meteringPointExternalId,
        matched_metering_point_id: matched?.id ?? null,
        matched_customer_id: matched?.customer_id ?? null,
        matched_customer_site_id: matched?.customer_site_id ?? matched?.site_id ?? null,
        match_status: matchStatus,
        discrepancy_reasons: reasons,
      })
      .select('id')
      .single()

    if (rowError) throw rowError
    if (reasons.length === 0) continue

    discrepancyCount += 1
    const importRowId = (rowRecord as { id: string }).id
    const { error: discrepancyError } = await supabaseService
      .from('ai_list_discrepancies')
      .insert({
        company_id: input.companyId,
        import_id: importId,
        import_row_id: importRowId,
        discrepancy_type: reasons[0],
        severity: reasons.includes('metering_point_not_found') || reasons.includes('missing_metering_point_id') ? 'warning' : 'info',
        current_values: matched ?? {},
        imported_values: row.rawColumns,
        status: 'open',
      })

    if (discrepancyError) throw discrepancyError
  }

  const { error: updateError } = await supabaseService
    .from('ai_list_imports')
    .update({
      status: discrepancyCount > 0 ? 'review_required' : 'matched',
      discrepancy_count: discrepancyCount,
    })
    .eq('id', importId)

  if (updateError) throw updateError
  return { importId, rowCount: parsed.rows.length, discrepancyCount }
}
