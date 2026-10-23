// World access for reality scenario J4 (parse conformance): the grid owner sends exact attachment bytes over SMTPS
// (local GreenMail, TLS verified), and read-only SELECTs show what the platform stored and shows for each mail.
// Nothing here writes market or mail state. Synthetic data only.
import nodemailer from 'nodemailer'
import { LIVE, literal, sql } from '../live-chain-fixture'
import { platformMailboxFor } from '../../reality/simulators/platformMailbox'
import { j4MailOptions, type J4File } from './parseConformanceWire'

/**
 * One mail per file, with a known Message-ID; the attachment is exactly `file.bytes` (base64 transfer encoding).
 * Addressed to the platform's shared Ediel mailbox of the file's own lane (its UNB test indicator; FINDINGS T7).
 */
export async function sendJ4File(input: { from: string; file: J4File; run: string }): Promise<string> {
  const options = j4MailOptions({ from: input.from, to: platformMailboxFor(input.file.edifact), file: input.file, run: input.run })
  const transport = nodemailer.createTransport({ host: LIVE.mailHost, port: LIVE.smtpsPort, secure: true, requireTLS: true,
    auth: { user: input.from, pass: 'grid-owner-local' }, tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } })
  await transport.sendMail(options)
  transport.close()
  return options.messageId
}

export type J4Stored = {
  messageId: string
  mail: { id: string; company: string | null; status: string | null; match: string | null; error: string | null; payload: string | null } | null
  jobs: Array<{ status: string; attempts: number; error: string | null }>
  parse: { family: string | null; code: string | null; sender: string | null; receiver: string | null; interchange: string | null; raw: string | null
    payload: Record<string, unknown> } | null
  messages: Array<{ id: string; family: string; code: string | null; status: string | null; processing: string | null; sender: string | null; receiver: string | null
    interchange: string | null; external: string | null; raw: string | null; payload: Record<string, unknown> | null; ackOutcome: string | null
    related: string | null; failure: string | null; contrl: string | null; aperak: string | null }>
  tasks: Array<{ type: string; title: string; description: string | null; metadata: Record<string, unknown> | null }>
}

/** Everything the platform stored for one submitted mail (by RFC Message-ID). */
export function storedForMail(messageId: string): J4Stored {
  return sql<J4Stored>(`WITH m AS (SELECT * FROM public.inbound_email_messages WHERE internet_message_id=${literal(messageId)} ORDER BY created_at LIMIT 1)
    SELECT jsonb_build_object('messageId',${literal(messageId)},
      'mail',(SELECT jsonb_build_object('id',m.id,'company',m.company_id,'status',m.processing_status,'match',m.match_status,'error',left(m.error_message,500),'payload',m.raw_edifact_payload) FROM m),
      'jobs',(SELECT coalesce(jsonb_agg(jsonb_build_object('status',j.status,'attempts',j.attempts_count,'error',left(j.error_message,300)) ORDER BY j.created_at),'[]')
        FROM public.inbound_processing_jobs j WHERE j.inbound_email_message_id=(SELECT id FROM m)),
      'parse',(SELECT jsonb_build_object('family',p.message_family,'code',p.message_code,'sender',p.sender_ediel_id,'receiver',p.receiver_ediel_id,
          'interchange',p.interchange_reference,'raw',p.raw_payload,'payload',p.parsed_payload)
        FROM public.inbound_ediel_parse_results p WHERE p.inbound_email_message_id=(SELECT id FROM m) ORDER BY p.created_at DESC LIMIT 1),
      'messages',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'family',e.message_family,'code',e.message_code,'status',e.status,'processing',e.processing_status,
          'sender',e.sender_ediel_id,'receiver',e.receiver_ediel_id,'interchange',e.interchange_reference,'external',e.external_reference,'raw',e.raw_payload,
          'payload',e.parsed_payload,'ackOutcome',e.ack_outcome,'related',e.related_message_id,'failure',e.failure_reason,'contrl',e.contrl_status,'aperak',e.aperak_status)
          ORDER BY e.created_at),'[]')
        FROM public.ediel_messages e WHERE e.direction='inbound' AND e.inbound_email_message_id=(SELECT id FROM m)),
      'tasks',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',t.task_type,'title',t.title,'description',t.description,'metadata',t.metadata) ORDER BY t.created_at),'[]')
        FROM public.customer_operation_tasks t WHERE t.metadata->>'inboundEmailMessageId'=(SELECT id::text FROM m)))`)
}

/** A mail is settled when it left reception and no job is still queued/processing/retrying. */
export const j4Settled = (stored: J4Stored) => Boolean(stored.mail) && stored.mail!.status !== 'received'
  && stored.jobs.every(job => !['queued', 'processing', 'retry'].includes(job.status))

/** Our own sent Z01 for one facility (the original a correlated APERAK/CONTRL refers to), with its request state. */
export function sentZ01ForFacility(companyId: string, facility: string) {
  return sql<{ id: string; raw: string; sentAt: string | null; status: string; contrl: string | null; aperak: string | null; ack: string | null
    request: { status: string; failure: string | null } | null } | undefined>(`SELECT (SELECT jsonb_build_object('id',m.id,'raw',m.raw_payload,'sentAt',m.message_sent_at,'status',m.status,
      'contrl',m.contrl_status,'aperak',m.aperak_status,'ack',m.ack_outcome,
      'request',(SELECT jsonb_build_object('status',r.status,'failure',r.failure_reason) FROM public.grid_owner_data_requests r WHERE r.id=m.grid_owner_data_request_id))
    FROM public.ediel_messages m WHERE m.company_id=${literal(companyId)} AND m.direction='outbound' AND m.message_family='PRODAT' AND m.message_code='Z01'
      AND m.message_sent_at IS NOT NULL AND m.raw_payload LIKE ${literal(`%${facility}%`)} ORDER BY m.created_at DESC LIMIT 1)`) ?? null
}

/** Recursive subset comparison: every key of `expected` must equal the stored value (arrays compared element-wise). */
export function subsetMismatches(actual: unknown, expected: unknown, path = '$'): string[] {
  if (expected === null || typeof expected !== 'object') return Object.is(actual, expected) ? [] : [`${path}: expected ${JSON.stringify(expected)}, stored ${JSON.stringify(actual)}`]
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return [`${path}: expected array, stored ${JSON.stringify(actual)}`]
    if (actual.length !== expected.length) return [`${path}: expected ${expected.length} entries ${JSON.stringify(expected)}, stored ${JSON.stringify(actual)}`]
    return expected.flatMap((item, index) => subsetMismatches(actual[index], item, `${path}[${index}]`))
  }
  if (!actual || typeof actual !== 'object') return [`${path}: expected object, stored ${JSON.stringify(actual)}`]
  return Object.entries(expected as Record<string, unknown>).flatMap(([key, value]) => subsetMismatches((actual as Record<string, unknown>)[key], value, `${path}.${key}`))
}
