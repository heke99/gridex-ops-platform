// reality-defects: H3d a future received end is still ongoing supply.
import { beforeEach, expect, it, vi } from 'vitest'

type Period = {company_id:string;customer_contract_id:string;contract_id?:string;status:string;end_date:string|null;actual_end_date?:string|null}
const state = vi.hoisted(() => ({periods:[] as Period[], queryError:null as Error|null, rpc:vi.fn(), from:vi.fn()}))
vi.mock('@/lib/supabase/service', () => ({supabaseService:{from:state.from,rpc:state.rpc}}))
import { addCustomerContractEvent, ContractSupplyStillOpenError } from '@/lib/customer-contracts/db'

const company='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222'
const contract='88888888-8888-4888-8888-888888888888', otherContract='99999999-9999-4999-8999-999999999999'
const period = (status='ending', end_date:string|null='2026-11-01'):Period => ({company_id:company,customer_contract_id:contract,status,end_date})
const event = (eventType:'cancelled'|'terminated'='cancelled') => addCustomerContractEvent({companyId:company,customerContractId:contract,
  customerId:'55555555-5555-4555-8555-555555555555',eventType,happenedAt:'2026-10-24T12:00:00Z'})
beforeEach(() => {
  state.periods=[];state.queryError=null;state.from.mockReset();state.rpc.mockReset()
  state.rpc.mockResolvedValue({data:{event:{id:'33333333-3333-4333-8333-333333333333'}},error:null})
  state.from.mockImplementation((table:string) => {
    if(table!=='customer_supply_periods')throw new Error('Unexpected table '+table)
    let rows=state.periods.slice()
    const query={select:vi.fn(() => query),eq:vi.fn((key:keyof Period,value:string) => {rows=rows.filter(row => row[key]===value);return query}),
      or:vi.fn((filter:string) => {const parts=filter.split(',').map(part=>part.split('.eq.'));rows=rows.filter(row=>parts.some(([key,value])=>row[key as keyof Period]===value));return query}),
      in:vi.fn((key:keyof Period,values:string[])=>Promise.resolve({data:rows.filter(row=>values.includes(String(row[key]))),error:state.queryError}))}
    return query
  })
})
for(const eventType of ['cancelled','terminated'] as const) {
  it(`refuses ${eventType} before a future received end, without invoking the canonical recorder`, async () => {
    state.periods=[period()];await expect(event(eventType)).rejects.toBeInstanceOf(ContractSupplyStillOpenError);expect(state.rpc).not.toHaveBeenCalled()
  })
}
for(const status of ['active','confirmed_by_grid_owner','ending']) {
  it(`refuses an ongoing ${status} period without an end`, async () => {
    state.periods=[period(status,null)];await expect(event()).rejects.toBeInstanceOf(ContractSupplyStillOpenError);expect(state.rpc).not.toHaveBeenCalled()
  })
}
for(const end of ['2026-10-24','2026-10-23']) {
  it(`allows the existing recorder once the ending period stops on or before ${end}`, async () => {
    state.periods=[period('ending',end)];await event();expect(state.rpc).toHaveBeenCalledTimes(1)
  })
}
it('uses actual_end_date when it differs from the planned end', async () => {
  state.periods=[{...period('ending','2026-10-23'),actual_end_date:'2026-11-01'}]
  await expect(event()).rejects.toBeInstanceOf(ContractSupplyStillOpenError);expect(state.rpc).not.toHaveBeenCalled()
})
it('does not let another tenant period block this tenant recorder', async () => {
  state.periods=[{...period(),company_id:other}];await event();expect(state.rpc).toHaveBeenCalledTimes(1)
})
it('does not let another contract period block this contract recorder', async () => {
  state.periods=[{...period(),customer_contract_id:otherContract}];await event();expect(state.rpc).toHaveBeenCalledTimes(1)
})
it('checks the legacy contract_id relation too', async () => {
  state.periods=[{...period(),customer_contract_id:otherContract,contract_id:contract}]
  await expect(event()).rejects.toBeInstanceOf(ContractSupplyStillOpenError);expect(state.rpc).not.toHaveBeenCalled()
})
it('refuses a failed supply read before recording an event', async () => {
  state.queryError=new Error('supply_read_failed');await expect(event()).rejects.toThrow('supply_read_failed');expect(state.rpc).not.toHaveBeenCalled()
})
it('ignores an already ended period', async () => {
  state.periods=[period('ended')];await event();expect(state.rpc).toHaveBeenCalledTimes(1)
})
