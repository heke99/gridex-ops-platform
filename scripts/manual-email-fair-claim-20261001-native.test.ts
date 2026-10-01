// Prepared full disposable Supabase proof; native execution is currently zero.
// Only EmailProvider.sendEmail is a controlled outer boundary. Real readiness,
// sender lookup, policy, PostgREST, row triggers, claims and completion stay real.
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ calls: 0, accepted: false }))
vi.mock('@/lib/email/providers', () => ({ getEmailProvider: () => ({ sendEmail: async () => {
  transport.calls++
  if (!transport.accepted) throw new Error('controlled_transport_not_dispatched')
  return { providerMessageId: 'synthetic-outer-acceptance-receipt', status: 'sent' as const }
} }) }))
import { processManualEmailOutbox } from '@/lib/email/manualEmailOutbox'

const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'"
const directory = mkdtempSync(join(process.env.RUNNER_TEMP!, 'manual-email-fair-native.'))
let sqlNumber = 0
afterAll(() => rmSync(directory, { recursive: true, force: true }))
function sql<T>(command: string): T {
  const result = spawnSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'],
    { input: command, encoding: 'utf8', timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })
  const log = join(directory, String(++sqlNumber) + '.log')
  writeFileSync(log, result.stdout + result.stderr, { mode: 0o600 })
  if (result.status !== 0 || result.error) {
    const code = result.stderr.match(/(?:ERROR|FATAL):\s+([A-Z0-9]{5})\b/)?.[1] ?? 'unknown'
    throw Object.assign(new Error('manual_email_native_sql_failed_private_context_' + code), { code })
  }
  return JSON.parse(result.stdout.trim()) as T
}
type Claim = { id: string; company_id: string; status: string; locked_by: string; claim_token: string; attempts: number }
const claim = (limit: number, company: string | null = null, worker = 'synthetic-manual-worker', token = randomUUID()) =>
  `SELECT coalesce(jsonb_agg(claimed.row),'[]'::jsonb) FROM public.gridex_claim_manual_email_outbox_fair_v1(${company ? quote(company) : 'null'}::uuid,${limit},${quote(worker)},${quote(token)}::uuid)claimed(row);`

// Hash every pre-existing physical public row and Auth row inside PostgreSQL;
// only counts/digests leave the process. Owned company-trigger legal history is
// retained until stack disposal and excluded explicitly after its creation.
function otherRows(companies: string[]): unknown {
  const list = companies.map(quote).join(',')
  return sql(`CREATE TEMP TABLE original_row_hashes(surface text PRIMARY KEY,rows bigint,digest text);
    DO $snapshot$ DECLARE t record; predicate text; BEGIN
      FOR t IN SELECT n.nspname,c.relname,c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
        WHERE c.relkind IN ('r','p') AND n.nspname IN ('public','auth','private') ORDER BY n.nspname,c.relname LOOP
        predicate := CASE WHEN t.nspname='public' AND t.relname='companies' THEN ' WHERE id NOT IN (${list})'
          WHEN EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=t.oid AND a.attname='company_id' AND NOT a.attisdropped)
          THEN ' WHERE company_id IS NULL OR company_id NOT IN (${list})' ELSE '' END;
        EXECUTE format('INSERT INTO original_row_hashes SELECT %L,count(*),encode(sha256(convert_to(coalesce(string_agg(to_jsonb(r)::text,E''\\n'' ORDER BY to_jsonb(r)::text),''''),''UTF8'')),''hex'') FROM %I.%I r%s',
          t.nspname||'.'||t.relname,t.nspname,t.relname,predicate);
      END LOOP;
    END $snapshot$;
    SELECT jsonb_agg(to_jsonb(h) ORDER BY surface) FROM original_row_hashes h;`)
}
function fixture(noisy = 250, quiet = 2) {
  // Wire before every manual-mail producer fixture. Prior queued or stale rows
  // are an explicit prerequisite failure; never reset another fixture's work.
  expect(sql<number>(`SELECT count(*)::int FROM public.manual_email_outbox
    WHERE (status='queued' AND external_delivery AND next_attempt_at<=clock_timestamp())
      OR (status='sending' AND locked_at<clock_timestamp()-interval '15 minutes');`)).toBe(0)
  const a = randomUUID(), b = randomUUID(), companies = [a, b], list = companies.map(quote).join(',')
  sql(`INSERT INTO public.companies(id,name,status) VALUES(${quote(a)},'Synthetic manual noisy','active'),(${quote(b)},'Synthetic manual quiet','active');
    UPDATE public.company_capabilities SET enabled=true,readiness_status='ready',
      configuration=jsonb_build_object('synthetic_controlled_outer_transport',true,'physical_delivery_qualified',false),last_verified_at=clock_timestamp()
      WHERE company_id IN (${list}) AND capability_code='email_outbound';
    SELECT to_jsonb(true);`)
  expect(sql<number>(`SELECT count(*)::int FROM public.company_capabilities WHERE company_id IN (${list})
    AND capability_code='email_outbound' AND enabled AND readiness_status='ready';`)).toBe(2)
  // Baseline after legitimate owned company/capability setup includes immutable
  // legal child rows without company_id. It must stay exact through business
  // calls and cleanup; no parent-less new history is falsely treated as old drift.
  const original = otherRows(companies)
  sql(`    INSERT INTO public.manual_email_outbox(company_id,to_email,actual_recipient_email,from_email,subject,body_html,external_delivery,idempotency_key,queued_at,next_attempt_at)
      SELECT ${quote(a)},'recipient@example.invalid','recipient@example.invalid','sender@example.invalid','Synthetic unsent','<p>Synthetic</p>',true,'synthetic-manual-A-'||g,'0001-01-01','0001-01-01' FROM generate_series(1,${noisy})g;
    INSERT INTO public.manual_email_outbox(company_id,to_email,actual_recipient_email,from_email,subject,body_html,external_delivery,idempotency_key,queued_at,next_attempt_at)
      SELECT ${quote(b)},'recipient@example.invalid','recipient@example.invalid','sender@example.invalid','Synthetic quiet','<p>Synthetic</p>',true,'synthetic-manual-B-'||g,'0002-01-01','0002-01-01' FROM generate_series(1,${quiet})g;
    SELECT to_jsonb(true);`)
  expect(otherRows(companies)).toEqual(original)
  transport.calls = 0; transport.accepted = false
  return { a, b, list, original,
    snapshot: () => sql(`SELECT jsonb_build_object(
      'rows',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM public.manual_email_outbox o WHERE company_id IN (${list})),
      'claims',(SELECT jsonb_agg(to_jsonb(l)-'payload_sha256'||jsonb_build_object('payload_sha256',encode(payload_sha256,'hex')) ORDER BY item_id) FROM private.manual_email_dispatch_claims l WHERE company_id IN (${list})),
      'turns',(SELECT jsonb_agg(to_jsonb(t) ORDER BY queue_key,company_id) FROM private.manual_email_dispatch_tenant_turns t WHERE company_id IN (${list})));`),
    cleanup: () => {
      expect(otherRows(companies)).toEqual(original)
      sql(`DELETE FROM public.manual_email_outbox WHERE company_id IN (${list}) AND idempotency_key LIKE 'synthetic-manual-%';
        DELETE FROM private.manual_email_dispatch_tenant_turns WHERE company_id IN (${list});
        SELECT to_jsonb(true);`)
      expect(otherRows(companies)).toEqual(original)
    },
  }
}

function session(name: string) {
  const child = spawn('psql', [`${db}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'])
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', part => { stdout += part })
  child.stderr.setEncoding('utf8').on('data', part => { stderr += part })
  const done = new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? -1)) })
  return { child, done, output: () => stdout, preserve: () => writeFileSync(join(directory, name + '.log'), stdout + stderr, { mode: 0o600 }) }
}
async function until(predicate: () => boolean, marker: string) {
  const deadline = Date.now() + 12_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(marker)
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

describe.sequential('full local manual-mail fair claim and actual worker', () => {
  it('old global prefix starves quiet work; genuine SQL caps5, includes quiet and persists rotation', () => {
    const f = fixture()
    try {
      expect(sql<string[]>(`SELECT jsonb_agg(company_id) FROM(SELECT company_id FROM public.manual_email_outbox
        WHERE status='queued' AND external_delivery AND next_attempt_at<=clock_timestamp() ORDER BY queued_at LIMIT 250)old_prefix;`))
        .toEqual(Array(250).fill(f.a))
      const first = sql<Claim[]>(`SET ROLE service_role;${claim(1)}`)
      const second = sql<Claim[]>(`SET ROLE service_role;${claim(1)}`)
      expect(first.map(row => row.company_id)).toEqual([f.a]); expect(second.map(row => row.company_id)).toEqual([f.b])
      const batch = sql<Claim[]>(`SET ROLE service_role;${claim(25)}`)
      expect(batch.filter(row => row.company_id === f.a)).toHaveLength(5)
      expect(batch.filter(row => row.company_id === f.b)).toHaveLength(1)
      expect(batch.every(row => row.status === 'sending' && row.attempts === 0 && row.locked_by === 'synthetic-manual-worker')).toBe(true)
      console.log('MANUAL_EMAIL_FAIR_NATIVE_PASS quiet_included=true noisy_cap5=true persisted_rotation=true provider_calls0=true')
    } finally { f.cleanup() }
  })
  it('current paused tenant cannot consume claim slots while quiet active tenant progresses', () => {
    const f = fixture()
    try {
      sql(`UPDATE public.companies SET status='paused' WHERE id=${quote(f.a)};SELECT to_jsonb(true);`)
      const rows = sql<Claim[]>(`SET ROLE service_role;${claim(1)}`)
      expect(rows).toHaveLength(1); expect(rows[0].company_id).toBe(f.b)
      expect(sql<number>(`SELECT count(*)::int FROM public.manual_email_outbox WHERE company_id=${quote(f.a)} AND status='queued' AND attempts=0;`)).toBe(250)
      expect(transport.calls).toBe(0)
      console.log('MANUAL_EMAIL_POLICY_NATIVE_PASS paused_no_false_success=true quiet_progress=true provider_calls0=true')
    } finally { f.cleanup() }
  })
  it('actual PostgREST worker saves a fenced failure and due replay has no further effects', async () => {
    const f = fixture(1, 1)
    try {
      const result = await processManualEmailOutbox({ companyId: f.b, limit: 1 })
      expect(result).toMatchObject({ claimed: 1, sent: 0, failed: 1, deliveryUncertain: 0 })
      expect(transport.calls).toBe(1)
      expect(sql(`SELECT jsonb_build_object('status',status,'attempts',attempts,'locked_by',locked_by,'future_retry',next_attempt_at>clock_timestamp())
        FROM public.manual_email_outbox WHERE company_id=${quote(f.b)};`)).toEqual({ status: 'queued', attempts: 1, locked_by: null, future_retry: true })
      const before = f.snapshot(); const replay = await processManualEmailOutbox({ companyId: f.b, limit: 1 })
      expect(replay.claimed).toBe(0); expect(transport.calls).toBe(1); expect(f.snapshot()).toEqual(before)
      console.log('MANUAL_EMAIL_WORKER_NATIVE_PASS real_worker_policy_postgrest=true exact_attempt1=true saved_retry=true no_due_replay=true controlled_transport_only=true')
    } finally { f.cleanup() }
  })
  it('controlled acceptance plus genuine late SQL failure stays uncertain without automatic resend', async () => {
    const f = fixture(1, 1), fault = 'synthetic_manual_sent_fault_' + randomUUID().replaceAll('-', '')
    try {
      sql(`CREATE FUNCTION private.${fault}()RETURNS trigger LANGUAGE plpgsql AS $fault$BEGIN
        IF NEW.company_id=${quote(f.b)} AND NEW.status='sent'THEN RAISE EXCEPTION 'synthetic_late_manual_sent_failure'USING ERRCODE='P0001';END IF;RETURN NEW;END$fault$;
        CREATE TRIGGER ${fault} BEFORE UPDATE ON public.manual_email_outbox FOR EACH ROW EXECUTE FUNCTION private.${fault}();SELECT to_jsonb(true);`)
      transport.accepted = true
      expect(await processManualEmailOutbox({ companyId: f.b, limit: 1 })).toMatchObject({ claimed: 1, sent: 0, deliveryUncertain: 1 })
      expect(sql(`SELECT jsonb_build_object('status',status,'attempts',attempts,'next_attempt_at',next_attempt_at) FROM public.manual_email_outbox WHERE company_id=${quote(f.b)};`))
        .toEqual({ status: 'delivery_uncertain', attempts: 1, next_attempt_at: null })
      const before = f.snapshot(); expect((await processManualEmailOutbox({ companyId: f.b, limit: 1 })).claimed).toBe(0)
      expect(transport.calls).toBe(1); expect(f.snapshot()).toEqual(before)
      console.log('MANUAL_EMAIL_UNCERTAIN_NATIVE_PASS controlled_acceptance=true real_late_failure=true uncertain_saved=true no_auto_resend=true physical_delivery_NOT_PROVEN=true')
    } finally {
      sql(`DROP TRIGGER IF EXISTS ${fault} ON public.manual_email_outbox;DROP FUNCTION IF EXISTS private.${fault}();SELECT to_jsonb(true);`)
      f.cleanup()
    }
  })
  it('a genuine late turn trigger rolls the complete batch back', () => {
    const f = fixture(), fault = 'synthetic_manual_turn_fault_' + randomUUID().replaceAll('-', '')
    try {
      sql(`CREATE FUNCTION private.${fault}()RETURNS trigger LANGUAGE plpgsql AS $fault$BEGIN
        IF NEW.company_id IN (${f.list})THEN RAISE EXCEPTION 'synthetic_late_manual_turn_failure'USING ERRCODE='P0001';END IF;RETURN NEW;END$fault$;
        CREATE TRIGGER ${fault} BEFORE INSERT OR UPDATE ON private.manual_email_dispatch_tenant_turns FOR EACH ROW EXECUTE FUNCTION private.${fault}();SELECT to_jsonb(true);`)
      const before = f.snapshot()
      expect(() => sql(`SET ROLE service_role;${claim(25)}`)).toThrow('private_context_P0001')
      expect(f.snapshot()).toEqual(before); expect(transport.calls).toBe(0)
      console.log('MANUAL_EMAIL_ROLLBACK_NATIVE_PASS real_late_trigger=true rows_claims_turns_unchanged=true provider_calls0=true')
    } finally {
      sql(`DROP TRIGGER IF EXISTS ${fault} ON private.manual_email_dispatch_tenant_turns;DROP FUNCTION IF EXISTS private.${fault}();SELECT to_jsonb(true);`)
      f.cleanup()
    }
  })
  it('two genuine local business workers skip locked rows and commit distinct live claims', async () => {
    const f = fixture(), firstName = 'synthetic_manual_first_' + randomUUID().replaceAll('-', ''), first = session(firstName)
    const secondName = 'synthetic_manual_second_' + randomUUID().replaceAll('-', ''), second = session(secondName)
    try {
      first.child.stdin.write(`BEGIN;SET LOCAL ROLE service_role;${claim(1, null, 'synthetic-first-worker')}\n\\echo MANUAL_FIRST_CLAIM_HELD\n`)
      await until(() => first.output().includes('MANUAL_FIRST_CLAIM_HELD'), 'manual_first_claim_not_held')
      second.child.stdin.end(`SET ROLE service_role;${claim(1, null, 'synthetic-second-worker')}\n`)
      await until(() => sql<boolean>(`SELECT to_jsonb(EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity second
          JOIN pg_catalog.pg_stat_activity first ON first.application_name=${quote(firstName)}
          WHERE second.application_name=${quote(secondName)} AND second.wait_event_type='Lock'
            AND first.pid=ANY(pg_catalog.pg_blocking_pids(second.pid))));`),
        'manual_second_turn_did_not_wait')
      first.child.stdin.end('COMMIT;\n')
      expect(await first.done).toBe(0); expect(await second.done).toBe(0)
      const rows = (text: string): Claim[] => JSON.parse(text.split('\n').find(line => line.startsWith('['))!) as Claim[]
      const a = rows(first.output()), b = rows(second.output())
      expect(a).toHaveLength(1); expect(b).toHaveLength(1); expect(a[0].id).not.toBe(b[0].id)
      expect(sql<number>(`SELECT count(*)::int FROM public.manual_email_outbox WHERE company_id IN (${f.list}) AND status='sending';`)).toBe(2)
      expect(transport.calls).toBe(0)
      console.log('MANUAL_EMAIL_CONCURRENCY_NATIVE_PASS real_sessions2=true held_row_skip_locked=true distinct_claims2=true provider_calls0=true')
    } finally {
      for (const item of [first, second]) if (item.child.exitCode === null) item.child.kill('SIGTERM')
      await Promise.allSettled([first.done, second.done]); first.preserve(); second.preserve()
      f.cleanup()
    }
  })
})
