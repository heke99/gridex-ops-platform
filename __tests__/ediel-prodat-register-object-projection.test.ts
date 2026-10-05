import { describe, expect, it, vi } from 'vitest'
import { parseInboundProdatBusinessData } from '@/lib/ediel/inboundCases'
import type { EdielMessageRow } from '@/lib/ediel/types'
import { line, qty, common, raw, alphabets } from './fixtures/prodat-register'
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from:()=>{throw new Error('No database access in projection')}}}))
const project=parseInboundProdatBusinessData as (m:EdielMessageRow,object?:{meteringPointId:string;identityAgency:string})=>ReturnType<typeof parseInboundProdatBusinessData>
for(const alphabet of alphabets) describe(`source-bound customer object projection ${alphabet.join('')}`,()=>{
 const m=(segments:Parameters<typeof raw>[0])=>({id:'source',company_id:'tenant-A',message_family:'PRODAT',message_code:'Z04',direction:'inbound',environment:'test',message_standard:'edifact',raw_payload:raw(segments,'Z04',alphabet),parsed_payload:{meterPointId:'STALE'}} as unknown as EdielMessageRow)
 const body=[line('1','A','1'),qty('10'),...common('A','Customer A'),line('2','A','2'),qty('20'),...common('A','IGNORED'),line('3','B'),qty('30'),...common('B','Customer B')]
 it('selects B by exact identity and never applies the first object customer or quantity',()=>{
  const p=project(m(body),{meteringPointId:'B',identityAgency:'89'})
  expect(p.customer.fullName).toBe('Customer B')
  expect(p.site).toMatchObject({facilityId:'B',annualEnergyKwh:30})
  expect(p.meteringPoint.registers).toMatchObject([{meteringPointId:'B',annualConsumption:'30'}])
  expect(p.proposedAction.objects).toHaveLength(1)
 })
 it('retains both A registers and authoritative first-register common fields',()=>{
  const p=project(m(body),{meteringPointId:'A',identityAgency:'89'})
  expect(p.customer.fullName).toBe('Customer A')
  expect(p.meteringPoint.registers).toMatchObject([{annualConsumption:'10',endUserName:'Customer A'},{annualConsumption:'20',endUserName:'Customer A'}])
 })
 it('rejects wrong agency rather than falling back to first object',()=>{
  expect(()=>project(m(body),{meteringPointId:'B',identityAgency:'9'})).toThrow('PRODAT_OBJECT_SELECTION_INVALID')
 })
 it('rejects invalid register chains before projecting customer data',()=>{
  expect(()=>project(m([line('1','A','1'),qty('10'),line('2','A','1'),qty('20')]),{meteringPointId:'A',identityAgency:'89'})).toThrow('PRODAT_OBJECT_SELECTION_INVALID')
 })
})
