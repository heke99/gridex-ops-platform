import sourceManifest from '@/docs/ediel/masterplan-v2/registers/source_manifest.json'
/** AI14.A.3 §2–3 pp8–10. Technical semicolon adapter; no EDIFACT envelope. */
export const AI_LIST_FORMAT_VERSION = 'Ver20140401'
export const AI_LIST_SOURCE_PROFILE = Object.freeze({sourceId:'AI',guideRevision:'14.A.3',technicalVersion:AI_LIST_FORMAT_VERSION,sourceSha256:sourceManifest.find(source=>source.id==='AI')!.sha256,validFrom:'2025-10-01',format:'CSV',supplierOutboundType:'AI'} as const)
export type AiBiTechnicalListType = 'AI' | 'BI'
export const AI_BI_DETAIL_COLUMNS = ['grid_area','metering_point_id','identity_agency','new_grid_area','new_metering_point_id','new_identity_agency','new_network_ediel_id','address','postal_code','city','balance_responsible_ediel_id','meter_number','settlement_method','annual_consumption','reporting_frequency','measurement_method','aggregate_product','customer_identity','customer_name','valid_from','valid_to'] as const
export type AiBiTechnicalHeader={listType:AiBiTechnicalListType;networkEdielId:string;networkName:string;supplierEdielId:string;supplierName:string;createdAt:string;validityDate:string|null;fromDate:string|null;toDate:string|null;version:typeof AI_LIST_FORMAT_VERSION}
export function aiListDate(value:string):string {
  const date=value.replace(/-/g,'')
  if(!/^\d{8}$/.test(date))throw new Error('ai_list_date_invalid')
  const year=Number(date.slice(0,4)),month=Number(date.slice(4,6)),day=Number(date.slice(6,8))
  const candidate=new Date(Date.UTC(year,month-1,day))
  if(year<1000||candidate.getUTCFullYear()!==year||candidate.getUTCMonth()+1!==month||candidate.getUTCDate()!==day)throw new Error('ai_list_date_invalid')
  return date
}
export function aiListCell(value:unknown):string {
  const result=String(value??'')
  // Never substitute punctuation for technical data or alter it for Excel.
  if(/[;\r\n\x00-\x1f\x7f]/.test(result))throw new Error('ai_list_cell_separator_invalid')
  return result
}
export function assertAiListOutboundType(listType:AiBiTechnicalListType):void {
  if(listType!=='AI')throw new Error('ai_bi_outbound_network_role_required')
}
export function parseAiBiTechnicalFile(raw:string,expectedType?:AiBiTechnicalListType) {
  const lines=raw.replace(/^\uFEFF/,'').split(/\r?\n/)
  if(lines.at(-1)==='')lines.pop()
  if(!lines.length||lines.some(line=>line.length===0))throw new Error('ai_list_record_empty')
  const fields=lines[0].split(';').map(aiListCell)
  if(fields.length!==10||!['AI','BI'].includes(fields[0])||(expectedType&&fields[0]!==expectedType))throw new Error('ai_list_header_invalid')
  if(fields[9]!==AI_LIST_FORMAT_VERSION)throw new Error('ai_list_version_unsupported')
  if(!/^\d{5}$/.test(fields[1])||!/^\d{5}$/.test(fields[3])||!fields[2].trim()||!fields[4].trim())throw new Error('ai_list_header_parties_required')
  if(!/^\d{12}$/.test(fields[5]))throw new Error('ai_list_creation_date_invalid')
  aiListDate(fields[5].slice(0,8))
  if(Number(fields[5].slice(8,10))>23||Number(fields[5].slice(10,12))>59)throw new Error('ai_list_creation_date_invalid')
  const listType=fields[0] as AiBiTechnicalListType
  if(listType==='AI'){
    if(fields[6]||aiListDate(fields[7])>=aiListDate(fields[8]))throw new Error('ai_list_search_period_invalid')
  }else if(fields[7]||fields[8]||!aiListDate(fields[6]))throw new Error('ai_list_validity_date_invalid')
  const header:AiBiTechnicalHeader={listType,networkEdielId:fields[1],networkName:fields[2],supplierEdielId:fields[3],supplierName:fields[4],createdAt:fields[5],validityDate:listType==='BI'?fields[6]:null,fromDate:listType==='AI'?fields[7]:null,toDate:listType==='AI'?fields[8]:null,version:AI_LIST_FORMAT_VERSION}
  const rows=lines.slice(1).map((line,index)=>{
    const columns=line.split(';').map(aiListCell)
    if(columns.length!==22||columns[21]!=='')throw new Error('ai_list_detail_cardinality_invalid')
    if(!columns[0]||!columns[1]||!['9','89'].includes(columns[2])||(columns[2]==='9'&&!/^\d{18}$/.test(columns[1])))throw new Error('ai_list_detail_object_invalid')
    if(listType==='AI'){
      if(columns.slice(3,7).some(Boolean)||!columns[10]||!columns[17]||!columns[18])throw new Error('ai_list_detail_required_fields_missing')
      for(const date of columns.slice(19,21).filter(Boolean))if(aiListDate(date)<header.fromDate!||aiListDate(date)>=header.toDate!)throw new Error('ai_list_detail_period_invalid')
      if(columns[19]&&columns[20]&&columns[19]>=columns[20])throw new Error('ai_list_detail_period_invalid')
    }else if(columns.slice(7,21).some(Boolean))throw new Error('ai_list_bi_unused_field_present')
    return {rowNumber:index+2,columns,rawColumns:Object.fromEntries(AI_BI_DETAIL_COLUMNS.map((key,position)=>[key,columns[position]]))}
  })
  return {header,rows}
}

/** Shared actual-send guard also protects stored/manual/direct drafts. The
 * platform's DDQ/DGI exporter is the supplier; file party order stays fixed. */
export function assertAiListOutboundMessage(message:{message_standard?:string|null;message_family?:string|null;raw_payload?:string|null;sender_ediel_id?:string|null;receiver_ediel_id?:string|null;file_name?:string|null;mime_type?:string|null}):void {
  if(message.message_standard!=='ai_list'&&message.message_family!=='AI_LIST'&&message.message_family!=='BI_LIST')return
  const parsed=parseAiBiTechnicalFile(message.raw_payload ?? '')
  assertAiListOutboundType(parsed.header.listType)
  if(parsed.header.supplierEdielId!==message.sender_ediel_id||parsed.header.networkEdielId!==message.receiver_ediel_id)throw new Error('ai_list_outbound_party_scope_mismatch')
  if(parsed.rows.some(row=>row.columns.slice(11,17).some(Boolean)))throw new Error('ai_list_supplier_network_fields_present')
  if(!message.file_name?.toLowerCase().endsWith('.csv')||message.mime_type!=='text/csv')throw new Error('ai_list_csv_file_type_required')
}
