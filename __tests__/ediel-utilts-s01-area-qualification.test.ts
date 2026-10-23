import { describe, expect, it, vi } from 'vitest'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { recountEdifactUnt } from './helpers/recountEdifactUnt'
import { s01L359AggregateWire } from '../scripts/helpers/utiltsS01AggregateFixture'
import { resolveCanonicalEdielPolicy } from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { qualifyReceivedUtiltsStructure, takeQualifiedUtiltsRuntimeOwner } from '@/lib/ediel/utilts/qualifyReceivedStructure'

vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: vi.fn(() => { throw Error('unexpected_database_io') }) } }))
const policy = () => resolveCanonicalEdielPolicy({ family: 'UTILTS', messageCode: 'S01', direction: 'inbound', referenceDate: '2026-10-15', applicationReference: '23-DDK-S01-S' })
function source(mixed = false) {
  const original = energyHandoffMessage('2026-10-15', '11111111-1111-4111-8111-111111111111')
  return { ...original, message_code: 'S01', application_reference: '23-DDK-S01-S', customer_id: null, site_id: null, metering_point_id: null, grid_owner_id: null, grid_owner_data_request_id: null,
    raw_payload: s01L359AggregateWire(original.raw_payload!, [{ transactionId: 'AREA', latestUpdateDate: '202607010040', quantity: '500' }, ...(mixed ? [{ transactionId: 'UNKNOWN', latestUpdateDate: '202607010020', quantity: '7' }] : [])]) }
}
async function qualify(message: EdielMessageRow) {
  const canonicalPolicy = policy(), runtime = runUtiltsRuntimeForMessage(message, { canonicalPolicy })
  return { canonicalPolicy, result: await qualifyReceivedUtiltsStructure({ message, canonicalPolicy, runtime }) }
}

describe('source-qualified L359 area structural dispatch', () => {
  it('keeps genuine current-catalogue L359 area accepted without borrowing LOC172 authority', async () => {
    const message = source(), { result, canonicalPolicy } = await qualify(message)
    expect(result.runtime.transactionDispositions).toMatchObject([{ transactionId: 'AREA', disposition: 'accepted', responseType: 'positive_aperak' }])
    expect(result.hasInternalReview).toBe(false)
    expect(takeQualifiedUtiltsRuntimeOwner(result.runtime, message, canonicalPolicy)).not.toBeNull()
    expect(takeQualifiedUtiltsRuntimeOwner(result.runtime, message, canonicalPolicy)).toBeNull()
  })

  it.each([
    ['LIN', '8716867000030', '8716867000023'],
    ['reason', 'STS+7++E43', 'STS+7++E44'],
    ['phase', 'MKS+23+E03', 'MKS+23+E02'],
    ['settlement', 'CAV+E01', 'CAV+E02'],
    ['resolution', 'DTM+354:1:802', 'DTM+354:1:805'],
    ['timezone', 'DTM+735:?+0100:406', 'DTM+735:?+0200:406'],
    ['two-month period', '202606010000202607010000', '202605010000202607010000'],
    ['duplicate own quantity', "QTY+136:500'", "QTY+136:500'QTY+136:1'"],
    ['second observation', "QTY+136:500'", "QTY+136:500'SEQ++2'QTY+136:1'"],
    ['latest before end', 'DTM+368:202607010040', 'DTM+368:202606300040'],
    ['own transaction party', 'LIN+++', "NAD+MS+99999:SVK:260'LIN+++"],
    ['LIN agency', '8716867000030:::9', '8716867000030:::89'],
  ])('locally holds an otherwise accepted %s variant outside the SQL L359 capability', async (_name,from,to) => {
    const message=source();message.raw_payload=recountEdifactUnt(message.raw_payload.replace(from,to))
    const canonicalPolicy=policy(),runtime=runUtiltsRuntimeForMessage(message,{canonicalPolicy})
    expect(runtime.transactionDispositions).toMatchObject([{disposition:'accepted'}])
    const result=await qualifyReceivedUtiltsStructure({message,canonicalPolicy,runtime})
    expect(result.runtime.transactionDispositions).toMatchObject([{disposition:'internal_review',responseType:'none'}])
    expect(result.runtime.ackPlan.shouldSendAperak).toBe(false)
    expect(result.hasNationalMismatch).toBe(false)
    expect(result.runtime.validation.issues.filter(issue=>issue.aperakErcCode||issue.utiltsErrCode)).toEqual([])
    expect(takeQualifiedUtiltsRuntimeOwner(result.runtime,message,canonicalPolicy)).not.toBeNull()
  })

  it('preserves the existing national guide rejection for a one-character area', async () => {
    const message=source();message.raw_payload=message.raw_payload.replace('LOC+239+TES:', 'LOC+239+A:')
    const {result}=await qualify(message)
    expect(result.runtime.transactionDispositions).toMatchObject([{disposition:'guide_rejected',responseType:'negative_aperak'}])
  })

  it('propagates an actual engine unknown-product HOLD without inventing a national data error', async () => {
    const message = source(); message.raw_payload = message.raw_payload.replace('Z02:OT:', 'X50:OT:').replace("IDE+24+AREA'", "IDE+24+AREA'\nLOC+175+735999260731000007::9'")
    message.raw_payload = recountEdifactUnt(message.raw_payload)
    const { result } = await qualify(message)
    expect(result.hasInternalReview).toBe(true)
    expect(result.runtime.transactionDispositions).toMatchObject([{ disposition: 'internal_review', responseType: 'none' }])
    expect(result.runtime.ackPlan.shouldSendAperak).toBe(false)
  })

  it('keeps own L359 accepted beside a distinct LOCALUNQUALIFIED X50 object HOLD', async () => {
    const message = source(true)
    message.raw_payload = recountEdifactUnt(message.raw_payload.replace("IDE+24+UNKNOWN'", "IDE+24+UNKNOWN'\nLOC+175+735999260731000007::9'").replace(/(IDE\+24\+UNKNOWN'[\s\S]*?)Z02:OT:/, '$1X50:OT:'))
    const { result } = await qualify(message)
    expect(result.hasInternalReview).toBe(true)
    expect(result.runtime.transactionDispositions).toMatchObject([{ transactionId: 'AREA', disposition: 'accepted' }, { transactionId: 'UNKNOWN', disposition: 'internal_review', responseType: 'none' }])
  })

  it('does not give aggregate area authority to an individual-linked source', async () => {
    const message = { ...source(), metering_point_id: '22222222-2222-4222-8222-222222222222' }
    const { result } = await qualify(message)
    expect(result.hasInternalReview).toBe(true)
    expect(result.runtime.transactionDispositions).toMatchObject([{ disposition: 'internal_review', responseType: 'none' }])
  })

  it('does not borrow a sibling catalogue product when its own PIA is unknown', async () => {
    const message = source(true)
    message.raw_payload = message.raw_payload.replace(/(IDE\+24\+UNKNOWN'[\s\S]*?)U46:PT:/, '$1UNKNOWN:PT:')
    const { result } = await qualify(message)
    expect(result.hasInternalReview).toBe(true)
    expect(result.runtime.transactionDispositions).toMatchObject([{ transactionId: 'AREA', disposition: 'accepted' }, { transactionId: 'UNKNOWN', disposition: 'internal_review' }])
  })

  it('retains the genuine national negative for a supplied forbidden LOC172', async () => {
    const message = source(); message.raw_payload = recountEdifactUnt(message.raw_payload.replace("IDE+24+AREA'", "IDE+24+AREA'\nLOC+172+735999260731000007::9'"))
    const { result } = await qualify(message)
    expect(result.runtime.transactionDispositions).toMatchObject([{ disposition: 'guide_rejected', responseType: 'negative_aperak' }])
    expect(result.runtime.ackPlan.aperakApplicationErrors.some(e => e.fieldCode === '209')).toBe(true)
  })

  it('never mints the protected qualified owner for a cloned runtime', async () => {
    const message = source(), canonicalPolicy = policy(), runtime = structuredClone(runUtiltsRuntimeForMessage(message, { canonicalPolicy }))
    const result = await qualifyReceivedUtiltsStructure({ message, canonicalPolicy, runtime })
    expect(takeQualifiedUtiltsRuntimeOwner(result.runtime, message, canonicalPolicy)).toBeNull()
  })
})
