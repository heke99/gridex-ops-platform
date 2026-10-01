import 'server-only'
import { z } from 'zod'
import { supabaseService } from '@/lib/supabase/service'
import { decodePortalCursor, encodePortalCursor } from '@/lib/customer-portal/keysetPagination'
import { publicReference } from '@/lib/integrations/publicReferences'
import { SupportCommandError, type SupportActor } from '@/lib/customer-operations/supportCommand'
import { publicSupportStaffReference } from './supportStaffAttribution'

const caseSchema = z.object({ id: z.string().uuid(), case_reference: z.string().regex(/^case_[A-Za-z0-9_-]{32}$/), title: z.string().min(1).max(180), status: z.enum(['open', 'waiting_for_customer', 'resolved', 'closed']), revision: z.number().int().nonnegative().safe(), created_at: z.string(), updated_at: z.string() }).strict()
const messageSchema = z.object({ id: z.string().uuid(), body: z.string().min(1).max(8000), author_kind: z.enum(['customer', 'staff']), actor_user_id: z.string().uuid().nullable().optional(), channel: z.enum(['ops', 'phone', 'portal', 'api']), revision: z.number().int().positive().safe(), created_at: z.string() }).strict()
export type CustomerSupportCase = Omit<z.infer<typeof caseSchema>, 'id'>
export type CustomerSupportMessage = Omit<z.infer<typeof messageSchema>, 'id' | 'actor_user_id'> & { message_reference: string; author_reference: string | null }
export type SupportPage = { limit: number; returned: number; has_more: boolean; next_cursor: string | null }
export type SupportReadContext = { companyId: string; customerId: string; actor: SupportActor }
function publicCase(row: z.infer<typeof caseSchema>): CustomerSupportCase {
  return { case_reference: row.case_reference, title: row.title, status: row.status,
    revision: row.revision, created_at: row.created_at, updated_at: row.updated_at }
}

export function supportActorContext(context: SupportReadContext) {
  const actor = context.actor
  return {
    companyId: context.companyId, customerId: context.customerId, mode: actor.kind,
    actorUserId: actor.kind === 'api' ? null : actor.userId,
    sessionId: actor.kind === 'api' ? null : actor.sessionId,
    clientId: actor.kind === 'api' ? actor.clientId : null,
    subject: actor.kind === 'api' ? actor.subject : null,
  }
}

export async function readCustomerSupportPage(context: SupportReadContext, input: { reference?: string; limit?: number | null; cursor?: string | null } = {}): Promise<{ items: CustomerSupportCase[] | CustomerSupportMessage[]; page: SupportPage; internalCaseId?: string; case?: CustomerSupportCase }> {
  const limit = input.limit ?? 25
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 ||
      (input.reference !== undefined && !/^case_[A-Za-z0-9_-]{32}$/.test(input.reference))) {
    throw new SupportCommandError('invalid_support_command', 422)
  }
  const resource = input.reference ? `support_messages:${input.reference}` : 'support_cases'
  const before = decodePortalCursor({ ...context, resource, cursor: input.cursor })
  const { data, error } = await supabaseService.rpc('gridex_support_case_read_v1', {
    p_context: supportActorContext(context),
    p_query: { limit: limit + 1, ...(input.reference ? { reference: input.reference } : {}),
      ...(before ? { before: before.orderValue, beforeId: before.id } : {}) },
  })
  if (error) {
    if (['42883', '42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code)) throw new SupportCommandError('support_schema_unavailable', 503)
    if (error.message === 'support_actor_forbidden') throw new SupportCommandError(error.message, 403)
    if (error.message === 'support_resource_unavailable') throw new SupportCommandError('resource_not_found', 404)
    throw error
  }
  const envelope = z.object({ items: z.array(input.reference ? messageSchema : caseSchema), caseId: z.string().uuid().optional(), case: caseSchema.optional() }).strict().safeParse(data)
  if (!envelope.success || (input.reference && (!envelope.data.caseId || !envelope.data.case ||
      envelope.data.case.id !== envelope.data.caseId || envelope.data.case.case_reference !== input.reference))) throw new SupportCommandError('support_result_invalid', 503)
  if (envelope.data.case && envelope.data.case.case_reference !== publicReference('case', context.companyId, envelope.data.case.id)) throw new SupportCommandError('support_result_invalid', 503)
  const rows = envelope.data.items.slice(0, limit)
  const hasMore = envelope.data.items.length > limit
  const last = rows.at(-1)
  const items = rows.map((row) => {
    if (input.reference) {
      const message = row as z.infer<typeof messageSchema>
      return { message_reference: publicReference('case_message', context.companyId, message.id)!, body: message.body,
        author_kind: message.author_kind, author_reference: publicSupportStaffReference(context.companyId, message.author_kind, message.actor_user_id),
        channel: message.channel, revision: message.revision, created_at: message.created_at }
    }
    const supportCase = row as z.infer<typeof caseSchema>
    if (supportCase.case_reference !== publicReference('case', context.companyId, supportCase.id)) throw new SupportCommandError('support_result_invalid', 503)
    return publicCase(supportCase)
  })
  return {
    items: items as CustomerSupportCase[] | CustomerSupportMessage[],
    page: { limit, returned: rows.length, has_more: hasMore, next_cursor: hasMore && last
      ? encodePortalCursor({ ...context, resource, tuple: { orderValue: last.created_at, id: last.id } }) : null },
    ...(envelope.data.caseId ? { internalCaseId: envelope.data.caseId } : {}),
    ...(envelope.data.case ? { case: publicCase(envelope.data.case) } : {}),
  }
}
