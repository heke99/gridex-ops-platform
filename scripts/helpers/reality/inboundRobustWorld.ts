// Read-only world readers for reality scenario J3 (inbound Ediel robustness). Every reader is a single SELECT
// against the owned local Supabase; nothing here writes market or mail state. Synthetic data only.
import { literal, readInbox, sql } from '../live-chain-fixture'

export type MailOutcome = {
  messageId: string
  rows: Array<{ id: string; company: string | null; status: string | null; match: string | null; error: string | null; attachments: number
    payload: boolean; jobs: Array<{ status: string; step: string | null; attempts: number; error: string | null }> }>
}

/** What became of each submitted mail (by RFC Message-ID): mail rows, attachments and processing jobs. */
export function mailOutcomes(messageIds: string[]): MailOutcome[] {
  if (messageIds.length === 0) return []
  const rows = sql<Array<Record<string, unknown>>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('messageId',m.internet_message_id,'id',m.id,'company',m.company_id,
      'status',m.processing_status,'match',m.match_status,'error',left(m.error_message,300),'payload',m.raw_edifact_payload IS NOT NULL,
      'attachments',(SELECT count(*) FROM public.inbound_email_attachments a WHERE a.inbound_email_message_id=m.id),
      'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('status',j.status,'step',j.step,'attempts',j.attempts_count,'error',left(j.error_message,300)) ORDER BY j.created_at),'[]')
        FROM public.inbound_processing_jobs j WHERE j.inbound_email_message_id=m.id)) ORDER BY m.created_at),'[]')
    FROM public.inbound_email_messages m WHERE m.internet_message_id IN (${messageIds.map(literal).join(',')})`)
  return messageIds.map(messageId => ({ messageId, rows: rows.filter(row => row.messageId === messageId) as MailOutcome['rows'] }))
}

/** A mail is settled when every row left reception and no job is still queued/processing/retrying. */
export const settled = (outcome: MailOutcome) => outcome.rows.length > 0 && outcome.rows.every(row =>
  row.status !== 'received' && row.jobs.every(job => !['queued', 'processing', 'retry'].includes(job.status)))

/** Inbound Ediel originals created for these interchange references, with their routing and ACK state. */
export function inboundOriginals(references: string[], since: string) {
  if (references.length === 0) return []
  return sql<Array<{ reference: string; company: string | null; family: string; status: string; processing: string | null; contrl: string | null; aperak: string | null }>>(
    `SELECT coalesce(jsonb_agg(jsonb_build_object('reference',m.interchange_reference,'company',m.company_id,'family',m.message_family,'status',m.status,
      'processing',m.processing_status,'contrl',m.contrl_status,'aperak',m.aperak_status) ORDER BY m.created_at),'[]')
    FROM public.ediel_messages m WHERE m.direction='inbound' AND m.created_at>${literal(since)} AND m.interchange_reference IN (${references.map(literal).join(',')})`)
}

/** CONTRL the platform actually sent to the grid owner's mailbox, by acknowledged interchange (UCI/0020) and action (UCI/0083). */
export async function contrlReceivedByGridOwner(gridOwnerEmail: string) {
  const inbox = await readInbox(gridOwnerEmail)
  return inbox.flatMap(mail => mail.attachments).filter(a => /UNH\+[^+]*\+CONTRL/.test(a.text)).map(a => {
    const uci = /UCI\+([^+']+)\+[^+']*\+[^+']*\+([^+':]+)/.exec(a.text)
    return { sender: /UNB\+[^+]+\+([^:+]+)/.exec(a.text)?.[1] ?? null, acknowledged: uci?.[1] ?? null, action: uci?.[2] ?? null }
  })
}

/** Poll runs since the scenario started: counts and per-mailbox errors (what /admin/inbound-mail shows). */
export function pollRunsSince(since: string) {
  return sql<Array<{ status: string; fetched: number; stored: number; deduped: number; failedJobs: number; errors: unknown }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'status',status,'fetched',fetched_messages,'stored',stored_emails,'deduped',deduped_emails,'failedJobs',failed_jobs,'errors',errors_by_mailbox) ORDER BY started_at),'[]')
    FROM public.ediel_inbound_poll_runs WHERE started_at>${literal(since)} AND environment='test'`)
}

/** The shared test mailbox's own state: last error and the per-message storage attempts (J3-04). */
export function sharedMailboxState() {
  return sql<{ lastError: string | null; lockedAt: string | null; storeAttempts: Record<string, { attempts: number; dead_lettered_at?: string; last_error?: string }> }>(
    `SELECT jsonb_build_object('lastError',last_error,'lockedAt',locked_at,'storeAttempts',coalesce(metadata->'ediel_store_attempts','{}'))
     FROM public.ediel_mailboxes WHERE company_id IS NULL AND environment='test' ORDER BY created_at LIMIT 1`)
}

/** Normalized values stored for a metering point from inbound sources newer than `since` (exactly-once effects). */
export function valuesSince(meteringPointId: string, since: string) {
  return sql<{ current: number; superseded: number; sources: number }>(`SELECT jsonb_build_object(
      'current',count(*) FILTER (WHERE v.revision_status='current'),'superseded',count(*) FILTER (WHERE v.revision_status<>'current'),
      'sources',count(DISTINCT v.source_message_id))
    FROM public.normalized_metering_values v WHERE v.metering_point_id=${literal(meteringPointId)} AND v.created_at>${literal(since)}`)
}
