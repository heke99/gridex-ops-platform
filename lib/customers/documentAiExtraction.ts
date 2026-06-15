import { createHash } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'
import { requireCompanyOperationalForWrites } from '@/lib/tenant/governance'

export type DocumentExtractionResult = {
  extractedFields: Record<string, unknown>
  fieldConfidence: Record<string, number>
  detectedSignatures: Array<Record<string, unknown>>
  detectedAuthorizations: Array<Record<string, unknown>>
  detectedSites: Array<Record<string, unknown>>
  detectedInvoiceAddress: Record<string, unknown>
}

function matchOne(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern)
  return match?.[1]?.trim() || null
}

function confidence(value: unknown, score: number): number {
  return value ? score : 0
}

export function extractContractOrAuthorizationFields(rawText: string): DocumentExtractionResult {
  const text = rawText.replace(/\s+/g, ' ').trim()
  const personalOrOrg = matchOne(text, /(?:personnummer|org(?:anisations)?nummer|pnr|orgnr)[:\s]*([0-9\-]{6,13})/i)
  const email = matchOne(text, /([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i)
  const phone = matchOne(text, /(?:telefon|mobil)[:\s]*([+0-9][0-9\s\-]{6,18})/i)
  const facilityId = matchOne(text, /(?:anl[äa]ggnings(?:id|-id)?|anl id)[:\s]*([0-9A-Z\-]{6,32})/i)
  const meteringPointId = matchOne(text, /(?:m[äa]tpunkt(?:sid|-id)?|metering point)[:\s]*([0-9A-Z\-]{8,40})/i)
  const customerName = matchOne(text, /(?:kund|namn|avtalspart)[:\s]*([A-ZÅÄÖa-zåäö][A-ZÅÄÖa-zåäö\s\-]{2,80})/i)
  const invoiceAddress = matchOne(text, /(?:fakturaadress|faktureringsadress)[:\s]*([^\.]{8,120})/i)
  const signatureDetected = /signatur|underskrift|bankid|signerad|signed/i.test(text)
  const authorizationDetected = /fullmakt|ombud|behörig|authorization|power of attorney/i.test(text)

  return {
    extractedFields: {
      customerName,
      personalOrOrgNumber: personalOrOrg,
      email,
      phone,
      facilityId,
      meteringPointId,
    },
    fieldConfidence: {
      customerName: confidence(customerName, 0.55),
      personalOrOrgNumber: confidence(personalOrOrg, 0.78),
      email: confidence(email, 0.9),
      phone: confidence(phone, 0.72),
      facilityId: confidence(facilityId, 0.74),
      meteringPointId: confidence(meteringPointId, 0.82),
      invoiceAddress: confidence(invoiceAddress, 0.6),
    },
    detectedSignatures: signatureDetected ? [{ type: 'signature_or_bankid_marker', confidence: 0.64 }] : [],
    detectedAuthorizations: authorizationDetected ? [{ type: 'authorization_text_marker', confidence: 0.68 }] : [],
    detectedSites: facilityId || meteringPointId ? [{ facilityId, meteringPointId, confidence: 0.7 }] : [],
    detectedInvoiceAddress: invoiceAddress ? { raw: invoiceAddress, confidence: 0.6 } : {},
  }
}

export async function createDocumentAiExtraction(input: {
  companyId: string
  actorUserId: string
  customerId?: string | null
  sourceFileName?: string | null
  rawText: string
  reviewNotes?: string | null
  parserVendor?: string | null
  parserVersion?: string | null
  storagePath?: string | null
  mimeType?: string | null
  rawExtractedJson?: Record<string, unknown> | null
  normalizedRows?: Array<Record<string, unknown>> | null
  parserWarnings?: Array<Record<string, unknown>> | null
  boundingBoxes?: Record<string, unknown> | null
}) {
  await requireCompanyOperationalForWrites(input.companyId)
  const result = extractContractOrAuthorizationFields(input.rawText)
  const sourceFileSha256 = createHash('sha256').update(input.rawText).digest('hex')
  const { data, error } = await supabaseService
    .from('document_ai_extractions')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId ?? null,
      source_file_name: input.sourceFileName ?? null,
      raw_text: input.rawText,
      status: 'needs_review',
      ocr_status: 'staged',
      parser_vendor: input.parserVendor ?? 'gridex_regex_staging',
      parser_version: input.parserVersion ?? 'regex-v1',
      source_file_sha256: sourceFileSha256,
      storage_path: input.storagePath ?? null,
      mime_type: input.mimeType ?? null,
      raw_extracted_json: input.rawExtractedJson ?? { rawText: input.rawText },
      normalized_rows: input.normalizedRows ?? [],
      parser_warnings: input.parserWarnings ?? [],
      bounding_boxes: input.boundingBoxes ?? {},
      conflict_reasons: [],
      extracted_fields: result.extractedFields,
      field_confidence: result.fieldConfidence,
      detected_signatures: result.detectedSignatures,
      detected_authorizations: result.detectedAuthorizations,
      detected_sites: result.detectedSites,
      detected_invoice_address: result.detectedInvoiceAddress,
      review_notes: input.reviewNotes ?? 'Staged extraction. Masterdata ändras först efter manuell review/approve.',
      created_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as Record<string, unknown>
}

export async function reviewDocumentAiExtraction(input: {
  companyId: string
  actorUserId: string
  extractionId: string
  status: 'needs_review' | 'approved_for_manual_create' | 'rejected' | 'approved_for_apply'
  reviewNotes?: string | null
}) {
  const { data, error } = await supabaseService
    .from('document_ai_extractions')
    .update({
      status: input.status,
      review_notes: input.reviewNotes ?? null,
      reviewed_by: input.actorUserId,
      reviewed_at: new Date().toISOString(),
      approved_by: input.status === 'approved_for_apply' ? input.actorUserId : null,
      approved_at: input.status === 'approved_for_apply' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', input.companyId)
    .eq('id', input.extractionId)
    .select('*')
    .single()

  if (error) throw error
  return data as Record<string, unknown>
}
