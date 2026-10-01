import {parseAiBiTechnicalFile} from '@/lib/ediel/aiListFormat'
import {requireAiBiPersonalDataStorage} from '@/lib/ediel/aiBiPersonalDataStorage'
import {importAiBiListCsv} from '@/lib/ediel/aiBiImportEngine'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {createHash} from 'node:crypto'

/** Call before persisting any personal AI/BI source, including manual/batch
 * and IMAP paths. No EDIFACT acknowledgement or market effect is produced. */
export async function prepareAiBiInboundReconciliation(input:{companyId:string;actorUserId:string;environment:'test'|'production';rawPayload:string;listType?:'AI'|'BI'}){
 const technical=parseAiBiTechnicalFile(input.rawPayload,input.listType)
 const storage=await requireAiBiPersonalDataStorage({companyId:input.companyId,actorUserId:input.actorUserId,environment:input.environment,candidates:[input.rawPayload]})
 if(!storage||storage.listType!==technical.header.listType||storage.canonicalPayload!==input.rawPayload)throw new Error('ai_bi_personal_storage_scope_invalid')
 return {listType:technical.header.listType,processingDecision:storage.processingDecision}
}

/** Consumer of a sealed actually received source, not caller-normalized rows.
 * The processing decision and current actor are rechecked before import writes. */
export async function processAiBiInboundReconciliation(input:{actorUserId:string;message:EdielMessageRow & {immutable_rendered_at?:string|null;immutable_payload_hash?:string|null}}){
 const m=input.message
 if(!m.company_id||m.direction!=='inbound'||m.message_standard!=='ai_list'||m.message_family!=='AI_LIST'||!m.raw_payload
  ||!m.immutable_rendered_at||m.immutable_payload_hash!==createHash('sha256').update(m.raw_payload,'utf8').digest('hex'))throw new Error('ai_bi_reconciliation_sealed_source_required')
 const technical=parseAiBiTechnicalFile(m.raw_payload)
 if(m.message_code!==technical.header.listType)throw new Error('ai_bi_reconciliation_source_type_mismatch')
 return importAiBiListCsv({companyId:m.company_id,actorUserId:input.actorUserId,listType:technical.header.listType,rawCsv:m.raw_payload,
  filename:m.file_name,gridOwnerId:m.grid_owner_id,sourceMessageId:m.id})
}
