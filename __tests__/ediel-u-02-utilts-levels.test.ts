// masterplan: U-02, AT-U-02
// Each SG5/IDE keeps its own LOC object and QTY observations; the first LOC
// or QTY in the file is never reused for later transactions.
import {expect,it} from 'vitest'
import {runUtiltsRuntimeForMessage} from '@/lib/ediel/utiltsEngine'
import {energyHandoffMessage} from './helpers/utiltsObservationHandoff'
import {recountEdifactUnt} from './helpers/recountEdifactUnt'

const gs1=(body:string)=>{const sum=[...body].reverse().reduce((s,d,i)=>s+Number(d)*(i%2===0?3:1),0);return body+String((10-sum%10)%10)}
const second=gs1('73599926073100001')

it('two IDE transactions keep their own object and energy instead of the first LOC/QTY in the file',()=>{
 const source=energyHandoffMessage('2026-10-01'),lines=source.raw_payload!.split('\n')
 const ide=lines.findIndex(l=>l.startsWith('IDE+')),unt=lines.findIndex(l=>l.startsWith('UNT+'))
 const block=lines.slice(ide,unt).map(l=>l.replace('GRIDEX2607E66001','GRIDEX2607E66002').replace('735999260731000007',second).replace('QTY+136:500','QTY+136:700'))
 const raw_payload=recountEdifactUnt([...lines.slice(0,unt),...block,...lines.slice(unt)].join('\n'))
 const result=runUtiltsRuntimeForMessage({...source,raw_payload},{referenceDate:'2026-10-01'})
 const tx=result.facts.transactions
 expect(tx).toHaveLength(2)
 expect(tx.map(t=>t.meterPointId)).toEqual(['735999260731000007',second])
  const dispositions=(result as unknown as {transactionDispositions:Array<{transactionId:string|null}>}).transactionDispositions
 expect(dispositions.map(d=>d.transactionId)).toEqual(['GRIDEX2607E66001','GRIDEX2607E66002'])
 expect(tx.map(t=>t.quantities.filter(q=>q.qualifier==='136').map(q=>q.value))).toEqual([[500],[700]])
})
