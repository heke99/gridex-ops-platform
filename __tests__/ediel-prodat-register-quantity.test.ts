import { describe, expect, it } from 'vitest'
import { parseEdifactMessageFacts } from '@/lib/ediel/core/edifactSegments'
import { prodatRegisterFieldState } from '@/lib/ediel/prodat/prodatRegisterFields'
import { parseUna } from '@/lib/ediel/core/una'
import { alphabets, line, qty, raw } from './fixtures/prodat-register'
// P26.A revision3 p54: QTY/C186/6060 is n..15, no decimal places.
// This is a lexical field-limit oracle, not a claim that every business value is sensible.
for (const alphabet of alphabets) describe(`field213 integer limit ${alphabet.join('')}`,()=>{
 for (const value of ['0','1','999999999999999']) it(`preserves the valid integer ${value}`,()=>{
  const payload=raw([line('1','A'),qty(value)],'Z04',alphabet)
  expect(prodatRegisterFieldState('213',parseEdifactMessageFacts(payload).lineItems[0].segments,parseUna(payload))).toMatchObject({present:true,value,malformed:false})
 })
 for (const value of ['1000000000000000','1.5','1,5','1e3','']) it(`rejects the nonconforming quantity ${value}`,()=>{
  const payload=raw([line('1','A'),qty(value)],'Z04',alphabet)
  expect(prodatRegisterFieldState('213',parseEdifactMessageFacts(payload).lineItems[0].segments,parseUna(payload))?.malformed).toBe(true)
 })
})
