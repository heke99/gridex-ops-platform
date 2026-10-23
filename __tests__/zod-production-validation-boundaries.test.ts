import {describe,it,expect} from 'vitest'
import {z} from 'zod'
import {parseTenantCustomerSyncPayload} from '@/lib/customer-portal/customerSyncContract'
import {ApplicationSchema} from '@/lib/website/customerApplicationSchemas'
import {commercialComponentSchema} from '@/lib/pricing/commercialModel'

describe('fixed Zod production schema boundary',()=>{
 it('rejects an oversized constrained array before validating child objects',()=>{
  let checks=0
  const schema=z.array(z.object({value:z.string().superRefine(()=>{checks++})})).max(1)
  expect(schema.safeParse(Array.from({length:256},()=>({value:'x'}))).success).toBe(false)
  expect(checks).toBe(0)
 })
 it('the actual customer sync parser rejects oversized facility data before inspecting children',()=>{
  let reads=0
  const facility_data=Array.from({length:64},()=>Object.defineProperty({},'facility_reference',{enumerable:true,get(){reads++;return 'synthetic'}}))
  expect(()=>parseTenantCustomerSyncPayload({external_customer_id:'synthetic',facility_data})).toThrow()
  expect(reads).toBe(0)
 })
 it('preserves permitted customer metadata records and omitted optional fields',()=>{
  const value=parseTenantCustomerSyncPayload({external_customer_id:'synthetic',metadata:{arbitrary:{nested:true},count:2},facility_data:[{facility_reference:'one'}]})
  expect(value.metadata).toEqual({arbitrary:{nested:true},count:2})
  expect(value).not.toHaveProperty('profile')
  expect(value.facility_data).toEqual([{facility_reference:'one'}])
 })
 it('preserves the website customer inner default when its object is omitted',()=>{
  expect(ApplicationSchema.shape.customer.parse(undefined)).toEqual({customer_type:'private'})
 })
 it('preserves the commercial component condition inner defaults',()=>{
  const value=commercialComponentSchema.parse({component_reference:'synthetic_fee',component_code:'synthetic_fee',internal_name:'Fee',customer_name:'Fee',component_type:'commercial_fee',amount:1,unit:'sek_month',calculation_type:'per_month',vat_treatment:'standard',selection_policy:'mandatory',default_selected:true,customer_can_deselect:false,admin_must_select:false,lifecycle:'recurring',periodization_rule:'active_days',invoice_line_name:'Fee',accounting_classification:'electricity_revenue',sort_order:1})
  expect(value.conditions).toEqual({contract_types:[],price_option_references:[],price_areas:[],customer_types:[],invoice_delivery_methods:[],sales_channels:[],minimum_site_count:null,maximum_site_count:null,minimum_annual_consumption_kwh:null,maximum_annual_consumption_kwh:null,valid_from:null,valid_to:null})
 })
})
