import {NextRequest,NextResponse} from 'next/server'
import {readBilateralCustomerSourceArtifact} from '@/lib/ediel/production/bilateralCustomerSource'
import {approveSafeMasterdataChanges} from '@/lib/ediel/safeApplyReview'
import {bilateralSourceHttp,bilateralSourceHeaders,bilateralApplyCommand,artifactSelector,readBilateralSourceJson} from '@/lib/ediel/production/bilateralCustomerSourceHttp'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:NextRequest,{params}:{params:Promise<{artifactId:string}>}){return bilateralSourceHttp(['communication.write','customers.write','contracts.write'],async guard=>{const artifactId=artifactSelector.parse((await params).artifactId);bilateralApplyCommand.parse(await readBilateralSourceJson(request,1024));const artifact=await readBilateralCustomerSourceArtifact({companyId:guard.companyId!,actorUserId:guard.userId,artifactId});if(artifact.status!=='authorized')return NextResponse.json({status:'held',missing:artifact.missing},{status:409,headers:bilateralSourceHeaders});const result=await approveSafeMasterdataChanges({actorUserId:guard.userId,edielMessageId:artifact.sourceMessageId});return NextResponse.json({status:result.status,messageId:result.messageId,appliedCount:result.appliedCount},{headers:bilateralSourceHeaders})})}
