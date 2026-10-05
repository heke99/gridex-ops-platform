// masterplan: U-09, AT-U-09
import {describe,expect,it,vi} from 'vitest'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw Error('no database access expected')},rpc:()=>{throw Error('no rpc expected')}}}))
import {estimatedItems,estimatePayload} from '@/lib/billing/underlayEngine'
import type {ConsumptionEstimate} from '@/lib/billing/consumptionEstimate'

const annual:ConsumptionEstimate={method:'annual_consumption_profile',referenceStart:null,referenceEnd:null,estimatedKwh:3,
 intervals:[{period_start:'2026-07-01T00:00:00Z',period_end:'2026-07-01T00:15:00Z',quantity_kwh:2},
  {period_start:'2026-07-01T00:15:00Z',period_end:'2026-07-01T00:30:00Z',quantity_kwh:0},
  {period_start:'2026-07-01T00:30:00Z',period_end:'2026-07-01T00:45:00Z',quantity_kwh:1}]}

describe('U-09 an annual forecast is never stored as actual quarter energy',()=>{
 it('estimate lines are marked estimated, come from no metering value and carry their method',()=>{
  const items=estimatedItems(annual,{company_id:'c',contract_id:'k'})
  for(const item of items)expect(item).toMatchObject({source_table:'consumption_estimate',source_normalized_metering_value_id:null,quality_code:'estimated',
   metadata:{estimated:true,estimate_method:'annual_consumption_profile'}})
  expect(items.some(i=>i.quality_code==='actual'||i.source_table==='normalized_metering_values')).toBe(false)
 })
 it('missing/zero intervals are never filled with zero lines',()=>{
  expect(estimatedItems(annual,{}).map(i=>i.period_start)).toEqual(['2026-07-01T00:00:00Z','2026-07-01T00:30:00Z'])
 })
 it('the invoice basis is flagged preliminary with estimated and actual kWh kept apart',()=>{
  expect(estimatePayload(annual,'0')).toEqual({method:'annual_consumption_profile',reference_start:null,reference_end:null,estimated_kwh:3,actual_kwh:'0',
   estimated_interval_count:3,preliminary:true})
 })
})
