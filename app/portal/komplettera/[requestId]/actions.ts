'use server'

import { revalidatePath } from 'next/cache'
import { getCustomerPortalContext } from '@/lib/customer-portal/db'
import { targetedRequestFields } from '@/lib/customer-portal/targetedRequestFields'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { supabaseService } from '@/lib/supabase/service'
import { isUuid } from '@/lib/validation/uuid'

export type TargetedRequestResult = { status: 'saved'; receiptId: string } | { status: 'error'; message: string }

type RequestReplyRpc = {
  rpc(name: 'gridex_submit_portal_request_fields_v1', input: {
    p_actor_user_id: string; p_session_id: string; p_company_id: string; p_request_id: string;
    p_expected_site_id: string | null; p_intent_id: string; p_fields: Record<string, string>;
  }): Promise<{ data: { receipt_id?: string } | null; error: { message?: string } | null }>;
}

export async function submitPortalTargetedRequest(formData: FormData): Promise<TargetedRequestResult> {
  const requestId = formData.get('requestId')
  const companyId = formData.get('companyId')
  const siteId = formData.get('siteId')
  const intentId = formData.get('intentId')
  const unavailable = { status: 'error', message: 'Uppgiftsbegäran har ändrats eller kan inte besvaras. Öppna den igen från Status.' } as const
  if (typeof requestId !== 'string' || !isUuid(requestId)
    || typeof companyId !== 'string' || !isUuid(companyId)
    || typeof siteId !== 'string' || (siteId !== '' && !isUuid(siteId))
    || typeof intentId !== 'string' || !isUuid(intentId)) return unavailable

  const fields: Record<string, string> = {}
  for (const [name, field] of Object.entries(targetedRequestFields)) {
    const value = formData.get(name)
    if (value === null) continue
    if (typeof value !== 'string' || !value.trim() || value.length > field.limit || formData.getAll(name).length !== 1) {
      return { status: 'error', message: 'Kontrollera de efterfrågade uppgifterna och försök igen.' }
    }
    fields[name] = value.trim()
  }
  if (!Object.keys(fields).length) return unavailable

  const client = await createSupabaseServerClient()
  const { data: { user }, error: userError } = await client.auth.getUser()
  if (!user || userError) return unavailable
  const { data: token, error: claimsError } = await client.auth.getClaims()
  const sessionId = token?.claims.session_id
  if (claimsError || token?.claims.sub !== user.id || typeof sessionId !== 'string' || !isUuid(sessionId)) return unavailable
  const context = await getCustomerPortalContext()
  if (context.companyId !== companyId || context.customerIds.length === 0) return unavailable

  const db = supabaseService as unknown as RequestReplyRpc
  const { data, error } = await db.rpc('gridex_submit_portal_request_fields_v1', {
    p_actor_user_id: user.id, p_session_id: sessionId, p_company_id: companyId,
    p_request_id: requestId, p_expected_site_id: siteId || null, p_intent_id: intentId, p_fields: fields,
  })
  if (error || !data?.receipt_id || !isUuid(data.receipt_id)) {
    if (error?.message === 'portal_reply_intent_conflict') return { status: 'error', message: 'Det här försöket gäller ett tidigare svar. Ange samma uppgifter för att få tillbaka kvittot.' }
    if (['portal_reply_target_unavailable', 'portal_reply_scope_denied', 'portal_reply_closed', 'portal_customer_retention_access_revoked', 'portal_reply_fields_changed'].includes(error?.message ?? '')) return unavailable
    return { status: 'error', message: 'Inget svarskvitto mottogs. Försök igen med samma uppgifter.' }
  }
  revalidatePath('/portal/komplettera/' + requestId)
  return { status: 'saved', receiptId: data.receipt_id }
}
