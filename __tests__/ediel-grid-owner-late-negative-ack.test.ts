// reality-defects: GOR-02, GOR-01, GOR-03 (scenario I, scripts/reality/chain-i-grid-owner-rejects.test.ts)
// Rules exercised (specification only, not coverage tags): P-11 ("Sena kvittenser får inte backa ett giltigt
// affärstillstånd"), ACK-07 (incident instead of reversing a final outcome), ACK-02/ACK-08 (object outcomes).
//
// Unit proof of the TypeScript decision in processInboundAckMessage after the atomic SQL receipt. The DB ports
// are mocked at module boundaries; the receipts have the exact shape gridex_ack_authority.apply_v1 returns
// (wholeSourceRejected/sourceAccepted/finalAckReached/failureReason/scope/scopeOutcomes). The native
// counterpart with real SQL is scripts/ediel-grid-owner-rejects-native.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const port = vi.hoisted(() => ({
  receipt: null as Record<string, unknown> | null,
  switchRow: null as Record<string, unknown> | null,
  sourceRaw: '',
  switchUpdates: [] as Array<Record<string, unknown>>,
  switchEvents: [] as Array<Record<string, unknown>>,
  outboundUpdates: [] as Array<Record<string, unknown>>,
  dataRequestUpdates: [] as Array<Record<string, unknown>>,
}))

const COMPANY = '11111111-1111-4111-8111-111111111111'
const ACTOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SOURCE = '22222222-2222-4222-8222-222222222222'
const ACK = '33333333-3333-4333-8333-333333333333'
const SWITCH = '44444444-4444-4444-8444-444444444444'
const Z04 = '55555555-5555-4555-8555-555555555555'

vi.mock('@/lib/ediel/ack/committedInboundAck', () => ({ readCommittedInboundAck: async () => null }))
vi.mock('@/lib/ediel/ack/sourceCorrelation', () => ({
  readInboundAckSourceCorrelation: () => ({ classification: { outcome: 'negative' }, lookupReferences: [] }),
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
    rpc: async (name: string) => {
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
const receipt = (patch: Record<string, unknown>) => ({ version: 1, sourceMessage: source(), outcome: 'negative', scope: 'message', scopeOutcomes: [],
  finalAckReached: false, wholeSourceRejected: true, sourceAccepted: false, failureReason: 'APERAK negative whole-source acknowledgement', idempotent: false, ...patch })

beforeEach(() => {
  port.switchUpdates = []; port.switchEvents = []; port.outboundUpdates = []; port.dataRequestUpdates = []; port.sourceRaw = ''
})

describe('negative ACK after the grid owner already confirmed the switch (P-11)', () => {
  it('GOR-02 a late whole-source negative APERAK does not move an accepted switch (Z04 linked) back to failed', async () => {
    port.switchRow = { id: SWITCH, company_id: COMPANY, status: 'accepted', inbound_z04_message_id: Z04, external_reference: null }
    port.receipt = receipt({})
    const result = await processInboundAckMessage({ actorUserId: ACTOR, message: ack(HEADER_REJECTION) })
    expect(result.outcome).toBe('negative')
    expect(port.switchUpdates.filter(update => ['failed', 'rejected'].includes(String(update.status)))).toEqual([])
    // ACK-07: the contradiction is recorded on the switch for an operator, not silently dropped.
    expect(port.switchEvents.some(event => event.eventStatus === 'warning' && /Z04|bekräft/i.test(String(event.message)))).toBe(true)
  })

  it('a whole-source negative APERAK still fails a switch that is only waiting (no Z04)', async () => {
    port.switchRow = { id: SWITCH, company_id: COMPANY, status: 'prepared', inbound_z04_message_id: null, external_reference: null }
    port.receipt = receipt({})
    await processInboundAckMessage({ actorUserId: ACTOR, message: ack(HEADER_REJECTION) })
    expect(port.switchUpdates).toEqual([expect.objectContaining({ requestId: SWITCH, status: 'failed' })])
  })
})

describe('the grid owner\'s rejection reaches the switch', () => {
  it('GOR-03 the failed switch carries the grid owner\'s ERC/FTX code and text', async () => {
    port.switchRow = { id: SWITCH, company_id: COMPANY, status: 'prepared', inbound_z04_message_id: null, external_reference: null }
    port.receipt = receipt({})
    await processInboundAckMessage({ actorUserId: ACTOR, message: ack(HEADER_REJECTION) })
    expect(String(port.switchUpdates[0]?.failureReason)).toMatch(/40\/102/)
    expect(String(port.switchUpdates[0]?.failureReason)).toContain('Meddelandehuvudet kunde inte läsas')
  })

  it('GOR-01 a BGM 34 rejection of the only object rejects the switch with the DSO reason', async () => {
    port.switchRow = { id: SWITCH, company_id: COMPANY, status: 'prepared', inbound_z04_message_id: null, external_reference: null }
    // Exactly what the SQL owner returns for a processed (BGM 34) object rejection: not whole-source, not accepted.
    port.receipt = receipt({ scope: 'object', scopeOutcomes: [{ reference: 'object-1', outcome: 'negative' }], finalAckReached: true, wholeSourceRejected: false,
      failureReason: null })
    await processInboundAckMessage({ actorUserId: ACTOR, message: ack(OBJECT_REJECTION) })
    expect(port.switchUpdates).toEqual([expect.objectContaining({ requestId: SWITCH, status: 'failed' })])
    expect(String(port.switchUpdates[0].failureReason)).toMatch(/40\/105/)
  })

  it('a BGM 34 object rejection never fails the switch when only some of several objects are rejected', async () => {
    port.switchRow = { id: SWITCH, company_id: COMPANY, status: 'prepared', inbound_z04_message_id: null, external_reference: null }
    port.sourceRaw = Z03_RAW.replace("NAD+Z02+48800:160:SVK'", "NAD+Z02+48800:160:SVK'LIN+2++735999000000000024:::9'RFF+LI:CASE2'")
    port.receipt = receipt({ scope: 'object', scopeOutcomes: [{ reference: 'object-1', outcome: 'negative' }], finalAckReached: false, wholeSourceRejected: false, failureReason: null })
    await processInboundAckMessage({ actorUserId: ACTOR, message: ack(OBJECT_REJECTION) })
    expect(port.switchUpdates).toEqual([])
  })
})
