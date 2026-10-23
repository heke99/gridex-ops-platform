import {describe,it,expect} from 'vitest'
import {z} from 'zod'
import {parseTenantCustomerSyncPayload} from '@/lib/customer-portal/customerSyncContract'
import {ApplicationSchema} from '@/lib/website/customerApplicationSchemas'
import {commercialComponentSchema} from '@/lib/pricing/commercialModel'
import {gridOwnerInputSchema,electricitySupplierInputSchema,priceAreaLocalityInputSchema,customerSiteInputSchema,meteringPointInputSchema} from '@/lib/masterdata/validators'

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


const tenant='11111111-1111-4111-8111-111111111111',customer='22222222-2222-4222-8222-222222222222',site='44444444-4444-4444-8444-444444444444'
const pointInput=()=>({company_id:tenant,customer_id:customer,site_id:site,meter_point_id:'fixture-point',measurement_type:'consumption',reading_frequency:'hourly'})
const siteInput=()=>({company_id:tenant,customer_id:customer,site_name:'Home',site_type:'consumption'})

describe('masterdata omission and normalization contract',()=>{
 it('accepts an omitted facility reference and end date while keeping explicit null outputs',()=>{
  expect(meteringPointInputSchema.parse(pointInput())).toMatchObject({site_facility_id:null,ediel_reference:null,start_date:null,end_date:null,status:'draft'})
 })
 it('keeps omitted grid owner contact fields normalized to null',()=>{
  expect(gridOwnerInputSchema.parse({name:'Owner',owner_code:'16700'})).toMatchObject({ediel_id:null,org_number:null,communication_email:null,contact_name:null,phone:null,notes:null})
 })
 it('keeps omitted supplier contact fields normalized to null',()=>{
  expect(electricitySupplierInputSchema.parse({name:'Supplier'})).toMatchObject({org_number:null,ediel_id:null,contact_name:null,phone:null,notes:null})
 })
 it('keeps omitted locality fields normalized to null',()=>{
  expect(priceAreaLocalityInputSchema.parse({price_area_code:'SE3',locality_name:'Town'})).toMatchObject({municipality:null,postal_code:null})
 })
 it('keeps omitted site text and annual consumption normalized to null',()=>{
  expect(customerSiteInputSchema.parse(siteInput())).toMatchObject({facility_id:null,move_in_date:null,annual_consumption_kwh:null,current_supplier_name:null,street:null,internal_notes:null,status:'draft',country:'SE'})
 })
 it('preserves trimming, explicit null, blank text and numeric input normalization',()=>{
  expect(meteringPointInputSchema.parse({...pointInput(),site_facility_id:'  FAC  ',ediel_reference:'  ',end_date:null})).toMatchObject({site_facility_id:'FAC',ediel_reference:null,end_date:null})
  expect(customerSiteInputSchema.parse({...siteInput(),annual_consumption_kwh:'42.5',street:'  Street  '})).toMatchObject({annual_consumption_kwh:42.5,street:'Street'})
 })
 it('still rejects missing required identities, invalid enums and wrong nullable input types',()=>{
  expect(gridOwnerInputSchema.safeParse({owner_code:'16700'}).success).toBe(false)
  expect(customerSiteInputSchema.safeParse({customer_id:customer,site_name:'Home',site_type:'consumption'}).success).toBe(false)
  expect(meteringPointInputSchema.safeParse({...pointInput(),site_id:undefined}).success).toBe(false)
  expect(meteringPointInputSchema.safeParse({...pointInput(),measurement_type:'invalid'}).success).toBe(false)
  expect(meteringPointInputSchema.safeParse({...pointInput(),end_date:123}).success).toBe(false)
  expect(customerSiteInputSchema.safeParse({...siteInput(),annual_consumption_kwh:'invalid'}).success).toBe(false)
 })
})
