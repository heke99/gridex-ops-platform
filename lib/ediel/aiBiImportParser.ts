import {AI_BI_DETAIL_COLUMNS,parseAiBiTechnicalFile,type AiBiTechnicalHeader} from '@/lib/ediel/aiListFormat'
export type AiBiListType = 'AI' | 'BI'
export type AiBiParsedRow={rowNumber:number;rawColumns:Record<string,string>;meteringPointExternalId:string|null;customerIdentity:string|null;customerName:string|null;gridAreaCode:string|null;gridOwnerEdielId:string|null}
export type AiBiParseResult={listType:AiBiListType;delimiter:';';headers:string[];header:AiBiTechnicalHeader;rows:AiBiParsedRow[]}
/** Read-only naming projection for native source-owned physical import rows.
 * The shared adapter alone owns the positional names; this is never a write or
 * rule-decision authority. Historic named projections remain readable. */
export function projectAiBiStoredRawColumns(value:unknown):Record<string,string>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('ai_bi_stored_columns_invalid')
  const record=value as Record<string,unknown>
  if(record.physical_columns!==undefined){
    if(!Array.isArray(record.physical_columns)||record.physical_columns.length!==AI_BI_DETAIL_COLUMNS.length||record.physical_columns.some(cell=>typeof cell!=='string'))throw new Error('ai_bi_stored_columns_invalid')
    const columns=record.physical_columns as string[]
    return Object.fromEntries(AI_BI_DETAIL_COLUMNS.map((key,index)=>[key,columns[index]]))
  }
  return Object.fromEntries(Object.entries(record).filter((item):item is [string,string]=>typeof item[1]==='string'))
}
function normaliseAiBiGridAreaCode(value:unknown):string|null{return typeof value==='string'&&value.trim()?value.trim().replace(/\s+/g,'').toUpperCase():null}
export function parseAiBiListCsv(input:{raw:string;listType:AiBiListType}):AiBiParseResult{
  const parsed=parseAiBiTechnicalFile(input.raw,input.listType)
  return {listType:input.listType,delimiter:';',headers:[...AI_BI_DETAIL_COLUMNS],header:parsed.header,
    rows:parsed.rows.map(row=>({rowNumber:row.rowNumber,rawColumns:row.rawColumns,meteringPointExternalId:row.columns[1]||null,
      customerIdentity:row.columns[17]||null,customerName:row.columns[18]||null,gridAreaCode:row.columns[0]||null,gridOwnerEdielId:parsed.header.networkEdielId}))}
}

export function discrepancyReasonsForAiBiRow(input: {
  row: AiBiParsedRow
  matchedMeteringPoint: Record<string, unknown> | null
}): string[] {
  const reasons: string[] = []

  if (!input.row.meteringPointExternalId) {
    reasons.push('missing_metering_point_id')
  }

  if (!input.matchedMeteringPoint && input.row.meteringPointExternalId) {
    reasons.push('metering_point_not_found')
  }

  const matchedGridAreaCode = normaliseAiBiGridAreaCode(
    input.matchedMeteringPoint?.grid_area_code,
  )
  const rowGridAreaCode = normaliseAiBiGridAreaCode(input.row.gridAreaCode)
  if (
    input.matchedMeteringPoint &&
    rowGridAreaCode &&
    matchedGridAreaCode &&
    matchedGridAreaCode !== rowGridAreaCode
  ) {
    reasons.push('grid_area_mismatch')
  }

  if (
    input.matchedMeteringPoint &&
    input.row.gridOwnerEdielId &&
    typeof input.matchedMeteringPoint.grid_owner_ediel_id === 'string' &&
    input.matchedMeteringPoint.grid_owner_ediel_id.trim() !== '' &&
    input.matchedMeteringPoint.grid_owner_ediel_id !== input.row.gridOwnerEdielId
  ) {
    reasons.push('grid_owner_mismatch')
  }

  return reasons
}
