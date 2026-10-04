import {describe,expect,it} from 'vitest'
import {canonicalMessageCode,canonicalLogicalMessageCodeProjection} from '@/lib/ediel/rulebook/canonicalEdielFacade'
describe('canonical logical message identity',()=>{
 it.each(['12','312','313'])('keeps physical APERAK %s under one logical profile',code=>expect(canonicalMessageCode('APERAK',code)).toBe('APERAK'))
 it('keeps ERR and CONTRL identities while preserving business message codes',()=>{
  expect(canonicalMessageCode('UTILTS_ERR','UTILTS_ERR')).toBe('ERR')
  expect(canonicalMessageCode('CONTRL','4')).toBe('CONTRL')
  expect(canonicalMessageCode('PRODAT','Z09')).toBe('Z09')
  expect(canonicalMessageCode('UTILTS','E30')).toBe('E30')
  expect(canonicalLogicalMessageCodeProjection()).toEqual({UTILTS_ERR:'ERR',APERAK:'APERAK',CONTRL:'CONTRL'})
 })
})
