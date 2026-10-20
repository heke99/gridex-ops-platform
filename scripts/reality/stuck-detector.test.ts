// The stuck-state detector must fire exactly the rule a planted row breaks,
// and nothing for rows that are in order. Rows are planted with triggers off
// inside a rolled-back transaction: this proves the query against the real
// schema, not the queues' own write rules.
import { describe, expect, it } from 'vitest'
import { sql } from '../helpers/live-chain-fixture'
import { stuckStateSql, type StuckRow } from '../helpers/reality/stuckDetector'

const company = '00000000-0000-4000-8000-00000000c0de'

/** INSERT that fills every NOT NULL column without default with a typed dummy, then applies overrides. */
function plant(table: string, overrides: Record<string, string>) {
  return `DO $plant$ DECLARE cols text:=''; vals text:=''; c record; BEGIN
  FOR c IN SELECT a.attname, format_type(a.atttypid,a.atttypmod) t FROM pg_attribute a
    WHERE a.attrelid='public.${table}'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attnotnull AND a.attgenerated=''
      AND NOT EXISTS (SELECT FROM pg_attrdef d WHERE d.adrelid=a.attrelid AND d.adnum=a.attnum) LOOP
    cols:=cols||quote_ident(c.attname)||','; vals:=vals||CASE WHEN c.t='uuid' THEN 'gen_random_uuid()' WHEN c.t LIKE 'timestamp%' THEN 'now()'
      WHEN c.t IN ('integer','bigint','smallint','numeric') THEN '0' WHEN c.t='boolean' THEN 'false' WHEN c.t LIKE 'json%' THEN '''{}''' ELSE '''x''' END||',';
  END LOOP;
  EXECUTE format('CREATE TEMP TABLE IF NOT EXISTS planted_ids(id uuid)');
  EXECUTE format('WITH r AS (INSERT INTO public.${table}(%s) VALUES(%s) RETURNING id) INSERT INTO planted_ids SELECT id FROM r', rtrim(cols,','), rtrim(vals,','));
  ${Object.entries(overrides).map(([column, value]) => `EXECUTE 'UPDATE public.${table} SET ${column}=' || ${`$v$${value}$v$`} || ' WHERE id IN (SELECT id FROM planted_ids)';`).join('\n  ')}
  DELETE FROM planted_ids;
END $plant$;`
}

function detectWith(setup: string): StuckRow[] {
  return sql<StuckRow[]>(`BEGIN; SET LOCAL session_replication_role=replica;
${setup}
${stuckStateSql({ graceSeconds: 600, companyIds: [company] })};
ROLLBACK;`)
}

const old = `now() - interval '2 hours'`
const recent = `now() - interval '1 minute'`
const base = { company_id: `'${company}'` }

describe('stuck-state detector against the replayed schema', () => {
  it('reports nothing for an empty scope', () => {
    expect(detectWith('')).toEqual([])
  })

  it.each([
    ['inbound_email_messages', 'stored_without_job', 'stuck', { ...base, processing_status: `'received'`, match_status: `'not_checked'`, created_at: old }],
    ['inbound_processing_jobs', 'not_progressing', 'stuck', { ...base, status: `'queued'`, updated_at: old }],
    ['ediel_outbox', 'queued_not_sent', 'stuck', { ...base, status: `'queued'`, queued_at: old, created_at: old }],
    ['ediel_outbox', 'sending_lease_lost', 'stuck', { ...base, status: `'sending'`, locked_at: old }],
    ['ediel_outbox', 'send_lock_released_still_blocked', 'stuck', { ...base, status: `'blocked'`, last_error: `'active_ediel_send_lock'`, environment: `'production'` }],
    ['ediel_outbox', 'delivery_uncertain', 'needs_operator', { ...base, status: `'delivery_uncertain'` }],
    ['tenant_email_outbox', 'due_not_sent', 'stuck', { ...base, status: `'queued'`, next_attempt_at: old, created_at: old }],
    ['manual_email_outbox', 'delivery_uncertain', 'needs_operator', { ...base, status: `'delivery_uncertain'` }],
    ['webhook_deliveries', 'due_not_delivered', 'stuck', { ...base, status: `'queued'`, next_attempt_at: old }],
    ['billing_automation_runs', 'running_orphaned', 'stuck', { ...base, status: `'running'`, started_at: old }],
    ['customer_operation_jobs', 'not_progressing', 'stuck', { ...base, status: `'queued'`, updated_at: old, heartbeat_at: old }],
    ['company_provisioning_jobs', 'not_progressing', 'stuck', { ...base, status: `'pending'`, available_at: old }],
    ['canonical_event_outbox', 'not_progressing', 'stuck', { ...base, status: `'pending'`, available_at: old, created_at: old }],
  ] as const)('%s / %s', (table, rule, kind, overrides) => {
    const rows = detectWith(plant(table, overrides))
    expect(rows.map(r => [r.queue, r.rule, r.kind, r.count])).toEqual([[table, rule, kind, 1]])
  })

  it('does not flag work that is still inside its grace period or already done', () => {
    expect(detectWith([
      plant('inbound_processing_jobs', { ...base, status: `'queued'`, updated_at: recent }),
      plant('ediel_outbox', { ...base, status: `'sent'`, queued_at: old, created_at: old }),
      plant('billing_automation_runs', { ...base, status: `'completed'`, started_at: old }),
    ].join('\n'))).toEqual([])
  })

  it('does not flag a send-lock block while the lock is still held', () => {
    expect(detectWith([
      plant('ediel_outbox', { ...base, status: `'blocked'`, last_error: `'active_ediel_send_lock'`, environment: `'production'` }),
      `INSERT INTO public.ediel_send_locks(company_id,environment,lock_key,locked,status) VALUES('${company}','production','reality-lock',true,'active');`,
    ].join('\n'))).toEqual([])
  })
})
