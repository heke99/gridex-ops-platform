import {NextRequest,NextResponse} from 'next/server'
import {reviewSupplyRescission} from '@/lib/ediel/production/supplyRescissionIntake'
import {supplyRescissionHttp,supplyRescissionHeaders,supplyRescissionReview,supplyRescissionArtifactId,readSupplyRescissionJson} from '@/lib/ediel/production/supplyRescissionHttp'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return supplyRescissionHttp(['communication.write','contracts.read','metering.write','ediel.supply_rescission.review'],async guard=>{const artifactId=supplyRescissionArtifactId.parse((await params).artifactId),input=supplyRescissionReview.parse(await readSupplyRescissionJson(request,128*1024)),result=await reviewSupplyRescission({...input,companyId:guard.companyId!,actorUserId:guard.userId,artifactId});return NextResponse.json(result,{status:result.status==='held'?409:200,headers:supplyRescissionHeaders})})}
