import { beforeEach, expect, it, vi } from 'vitest'

const calls=vi.hoisted(()=>({ intake:vi.fn(), redirect:vi.fn((target:string)=>{ throw new Error(`redirect:${target}`) }) }))
vi.mock('next/navigation',()=>({redirect:calls.redirect}))
vi.mock('@/lib/external-contracts/intake',async()=>({
  ...await vi.importActual<typeof import('@/lib/external-contracts/intake')>('@/lib/external-contracts/intake'),
  createExternalContractIntake:calls.intake,
}))
import { submitExternalContractAction } from '@/app/teckna-avtal/actions'
import { parseExternalContractFormData } from '@/lib/external-contracts/intake'
import { EXTERNAL_CONTRACT_SUCCESS_NEEDS_REVIEW_MESSAGE } from '@/lib/external-contracts/publicIntakeFlash'

function input(email:string){
  const form=new FormData()
  for(const [key,value] of Object.entries({company_slug:'synthetic-intake',offer_reference:'synthetic-public-offer',
    first_name:'Synthetic',last_name:'Caller',email,facility_id:'synthetic-facility'}))form.append(key,value)
  return form
}
beforeEach(()=>{ calls.intake.mockReset();calls.redirect.mockClear() })
it('the actual anonymous Server Action gives identical acknowledgement for historical created and fresh review intake',async()=>{
  const targets=[]
  for(const [index,status] of ['created','needs_review','received','processing','partially_created','duplicate','cancelled'].entries()){
    const email=index===0?'known@example.invalid':'unknown@example.invalid'
    calls.intake.mockResolvedValueOnce({status,intakeId:'private-intake-id',customerId:status==='created'?'private-known-customer':null,caseId:'private-case-id'})
    await expect(submitExternalContractAction(input(email))).rejects.toThrow(/^redirect:/)
    targets.push(calls.redirect.mock.calls.at(-1)![0])
  }
  expect(targets[0]).toBe(targets[1])
  expect(new Set(targets).size).toBe(1)
  expect(new URL(targets[0],'http://127.0.0.1').searchParams.get('message')).toBe(EXTERNAL_CONTRACT_SUCCESS_NEEDS_REVIEW_MESSAGE)
  expect(targets[0]).not.toMatch(/private-intake-id|private-known-customer|private-case-id|known@example|unknown@example/)
})
it('the actual public parser never promotes forged company/customer/role/verified/lifecycle/billing fields',()=>{
  const form=input('synthetic@example.invalid')
  for(const [key,value] of Object.entries({company_id:'foreign-company',customer_id:'foreign-customer',actor_user_id:'foreign-actor',
    verified:'true',update_existing:'true',role:'owner',status:'active',billing_profile:'forged',invoice_email:'forged@example.invalid'}))form.append(key,value)
  const parsed=parseExternalContractFormData(form)
  expect(parsed).toMatchObject({companySlug:'synthetic-intake',email:'synthetic@example.invalid'})
  for(const key of ['company_id','customer_id','actor_user_id','verified','update_existing','role','status','billing_profile','invoice_email'])expect(parsed).not.toHaveProperty(key)
})
it('an internal intake error remains generic rather than revealing stored customer/history canaries',async()=>{
  calls.intake.mockRejectedValueOnce(new Error('PRIVATE_INTAKE_HISTORY_CANARY customer_number=known-secret'))
  await expect(submitExternalContractAction(input('synthetic@example.invalid'))).rejects.toThrow(/^redirect:/)
  const target=calls.redirect.mock.calls.at(-1)![0]
  expect(new URL(target,'http://127.0.0.1').searchParams.get('message')).toBe('Avtalet kunde inte tas emot.')
  expect(target).not.toMatch(/PRIVATE_INTAKE_HISTORY_CANARY|known-secret/)
})
