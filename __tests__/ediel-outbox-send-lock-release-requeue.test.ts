// A production pause writes a send lock whose locked_reason is the pause reason.
// sendOutboxItem stored that reason as last_error, while the lock-release
// trigger (20260903161000) requeues only last_error = 'active_ediel_send_lock',
// so every message the worker met during a pause stayed blocked after going
// live again. The real send consumer runs against substituted ports; the
// written row then meets the real trigger in PostgreSQL.
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'

const port = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(), locks: [] as Array<Record<string, unknown>>,
  messages: new Map<string, EdielMessageRow>(), submitted: [] as string[],
}))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name !== 'claim_ediel_outbox_items') throw new Error(`Unexpected RPC: ${name}`)
    const claimedAt = new Date().toISOString()
    const rows = [...port.rows.values()].filter(row => row.status === 'queued')
    rows.forEach(row => { row.status = 'sending'; row.locked_by = args.p_worker_id; row.locked_at = claimedAt })
    return { data: rows.map(row => ({ ...row })), error: null }
  },
  from: (table: string) => {
    const filters: Array<[string, unknown]> = []
    let patch: Record<string, unknown> | null = null
    const result = () => {
      if (table === 'ediel_send_locks') return { data: port.locks.filter(lock => lock.company_id === filters.find(([f]) => f === 'company_id')?.[1]), error: null }
      const row = [...port.rows.values()].find(row => filters.every(([field, value]) => row[field] === value))
      if (row && patch) Object.assign(row, patch)
      return { data: row ? { ...row } : null, error: null }
    }
    const query = {
      select: () => query, update: (value: Record<string, unknown>) => { patch = value; return query },
      eq: (field: string, value: unknown) => { filters.push([field, value]); return query },
      limit: async () => result(), maybeSingle: async () => result(),
    }
    return query
  },
} }))
vi.mock('@/lib/ediel/db', () => ({ getEdielMessageById: async (id: string) => port.messages.get(id) ?? null }))
vi.mock('@/lib/ediel/transport', () => ({ sendEdielMessageViaSmtp: async (message: EdielMessageRow) => { port.submitted.push(message.id); return { messageId: null } } }))
vi.mock('@/lib/ediel/transport/acceptedProjection', () => ({ readAcceptedEdielTransportProjection: async () => null }))
vi.mock('@/lib/ediel/outbox/readinessGuard', () => ({ getEdielOutboundReadinessBlocker: async () => null }))
vi.mock('@/lib/ediel/outbox/routeContract', () => ({ evaluateEdielRouteContract: async () => ({ ok: true, fingerprint: 'fixture-route' }) }))
vi.mock('@/lib/ediel/outbox/projectSentSources', () => ({ projectSentEdielSourceState: async () => undefined }))
vi.mock('@/lib/tenant/operationPolicy', () => ({ getTenantOperationDecision: async () => ({ allowed: true }) }))

import { processEdielOutbox } from '@/lib/ediel/outbox/processEdielOutbox'

const company = '00000000-0000-0000-0000-000000000001'
const pauseReason = 'Canonical production state is not live.'

beforeEach(() => {
  port.rows.clear(); port.messages.clear(); port.submitted.length = 0
  port.locks = [{ company_id: company, environment: 'production', locked: true, locked_reason: pauseReason }]
  port.messages.set('M', { id: 'M', company_id: company, environment: 'production', direction: 'outbound', status: 'prepared',
    message_family: 'PRODAT', message_code: 'Z03', raw_payload: "UNB+UNOC:3+1:14+2:14+261016:1200+R1'" } as EdielMessageRow)
  port.rows.set('M', { id: 'M', company_id: company, environment: 'production', ediel_message_id: 'M', status: 'queued', current_send_attempt_id: 'attempt-M' })
})

async function releaseLockInPostgres(row: Record<string, unknown>) {
  const migration = readFileSync('supabase/migrations/20260903161000_ediel_send_lock_release_requeues_outbox.sql', 'utf8')
  const db = new PGlite()
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA private;
   CREATE TABLE public.ediel_production_state(company_id uuid, state text);
   CREATE TABLE public.ediel_send_locks(company_id uuid, environment text, locked boolean, status text);
   CREATE TABLE public.ediel_outbox(id text PRIMARY KEY, company_id uuid, environment text, status text, last_error text, blocked_reason text,
    blocked_at timestamptz, locked_at timestamptz, locked_by text, current_send_attempt_id text, sent_at timestamptz, updated_at timestamptz);`)
  await db.exec(migration)
  await db.query(`INSERT INTO ediel_production_state VALUES($1,'paused')`, [company])
  await db.query(`INSERT INTO ediel_send_locks VALUES($1,'production',true,'active')`, [company])
  await db.query(`INSERT INTO ediel_outbox(id,company_id,environment,status,last_error,blocked_reason) VALUES($1,$2,$3,$4,$5,$6)`,
    [row.id, row.company_id, row.environment, row.status, row.last_error, row.blocked_reason ?? null])
  await db.query(`UPDATE ediel_production_state SET state='live' WHERE company_id=$1`, [company])
  await db.query(`UPDATE ediel_send_locks SET locked=false,status='released' WHERE company_id=$1`, [company])
  const after = (await db.query<{ status: string; last_error: string | null; blocked_reason: string | null }>('SELECT status,last_error,blocked_reason FROM ediel_outbox')).rows[0]
  await db.close()
  return after
}

describe('outbox item blocked by a production pause', () => {
  it('is requeued when the send lock is released and production is live again', async () => {
    expect(await processEdielOutbox({ actorUserId: 'worker-actor', limit: 25 })).toMatchObject({ processed: 1, sent: 0, blocked: 1 })
    expect(port.submitted).toEqual([])
    const blocked = port.rows.get('M')!
    expect(blocked).toMatchObject({ status: 'blocked', last_error: 'active_ediel_send_lock', blocked_reason: pauseReason })
    expect(await releaseLockInPostgres(blocked)).toEqual({ status: 'queued', last_error: null, blocked_reason: null })
  })

  it('leaves rows blocked for other reasons blocked', async () => {
    await processEdielOutbox({ actorUserId: 'worker-actor', limit: 25 })
    expect(await releaseLockInPostgres({ ...port.rows.get('M')!, last_error: 'route_contract_missing' })).toMatchObject({ status: 'blocked' })
  })
})
