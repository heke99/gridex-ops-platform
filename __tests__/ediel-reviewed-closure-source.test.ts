import {expect,it} from 'vitest'
import {isReviewedClosureBusiness} from '@/lib/ediel/sources/reviewedClosureSource'
import {closureMarkerFixture} from './helpers/closureOwnerFixtures'

it('recognizes closed structural-coverage closure shape without treating it as authority',()=>{
  const {raw,scope,business}=closureMarkerFixture()
  expect(isReviewedClosureBusiness(business,raw,scope)).toBe(true)
})
it.each(['approved','meterNumber','registers','replaces','effectiveFrom'])('rejects extraneous marker field %s',key=>{
  const {raw,scope,business}=closureMarkerFixture()
  expect(isReviewedClosureBusiness({...business,[key]:true},raw,scope)).toBe(false)
})
it.each([
  ['minute',(b:Record<string,unknown>)=>{b.wire={...(b.wire as object),effectiveTo:{fieldNumber:'211',marketMinute:'202610151235',utc:'2026-10-15T11:35:00.000Z'}}}],
  ['case',(b:Record<string,unknown>)=>{b.wire={...(b.wire as object),caseReference:'FORGED'}}],
  ['day',(b:Record<string,unknown>)=>{b.legacyEndDateProjection='2026-10-14'}],
  ['review',(b:Record<string,unknown>)=>{b.reviewStatement='original_structural_message'}],
  ['baseline',(b:Record<string,unknown>)=>{b.baselineCoverageAssessment={...(b.baselineCoverageAssessment as object),sourceMessageId:b.sourceMessageId}}],
  ['latest',(b:Record<string,unknown>)=>{b.baselineCurrentAssessmentId=b.reviewerUserId}],
  ['source hash',(b:Record<string,unknown>)=>{b.sourcePayloadHash='x'}],
  ['prior end',(b:Record<string,unknown>)=>{b.coverageWindow={...(b.coverageWindow as object),validTo:'2026-10-15T11:35:00Z'}}],
  ['stop before start',(b:Record<string,unknown>)=>{b.coverageWindow={...(b.coverageWindow as object),validFrom:'2026-10-15T11:34:00Z'}}],
] as const)('rejects malformed or original-inconsistent %s',(_name,mutate)=>{
  const {raw,scope,business}=closureMarkerFixture();mutate(business)
  expect(isReviewedClosureBusiness(business,raw,scope)).toBe(false)
})
it('allows an identical prior coverage end and preserves the original baseline window',()=>{
  const {raw,scope,business}=closureMarkerFixture()
  const value={...business,coverageWindow:{...business.coverageWindow,validTo:'2026-10-14T23:00:00.000Z'}}
  const before=structuredClone(value)
  expect(isReviewedClosureBusiness(value,raw,scope)).toBe(true);expect(value).toEqual(before)
})
it.each([['test'],['production']])('rejects coerced environment %j',environment=>{
  const {raw,scope,business}=closureMarkerFixture()
  expect(isReviewedClosureBusiness({...business,environment:[environment]},raw,scope)).toBe(false)
})
it('keeps a well-formed non-midnight original outside the bounded closure owner',()=>{
  const {raw,scope,business}=closureMarkerFixture()
  // Parser support is broader than this source-backed business-owner subset.
  const nonMidnight=raw.replace('202610150000','202610151234')
  const value={...business,wire:{...business.wire,effectiveTo:{fieldNumber:'211',marketMinute:'202610151234',utc:'2026-10-15T11:34:00.000Z'}}}
  expect(isReviewedClosureBusiness(value,nonMidnight,scope)).toBe(false)
})
