import 'server-only'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { publicReference } from '@/lib/integrations/publicReferences'
import { decodePortalCursor, encodePortalCursor } from '@/lib/customer-portal/keysetPagination'
import { SupportCommandError } from '@/lib/customer-operations/supportCommand'
import { supportActorContext, type SupportReadContext, type SupportPage } from './customerRead'

export const SUPPORT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024
const BUCKET = 'customer-support-quarantine'
const actorSchema = z.union([
  z.object({ kind: z.enum(['ops', 'portal']), userId: z.string().uuid(), sessionId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('api'), clientId: z.string().uuid(), subject: z.string().min(1).max(255) }).strict(),
])
const contextSchema = z.object({ companyId: z.string().uuid(), customerId: z.string().uuid(), actor: actorSchema }).strict()
const inputSchema = z.object({ context: contextSchema, caseId: z.string().uuid().optional(),
  caseReference: z.string().regex(/^case_[A-Za-z0-9_-]{32}$/).optional(),
  expectedRevision: z.number().int().nonnegative().safe(), idempotencyKey: z.string().regex(/^[A-Za-z0-9._:+~-]{8,200}$/),
  visibility: z.enum(['customer', 'internal']).optional(), file: z.instanceof(File),
}).strict()
const mediaSchema = z.enum(['application/pdf', 'image/png', 'image/jpeg', 'text/plain'])
const reservationSchema = z.object({ companyId: z.string().uuid(), customerId: z.string().uuid(), caseId: z.string().uuid(),
  attachmentId: z.string().uuid(), objectKey: z.string(), phase: z.enum(['reserved', 'stored']),
  revision: z.number().int().nonnegative().safe(), scanStatus: z.literal('quarantined'), replayed: z.boolean(),
}).strict()
const attachmentRowSchema = z.object({ id: z.string().uuid(), file_name: z.string().min(1).max(180),
  media_type: mediaSchema, byte_size: z.number().int().positive().max(SUPPORT_ATTACHMENT_MAX_BYTES),
  scan_status: z.literal('quarantined'), created_at: z.string(), visibility: z.enum(['customer', 'internal']),
}).strict()
export type SupportAttachmentItem = Omit<z.infer<typeof attachmentRowSchema>, 'id' | 'visibility'> & { attachment_reference: string }
export type SupportAttachmentResult = { attachment_reference: string; revision: number; scan_status: 'quarantined'; replayed: boolean }

function attachmentError(error: { message?: string; code?: string }): never {
  if (['support_actor_forbidden', 'support_session_revoked'].includes(error.message ?? '')) throw new SupportCommandError('support_actor_forbidden', 403)
  if (['support_revision_conflict', 'support_idempotency_conflict', 'support_case_closed'].includes(error.message ?? '')) throw new SupportCommandError(error.message!, 409)
  if (error.message === 'support_resource_unavailable') throw new SupportCommandError('resource_not_found', 404)
  if (error.message === 'invalid_support_attachment') throw new SupportCommandError(error.message, 422)
  throw new SupportCommandError('support_attachment_unavailable', 503)
}
function digest(bytes: Uint8Array) { return createHash('sha256').update(bytes).digest('hex') }
function validBytes(bytes: Uint8Array, mediaType: z.infer<typeof mediaSchema>): boolean {
  if (mediaType === 'application/pdf') return Buffer.from(bytes.subarray(0, 5)).toString('ascii') === '%PDF-'
  if (mediaType === 'image/png') return Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  if (mediaType === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  try { return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
  catch { return false }
}
function checkResult(data: unknown, input: z.infer<typeof inputSchema>) {
  const result = reservationSchema.safeParse(data)
  if (!result.success || result.data.companyId !== input.context.companyId || result.data.customerId !== input.context.customerId ||
      (input.caseId && result.data.caseId !== input.caseId) ||
      (input.caseReference && publicReference('case', input.context.companyId, result.data.caseId) !== input.caseReference) ||
      result.data.objectKey !== `${input.context.companyId}/${input.context.customerId}/${result.data.caseId}/${result.data.attachmentId}` ||
      result.data.revision !== input.expectedRevision + (result.data.phase === 'stored' ? 1 : 0) ||
      (result.data.replayed && result.data.phase !== 'stored')) throw new SupportCommandError('support_attachment_unavailable', 503)
  return result.data
}
function publicResult(result: z.infer<typeof reservationSchema>): SupportAttachmentResult {
  return { attachment_reference: publicReference('case_attachment', result.companyId, result.attachmentId)!,
    revision: result.revision, scan_status: result.scanStatus, replayed: result.replayed }
}

/** The scanner is not configured. Uploads always remain private and quarantined.
 * Reservation preserves the payload/key across a lost Storage or commit response.
 * The commit rechecks current authority and creates the scan intent atomically. */
export async function intakeSupportAttachment(candidate: z.infer<typeof inputSchema>): Promise<SupportAttachmentResult> {
  const parsed = inputSchema.safeParse(candidate)
  if (!parsed.success) throw new SupportCommandError('invalid_support_attachment', 422)
  const input = parsed.data
  if (Boolean(input.caseId) === Boolean(input.caseReference) ||
      (input.context.actor.kind !== 'ops' && (input.caseId || input.visibility === 'internal'))) throw new SupportCommandError('invalid_support_attachment', 422)
  const mediaType = mediaSchema.safeParse(input.file.type)
  const fileName = input.file.name.normalize('NFC').trim()
  if (!mediaType.success || !fileName || fileName.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(fileName) || !input.file.size) throw new SupportCommandError('invalid_support_attachment', 422)
  if (input.file.size > SUPPORT_ATTACHMENT_MAX_BYTES) throw new SupportCommandError('support_attachment_too_large', 413)
  const bytes = new Uint8Array(await input.file.arrayBuffer())
  if (bytes.byteLength !== input.file.size || !validBytes(bytes, mediaType.data)) throw new SupportCommandError('invalid_support_attachment', 422)
  const sha256 = digest(bytes)
  const p_intake = { stage: 'reserve', caseId: input.caseId ?? null, caseReference: input.caseReference ?? null,
    expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey,
    visibility: input.visibility ?? (input.context.actor.kind === 'ops' ? 'internal' : 'customer'),
    fileName, mediaType: mediaType.data, byteSize: bytes.byteLength, sha256 }
  const p_context = supportActorContext(input.context)
  const reserved = await supabaseService.rpc('gridex_support_attachment_intake_v1', { p_context, p_intake })
  if (reserved.error) attachmentError(reserved.error)
  const reservation = checkResult(reserved.data, input)
  if (reservation.phase === 'stored') return publicResult(reservation)
  const storage = supabaseService.storage.from(BUCKET)
  const uploaded = await storage.upload(reservation.objectKey, bytes, { contentType: mediaType.data, upsert: false })
  if (uploaded.error) {
    if (String((uploaded.error as { statusCode?: string }).statusCode) !== '409') throw new SupportCommandError('support_attachment_unavailable', 503)
    // An earlier attempt may have stored these bytes before losing its response.
    // Never overwrite an existing object or trust its client-supplied metadata.
    const prior = await storage.download(reservation.objectKey)
    if (prior.error || !prior.data || prior.data.size !== bytes.byteLength ||
        digest(new Uint8Array(await prior.data.arrayBuffer())) !== sha256) throw new SupportCommandError('support_attachment_unavailable', 503)
  }
  const committed = await supabaseService.rpc('gridex_support_attachment_intake_v1', { p_context, p_intake: { ...p_intake, stage: 'commit' } })
  if (committed.error) attachmentError(committed.error)
  const result = checkResult(committed.data, input)
  if (result.phase !== 'stored' || result.attachmentId !== reservation.attachmentId || result.objectKey !== reservation.objectKey) throw new SupportCommandError('support_attachment_unavailable', 503)
  return publicResult(result)
}

export async function readSupportAttachments(context: SupportReadContext, input: { reference?: string; caseId?: string; limit?: number | null; cursor?: string | null }) {
  if (!contextSchema.safeParse(context).success || Boolean(input.reference) === Boolean(input.caseId) ||
      (input.reference && !/^case_[A-Za-z0-9_-]{32}$/.test(input.reference)) ||
      (input.caseId && (context.actor.kind !== 'ops' || !z.string().uuid().safeParse(input.caseId).success))) throw new SupportCommandError('invalid_support_attachment', 422)
  const limit = input.limit ?? 25
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new SupportCommandError('invalid_support_attachment', 422)
  const resource = `support_attachments:${input.reference ?? input.caseId}`
  const before = decodePortalCursor({ ...context, resource, cursor: input.cursor })
  const response = await supabaseService.rpc('gridex_support_attachment_read_v1', { p_context: supportActorContext(context),
    p_query: { ...(input.reference ? { reference: input.reference } : { caseId: input.caseId }), limit: limit + 1,
      ...(before ? { before: before.orderValue, beforeId: before.id } : {}) } })
  if (response.error) attachmentError(response.error)
  const parsed = z.object({ items: z.array(attachmentRowSchema) }).strict().safeParse(response.data)
  if (!parsed.success || (context.actor.kind !== 'ops' && parsed.data.items.some(row => row.visibility !== 'customer'))) throw new SupportCommandError('support_attachment_unavailable', 503)
  const rows = parsed.data.items.slice(0, limit), hasMore = parsed.data.items.length > limit, last = rows.at(-1)
  const items: SupportAttachmentItem[] = rows.map(row => ({ attachment_reference: publicReference('case_attachment', context.companyId, row.id)!,
    file_name: row.file_name, media_type: row.media_type, byte_size: row.byte_size, scan_status: row.scan_status, created_at: row.created_at }))
  const page: SupportPage = { limit, returned: items.length, has_more: hasMore, next_cursor: hasMore && last
    ? encodePortalCursor({ ...context, resource, tuple: { orderValue: last.created_at, id: last.id } }) : null }
  return { items, page }
}

/** Bound the complete multipart request before the parser allocates its parts. */
export async function readSupportAttachmentForm(request: Request): Promise<{ file: File; expectedRevision: number }> {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;') || !request.body) throw new SupportCommandError('invalid_support_attachment', 422)
  const maxRequest = SUPPORT_ATTACHMENT_MAX_BYTES + 128 * 1024
  const declaredSize = request.headers.get('content-length')
  if (declaredSize && Number(declaredSize) > maxRequest) throw new SupportCommandError('support_attachment_too_large', 413)
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > maxRequest) { await reader.cancel(); throw new SupportCommandError('support_attachment_too_large', 413) }
      chunks.push(chunk.value)
    }
    const body = Buffer.concat(chunks)
    const form = await new Request('http://localhost/attachment', { method: 'POST', headers: { 'content-type': request.headers.get('content-type')! }, body }).formData()
    if ([...form.keys()].some(key => !['file', 'expected_revision'].includes(key)) || form.getAll('file').length !== 1 || form.getAll('expected_revision').length !== 1) throw new SupportCommandError('invalid_support_attachment', 422)
    const file = form.get('file'), rawRevision = form.get('expected_revision')
    if (!(file instanceof File) || typeof rawRevision !== 'string' || !/^(0|[1-9]\d*)$/.test(rawRevision) || !Number.isSafeInteger(Number(rawRevision))) throw new SupportCommandError('invalid_support_attachment', 422)
    return { file, expectedRevision: Number(rawRevision) }
  } catch (error) {
    if (error instanceof SupportCommandError) throw error
    throw new SupportCommandError('invalid_support_attachment', 422)
  } finally { reader.releaseLock() }
}
