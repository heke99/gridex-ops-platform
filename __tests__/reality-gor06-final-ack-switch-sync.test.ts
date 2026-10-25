// reality-defects: GOR-06
// GOR-06 / owner decision 27, TypeScript side: syncSwitchFromInboundAck moves a sent ('prepared') switch only through
// gridex_record_switch_final_ack_v1 on its positive FINAL ack; never accepted, never a direct status write.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const port = vi.hoisted(() => ({
  receipt: null as Record<string, unknown> | null,
  switchRow: null as Record<string, unknown> | null,
  sourceRaw: '',
  switchUpdates: [] as Array<Record<string, unknown>>,
  switchEvents: [] as Array<Record<string, unknown>>,
  outboundUpdates: [] as Array<Record<string, unknown>>,
  dataRequestUpdates: [] as Array<Record<string, unknown>>,
  rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  ackResult: { applied: true, status: 'submitted' } as Record<string, unknown>,
}))

const COMPANY = '11111111-1111-4111-8111-111111111111'
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SOURCE = '22222222-2222-4222-8222-222222222222'
const ACK = '33333333-3333-4333-8333-333333333333'
const SWITCH = '44444444-4444-4444-8444-444444444444'
const Z04 = '55555555-5555-4555-8555-555555555555'

vi.mock('@/lib/ediel/ack/committedInboundAck', () => ({ readCommittedInboundAck: async () => null }))
vi.mock('@/lib/ediel/ack/sourceCorrelation', () => ({
  readInboundAckSourceCorrelation: () => ({ classification: { outcome: 'positive' }, lookupReferences: [] }),
  qualifyInboundAckSourceCandidates: ({ candidates }: { candidates: unknown[] }) => ({ status: 'unique', sourceMessage: candidates[0] }),
}))
vi.mock('@/lib/supabase/service', () => {
  const query = (table: string) => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === 'supplier_switch_requests' ? port.switchRow : null, error: null }),
    }
    return q
  }
  return { supabaseService: {
    from: query,
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'gridex_record_switch_final_ack_v1') { port.rpcCalls.push({ name, args }); if (port.ackResult.applied) port.switchRow = { ...port.switchRow, status: 'submitted' }; return { data: port.ackResult, error: null } }
      if (name === 'gridex_read_inbound_ack_source_v1') return { data: { version: 1, sourceMessage: source() }, error: null }
      if (name === 'gridex_apply_inbound_ack_source_v1') return { data: port.receipt, error: null }
      throw Error(`unexpected rpc ${name}`)
    },
  } }
})
vi.mock('@/lib/ediel/db', () => ({
  createEdielMessageEvent: async () => ({}), linkEdielMessage: async () => ({}), updateEdielMessageStatus: async () => ({}),
}))
vi.mock('@/lib/ediel/flows/shared', () => ({ ensureActorUserId: (value: string) => value, getGridOwnerDataRequestById: async () => null }))
vi.mock('@/lib/cis/db', () => ({
  getOutboundRequestById: async () => null,
  updateOutboundRequestStatus: async (input: Record<string, unknown>) => { port.outboundUpdates.push(input); return input },
  updateGridOwnerDataRequestStatus: async (input: Record<string, unknown>) => { port.dataRequestUpdates.push(input); return input },
}))
vi.mock('@/lib/operations/db', () => ({
  updateSupplierSwitchRequestStatus: async (_client: unknown, input: Record<string, unknown>) => { port.switchUpdates.push(input); return { ...port.switchRow, ...input } },
  createSupplierSwitchEvent: async (_client: unknown, input: Record<string, unknown>) => { port.switchEvents.push(input); return input },
}))
vi.mock('@/lib/customer-cases/db', () => ({ syncCustomerCaseCancellationAck: async () => null }))
vi.mock('@/lib/ediel/actorTestingEngine', () => ({ syncActorTestingForMessage: async () => null }))

import { processInboundAckMessage } from '@/lib/ediel/flows/inboundAckProcessing'
import type { EdielMessageRow } from '@/lib/ediel/types'

/** Our sent Z03 (one object, one LI). */
const Z03_RAW = "UNA:+.? 'UNB+UNOC:3+70001:14+16700:14+261022:1200+Z03REF++23-DDQ-PRODAT++1++1'UNH+1+PRODAT:D:97A:UN:E2SE6A'BGM+Z03+DOC1+9+AB'"
  + "DTM+137:202610221200:203'NAD+FR+70001:160:SVK+++++++SE'NAD+DO+16700:160:SVK+++++++SE'LIN+1++735999000000000017:::9'DTM+92:202611150000:203'"
  + "CCI++Z13'CAV+Z22'RFF+LI:CASE1'RFF+Z05:ALS'NAD+UD+199001011234:SE2:260'NAD+Z02+48800:160:SVK'UNT+15+1'UNZ+1+Z03REF'"
function source(): EdielMessageRow {
  return { id: SOURCE, company_id: COMPANY, environment: 'test', direction: 'outbound', message_family: 'PRODAT', message_code: 'Z03', status: 'sent',
    switch_request_id: SWITCH, outbound_request_id: null, grid_owner_data_request_id: null, raw_payload: port.sourceRaw || Z03_RAW } as unknown as EdielMessageRow
}
function ack(raw: string): EdielMessageRow {
  return { id: ACK, company_id: COMPANY, environment: 'test', direction: 'inbound', message_family: 'APERAK', message_code: 'APERAK', raw_payload: raw,
    parsed_payload: {}, validation_report: {} } as unknown as EdielMessageRow
}
const HEADER_REJECTION = "UNA:+.? 'UNB+UNOC:3+16700:14+70001:14+261022:1300+APK1++23-DDQ-PRODAT'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++27'DTM+137:202610221300:203'"
  + "RFF+ACW:DOC1'NAD+FR+16700:160:SVK+++++++SE'NAD+DO+70001:160:SVK+++++++SE'ERC+40::260'FTX+AAO++102::260+Meddelandehuvudet kunde inte läsas'UNT+9+1'UNZ+1+APK1'"
const OBJECT_REJECTION = "UNA:+.? 'UNB+UNOC:3+16700:14+70001:14+261022:1300+APK2++23-DDQ-PRODAT'UNH+1+APERAK:D:96A:UN:E2SE6A'BGM+++34'DTM+137:202610221300:203'"
  + "RFF+ACW:DOC1'NAD+FR+16700:160:SVK+++++++SE'NAD+DO+70001:160:SVK+++++++SE'ERC+40::260'FTX+AAO++105::260+Anläggningen kan inte identifieras'"
  + "RFF+Z07:735999000000000017'RFF+LI:CASE1'UNT+11+1'UNZ+1+APK2'"
const POSITIVE = "UNA:+.? 'UNB+UNOC:3+16700:14+70001:14+261022:1300+APK3++23-DDQ-PRODAT'UNH+1+APERAK:D:07B:UN:E2SE6A'BGM+++29'RFF+ACW:DOC1'UNT+4+1'UNZ+1+APK3'"
const receipt = (patch: Record<string, unknown>) => ({ version: 1, sourceMessage: source(), outcome: 'positive', scope: 'message', scopeOutcomes: [],
  finalAckReached: true, wholeSourceRejected: false, sourceAccepted: true, failureReason: null, idempotent: false, ...patch })

beforeEach(() => {
  port.switchUpdates = []; port.switchEvents = []; port.outboundUpdates = []; port.dataRequestUpdates = []; port.sourceRaw = ''; port.rpcCalls = []
  port.ackResult = { applied: true, status: 'submitted' }
})

describe('GOR-06 the positive final ack of a sent switch goes through the compare-and-set RPC', () => {
  it('a prepared switch calls gridex_record_switch_final_ack_v1 with its own Z03 and is not written any other way', async () => {
    port.switchRow = { id: SWITCH, company_id: COMPANY, status: 'prepared', inbound_z04_message_id: null, external_reference: null }
    port.receipt = receipt({})
    await processInboundAckMessage({ actorUserId: ACTOR, message: ack(POSITIVE) })
    expect(port.rpcCalls).toEqual([{ name: 'gridex_record_switch_final_ack_v1', args: { p_company_id: COMPANY, p_switch_id: SWITCH, p_source_message_id: SOURCE, p_actor_user_id: ACTOR } }])
    // Neither accepted (that is the Z04) nor a second direct status write.
    expect(port.switchUpdates).toEqual([])
  })

  it('a replay (RPC applied=false) writes nothing else', async () => {
    port.switchRow = { id: SWITCH, company_id: COMPANY, status: 'prepared', inbound_z04_message_id: null, external_reference: null }
    port.receipt = receipt({ idempotent: true })
    port.ackResult = { applied: false, reason: 'status_submitted' }
    await processInboundAckMessage({ actorUserId: ACTOR, message: ack(POSITIVE) })
    expect(port.switchUpdates).toEqual([])
  })

  it('an accepted switch (Z04) is never touched by a positive ack', async () => {
    port.switchRow = { id: SWITCH, company_id: COMPANY, status: 'accepted', inbound_z04_message_id: Z04, external_reference: null }
    port.receipt = receipt({})
    await processInboundAckMessage({ actorUserId: ACTOR, message: ack(POSITIVE) })
    expect(port.rpcCalls).toEqual([])
    expect(port.switchUpdates).toEqual([])
  })

  it('without the final ack nothing moves', async () => {
    port.switchRow = { id: SWITCH, company_id: COMPANY, status: 'prepared', inbound_z04_message_id: null, external_reference: null }
    port.receipt = receipt({ finalAckReached: false })
    await processInboundAckMessage({ actorUserId: ACTOR, message: ack(POSITIVE) })
    expect(port.rpcCalls).toEqual([])
    expect(port.switchUpdates).toEqual([])
  })
})
