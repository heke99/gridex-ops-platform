// masterplan: U-06, AT-U-06
import {describe,expect,it} from 'vitest'
import {getUtiltsApplicationReferenceTarget as target,isStaticUtiltsApplicationReferenceAllowed as allowed} from '@/lib/ediel/rulebook/utiltsApplicationReference'

describe('U-06 E73/E74 Application Reference names the requested S02/E66 or S03/E31',()=>{
 it('resolves exactly the requested target from the reference',()=>{
  expect(target({messageCode:'E73',applicationReference:'23-DDQ-S02-S'})).toBe('S02')
  expect(target({messageCode:'E73',applicationReference:'23-DGI-E66-T'})).toBe('E66')
  expect(target({messageCode:'E74',applicationReference:'23-DDK-S03-S'})).toBe('S03')
  expect(target({messageCode:'E74',applicationReference:'23-DDQ-E31-T'})).toBe('E31')
 })
 it('never builds or accepts a generic 23-DGI-E73 reference or an unscoped request',()=>{
  for(const reference of ['23-DGI-E73','23-DGI-E73-S','23-DDQ-E74-S'])
   expect(()=>target({messageCode:reference.includes('E74')?'E74':'E73',applicationReference:reference})).toThrow(/target_invalid/)
  // Two possible targets and no reference: refused, not defaulted to "all data".
  expect(()=>target({messageCode:'E73'})).toThrow('utilts_request_application_reference_target_invalid:E73:missing')
  expect(()=>target({messageCode:'E74'})).toThrow('utilts_request_application_reference_target_invalid:E74:missing')
 })
 it('a reference for the other request type or a target outside the request is refused',()=>{
  expect(()=>target({messageCode:'E73',applicationReference:'23-DDQ-E31-S'})).toThrow(/target_invalid/)
  expect(()=>target({messageCode:'E74',requestedMessageCode:'E66'})).toThrow('utilts_request_application_reference_target_invalid:E74:E66')
  expect(allowed({messageCode:'E73',requestedMessageCode:'S02',applicationReference:'23-DDQ-S02-S'})).toBe(true)
  expect(allowed({messageCode:'E73',requestedMessageCode:'S02',applicationReference:'23-DGI-E66-S'})).toBe(false)
 })
})
