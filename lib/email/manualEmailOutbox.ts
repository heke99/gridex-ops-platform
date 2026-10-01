import { randomUUID } from 'node:crypto'
import { getEmailProvider } from '@/lib/email/providers'
import type { EmailAttachment } from '@/lib/email/providers/types'
import { isEdielReservedSender } from '@/lib/email/manualOperationsMailbox'
import { getTenantOperationDecision } from '@/lib/tenant/operationPolicy'
import { assertPlatformSchemaReady } from '@/lib/platform/schemaReadiness'
import { supabaseService } from '@/lib/supabase/service'
import { claimManualEmailRows, finishManualEmailClaim, manualEmailClaimLimit, recheckManualEmailClaim, recoverStaleManualEmailRows } from '@/lib/email/manualEmailFairClaim'

type JsonRecord = Record<string, unknown>
const MAX_ATTEMPTS = 5

export type ProcessManualEmailOutboxResult = {
  scanned: number
  claimed: number
  sent: number
  failed: number
  deliveryUncertain: number
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

async function recoverStaleManualSendingRows(companyId: string | null, limit: number): Promise<string[]> {
  const errors: string[] = []
  const rows = await recoverStaleManualEmailRows(companyId, limit)
  for (const row of rows) {
    await markLinkedRequestFailed({
      companyId: row.company_id,
      requestId: row.request_id,
      errorCode: 'delivery_uncertain',
      message: 'Det är oklart om e-postmeddelandet skickades. Kontrollera providerstatus före återköning.',
    }).catch(error => {
      errors.push(`stale-linked-request ${row.id}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }
  return errors
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
  const limit = manualEmailClaimLimit(input?.limit)
  const result: ProcessManualEmailOutboxResult = { scanned: 0, claimed: 0, sent: 0, failed: 0, deliveryUncertain: 0, skipped: 0, errors: [] }
  const workerId = `manual-email:${randomUUID()}`
  result.errors.push(...await recoverStaleManualSendingRows(companyFilter, limit))
  const rows = await claimManualEmailRows(companyFilter, limit, workerId)
  result.scanned = rows.length
  result.claimed = rows.length
  if (!rows.length) return result
  const provider = getEmailProvider()

  for (const row of rows) {
    const id = row.id
    const companyId = row.company_id
    // A failed read must not become a failure write against an unverified claim.
    try {
      if (!await recheckManualEmailClaim(row)) {
        result.skipped += 1
        result.errors.push(`claim ${id}: live_claim_or_payload_changed`)
        continue
      }
    } catch (error) {
      result.skipped += 1
      result.errors.push(`claim-recheck ${id}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    let providerAccepted = false
    let deliveryPersisted = false
    let providerMessageId: string | null = null
    try {
      const claimDecision = await getTenantOperationDecision(companyId, 'email.send')
      const blockByTenant = async (decision: typeof claimDecision) => {
        await finishManualEmailClaim(row, {
          status: 'blocked_tenant_state', delivery_status: 'blocked_tenant_state',
          last_error: decision.reason_code, last_error_code: 'blocked_tenant_state',
          blocked_reason: decision.reason_code, company_status_snapshot: decision.company_status,
          operation_decision_snapshot: decision,
        })
        result.skipped += 1
        result.errors.push(`transport ${id}: ${decision.reason_code}`)
      }
      if (!claimDecision.allowed) {
        await blockByTenant(claimDecision)
        continue
      }
      const toEmail = clean(row.to_email)
      const actualRecipient = clean(row.actual_recipient_email)
      const fromEmail = clean(row.from_email)
      if (!toEmail || !actualRecipient || toEmail.toLowerCase() !== actualRecipient.toLowerCase() || !fromEmail) {
        throw new Error('Mottagare/avsändare är inte verifierad för extern leverans.')
      }
      if (await isEdielReservedSender(fromEmail)) throw new Error('Manuell e-post får inte skickas från Ediel-brevlådan.')
      const transportDecision = await getTenantOperationDecision(companyId, 'email.send')
      if (!transportDecision.allowed) {
        await blockByTenant(transportDecision)
        continue
      }
      // Repeat after asynchronous sender/policy checks, using the original lease
      // and immutable payload. No caller-supplied or newly changed body is sent.
      try {
        if (!await recheckManualEmailClaim(row)) {
          result.skipped += 1
          result.errors.push(`transport ${id}: live_claim_or_payload_changed`)
          continue
        }
      } catch (error) {
        result.skipped += 1
        result.errors.push(`transport-recheck ${id}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      const sent = await provider.sendEmail({
        from: fromEmail, to: toEmail, replyTo: clean(row.reply_to) ?? undefined,
        subject: String(row.subject ?? ''), html: String(row.body_html ?? ''), text: clean(row.body_text) ?? undefined,
        attachments: toAttachments(row.attachments),
        idempotencyKey: clean(row.provider_idempotency_key) ?? clean(row.idempotency_key) ?? undefined,
      })
      // A fulfilled provider call has crossed the acceptance boundary even when
      // its returned receipt is incomplete; absence of an ID cannot justify a retry.
      providerAccepted = true
      providerMessageId = clean(sent.providerMessageId)
      if (!providerMessageId) throw new Error('E-postprovidern returnerade inget meddelande-ID.')
      await finishManualEmailClaim(row, {
        status: 'sent', delivery_status: 'sent', provider_message_id: providerMessageId,
        attempts: row.attempts + 1, last_error: null, last_error_code: null, delivery_uncertain_at: null,
      })
      deliveryPersisted = true
      try {
        await advanceLinkedRequest({ companyId, requestId: clean(row.request_id), outboxId: id, providerMessageId })
      } catch (linkedError) {
        const linkedMessage = linkedError instanceof Error ? linkedError.message : String(linkedError)
        result.errors.push(`linked-request-after-send ${id}: ${linkedMessage}`)
        await markLinkedRequestFailed({
          companyId, requestId: clean(row.request_id), errorCode: 'post_send_projection_failed',
          message: `E-postmeddelandet skickades men det länkade ärendet kunde inte uppdateras: ${linkedMessage}`,
        }).catch(error => { result.errors.push(`linked-request-recovery ${id}: ${error instanceof Error ? error.message : String(error)}`) })
      }
      result.sent += 1
    } catch (sendError) {
      const attempts = row.attempts + 1
      const message = sendError instanceof Error ? sendError.message : String(sendError)
      if (providerAccepted && !deliveryPersisted) {
        let uncertainSaved = false
        await finishManualEmailClaim(row, {
          status: 'delivery_uncertain', delivery_status: 'delivery_uncertain', provider_message_id: providerMessageId,
          attempts, last_error: `delivery_uncertain_after_provider_acceptance: ${message}`.slice(0, 500),
          last_error_code: 'delivery_uncertain', next_attempt_at: null,
        }).then(() => { uncertainSaved = true }).catch(error => {
          result.errors.push(`delivery-uncertain-update ${id}: ${error instanceof Error ? error.message : String(error)}`)
        })
        if (uncertainSaved) await markLinkedRequestFailed({
          companyId, requestId: clean(row.request_id), errorCode: 'delivery_uncertain',
          message: 'E-postprovidern accepterade utskicket men lokal slutstatus kunde inte bekräftas. Kontrollera providerstatus före återköning.',
        }).catch(error => { result.errors.push(`linked-request ${id}: ${error instanceof Error ? error.message : String(error)}`) })
        result.deliveryUncertain += 1
        result.errors.push(`send ${id}: delivery_uncertain: ${message}`)
        continue
      }
      const permanentlyFailed = attempts >= MAX_ATTEMPTS || /inte verifierad|Ediel-brevlådan|fryst/i.test(message)
      let failureSaved = false
      await finishManualEmailClaim(row, {
        status: permanentlyFailed ? 'failed' : 'queued', delivery_status: permanentlyFailed ? 'failed' : 'queued',
        attempts, last_error: message.slice(0, 500), last_error_code: permanentlyFailed ? 'send_failed' : 'send_retry',
        next_attempt_at: permanentlyFailed ? null : retryAt(attempts),
      }).then(() => { failureSaved = true }).catch(error => {
        result.errors.push(`failure-update ${id}: ${error instanceof Error ? error.message : String(error)}`)
      })
      if (failureSaved && permanentlyFailed) await markLinkedRequestFailed({
        companyId, requestId: clean(row.request_id), errorCode: 'send_failed', message,
      }).catch(error => { result.errors.push(`linked-request ${id}: ${error instanceof Error ? error.message : String(error)}`) })
      if (failureSaved) result.failed += 1
      else result.skipped += 1
      result.errors.push(`send ${id}: ${message}`)
    }
  }
  return result
}
