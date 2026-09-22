import { describe, expect, it } from 'vitest'
import { selectStructuralSources, type StructuralCoverage, type StructuralSelectionInput, type StructuralVersion } from '@/lib/ediel/sources/structuralSourceSelection'

// Pure chronology fixtures are not a source-owner acceptance oracle. Native
// HTTP tests separately exercise canonical validation, actual owners and SQL.
const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T00:00:00Z`
const coverage: StructuralCoverage = {
  kind: 'post_ledger_supply', baselineSourceMessageId: 'baseline', baselineAssessmentId: 'baseline-commit', baselineFactsHash: 'a'.repeat(64),
  supplyPeriodId: 'supply', switchRequestId: 'switch', switchCreatedAt: at(1), outboundSourceMessageId: 'z03', outboundCreatedAt: at(1), validFrom: at(2), validTo: null,
}
function version(id: string, day: number, code: 'Z04'|'Z06'|'Z10' = 'Z04', registers: (string|null)[] = ['201','202']): StructuralVersion {
  return { sourceMessageId: id, payloadHash: id, assessmentId: `${id}-assessment`, factsHash: `${id}-facts`, availableAt: at(3), disposition: 'accepted', coverage: structuredClone(coverage), replaces: null,
    wire: { object: {messageIndex:0,messageReference:'M',objectId:'POINT',identityAgency:'9',registers:[]}, messageCode: code,
      businessCase: code==='Z04'?'supply_baseline':code==='Z10'?'meter_exchange':'change_with_reading', functionCode:'9',documentReference:id,caseReference:id,
      effectiveFrom:{fieldNumber:code==='Z04'?'210':'216',marketMinute:`202610${String(day).padStart(2,'0')}0100`,utc:at(day)}, contractStartMinute:'202610020100',
      legalSender:'grid',legalReceiver:'supplier',transportSender:'grid',transportReceiver:'supplier',meterNumber:'M1',oldMeterNumber:null,
      registers:registers.map((registerId,index)=>({position:index+1,registerId}))} }
}
function input(versions: StructuralVersion[] = [version('baseline',2)], start=4,end=5): StructuralSelectionInput {
  return { ledgerStartedAt: at(1), cutoffAt: at(20), readComplete:true, unresolvedSources:false,versions,objectId:'POINT',identityAgency:'9',legalSender:'grid',legalReceiver:'supplier',periodStart:at(start),periodEnd:at(end),boundary:'interval' }
}
const selected = (query: StructuralSelectionInput) => { const result=selectStructuralSources(query); expect(result.status).toBe('selected'); if(result.status!=='selected')throw Error(result.reason); return result }
const unavailable = (query: StructuralSelectionInput) => expect(selectStructuralSources(query).status).toBe('unavailable')

describe('dated structural-source replacement',()=>{
  it('selects the approved full baseline for the requested interval',()=>expect(selected(input()).states).toMatchObject([{sourceMessageId:'baseline',meterNumber:'M1',registerIds:['201','202']}]))
  it.each(['readComplete','unresolvedSources'] as const)('does not hide incomplete %s evidence', key => {const q=input(); q[key]=key==='unresolvedSources'; unavailable(q)})
  it('never claims a pre-ledger business lifecycle was captured',()=>{const q=input(); q.versions[0].coverage!.switchCreatedAt='2026-09-01T00:00:00Z';unavailable(q)})
  it('requires the initiating outbound message after capture began',()=>{const q=input();q.versions[0].coverage!.outboundCreatedAt='2026-09-01T00:00:00Z';unavailable(q)})
  it('does not extend a dated baseline backwards',()=>unavailable(input(undefined,1,2)))
  it('does not extend coverage beyond the committed supply end',()=>{const q=input();q.versions[0].coverage!.validTo=at(4);unavailable(q)})
  it('does not accept an unwitnessed source',()=>{const q=input();q.versions[0].availableAt=null;unavailable(q)})
  it('does not use approval first visible after the receipt cutoff',()=>{const q=input();q.versions[0].availableAt=at(21);unavailable(q)})
  it('does not promote an accepted but undated Z04 business facet into completeness',()=>{const q=input();q.versions[0].coverage=null;unavailable(q)})
  it.each(['objectId','identityAgency','legalSender','legalReceiver'] as const)('cannot borrow another %s',key=>{const q=input();q[key]='foreign';unavailable(q)})
  it('uses Z06F register changes without changing the meter',()=>expect(selected(input([version('baseline',2),version('tariff',4,'Z06',['901'])])).states).toMatchObject([{sourceMessageId:'tariff',meterNumber:'M1',registerIds:['901']}]))
  it('a Z06F may omit the unchanged meter number, not the new register inventory',()=>{const change=version('tariff',4,'Z06',['901']);change.wire.meterNumber=null;expect(selected(input([version('baseline',2),change])).states[0].meterNumber).toBe('M1')})
  it('does not copy an absent later register from register one or the old state',()=>{const change=version('tariff',4,'Z06',['901',null]);expect(selected(input([version('baseline',2),change])).states[0].registerIds).toEqual(['901',null])})
  it('a Z06F cannot substitute a new meter',()=>{const change=version('bad',4,'Z06');change.wire.meterNumber='M2';unavailable(input([version('baseline',2),change]))})
  it('Z06E does not supersede structural fields',()=>{const change=version('customer',4,'Z06',['fake']);change.wire.businessCase='customer_only';change.wire.meterNumber='other';expect(selected(input([version('baseline',2),change])).states[0].sourceMessageId).toBe('baseline')})
  it('Z06G preserves omitted unchanged register identities from its proven predecessor',()=>{const change=version('location',4,'Z06',[null,null]);change.wire.businessCase='change_without_reading';expect(selected(input([version('baseline',2),change])).states[0].registerIds).toEqual(['201','202'])})
  it('Z06G cannot silently change the register identity',()=>{const change=version('bad',4,'Z06',['901']);change.wire.businessCase='change_without_reading';unavailable(input([version('baseline',2),change]))})
  it('a Z10 replaces the entire new-meter inventory, including two-to-one changes',()=>{const change=version('exchange',4,'Z10',['901']);change.wire.meterNumber='M2';change.wire.oldMeterNumber='M1';expect(selected(input([version('baseline',2),change])).states).toMatchObject([{sourceMessageId:'exchange',meterNumber:'M2',registerIds:['901']}])})
  it('uses the old source, not old fields in Z10, for a closing interval',()=>{const change=version('exchange',4,'Z10',['901']);change.wire.meterNumber='M2';change.wire.oldMeterNumber='M1';expect(selected(input([version('baseline',2),change],2,4)).states[0].registerIds).toEqual(['201','202'])})
  it('selects the old source for E30 last-stand at the exact boundary',()=>{const change=version('exchange',4,'Z10',['901']);change.wire.meterNumber='M2';const q=input([version('baseline',2),change],4,4);q.boundary='closing_point';expect(selected(q).states[0].meterNumber).toBe('M1')})
  it('selects the new source for first-stand at the exact boundary',()=>{const change=version('exchange',4,'Z10',['901']);change.wire.meterNumber='M2';const q=input([version('baseline',2),change],4,4);q.boundary='current_point';expect(selected(q).states[0].meterNumber).toBe('M2')})
  it('retains both states when a reported interval spans a meter exchange',()=>{const change=version('exchange',4,'Z10',['901']);change.wire.meterNumber='M2';expect(selected(input([version('baseline',2),change],3,5)).states.map(s=>s.meterNumber)).toEqual(['M1','M2'])})
  it('validates a supplied old meter against the actual predecessor',()=>{const change=version('exchange',4,'Z10',['901']);change.wire.meterNumber='M2';change.wire.oldMeterNumber='FOREIGN';unavailable(input([version('baseline',2),change]))})
  it('an unapproved relevant change is a gap, not permission to revive the baseline',()=>{const change=version('pending',4,'Z06');change.disposition='unavailable';unavailable(input([version('baseline',2),change]))})
  it('a future unapproved change does not contaminate an earlier interval',()=>{const change=version('future',10,'Z06');change.disposition='unavailable';expect(selected(input([version('baseline',2),change])).states[0].sourceMessageId).toBe('baseline')})
  it('a rejected source does not replace the last approved source',()=>{const change=version('rejected',4,'Z06');change.disposition='rejected';expect(selected(input([version('baseline',2),change])).states[0].sourceMessageId).toBe('baseline')})
  it('arrival and UUID ordering do not select between effective dates',()=>{const first=version('z-first',4,'Z06',['901']);const second=version('a-second',6,'Z06',['902']);first.availableAt=at(15);second.availableAt=at(8);expect(selected(input([second,version('baseline',2),first],8,9)).states[0].sourceMessageId).toBe('a-second')})
  it('unrelated sources with the same effective instant remain ambiguous',()=>unavailable(input([version('baseline',2),version('a',4,'Z06'),version('b',4,'Z06')])))
  it('function 5 alone does not identify a superseded message',()=>{const c=version('correction',4,'Z06');c.wire.functionCode='5';unavailable(input([version('baseline',2),c]))})
  it('uses a reviewed explicit correction instead of its predecessor',()=>{const a=version('a',4,'Z06');const b=version('b',4,'Z06',['901']);b.wire.functionCode='5';b.wire.caseReference=a.wire.caseReference;b.replaces={sourceMessageId:a.sourceMessageId,assessmentId:a.assessmentId!,payloadHash:a.payloadHash};expect(selected(input([version('baseline',2),a,b])).states[0].sourceMessageId).toBe('b')})
  it('an explicit correction can correct the effective date, not just the payload',()=>{const a=version('a',4,'Z06');const b=version('b',6,'Z06',['901']);b.wire.functionCode='5';b.wire.caseReference=a.wire.caseReference;b.replaces={sourceMessageId:'a',assessmentId:a.assessmentId!,payloadHash:'a'};expect(selected(input([version('baseline',2),a,b],4,5)).states[0].sourceMessageId).toBe('baseline')})
  it('does not infer replacement from a shared LI case reference',()=>{const a=version('a',4,'Z06');const b=version('b',4,'Z06');b.wire.caseReference=a.wire.caseReference;unavailable(input([version('baseline',2),a,b]))})
  it.each(['sourceMessageId','assessmentId','payloadHash'] as const)('binds the corrected predecessor %s',key=>{const a=version('a',4,'Z06');const b=version('b',4,'Z06');b.wire.functionCode='5';b.wire.caseReference=a.wire.caseReference;b.replaces={sourceMessageId:'a',assessmentId:a.assessmentId!,payloadHash:'a',[key]:'foreign'};unavailable(input([version('baseline',2),a,b]))})
  it('rejects correction forks instead of choosing newest approval',()=>{const a=version('a',4,'Z06');const b=version('b',4,'Z06');b.wire.functionCode='5';b.wire.caseReference=a.wire.caseReference;b.replaces={sourceMessageId:'a',assessmentId:a.assessmentId!,payloadHash:'a'};const c=structuredClone(b);c.sourceMessageId='c';c.assessmentId='c-assessment';c.wire.documentReference='c';unavailable(input([version('baseline',2),a,b,c]))})
  it('rejects correction cycles',()=>{const a=version('a',4,'Z06');const b=version('b',4,'Z06');for(const x of [a,b]){x.wire.functionCode='5';x.wire.caseReference='CASE'};a.replaces={sourceMessageId:'b',assessmentId:b.assessmentId!,payloadHash:'b'};b.replaces={sourceMessageId:'a',assessmentId:a.assessmentId!,payloadHash:'a'};unavailable(input([version('baseline',2),a,b]))})
})
