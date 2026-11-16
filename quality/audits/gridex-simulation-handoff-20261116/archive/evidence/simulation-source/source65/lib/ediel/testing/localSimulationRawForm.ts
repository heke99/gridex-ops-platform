/** Exact UTF8 bytes for opt-in LOCAL forms; no newline or whitespace normalization. */
export const MAX_LOCAL_RAW_FORM_BYTES = 2 * 1024 * 1024

export function preserveLocalSimulationRawForm(form: FormData): void {
  const values = form.getAll('rawEdifact')
  if (values.length !== 1 || typeof values[0] !== 'string') return
  // A binary multipart part preserves LF/CRLF; a text part normalizes line endings.
  form.set('rawEdifact', new Blob([new TextEncoder().encode(values[0])], {
    type: 'application/octet-stream',
  }), 'local-source.edifact')
}

export async function readLocalSimulationRawForm(form: FormData): Promise<string> {
  const values = form.getAll('rawEdifact')
  if (values.length !== 1 || typeof values[0] === 'string') {
    throw new Error('Ett entydigt EDIFACT-original krävs.')
  }
  const file = values[0]
  if (file.size > MAX_LOCAL_RAW_FORM_BYTES) throw new Error('EDIFACT-originalet får vara högst 2 MB.')
  const bytes = await file.arrayBuffer()
  if (bytes.byteLength > MAX_LOCAL_RAW_FORM_BYTES) throw new Error('EDIFACT-originalet får vara högst 2 MB.')
  try {
    // Preserve a BOM as U+FEFF so UTF8 re-encoding hashes the original bytes.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw new Error('EDIFACT-originalet måste vara giltig UTF-8.')
  }
}
