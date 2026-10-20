// Stuck-state detector for every work queue of the platform.
//
// stuck          — a row that should have moved on by itself (a cron, lease or
//                  retry would have taken it) and did not. Always a defect.
// needs_operator — a row that by design waits for a person (uncertain
//                  delivery, blocked send). A scenario declares which it expects.
//
// The rules encode the failure classes found by the live chain (FINDINGS F10,
// F18, F20–F23, B1). The same query is read-only and can run as a health check.
import { literal, sql } from '../live-chain-fixture'

export type StuckRow = { queue: string; rule: string; kind: 'stuck' | 'needs_operator'; count: number; oldest_seconds: number; sample: string[] }

export function stuckStateSql(input: { graceSeconds: number; companyIds?: string[] | null }) {
  const grace = `make_interval(secs => ${Number(input.graceSeconds)})`
  const scope = (column: string) => input.companyIds?.length
    ? `${column} = ANY(${literal(`{${input.companyIds.join(',')}}`)}::uuid[])` : 'true'
  const rule = (queue: string, name: string, kind: 'stuck' | 'needs_operator', from: string, at: string) => `
  SELECT ${literal(queue)} queue, ${literal(name)} rule, ${literal(kind)} kind, count(*)::int count,
    coalesce(extract(epoch FROM now() - min(${at}))::int, 0) oldest_seconds,
    coalesce((array_agg(x.id::text ORDER BY ${at}))[1:3], '{}') sample
  FROM ${from} HAVING count(*) > 0`
  return `SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.kind, r.queue, r.rule), '[]') FROM (
${[
    // F23: a stored mail whose processing job was never written.
    rule('inbound_email_messages', 'stored_without_job', 'stuck', `public.inbound_email_messages x
    WHERE ${scope('x.company_id')} AND x.processing_status='received' AND x.match_status='not_checked' AND x.created_at < now() - ${grace}
      AND NOT EXISTS (SELECT FROM public.inbound_processing_jobs j WHERE j.inbound_email_message_id = x.id)`, 'x.created_at'),
    // F21/F22: a job that no run advances.
    rule('inbound_processing_jobs', 'not_progressing', 'stuck', `public.inbound_processing_jobs x
    WHERE ${scope('x.company_id')} AND x.status IN ('queued','processing') AND x.updated_at < now() - ${grace}`, 'x.updated_at'),
    // F10: a received interchange that never got its technical acknowledgement.
    rule('ediel_messages', 'inbound_without_contrl', 'stuck', `public.ediel_messages x
    WHERE ${scope('x.company_id')} AND x.direction='inbound' AND x.message_family IN ('UTILTS','PRODAT') AND x.created_at < now() - ${grace}
      AND NOT EXISTS (SELECT FROM public.ediel_messages c WHERE c.related_message_id = x.id AND c.direction='outbound' AND c.message_family='CONTRL')`, 'x.created_at'),
    rule('ediel_outbox', 'queued_not_sent', 'stuck', `public.ediel_outbox x
    WHERE ${scope('x.company_id')} AND x.status IN ('prepared','queued') AND coalesce(x.queued_at, x.created_at) < now() - ${grace}`, 'coalesce(x.queued_at, x.created_at)'),
    rule('ediel_outbox', 'sending_lease_lost', 'stuck', `public.ediel_outbox x
    WHERE ${scope('x.company_id')} AND x.status='sending' AND x.locked_at < now() - ${grace}`, 'x.locked_at'),
    // F20: blocked by a send lock that is no longer held.
    rule('ediel_outbox', 'send_lock_released_still_blocked', 'stuck', `public.ediel_outbox x
    WHERE ${scope('x.company_id')} AND x.status='blocked' AND x.last_error='active_ediel_send_lock'
      AND NOT EXISTS (SELECT FROM public.ediel_send_locks l WHERE l.company_id = x.company_id
        AND coalesce(l.environment,'production') = coalesce(x.environment,'production') AND l.locked AND (l.expires_at IS NULL OR l.expires_at > now()))`, 'x.updated_at'),
    rule('ediel_outbox', 'blocked', 'needs_operator', `public.ediel_outbox x
    WHERE ${scope('x.company_id')} AND x.status IN ('blocked','blocked_tenant_state') AND x.last_error IS DISTINCT FROM 'active_ediel_send_lock'`, 'x.updated_at'),
    rule('ediel_outbox', 'delivery_uncertain', 'needs_operator', `public.ediel_outbox x
    WHERE ${scope('x.company_id')} AND x.status='delivery_uncertain'`, 'x.updated_at'),
    ...(['tenant_email_outbox', 'manual_email_outbox'] as const).flatMap(table => [
      rule(table, 'due_not_sent', 'stuck', `public.${table} x
    WHERE ${scope('x.company_id')} AND x.status IN ('queued','processing','sending') AND coalesce(x.next_attempt_at, x.created_at) < now() - ${grace}
      AND (x.locked_at IS NULL OR x.locked_at < now() - ${grace})`, 'coalesce(x.next_attempt_at, x.created_at)'),
      rule(table, 'delivery_uncertain', 'needs_operator', `public.${table} x WHERE ${scope('x.company_id')} AND x.status='delivery_uncertain'`, 'x.updated_at'),
      rule(table, 'blocked_tenant_state', 'needs_operator', `public.${table} x WHERE ${scope('x.company_id')} AND x.status='blocked_tenant_state'`, 'x.updated_at'),
    ]),
    rule('webhook_deliveries', 'due_not_delivered', 'stuck', `public.webhook_deliveries x
    WHERE ${scope('x.company_id')} AND ((x.status IN ('queued','failed') AND x.next_attempt_at < now() - ${grace})
      OR (x.status='processing' AND x.locked_at < now() - ${grace}))`, 'x.updated_at'),
    // F18: a billing run that no process owns any more.
    rule('billing_automation_runs', 'running_orphaned', 'stuck', `public.billing_automation_runs x
    WHERE ${scope('x.company_id')} AND x.status='running' AND x.started_at < now() - ${grace}`, 'x.started_at'),
    rule('customer_operation_jobs', 'not_progressing', 'stuck', `public.customer_operation_jobs x
    WHERE ${scope('x.company_id')} AND x.status IN ('queued','running') AND coalesce(x.heartbeat_at, x.updated_at) < now() - ${grace}`, 'x.updated_at'),
    rule('customer_operation_jobs', 'delivery_uncertain_or_review', 'needs_operator', `public.customer_operation_jobs x
    WHERE ${scope('x.company_id')} AND x.status IN ('delivery_uncertain','needs_review','blocked')`, 'x.updated_at'),
    rule('company_provisioning_jobs', 'not_progressing', 'stuck', `public.company_provisioning_jobs x
    WHERE ${scope('x.company_id')} AND ((x.status IN ('pending','retry') AND x.available_at < now() - ${grace})
      OR (x.status='processing' AND x.locked_at < now() - ${grace}))`, 'x.updated_at'),
    rule('canonical_event_outbox', 'not_progressing', 'stuck', `public.canonical_event_outbox x
    WHERE ${scope('x.company_id')} AND ((x.status='pending' AND x.available_at < now() - ${grace})
      OR (x.status='processing' AND x.claimed_at < now() - ${grace}))`, 'x.created_at'),
  ].join('\n  UNION ALL')}
) r`
}

export function detectStuckStates(input: { graceSeconds: number; companyIds?: string[] | null }): StuckRow[] {
  return sql<StuckRow[]>(stuckStateSql(input))
}
