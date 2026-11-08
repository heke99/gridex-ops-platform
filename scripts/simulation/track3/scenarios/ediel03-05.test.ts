// EDIEL03.05: SLA-timer för en inkommande UTILTS E66 som väntar på ACK (30 min). Playwright används inte.
// Källan tas emot via kodens väg (createInboundEdielMessage) utan ACK-bearbetning (process:false) och timers skapas av
// createAckTimersForMessage. checkAckDeadlines({now}) körs med kontrollerad klocka vid due-11, due-9, due-4 och due+1 min.
// Mottagningstiden sätts 3 dygn bakåt (inbound_email_messages.received_at, deklarerad klockfixtur) så att de simulerade
// klockslagen ligger i det förflutna och inte kan flytta andra spårs framtida timers.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setSmtpMode } from '../lib/counterparty'
import { Evidence } from '../lib/evidence'
import { newRunContext } from '../lib/seed.mjs'
import { actor, eventsFor, seedInboundSource, type E03Source } from '../lib/e03-fixture'
import { seedWithRetry, sql, sqlJson, Timing } from '../lib/e03-steps'

const run = newRunContext('ediel03-05')
const evidence = new Evidence()
const timing = new Timing()
const seedLog: Array<Record<string, unknown>> = []
const MIN = 60_000
let src: E03Source
let receivedMs = 0, dueMs = 0

const timers = () => (sqlJson(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.timer_type),'[]') FROM public.ediel_sla_timers t WHERE t.ediel_message_id='${src.sourceMessageId}'`) as Array<Record<string, unknown>>)
const slaEvents = async () => (await eventsFor(src.sourceMessageId)).filter((e) => /SLA timer is now/.test(String(e.message)))
const iso = (ms: number) => new Date(ms).toISOString()

beforeAll(async () => { await setSmtpMode('accept'); evidence.observe('run', { ...run, id: 'EDIEL03.05' }) })
afterEach(async () => { await setSmtpMode('accept').catch(() => undefined) })
afterAll(async () => {
  await setSmtpMode('accept').catch(() => undefined)
  evidence.observe('seed_retries', seedLog)
  evidence.observe('timing', { totalsMs: timing.totals, log: timing.log })
  evidence.finalize()
})

describe('EDIEL03 deadlines, retry och återhämtning', () => {
  it('EDIEL03.05 fixture: inkommande väntar på ACK; timers skapas av createAckTimersForMessage; due_at = mottagning + 30 min', async () => {
    receivedMs = Math.floor((Date.now() - 3 * 24 * 60 * MIN) / 1000) * 1000
    src = await seedWithRetry(timing, 'seed-source', (a) => seedInboundSource({ prefix: run.prefix, seq: 1 + a * 100, receivedAt: new Date(receivedMs), process: false }), seedLog)
    const { getEdielMessageById } = await import('@/lib/ediel/db')
    const { createAckTimersForMessage } = await import('@/lib/ediel/sla/createAckTimers')
    const message = (await getEdielMessageById(src.sourceMessageId))!
    expect(Date.parse(message.message_received_at!)).toBe(receivedMs)
    const plan = await createAckTimersForMessage({ actorUserId: actor(), message })
    const rows = timers()
    evidence.save('timers-created.json', rows); evidence.save('timer-plan.json', plan)
    evidence.observe('plan', plan)
    expect(rows.map((r) => r.timer_type)).toEqual(['aperak_due', 'contrl_due'])
    dueMs = receivedMs + 30 * MIN
    for (const r of rows) {
      expect(Date.parse(String(r.due_at)), `${r.timer_type} due_at = mottagning + 30 min`).toBe(dueMs)
      expect(Date.parse(String(r.warning_at))).toBe(dueMs - 10 * MIN)
      expect(Date.parse(String(r.critical_at))).toBe(dueMs - 5 * MIN)
      expect(r.status).toBe('open')
    }
    // Ingen ACK finns som kan stänga timern.
    expect(Number(sql(`SELECT count(*) FROM public.ediel_messages WHERE related_message_id='${src.sourceMessageId}' AND direction='outbound'`))).toBe(0)
  })

  const stages: Array<{ label: string; offsetMin: number; expected: 'open' | 'warning' | 'critical' | 'expired'; eventsExpected: number }> = [
    { label: 'due-11', offsetMin: -11, expected: 'open', eventsExpected: 0 },
    { label: 'due-9', offsetMin: -9, expected: 'warning', eventsExpected: 2 },
    { label: 'due-4', offsetMin: -4, expected: 'critical', eventsExpected: 4 },
    { label: 'due+1', offsetMin: 1, expected: 'expired', eventsExpected: 6 },
  ]
  for (const st of stages) {
    it(`EDIEL03.05 checkAckDeadlines({now: ${st.label}}) -> ${st.expected}${st.expected === 'open' ? ' (ingen övergång)' : ' + event'}`, async () => {
      const { checkAckDeadlines } = await import('@/lib/ediel/sla/checkAckDeadlines')
      const now = iso(dueMs + st.offsetMin * MIN)
      const res = await timing.time('harness', `checkAckDeadlines ${st.label}`, () => checkAckDeadlines({ actorUserId: actor(), companyId: src.companyId, now }))
      const rows = timers(); const ev = await slaEvents()
      evidence.save(`${st.label}/result-and-timers.json`, { now, res, rows })
      evidence.save(`${st.label}/events.json`, ev)
      evidence.observe(`stage_${st.label}`, { now, res, statuses: rows.map((r) => [r.timer_type, r.status]), slaEvents: ev.map((e) => [e.event_type, e.event_status, e.message]) })
      for (const r of rows) expect(r.status, `${r.timer_type} vid ${st.label}`).toBe(st.expected)
      expect(ev).toHaveLength(st.eventsExpected)
      if (st.expected !== 'open') {
        const last = ev.filter((e) => String(e.message) === `Ediel SLA timer is now ${st.expected}.`)
        expect(last).toHaveLength(2)
        expect(last.every((e) => e.event_status === (st.expected === 'expired' ? 'error' : 'warning'))).toBe(true)
      }
      if (st.expected === 'warning') expect(res.warning).toBeGreaterThanOrEqual(2)
      if (st.expected === 'critical') expect(res.critical).toBeGreaterThanOrEqual(2)
      if (st.expected === 'expired') expect(res.expired).toBeGreaterThanOrEqual(2)
    })
  }

  it('EDIEL03.05 idempotens: ny körning efter utgång ger inga nya övergångshändelser; observation om cron-routen', async () => {
    const { checkAckDeadlines } = await import('@/lib/ediel/sla/checkAckDeadlines')
    const before = (await slaEvents()).length
    await checkAckDeadlines({ actorUserId: actor(), companyId: src.companyId, now: iso(dueMs + 2 * MIN) })
    expect(timers().every((r) => r.status === 'expired')).toBe(true)
    expect((await slaEvents()).length).toBe(before)
    // Cron-routen (app/api/internal/customer-operations/cron/route.ts) anropar checkAckDeadlines utan `now`.
    // Utan att flytta systemklockan kan bara 'expired' provas (timer med mottagning i det förflutna). Routen kräver dessutom
    // CUSTOMER_OPERATION_CRON_SECRET eller CRON_SECRET, som saknas i track3.env -> loggas, inget anrop med extern effekt.
    const envHas = { CUSTOMER_OPERATION_CRON_SECRET: Boolean(process.env.CUSTOMER_OPERATION_CRON_SECRET), CRON_SECRET: Boolean(process.env.CRON_SECRET) }
    const base = process.env.T3_APP_URL ?? `http://127.0.0.1:${process.env.T3_APP_PORT}`
    const probe = await fetch(`${base}/api/internal/customer-operations/cron`, { method: 'POST', headers: { authorization: `Bearer ${process.env.EDIEL_CRON_SECRET}` } })
    evidence.observe('cron_route_path', {
      routeCallsCheckAckDeadlinesWithNow: false, file: 'app/api/internal/customer-operations/cron/route.ts', testProcessEnvHasRouteSecret: envHas,
      httpWithEdielCronSecret: probe.status, conclusion: probe.status === 401 ? 'routen avvisar track3:s hemligheter (route-secret ej konfigurerad i appens miljö): cron-vägen kan inte provas via HTTP utan harnessändring' : 'routen nåbar',
    })
    expect(probe.status === 401 || probe.status === 200).toBe(true)
  })
})
