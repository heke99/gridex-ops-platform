import {NextRequest,NextResponse} from 'next/server'
import {archiveBilateralCustomerSource} from '@/lib/ediel/production/bilateralCustomerSource'
import {REQUESTED_CHANGE_SOURCE_MAX_BYTES} from '@/lib/ediel/production/requestedChangeIntake'
import {bilateralSourceHttp,bilateralSourceHeaders,bilateralSourceSubmission,readBilateralSourceJson} from '@/lib/ediel/production/bilateralCustomerSourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return bilateralSourceHttp(['communication.write','customers.write','contracts.write'],async guard=>{const input=bilateralSourceSubmission.parse(await readBilateralSourceJson(request,Math.ceil(REQUESTED_CHANGE_SOURCE_MAX_BYTES/3)*4+128*1024));const result=await archiveBilateralCustomerSource({...input,companyId:guard.companyId!,actorUserId:guard.userId});return NextResponse.json(result,{status:201,headers:bilateralSourceHeaders})})}
