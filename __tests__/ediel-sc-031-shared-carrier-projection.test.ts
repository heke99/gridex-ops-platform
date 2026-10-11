// masterplan: SC-031, P-02
import {describe,expect,it,vi} from 'vitest'
import {parseInboundProdatBusinessData} from '@/lib/ediel/inboundCases'
import {parseProdatMessage} from '@/lib/ediel/prodat/parser'
import {projectProdatBusinessWire,ignoredProdatSegmentIndexes} from '@/lib/ediel/prodat/prodatIgnoredFieldProjection'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {validateCanonicalPolicyFields} from '@/lib/ediel/rulebook/canonicalPolicyFieldValidator'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import type {ProdatIgnoredField} from '@/lib/ediel/rulebook/fieldMatrix'
import type {EdielMessageRow} from '@/lib/ediel/types'
import {raw,characteristic,alphabets,type Parts} from './fixtures/prodat-register'
import {head,own,source} from './fixtures/prodat-identity'

vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw new Error('Review witness must not access DB')}}}))
function received(wire:string,code:string,subtype:string):EdielMessageRow {
 const t=tokenizeEdifact(wire), fields:ProdatIgnoredField[]=[]
 const app=['Z13','Z14','Z15','Z18'].includes(code)?'23-DGI-PRODAT':'23-DDQ-PRODAT'
 const policy=resolveCanonicalEdielPolicy({family:'PRODAT',messageCode:code,subtypeOrReasonCode:subtype,direction:'inbound',referenceDate:'2026-09-30',mode:'parse',applicationReference:app})
 validateCanonicalPolicyFields({policy,rawPayload:wire,rawSegments:t.segments.map(s=>s.raw),una:t.una,scope:'all',onIgnoredField:field=>{
  if(!fields.some(existing=>JSON.stringify(existing)===JSON.stringify(field)))fields.push(field)
 }})
 return {...source(wire,code),application_reference:app,company_id:'tenant-A',parsed_payload:{canonical:{prodatIgnoredFields:fields}}} as EdielMessageRow
}
const fields=(message:EdielMessageRow)=>(message.parsed_payload.canonical as {prodatIgnoredFields:ProdatIgnoredField[]}).prodatIgnoredFields
const z13=(address='',city='',postcode='',id=''):Parts[]=>[...head(),['LIN','1',...(id?['',[id,'','','89']]:[])],
 ...characteristic('Z13','S17'),['RFF',['LI','OWN-LI']],['RFF',['ANJ','POA']],
 ['NAD','UD',['CUSTOMER-1','','89'],'','ALLOWED-NAME',address,city,'',postcode,'SE']]
const z13wire=(body:Parts[])=>raw(body,'Z13').replace('23-DDQ-PRODAT','23-DGI-PRODAT')

// These are actual-policy/real-consumer component witnesses. We do not assert
// complete application acceptance, actor authorization or native effects.
describe('SC031 proposal must retain shared segment components and physical topology',()=>{
 it('unused Z13 address229 must not remove the same NAD required identity227/name228/country316',()=>{
  const extra=received(z13wire(z13('IGNORED-ADDRESS')),'Z13','V')
  const plain=received(z13wire(z13()),'Z13','V')
  expect(fields(extra).map(f=>f.fieldNumber)).toEqual(['229'])
  expect(parseInboundProdatBusinessData(plain).customer).toMatchObject({customerId:'CUSTOMER-1',fullName:'ALLOWED-NAME',country:'SE'})
  const projection=parseInboundProdatBusinessData(extra)
  expect(projection.customer).toEqual(parseInboundProdatBusinessData(plain).customer)
 })

 it('multiple unused components on the same NAD must bind once per carrier without a false failure',()=>{
  const extra=received(z13wire(z13('IGNORED-ADDRESS','IGNORED-CITY','IGNORED-POSTCODE')),'Z13','V')
  expect(fields(extra).map(f=>f.fieldNumber)).toEqual(expect.arrayContaining(['229','231','232']))
  expect(()=>parseInboundProdatBusinessData(extra)).not.toThrow()
  expect(ignoredProdatSegmentIndexes(extra.raw_payload!,fields(extra))).not.toBeNull()
 })

 it('unused LIN209 must not remove required LIN314 or the topology carrying customer fields',()=>{
  const message=received(z13wire(z13('','','','IGNORED-METER-POINT')),'Z13','V')
  expect(fields(message).map(f=>f.fieldNumber)).toContain('209')
  expect(parseInboundProdatBusinessData(message).customer).toMatchObject({customerId:'CUSTOMER-1',fullName:'ALLOWED-NAME'})
  const projected=projectProdatBusinessWire(message.raw_payload!,fields(message))
  expect(tokenizeEdifact(projected).segments.filter(s=>s.tag==='LIN')).toHaveLength(1)
 })

 it('unused Z13 field242 must preserve required field506 on the same CCI Z14 / CAV pair',()=>{
  const body=z13(),at=body.findIndex(p=>p[0]==='RFF')
  body.splice(at,0,['CCI','','Z14'],['CAV',['','','','IGNORED-PRODUCT','RETAIN-ENERGY']])
  const message=received(z13wire(body),'Z13','V')
  expect(fields(message).map(f=>f.fieldNumber)).toContain('242')
  expect(fields(message).map(f=>f.fieldNumber)).not.toContain('506')
  expect(parseProdatMessage(message).lineItems[0].energyProductId).toBe('RETAIN-ENERGY')
  expect(parseInboundProdatBusinessData(message).meteringPoint.registers).toEqual(expect.arrayContaining([expect.objectContaining({energyProductId:'RETAIN-ENERGY'})]))
  const projected=projectProdatBusinessWire(message.raw_payload!,fields(message))
  expect(parseProdatMessage(projected).lineItems[0].energyProductId).toBe('RETAIN-ENERGY')
 })
})

it.each(alphabets)('supported UNA %j: ignored standalone RFF224 projection retains other business data',(component,element,release,terminator)=>{
 const body=[...head(),...own('1','735123456789012345','CASE-A')]
 const extraBody=[...body];extraBody.splice(extraBody.findIndex(p=>p[0]==='RFF'),0,['RFF',['MG','IGNORED+METER?']])
 const alphabet=[component,element,release,terminator]
 const extraWire=raw(extraBody,'Z01',alphabet),plainWire=raw(body,'Z01',alphabet)
 const extra=received(extraWire,'Z01','L'),plain=received(plainWire,'Z01','L')
 expect(fields(extra).map(f=>f.fieldNumber)).toContain('224')
 expect(parseInboundProdatBusinessData(extra)).toEqual(parseInboundProdatBusinessData(plain))
 expect(extra.raw_payload).toBe(extraWire)
})
