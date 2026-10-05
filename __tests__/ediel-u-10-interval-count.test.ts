// masterplan: U-10, AT-U-10
// "Energy sum is not proof of completeness" is covered by the monthly 802 test
// (ediel-e66-monthly-billing-resolution, tagged).
import {describe,expect,it} from 'vitest'
import {expectedObservationCountForResolution} from '@/lib/ediel/utilts/resolution'

const quarters=(start:string,end:string)=>expectedObservationCountForResolution({start,end,value:'15',format:'806'})

describe('U-10 the interval count follows the actual period, never a fixed 96',()=>{
 it('a normal Swedish day has 96 quarters',()=>{
  expect(quarters('2026-09-30T22:00:00Z','2026-10-01T22:00:00Z')).toBe(96)
 })
 it('the spring DST day (23 h) has 92 and the autumn DST day (25 h) has 100',()=>{
  expect(quarters('2026-03-28T23:00:00Z','2026-03-29T22:00:00Z')).toBe(92)
  expect(quarters('2026-10-24T22:00:00Z','2026-10-25T23:00:00Z')).toBe(100)
 })
 it('a partial period counts only its own intervals; an empty or reversed period has no expected count',()=>{
  expect(quarters('2026-10-01T00:00:00Z','2026-10-01T01:00:00Z')).toBe(4)
  expect(quarters('2026-10-01T01:00:00Z','2026-10-01T00:00:00Z')).toBeNull()
  expect(quarters('2026-10-01T00:00:00Z','')).toBeNull()
 })
})
