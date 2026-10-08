// masterplan: P-13, AT-P-13, SC-038
// masterplan: P-12, AT-P-12, SC-038
// masterplan: P-11, AT-P-11
// masterplan: P-14, AT-P-14, SC-039
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applySupplyMarketSource, advanceSupplyMarketDeadlines } from '@/lib/ediel/flows/supplyMarketTransition'
import { applyInboundBusinessStateMachine } from '@/lib/ediel/flows/inboundBusinessStateMachineLegacy'
import type { EdielMessageRow } from '@/lib/ediel/types'
const io = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), event: vi.fn(), lifecycle: vi.fn(), workflow: vi.fn(), notification: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ supabaseService: { rpc: io.rpc, from: io.from } }))
vi.mock('@/lib/ediel/db', () => ({ createEdielMessageEvent: io.event }))
vi.mock('@/lib/ediel/stateMachines/prodatLifecycle', () => ({ decideProdatLifecycle: io.lifecycle }))
vi.mock('@/lib/customer-notifications/notificationOrchestrator', () => ({ enqueueCustomerLifecycleNotification: io.notification }))
vi.mock('@/lib/website/customerApplicationWorkflowBridge', () => ({ transitionCorrelatedCustomerApplicationWorkflow: io.workflow }))
const source = (extra: Partial<EdielMessageRow> = {}) => ({ id: 'actual-source', company_id: 'tenant-a', direction: 'inbound', message_family: 'PRODAT', message_code: 'Z04', customer_id: 'customer', parsed_payload: {}, ...extra }) as EdielMessageRow
beforeEach(() => { vi.clearAllMocks(); io.event.mockResolvedValue(undefined); io.workflow.mockResolvedValue(undefined); io.notification.mockResolvedValue(undefined); io.rpc.mockResolvedValue({ data: { applied: true, periods: [{ id: 'own-period', status: 'confirmed_by_grid_owner' }] }, error: null }); io.lifecycle.mockReturnValue({ outcome: 'assigned_supply_started', subtype: 'A', process: 'assigned_supply', state: 'assigned_supply_active' }) })
describe('source-bound supply consumer execution', () => {
 it('dispatches only immutable source owner and actor, never proposed mutable period or dates', async () => {
  const result = await applySupplyMarketSource({ actorUserId: 'actor', message: source({ parsed_payload: { end_date: '1900-01-01', supply_period_id: 'other-period', contract_id: 'forged' } }) })
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1', { p_company_id: 'tenant-a', p_source_message_id: 'actual-source', p_actor_user_id: 'actor' })
  expect(result.periods).toEqual([{ id: 'own-period', status: 'confirmed_by_grid_owner' }]); expect(io.from).not.toHaveBeenCalled()
 })
 it.each([{ company_id: null }, { direction: 'outbound' as const }, { message_family: 'UTILTS' as const }, { message_code: 'Z08' }])('holds unrelated/unassigned source before mutation %s', async extra => {
  expect((await applySupplyMarketSource({ actorUserId: 'actor', message: source(extra) })).applied).toBe(false); expect(io.rpc).not.toHaveBeenCalled()
 })
 it('a durable missing legal ground remains held without ordinary switch fallback', async () => {
  io.rpc.mockResolvedValue({ data: { applied: false, reason: 'regulated_supply_authentic_ground_required' }, error: null })
  expect(await applySupplyMarketSource({ actorUserId: 'actor', message: source() })).toMatchObject({ applied: false, reason: 'regulated_supply_authentic_ground_required', periods: [] })
 })
 it('bounds due-source projection and does not create retry or send commands', async () => {
  io.rpc.mockResolvedValue({ data: { updated: 3 }, error: null })
  expect(await advanceSupplyMarketDeadlines({ actorUserId: 'actor', limit: 10000 })).toEqual({ updated: 3 })
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_advance_supply_deadlines_v1', { p_company_id: null, p_actor_user_id: 'actor', p_limit: 200 }); expect(io.from).not.toHaveBeenCalled()
 })
 it('registers an actual assigned supply without ordinary Z03 and without announcing consumer activation', async () => {
  const result = await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: source() })
  expect(result).toMatchObject({ outcome: 'assigned_supply_started', reviewRequired: false, updated: ['customer_supply_periods'] })
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1', { p_company_id: 'tenant-a', p_source_message_id: 'actual-source', p_actor_user_id: 'actor' }); expect(io.workflow).not.toHaveBeenCalled(); expect(io.notification).not.toHaveBeenCalled(); expect(io.from).not.toHaveBeenCalled()
 })
 it('keeps a future end pending and replay avoids duplicated final-billing task', async () => {
  io.lifecycle.mockReturnValue({ outcome: 'supply_terminated', subtype: 'L', process: 'termination', state: 'supply_ended' });io.rpc.mockResolvedValue({ data: { applied: true, idempotent: true, periods: [{ id: 'own-period', status: 'ending' }] }, error: null })
  const result = await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: source({ message_code: 'Z05' }) })
  expect(result.tenantMessage).toContain('giltiga sluttid');expect(io.from).not.toHaveBeenCalled();expect(io.notification).not.toHaveBeenCalled()
 })
 it('does not reaccept an ordinary start already cancelled by the exact source ledger', async () => {
  io.lifecycle.mockReturnValue({ outcome: 'supplier_switch_accepted', subtype: 'L', process: 'supplier_switch', state: 'switch_accepted' });io.rpc.mockResolvedValue({ data: true, error: null })
  const result = await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: source(), matchedSwitchRequestId: 'own-switch' })
  expect(result).toMatchObject({ outcome: 'manual_review_required', reviewRequired: true, updated: [] });expect(io.from).not.toHaveBeenCalled();expect(io.notification).not.toHaveBeenCalled()
 })
 it('uses every native confirmed scope and cannot turn a parsed start date or correlation hint into activation',async()=>{
  io.lifecycle.mockReturnValue({outcome:'supplier_switch_accepted',subtype:'L',process:'supplier_switch',state:'switch_accepted'})
  const commits=[{switchRequestId:'own-A',supplyPeriodId:'period-A',customerId:'customer-A',meteringPointId:'point-A',siteId:'site-A'},{switchRequestId:'own-B',supplyPeriodId:'period-B',customerId:'customer-B',meteringPointId:'point-B',siteId:'site-B'}]
  io.rpc.mockResolvedValue({data:{applied:true,periods:[],commits},error:null})
  const observed:unknown[]=[]
  const result=await applyInboundBusinessStateMachine({actorUserId:'actor',message:source({parsed_payload:{actual_start_date:'1900-01-01'}}),matchedSwitchRequestId:'untrusted-other',onSourceSwitchCommitted:async c=>{observed.push(c)}})
  expect(result.outcome).toBe('supplier_switch_accepted');expect(observed).toHaveLength(2)
  expect(observed[1]).toMatchObject({switchRequestId:'own-B',supplyPeriodId:'period-B',message:{customer_id:'customer-B',metering_point_id:'point-B',site_id:'site-B'}})
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1',{p_company_id:'tenant-a',p_source_message_id:'actual-source',p_actor_user_id:'actor'});expect(io.from).not.toHaveBeenCalled()
 })
 it('rejects a truncated native commit response instead of silently accepting a partial composition',async()=>{
  io.rpc.mockResolvedValue({data:{applied:true,commits:[{switchRequestId:'own-A'}]},error:null})
  await expect(applySupplyMarketSource({actorUserId:'actor',message:source()})).rejects.toThrow('commit_scope_invalid')
 })
 it('projects real own effects separately from held siblings and whole-source completion',async()=>{
  const object=(segmentIndex:number)=>({messageIndex:0,messageReference:'own-UNH',objectId:`point-${segmentIndex}`,identityAgency:'9',
    registers:[{lineIndex:segmentIndex,lineNumber:String(segmentIndex+1),registerIndex:null,registerPosition:1,segmentIndex}]})
  const receipt='00000000-0000-0000-0000-000000000001'
  io.rpc.mockResolvedValue({data:{applied:true,periods:[{id:'own-period',status:'confirmed_by_grid_owner'}],commits:[],effectReceiptIds:[receipt],partition:[
    {object:object(7),disposition:'applied',effectReceiptId:receipt,effectFactsHash:'a'.repeat(64)},
    {object:object(14),disposition:'held',reason:'own_application_not_accepted'},
  ]},error:null})
  expect(await applySupplyMarketSource({actorUserId:'actor',message:source()})).toMatchObject({applied:true,fullyApplied:false,reviewRequired:true,effectReceiptIds:[receipt],partition:[{disposition:'applied'},{disposition:'held'}]})
  expect(io.from).not.toHaveBeenCalled();expect(io.notification).not.toHaveBeenCalled()
 })
 it('preserves an established legacy result without inventing own effect receipts',async()=>{
  expect(await applySupplyMarketSource({actorUserId:'actor',message:source()})).toMatchObject({applied:true,fullyApplied:true,partition:null,effectReceiptIds:[]})
 })
 it.each(['same-register','missing-register-fields','receipt-mismatch','unknown-disposition'])('holds malformed native partition: %s',async mutation=>{
  const object={messageIndex:0,messageReference:'M',objectId:'point',identityAgency:'9',registers:[{lineIndex:0,lineNumber:'1',registerIndex:null,registerPosition:1,segmentIndex:7}]}
  const receipt='00000000-0000-0000-0000-000000000001'
  const applied={object,disposition:'applied',effectReceiptId:receipt,effectFactsHash:'a'.repeat(64)}
  const partition:unknown[]=mutation==='same-register'?[applied,{object,disposition:'held',reason:'held'}]
    :mutation==='missing-register-fields'?[{...applied,object:{...object,registers:[{segmentIndex:7}]}}]
    :mutation==='unknown-disposition'?[{...applied,disposition:'accepted'}]:[applied]
  io.rpc.mockResolvedValue({data:{applied:true,partition,effectReceiptIds:mutation==='receipt-mismatch'?[]:[receipt]},error:null})
  await expect(applySupplyMarketSource({actorUserId:'actor',message:source()})).rejects.toThrow('supply_object_partition_')
 })
})
// SC-038: correct special grounds use their own process and controls. The
// real canonical lifecycle decision is projected through the consumer; no own
// Z03 original, switch correlation or customer-table lookup is required.
describe('SC-038 special processes are not blocked by an ordinary own-Z03 requirement', () => {
 const real = async () => (await vi.importActual<typeof import('@/lib/ediel/stateMachines/prodatLifecycle')>('@/lib/ediel/stateMachines/prodatLifecycle')).decideProdatLifecycle
 it.each([
  ['Z04A', { message_code: 'Z04A' }, 'assigned_supply', 'assigned_supply_started', 'Anvisningsprocessen'],
  ['Z04D', { message_code: 'Z04D' }, 'mandatory_purchase', 'mandatory_purchase_supply_started', 'produktions- och mottagningsrelationen'],
  ['Z04 with Z70', { message_code: 'Z04', raw_payload: "UNH+1+PRODAT:D:96A:UN:E2SE'BGM+Z04::260+1'CAV+Z70'" }, 'mandatory_purchase', 'mandatory_purchase_supply_started', 'produktions- och mottagningsrelationen'],
 ] as const)('%s runs its special process without a preceding own Z03', async (_label, extra, process, outcome, tenantText) => {
  const decide = await real()
  io.lifecycle.mockImplementation(decide)
  const message = source(extra as Partial<EdielMessageRow>)
  expect(decide(message)).toMatchObject({ process, outcome, createSupplyPeriod: true, requiresCorrelation: false })
  const result = await applyInboundBusinessStateMachine({ actorUserId: 'actor', message, matchedSwitchRequestId: null })
  expect(result).toMatchObject({ outcome, reviewRequired: false, updated: ['customer_supply_periods'] })
  expect(result.tenantMessage).toContain(tenantText)
  // The special process is the source-bound regulated-supply apply: one RPC
  // over the exact source, no ordinary-switch correlation or Z03 lookup.
  expect(io.rpc).toHaveBeenCalledExactlyOnceWith('ediel_apply_supply_source_v1', { p_company_id: 'tenant-a', p_source_message_id: 'actual-source', p_actor_user_id: 'actor' })
  expect(io.from).not.toHaveBeenCalled(); expect(io.workflow).not.toHaveBeenCalled(); expect(io.notification).not.toHaveBeenCalled()
 })
 it.each(['Z04A', 'Z04D'])('%s keeps its own ground control: a missing legal ground is held, never an ordinary fallback', async code => {
  io.lifecycle.mockImplementation(await real())
  io.rpc.mockResolvedValue({ data: { applied: false, reason: 'regulated_supply_authentic_ground_required' }, error: null })
  const result = await applyInboundBusinessStateMachine({ actorUserId: 'actor', message: source({ message_code: code }) })
  expect(result).toMatchObject({ outcome: 'manual_review_required', reviewRequired: true })
  expect(result.updated).not.toContain('customer_supply_periods'); expect(result.updated).not.toContain('supplier_switch_requests')
  // Held for review only; no ordinary-switch lookup or replacement effect.
  expect(io.from).not.toHaveBeenCalled()
  for (const [call] of io.workflow.mock.calls) expect(call).toMatchObject({ state: 'manual_review' })
 })
 it('the exemption is specific: an ordinary switch confirmation still requires its correlation', async () => {
  expect((await real())(source({ message_code: 'Z04L' }))).toMatchObject({ process: 'supplier_switch', outcome: 'supplier_switch_accepted', requiresCorrelation: true })
 })
})
