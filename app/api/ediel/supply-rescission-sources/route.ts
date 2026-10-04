import {NextRequest,NextResponse} from 'next/server'
import {archiveSupplyRescission,SUPPLY_RESCISSION_SOURCE_MAX_BYTES} from '@/lib/ediel/production/supplyRescissionIntake'
import {supplyRescissionHttp,supplyRescissionHeaders,supplyRescissionSubmission,readSupplyRescissionJson} from '@/lib/ediel/production/supplyRescissionHttp'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return supplyRescissionHttp(['communication.write','contracts.read','metering.write'],async guard=>{const input=supplyRescissionSubmission.parse(await readSupplyRescissionJson(request,Math.ceil(SUPPLY_RESCISSION_SOURCE_MAX_BYTES/3)*4+128*1024)),result=await archiveSupplyRescission({...input,companyId:guard.companyId!,actorUserId:guard.userId});return NextResponse.json(result,{status:result.status==='held'?409:201,headers:supplyRescissionHeaders})})}
