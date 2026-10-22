// World pieces for reality scenario J1 (inbound PRODAT from the grid owner about our switches): the J1 grid-owner
// process and read-only state readers. Synthetic data only. Nothing here writes market state.
import { spawn, type ChildProcess } from 'node:child_process'
import { literal, sql } from '../live-chain-fixture'
import { freePort } from './world'
import type { InboundProdatPlan } from './inboundProdatWire'

export type J1SentFile = { at: string; kind: string; facility: string; object: string; interchange: string; document: string; start: string; li: string
  answers: Array<{ family: string; outcome: string; codes: string[] }> }
export type J1GridOwner = {
  url: string; edielId: string; email: string
  state: () => Promise<{ received: Array<Record<string, string>>; sent: J1SentFile[]; failures: Array<{ error: string }>; pendingSends: number }>
  plan: (plans: Record<string, InboundProdatPlan>) => Promise<void>
  stop: () => void
}

/** The J1 grid owner as its own OS process on the grid owner's mailbox (scripts/reality/simulators/gridOwnerInboundProdat.ts). */
export async function startInboundProdatGridOwner(input: { edielId: string; email: string; pollMs?: number; stepMs?: number }): Promise<J1GridOwner> {
  const port = await freePort()
  const child: ChildProcess = spawn('npx', ['tsx', 'scripts/reality/simulators/gridOwnerInboundProdat.ts'], {
    env: { ...process.env, REALITY_GRID_OWNER_EDIEL_ID: input.edielId, REALITY_GRID_OWNER_EMAIL: input.email, REALITY_GRID_OWNER_PORT: String(port),
      REALITY_GRID_OWNER_POLL_MS: String(input.pollMs ?? 10_000), REALITY_GRID_OWNER_STEP_MS: String(input.stepMs ?? 15_000) },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  const output: string[] = []
  child.stdout?.on('data', chunk => output.push(String(chunk)))
  child.stderr?.on('data', chunk => output.push(String(chunk)))
  for (let i = 0; ; i += 1) {
    if (output.join('').includes('control on')) break
    if (child.exitCode !== null || i > 120) throw Error(`j1_grid_owner_start_failed:${output.join('').slice(-500)}`)
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const url = `http://127.0.0.1:${port}`
  const call = async (path: string, body?: unknown) => (await fetch(url + path, body === undefined ? undefined : { method: 'POST', body: JSON.stringify(body) })).json()
  return { url, edielId: input.edielId, email: input.email, state: () => call('/__sim/state'), plan: async plans => { await call('/__sim/plan', plans) },
    stop: () => { if (child.pid) try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ } } }
}

export type J1FacilityState = {
  facility: string; switchId: string; status: string; confirmed: string | null; z04Linked: boolean; requested: string | null
  outbound: { status: string; failure: string | null } | null
  periods: Array<{ status: string; start: string }>
  contract: { status: string; startsAt: string | null; confirmed: string | null; actual: string | null } | null
  inbound: Array<{ id: string; code: string; reason: string | null; start: string | null; hold: string | null; answers: Array<{ family: string; outcome: string | null }> }>
  tasks: string[]; cases: string[]; notices: string[]
}

/** Per facility of the tenant: the newest switch, its Z03 request, supply periods, contract, every received PRODAT for
 * the facility with its native hold reason and our own answers, and what operators and the customer were given. */
export function j1States(companyId: string): J1FacilityState[] {
  const c = literal(companyId)
  return sql<J1FacilityState[]>(`SELECT coalesce(jsonb_agg(x.state ORDER BY x.facility),'[]') FROM (
    SELECT DISTINCT ON (mp.metering_point_id) mp.metering_point_id facility, jsonb_build_object(
      'facility',mp.metering_point_id,'switchId',s.id,'status',s.status,'confirmed',s.confirmed_start_date,'z04Linked',s.inbound_z04_message_id IS NOT NULL,'requested',s.requested_start_date,
      'outbound',(SELECT jsonb_build_object('status',o.status,'failure',o.failure_reason) FROM public.outbound_requests o WHERE o.source_id=s.id AND o.company_id=s.company_id ORDER BY o.created_at DESC LIMIT 1),
      'periods',(SELECT coalesce(jsonb_agg(jsonb_build_object('status',p.status,'start',p.start_date) ORDER BY p.created_at),'[]') FROM public.customer_supply_periods p WHERE p.company_id=s.company_id AND p.metering_point_id=s.metering_point_id),
      'contract',(SELECT jsonb_build_object('status',k.status,'startsAt',k.starts_at,'confirmed',k.confirmed_start_date,'actual',k.actual_start_date) FROM public.customer_contracts k WHERE k.company_id=s.company_id AND k.metering_point_id=s.metering_point_id ORDER BY k.created_at DESC LIMIT 1),
      'inbound',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'code',m.message_code,'reason',substring(m.raw_payload from 'CCI\\+\\+Z13''CAV\\+([^'']+)'),'start',substring(m.raw_payload from 'DTM\\+92:(\\d{8})'),
          'hold',(SELECT e.payload#>>'{sourceObjectPartition,0,reason}' FROM public.ediel_message_events e WHERE e.ediel_message_id=m.id AND e.payload ? 'sourceObjectPartition' ORDER BY e.created_at DESC LIMIT 1),
          'answers',(SELECT coalesce(jsonb_agg(jsonb_build_object('family',a.message_family,'outcome',a.ack_outcome)),'[]') FROM public.ediel_messages a WHERE a.related_message_id=m.id AND a.company_id=m.company_id AND a.direction='outbound'))
          ORDER BY m.created_at),'[]')
        FROM public.ediel_messages m WHERE m.company_id=s.company_id AND m.direction='inbound' AND m.message_family='PRODAT' AND m.raw_payload LIKE '%LIN+%'||mp.metering_point_id||'%'),
      'tasks',(SELECT coalesce(jsonb_agg(t.task_type),'[]') FROM public.customer_operation_tasks t WHERE t.company_id=s.company_id AND (t.metering_point_id=s.metering_point_id OR t.metadata->>'supplierSwitchRequestId'=s.id::text)),
      'cases',(SELECT coalesce(jsonb_agg(cc.case_type),'[]') FROM public.customer_cases cc WHERE cc.company_id=s.company_id AND (cc.supplier_switch_request_id=s.id OR cc.metering_point_id=s.metering_point_id)),
      'notices',(SELECT coalesce(jsonb_agg(j.payload->>'event_type'),'[]') FROM public.customer_operation_jobs j WHERE j.company_id=s.company_id AND j.customer_id=s.customer_id AND j.job_type='dispatch_lifecycle_notification')
    ) state
    FROM public.supplier_switch_requests s JOIN public.metering_points mp ON mp.id=s.metering_point_id
    WHERE s.company_id=${c} ORDER BY mp.metering_point_id, s.created_at DESC) x`)
}

/** Received PRODAT the tenant got for no facility it holds (the grid owner's Z04 for a switch never requested). */
export function unmatchedInboundProdat(companyId: string, facility: string) {
  return sql<Array<{ id: string; code: string; hold: string | null; answers: Array<{ family: string; outcome: string | null }>; inboundCase: string | null }>>(`SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'code',m.message_code,
      'hold',(SELECT e.payload#>>'{sourceObjectPartition,0,reason}' FROM public.ediel_message_events e WHERE e.ediel_message_id=m.id AND e.payload ? 'sourceObjectPartition' ORDER BY e.created_at DESC LIMIT 1),
      'answers',(SELECT coalesce(jsonb_agg(jsonb_build_object('family',a.message_family,'outcome',a.ack_outcome)),'[]') FROM public.ediel_messages a WHERE a.related_message_id=m.id AND a.company_id=m.company_id AND a.direction='outbound'),
      'inboundCase',(SELECT ic.status FROM public.ediel_inbound_cases ic WHERE ic.ediel_message_id=m.id LIMIT 1)) ORDER BY m.created_at),'[]')
    FROM public.ediel_messages m WHERE m.company_id=${literal(companyId)} AND m.direction='inbound' AND m.message_family='PRODAT' AND m.raw_payload LIKE ${literal(`%LIN+1++${facility}%`)}`)
}
