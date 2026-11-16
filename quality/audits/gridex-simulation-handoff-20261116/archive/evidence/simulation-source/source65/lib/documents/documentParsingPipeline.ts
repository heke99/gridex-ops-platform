import { createHash } from 'crypto'
import { supabaseService } from '@/lib/supabase/service'
import { parseDocumentWithOpenDataLoader } from '@/lib/documents/parsers/openDataLoaderAdapter'

export type StageDocumentParseInput = {
  companyId: string
  actorUserId: string
  customerId?: string | null
  sourceFileName?: string | null
  storagePath?: string | null
  mimeType?: string | null
  rawText?: string | null
  fileBuffer?: Buffer | null
}

export async function stageDocumentParse(input: StageDocumentParseInput): Promise<Record<string, unknown>> {
  const sourceHash = input.fileBuffer
    ? createHash('sha256').update(input.fileBuffer).digest('hex')
    : input.rawText
      ? createHash('sha256').update(input.rawText).digest('hex')
      : null

  const parsed = await parseDocumentWithOpenDataLoader({
    fileBuffer: input.fileBuffer ?? null,
    rawText: input.rawText ?? null,
    fileName: input.sourceFileName ?? null,
    mimeType: input.mimeType ?? null,
  })

  const { data, error } = await supabaseService
    .from('document_ai_extractions')
    .insert({
      company_id: input.companyId,
      customer_id: input.customerId ?? null,
      source_file_name: input.sourceFileName ?? null,
      raw_text: parsed.extractedText,
      status: 'needs_review',
      review_notes: 'OCR/PDF-resultat är staged och kräver manuell granskning innan masterdata ändras.',
      parser_vendor: parsed.parserVendor,
      parser_version: parsed.parserVersion,
      ocr_status: 'staged',
      source_file_sha256: sourceHash,
      storage_path: input.storagePath ?? null,
      mime_type: input.mimeType ?? null,
      raw_extracted_json: parsed.rawExtractedJson,
      normalized_rows: parsed.normalizedRows,
      field_confidence: parsed.fieldConfidence,
      parser_warnings: parsed.parserWarnings,
      bounding_boxes: parsed.boundingBoxes,
      conflict_reasons: [],
      created_by: input.actorUserId,
    })
    .select('*')
    .single()

  if (error) throw error
  return data as Record<string, unknown>
}
