import {NextRequest,NextResponse} from 'next/server'
import {readSupplyRescissionScope} from '@/lib/ediel/production/supplyRescissionIntake'
import {supplyRescissionHttp,supplyRescissionHeaders,supplyRescissionSelector,readSupplyRescissionJson} from '@/lib/ediel/production/supplyRescissionHttp'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function POST(request:NextRequest){return supplyRescissionHttp(['communication.read','contracts.read','metering.read'],async guard=>{const input=supplyRescissionSelector.parse(await readSupplyRescissionJson(request,128*1024)),result=await readSupplyRescissionScope({...input,companyId:guard.companyId!,actorUserId:guard.userId});return NextResponse.json(result,{status:result.status==='held'?409:200,headers:supplyRescissionHeaders})})}
