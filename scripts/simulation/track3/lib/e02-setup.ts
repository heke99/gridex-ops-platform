// EDIEL02: gemensam uppsättning för scenariofilerna (utfärdare, företagsbrevlåda, ren IMAP, SMTP-motpart i accept).
import { execFile } from 'node:child_process'
import { setSmtpMode } from './counterparty'
import { E02Flow, purgeInbox } from './e02-flow'
import { assertSingleAckRuntimeRow, ensureE02AckRouteProfile, ensureE02CompanyMailbox, registerE02Issuer, setE02MailboxActive } from './e02-seed'
import { Evidence } from './evidence'
import { ensureE02Tenant } from './e02-tenant'
import { dbUrl, newRunContext } from './seed.mjs'

export async function setupE02(label: string) {
  const run = newRunContext(label)
  const ev = new Evidence()
  const mode = (process.env.T3_MODE as 'test' | 'production') ?? 'test'
  const t0 = Date.now()
  const tenant = await ensureE02Tenant()
  registerE02Issuer()
  ensureE02AckRouteProfile(mode)
  assertSingleAckRuntimeRow(mode)
  const mailboxId = ensureE02CompanyMailbox(mode)
  setE02MailboxActive(mailboxId, true)
  await setSmtpMode('accept')
  const purged = await purgeInbox()
  const flow = new E02Flow(ev, mailboxId, mode)
  flow.durations.harness.push(Date.now() - t0)
  ev.observe('run', { ...run, tenant, mode, mailboxId, purgedImap: purged })
  // Diagnos: statements som varit aktiva > 2 s (pg_stat_activity, skrivskyddad) loggas separat i slow-statements.json.
  const slow = new Map<string, { firstSeen: string; maxMs: number; waitEvent: string | null; query: string }>()
  const sampler = setInterval(() => {
    execFile('psql', [dbUrl(), '-XAtq', '-F', '\u001f', '-c', `SELECT pid, EXTRACT(EPOCH FROM now()-query_start)*1000, coalesce(wait_event_type||':'||wait_event,''), left(regexp_replace(query,'\\s+',' ','g'),400)
      FROM pg_stat_activity WHERE datname='postgres' AND state='active' AND pid<>pg_backend_pid() AND now()-query_start > interval '2 seconds'`],
      { env: { ...process.env, PGPASSWORD: 'postgres' }, timeout: 5000 }, (err, out) => {
        if (err) return
        for (const line of out.split('\n').filter(Boolean)) {
          const [pid, ms, wait, query] = line.split('\u001f')
          const key = `${pid}:${query}`
          const cur = slow.get(key)
          slow.set(key, { firstSeen: cur?.firstSeen ?? new Date().toISOString(), maxMs: Math.max(cur?.maxMs ?? 0, Number(ms)), waitEvent: wait || null, query })
        }
      })
  }, 1500)
  const teardown = async () => {
    clearInterval(sampler)
    ev.save('slow-statements.json', [...slow.values()])
    await setSmtpMode('accept').catch(() => undefined)
    setE02MailboxActive(mailboxId, false)
    flow.finalizeDurations()
    ev.finalize()
  }
  return { run, ev, flow, mode, mailboxId, teardown }
}
