// masterplan: U-10, AT-U-10
// Monthly (P1M) steps follow the declared Ediel wall time (+01:00), not the UTC
// instant: a period starting on the 1st at local midnight ends on the 1st of the
// next month. UTC arithmetic overshot after 31-day months and fell one day short
// otherwise, making real monthly E66 readings unresolvable or wrongly bounded.
import {expect,it} from 'vitest'
import {addNormalizedResolution as add,expectedObservationCountForResolution as count} from '@/lib/ediel/utilts/resolution'

it('adds a calendar month in the declared offset for every month of the year',()=>{
 for(let month=0;month<12;month++){
  const from=new Date(Date.UTC(2026,month,1)),to=new Date(Date.UTC(2026,month+1,1))
  const start=`${from.toISOString().slice(0,10)}T00:00:00+01:00`,expected=`${to.toISOString().slice(0,10)}T00:00:00`
  expect(Date.parse(add(start,'P1M')!)).toBe(Date.parse(`${expected}+01:00`))
 }
 expect(add('2026-11-01T00:00:00+01:00','P1M')).toBe('2026-12-01T00:00:00.000+01:00')
})
it('chains steps and counts twelve monthly observations across a +01:00 year',()=>{
 expect(add('2026-11-01T00:00:00+01:00','P1M',2)).toBe('2027-01-01T00:00:00.000+01:00')
 expect(count({start:'2026-01-01T00:00:00+01:00',end:'2027-01-01T00:00:00+01:00',value:'1',format:'802'})).toBe(12)
})
it('keeps floating and UTC values and fixed-duration steps unchanged',()=>{
 expect(add('2026-11-01T00:00','P1M')).toBe('2026-12-01T00:00:00')
 expect(add('2026-11-01T00:00:00.000Z','P1M')).toBe('2026-12-01T00:00:00.000Z')
 expect(Date.parse(add('2026-11-01T00:00:00+01:00','PT15M')!)).toBe(Date.parse('2026-11-01T00:15:00+01:00'))
})
