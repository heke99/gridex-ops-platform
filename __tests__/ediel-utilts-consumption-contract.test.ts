import {recountEdifactUnt} from './helpers/recountEdifactUnt'
import { canonicalUtiltsDecimal, sumUtiltsDecimals, retainedV1NumberDecimal, utiltsEnergyQuantityKwh } from '@/lib/ediel/utilts/exactDecimal'
import { bindingRpcRows } from './helpers/utiltsBoundFixture'
import { expect, it, vi } from 'vitest'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, validateUtiltsPersistenceResults } from '@/lib/ediel/utilts/transactionPersistence'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { runUtiltsRuntimeForMessage } from '@/lib/ediel/utiltsEngine'
import { energyHandoffMessage } from './helpers/utiltsObservationHandoff'
import { consumptionEqual, legacyUtiltsRetryComparison, validateUtiltsConsumptionContract, type UtiltsConsumptionContractV2 } from '@/lib/ediel/utilts/consumptionContract'
vi.mock('@/lib/ediel/matching', () => ({ matchMeteringPointIdByIdentifier: vi.fn().mockResolvedValue('point'), matchSiteAndCustomerForMeteringPoint: vi.fn().mockResolvedValue({ customerId: 'customer', siteId: 'site', gridOwnerId: 'owner' }) }))
async function preparedEnergy(code: 'E66' | 'E30' | 'S07' = 'E66', transform?: (raw: string) => string) {
  const message = energyHandoffMessage()
  message.message_code = code
  message.application_reference = code === 'E30' ? '23-MDR-E30-T' : `23-DDQ-${code}-T`
  message.raw_payload = message.raw_payload!.replace('?+0200:406', '?+0100:406').replace('BGM+E66', `BGM+${code}`).replace('23-DDQ-E66-T', message.application_reference)
  if(code==='E30') message.raw_payload=recountEdifactUnt(message.raw_payload.replace("MEA+AAZ++KWH'\n",''))
  if (transform) message.raw_payload = transform(message.raw_payload)
  const runtime = runUtiltsRuntimeForMessage(message), policy = resolveCanonicalMessagePolicy(message)!
  const contracts = await prepareUtiltsConsumptionContracts({ message, runtime, policy, matches: [], dataRequest: null,
    fallback: { customerId: 'customer', siteId: 'site', meteringPointId: 'point', gridOwnerId: 'owner' }, allowConsumption: code !== 'S07' })
  return { message, runtime, contracts, input: { companyId: message.company_id!, environment: message.environment, sourceMessageId: message.id, messageCode: code, rawPayload: message.raw_payload!, contracts,
    transactions: buildUtiltsTransactionPersistencePayload({ messageCode: code, transactions: runtime.facts.transactions, dispositions: runtime.transactionDispositions, matches: [] }) } }
}
it('prepares actual absolute observations and freezes resolved attribution before persistence', async () => {
  const { contracts } = await preparedEnergy()
  expect(contracts[0]).toMatchObject({ interpretation: { offsetMinutes: 60, resolutionFormat: '806' }, metering: { capability: 'write', customerId: 'customer', meteringPointId: 'point' }, observations: [{ quantity: '500', periodStart: '2026-06-30T23:00:00.000Z', periodEnd: '2026-06-30T23:15:00.000Z', readAt: '2026-06-30T23:15:00.000Z', resolution: 'PT15M' }] })
})
it.each([{ resolution: '15:806', end: '202607010030', second: '202607010015', utcEnd: '2026-06-30T23:15:00.000Z' }, { resolution: '1:802', end: '202609010000', second: '202608010000', utcEnd: '2026-07-31T23:00:00.000Z' }])('actual accepted E30 $resolution resolves distinct per-observation intervals', async fixture => {
  const result = await preparedEnergy('E30', raw => {
    const lines = raw.replace('15:806', fixture.resolution).replace('202607010000202607010015:719', `202607010000${fixture.end}:719`).split('\n')
    const at = lines.findIndex(line => line.startsWith('UNT+'))
    lines.splice(at, 0, "SEQ++2'", "QTY+136:7'", `DTM+597:${fixture.second}:203'`, "STS+7++21::260'")
    lines[at + 4] = `UNT+${at + 3}+1'`
    return lines.join('\n')
  })
  expect(result.runtime.validation.ok, JSON.stringify(result.runtime.validation.issues)).toBe(true)
  expect(result.runtime.transactionDispositions[0].disposition).toBe('accepted')
  expect(result.contracts[0].observations.map(o => o.quantity)).toEqual(['500', '7'])
  expect(result.contracts[0].observations[0].periodEnd).toBe(fixture.utcEnd)
  expect(result.contracts[0].observations[1].periodStart).toBe(fixture.utcEnd)
  expect(result.contracts[0].observations[0].periodStart).not.toBe(result.contracts[0].observations[1].periodStart)
})
it('E30 projection resolves local interval arithmetic before extraction and S07 cannot consume', async () => {
  const e30 = await preparedEnergy('E30'), s07 = await preparedEnergy('S07')
  expect(e30.contracts[0]).toMatchObject({ messageCode: 'E30', observations: [{ quantity: '500', periodStart: '2026-06-30T23:00:00.000Z', periodEnd: '2026-06-30T23:15:00.000Z', resolution: 'PT15M' }] })
  expect(s07.contracts[0]).toMatchObject({ messageCode: 'S07', observations: [], metering: { capability: 'skip' }, billing: { capability: 'skip' }, interpretation: { timestampPolicy: 'no-consumption-v1' } })
})
it.each(['quantity', 'unknown version', 'missing offset', 'missing field', 'unordered observations'])('rejects invalid contract: %s', async kind => {
  const { contracts } = await preparedEnergy()
  const c = structuredClone(contracts[0]) as unknown as Record<string, unknown>
  if (kind === 'quantity') (c.observations as Record<string, unknown>[])[0].quantity = Number.NaN
  if (kind === 'unknown version') c.version = 3
  if (kind === 'missing field') delete c.attributionVersion
  if (kind === 'missing offset') (c.observations as Record<string, unknown>[])[0].periodStart = '2026-06-30T23:00:00'
  if (kind === 'unordered observations') (c.observations as Record<string, unknown>[])[0].ordinal = 9
  expect(() => validateUtiltsConsumptionContract(c)).toThrow('utilts_consumption_binding_conflict')
})
it('object key order is not semantic while observation order is', () => {
  expect(consumptionEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
  expect(consumptionEqual([1, 2], [2, 1])).toBe(false)
})
it('preserves exact leading and embedded U505 data in V2 while the frozen V1 validator stays unchanged',async()=>{
  const {contracts}=await preparedEnergy('E66',raw=>raw.replace('GRIDEX2607E66001',' OWN A'))
  expect(validateUtiltsConsumptionContract(contracts[0]).transactionId).toBe(' OWN A')
  const legacy={...contracts[0],version:1,projectionVersion:'utilts-consumption-v1',observations:contracts[0].observations.map(o=>({...o,quantity:500}))}
  expect(()=>validateUtiltsConsumptionContract(legacy)).toThrow('text_required')
  for(const transactionId of ['OWN ', ' ', 'X'.repeat(36),'OWN\tREF']) expect(()=>validateUtiltsConsumptionContract({...contracts[0],transactionId})).toThrow('transaction_reference')
})
it('rejects the old successful RPC shape without any stored authority', async () => {
  const { input } = await preparedEnergy()
  expect(() => validateUtiltsPersistenceResults(input, [{ transactionId: input.transactions[0].transactionId, disposition: 'accepted', responseType: 'positive_aperak', persistenceStatus: 'persisted' }])).toThrow('source_binding')
})

it('plain-ID matching cannot grant consumption to an unsupported original agency89', async () => {
  await expect(preparedEnergy('E66', raw => raw.replace('735999260731000007::9', '735999260731000007::89'))).rejects.toThrow('identity_unsupported')
})

it('keeps source quantities beyond binary precision as canonical logical decimals', async () => {
  const result=await preparedEnergy('E66',raw=>raw.replace('QTY+136:500', 'QTY+136:9007199254740993'))
  expect(result.runtime.facts.transactions[0].quantities[0].value).toBe(9007199254740992)
  expect(result.contracts[0]).toMatchObject({version:2,projectionVersion:'utilts-consumption-v2',observations:[{quantity:'9007199254740993',sourceOrdinal:0}]})
})
it('honors the UNA decimal mark without exponent or floating-point normalization',()=>{
  expect(canonicalUtiltsDecimal('00010,0200',',')).toBe('10.02')
  expect(sumUtiltsDecimals(['0.1','0.2','9007199254740993','-9007199254740993'])).toBe('0.3')
  expect(retainedV1NumberDecimal(1e-7)).toBe('0.0000001')
  for (const value of ['1e3','NaN',' 1','1.2.3','+1']) expect(()=>canonicalUtiltsDecimal(value)).toThrow('utilts_decimal_invalid')
})
it('accepts only authentic same-source immutable V1 retry comparison, never a new V1 response',async()=>{
  const {input}=await preparedEnergy()
  const legacy=legacyUtiltsRetryComparison(input.contracts[0] as UtiltsConsumptionContractV2,input.rawPayload)
  const response=bindingRpcRows(input) as Record<string,unknown>[]
  Object.assign(response[0],{contractVersion:1,consumptionContract:legacy,idempotentReplay:true})
  expect(validateUtiltsPersistenceResults(input,response)[0].consumptionContract?.version).toBe(1)
  response[0].idempotentReplay=false
  expect(()=>validateUtiltsPersistenceResults(input,response)).toThrow('returned_contract')
  response[0].idempotentReplay=true
  ;(response[0].sourceBinding as Record<string,unknown>).rawHash='f'.repeat(64)
  expect(()=>validateUtiltsPersistenceResults(input,response)).toThrow('source_binding')
})

it.each([['MWH','500000'],['GWH','500000000']] as const)('represents %s conversion exactly while holding ordinary source admission without exception grounds', async(unit,expected)=>{
  expect(utiltsEnergyQuantityKwh('500',unit)).toBe(expected)
  const result=await preparedEnergy('E66',raw=>raw.replace('MEA+AAZ++KWH',`MEA+AAZ++${unit}`))
  expect(result.runtime.transactionDispositions[0].disposition).toBe('processability_rejected')
  expect(result.runtime.ackPlan.utiltsErrCodes).toContain('E73')
  expect(result.contracts[0].observations).toEqual([])
})
it('rejects an own SEQ unit override at its guide before billing preparation',async()=>{
  const result=await preparedEnergy('E66',raw=>recountEdifactUnt(raw.replace("SEQ++1'","SEQ++1'\nMEA+AAZ++MWH'")))
  expect(result.runtime.transactionDispositions[0]).toMatchObject({disposition:'guide_rejected',responseType:'negative_aperak'})
  expect(result.runtime.validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'UTILTS_QUANTITY_UNIT_SCOPE_INVALID',aperakFieldCode:'264'})]))
  expect(result.contracts[0].observations).toEqual([])
})
it('keeps conflicting own-SEQ unit rejection separate from an accepted IDE sibling',async()=>{
  const result=await preparedEnergy('E66',raw=>{
    const lines=raw.split('\n'),begin=lines.findIndex(line=>line.startsWith('IDE+')),end=lines.findIndex(line=>line.startsWith('UNT+'))
    const second=lines.slice(begin,end).map(line=>line.replaceAll('GRIDEX2607E66001','SECOND'))
    second.splice(second.findIndex(line=>line.startsWith('QTY+')),0,"MEA+AAZ++MWH'")
    return recountEdifactUnt([...lines.slice(0,end),...second,...lines.slice(end)].join('\n'))
  })
  expect(result.runtime.transactionDispositions.map(d=>d.disposition)).toEqual(['accepted','guide_rejected'])
  expect(result.contracts.map(c=>c.observations.map(o=>o.quantity))).toEqual([['500'],[]])
})

it('retains an authentic pre-conversion V1 MWH result without rewriting historical kWh content',async()=>{
  // Model a previously committed interpretation, independently of fresh
  // admission, which now holds MWH without genuine exception evidence.
  const {input}=await preparedEnergy('E66')
  input.rawPayload=input.rawPayload.replace('MEA+AAZ++KWH','MEA+AAZ++MWH')
  input.contracts[0].observations[0].quantity='500000'
  input.transactions[0].unit='MWH'
  expect(input.contracts[0].observations[0].quantity).toBe('500000')
  const legacy=legacyUtiltsRetryComparison(input.contracts[0] as UtiltsConsumptionContractV2,input.rawPayload)
  expect(legacy.observations[0].quantity).toBe(500)
  const rows=bindingRpcRows(input) as Record<string,unknown>[]
  Object.assign(rows[0],{consumptionContract:legacy,contractVersion:1,idempotentReplay:true})
  expect(validateUtiltsPersistenceResults(input,rows)[0].consumptionContract?.observations[0].quantity).toBe(500)
})

it('uses standard own E30 energy dimension without fabricating an original unit field',async()=>{
 const {contracts,input}=await preparedEnergy('E30')
 expect(contracts[0].observations[0]).toMatchObject({quantity:'500',unit:'kWh'})
 expect(input.transactions[0].unit).toBeNull()
})
it('takes own quality/product/register from physical fields, never QTY qualifier or a sibling',async()=>{
 const result=await preparedEnergy('E66',raw=>raw.replace("STS+7++21::260",'STS+8+56'))
 expect(result.contracts[0].observations[0]).toMatchObject({quality:'56',readingType:'estimated',productCode:'8716867000030'})
 const approved=await preparedEnergy('E66')
 expect(approved.contracts[0].observations[0].quality).toBeNull()
})
it('retains source missing energy as NULL/ownquality46 without a consumer zero',async()=>{
 const result=await preparedEnergy('E30',raw=>raw.replace('QTY+136:500','QTY+136:NULL').replace('STS+7++21::260','STS+8+46'))
 expect(result.runtime.transactionDispositions[0].disposition).toBe('accepted')
 expect(result.contracts[0].observations).toEqual([])
 expect(result.input.transactions[0].quantities[0]).toMatchObject({value:null,raw:'QTY+136:NULL'})
})
it('rejects missing own quality46 and supplied not-used QTYunit at the guide',async()=>{
 const noQuality=await preparedEnergy('E30',raw=>raw.replace('QTY+136:500','QTY+136:NULL'))
 expect(noQuality.runtime.transactionDispositions[0].disposition).toBe('guide_rejected')
 const supplied=await preparedEnergy('E66',raw=>raw.replace('QTY+136:500','QTY+136:500:KWH'))
 expect(supplied.runtime.transactionDispositions[0].disposition).toBe('guide_rejected')
 expect(supplied.runtime.validation.issues).toEqual(expect.arrayContaining([expect.objectContaining({code:'UTILTS_QUANTITY_UNIT_NOT_USED',aperakFieldCode:'QTY/C186/6411'})]))
})
