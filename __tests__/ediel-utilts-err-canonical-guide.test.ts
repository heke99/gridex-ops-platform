// masterplan: ACK-05, AT-ACK-05, U-13, AT-U-13
import {describe,expect,it} from 'vitest'
import {EdifactEnvelopeCodec} from '@/lib/ediel/core/edifactEnvelopeCodec'
import {tokenizeEdifact} from '@/lib/ediel/core/edifactTokenizer'
import {resolveCanonicalEdielPolicy} from '@/lib/ediel/rulebook/canonicalEdielPolicy'
import {CANONICAL_UTILTS_ERR_GUIDE_CONSTRAINTS,CANONICAL_UTILTS_ERR_REASON_GUIDE_SCOPES,canonicalUtiltsErrReasonsForPolicy,validateCanonicalAckGuide} from '@/lib/ediel/rulebook/ackGuidePolicy'
const copy=['LOC+172+POINT::9','LOC+239+AAA:SVK:260','NAD+DDK+52102:SVK:260','NAD+DDQ+52101:SVK:260','PIA+1+V1:PT:SVK:260','DTM+324:202609290000202609300000:719','STS+7++E03::260']
function envelope(segments:string[],original=false){return EdifactEnvelopeCodec.encode({sender:original?'GRID':'SUPPLIER',receiver:original?'SUPPLIER':'GRID',interchangeReference:original?'ORIGINAL-I':'ERR-I',environment:'test',applicationReference:'23-DDQ-E66-T',acknowledgementRequest:true,messages:[{messageReference:original?'ORIGINAL-M':'ERR-M',messageTypeToken:'UTILTS:D:02B:UN:E5SE5A',businessSegments:segments}]})}
const original=()=>envelope(['BGM+E66::260+ORIGINAL-D+9+AB','DTM+137:202609301000:203','DTM+735:?+0100:406','MKS+23+E02::260','NAD+MS+52100:SVK:260','NAD+MR+52101:SVK:260','NAD+DDQ','IDE+24+ORIGINAL-T',...copy],true)
const err=(code='E51')=>envelope(['BGM+ERR::260+ERR-D+9+AB','DTM+137:202609301200:203','DTM+735:?+0100:406','MKS+23+E02::260','NAD+MS+52101:SVK:260','NAD+MR+52100:SVK:260','NAD+DDQ','IDE+24+ERR-T',...copy,`STS+E01::260+41+${code}::260`,'RFF+TN:ORIGINAL-T','RFF+E66:ORIGINAL-D'])
const policy=resolveCanonicalEdielPolicy({family:'UTILTS_ERR',messageCode:'ERR',direction:'outbound',referenceDate:'2026-10-01',associationAssignedCode:'E5SE5A',applicationReference:'23-DDQ-E66-T'})
function guide(raw=err(),source:string|undefined=original()){const wire=tokenizeEdifact(raw);return validateCanonicalAckGuide({policy,rawSegments:wire.segments.map(t=>t.raw),una:wire.una,sourceRawPayload:source})}
describe('same-source UTILTS ERR guide, original and own physical transactions',()=>{
 it('admits E19 only under the retained authentic original 25-A-3 guide',()=>{
  const prior=resolveCanonicalEdielPolicy({family:'UTILTS_ERR',messageCode:'ERR',direction:'outbound',referenceDate:'2026-09-30',associationAssignedCode:'E5SE5A',applicationReference:'23-DDQ-E66-T'})
  const wire=tokenizeEdifact(err('E19'))
  expect(validateCanonicalAckGuide({policy:prior,rawSegments:wire.segments.map(t=>t.raw),una:wire.una,sourceRawPayload:original()})).toEqual([])
  expect(guide(err('E19')).map(issue=>issue.code)).toContain('ACK_UTILTS_ERR_ORIGINAL_REASON_SCOPE_REQUIRED')
  expect(CANONICAL_UTILTS_ERR_GUIDE_CONSTRAINTS.allowedReasons).not.toContain('E19')
  expect(canonicalUtiltsErrReasonsForPolicy({...prior,guide:{...prior.guide,guideRevision:'future'}})).toBeNull()
 })
 it('publishes the authentic prior and current source scope for the same native projection',()=>{
  const prior=CANONICAL_UTILTS_ERR_REASON_GUIDE_SCOPES.find(scope=>scope.guideVersion==='25-A-3')!
  const current=CANONICAL_UTILTS_ERR_REASON_GUIDE_SCOPES.find(scope=>scope.guideVersion==='25-A-4')!
  expect(prior.allowedReasons).toContain('E19');expect(current.allowedReasons).not.toContain('E19')
  expect(prior.source).toMatchObject({sha256:'fad5cf4f775f86258ab9d5827426d54e57881b6298836110359cf0e41706a798',field:'531',pages:[131,138]})
  expect(current.source.sha256).toBe('0524c18f38864ebe081dec9d3d53f1797b224ef0af7b01986627e895f47d99be')
 })
 it('accepts the national response and all present own source copies',()=>{expect(guide()).toEqual([])})
 it.each(CANONICAL_UTILTS_ERR_GUIDE_CONSTRAINTS.allowedReasons)('uses the same exported national field531 reason %s',code=>{expect(guide(err(code))).toEqual([])})
 it.each([
  [err('E999'),'ACK_UTILTS_ERR_NATIONAL_REASON_INVALID'],
  [err().replace('STS+E01::260+41','STS+E01::260+39'),'ACK_UTILTS_ERR_NATIONAL_REASON_INVALID'],
  [err().replace('RFF+TN:ORIGINAL-T','RFF+TN:SIBLING'),'ACK_UTILTS_ERR_ORIGINAL_COPY_MISMATCH'],
  [err().replace('RFF+E66:ORIGINAL-D','RFF+E66:OTHER-D'),'ACK_UTILTS_ERR_ORIGINAL_DOCUMENT_MISMATCH'],
  [err().replace('LOC+239+AAA','LOC+239+BBB'),'ACK_UTILTS_ERR_ORIGINAL_COPY_MISMATCH'],
  [err().replace("PIA+1+V1:PT:SVK:260'",''),'ACK_UTILTS_ERR_ORIGINAL_COPY_MISMATCH'],
  [err().replace('MKS+23+E02','MKS+23+E03'),'ACK_UTILTS_ERR_ORIGINAL_MARKET_MISMATCH'],
  [err().replace("NAD+DDQ'","NAD+DDK'"),'ACK_UTILTS_ERR_ORIGINAL_ROLE_MISMATCH'],
  [err().replace('NAD+MR+52100','NAD+MR+52199'),'ACK_UTILTS_ERR_ORIGINAL_LEGAL_PARTY_MISMATCH'],
  [err().replace('202609301200','202602301200'),'ACK_UTILTS_ERR_DOCUMENT_DATE_INVALID'],
  [err().replace('735:?+0100:406','735:?+0200:406'),'ACK_UTILTS_ERR_OFFSET_INVALID'],
  [err().replace('RFF+TN:ORIGINAL-T',"SEQ+1'QTY+136:1'RFF+TN:ORIGINAL-T"),'ACK_UTILTS_ERR_SEGMENT_FORBIDDEN'],
 ])('rejects a malformed own ERR guide field', (raw,code)=>{expect(guide(raw).some(issue=>issue.code===code)).toBe(true)})
 it('preserves allowed received function5 and requestNA without inventing rejection',()=>{expect(guide(err().replace('ERR-D+9+AB','ERR-D+5+NA'))).toEqual([])})
 it('keeps optional valid document code-list independent from the false S01–S07 condition',()=>{expect(guide(err().replace('BGM+ERR::260','BGM+ERR:SVK:260'))).toEqual([])})
 it('rejects duplicate own ERR id and duplicate source/code response',()=>{const raw=err().replace("UNT+",`IDE+24+ERR-T'${copy.join("'")}'STS+E01::260+41+E51::260'RFF+TN:ORIGINAL-T'RFF+E66:ORIGINAL-D'UNT+`);const codes=guide(raw).map(issue=>issue.code);expect(codes).toContain('ACK_UTILTS_ERR_OWN_TRANSACTION_INVALID');expect(codes).toContain('ACK_UTILTS_ERR_OWN_RESPONSE_DUPLICATE')})
 it('checks future document time only against the actual fixed-UTC+1 admission anchor',()=>{const admission={documentDate:null,documentTimestamp:null,localIngressAt:null,actualSendAt:null,admissionAt:'2026-09-30T11:00:00Z',admissionDate:'2026-09-30',admissionSource:'pre_send' as const,businessEffectiveDate:'2026-09-30',measurementPeriods:[],replayAt:null};const check=(raw:string)=>{const w=tokenizeEdifact(raw);return validateCanonicalAckGuide({policy:{...policy,timeAnchors:admission},rawSegments:w.segments.map(t=>t.raw),una:w.una,sourceRawPayload:original()})};expect(check(err())).toEqual([]);expect(check(err().replace('202609301200','202609301201')).some(issue=>issue.code==='ACK_UTILTS_ERR_DOCUMENT_DATE_FUTURE')).toBe(true)})
 it('observes alternate original service characters through the same lossless tokenizer',()=>{const source='UNA:*.! ~'+original().slice(9).replaceAll('+','*').replaceAll('?','!').replaceAll("'",'~');expect(guide(err(),source)).toEqual([])})
})
