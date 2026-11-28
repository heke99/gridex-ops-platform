import { expect, it, vi } from 'vitest'
import { prepareUtiltsConsumptionContracts } from '@/lib/ediel/utilts/consumptionPreparation'
import { buildUtiltsTransactionPersistencePayload, prepareUtiltsPersistenceRpcArguments } from '@/lib/ediel/utilts/transactionPersistence'
import { resolveCanonicalMessagePolicy } from '@/lib/ediel/core/messagePolicy'
import { runUtiltsRuntimeForMessage, utiltsRuntimeSegments } from '@/lib/ediel/utiltsEngine'
import { observationHandoffMessage } from './helpers/utiltsObservationHandoff'

vi.mock('@/lib/supabase/service', () => ({supabaseService:{}}))

const source = '56000000-0000-4000-8000-000000000001'
const customer = '56000000-0000-4000-8000-000000000002'
const company = '56000000-0000-4000-8000-000000000003'
const point = '56000000-0000-4000-8000-000000000004'
const site = '56000000-0000-4000-8000-000000000005'
const actor = '56000000-0000-4000-8000-000000000006'
const grid = '56000000-0000-4000-8000-000000000007'

async function prepare() {
  const template = observationHandoffMessage('2026-09-30', company)
  const raw = template.raw_payload!.replace('23-DDQ-E66-S++1', '23-DDQ-E66-T++1++1')
    .replace('QTY+220:11000', 'QTY+220:10500')
  const message = { ...template, id: source, application_reference: '23-DDQ-E66-T', raw_payload: raw,
    customer_id: customer, site_id: site, metering_point_id: point }
  const policy = resolveCanonicalMessagePolicy(message)!
  const runtime = runUtiltsRuntimeForMessage(message, {canonicalPolicy:policy})
  expect(runtime.transactionDispositions[0],JSON.stringify(runtime.validation.issues)).toMatchObject({disposition:'accepted'})
  const matches = [{ transactionReference:'GRIDEX2607E66001', externalMeteringPointId:'735999260731000007', externalGridAreaId:'TES',
    customerId:customer, meteringPointId:point, siteId:site, gridOwnerId:grid, matchStatus:'matched' as const }]
  const contracts = await prepareUtiltsConsumptionContracts({message,runtime,policy, matches, dataRequest:null,
    fallback:{customerId:customer,siteId:site,meteringPointId:point,gridOwnerId:grid},allowConsumption:true})
  const transactions = buildUtiltsTransactionPersistencePayload({messageCode:'E66', transactions:runtime.facts.transactions,
    dispositions:runtime.transactionDispositions, rawSegments:utiltsRuntimeSegments(runtime.facts), matches})
  expect(contracts[0].observations.map(({sourceOrdinal,quantity})=>({sourceOrdinal,quantity})))
    .toEqual([{sourceOrdinal:2,quantity:'500'}])
  return { actorUserId:actor, sourceMessageId:source, companyId:company, environment:'test' as const,
    messageCode:'E66', rawPayload:raw, contracts, transactions }
}

it('writes own E66 register timestamp and leaves exactly one QTY136 energy contribution', async () => {
  const input = await prepare()
  const command = prepareUtiltsPersistenceRpcArguments(input)
  expect(command.p_transactions[0].quantities).toMatchObject([
    {qualifier:'220',value:'10000',readingAt:'2026-06-30T22:00:00.000Z'},
    {qualifier:'220',value:'10500',readingAt:'2026-07-31T22:00:00.000Z'},
    {qualifier:'136',value:'500',readingAt:'2026-06-30T22:00:00.000Z'},
  ])
})

it.each([
  ['absence',"QTY+220:10500'\nDTM+597:202608010000:203'","QTY+220:10500'"],
  ['date in a sibling quantity',"QTY+220:10500'\nDTM+597:202608010000:203'","QTY+220:10500'\nQTY+136:0'\nDTM+597:202608010000:203'"],
  ['ambiguous own date',"QTY+220:10500'\nDTM+597:202608010000:203'","QTY+220:10500'\nDTM+597:202608010000:203'\nDTM+597:202608010000:203'"],
  ['impossible own date',"QTY+220:10500'\nDTM+597:202608010000:203'","QTY+220:10500'\nDTM+597:202602310000:203'"],
  ['unknown source offset',"DTM+735:?+0200:406'",""],
  ['conflicting source offsets',"DTM+735:?+0200:406'","DTM+735:?+0200:406'\nDTM+735:?+0100:406'"],
])('does not borrow the interval date for QTY220 with %s', async (reason, segment, replacement) => {
  const input = await prepare()
  input.rawPayload = input.rawPayload.replace(segment,replacement)
  if (reason==='date in a sibling quantity') {
    const quantities=input.transactions[0].quantities
    quantities.splice(2,0,{qualifier:'136',value:0,raw:'QTY+136:0',observationId:'outside-register'})
    input.contracts[0].observations[0].sourceOrdinal=3
  }
  const quantities = prepareUtiltsPersistenceRpcArguments(input).p_transactions[0].quantities
  expect(quantities[1]).not.toHaveProperty('readingAt')
  expect(quantities.at(-1)).toMatchObject({qualifier:'136',value:'500',readingAt:'2026-06-30T22:00:00.000Z'})
})
