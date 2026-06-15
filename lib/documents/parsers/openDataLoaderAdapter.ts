export type OpenDataLoaderParseInput = {
  fileBuffer?: Buffer | null
  rawText?: string | null
  fileName?: string | null
  mimeType?: string | null
}

export type OpenDataLoaderParseResult = {
  parserVendor: string
  parserVersion: string
  rawExtractedJson: Record<string, unknown>
  normalizedRows: Array<Record<string, unknown>>
  fieldConfidence: Record<string, number>
  parserWarnings: Array<Record<string, unknown>>
  boundingBoxes: Record<string, unknown>
  extractedText: string
}

export async function parseDocumentWithOpenDataLoader(input: OpenDataLoaderParseInput): Promise<OpenDataLoaderParseResult> {
  // Safe adapter boundary. OpenDataLoader can be wired behind this function when
  // its runtime/API is configured. Until then we keep all OCR data staged and
  // never write parser output directly into customer master data.
  const text = input.rawText ?? ''
  return {
    parserVendor: 'opendataloader_adapter',
    parserVersion: process.env.OPENDATALOADER_VERSION ?? 'adapter-v1',
    rawExtractedJson: {
      fileName: input.fileName ?? null,
      mimeType: input.mimeType ?? null,
      text,
      providerConfigured: Boolean(process.env.OPENDATALOADER_API_URL),
    },
    normalizedRows: text ? [{ type: 'text', value: text, confidence: 0.5 }] : [],
    fieldConfidence: {},
    parserWarnings: process.env.OPENDATALOADER_API_URL
      ? []
      : [{ code: 'opendataloader_not_configured', severity: 'info' }],
    boundingBoxes: {},
    extractedText: text,
  }
}
