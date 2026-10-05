// masterplan: SC-052
// An ESCO/DGI request for missing E66 values names the requested E66-DGI
// profile; it never derives a generic E73 reference and never turns a DGI
// E66 reference into an S02 forecast request.
import {expect,it} from 'vitest'
import {canonicalSupplierUtiltsApplicationReference as reference} from '@/lib/ediel/rulebook/canonicalEdielFacade'
import {getUtiltsApplicationReferenceTarget as target} from '@/lib/ediel/rulebook/utiltsApplicationReference'
import {resolveApplicationReference} from '@/lib/ediel/core/applicationReferenceResolver'

it('an E73 for missing E66 in the DGI role carries the E66-DGI reference and an explicit requested type',()=>{
 for(const ref of ['23-DGI-E66-S','23-DGI-E66-T']){
  expect(reference({code:'E73',requestedMessageCode:'E66',applicationReference:ref})).toBe(ref)
  expect(target({messageCode:'E73',applicationReference:ref})).toBe('E66')
  expect(resolveApplicationReference({messageFamily:'UTILTS',businessCode:'E73',requestedMessageCode:'E66',routeProfile:{applicationReference:ref}})).toBe(ref)
 }
})
it('never derives a generic E73 reference and never assumes S02 from a DGI E66 route',()=>{
 expect(()=>reference({code:'E73',requestedMessageCode:'E66',applicationReference:'23-DGI-E73-S'})).toThrow(/not_allowed|invalid/)
 expect(()=>reference({code:'E73',requestedMessageCode:'S02',applicationReference:'23-DGI-E66-T'})).toThrow(/not_allowed/)
 expect(()=>resolveApplicationReference({messageFamily:'UTILTS',businessCode:'E73',requestedMessageCode:'S02',routeProfile:{applicationReference:'23-DGI-E66-S'}})).toThrow()
 // E66 has several valid references, so without an explicit DGI route value nothing is defaulted.
 expect(()=>reference({code:'E73',requestedMessageCode:'E66'})).toThrow(/explicit_value_required/)
})
