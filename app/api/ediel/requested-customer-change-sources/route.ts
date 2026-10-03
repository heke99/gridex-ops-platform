import {NextRequest,NextResponse} from 'next/server'
import {archiveRequestedCustomerChangeSource} from '@/lib/ediel/production/requestedCustomerChangeSource'
import {requestedCustomerChangeHttp,requestedCustomerChangeHeaders,requestedCustomerChangeSubmission,readRequestedCustomerChangeJson,REQUESTED_CUSTOMER_CHANGE_BODY_LIMIT} from '@/lib/ediel/production/requestedCustomerChangeHttp'
import {supabaseService} from '@/lib/supabase/service'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return requestedCustomerChangeHttp(['communication.write','customers.write','contracts.write'],async guard=>{
 const input=requestedCustomerChangeSubmission.parse(await readRequestedCustomerChangeJson(request,REQUESTED_CUSTOMER_CHANGE_BODY_LIMIT))
 const{data:agreement,error}=await supabaseService.from('tenant_bilateral_agreements').select('environment').eq('company_id',guard.companyId!).eq('id',input.agreementId).eq('capability_code','prodat_z09e_requested_customer_change').eq('is_enabled',true).maybeSingle()
 if(error||!agreement||!['test','production'].includes(agreement.environment))throw Error('requested_customer_change_current_agreement_unavailable')
 const result=await archiveRequestedCustomerChangeSource({...input,companyId:guard.companyId!,actorUserId:guard.userId,environment:agreement.environment as 'test'|'production'})
 return NextResponse.json(result,{status:201,headers:requestedCustomerChangeHeaders})
})}
