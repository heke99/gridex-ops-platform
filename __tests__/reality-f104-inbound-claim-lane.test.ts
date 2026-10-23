// reality-defects: F104
// FINDINGS F104 (reality world 2026-10-23, scenario F run 26). The inbound mail engine runs once per lane, but
// claimQueuedInboundProcessingJobs called claim_inbound_processing_jobs with p_environment => null, so the test-lane
// run inbound-mail-engine-2026-10-23T10:05:53.057Z claimed six production jobs while the production run was still
// polling, and both runs then business-processed the same six CONTRL/APERAK messages. A run now claims only its lane.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  rpcError: null as null | { message: string },
  fromTables: [] as string[],
}))

vi.mock('@/lib/supabase/service', () => ({ supabaseService: {
  rpc: async (name: string, args: Record<string, unknown>) => {
    io.rpcCalls.push({ name, args })
    return io.rpcError ? { data: null, error: io.rpcError } : { data: [], error: null }
  },
  from: (table: string) => {
    io.fromTables.push(table)
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in', 'is', 'or', 'not', 'order', 'limit', 'update']) query[method] = () => query
    query.maybeSingle = async () => ({ data: null, error: null })
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve)
    return query
  },
} }))
vi.mock('@/lib/inbound-mail/edielInboundProcessor', () => ({ processInboundEmailMessage: async () => ({ status: 'processed' }) }))

import { processQueuedInboundProcessingJobs } from '@/lib/inbound-mail/edielMailboxPoller.part-2'

const claims = () => io.rpcCalls.filter(call => call.name === 'claim_inbound_processing_jobs')

beforeEach(() => { io.rpcCalls = []; io.rpcError = null; io.fromTables = [] })

describe('inbound job claim lane (F104)', () => {
  it.each(['test', 'production'] as const)('a %s-lane run claims only jobs of its own lane',async (lane) => {
    await processQueuedInboundProcessingJobs({ workerId: `inbound-mail-engine-${lane}`, environment: lane })
    expect(claims()).toHaveLength(1)
    expect(claims()[0].args).toMatchObject({ p_environment: lane, p_worker_id: `inbound-mail-engine-${lane}` })
  })

  it('only a lane-less call (the platform admin queue action) claims every lane', async () => {
    await processQueuedInboundProcessingJobs({ workerId: 'admin' })
    expect(claims()[0].args).toMatchObject({ p_environment: null })
  })

  it('refuses an unknown lane instead of widening it to every lane', async () => {
    await expect(processQueuedInboundProcessingJobs({ workerId: 'w', environment: 'prod' })).rejects.toThrow('inbound_processing_claim_environment_invalid')
    expect(claims()).toEqual([])
  })

  it('a lane run never falls back to the lane-less queue listing when the claim RPC is missing', async () => {
    io.rpcError = { message: 'Could not find the function public.claim_inbound_processing_jobs in the schema cache' }
    await expect(processQueuedInboundProcessingJobs({ workerId: 'w', environment: 'test' })).rejects.toMatchObject({ message: io.rpcError.message })
    expect(io.fromTables).toEqual([])
    // The lane-less admin call keeps its compatibility fallback.
    await processQueuedInboundProcessingJobs({ workerId: 'w' })
    expect(io.fromTables).toContain('inbound_processing_jobs')
  })
})
