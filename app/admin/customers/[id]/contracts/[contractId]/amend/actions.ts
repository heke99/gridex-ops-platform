'use server'

import {revalidatePath} from 'next/cache'
import {requireAdminActionAccess} from '@/lib/admin/guards'
import {assertContractTenant,loadCustomerTenantContext} from '@/lib/tenant/entityGuards'
import {parseAmendmentProposal} from '@/lib/customer-contracts/amendmentInput'
import {submitAmendmentProposal,type AmendmentProposalOutcome} from '@/lib/customer-contracts/amendment'

export async function proposeSignedContractAmendmentAction(form:FormData):Promise<AmendmentProposalOutcome> {
  const access=await requireAdminActionAccess({allOf:['contracts.write','contracts.create']})
  const parsed=parseAmendmentProposal(form)
  if(!parsed.ok) return {status:'invalid',field:parsed.field,message:parsed.message}
  const input=parsed.value
  const {companyId}=await loadCustomerTenantContext(input.customerId,access)
  for(const contractId of [input.predecessorContractId,input.successorContractId]) {
    await assertContractTenant({companyId,customerId:input.customerId,contractId})
  }
  // Never accept actor/company fields from the form or turn a staff checkbox
  // into the customer's signature. The native command returns a proposal only.
  const outcome=await submitAmendmentProposal(input,{companyId,actorUserId:access.userId})
  if(outcome.status==='proposed') revalidatePath(`/admin/customers/${input.customerId}`)
  return outcome
}
