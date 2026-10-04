// masterplan: ACK-02, AT-ACK-02
// BGM 27 (whole message rejected) with ERC 42 and the national field reference is
// proven in __tests__/ediel-prodat-common-header-rejection.test.ts (also tagged).
import {describe,expect,it} from 'vitest'
import {buildAperakDraft} from '@/lib/ediel/ack'
import {resolveProdatAckMessageFunction} from '@/lib/ediel/prodat/prodatAckMessageFunction'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {segmentComposite,tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {raw,line} from './fixtures/prodat-register'
import {head,source} from './fixtures/prodat-identity'
import type {EdielMessageRow} from '@/lib/ediel/types'

const point='735123456789012345'
const original=raw([...head(),line('1',point,undefined,'9'),['RFF',['LI','OWN-A']]],'Z06')
const sourceMessage={...source(original,'Z06'),company_id:'company'} as unknown as EdielMessageRow
const positive=()=>EdifactEnvelopeCodec.decode(buildAperakDraft({sourceMessage,outcome:'positive'}).rawPayload)
const values=(wire:ReturnType<typeof positive>,tag:string,qualifier?:string)=>wire.segments.filter(s=>s.tag===tag&&(!qualifier||segmentComposite(s,1,wire.una)[0]===qualifier))

describe('ACK-02 PRODAT APERAK (D96A/E2SE6A) structure',()=>{
 it('uses APERAK D96A/E2SE6A with BGM 1225=34 for a processed message and no own 1001/1004 id',()=>{
  const wire=positive()
  expect(wire.segments.find(s=>s.tag==='UNH')!.raw).toContain('APERAK:D:96A:UN:E2SE6A')
  const bgm=wire.segments.find(s=>s.tag==='BGM')!
  expect(bgm.raw).toBe('BGM+++34')
  expect(resolveProdatAckMessageFunction({sourceWire:tokenizeEdifact(original),hasProdatWire:true,messageCode:'Z06',outcome:'positive'})).toBe('34')
 })
 it('references the original BGM document id with ACW and builds RFF+Z07/LI with ERC 100 for the object',()=>{
  const wire=positive()
  const originalBgm=segmentComposite(tokenizeEdifact(original).segments.find(s=>s.tag==='BGM')!,2,tokenizeEdifact(original).una)[0]
  expect(values(wire,'RFF','ACW').map(s=>segmentComposite(s,1,wire.una)[1])).toEqual([originalBgm])
  expect(values(wire,'ERC').map(s=>segmentComposite(s,1,wire.una)[0])).toEqual(['100'])
  expect(values(wire,'RFF','Z07').map(s=>segmentComposite(s,1,wire.una)[1])).toEqual([point])
  expect(values(wire,'RFF','LI').map(s=>segmentComposite(s,1,wire.una)[1])).toEqual(['OWN-A'])
 })
 it('never uses UTILTS APERAK BGM 312/313, DOC/DM or a transaction ACW for PRODAT',()=>{
  const wire=positive()
  expect(wire.segments.filter(s=>s.tag==='BGM').map(s=>s.raw).join()).not.toMatch(/312|313/)
  expect(wire.segments.some(s=>s.tag==='DOC')).toBe(false)
  expect(values(wire,'RFF','DM')).toEqual([])
  expect(values(wire,'RFF','ACW').map(s=>segmentComposite(s,1,wire.una)[1])).not.toContain('OWN-A')
 })
})
