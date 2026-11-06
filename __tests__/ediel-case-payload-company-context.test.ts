// local/053 and local/052 feedback: actual server page/form; mocked read ports.
import React from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
const io = vi.hoisted(() => ({ guard:vi.fn(), runScope:vi.fn(), messageScope:vi.fn(), validate:vi.fn(), start:vi.fn(), runtime:vi.fn() }))
vi.mock('@/lib/admin/guards', () => ({ requirePlatformAdminAccess:io.guard }))
vi.mock('@/lib/tenant/scope', () => ({ getOperationalCompanyScope:async()=>({companyId:'active-company'}) }))
vi.mock('@/lib/ediel/db', () => ({ listEdielTestRuns:io.runScope,listEdielMessages:io.messageScope,listEdielMessagesByIds:async()=>[],listEdielTestRunMessages:async()=>[] }))
vi.mock('@/lib/ediel/systemTestSettings', () => ({ getEdielSystemTestRuntimeContext:io.runtime }))
vi.mock('@/lib/supabase/service', () => ({supabaseService:{}}))
vi.mock('@/app/admin/ediel/actions', () => ({createEdielTgtRunFromTemplateAction:io.start}))
vi.mock('@/app/admin/ediel/system-tests/actions', () => ({validateSystemTestPayloadAction:io.validate,createAndSendSystemTestAckAction:vi.fn(),createAndSendSystemTestOutboundForRunAction:vi.fn(),deleteSystemTestArtifactAction:vi.fn(),deleteSystemTestRunAction:vi.fn(),pollAndSyncTgtSystemTestMailboxAction:vi.fn(),sendSystemTestOutboundMessageAction:vi.fn(),softDeleteSystemTestMessageAction:vi.fn(),unlinkSystemTestMessageAction:vi.fn()}))
vi.mock('@/app/admin/ediel/system-tests/EdielReportingPermissionForm',()=>({default:()=>null}))
import Page from '@/app/admin/ediel/system-tests/cases/[id]/page'
type Props = {children?:React.ReactNode; action?:unknown; name?:string; value?:unknown; role?:string; disabled?:boolean}
function nodes(node:React.ReactNode):React.ReactElement<Props>[] {
 if (!React.isValidElement<Props>(node))return []
 return [node,...React.Children.toArray(node.props.children).flatMap(nodes)]
}
const page=(companyId?:string,startStatus?:string,validationStatus?:string)=>Page({params:Promise.resolve({id:'1.2.1'}),searchParams:Promise.resolve({companyId,startStatus,validationStatus,validationErrors:'2',validationWarnings:'1'} as Parameters<typeof Page>[0]['searchParams'] extends Promise<infer T>?T:never)})
beforeEach(()=>{vi.stubGlobal('React',React);vi.clearAllMocks();io.guard.mockResolvedValue({userId:'actor',email:'actor@example.invalid'});io.runtime.mockResolvedValue(null);io.runScope.mockResolvedValue([]);io.messageScope.mockResolvedValue([])})
it.each([['selected-company','selected-company'],[undefined,'active-company']])('binds payload to selected or resolved company: %s',async(selected,expected)=>{
 const tree=await page(selected);const form=nodes(tree).find(n=>n.type==='form'&&n.props.action===io.validate);expect(form).toBeDefined();const company=nodes(form).filter(n=>n.type==='input'&&n.props.name==='companyId');expect(company).toHaveLength(1);expect(company[0].props.value).toBe(expected);expect(io.runScope).toHaveBeenCalledWith({scope:'tenant',companyId:expected});expect(io.messageScope).toHaveBeenCalledWith({companyId:expected,limit:300})
})
it('shows actionable missing-profile feedback only for known status',async()=>{
 const tree=await page('selected-company','missing_test_profile');const alerts=nodes(tree).filter(n=>n.props.role==='alert');expect(alerts).toHaveLength(1);expect(JSON.stringify(alerts[0])).toContain('Systemtest kräver en aktiv');expect(JSON.stringify(alerts[0])).toContain('Ingen testkörning startades')
})
it('ignores unknown status rather than claiming successful start',async()=>{
 io.runtime.mockResolvedValue({actorEdielId:'SYNTHETIC',testPortalEdielId:'SYNTHETIC-PORTAL'})
 expect(nodes(await page('selected-company','untrusted-value')).filter(n=>n.props.role==='alert')).toHaveLength(0)
})
it('retains platform guard before tenant data reads',async()=>{
 const e=new Error('synthetic denied');io.guard.mockRejectedValue(e);await expect(page('selected-company')).rejects.toBe(e);expect(io.runScope).not.toHaveBeenCalled();expect(io.messageScope).not.toHaveBeenCalled()
})

it('disables start and explains the missing profile before an operator attempts it',async()=>{
 const tree=await page('selected-company');const form=nodes(tree).find(n=>typeof n.type==='function'&&n.type.name==='StartRunForm')!
 const rendered=(form.type as (props:typeof form.props)=>React.ReactNode)(form.props)
 const button=nodes(rendered).find(n=>n.type==='button')!
 expect(button.props.disabled).toBe(true)
 expect(nodes(tree).filter(n=>n.props.role==='alert')).toHaveLength(1)
 expect(io.start).not.toHaveBeenCalled()
})
it('does not disable the start control solely for an already qualified test profile',async()=>{
 io.runtime.mockResolvedValue({actorEdielId:'SYNTHETIC',testPortalEdielId:'SYNTHETIC-PORTAL'})
 const tree=await page('selected-company');const form=nodes(tree).find(n=>typeof n.type==='function'&&n.type.name==='StartRunForm')!
 const rendered=(form.type as (props:typeof form.props)=>React.ReactNode)(form.props)
 expect(nodes(rendered).find(n=>n.type==='button')!.props.disabled).not.toBe(true)
 expect(io.start).not.toHaveBeenCalled()
})

it('does not mislabel an unexpected runtime read failure as a missing profile',async()=>{const e=new Error('synthetic unexpected runtime read failure');io.runtime.mockRejectedValue(e);await expect(page('selected-company')).rejects.toBe(e)})

it.each(['blocked','diagnostic','recorded'])('renders parse-only diagnostic feedback without claiming run approval: %s',async status=>{
 const tree=await page('selected-company',undefined,status);const feedback=nodes(tree).filter(n=>n.props.role==='status');expect(feedback).toHaveLength(1);const text=JSON.stringify(feedback[0]);expect(text).toContain('Payload-diagnostik');expect(text).toContain('Parserdiagnostik är inte ett godkännande');expect(io.start).not.toHaveBeenCalled()
})
