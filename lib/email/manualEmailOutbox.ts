import { randomUUID } from 'node:crypto'
import { getEmailProvider } from '@/lib/email/providers'
import type { EmailAttachment } from '@/lib/email/providers/types'
import { isEdielReservedSender } from '@/lib/email/manualOperationsMailbox'
import { assertOutboundAllowed } from '@/lib/platform/outboundFreeze'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { supabaseService } from '@/lib/supabase/service'

type JsonRecord = Record<string, unknown>
const MAX_ATTEMPTS = 5
const STALE_SENDING_MINUTES = 15

export type ProcessManualEmailOutboxResult = {
  scanned: number
  claimed: number
  sent: number
  failed: number
  skipped: number
  errors: string[]
}

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function toAttachments(value: unknown): EmailAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const row = entry as JsonRecord
    const filename = clean(row.filename)
    const content = clean(row.content)
    if (!filename || !content) return []
    return [{ filename, content, contentType: clean(row.contentType) ?? clean(row.content_type) ?? null } as EmailAttachment]
  })
}

function fairRows(rows: JsonRecord[], limit: number): JsonRecord[] {
  const byCompany = new Map<string, JsonRecord[]>()
  for (const row of rows) {
    const companyId = clean(row.company_id) ?? 'missing-company'
    byCompany.set(companyId, [...(byCompany.get(companyId) ?? []), row])
  }
  const result: JsonRecord[] = []
  while (result.length < limit && Array.from(byCompany.values()).some((queue) => queue.length > 0)) {
    for (const queue of byCompany.values()) {
      const next = queue.shift()
      if (next) result.push(next)
      if (result.length >= limit) break
    }
  }
  return result
}

function retryAt(attempts: number): string {
  const minutes = Math.min(12 * 60, 2 ** Math.max(0, attempts - 1) * 5)
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

async function readRequest(companyId: string, requestId: string) {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,company_id,customer_id,customer_site_id,status,dispatch_status,metadata')
    .eq('company_id', companyId)
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw error
  return data as JsonRecord | null
}

async function advanceLinkedRequest(input: {
  companyId: string
  requestId: string | null
  outboxId: string
  providerMessageId: string | null
}) {
  if (!input.requestId) return
  const current = await readRequest(input.companyId, input.requestId)
  if (!current) throw new Error('Länkat nätägarärende saknas i samma tenant.')
  const now = new Date().toISOString()
  const baseMetadata = current.metadata && typeof current.metadata === 'object' ? current.metadata as JsonRecord : {}
  const requestUpdate = await supabaseService
    .from('grid_owner_information_requests')
    .update({
      status: 'waiting_manual_response',
      dispatch_status: 'waiting_response',
      sent_at: now,
      metadata: {
        ...baseMetadata,
        manual_email_outbox_id: input.outboxId,
        manual_email_provider_message_id: input.providerMessageId,
        manual_email_sent_at: now,
      },
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('id', input.requestId)
    .in('status', ['manual_email_queued', 'ready_to_send_manual_email', 'manual_email_sent', 'waiting_manual_response'])
    .select('id')
  if (requestUpdate.error) throw requestUpdate.error
  if (!requestUpdate.data?.length) throw new Error('Nätägarärendet kunde inte flyttas till vänteläge.')

  const customerId = clean(current.customer_id)
  const siteId = clean(current.customer_site_id)
  if (siteId) {
    const siteUpdate = await supabaseService
      .from('customer_sites')
      .update({ facility_data_status: 'waiting_manual_response', next_action: 'Väntar på svar från nätägaren.', updated_at: now })
      .eq('company_id', input.companyId)
      .eq('id', siteId)
      .select('id')
    if (siteUpdate.error) throw siteUpdate.error
    if (!siteUpdate.data?.length) throw new Error('Anläggningen för nätägarärendet saknas i samma tenant.')
  }
  if (customerId) {
    const customerUpdate = await supabaseService
      .from('customers')
      .update({ next_action: 'Väntar på svar från nätägaren.', updated_at: now })
      .eq('company_id', input.companyId)
      .eq('id', customerId)
      .select('id')
    if (customerUpdate.error) throw customerUpdate.error
    if (!customerUpdate.data?.length) throw new Error('Kunden för nätägarärendet saknas i samma tenant.')
  }
}

async function markLinkedRequestFailed(input: {
  companyId: string
  requestId: string | null
  errorCode: string
  message: string
}) {
  if (!input.requestId) return
  const current = await readRequest(input.companyId, input.requestId)
  if (!current) return
  const now = new Date().toISOString()
  const baseMetadata = current.metadata && typeof current.metadata === 'object' ? current.metadata as JsonRecord : {}
  const result = await supabaseService
    .from('grid_owner_information_requests')
    .update({
      status: 'needs_review',
      dispatch_status: 'failed',
      dispatch_error_code: input.errorCode,
      dispatch_error_message: input.message.slice(0, 500),
      metadata: { ...baseMetadata, manual_email_failed_at: now, manual_email_error_code: input.errorCode },
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('id', input.requestId)
    .in('status', ['manual_email_queued', 'ready_to_send_manual_email', 'manual_email_sent', 'waiting_manual_response'])
    .select('id')
  if (result.error) throw result.error
}

async function recoverStaleManualSendingRows(companyId: string | null): Promise<void> {
  const now = new Date().toISOString()
  const cutoff = new Date(Date.now() - STALE_SENDING_MINUTES * 60_000).toISOString()
  let query = supabaseService
    .from('manual_email_outbox')
    .update({
      status: 'delivery_uncertain',
      delivery_status: 'delivery_uncertain',
      last_error: 'Providerleveransen måste kontrolleras innan nytt försök.',
      last_error_code: 'delivery_uncertain',
      delivery_uncertain_at: now,
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq('status', 'sending')
    .lt('locked_at', cutoff)
  if (companyId) query = query.eq('company_id', companyId)
  const { data, error } = await query.select('id,company_id,request_id')
  if (error) throw error
  for (const row of (data ?? []) as JsonRecord[]) {
    await markLinkedRequestFailed({
      companyId: String(row.company_id),
      requestId: clean(row.request_id),
      errorCode: 'delivery_uncertain',
      message: 'Det är oklart om e-postmeddelandet skickades. Kontrollera providerstatus före återköning.',
    })
  }
}

export async function requeueUncertainManualEmail(input: {
  outboxId: string
  companyId: string
  actorUserId: string
}) {
  const now = new Date().toISOString()
  const { data, error } = await supabaseService
    .from('manual_email_outbox')
    .update({
      status: 'queued',
      delivery_status: 'queued',
      last_error: null,
      last_error_code: null,
      delivery_uncertain_at: null,
      next_attempt_at: now,
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('id', input.outboxId)
    .eq('status', 'delivery_uncertain')
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) return { ok: false as const, error: 'Utskicket är inte längre i osäkert leveransläge.' }
  return { ok: true as const, outboxId: String(data.id) }
}

export async function processManualEmailOutbox(input?: {
  companyId?: string | null
  limit?: number
}): Promise<ProcessManualEmailOutboxResult> {
  await assertPlatformSchemaReady()
  const companyFilter = clean(input?.companyId)
  const limit = Math.min(Math.max(Number(input?.limit ?? 25) || 25, 1), 100)
  const result: ProcessManualEmailOutboxResult = { scanned: 0, claimed: 0, sent: 0, failed: 0, skipped: 0, errors: [] }
  const workerId = `manual-email:${randomUUID()}`
  await recoverStaleManualSendingRows(companyFilter)

  let query = supabaseService
    .from('manual_email_outbox')
    .select('*')
    .eq('status', 'queued')
    .eq('external_delivery', true)
    .lte('next_attempt_at', new Date().toISOString())
    .order('queued_at', { ascending: true })
    .limit(companyFilter ? limit : Math.min(limit * 10, 1000))
  if (companyFilter) query = query.eq('company_id', companyFilter)
  const { data, error } = await query
  if (error) throw error
  const rows = companyFilter ? (data ?? []) as JsonRecord[] : fairRows((data ?? []) as JsonRecord[], limit)
  result.scanned = rows.length
  if (!rows.length) return result
  const provider = getEmailProvider()

  for (const row of rows) {
    const id = String(row.id)
    const companyId = clean(row.company_id)
    if (!companyId) {
      result.skipped += 1
      result.errors.push(`claim ${id}: company_id saknas`)
      continue
    }
    try {
      await assertOutboundAllowed({ companyId, channel: 'manual_email' })
      const claim = await supabaseService
        .from('manual_email_outbox')
        .update({ status: 'sending', locked_at: new Date().toISOString(), locked_by: workerId, updated_at: new Date().toISOString() })
        .eq('company_id', companyId)
        .eq('id', id)
        .eq('status', 'queued')
        .eq('external_delivery', true)
        .select('id')
        .maybeSingle()
      if (claim.error) throw claim.error
      if (!claim.data) {
        result.skipped += 1
        continue
      }
      result.claimed += 1

      const toEmail = clean(row.to_email)
      const actualRecipient = clean(row.actual_recipient_email)
      const fromEmail = clean(row.from_email)
      if (!toEmail || !actualRecipient || toEmail.toLowerCase() !== actualRecipient.toLowerCase() || !fromEmail) {
        throw new Error('Mottagare/avsändare är inte verifierad för extern leverans.')
      }
      if (await isEdielReservedSender(fromEmail)) throw new Error('Manuell e-post får inte skickas från Ediel-brevlådan.')

      const sent = await provider.sendEmail({
        from: fromEmail,
        to: toEmail,
        replyTo: clean(row.reply_to) ?? undefined,
        subject: String(row.subject ?? ''),
        html: String(row.body_html ?? ''),
        text: clean(row.body_text) ?? undefined,
        attachments: toAttachments(row.attachments),
        idempotencyKey: clean(row.provider_idempotency_key) ?? clean(row.idempotency_key) ?? undefined,
      })
      if (!clean(sent.providerMessageId)) throw new Error('E-postprovidern returnerade inget meddelande-ID.')
      const sentUpdate = await supabaseService
        .from('manual_email_outbox')
        .update({
          status: 'sent', delivery_status: 'sent', provider_message_id: sent.providerMessageId,
          sent_at: new Date().toISOString(), attempts: Number(row.attempts ?? 0) + 1,
          last_error: null, last_error_code: null, locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
        })
        .eq('company_id', companyId)
        .eq('id', id)
        .eq('status', 'sending')
        .eq('locked_by', workerId)
        .select('id')
      if (sentUpdate.error) throw sentUpdate.error
      if (!sentUpdate.data?.length) throw new Error('Skickad e-post kunde inte slutmarkeras atomiskt.')
      await advanceLinkedRequest({ companyId, requestId: clean(row.request_id), outboxId: id, providerMessageId: clean(sent.providerMessageId) })
      result.sent += 1
    } catch (sendError) {
      const attempts = Number(row.attempts ?? 0) + 1
      const message = sendError instanceof Error ? sendError.message : String(sendError)
      const permanentlyFailed = attempts >= MAX_ATTEMPTS || /inte verifierad|Ediel-brevlådan|fryst/i.test(message)
      const failureUpdate = await supabaseService
        .from('manual_email_outbox')
        .update({
          status: permanentlyFailed ? 'failed' : 'queued',
          delivery_status: permanentlyFailed ? 'failed' : 'queued',
          attempts,
          last_error: message.slice(0, 500),
          last_error_code: permanentlyFailed ? 'send_failed' : 'send_retry',
          next_attempt_at: permanentlyFailed ? null : retryAt(attempts),
          locked_at: null,
          locked_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq('company_id', companyId)
        .eq('id', id)
      if (failureUpdate.error) result.errors.push(`failure-update ${id}: ${failureUpdate.error.message}`)
      if (permanentlyFailed) {
        await markLinkedRequestFailed({ companyId, requestId: clean(row.request_id), errorCode: 'send_failed', message }).catch((error) => {
          result.errors.push(`linked-request ${id}: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
      result.failed += 1
      result.errors.push(`send ${id}: ${message}`)
    }
  }
  return result
}
