import { supabaseService } from '@/lib/supabase/service'
import type { EdielProjectionPage, EdielProjectionRequest } from './types'

/** One source series, several scoped reads. No copying owner rows, raw bytes or upstream ACK. */
export async function projectEdielSeriesToBeneficiary(input: EdielProjectionRequest): Promise<EdielProjectionPage> {
  if (!Number.isInteger(input.expectedGrantVersion) || input.expectedGrantVersion < 1) throw new Error('ediel_grant_version_required')
  const { data, error } = await supabaseService.rpc('ediel_beneficiary_series_page_v1', {
    p_beneficiary_company_id: input.beneficiaryCompanyId, p_actor_user_id: input.actorUserId,
    p_grant_id: input.grantId, p_expected_grant_version: input.expectedGrantVersion,
    p_purpose: input.purpose, p_series_id: input.seriesId, p_fields: [...input.fields],
    p_start: input.startInclusive, p_end: input.endExclusive, p_limit: input.limit ?? 100,
    p_after_at: input.after?.readingAt ?? null, p_after_id: input.after?.valueId ?? null,
  })
  if (error) throw error
  if (!data || !Array.isArray(data.rows)) throw new Error('ediel_beneficiary_projection_invalid')
  const page = data as EdielProjectionPage
  const origin = page.provenance
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const hash = /^[0-9a-f]{64}$/
  const sameFields = Array.isArray(origin?.fields) && origin.fields.length === input.fields.length &&
    new Set(origin.fields).size === origin.fields.length && origin.fields.every(field => input.fields.includes(field))
  const quality = origin?.qualityOrigin
  if (page.grantId !== input.grantId || page.grantVersion !== input.expectedGrantVersion || page.seriesId !== input.seriesId ||
      !uuid.test(page.consumerReceiptId ?? '') || origin?.version !== 1 || !uuid.test(origin.sourceMessageId) ||
      !hash.test(origin.sourceRawHash) || !hash.test(origin.contractHash) || !uuid.test(origin.receiverActorId) ||
      origin.sourceFamily !== 'UTILTS' || origin.sourceCode !== 'E66' || !['test','production'].includes(origin.sourceEnvironment) ||
      !['DDQ','DGI'].includes(origin.sourceRole) || origin.sourceApplicationReference?.split('-')[1] !== origin.sourceRole ||
      !/^\d{5}$/.test(origin.sourceSenderEdielId) || origin.receiverRole !== 'energy_service_company' ||
      !Number.isInteger(origin.contractVersion) || origin.contractVersion < 1 || origin.purpose !== input.purpose || !sameFields ||
      (input.fields.includes('quality')
        ? quality?.sourceMessageId !== origin.sourceMessageId || quality?.seriesId !== input.seriesId || quality?.column !== 'meter_reading_values.quality'
        : quality !== null) ||
      page.rows.some(row => !row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).some(key => !input.fields.includes(key as typeof input.fields[number])))) {
    throw new Error('ediel_beneficiary_provenance_invalid')
  }
  // Copy the explicit public projection only. Private/raw attributes supplied
  // by a malformed RPC adapter must never leak into a downstream use.
  return {
    grantId:page.grantId,grantVersion:page.grantVersion,seriesId:page.seriesId,rows:page.rows,
    next:page.next ? {readingAt:page.next.readingAt,valueId:page.next.valueId} : null,
    consumerReceiptId:page.consumerReceiptId,
    provenance:{version:1,sourceMessageId:origin.sourceMessageId,sourceRawHash:origin.sourceRawHash,
      sourceFamily:origin.sourceFamily,sourceCode:origin.sourceCode,sourceEnvironment:origin.sourceEnvironment,
      sourceRole:origin.sourceRole,sourceApplicationReference:origin.sourceApplicationReference,sourceSenderEdielId:origin.sourceSenderEdielId,
      receiverActorId:origin.receiverActorId,receiverRole:origin.receiverRole,contractVersion:origin.contractVersion,contractHash:origin.contractHash,
      purpose:origin.purpose,fields:[...origin.fields],qualityOrigin:quality ? {sourceMessageId:quality.sourceMessageId,seriesId:quality.seriesId,column:quality.column} : null},
  }
}
