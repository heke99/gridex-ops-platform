// local/057: real action orchestration; IO/parser verdict substituted, not full Ediel acceptance.
import { beforeEach,expect,it,vi } from 'vitest'
const io=vi.hoisted(()=>({guard:vi.fn(),create:vi.fn(),list:vi.fn(),artifact:vi.fn(),redirect:vi.fn(),validator:vi.fn(),run:null as Record<string,unknown>|null,audits:[] as Record<string,unknown>[],auditError:null as unknown,artifactError:null as unknown,artifactRows:[] as Record<string,unknown>[]}))
vi.mock('@/lib/admin/guards',()=>({requirePlatformAdminActionAccess:io.guard}))
vi.mock('@/lib/ediel/db',()=>({listEdielTestRuns:io.list,createEdielTestRun:io.create}))
vi.mock('@/lib/ediel/rulebook/messageParser',()=>({parseRulebookMessage:()=>({family:'PRODAT',code:'Z03'}),parseRulebookListPayload:()=>({family:'PRODAT',code:'Z03'})}))
vi.mock('@/lib/ediel/rulebook/validator',()=>({validateRulebookMessage:io.validator}))
vi.mock('@/lib/ediel/rulebook/testRunner',()=>({attachRulebookArtifact:io.artifact}))
vi.mock('next/navigation',()=>({redirect:io.redirect,unstable_rethrow:vi.fn()}))
vi.mock('next/cache',()=>({revalidatePath:vi.fn()}))
vi.mock('@/lib/supabase/service',()=>({supabaseService:{from(table:string){
 const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:io.run,error:null}),insert:async(value:Record<string,unknown>)=>{if(table==='ediel_test_artifacts'){io.artifactRows.push(value);return {error:io.artifactError}};if(table!=='audit_logs')throw Error('unexpected_table_write');io.audits.push(value);return {error:io.auditError}}};return q
}}}))
import {validateSystemTestPayloadAction} from '@/app/admin/ediel/system-tests/actions.part-2'
const existing=()=>({id:'run-fixture',company_id:'company-fixture',test_case_code:'1.2.1',test_suite:'PRODAT',role_code:'supplier',status:'running',configuration_snapshot_id:'snapshot-fixture'})
const form=(run=false)=>{const f=new FormData();f.set('companyId','company-fixture');f.set('testCaseCode','1.2.1');f.set('rawPayload','SYNTHETIC-PARSER-PORT');if(run)f.set('testRunId','run-fixture');return f}
const noEffects=()=>{expect(io.create).not.toHaveBeenCalled();expect(io.artifact).not.toHaveBeenCalled();expect(io.audits).toHaveLength(0);expect(io.artifactRows).toHaveLength(0)}
beforeEach(()=>{vi.clearAllMocks();io.guard.mockResolvedValue({userId:'actor-fixture'});io.create.mockRejectedValue(new Error('sentinel_before_real_run_insert'));io.list.mockResolvedValue([]);io.artifact.mockResolvedValue(undefined);io.validator.mockReturnValue({blocking:false,issues:[]});io.run=null;io.audits=[];io.auditError=null;io.artifactError=null;io.artifactRows=[];io.redirect.mockImplementation((url:string)=>{throw new Error('REDIRECT:'+url)})})
it.each([false,true])('standalone verdict blocking=%s is read-only diagnostics, never implicit start',async blocking=>{
 io.validator.mockReturnValue({blocking,issues:blocking?[{severity:'error',description:'synthetic parse error'}]:[]})
 await expect(validateSystemTestPayloadAction(form())).rejects.toThrow('REDIRECT:/admin/ediel/system-tests/cases/1.2.1?companyId=company-fixture&validationStatus='+(blocking?'blocked':'diagnostic'))
 noEffects();expect(io.list).not.toHaveBeenCalled()
})
it('does not silently attach diagnostics to an unrequested running record',async()=>{
 io.list.mockResolvedValue([existing()]);await expect(validateSystemTestPayloadAction(form())).rejects.toThrow('REDIRECT:');noEffects();expect(io.list).not.toHaveBeenCalled()
})
it.each([false,true])('records intended diagnostic artifact only on the explicit same-company running case, blocking=%s',async blocking=>{
 io.run=existing();io.validator.mockReturnValue({blocking,issues:[]});await expect(validateSystemTestPayloadAction(form(true))).rejects.toThrow('validationStatus=recorded')
 expect(io.create).not.toHaveBeenCalled();expect(io.artifactRows).toEqual([expect.objectContaining({test_run_id:'run-fixture',company_id:'company-fixture',payload:expect.objectContaining({companyId:'company-fixture'})})]);expect(io.artifact).not.toHaveBeenCalled();expect(io.audits).toHaveLength(1);expect(io.audits[0]).toMatchObject({company_id:'company-fixture',entity_id:'run-fixture',actor_user_id:'actor-fixture'})
})
it('rejects cross-company explicit record instead of replacing posted company',async()=>{
 io.run={...existing(),company_id:'other-company'};await expect(validateSystemTestPayloadAction(form(true))).rejects.toThrow('valt bolag');noEffects()
})
it.each([{test_case_code:'other-case'},{test_suite:'UTILTS'},{role_code:'esco'}])('rejects mismatched case identity %j',async patch=>{
 io.run={...existing(),...patch};await expect(validateSystemTestPayloadAction(form(true))).rejects.toThrow('valt testfall');noEffects()
})
it.each(['approved','passed','failed','cancelled','draft'])('rejects an explicit record in immutable/inactive state %s',async status=>{
 io.run={...existing(),status};await expect(validateSystemTestPayloadAction(form(true))).rejects.toThrow('pågående');noEffects()
})
it('does not conceal artifact persistence failure or claim success',async()=>{
 io.run=existing();const e=new Error('synthetic artifact database failure');io.artifactError=e;await expect(validateSystemTestPayloadAction(form(true))).rejects.toBe(e);expect(io.audits).toHaveLength(0);expect(io.redirect).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
})
it('does not conceal audit persistence failure',async()=>{
 io.run=existing();const e={code:'42501',message:'synthetic audit denied'};io.auditError=e;await expect(validateSystemTestPayloadAction(form(true))).rejects.toBe(e);expect(io.redirect).not.toHaveBeenCalled();expect(io.create).not.toHaveBeenCalled()
})
it('retains platform authorization',async()=>{io.guard.mockRejectedValue(new Error('synthetic forbidden'));await expect(validateSystemTestPayloadAction(form())).rejects.toThrow('synthetic forbidden');noEffects()})
it('requires explicit company',async()=>{const f=form();f.delete('companyId');await expect(validateSystemTestPayloadAction(f)).rejects.toThrow('Välj bolag');noEffects()})
it('requires a known case rather than writing orphan artifacts',async()=>{const f=form();f.set('testCaseCode','unknown-case');await expect(validateSystemTestPayloadAction(f)).rejects.toThrow('Okänt');noEffects()})

it('keeps payload and parser descriptions out of diagnostic redirect URLs',async()=>{const marker='E2E-PRIVATE-DIAGNOSTIC-MARKER';const f=form();f.set('rawPayload',marker);f.set('title',marker);io.validator.mockReturnValue({blocking:true,issues:[{severity:'error',description:marker}]});await expect(validateSystemTestPayloadAction(f)).rejects.toThrow('REDIRECT:');expect(io.redirect.mock.calls[0][0]).not.toContain(marker);expect(io.redirect.mock.calls[0][0]).toContain('validationErrors=1');noEffects()})

it('rejects the actual artifact insert error even when legacy helper would return void',async()=>{io.run=existing();const e={code:'42501',message:'synthetic artifact insert denied'};io.artifactError=e;await expect(validateSystemTestPayloadAction(form(true))).rejects.toBe(e);expect(io.redirect).not.toHaveBeenCalled();expect(io.audits).toHaveLength(0);expect(io.artifactRows).toHaveLength(1)})
