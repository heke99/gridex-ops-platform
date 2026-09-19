import { it, expect } from 'vitest';
import { buildEdielTgtDraft, validateEdielTgtDraft } from '@/lib/ediel/testing/tgtEdifact.part-4';
import { reportingPrepared } from './fixtures/prodat-reporting-permission';
it('TGT uses independent stable identityless request and exact reporting assessment', () => { const p = reportingPrepared(); const result = buildEdielTgtDraft({ actorUserId: p.context.source.actorId, testRunId: p.run.id, testSuite: 'PRODAT', roleCode: 'esco', testCaseCode: '8.1.3', stepNo: 1, systemTestContext: p.runtime, importedTestData: p.testData, registerFacts: { market: 'electricity', reportingPermission: p.evidence }, reportingContext: p.context }); expect(result.validationIssues.filter(i => i.severity === 'error')).toEqual([]); expect(result.rawPayload).toContain(`RFF+LI:${p.evidence.objects[0].li}`); expect(result.rawPayload).toContain(`RFF+ANJ:${p.evidence.objects[0].anj}`); expect(result.rawPayload).toContain('DTM+91:202608010000:203'); expect(result.rawPayload).toContain("LIN+1'"); });
import {buildProdatMessage} from '@/lib/ediel/prodat/buildProdat'
import {reportingSelection} from './fixtures/prodat-reporting-permission'
it('generic identityless Z13 permits independently bounded S17 without confusing it with historical S18',()=>{const selection=reportingSelection(),o=selection.objects[0];const built=buildProdatMessage({companyId:'synthetic',role:'energy_service_company',businessCode:'Z13',transactionSubtype:'V',sender:{edielId:'12345'},receiver:{edielId:'54321'},environment:'test',customer:{id:'SYNTHETIC-CUSTOMER',identityQualifier:'SE1',idAgency:'260',name:'Synthetic Business',country:'SE'},dates:{reportStartDate:'202608010000',reportEndDate:'202609191200'},codedAttributes:{Z13:'S17',Z04:'Z04',Z12:'D',Z14:'8716867000030',Z22:'E17',Z24:'B72'},references:{LI:o.li,ANJ:o.anj},dependentConditionFacts:{reportingPermission:selection}});expect(built.validation.ok).toBe(true);expect(built.rawEdifact).toContain('DTM+91:202609191200:203');expect(built.reportingReadiness).toBe('unqualified');expect(built.registerEvidence.facts.reportingPermission).not.toHaveProperty('evaluationUtcMs')})

import {reportingId,reportingNow} from './fixtures/prodat-reporting-permission';
import {prepareTgtReportingNotes,readTgtReportingEntry} from '@/lib/ediel/testing/tgtReportingPermissionNotes';
import {getEdielTgtTestCaseByCode} from '@/lib/ediel/testing/tgtRegistry';
import {tokenizeEdifact,segmentComposite} from '@/lib/ediel/core/edifactTokenizer';
for(const [field,value]of [['226','REQONE'],['261','AUTHONE'],['226',"REQ+ONE:TWO?THREE'UNT+1"],['261',"AUTH:ONE+TWO?THREE'UNT+1"]] as const)it(`preserves valid prescribed ${field} release character through qualified TGT builder`,()=>{
 const p=reportingPrepared(),data=structuredClone(p.testData)
 const f=data.groups[0].fields.find(f=>f.fieldCode===field)!
 f.values['Testdata - Z13VH']=value
 const identity={kind:'dynamic' as const,id:reportingId(90),revision:'2026-09-19T11:00:00Z',digest:'b'.repeat(64)},selection={identity,data},run={...p.run,notes:null as string|null}
 let n=60
 run.notes=prepareTgtReportingNotes({run,stepNo:1,actorId:p.context.source.actorId,source:selection,route:p.context.source.route,clock:{nowUtcMs:()=>reportingNow},newId:()=>reportingId(n++),command:p.command})
 const entry=readTgtReportingEntry({run,stepNo:1,source:selection,route:p.context.source.route})!
 expect(field==='226'?entry.objects[0].object.li:entry.objects[0].object.anj).toBe(value)
 const evidence={source:{...p.evidence.source,source:identity,factsRevision:entry.factsRevision},objects:entry.objects.map(x=>x.object)},context={...structuredClone(evidence),evaluationUtcMs:reportingNow}
 const build = () => buildEdielTgtDraft({actorUserId:p.context.source.actorId,testRunId:run.id,testSuite:'PRODAT',roleCode:'esco',testCaseCode:'8.1.3',stepNo:1,systemTestContext:p.runtime,importedTestData:data,registerFacts:{reportingPermission:evidence},reportingContext:context});
 const built = build();
 expect(built.validationIssues.filter(i=>i.severity==='error')).toEqual([]);
 const wire=tokenizeEdifact(built.rawPayload), qualifier=field==='226'?'LI':'ANJ';
 const references=wire.segments.filter(s=>s.tag==='RFF').map(s=>segmentComposite(s,1,wire.una)).filter(c=>c[0]===qualifier);
 expect(references).toEqual([[qualifier,value]]);
 const wrongCount=built.rawPayload.replace(/UNT\+\d+\+/, 'UNT+999+');
 const step=getEdielTgtTestCaseByCode('PRODAT','esco','8.1.3')!.expectedSteps.find(s=>s.stepNo===1)!;
 expect(validateEdielTgtDraft(wrongCount,step,null,{registerFacts:{reportingPermission:evidence},reportingContext:context}).map(i=>i.code)).toContain('unt_count_mismatch');
 context.objects[0][field==='226'?'li':'anj']='DIFFERENT';
 expect(build).toThrow();
})
