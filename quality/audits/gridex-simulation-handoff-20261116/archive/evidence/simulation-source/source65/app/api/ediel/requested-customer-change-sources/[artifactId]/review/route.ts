import {NextRequest,NextResponse} from 'next/server'
import {reviewRequestedCustomerChangeSourceArtifact} from '@/lib/ediel/production/requestedCustomerChangeSource'
import {requestedCustomerChangeHttp,requestedCustomerChangeHeaders,requestedCustomerChangeReview,readRequestedCustomerChangeJson,artifactSelector} from '@/lib/ediel/production/requestedCustomerChangeHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return requestedCustomerChangeHttp(['communication.write','customers.write','contracts.write','ediel.source.review'],async guard=>{const artifactId=artifactSelector.parse((await params).artifactId),review=requestedCustomerChangeReview.parse(await readRequestedCustomerChangeJson(request,32*1024));const result=await reviewRequestedCustomerChangeSourceArtifact({...review,artifactId,companyId:guard.companyId!,actorUserId:guard.userId});return NextResponse.json(result,{status:result.status==='held'?409:200,headers:requestedCustomerChangeHeaders})})}
