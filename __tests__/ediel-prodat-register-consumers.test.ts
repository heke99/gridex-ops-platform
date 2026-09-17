import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseInboundProdat } from '@/lib/ediel/prodat/compatAdapter'
import { parseInboundProdatBusinessData, createOrUpdateInboundProdatCase } from '@/lib/ediel/inboundCases'
import { parseProdatMessage } from '@/lib/ediel/prodat/parser'
import { canonicalMessageFacts } from '@/lib/ediel/core/canonicalEdifactAst'
import { validateProdat } from '@/lib/ediel/prodat/validateProdat'
import { compareInboundPayloadToTgtTestData } from '@/lib/ediel/testing/tgtAutoMatcher'
import type { EdielMessageRow } from '@/lib/ediel/types'
import type { EdielTgtCaseTestData } from '@/lib/ediel/testing/tgtTestData'
import { alphabets, line, qty, common, characteristic, raw, type Parts } from './fixtures/prodat-register'

// Actual consumer modules, explicit in-memory database boundary. No live writes.
const db = vi.hoisted(() => ({from:vi.fn(),event:vi.fn(),link:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:db}))
vi.mock('@/lib/ediel/db',()=>({createEdielMessageEvent:db.event,linkEdielMessage:db.link}))
beforeEach(()=>{vi.clearAllMocks(); db.from.mockImplementation(()=>{throw new Error('Unexpected database access')})})
const message = (payload: string): EdielMessageRow => ({id:'synthetic',company_id:'A',direction:'inbound',message_family:'PRODAT',message_code:'Z04',raw_payload:payload,environment:'test',parsed_payload:{meterPointId:'STALE'}} as unknown as EdielMessageRow)
const body = (): Parts[] => [line('1','A:local','1'),qty('10'),...common('A:local','Customer A'),line('2','A:local','2'),qty('20'),...common('A:local','IGNORED'),line('3','B:local'),qty('30'),...common('B:local','Customer B')]
const td = (rows: Record<string,string>[]): EdielTgtCaseTestData => {
 const columns=rows.map((_,i)=>({name:`reg${i}`,index:i,sourceOrder:i,testCase:'SYNTHETIC-REGISTER'}))
 const fields=[...new Set(rows.flatMap(Object.keys))].map(fieldCode=>({fieldCode,fieldName:fieldCode,values:Object.fromEntries(columns.map((c,i)=>[c.name,rows[i][fieldCode] ?? '']))}))
 const block={kind:'PRODAT' as const,sourceWorkbook:'synthetic',sourceSheet:'synthetic',entityLabel:'Register',entityNumbers:['1'],columns,fields}
 return {suite:'PRODAT',roleCode:'supplier',testCaseCode:'SYNTHETIC-REGISTER',title:'Synthetic source fixture',sourceNote:'Not external portal certification',groups:[{block,columns,fields}]}
}
for (const alphabet of alphabets) describe(`register consumers with UNA ${alphabet.join('')}`,()=>{
 it('compat ingress retains all indexed line items and exact raw evidence',()=>{
  const payload=raw(body(),'Z04',alphabet)
  expect(parseInboundProdat(payload).parsedPayload.lineItems).toEqual(parseProdatMessage(payload).lineItems)
 })
 it('staging keeps all registers under their own object, never stale identity',()=>{
  const staged=parseInboundProdatBusinessData(message(raw(body(),'Z04',alphabet)))
  expect(staged.meteringPoint.meterPointId).toBe('A:local')
  expect(staged.meteringPoint.registers).toMatchObject([{registerIndex:'1',annualConsumption:'10'},{registerIndex:'2',annualConsumption:'20'}])
  expect(staged.proposedAction.objects).toMatchObject([
   {meteringPointId:'A:local',identityAgency:'89',registers:[{endUserName:'Customer A'},{endUserName:'Customer A'}]},
   {meteringPointId:'B:local',identityAgency:'89',registers:[{endUserName:'Customer B'}]},
  ])
  expect(staged.site.annualEnergyKwh).toBe(10)
  expect(db.from).not.toHaveBeenCalled()
 })
 it('canonical business facts ignore repeated register-2 subtype',()=>{
  const payload=raw([line('1','A','1'),qty('1'),...characteristic('Z13','Z22'),line('2','A','2'),qty('2'),...characteristic('Z13','S18')],'Z04',alphabet)
  expect(canonicalMessageFacts(payload).cciCavCodes.Z13).toEqual(['Z22'])
 })
 it('generic validation rejects malformed C829 even when ordinary envelope is valid',()=>{
  const payload=raw([line('1','A','1'),qty('1'),...common('A','A'),line('2','A','3'),qty('2')],'Z04',alphabet)
  expect(validateProdat(payload).issues.some(i=>i.code==='prodat_register_invalid')).toBe(true)
 })
 it('invalid register chain is stopped before customer lookups or staging writes',async()=>{
  const payload=raw([line('1','A','1'),qty('1'),line('2','A','1'),qty('2')],'Z04',alphabet)
  await expect(createOrUpdateInboundProdatCase({actorUserId:'actor',message:message(payload)})).rejects.toThrow('PRODAT_REGISTER_STRUCTURE_INVALID')
  expect(db.from).not.toHaveBeenCalled()
 })
 it('TGT matches each exact object/register quantity instead of selecting its first column',()=>{
  const payload=raw(body(),'Z04',alphabet)
  const testData=td([{'209':'A:local','258':'1','213':'10'},{'209':'A:local','258':'2','213':'20'},{'209':'B:local','213':'30'}])
  expect(compareInboundPayloadToTgtTestData({message:message(payload),testData})).toEqual([])
 })
 it('TGT rejects a wrong second quantity even if its value occurs elsewhere',()=>{
  const payload=raw(body(),'Z04',alphabet)
  const testData=td([{'209':'A:local','258':'1','213':'10'},{'209':'A:local','258':'2','213':'30'},{'209':'B:local','213':'30'}])
  expect(compareInboundPayloadToTgtTestData({message:message(payload),testData})).toContainEqual(expect.objectContaining({fieldCode:'213',expected:'30',actual:'20',registerIndex:'2'}))
 })
 it('TGT cannot silently accept a missing expected register',()=>{
  const payload=raw([line('1','A:local'),qty('10')],'Z04',alphabet)
  const testData=td([{'209':'A:local','258':'1','213':'10'},{'209':'A:local','258':'2','213':'20'}])
  expect(compareInboundPayloadToTgtTestData({message:message(payload),testData}).some(i=>i.fieldCode==='258')).toBe(true)
 })
 it('TGT exact local identifiers do not normalize away punctuation',()=>{
  const payload=raw([line('1','AB'),qty('10')],'Z04',alphabet)
  expect(compareInboundPayloadToTgtTestData({message:message(payload),testData:td([{'209':'A:B','213':'10'}])}).some(i=>i.fieldCode==='209')).toBe(true)
 })
 it('TGT compares constants as exact values, not punctuation-stripped numbers',()=>{
  const payload=raw([line('1','A'),qty('1'),...characteristic('Z02','1.2',3)],'Z04',alphabet)
  expect(compareInboundPayloadToTgtTestData({message:message(payload),testData:td([{'209':'A','214':'12'}])}).some(i=>i.fieldCode==='214')).toBe(true)
 })
})
