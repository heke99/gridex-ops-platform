import { supabaseService } from '@/lib/supabase/service'

export type EdielMailboxRow = {
  id: string
  company_id: string | null
  mailbox_name: string
  email_address: string | null
  imap_host: string | null
  imap_port: number | null
  smtp_host: string | null
  smtp_port: number | null
  username: string | null
  secret_reference: string | null
  environment: string
  is_active: boolean
  poll_interval_minutes: number
  last_polled_at: string | null
  last_successful_poll_at: string | null
  last_error: string | null
  locked_at: string | null
  locked_by: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type StoreInboundEmailInput = {
  mailboxId: string
  companyId?: string | null
  internetMessageId?: string | null
  fromAddress?: string | null
  toAddress?: string | null
  subject?: string | null
  receivedAt?: string | null
  rawEmail?: string | null
  rawEdifactPayload?: string | null
  bodyText?: string | null
  bodyHtml?: string | null
  hasAttachments?: boolean
}

function nowIso(): string {
  return new Date().toISOString()
}

export async function listDueEdielMailboxes(options: { environment?: string | null } = {}): Promise<EdielMailboxRow[]> {
  let query = supabaseService
    .from('ediel_mailboxes')
    .select('*')
    .eq('is_active', true)

  if (options.environment) query = query.eq('environment', options.environment)

  const { data, error } = await query.order('last_polled_at', { ascending: true, nullsFirst: true })
  if (error) throw error

  const now = Date.now()
  return ((data ?? []) as EdielMailboxRow[]).filter((mailbox) => {
    if (!mailbox.last_polled_at) return true
    const intervalMinutes = Number(mailbox.poll_interval_minutes || 10)
    const last = new Date(mailbox.last_polled_at).getTime()
    if (Number.isNaN(last)) return true
    return now - last >= intervalMinutes * 60_000
  })
}

export async function markMailboxPollStarted(mailboxId: string, workerId = 'inbound-mail-engine'): Promise<void> {
  const { error } = await supabaseService
    .from('ediel_mailboxes')
    .update({ last_polled_at: nowIso(), locked_at: nowIso(), locked_by: workerId, last_error: null })
    .eq('id', mailboxId)

  if (error) throw error
}

export async function markMailboxPollFinished(input: {
  mailboxId: string
  ok: boolean
  errorMessage?: string | null
}): Promise<void> {
  const payload = input.ok
    ? { last_successful_poll_at: nowIso(), locked_at: null, locked_by: null, last_error: null }
    : { locked_at: null, locked_by: null, last_error: input.errorMessage ?? 'Mailbox polling failed' }

  const { error } = await supabaseService.from('ediel_mailboxes').update(payload).eq('id', input.mailboxId)
  if (error) throw error
}

export async function storeInboundEmail(input: StoreInboundEmailInput): Promise<{ id: string; deduped: boolean }> {
  const dedupeKey = input.internetMessageId ? `${input.mailboxId}:${input.internetMessageId}` : null

  const { data, error } = await supabaseService
    .from('inbound_email_messages')
    .insert({
      mailbox_id: input.mailboxId,
      company_id: input.companyId ?? null,
      internet_message_id: input.internetMessageId ?? null,
      from_address: input.fromAddress ?? null,
      to_address: input.toAddress ?? null,
      subject: input.subject ?? null,
      received_at: input.receivedAt ?? nowIso(),
      raw_email: input.rawEmail ?? null,
      raw_edifact_payload: input.rawEdifactPayload ?? null,
      body_text: input.bodyText ?? null,
      body_html: input.bodyHtml ?? null,
      has_attachments: input.hasAttachments ?? false,
      processing_status: 'received',
      dedupe_key: dedupeKey,
      match_status: 'not_checked',
    })
    .select('id')
    .single()

  if (error) {
    const code = typeof error === 'object' && error && 'code' in error ? String((error as { code?: unknown }).code) : ''
    if (code === '23505' && input.internetMessageId) {
      const existing = await supabaseService
        .from('inbound_email_messages')
        .select('id')
        .eq('mailbox_id', input.mailboxId)
        .eq('internet_message_id', input.internetMessageId)
        .maybeSingle()

      if (existing.error) throw existing.error
      const id = (existing.data as { id?: string } | null)?.id
      if (id) return { id, deduped: true }
    }

    throw error
  }

  const id = (data as { id: string }).id

  await supabaseService.from('inbound_processing_jobs').insert({
    company_id: input.companyId ?? null,
    mailbox_id: input.mailboxId,
    inbound_email_message_id: id,
    status: 'queued',
    step: 'received',
    payload: { dedupeKey },
  })

  return { id, deduped: false }
}
