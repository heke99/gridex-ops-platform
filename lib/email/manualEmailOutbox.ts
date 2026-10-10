import { createHash, randomUUID } from 'node:crypto'
import { getEmailProvider } from '@/lib/email/providers'
import type { EmailAttachment } from '@/lib/email/providers/types'
import { isEdielReservedSender, resolveManualMailboxEnvironment } from '@/lib/email/manualOperationsMailbox'
import {
  MANUAL_CONTACT_CHANNEL_TYPES,
  findGridOwnerManualContact,
  manualPoaIsCurrentlyValid,
  readPowerOfAttorneyForSend,
} from '@/lib/customer-operations/manualGridOwnerSendGuards'
import { getTenantOperationDecision } from '@/lib/tenant/operationPolicy'
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
  followUpKind?: string | null
}) {
  if (!input.requestId) return
  const current = await readRequest(input.companyId, input.requestId)
  if (!current) throw new Error('Länkat nätägarärende saknas i samma tenant.')
  const now = new Date().toISOString()
  const baseMetadata = current.metadata && typeof current.metadata === 'object' ? current.metadata as JsonRecord : {}
  const requestUpdate = await supabaseService
    .from('grid_owner_information_requests')
    .update(input.followUpKind
      ? {
          // A reminder/escalation keeps the original sent_at so the follow-up
          // SLA keeps counting from the first request.
          status: 'waiting_manual_response',
          dispatch_status: 'waiting_response',
          metadata: {
            ...baseMetadata,
            last_follow_up_kind: input.followUpKind,
            last_follow_up_outbox_id: input.outboxId,
            last_follow_up_provider_message_id: input.providerMessageId,
            last_follow_up_sent_at: now,
          },
          updated_at: now,
        }
      : {
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

// A send that must never be retried automatically (stale POA, removed
// contact, DB guard rejection). The row becomes terminal 'failed' and the
// linked request goes to needs_review with the reason code.
export class PermanentManualSendError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'PermanentManualSendError'
    this.code = code
  }
}

function isCheckViolation(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? '')
  const message = String((error as { message?: unknown } | null)?.message ?? '')
  return code === '23514' || /violates check constraint|manual_(?:facility|grid_owner)_outbox_requires/i.test(message)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  const message = (error as { message?: unknown } | null)?.message
  return typeof message === 'string' ? message : String(error)
}

// After a terminal outcome the base64 POA PDF is no longer needed: a new send
// always builds a fresh outbox row and regenerates/downloads the PDF. Keep
// filename/type/kind plus sha256 and size as evidence of what was attached.
export function purgeAttachmentContent(value: unknown, purgedAt: string): JsonRecord[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => {
    const row = (entry && typeof entry === 'object' ? entry : {}) as JsonRecord
    const content = clean(row.content)
    if (!content) return row
    const bytes = Buffer.from(content, 'base64')
    const { content: _content, ...rest } = row
    void _content
    return {
      ...rest,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size_bytes: bytes.length,
      content_purged_at: purgedAt,
    }
  })
}

// Stable per outbox row, so a retry of the same row reuses the same RFC
// Message-ID. Inbound replies carry it in In-Reply-To/References.
export function manualOutboxRfcMessageId(input: { outboxId: string; requestId: string | null; fromEmail: string }): string {
  const domain = input.fromEmail.split('@').pop()?.trim().toLowerCase() || 'gridex.invalid'
  const outboxHex = input.outboxId.replace(/-/g, '').toUpperCase()
  const requestHex = input.requestId ? input.requestId.replace(/-/g, '').toUpperCase() : null
  return requestHex ? `<GX-FIR-${requestHex}-${outboxHex}@${domain}>` : `<GX-MAIL-${outboxHex}@${domain}>`
}

export function normalizeRfcMessageId(value: string): string {
  return value.replace(/^<|>$/g, '').trim().toLowerCase()
}

async function readRequestForSend(companyId: string, requestId: string) {
  const { data, error } = await supabaseService
    .from('grid_owner_information_requests')
    .select('id,company_id,customer_id,status,grid_owner_id,poa_id,requires_poa,recipient_email,recipient_contact_channel_id,metadata')
    .eq('company_id', companyId)
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw error
  return data as JsonRecord | null
}

function contactChannelTypeFor(row: JsonRecord, request: JsonRecord | null): string {
  const resolution = jsonObject(row.recipient_resolution)
  const metadata = jsonObject(request?.metadata)
  const candidate = clean(resolution?.contact_channel_type) ?? clean(metadata?.channel_type)
  return candidate && MANUAL_CONTACT_CHANNEL_TYPES.has(candidate) ? candidate : 'facility_information_request'
}

function jsonObject(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

async function markClaimedRowFailed(input: {
  companyId: string
  id: string
  workerId: string | null
  row: JsonRecord
  attempts: number
  errorCode: string
  message: string
}) {
  const now = new Date().toISOString()
  let query = supabaseService
    .from('manual_email_outbox')
    .update({
      status: 'failed',
      delivery_status: 'failed',
      attempts: input.attempts,
      last_error: input.message.slice(0, 500),
      last_error_code: input.errorCode,
      next_attempt_at: null,
      failed_at: now,
      attachments: purgeAttachmentContent(input.row.attachments, now),
      locked_at: null,
      locked_by: null,
      updated_at: now,
    })
    .eq('company_id', input.companyId)
    .eq('id', input.id)
  query = input.workerId ? query.eq('status', 'sending').eq('locked_by', input.workerId) : query.eq('status', 'queued')
  return query.select('id').maybeSingle()
}

export async function processManualEmailOutbox(input?: {
  companyId?: string | null
  limit?: number
}): Promise<ProcessManualEmailOutboxResult> {
  await assertPlatformSchemaReady()
  const companyFilter = clean(input?.companyId)
  const limit = Math.min(Math.max(Number(input?.limit ?? 25) || 25, 1), 100)
  const result: ProcessManualEmailOutboxResult = { scanned: 0, claimed: 0, sent: 0, failed: 0, deliveryUncertain: 0, skipped: 0, errors: [] }
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
  const environment = resolveManualMailboxEnvironment()

  for (const row of rows) {
    const id = String(row.id)
    const companyId = clean(row.company_id)
    if (!companyId) {
      result.skipped += 1
      result.errors.push(`claim ${id}: company_id saknas`)
      continue
    }
    const requestId = clean(row.request_id)
    let recipientResolution = jsonObject(row.recipient_resolution) ?? {}
    // A preview/test deployment may share the production database. It must
    // never send (or fail) a real grid-owner row: leave it queued untouched.
    if (clean(recipientResolution.resolution_mode) === 'real_grid_owner_contact' && environment !== 'production') {
      result.skipped += 1
      result.errors.push(`environment ${id}: manual_ops_environment_not_production`)
      continue
    }
    let providerAccepted = false
    let deliveryPersisted = false
    let providerMessageId: string | null = null
    let rfcMessageId: string | null = null
    try {
      const claimDecision = await getTenantOperationDecision(companyId, 'email.send')
      if (!claimDecision.allowed) {
        result.skipped += 1
        result.errors.push(`claim ${id}: ${claimDecision.reason_code}`)
        continue
      }
    } catch (decisionError) {
      result.skipped += 1
      result.errors.push(`claim ${id}: ${errorMessage(decisionError)}`)
      continue
    }

    const claim = await supabaseService
      .from('manual_email_outbox')
      .update({ status: 'sending', locked_at: new Date().toISOString(), locked_by: workerId, updated_at: new Date().toISOString() })
      .eq('company_id', companyId)
      .eq('id', id)
      .eq('status', 'queued')
      .eq('external_delivery', true)
      .select('id')
      .maybeSingle()
    if (claim.error) {
      const attempts = Number(row.attempts ?? 0) + 1
      const message = errorMessage(claim.error)
      if (isCheckViolation(claim.error) || attempts >= MAX_ATTEMPTS) {
        // The DB guard (e.g. site grid owner changed, owner unverified) rejects
        // 'sending'; writing 'queued' again would re-fire it forever. 'failed'
        // is terminal and allowed by the guard.
        const errorCode = isCheckViolation(claim.error) ? 'outbox_guard_rejected' : 'send_failed'
        const failed = await markClaimedRowFailed({ companyId, id, workerId: null, row, attempts, errorCode, message })
        if (failed.error) result.errors.push(`failure-update ${id}: ${failed.error.message}`)
        else if (!failed.data) result.errors.push(`failure-update ${id}: row_no_longer_queued`)
        await markLinkedRequestFailed({ companyId, requestId, errorCode, message }).catch((linkedError) => {
          result.errors.push(`linked-request ${id}: ${errorMessage(linkedError)}`)
        })
        result.failed += 1
      } else {
        // Transient claim failure: persist the attempt without changing status.
        const retry = await supabaseService
          .from('manual_email_outbox')
          .update({ attempts, last_error: message.slice(0, 500), last_error_code: 'claim_retry', next_attempt_at: retryAt(attempts), updated_at: new Date().toISOString() })
          .eq('company_id', companyId)
          .eq('id', id)
          .eq('status', 'queued')
          .select('id')
          .maybeSingle()
        if (retry.error) result.errors.push(`failure-update ${id}: ${retry.error.message}`)
        result.skipped += 1
      }
      result.errors.push(`claim ${id}: ${message}`)
      continue
    }
    if (!claim.data) {
      result.skipped += 1
      continue
    }
    result.claimed += 1

    try {
      let toEmail = clean(row.to_email)
      const actualRecipient = clean(row.actual_recipient_email)
      const fromEmail = clean(row.from_email)
      if (!toEmail || !actualRecipient || toEmail.toLowerCase() !== actualRecipient.toLowerCase() || !fromEmail) {
        throw new Error('Mottagare/avsändare är inte verifierad för extern leverans.')
      }
      if (await isEdielReservedSender(fromEmail)) throw new Error('Manuell e-post får inte skickas från Ediel-brevlådan.')

      const transportDecision = await getTenantOperationDecision(companyId, 'email.send')
      if (!transportDecision.allowed) {
        const blocked = await supabaseService
          .from('manual_email_outbox')
          .update({
            status: 'blocked_tenant_state',
            delivery_status: 'blocked_tenant_state',
            last_error: transportDecision.reason_code,
            last_error_code: 'blocked_tenant_state',
            blocked_reason: transportDecision.reason_code,
            blocked_at: new Date().toISOString(),
            company_status_snapshot: transportDecision.company_status,
            operation_decision_snapshot: transportDecision,
            locked_at: null,
            locked_by: null,
            updated_at: new Date().toISOString(),
          })
          .eq('company_id', companyId)
          .eq('id', id)
          .eq('status', 'sending')
          .eq('locked_by', workerId)
          .select('id')
          .maybeSingle()
        if (blocked.error) throw blocked.error
        if (!blocked.data) throw new Error('manual_email_claim_lost_before_tenant_block')
        result.skipped += 1
        result.errors.push(`transport ${id}: ${transportDecision.reason_code}`)
        continue
      }

      // Re-check the power of attorney right before the provider call: it may
      // have been revoked, replaced or expired since the row was queued.
      const request = requestId ? await readRequestForSend(companyId, requestId) : null
      if (request) {
        const poaId = clean(request.poa_id)
        if (poaId) {
          const poa = await readPowerOfAttorneyForSend({ companyId, poaId })
          const sameCustomer = !clean(poa?.customer_id) || !clean(request.customer_id) || clean(poa?.customer_id) === clean(request.customer_id)
          if (!poa || !sameCustomer || !manualPoaIsCurrentlyValid(poa)) {
            throw new PermanentManualSendError(
              'poa_not_valid',
              'Fullmakten är inte längre giltig (återkallad, ersatt, utgången eller ännu inte giltig). Utskicket till nätägaren stoppades.',
            )
          }
        } else if (request.requires_poa === true) {
          throw new PermanentManualSendError('poa_missing', 'Fullmakt saknas på nätägarärendet. Utskicket till nätägaren stoppades.')
        }
      }

      // Re-resolve the real grid-owner recipient: a contact change after
      // queueing must not send to the old address.
      const gridOwnerId = clean(request?.grid_owner_id)
      if (request && gridOwnerId && clean(recipientResolution.resolution_mode) === 'real_grid_owner_contact') {
        const channelType = contactChannelTypeFor(row, request)
        const contact = await findGridOwnerManualContact({ companyId, gridOwnerId, channelType })
        if (!contact) {
          throw new PermanentManualSendError('grid_owner_contact_missing', 'Nätägarens verifierade kontaktväg saknas vid utskick. Utskicket stoppades.')
        }
        if (contact.email.toLowerCase() !== toEmail.toLowerCase()) {
          const previous = toEmail
          recipientResolution = {
            ...recipientResolution,
            selected_to_email: contact.email,
            actual_grid_owner_contact_email: contact.email,
            contact_source_id: contact.contactChannelId,
            contact_source: contact.source,
            recipient_contact_channel_id: contact.contactChannelId,
            recipient_changed_at_send: { previous_to_email: previous, current_to_email: contact.email, at: new Date().toISOString() },
          }
          const changed = await supabaseService
            .from('manual_email_outbox')
            .update({ to_email: contact.email, actual_recipient_email: contact.email, recipient_resolution: recipientResolution, updated_at: new Date().toISOString() })
            .eq('company_id', companyId)
            .eq('id', id)
            .eq('status', 'sending')
            .eq('locked_by', workerId)
            .select('id')
            .maybeSingle()
          if (changed.error) throw changed.error
          if (!changed.data) throw new Error('manual_email_claim_lost_before_recipient_update')
          const requestChanged = await supabaseService
            .from('grid_owner_information_requests')
            .update({ recipient_email: contact.email, recipient_contact_channel_id: contact.contactChannelId, updated_at: new Date().toISOString() })
            .eq('company_id', companyId)
            .eq('id', String(request.id))
            .select('id')
          if (requestChanged.error) throw requestChanged.error
          console.info('[manual-email-outbox] recipient re-resolved at send time', { outboxId: id, requestId, contactChannelId: contact.contactChannelId })
          toEmail = contact.email
        } else if (contact.contactChannelId && clean(request.recipient_contact_channel_id) !== contact.contactChannelId) {
          const requestChanged = await supabaseService
            .from('grid_owner_information_requests')
            .update({ recipient_contact_channel_id: contact.contactChannelId, updated_at: new Date().toISOString() })
            .eq('company_id', companyId)
            .eq('id', String(request.id))
            .select('id')
          if (requestChanged.error) throw requestChanged.error
        }
      }

      rfcMessageId = manualOutboxRfcMessageId({ outboxId: id, requestId, fromEmail })
      const sent = await provider.sendEmail({
        from: fromEmail,
        to: toEmail,
        replyTo: clean(row.reply_to) ?? undefined,
        subject: String(row.subject ?? ''),
        html: String(row.body_html ?? ''),
        text: clean(row.body_text) ?? undefined,
        attachments: toAttachments(row.attachments),
        // The provider key is bound to the actual recipient: after a contact
        // change at send time Resend must not return the earlier send.
        idempotencyKey: (() => {
          const base = clean(row.provider_idempotency_key) ?? clean(row.idempotency_key)
          if (!base) return undefined
          return recipientResolution.recipient_changed_at_send
            ? `${base}:to:${createHash('sha256').update(toEmail.toLowerCase()).digest('hex').slice(0, 16)}`
            : base
        })(),
        headers: { 'Message-ID': rfcMessageId },
      })
      providerMessageId = clean(sent.providerMessageId)
      if (!providerMessageId) throw new Error('E-postprovidern returnerade inget meddelande-ID.')
      providerAccepted = true

      const sentAt = new Date().toISOString()
      const sentUpdate = await supabaseService
        .from('manual_email_outbox')
        .update({
          status: 'sent', delivery_status: 'sent', provider_message_id: providerMessageId,
          sent_at: sentAt, attempts: Number(row.attempts ?? 0) + 1,
          last_error: null, last_error_code: null, delivery_uncertain_at: null,
          attachments: purgeAttachmentContent(row.attachments, sentAt),
          recipient_resolution: { ...recipientResolution, rfc_message_id: normalizeRfcMessageId(rfcMessageId), rfc_message_id_header: rfcMessageId },
          locked_at: null, locked_by: null, updated_at: sentAt,
        })
        .eq('company_id', companyId)
        .eq('id', id)
        .eq('status', 'sending')
        .eq('locked_by', workerId)
        .select('id')
      if (sentUpdate.error) throw sentUpdate.error
      if (!sentUpdate.data?.length) throw new Error('Skickad e-post kunde inte slutmarkeras atomiskt.')
      deliveryPersisted = true

      try {
        await advanceLinkedRequest({
          companyId,
          requestId,
          outboxId: id,
          providerMessageId,
          followUpKind: clean(recipientResolution.follow_up_kind),
        })
      } catch (linkedError) {
        const linkedMessage = errorMessage(linkedError)
        result.errors.push(`linked-request-after-send ${id}: ${linkedMessage}`)
        await markLinkedRequestFailed({
          companyId,
          requestId,
          errorCode: 'post_send_projection_failed',
          message: `E-postmeddelandet skickades men det länkade ärendet kunde inte uppdateras: ${linkedMessage}`,
        }).catch((error) => {
          result.errors.push(`linked-request-recovery ${id}: ${errorMessage(error)}`)
        })
      }
      result.sent += 1
    } catch (sendError) {
      const attempts = Number(row.attempts ?? 0) + 1
      const message = errorMessage(sendError)

      if (providerAccepted && !deliveryPersisted) {
        const uncertainUpdate = await supabaseService
          .from('manual_email_outbox')
          .update({
            status: 'delivery_uncertain',
            delivery_status: 'delivery_uncertain',
            provider_message_id: providerMessageId,
            attempts,
            last_error: `delivery_uncertain_after_provider_acceptance: ${message}`.slice(0, 500),
            last_error_code: 'delivery_uncertain',
            delivery_uncertain_at: new Date().toISOString(),
            next_attempt_at: null,
            recipient_resolution: rfcMessageId
              ? { ...recipientResolution, rfc_message_id: normalizeRfcMessageId(rfcMessageId), rfc_message_id_header: rfcMessageId }
              : recipientResolution,
            locked_at: null,
            locked_by: null,
            updated_at: new Date().toISOString(),
          })
          .eq('company_id', companyId)
          .eq('id', id)
          .eq('status', 'sending')
          .eq('locked_by', workerId)
          .select('id')
          .maybeSingle()
        if (uncertainUpdate.error) {
          result.errors.push(`delivery-uncertain-update ${id}: ${uncertainUpdate.error.message}`)
        } else if (!uncertainUpdate.data) {
          result.errors.push(`delivery-uncertain-update ${id}: claim_lost_before_uncertain_persistence`)
        }
        await markLinkedRequestFailed({
          companyId,
          requestId,
          errorCode: 'delivery_uncertain',
          message: 'E-postprovidern accepterade utskicket men lokal slutstatus kunde inte bekräftas. Kontrollera providerstatus före återköning.',
        }).catch((error) => {
          result.errors.push(`linked-request ${id}: ${errorMessage(error)}`)
        })
        result.deliveryUncertain += 1
        result.errors.push(`send ${id}: delivery_uncertain: ${message}`)
        continue
      }

      const permanentCode = sendError instanceof PermanentManualSendError
        ? sendError.code
        : isCheckViolation(sendError) ? 'outbox_guard_rejected' : null
      const permanentlyFailed = Boolean(permanentCode) || attempts >= MAX_ATTEMPTS || /inte verifierad|Ediel-brevlådan|fryst/i.test(message)
      const errorCode = permanentCode ?? (permanentlyFailed ? 'send_failed' : 'send_retry')
      let failureUpdate = permanentlyFailed
        ? await markClaimedRowFailed({ companyId, id, workerId, row, attempts, errorCode, message })
        : await supabaseService
          .from('manual_email_outbox')
          .update({
            status: 'queued',
            delivery_status: 'queued',
            attempts,
            last_error: message.slice(0, 500),
            last_error_code: errorCode,
            next_attempt_at: retryAt(attempts),
            locked_at: null,
            locked_by: null,
            updated_at: new Date().toISOString(),
          })
          .eq('company_id', companyId)
          .eq('id', id)
          .eq('status', 'sending')
          .eq('locked_by', workerId)
          .select('id')
          .maybeSingle()
      let terminal = permanentlyFailed
      let terminalCode = errorCode
      if (!permanentlyFailed && failureUpdate.error && isCheckViolation(failureUpdate.error)) {
        // Re-queueing re-fires the site/owner guard: this row can never be
        // sent, so dead-letter it instead of looping forever.
        terminal = true
        terminalCode = 'outbox_guard_rejected'
        failureUpdate = await markClaimedRowFailed({ companyId, id, workerId, row, attempts, errorCode: terminalCode, message: errorMessage(failureUpdate.error) })
      }
      if (failureUpdate.error) result.errors.push(`failure-update ${id}: ${failureUpdate.error.message}`)
      else if (!failureUpdate.data) result.errors.push(`failure-update ${id}: claim_lost_before_failure_persistence`)
      if (terminal) {
        await markLinkedRequestFailed({ companyId, requestId, errorCode: terminalCode, message }).catch((error) => {
          result.errors.push(`linked-request ${id}: ${errorMessage(error)}`)
        })
      }
      result.failed += 1
      result.errors.push(`send ${id}: ${message}`)
    }
  }
  return result
}
