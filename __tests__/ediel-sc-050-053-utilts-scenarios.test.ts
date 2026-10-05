// masterplan: SC-050, SC-053
// SC-050: a full +0100 (winter) day at 15 minutes with 88 of 96 energy values is
// rejected with E87 even when the energy total equals the complete control.
// SC-053: a missing observation keeps a null value and its own quality, a
// verified zero keeps 0, and readings (QTY 220) never merge with energy (QTY 136).
import {describe,expect,it} from 'vitest'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {parseCanonicalEdifactAst} from '@/lib/ediel/core/canonicalEdifactAst'
import {utiltsPhysicalQuantityQuality} from '@/lib/ediel/utilts/canonicalObservationScope'
import {parseUna} from '@/lib/ediel/core/una'
import {mapMeteringQuality} from '@/lib/ediel/metering/meteringQualityMapper'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'

// A full winter day in +0100 (Swedish standard time), 15-minute resolution.
const day=(skip:(i:number)=>boolean,value:number)=>{
 const source=energyHandoffMessage('2026-10-01'),lines=source.raw_payload!.split('\n'),at=lines.findIndex(l=>l.startsWith('SEQ+'))
 const head=lines.slice(0,at).map(l=>l.replace("DTM+735:?+0200:406'","DTM+735:?+0100:406'")
  .replace('DTM+137:202610011811:203','DTM+137:202601161811:203')
  .replace('202607010000202607010015:719','202601150000202601160000:719').replace('DTM+597:202607010020:203','DTM+597:202601160020:203'))
 const obs:string[]=[];let seq=0
 for(let i=0;i<96;i++){if(skip(i))continue;seq++
  const ts=new Date(Date.UTC(2026,0,15)+i*900000).toISOString().slice(0,16).replace(/[-T:]/g,'')
  obs.push(`SEQ++${seq}'`,`QTY+136:${value}'`,`DTM+597:${ts}:203'`,"STS+7++21::260'")}
 return {...source,raw_payload:recountEdifactUnt([...head,...obs,"UNT+0+1'",lines[lines.length-1]].join('\n'))}
}

describe('SC-050 88 of 96 quarters',()=>{
 it('a matching energy total does not mask eight missing quarters; E87 makes the gap visible',()=>{
  const complete=runUtiltsRuntimeForMessage(day(()=>false,11),{referenceDate:'2026-01-16'})
  const gap=runUtiltsRuntimeForMessage(day(i=>i>=40&&i<48,12),{referenceDate:'2026-01-16'})
  expect(day(()=>false,11).raw_payload).toContain("DTM+735:?+0100:406'")
  expect(96*11).toBe(88*12)
  expect(complete.ackPlan.utiltsErrCodes).toEqual([])
  expect(gap.ackPlan.utiltsErrCodes).toContain('E87');expect(gap.ackPlan.shouldSendUtiltsErr).toBe(true)
  const count=gap.validation.issues.find(i=>i.utiltsErrCode==='E87')
  expect(count?.description).toMatch(/88/);expect(count?.description).toMatch(/96/)
 })
})

describe('SC-053 NULL is not zero',()=>{
 const raw="UNA:+.? 'UNB+UNOC:3+11111:ZZ+22222:ZZ+260921:1000+I++23-DDQ-E66-S'UNH+M+UTILTS:D:02B:UN:E5SE5A'BGM+E66+DOC+9'"+
  "IDE+24+T1'SEQ++1'QTY+136:'STS+8+46'SEQ++2'QTY+136:0'STS+8+21'SEQ++3'QTY+220:123'UNT+11+M'UNZ+1+I'"
 const message=parseCanonicalEdifactAst(raw).messages[0] as unknown as {utiltsTransactions:Array<{observations:Array<{quantities:Array<{qualifier:string|null;value:string|null}>}>}>,una?:unknown}
 const [missing,zero,reading]=message.utiltsTransactions[0].observations
 const una=parseUna(raw)
 it('keeps a missing value null with quality 46 and a verified zero as 0 with quality 21',()=>{
  expect(missing.quantities[0]).toMatchObject({qualifier:'136',value:null})
  expect(zero.quantities[0]).toMatchObject({qualifier:'136',value:'0'})
  expect(utiltsPhysicalQuantityQuality(missing as never,missing.quantities[0] as never,una)).toBe('46')
  expect(utiltsPhysicalQuantityQuality(zero as never,zero.quantities[0] as never,una)).toBe('21')
  expect(mapMeteringQuality('46')).toBe('missing');expect(mapMeteringQuality('46')).not.toBe(mapMeteringQuality('136'))
 })
 it('keeps a meter reading (QTY 220) as its own observation, never merged into energy',()=>{
  expect(reading.quantities.map(q=>[q.qualifier,q.value])).toEqual([['220','123']])
  expect(message.utiltsTransactions[0].observations.flatMap(o=>o.quantities).filter(q=>q.qualifier==='136')).toHaveLength(2)
 })
})
