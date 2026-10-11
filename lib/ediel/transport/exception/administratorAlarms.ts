// masterplan: TR-09, AT-TR-09
import 'server-only'
import {z} from 'zod'
import {supabaseService} from '@/lib/supabase/service'
import type {TransportExceptionCase} from '@/lib/ediel/transport/exception/source'

/** T A.3.2.1: the reserve procedures (recipient certificate unavailable after an
 * empty X.500 search, and a failed CRL refresh using the previous signed CRL)
 * must alarm the administrator. The protected journal row is written in the
 * same transaction as the bounded operation; this loader is the administrator
 * consumer. The native RPC re-checks the current active member and
 * communication.write for exactly this company, so caller-side guards never
 * substitute for it. Errors propagate: an unreadable feed is never "no alarms". */
const reserveCases: readonly TransportExceptionCase[] = ['temporary_encryption_failure', 'recipient_certificate_unavailable', 'crl_refresh_failure']
const alarmRow = z.object({
  id: z.string().uuid(),
  attemptId: z.string().uuid(),
  messageId: z.string().uuid(),
  responsibleUserId: z.string().uuid(),
  createdAt: z.string().min(1),
  facts: z.object({
    case: z.string().min(1),
    validTo: z.string().nullable().optional(),
    mandatoryTls: z.literal(true),
    administratorAlarm: z.literal(true),
  }).passthrough(),
}).strict()

export type EdielTransportExceptionAlarm = {
  id: string
  attemptId: string
  messageId: string
  responsibleUserId: string
  createdAt: string
  reserveCase: string
  /** An unknown case is still shown; hiding an alarm would be the worse failure. */
  knownReserveCase: boolean
  validTo: string | null
}

export async function readEdielTransportExceptionAlarms(input: {companyId: string; actorUserId: string}): Promise<EdielTransportExceptionAlarm[]> {
  const companyId = z.string().uuid().parse(input.companyId)
  const actorUserId = z.string().uuid().parse(input.actorUserId)
  const {data, error} = await supabaseService.rpc('ediel_transport_exception_alarms_v1', {p_company_id: companyId, p_actor_user_id: actorUserId})
  if (error) throw error
  const rows = z.array(alarmRow).max(100).parse(data)
  const ids = new Set<string>()
  return rows.map((row) => {
    // One alarm per bounded operation attempt; a repeated id is a contract break.
    if (ids.has(row.attemptId)) throw new Error('ediel_transport_exception_alarm_duplicate_attempt')
    ids.add(row.attemptId)
    return {
      id: row.id,
      attemptId: row.attemptId,
      messageId: row.messageId,
      responsibleUserId: row.responsibleUserId,
      createdAt: row.createdAt,
      reserveCase: row.facts.case,
      knownReserveCase: (reserveCases as readonly string[]).includes(row.facts.case),
      validTo: row.facts.validTo ?? null,
    }
  })
}
