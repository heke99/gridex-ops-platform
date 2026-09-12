import type { z } from 'zod'
import { InvalidRequestBodyLimitError, readTextBodyWithLimit } from './boundedRequestBody'

export const ADMIN_JSON_LIMIT_BYTES = 256 * 1024

type InputFailure = {
  ok: false
  status: 400 | 413
  code: 'payload_too_large' | 'invalid_json' | 'invalid_json_object' | 'invalid_request'
  error: string
  field: string | null
}

/** Authenticate first; bind any explicit company before domain/provider I/O. */
export async function readAdminJson<T>(
  request: Request,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options: { allowEmpty?: boolean } = {},
): Promise<{ ok: true; data: T } | InputFailure> {
  let body: unknown
  try {
    const result = await readTextBodyWithLimit(request, ADMIN_JSON_LIMIT_BYTES)
    if (!result.ok) {
      return { ok: false, status: 413, code: 'payload_too_large', error: 'Request body är för stor.', field: null }
    }
    body = options.allowEmpty && !result.text.trim() ? {} : JSON.parse(result.text)
  } catch (error) {
    if (error instanceof InvalidRequestBodyLimitError) throw error
    return { ok: false, status: 400, code: 'invalid_json', error: 'JSON body saknas eller är ogiltig.', field: null }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, status: 400, code: 'invalid_json_object', error: 'JSON body måste vara ett objekt.', field: null }
  }
  const result = schema.safeParse(body)
  if (!result.success) {
    const issue = result.error.issues[0]
    return {
      ok: false,
      status: 400,
      code: 'invalid_request',
      error: 'Anropsfält saknas, är ogiltiga eller motsäger varandra.',
      field: typeof issue?.path[0] === 'string' ? issue.path[0] : null,
    }
  }
  return { ok: true, data: result.data }
}
