import {NextRequest,NextResponse} from 'next/server'
import {reviewBilateralCustomerSourceArtifact} from '@/lib/ediel/production/bilateralCustomerSource'
import {bilateralSourceHttp,bilateralSourceHeaders,bilateralSourceReview,artifactSelector,readBilateralSourceJson} from '@/lib/ediel/production/bilateralCustomerSourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return bilateralSourceHttp(['communication.write','customers.write','contracts.write','ediel.source.review'],async guard=>{const artifactId=artifactSelector.parse((await params).artifactId),input=bilateralSourceReview.parse(await readBilateralSourceJson(request,128*1024)),result=await reviewBilateralCustomerSourceArtifact({...input,companyId:guard.companyId!,actorUserId:guard.userId,artifactId});return NextResponse.json(result,{status:result.status==='held'?409:200,headers:bilateralSourceHeaders})})}
