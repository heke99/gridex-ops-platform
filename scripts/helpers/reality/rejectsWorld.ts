// World pieces for reality scenario I (the grid owner rejects or stays silent): the rejecting grid-owner
// process, read-only state readers, and the operator's own UI steps. Synthetic data only.
import { spawn, type ChildProcess } from 'node:child_process'
import type { BrowserContext } from '@playwright/test'
import { literal, sql } from '../live-chain-fixture'
import { submitServerAction } from './operatorConsole'
import { freePort } from './world'
import type { GridOwnerAnswerPlan } from './rejectsWire'

export type RejectingGridOwner = {
  url: string; edielId: string; email: string
  state: () => Promise<{ received: Array<Record<string, string>>; sent: Array<Record<string, string>>; failures: Array<{ error: string }>; pendingSends: number }>
  plan: (plans: Record<string, GridOwnerAnswerPlan>) => Promise<void>
  stop: () => void
}

/** The rejecting grid owner as its own OS process on the grid owner's mailbox (scripts/reality/simulators/gridOwnerRejects.ts). */
export async function startRejectingGridOwner(input: { edielId: string; email: string; pollMs?: number; stepMs?: number }): Promise<RejectingGridOwner> {
  const port = await freePort()
  const child: ChildProcess = spawn('npx', ['tsx', 'scripts/reality/simulators/gridOwnerRejects.ts'], {
    env: { ...process.env, REALITY_GRID_OWNER_EDIEL_ID: input.edielId, REALITY_GRID_OWNER_EMAIL: input.email, REALITY_GRID_OWNER_PORT: String(port),
      REALITY_GRID_OWNER_POLL_MS: String(input.pollMs ?? 10_000), REALITY_GRID_OWNER_STEP_MS: String(input.stepMs ?? 15_000) },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  const output: string[] = []
  child.stdout?.on('data', chunk => output.push(String(chunk)))
  child.stderr?.on('data', chunk => output.push(String(chunk)))
  for (let i = 0; ; i += 1) {
    if (output.join('').includes('control on')) break
    if (child.exitCode !== null || i > 120) throw Error(`rejecting_grid_owner_start_failed:${output.join('').slice(-500)}`)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const url = `http://127.0.0.1:${port}`
  const call = async (path: string, body?: unknown) => (await fetch(url + path, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })).json()
  return { url, edielId: input.edielId, email: input.email, state: () => call('/__sim/state'), plan: async plans => { await call('/__sim/plan', plans) },
    stop: () => { if (child.pid) try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ } } }
}

export type SwitchState = { facility: string; switchId: string; status: string; failureReason: string | null; z04: boolean; outbound: string | null
  z03: Array<{ id: string; status: string; contrl: string | null; aperak: string | null; ackDue: string | null; canonical: string | null; document: string | null; li: string | null }>
  events: Array<{ type: string; status: string; message: string }>; periods: Array<{ status: string; start: string }> }

/** Per facility of the tenant: every switch request (newest first), its Z03 originals, events and supply periods. Read-only. */
export function switchStates(companyId: string): SwitchState[] {
  return sql<SwitchState[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('facility',mp.metering_point_id,'switchId',s.id,'status',s.status,'failureReason',s.failure_reason,
      'z04',s.inbound_z04_message_id IS NOT NULL,'outbound',(SELECT o.status FROM public.outbound_requests o WHERE o.source_id=s.id ORDER BY o.created_at DESC LIMIT 1),
      'z03',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'status',m.status,'contrl',m.contrl_status,'aperak',m.aperak_status,'ackDue',m.ack_due_at,
          'canonical',(SELECT v.canonical_ack_state FROM public.ediel_message_ack_state_v v WHERE v.id=m.id),
          'document',substring(m.raw_payload from 'BGM\\+Z03\\+([^+'']+)'),'li',substring(m.raw_payload from 'RFF\\+LI:([^'']+)')) ORDER BY m.created_at),'[]')
        FROM public.ediel_messages m WHERE m.company_id=s.company_id AND m.switch_request_id=s.id AND m.direction='outbound' AND m.message_code='Z03'),
      'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',e.event_type,'status',e.event_status,'message',e.message) ORDER BY e.created_at),'[]') FROM public.supplier_switch_events e WHERE e.switch_request_id=s.id),
      'periods',(SELECT coalesce(jsonb_agg(jsonb_build_object('status',p.status,'start',p.start_date)),'[]') FROM public.customer_supply_periods p WHERE p.company_id=s.company_id AND p.metering_point_id=s.metering_point_id))
    ORDER BY mp.metering_point_id, s.created_at DESC),'[]')
    FROM public.supplier_switch_requests s JOIN public.metering_points mp ON mp.id=s.metering_point_id WHERE s.company_id=${literal(companyId)}`)
}

export type DataRequestState = { facility: string | null; status: string; failureReason: string | null
  z01: Array<{ status: string; contrl: string | null; canonical: string | null; overdueAt: string | null }>; overdueEvents: number }
/** Per Z01 (customer/facility request): the grid-owner data request, the Z01 and the Z01 watchdog's operator events. Read-only. */
export function dataRequestStates(companyId: string): DataRequestState[] {
  return sql<DataRequestState[]>(`SELECT coalesce(jsonb_agg(jsonb_build_object('facility',(SELECT mp.metering_point_id FROM public.metering_points mp WHERE mp.id=m.metering_point_id),
      'status',r.status,'failureReason',r.failure_reason,
      'z01',jsonb_build_array(jsonb_build_object('status',m.status,'contrl',m.contrl_status,'canonical',(SELECT v.canonical_ack_state FROM public.ediel_message_ack_state_v v WHERE v.id=m.id),'overdueAt',m.response_overdue_at)),
      'overdueEvents',(SELECT count(*) FROM public.customer_operation_events e WHERE e.company_id=m.company_id AND e.idempotency_key='z01-response-overdue:'||m.id::text)) ORDER BY m.created_at),'[]')
    FROM public.ediel_messages m LEFT JOIN public.grid_owner_data_requests r ON r.id=m.grid_owner_data_request_id
    WHERE m.company_id=${literal(companyId)} AND m.direction='outbound' AND m.message_family='PRODAT' AND m.message_code='Z01'`)
}

/**
 * Our own sent PRODAT whose CONTRL/APERAK is pending past its ack deadline: what an operator must be shown (TM-CONTRL,
 * ENV-04). Not in stuckDetector.ts (FINDINGS GOR-05: ediel_message_ack_state_v ranks awaiting_* before ack_overdue).
 */
export function overdueOutboundAcks(companyId: string, graceSeconds = 0) {
  return sql<Array<{ id: string; code: string; sentAt: string; ackDue: string; contrl: string | null; aperak: string | null; canonical: string | null }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',m.id,'code',m.message_code,'sentAt',m.message_sent_at,'ackDue',coalesce(m.contrl_due_at,m.ack_due_at),'contrl',m.contrl_status,'aperak',m.aperak_status,
      'canonical',(SELECT v.canonical_ack_state FROM public.ediel_message_ack_state_v v WHERE v.id=m.id))),'[]')
    FROM public.ediel_messages m WHERE m.company_id=${literal(companyId)} AND m.direction='outbound' AND m.message_family='PRODAT' AND m.message_sent_at IS NOT NULL
      AND m.status NOT IN ('failed','cancelled') AND coalesce(m.contrl_due_at,m.ack_due_at) < now() - make_interval(secs => ${Number(graceSeconds)})
      AND ((m.requires_contrl AND coalesce(m.contrl_status,'pending')='pending') OR (m.requires_aperak AND coalesce(m.aperak_status,'pending')='pending'))`)
}

/** /admin/customers/<id>: the operator presses "Skapa switchärende" for one facility with a requested start date. */
export async function createSwitchInAdmin(context: BrowserContext, input: { customerId: string; siteId: string; requestedStartDate: string }) {
  const page = await context.newPage()
  await page.goto(`/admin/customers/${input.customerId}`)
  const form = page.locator(`form:has(input[name="site_id"][value="${input.siteId}"]):has(select[name="request_type"])`).first()
  await form.waitFor({ state: 'attached', timeout: 180_000 })
  await form.locator('select[name="request_type"]').selectOption('switch')
  await form.locator('input[name="requested_start_date"]').fill(input.requestedStartDate)
  const actionStatus = await submitServerAction(page, () => form.getByRole('button', { name: /Skapa switchärende/ }).click(), 300_000)
  const text = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
  await page.close()
  return { actionStatus, text: text.slice(0, 800) }
}

/** /admin/operations/switches as the operator sees it: does the page name this facility's failure (code/text)? */
export async function operatorSeesSwitch(context: BrowserContext, needles: string[]) {
  const page = await context.newPage()
  const response = await page.goto('/admin/operations/switches')
  await page.waitForLoadState('networkidle').catch(() => undefined)
  const text = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ')
  await page.close()
  return { status: response?.status() ?? 0, found: needles.filter(needle => text.includes(needle)), excerpt: text.slice(0, 600) }
}
