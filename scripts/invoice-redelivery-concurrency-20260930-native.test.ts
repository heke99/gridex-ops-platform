import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

const db = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
function sql(command: string) {
  return execFileSync('psql', [db, '-XAtq', '-v', 'ON_ERROR_STOP=1'], { input: command, encoding: 'utf8', timeout: 15_000 }).trim()
}
function session(role: string) {
  // PostgreSQL truncates application_name at 63 bytes; assert the exact name
  // used by both wait observation and the specific blocking PID assertion.
  const name = `redelivery_${role}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
  if (Buffer.byteLength(name) > 63) throw new Error('native_redelivery_application_name_too_long')
  const child = spawn('psql', [`${db}?application_name=${name}`, '-XAtq', '-v', 'ON_ERROR_STOP=1'])
  let stdout = '', stderr = ''
  child.stdout.setEncoding('utf8').on('data', part => { stdout += part })
  child.stderr.setEncoding('utf8').on('data', part => { stderr += part })
  const exited = new Promise<number>((resolveExit, reject) => {
    child.once('error', reject); child.once('exit', code => resolveExit(code ?? -1))
  })
  return { name, child, exited, output: () => ({ stdout, stderr }) }
}
async function until(predicate: () => boolean, reason: string) {
  const deadline = Date.now() + 15_000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(reason)
    await new Promise(resolveWait => setTimeout(resolveWait, 75))
  }
}
type Command = {
  companyId: string; customerId: string; invoiceId: string; accountId: string; actorUserId: string; sessionId: string
  expectedRevision: number; expectedOverrideRevision: number; idempotencyKey: string; reason: string
}
function seed(): Command {
  if (!process.env.GRIDEX_NATIVE_STATUS || process.env.CI !== 'true') throw new Error('disposable_ci_replay_only')
  // Reuse only the frozen full-history fixture's authentic seed/profile-change
  // prefix. Do not duplicate its single-session assertions or change that file.
  const source = readFileSync(resolve(__dirname, 'invoice-redelivery-decision-20260930-native.sql'), 'utf8')
  const marker = '  decision:=public.gridex_record_invoice_redelivery_decision_v1(command);'
  const boundary = source.indexOf(marker)
  if (boundary < 0 || !source.includes('begin;') || !source.includes('do $proof$')) {
    throw new Error('frozen_redelivery_native_seed_boundary_missing')
  }
  const output = sql(source.slice(0, boundary) + `
    perform set_config('gridex.redelivery.native_command',command::text,true);
  end;$proof$;
  select current_setting('gridex.redelivery.native_command');
  commit;`)
  const row = output.split('\n').filter(line => line.trim().startsWith('{')).at(-1)
  if (!row) throw new Error('redelivery_native_seed_command_missing')
  return { ...JSON.parse(row), idempotencyKey: `redelivery-two-sessions:${randomUUID()}` } as Command
}
function apply(command: Command) {
  return `select public.gridex_record_invoice_redelivery_decision_v1(${quote(JSON.stringify(command))}::jsonb);`
}
function keyLock(command: Command) {
  return `select pg_advisory_xact_lock(hashtextextended(${quote(`${command.companyId}:invoice-redelivery:${command.idempotencyKey}`)},0));`
}
function financialGraph(command: Command) {
  return JSON.parse(sql(`with invoice as (select * from public.customer_invoices where company_id=${quote(command.companyId)} and id=${quote(command.invoiceId)}),
    item as (select i.* from public.invoice_export_items i join invoice n on n.invoice_export_item_id=i.id and n.company_id=i.company_id)
    select jsonb_build_object('invoice',(select to_jsonb(n) from invoice n),'item',(select to_jsonb(i) from item i),
      'underlay',(select to_jsonb(u) from public.billing_underlays u join item i on i.billing_underlay_id=u.id and i.company_id=u.company_id),
      'pricing',(select to_jsonb(p) from public.pricing_runs p join item i on i.pricing_run_id=p.id and i.company_id=p.company_id),
      'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.customer_invoice_lines l where l.company_id=${quote(command.companyId)} and l.customer_id=${quote(command.customerId)} and l.invoice_id=${quote(command.invoiceId)}),'[]'),
      'documents',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.customer_invoice_documents d where d.company_id=${quote(command.companyId)} and d.customer_id=${quote(command.customerId)} and d.invoice_id=${quote(command.invoiceId)}),'[]'));`))
}
function effects(command: Command) {
  return JSON.parse(sql(`select jsonb_build_object(
    'decisions',coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.invoice_redelivery_decisions d
      where company_id=${quote(command.companyId)} and idempotency_key=${quote(command.idempotencyKey)}),'[]'),
    'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.domain_events e
      where company_id=${quote(command.companyId)} and idempotency_key=${quote(`invoice-redelivery-decision:${command.companyId}:${command.idempotencyKey}`)}),'[]'));`))
}
async function blocked(writer: ReturnType<typeof session>, blocker: ReturnType<typeof session>) {
  await until(() => sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity b
    on b.application_name=${quote(blocker.name)} where w.application_name=${quote(writer.name)} and w.wait_event_type='Lock'
    and b.pid=any(pg_blocking_pids(w.pid)));`) === 't', 'redelivery_specific_native_wait_not_observed')
}
function stop(...workers: Array<ReturnType<typeof session>>) {
  for (const worker of workers) if (worker.child.exitCode === null) worker.child.kill('SIGTERM')
}

it('T17 two real sessions return one decision/audit for one key and preserve the whole issued financial graph', async () => {
  const command = seed(), before = financialGraph(command)
  expect(effects(command)).toEqual({ decisions: [], events: [] })
  const first = session('first'), replay = session('replay')
  try {
    first.child.stdin.write(`begin; set local role service_role; ${apply(command)}
\\echo REDELIVERY_FIRST_DECISION_HELD\n`)
    await until(() => first.output().stdout.includes('REDELIVERY_FIRST_DECISION_HELD'), 'redelivery_first_decision_not_held')
    replay.child.stdin.end(`set role service_role; ${apply(command)}\n`)
    await blocked(replay, first)
    first.child.stdin.end('commit;\n')
    expect(await first.exited).toBe(0); expect(await replay.exited).toBe(0)
    const firstResult = JSON.parse(first.output().stdout.split('\n').find(line => line.startsWith('{'))!)
    const replayResult = JSON.parse(replay.output().stdout.split('\n').find(line => line.startsWith('{'))!)
    expect(firstResult.replayed).toBe(false); expect(replayResult.replayed).toBe(true)
    expect(replayResult.decisionId).toBe(firstResult.decisionId)
    const after = effects(command)
    expect(after.decisions).toHaveLength(1); expect(after.events).toHaveLength(1)
    expect(after.decisions[0].audit_event_id).toBe(after.events[0].id)
    expect(after.decisions[0].delivery_status).toBe('blocked_provider_adapter')
    expect(financialGraph(command)).toEqual(before)
    console.log('REDELIVERY_TWO_SESSION_IDEMPOTENCY_NATIVE_PASS decisions=1 audits=1 originalGraph=unchanged observedSpecificWait=true')
  } finally { stop(first, replay) }
})

it.each(['fresh', 'replay'] as const)('T17 %s decision waits for current-key ownership and denies a session revoked while waiting', async mode => {
  const command = seed(), before = financialGraph(command)
  if (mode === 'replay') sql(`set role service_role; ${apply(command)}`)
  const baseline = effects(command), revoker = session('revoker'), writer = session('revoked')
  try {
    revoker.child.stdin.write(`begin; ${keyLock(command)}
\\echo REDELIVERY_KEY_HELD\n`)
    await until(() => revoker.output().stdout.includes('REDELIVERY_KEY_HELD'), 'redelivery_revocation_key_not_held')
    writer.child.stdin.end(`set role service_role; ${apply(command)}\n`)
    await blocked(writer, revoker)
    revoker.child.stdin.end(`delete from auth.sessions where id=${quote(command.sessionId)} and user_id=${quote(command.actorUserId)};commit;\n`)
    expect(await revoker.exited).toBe(0); expect(await writer.exited).not.toBe(0)
    expect(writer.output().stderr).toContain('redelivery_actor_forbidden')
    expect(effects(command)).toEqual(baseline); expect(financialGraph(command)).toEqual(before)
    console.log(`REDELIVERY_REVOKED_SESSION_WAIT_NATIVE_PASS mode=${mode} effects=0 originalGraph=unchanged observedSpecificWait=true`)
  } finally { stop(revoker, writer) }
})

it.each(['fresh', 'replay'] as const)('T17 %s decision denies fresh Auth confirmation withdrawn while identity is locked', async mode => {
  const command = seed(), before = financialGraph(command)
  if (mode === 'replay') sql(`set role service_role; ${apply(command)}`)
  const baseline = effects(command), proof = session('proof'), writer = session('unverified')
  try {
    proof.child.stdin.write(`begin; update auth.users set email_confirmed_at=null where id=(select user_id from public.customer_portal_accounts
      where id=${quote(command.accountId)} and company_id=${quote(command.companyId)} and customer_id=${quote(command.customerId)});
\\echo REDELIVERY_PROOF_CHANGE_HELD\n`)
    await until(() => proof.output().stdout.includes('REDELIVERY_PROOF_CHANGE_HELD'), 'redelivery_proof_change_not_held')
    writer.child.stdin.end(`set role service_role; ${apply(command)}\n`)
    await blocked(writer, proof)
    proof.child.stdin.end('commit;\n')
    expect(await proof.exited).toBe(0); expect(await writer.exited).not.toBe(0)
    expect(writer.output().stderr).toContain('redelivery_destination_unverified')
    expect(effects(command)).toEqual(baseline); expect(financialGraph(command)).toEqual(before)
    console.log(`REDELIVERY_WITHDRAWN_AUTH_PROOF_WAIT_NATIVE_PASS mode=${mode} effects=0 originalGraph=unchanged observedSpecificWait=true`)
  } finally { stop(proof, writer) }
})

it('T17 waits for a real profile edit, rejects its stale revision and retains the original invoice graph', async () => {
  const command = seed(), before = financialGraph(command), baseline = effects(command)
  const editor = session('profile'), writer = session('stale')
  try {
    editor.child.stdin.write(`begin;set local role service_role;select id from public.customers where id=${quote(command.customerId)}
      and company_id=${quote(command.companyId)} for update;
\\echo REDELIVERY_PROFILE_HELD\n`)
    await until(() => editor.output().stdout.includes('REDELIVERY_PROFILE_HELD'), 'redelivery_profile_not_held')
    writer.child.stdin.end(`set role service_role; ${apply(command)}\n`)
    await blocked(writer, editor)
    const change = { companyId: command.companyId, customerId: command.customerId, mode: 'ops', actorUserId: command.actorUserId,
      sessionId: command.sessionId, reason: 'Native profile change while decision waits', expectedRevision: command.expectedRevision,
      idempotencyKey: `redelivery-profile-change:${randomUUID()}`, changes: { email: 'changed-while-waiting@example.invalid' } }
    editor.child.stdin.end(`select public.gridex_change_customer_billing_profile_v1(${quote(JSON.stringify(change))}::jsonb);commit;\n`)
    expect(await editor.exited).toBe(0); expect(await writer.exited).not.toBe(0)
    expect(writer.output().stderr).toContain('redelivery_revision_conflict')
    expect(effects(command)).toEqual(baseline); expect(financialGraph(command)).toEqual(before)
    console.log('REDELIVERY_PROFILE_REVISION_WAIT_NATIVE_PASS effects=0 originalGraph=unchanged observedSpecificWait=true')
  } finally { stop(editor, writer) }
})

it('T17 final live session clock expires during a real late-audit wait and rolls back decision and audit together', async () => {
  const command = seed(), before = financialGraph(command), baseline = effects(command)
  const blocker = session('audit'), writer = session('late')
  try {
    blocker.child.stdin.write(`begin;insert into public.domain_events(company_id,event_type,aggregate_type,aggregate_id,source,payload,idempotency_key)
      values(${quote(command.companyId)},'invoice.redelivery.decision_verified','invoice_redelivery_decision',${quote(randomUUID())},
        'native_redelivery_audit_blocker','{}',${quote(`invoice-redelivery-decision:${command.companyId}:${command.idempotencyKey}`)});
\\echo REDELIVERY_AUDIT_KEY_HELD\n`)
    await until(() => blocker.output().stdout.includes('REDELIVERY_AUDIT_KEY_HELD'), 'redelivery_audit_key_not_held')
    sql(`update auth.sessions set not_after=clock_timestamp()+interval '6 seconds' where id=${quote(command.sessionId)} and user_id=${quote(command.actorUserId)};`)
    writer.child.stdin.end(`set role service_role; ${apply(command)}\n`)
    await blocked(writer, blocker)
    await until(() => sql(`select not_after<=clock_timestamp() from auth.sessions where id=${quote(command.sessionId)};`) === 't', 'redelivery_final_session_clock_not_expired')
    blocker.child.stdin.end('rollback;\n')
    expect(await blocker.exited).toBe(0); expect(await writer.exited).not.toBe(0)
    expect(writer.output().stderr).toContain('redelivery_actor_forbidden')
    expect(effects(command)).toEqual(baseline); expect(financialGraph(command)).toEqual(before)
    console.log('REDELIVERY_LATE_AUDIT_CLOCK_NATIVE_PASS sessions=2 expiredAfterPreflight=true effects=0 originalGraph=unchanged observedSpecificWait=true')
  } finally { stop(blocker, writer) }
})
